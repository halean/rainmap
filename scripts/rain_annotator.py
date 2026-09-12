import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.insights import InsightsService

REPO = Path(__file__).resolve().parents[1]
SAMPLE_CAMERAS_PATH = REPO / "data" / "derived" / "sample_cameras.json"
LOCATIONS_PATH = REPO / "data" / "derived" / "camera_locations.json"
OUTPUT_PATH = REPO / "data" / "derived" / "rain_sample.json"
STATE_PATH = REPO / "data" / "derived" / "annotator_state.json"

POLL_SECONDS = 60

# Hard ceiling on Gemma usage: the fetch sweep's speed varies wildly with the
# government site's own responsiveness (observed 2-52 cameras/min in one session),
# so image freshness alone can't be trusted to bound API volume. Derive a
# per-camera cooldown from a fixed daily budget so the cap holds even if the
# watchdog changes how many cameras are being sampled.
TARGET_DAILY_BUDGET = 10000  # comfortably under a 14k/day quota

PROMPT = (
    "You are analyzing one frame from a Ho Chi Minh City traffic camera to judge rain intensity. "
    "Weight your evidence carefully: "
    "a wet-looking or reflective road surface is WEAK, unreliable evidence on its own -- roads here "
    "stay shiny from streetlights, standing water, or rain that has already stopped, so do not let "
    "glare alone drive your answer. "
    "The STRONGEST evidence is people actively protecting themselves from rain right now: "
    "motorcyclists (very common in this traffic) wearing raincoats/ponchos or ducking under overpasses, "
    "pedestrians with umbrellas, visible falling rain streaks or haze, or people not present who "
    "normally would be. Weigh these heavily over road glare. "
    "Respond with STRICT JSON only, no markdown fences, no extra text, matching this schema: "
    '{"rain": "<one of: No, Light, Medium, Heavy>", '
    '"justification": "<one short sentence, naming the specific evidence you weighted most>"}'
)


def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            return default
    return default


def annotate(svc: InsightsService, image_path: Path) -> dict:
    text = svc.google_generate_with_prompt(images=[image_path], prompt=PROMPT)
    cleaned = re.sub(r"^```(json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    return json.loads(cleaned)


def main():
    svc = InsightsService()
    state = load_json(STATE_PATH, {})
    records = {r["camera_id"]: r for r in load_json(OUTPUT_PATH, [])}
    display_names = {r["camera_id"]: r.get("display_name", "") for r in load_json(LOCATIONS_PATH, [])}

    cameras = load_json(SAMPLE_CAMERAS_PATH, [])
    startup_interval = 86400 * max(len(cameras), 1) / TARGET_DAILY_BUDGET
    print(f"Watching {len(cameras)} sample cameras, polling every {POLL_SECONDS}s, "
          f"per-camera cooldown {startup_interval:.0f}s (budget {TARGET_DAILY_BUDGET}/day)")

    while True:
        # reload each pass so a watchdog swapping cameras in/out takes effect without a restart
        cameras = load_json(SAMPLE_CAMERAS_PATH, [])
        if not cameras:
            time.sleep(POLL_SECONDS)
            continue
        min_reannotate_interval_sec = 86400 * len(cameras) / TARGET_DAILY_BUDGET

        current_ids = {c["camera_id"] for c in cameras}
        dropped = [cid for cid in list(records) if cid not in current_ids]
        for cid in dropped:
            records.pop(cid, None)
            state.pop(cid, None)
        if dropped:
            print(f"Pruned {len(dropped)} camera(s) no longer in the sample set: {dropped}")
            OUTPUT_PATH.write_text(json.dumps(list(records.values()), ensure_ascii=False, indent=2))
            STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2))

        changed = 0
        for cam in cameras:
            cam_id = cam["camera_id"]
            latest = svc.latest_images_for_camera(cam_id, limit=1)
            if not latest:
                continue
            img_path = latest[0]
            img_key = str(img_path)
            if state.get(cam_id) == img_key:
                continue  # no new frame since last check

            rec = records.get(cam_id, {
                "camera_id": cam_id,
                "title": cam.get("title", ""),
                "district": cam.get("district", ""),
            })

            last_updated = rec.get("updated_at")
            if last_updated:
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(last_updated)).total_seconds()
                if age < min_reannotate_interval_sec:
                    continue  # rate-limit Gemma usage; state stays unset so we retry once cooldown passes

            try:
                result = annotate(svc, img_path)
            except Exception as e:
                print(f"  [{cam_id}] annotate error: {e}")
                continue

            rec["location_text"] = display_names.get(cam_id) or cam.get("display_name") or rec.get("location_text", "")
            rec["rain"] = result.get("rain", rec.get("rain", "No"))
            rec["justification"] = result.get("justification", "")
            rec["image_url"] = f"/media/{img_path.as_posix().lstrip('./')}"
            rec["updated_at"] = datetime.now(timezone.utc).isoformat()
            records[cam_id] = rec
            state[cam_id] = img_key
            changed += 1
            print(f"  [{cam_id}] {cam.get('district')} -> {rec['rain']} ({img_path.name})")

            OUTPUT_PATH.write_text(json.dumps(list(records.values()), ensure_ascii=False, indent=2))
            STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2))

        if changed:
            print(f"Pass complete: {changed} camera(s) re-annotated.")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
