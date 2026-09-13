import csv
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
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

# Ignore frames older than a few sweep laps. Matters for cameras rotated back into
# the set, which still have stale images on disk from their previous stint.
MAX_FRAME_AGE_SEC = int(os.getenv("MAX_FRAME_AGE_SEC", "900"))

# The previous frame is sent as context so a dry->wet change can be read as rain.
# It is only admissible if it is recent: "the road was dry in the earlier frame"
# means nothing if that frame is from yesterday, and a camera coming back from an
# outage is exactly the case that would otherwise invent a downpour out of a gap.
# Frames land ~5 min apart, so this tolerates jitter and a single missed sweep.
PAIR_ENABLED = os.getenv("PAIR_ENABLED", "1") == "1"
PAIR_MAX_GAP_SEC = int(os.getenv("PAIR_MAX_GAP_SEC", "780"))  # 13 min

ICT = timezone(timedelta(hours=7))  # Vietnam has no DST

# Time of day changes what the same visual evidence means, and getting this wrong is
# not hypothetical: a 04:54 frame of pre-dawn mist was read as a heavy downpour
# because the street was empty and visibility was poor -- both true, and both because
# it was 5am, not because of rain.
DARK_GUIDANCE = (
    "It is dark in this frame, which changes what the evidence means:\n"
    "- Poor visibility, haze, and halos or starbursts around streetlights are ordinary "
    "after dark, and especially near dawn, when humid air here often sits as mist or fog. "
    "Do NOT read murk, glare or reduced visibility as heavy rain.\n"
    "- An empty or near-empty street is normal at this hour. It is NOT evidence that rain "
    "has driven people off the road.\n"
    "- Raincoats and umbrellas are hard to make out in the dark, so not seeing them says "
    "very little either way.\n"
    "- What still counts at night: distinct streaks or dashes falling through headlight and "
    "streetlight beams, spray kicked up behind moving vehicles, standing water visibly "
    "rippling or splashing, or droplets sitting on the camera lens. Without at least one of "
    "those, answer 'No' even if the scene looks murky.\n\n"
)

DAY_GUIDANCE = (
    "It is daylight in this frame:\n"
    "- These streets are normally thick with motorbikes at this hour, so a suddenly sparse "
    "road is itself worth noticing, though on its own it is not conclusive.\n"
    "- Riders in raincoats or ponchos, pedestrians under umbrellas, and people sheltering "
    "under awnings or overpasses are the clearest signals available in daylight.\n"
    "- Overcast grey skies alone are not rain; this city is often overcast without a drop "
    "falling.\n\n"
)

PROMPT_HEAD = (
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
)

TAIL_OPEN = (
    # Anchored on visible falling water rather than on an empty street or poor
    # visibility: those are satisfied by any quiet, dark or misty hour, and reading
    # them as rain is precisely how a 5am fog frame got called a downpour.
    "Judge intensity on this city's own scale, not a generic one, and anchor it on water you "
    "can actually see falling:\n"
    "- 'Heavy': rain visibly coming down hard -- dense streaks, heavy spray thrown off vehicles, "
    "water running or pooling across the road, riders pulled over or struggling.\n"
    "- 'Medium': steady rain that the people out there have clearly committed to, with fall "
    "visible against a dark background or in the light.\n"
    "- 'Light': drizzle people put up with, which plenty do not bother covering up for.\n"
)

# Two definitions of 'No', because they are only correct for their own input.
# Single-frame has no way to know the road was dry ten minutes ago, so it can only
# rule on what is falling now. Given the previous frame, refusing to use the
# dry->wet change throws away the strongest evidence in the pair: measured on the
# labelled set, single-frame missed BOTH rain frames and two-frame without this
# bullet still missed 3 of 9, while with it 8 of 9 land (NOTES.md).
NO_BULLET_SINGLE = (
    "- 'No': nothing is falling right now -- however wet the ground is, however dark, hazy or "
    "empty the scene looks.\n\n"
)
NO_BULLET_PAIR = (
    "- 'No': nothing is falling now and nothing shows it was falling moments ago. But if the "
    "earlier frame shows a dry road and this one shows a wet one, water fell in between -- that "
    "is rain, not 'No', even if you cannot see it falling. Pick the intensity the change implies: "
    "a road that went from dry to fully soaked in five minutes means it came down hard. A road "
    "already wet in BOTH frames is not evidence of new rain -- that is the aftermath, and 'No' "
    "is right.\n\n"
)

