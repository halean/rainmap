import csv
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.log_setup import get_logger
from app.services.insights import InsightsService

REPO = Path(__file__).resolve().parents[1]
SAMPLE_CAMERAS_PATH = REPO / "data" / "derived" / "sample_cameras.json"
LOCATIONS_PATH = REPO / "data" / "derived" / "camera_locations.json"
OUTPUT_PATH = REPO / "data" / "derived" / "rain_sample.json"
STATE_PATH = REPO / "data" / "derived" / "annotator_state.json"

# rain_sample.json only ever holds the *current* reading per camera, because each
# write overwrites the last. This append-only log is the historical record: without
# it every past reading is lost, and questions like "when did it last rain in
# District 7" or "how did the classifier do that afternoon" are unanswerable.
HISTORY_PATH = REPO / "data" / "derived" / "rain_history.csv"
HISTORY_FIELDS = [
    "timestamp", "camera_id", "location_text", "rain", "justification", "image",
]

log = get_logger("annotator")

POLL_SECONDS = 60

# Hard ceiling on Gemma usage: the fetch sweep's speed varies wildly with the
# government site's own responsiveness (observed 2-52 cameras/min in one session),
# so image freshness alone can't be trusted to bound API volume. Derive a
# per-camera cooldown from a fixed daily budget so the cap holds even if the
# watchdog changes how many cameras are being sampled.
TARGET_DAILY_BUDGET = int(os.getenv("TARGET_DAILY_BUDGET", "10000"))  # under a 14k/day quota

# Gemma calls run concurrently because each one is ~18s of waiting on the network.
# Two workers halve the cycle (11.9 -> 6.0 min per camera) at ~9,650 calls/day, 69%
# of quota. The budget cooldown above is the backstop: it doesn't bind at today's
# latency, but if Gemma gets faster than ~17s/call it pins usage at the budget
# rather than letting throughput run away (2 workers at 12s would be 14,400/day,
# over quota). Raise workers only together with a matching budget check.
ANNOTATE_WORKERS = int(os.getenv("ANNOTATE_WORKERS", "2"))

PROMPT = (
    "This is one frame from a public traffic camera on a street in Ho Chi Minh City, Vietnam. "
    "Decide whether rain is falling there AT THIS MOMENT.\n\n"

    "Read the scene the way someone who lives in this city would if they glanced out a window "
    "before deciding whether to ride. Take in the whole picture at once -- how people are dressed "
    "and behaving, how the traffic is moving, the sky and the quality of the light, how the air "
    "itself looks. Do not go hunting for one giveaway object and rule on it. No single detail is "
    "reliable here; a consistent impression across many weak signals is. Where the signals "
    "disagree, or the frame is too dark, distant or blurred to read confidently, say so plainly "
    "and settle on the less dramatic reading.\n\n"

    "Local context that shapes what you are looking at:\n"
    "- These streets are dominated by motorbikes, so the riders are the most expressive thing in "
    "any frame: what they are wearing, whether they are still moving, whether they have pulled "
    "over or clustered under cover.\n"
    "- Rain here usually arrives as a sudden heavy downpour and stops just as abruptly. A soaked, "
    "puddled street under a brightening sky is an ordinary sight and does NOT mean it is raining "
    "now.\n"
    "- Wet asphalt throws back streetlights, shop signs and headlights very strongly, especially "
    "after dark. Shine, glare and reflections are the most misleading thing in these frames -- on "
    "their own they say almost nothing about whether rain is currently falling.\n"
    "- Rain lands on the camera as well as the street, so heavy weather tends to change how the "
    "entire image reads, not just what can be seen inside it.\n\n"

    "Judge intensity on this city's own scale, not a generic one. 'Heavy' is the kind of downpour "
    "that clears the street, cuts visibility and starts flooding the road. 'Medium' is steady rain "
    "that everyone out there has visibly committed to. 'Light' is the sort of drizzle people put "
    "up with and many do not bother covering up for. 'No' means nothing is falling right now, no "
    "matter how wet the ground looks.\n\n"

    "Respond with STRICT JSON only, no markdown fences, no extra text, matching this schema: "
    '{"rain": "<one of: No, Light, Medium, Heavy>", '
    '"justification": "<one short sentence giving the overall read of the scene that decided it>"}'
)