TAIL_WARN = (
    "An empty street, poor visibility, or a murky-looking image are NOT by themselves reasons to "
    "answer Heavy. Only visible falling water justifies that.\n\n"
)

# The justification is published under the photo on the map. Readers see one
# street scene and know nothing about how many frames were compared, so wording
# like "the road is wet in both frames" describes our method and reads as a
# non-sequitur to them. Compare across the frames as much as you like -- just
# report the conclusion as a statement about the street.
PAIR_JUSTIFY_RULE = (
    "Your justification is published beneath a single photo of this street, for readers who "
    "never see the earlier frame and know nothing about how this was worked out. So write it "
    "about the street itself, describing the conditions you settled on. Do NOT mention frames, "
    "images, comparisons, or what things looked like earlier -- no 'in both frames', no 'in the "
    "first/second frame', no 'between the frames'. This is a rule about wording only: decide the "
    "verdict first, on the evidence, and then describe it without reference to how you looked.\n\n"
)

TAIL_SCHEMA = (
    "Respond with STRICT JSON only, no markdown fences, no extra text, matching this schema: "
    '{"rain": "<one of: No, Light, Medium, Heavy>", '
    '"justification": "<one short sentence giving the overall read of the scene that decided it>"}'
)

TAIL_CLOSE = TAIL_WARN + TAIL_SCHEMA

PROMPT_TAIL = TAIL_OPEN + NO_BULLET_SINGLE + TAIL_CLOSE

TWO_FRAME_PRE = (
    "You are given TWO frames from the same fixed traffic camera, about five minutes apart. The "
    "FIRST is the earlier frame, context only. Classify the SECOND.\n\n"
)


def build_prompt(captured_at_iso: str | None, two_frame: bool = False) -> str:
    """Assemble the prompt, telling the model what local time it is looking at.

    Without this the model has no way to tell 'deserted because of a downpour' from
    'deserted because it is 4am', and both look identical in a dark frame.

    two_frame must match what is actually sent: the pair wording talks about "the
    earlier frame", which is worse than useless if only one image goes with it.
    """
    pre = TWO_FRAME_PRE if two_frame else ""
    tail = (
        TAIL_OPEN
        + (NO_BULLET_PAIR if two_frame else NO_BULLET_SINGLE)
        + TAIL_WARN
        + (PAIR_JUSTIFY_RULE if two_frame else "")
        + TAIL_SCHEMA
    )
    if not captured_at_iso:
        return pre + PROMPT_HEAD + tail

    local = datetime.fromisoformat(captured_at_iso).astimezone(ICT)
    hour = local.hour
    is_dark = hour < 6 or hour >= 18

    # Boundaries follow HCMC's actual day: near the equator, so sunrise is ~05:45 and
    # sunset ~17:55 year-round, and the city stirs early -- 05:00 is people heading out,
    # not the dead of night. Getting this wrong matters, because the dawn window is
    # exactly when mist is most likely to be mistaken for rain.
    if hour < 4:
        phase = "the middle of the night, when the roads are genuinely quiet"
    elif hour < 6:
        phase = (
            "dawn -- before sunrise, but the city is already stirring and traffic is "
            "picking up. Mist, low cloud and damp haze are common at this hour"
        )
    elif hour < 9:
        phase = "early morning, with the sun up and traffic building toward rush hour"
    elif hour < 16:
        phase = "the middle of the day, when traffic is normally heavy"
    elif hour < 18:
        phase = "late afternoon, with the light starting to go"
    elif hour < 22:
        phase = "evening, when the roads are lit but still busy"
    else:
        phase = "late evening, with traffic thinning out"

    when = (
        f"This frame was captured at {local.strftime('%H:%M')} local time in Ho Chi Minh City "
        f"({local.strftime('%A')}), which is {phase}.\n\n"
    )
    return pre + PROMPT_HEAD + when + (DARK_GUIDANCE if is_dark else DAY_GUIDANCE) + tail


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


def usable_previous(svc: InsightsService, cam_id: str, image_path: Path) -> Path | None:
    """The frame before image_path, if it is recent enough to compare against."""
    if not PAIR_ENABLED:
        return None
    recent = svc.latest_images_for_camera(cam_id, limit=2)
    if len(recent) < 2 or recent[-1] != image_path:
        return None
    prev = recent[-2]
    now, before = captured_at_from(image_path), captured_at_from(prev)
    if not (now and before):
        return None
    gap = (datetime.fromisoformat(now) - datetime.fromisoformat(before)).total_seconds()
    return prev if 0 < gap <= PAIR_MAX_GAP_SEC else None


def annotate(
    svc: InsightsService,
    image_path: Path,
    captured_at_iso: str | None = None,
    prev_path: Path | None = None,
) -> dict:
    images = [prev_path, image_path] if prev_path else [image_path]
    text = svc.google_generate_with_prompt(
        images=images, prompt=build_prompt(captured_at_iso, two_frame=prev_path is not None)
    )
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

            # A camera rotated back into the set still has old frames on disk, and its
            # state entry was pruned when it left -- so without this it would be graded
            # on a days-old image and the map would show that as current.
            captured = captured_at_from(img_path)
            if captured:
                frame_age = (datetime.now(timezone.utc) - datetime.fromisoformat(captured)).total_seconds()
                if frame_age > MAX_FRAME_AGE_SEC:
                    continue

            # lat/lon must be carried onto the record: the map drops any row without
            # them, so a newly-added camera would otherwise never draw a pin.
            rec = records.get(cam_id, {
                "camera_id": cam_id,
                "title": cam.get("title", ""),
                "district": cam.get("district", ""),
            })
            if rec.get("lat") is None:
                rec["lat"], rec["lon"] = cam.get("lat"), cam.get("lon")
                rec.setdefault("approx", False)

            last_updated = rec.get("updated_at")
            if last_updated:
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(last_updated)).total_seconds()
                if age < min_reannotate_interval_sec:
                    continue  # rate-limit Gemma usage; state stays unset so we retry once cooldown passes

            due.append((cam, rec, img_path, usable_previous(svc, cam_id, img_path)))

        # Phase 2 -- run the Gemma calls concurrently. Workers are pure: they only do
        # the network call and hand back a result. All mutation of records/state and
        # every file write stays on this thread, so none of it needs locking.
        def call_gemma(item):
            cam, rec, img_path, prev_path = item
            started = time.monotonic()
            try:
                result = annotate(svc, img_path, captured_at_from(img_path), prev_path)
                return item, result, time.monotonic() - started, None
            except Exception as e:
                return item, None, time.monotonic() - started, e

        changed = 0
        if due:
            with ThreadPoolExecutor(max_workers=ANNOTATE_WORKERS) as pool:
                for (cam, rec, img_path, prev_path), result, elapsed, err in pool.map(call_gemma, due):
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
                        "[%s] %s -> %s (%s%s, %.1fs) %s",
                        cam_id, rec["location_text"] or cam.get("district", ""), rec["rain"],
                        img_path.name, f" +{prev_path.name}" if prev_path else " single",
                        elapsed, rec["justification"],
                    )

                    append_history(rec)
                    OUTPUT_PATH.write_text(json.dumps(list(records.values()), ensure_ascii=False, indent=2))
                    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2))

        if changed:
            log.info("pass complete: %d camera(s) re-annotated", changed)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