def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            return default
    return default


def captured_at_from(image_path: Path) -> str | None:
    """Capture time of a frame, from the filename the fetcher stamps it with.

    src/fetch/check.py names files with datetime.now() on a UTC host, so the stem
    is a UTC wall-clock time; tag it as such rather than leaving it naive, so the
    map can render it in whatever timezone the viewer is in.
    """
    m = re.match(r"^(\d{8})_(\d{6})", image_path.stem)
    if not m:
        return None
    try:
        dt = datetime.strptime(f"{m.group(1)}_{m.group(2)}", "%Y%m%d_%H%M%S")
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat()


def append_history(rec: dict) -> None:
    write_header = not HISTORY_PATH.exists()
    try:
        with HISTORY_PATH.open("a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if write_header:
                writer.writerow(HISTORY_FIELDS)
            writer.writerow([
                rec.get("updated_at", ""),
                rec.get("camera_id", ""),
                rec.get("location_text", ""),
                rec.get("rain", ""),
                rec.get("justification", ""),
                Path(rec.get("image_url", "")).name,
            ])
    except Exception as e:  # history is useful, but never worth killing the loop over
        log.warning("could not append history for %s: %s", rec.get("camera_id"), e)


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
    log.info(
        "watching %d sample cameras, %d concurrent worker(s), polling every %ds, "
        "per-camera cooldown %.0fs (budget %d/day), history -> %s",
        len(cameras), ANNOTATE_WORKERS, POLL_SECONDS, startup_interval,
        TARGET_DAILY_BUDGET, HISTORY_PATH.relative_to(REPO),
    )

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
            log.info("pruned %d camera(s) no longer in the sample set: %s", len(dropped), dropped)
            OUTPUT_PATH.write_text(json.dumps(list(records.values()), ensure_ascii=False, indent=2))
            STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2))

        # Phase 1 -- pick what's due, single-threaded. Selecting up front means two
        # workers can never be handed the same camera, and the cooldown is evaluated
        # exactly once per camera per pass.
        due = []
        for cam in cameras:
            cam_id = cam["camera_id"]
            latest = svc.latest_images_for_camera(cam_id, limit=1)
            if not latest:
                continue
            img_path = latest[0]
            if state.get(cam_id) == str(img_path):
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

            due.append((cam, rec, img_path))

        # Phase 2 -- run the Gemma calls concurrently. Workers are pure: they only do
        # the network call and hand back a result. All mutation of records/state and
        # every file write stays on this thread, so none of it needs locking.
        def call_gemma(item):
            cam, rec, img_path = item
            started = time.monotonic()
            try:
                return item, annotate(svc, img_path), time.monotonic() - started, None
            except Exception as e:
                return item, None, time.monotonic() - started, e

        changed = 0
        if due:
            with ThreadPoolExecutor(max_workers=ANNOTATE_WORKERS) as pool:
                for (cam, rec, img_path), result, elapsed, err in pool.map(call_gemma, due):
                    cam_id = cam["camera_id"]
                    if err is not None:
                        log.warning("[%s] annotate failed after %.1fs: %s", cam_id, elapsed, err)
                        continue

                    rec["location_text"] = display_names.get(cam_id) or cam.get("display_name") or rec.get("location_text", "")
                    rec["rain"] = result.get("rain", rec.get("rain", "No"))
                    rec["justification"] = result.get("justification", "")
                    rec["image_url"] = f"/media/{img_path.as_posix().lstrip('./')}"
                    rec["captured_at"] = captured_at_from(img_path)  # when the frame was taken
                    rec["updated_at"] = datetime.now(timezone.utc).isoformat()  # when Gemma read it
                    records[cam_id] = rec
                    state[cam_id] = str(img_path)
                    changed += 1
                    log.info(
                        "[%s] %s -> %s (%s, %.1fs) %s",
                        cam_id, rec["location_text"] or cam.get("district", ""), rec["rain"],
                        img_path.name, elapsed, rec["justification"],
                    )

                    append_history(rec)
                    OUTPUT_PATH.write_text(json.dumps(list(records.values()), ensure_ascii=False, indent=2))
                    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2))

        if changed:
            log.info("pass complete: %d camera(s) re-annotated", changed)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
