"""
Periodically health-checks the sampled cameras and swaps out any that have been
consistently unreachable, replacing them with a live camera that preserves
spatial spacing. Runs independently of rain_annotator.py / the fetch job.

Design notes (learned the hard way):
- The traffic-camera site itself is flaky under load (random single-request
  timeouts even when sequential). A single failed check is not evidence a
  camera is dead -- we require STRIKE_THRESHOLD consecutive failed check
  cycles, spaced CHECK_INTERVAL_SEC apart, before acting.
- Never touch other cameras' rows in rain_sample.json / annotator_state.json --
  only the ones we're removing/adding. rain_annotator.py separately prunes
  entries that fall out of sample_cameras.json on its own reload.
- After changing sample_cameras.json, restart the *fetch job* (via the API;
  cheap, no server restart) so its CSV-driven camera list picks up the swap.
  rain_annotator.py reloads its camera list from disk every pass on its own.
- A camera can fail without failing the liveness check: the endpoint keeps
  serving a full-size image that never changes. is_live() sees a valid 40KB
  JPEG and passes it forever, so it never strikes out, stays in the sample, and
  the annotator republishes a verdict about a frozen scene indefinitely.
  Measured over the stored frames: 8 of 320 cameras have served byte-identical
  full-size frames, in runs up to 3 (~15 min at the fetch cadence), and three of
  those went fully offline afterwards -- a freeze is a leading indicator, not
  just a nuisance. Detected here from the frames on disk rather than from this
  loop's own probes, because the fetch job samples every ~5 min against this
  loop's 20, and a 15-minute freeze is invisible at 20-minute resolution.
  Frames below OFFLINE_THRESHOLD are excluded: the site serves one shared 2.6KB
  placeholder for dead cameras, which repeats forever by nature and is already
  the liveness check's job to catch.
"""

import csv
import hashlib
import json
import math
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.atomic_write import write_json_atomic
from app.log_setup import get_logger

REPO = Path(__file__).resolve().parents[1]
SAMPLE_CAMERAS_PATH = REPO / "data" / "derived" / "sample_cameras.json"
LOCATIONS_PATH = REPO / "data" / "derived" / "camera_locations.json"
RAIN_SAMPLE_PATH = REPO / "data" / "derived" / "rain_sample.json"
ANNOTATOR_STATE_PATH = REPO / "data" / "derived" / "annotator_state.json"
FETCH_CSV_PATH = REPO / "data" / "metadata" / "cameras_sample40.csv"
STRIKES_PATH = REPO / "data" / "derived" / "watchdog_strikes.json"
BLOCKLIST_PATH = REPO / "data" / "derived" / "watchdog_blocklist.json"
SLOTS_PATH = REPO / "data" / "derived" / "camera_slots.json"
ROTATION_RECENT_PATH = REPO / "data" / "derived" / "rotation_recent.json"

BASE_IMG = "https://giaothong.hochiminhcity.gov.vn/render/ImageHandler.ashx"
OFFLINE_THRESHOLD = 5 * 1024
CHECK_TIMEOUT = 25

CHECK_INTERVAL_SEC = int(os.getenv("CHECK_INTERVAL_SEC", str(20 * 60)))  # health-check cadence
STRIKE_THRESHOLD = 3            # consecutive failed cycles before replacing (~1hr at 20min cadence)

# STALL_ENABLED=0 leaves a frozen feed in the sample, which is what shipped before.
# The threshold is one frame above the longest genuine freeze in the stored history
# (3, seen on 8 cameras): short freezes recover on their own and are logged but not
# acted on, so replacing a camera means ~20 min of a provably unchanging picture.
STALL_ENABLED = os.getenv("STALL_ENABLED", "1") == "1"
STALL_FRAMES = int(os.getenv("STALL_FRAMES", "4"))
RAW_ROOT = REPO / "data" / "raw"
APP_BASE_URL = "http://127.0.0.1:8000"

# --- Rotation -------------------------------------------------------------
# The fetch job hammers the same 40 endpoints forever while 700+ others go
# untouched. Rotating one healthy camera per cycle spreads the same total request
# volume across the fleet (~66% of live cameras over a month).
#
# Every constant below exists to stop rotation destroying the farthest-point
# spatial coverage the set was built with. Verified by simulating 2,000 rotations
# against the real camera positions:
#   naive (nearest-to-occupant, no guards) -> min spacing collapses 3.49 -> 0.34 km
#   anchors + TTL but no drift cap         -> occupants wander 33 km, worst-case
#                                             coverage gap doubles to 6.65 km
#   all guards on                          -> min spacing holds at 3.00 km and
#                                             coverage matches the baseline
ROTATE_ENABLED = os.getenv("ROTATE_ENABLED", "1") == "1"
MIN_SPACING_KM = float(os.getenv("MIN_SPACING_KM", "3.0"))
MAX_ANCHOR_DRIFT_KM = float(os.getenv("MAX_ANCHOR_DRIFT_KM", "3.0"))
RECENT_TTL_SEC = int(os.getenv("RECENT_TTL_SEC", str(3 * 86400)))
PENDING_TIMEOUT_SEC = int(os.getenv("PENDING_TIMEOUT_SEC", str(30 * 60)))
ROTATE_MAX_SLOT_TRIES = 5

log = get_logger("watchdog")

session = requests.Session()
session.headers.update({"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"})


class LoadError(Exception):
    """A file exists but could not be parsed -- treat as unknown, never as empty."""


def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            return default
    return default


def load_json_strict(path: Path, default):
    """Like load_json, but distinguishes 'absent' from 'unreadable'.

    The annotator rewrites these files every 60s. A torn read used to fall back to
    the empty default, which the watchdog would then happily save back -- wiping all
    40 readings. Callers that write a file back must use this and skip on LoadError.
    """
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception as e:
        raise LoadError(f"{path.name}: {e}") from e


def save_json(path: Path, data):
    """Atomic write: the annotator reads these files concurrently, and a partial
    write would be parsed as corrupt (or worse, as valid-but-truncated).

    Shared with the annotator, which writes the same two files -- one copy so the
    two cannot drift apart on a correctness detail.
    """
    write_json_atomic(path, data)


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def is_live(camera_id: str) -> bool:
    try:
        resp = session.get(f"{BASE_IMG}?id={camera_id}", timeout=CHECK_TIMEOUT)
        ctype = resp.headers.get("Content-Type", "")
        if resp.status_code != 200 or "text" in ctype.lower():
            return False
        return len(resp.content) >= OFFLINE_THRESHOLD
    except Exception:
        return False


def frozen_run(camera_id: str) -> int:
    """How many of the newest stored frames are byte-identical to each other.

    1 means the latest frame differs from the one before it -- a live feed. These
    frames carry a burned-in clock, so two genuinely fresh captures differ even
    when the street is empty and nothing moves; identical bytes mean the endpoint
    re-served one image rather than that the scene held still.

    Reads only the last STALL_FRAMES files. Path order is chronological because
    the layout is <id>/YYYY/MM/DD/YYYYMMDD_HHMMSS.jpg.
    """
    cdir = RAW_ROOT / camera_id
    if not cdir.is_dir():
        return 1
    try:
        recent = [p for p in sorted(cdir.rglob("*.jpg"))[-STALL_FRAMES:]
                  if p.stat().st_size >= OFFLINE_THRESHOLD]
        if len(recent) < STALL_FRAMES:
            return 1  # too few full-size frames to judge; a new camera is not a stalled one
        digests = [hashlib.md5(p.read_bytes()).hexdigest() for p in recent]
    except OSError as e:
        log.warning("could not read frames for %s: %s", camera_id, e)
        return 1
    run = 1
    for a, b in zip(reversed(digests), reversed(digests[:-1])):
        if a != b:
            break
        run += 1
    return run


def write_fetch_csv(cameras):
    # Atomic: the fetch job re-reads this at every lap boundary, so a half-written
    # file would be parsed as a short camera list.
    tmp = FETCH_CSV_PATH.with_suffix(".csv.tmp")
    with tmp.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Prop_CamId"])
        for c in cameras:
            w.writerow([c["camera_id"]])
    os.replace(tmp, FETCH_CSV_PATH)


def restart_fetch_job():
    try:
        session.post(f"{APP_BASE_URL}/api/jobs/stop", timeout=10)
    except Exception as e:
        log.info("stop job failed (may not have been running): %s", e)
    for _ in range(60):
        try:
            status = session.get(f"{APP_BASE_URL}/api/status", timeout=10).json()
            if status.get("status") != "running":
                break
        except Exception:
            break
        time.sleep(2)
    try:
        session.post(f"{APP_BASE_URL}/api/jobs/start", timeout=10)
        log.info("fetch job restarted with updated camera list")
    except Exception as e:
        log.error("failed to restart fetch job: %s", e)


def now_utc():
    return datetime.now(timezone.utc)


def load_slots(cameras):
    """Slots pin each sample position to a fixed anchor so rotation cannot drift.

    Bootstrapped from whatever the set looks like on first run -- i.e. the original
    farthest-point positions -- and repaired if the set has changed underneath us.
    """
    slots = load_json(SLOTS_PATH, [])
    by_cam = {s.get("camera_id"): s for s in slots}
    out, used = [], set()
    for i, cam in enumerate(cameras):
        if cam.get("retiring_since"):
            continue  # a retiring camera shares its slot with its replacement
        s = by_cam.get(cam["camera_id"])
        if s and s["camera_id"] not in used:
            out.append({**s, "slot": len(out)})
        else:
            out.append({"slot": len(out), "anchor_lat": cam["lat"],
                        "anchor_lon": cam["lon"], "camera_id": cam["camera_id"]})
        used.add(cam["camera_id"])
    return out


def prune_recent(recent):
    cutoff = now_utc().timestamp() - RECENT_TTL_SEC
    return {k: v for k, v in recent.items()
            if datetime.fromisoformat(v).timestamp() > cutoff}


def eligible_pool(locations, current_ids, blocklist, recent):
    block, rec = set(blocklist), set(recent)
    return [l for l in locations
            if l.get("lat") is not None
            and l["camera_id"] not in current_ids
            and l["camera_id"] not in block
            and l["camera_id"] not in rec
            and l.get("cam_status") != "NOT_IMAGE"]


def pick_incoming(anchor_lat, anchor_lon, pool, others, blocklist):
    """Nearest eligible camera to the slot's anchor, subject to the two guards.

    Candidates are tried nearest-first; each is liveness-probed before being
    accepted, and a candidate that fails the probe is genuinely dead so it goes to
    the blocklist (same meaning as always).
    """
    ranked = sorted(
        ((haversine_km(anchor_lat, anchor_lon, c["lat"], c["lon"]), c) for c in pool),
        key=lambda t: t[0],
    )
    for dist, cand in ranked:
        if dist > MAX_ANCHOR_DRIFT_KM:
            return None  # nearest is already too far; this slot cannot rotate now
        spacing = min((haversine_km(cand["lat"], cand["lon"], o["lat"], o["lon"])
                       for o in others), default=1e9)
        if spacing < MIN_SPACING_KM:
            continue  # would crowd a neighbouring slot
        log.info("rotation candidate %s (%.2fkm from anchor, %.2fkm to nearest other)",
                 cand["camera_id"], dist, spacing)
        if is_live(cand["camera_id"]):
            return cand
        log.info("  -> candidate dead, blocklisting %s", cand["camera_id"])
        blocklist.append(cand["camera_id"])
        time.sleep(0.3)
    return None


def rotate_one(cameras, slots, blocklist, recent):
    """Stage one swap: returns (outgoing_camera, incoming_record) or None.

    Picks a random slot for fairness; slots whose neighbourhood is exhausted (or
    which sit in sparse outskirts with nothing inside the drift cap) are skipped
    and another slot is tried.
    """
    locations = load_json(LOCATIONS_PATH, [])
    current_ids = {c["camera_id"] for c in cameras}
    pool = eligible_pool(locations, current_ids, blocklist, recent)
    if not pool:
        log.warning("rotation: no eligible candidates at all")
        return None

    by_cam = {c["camera_id"]: c for c in cameras}
    for slot in random.sample(slots, min(ROTATE_MAX_SLOT_TRIES, len(slots))):
        out = by_cam.get(slot["camera_id"])
        if out is None or out.get("retiring_since"):
            continue
        others = [c for c in cameras if c["camera_id"] != out["camera_id"]]
        cand = pick_incoming(slot["anchor_lat"], slot["anchor_lon"], pool, others, blocklist)
        if cand is None:
            continue
        incoming = {
            "camera_id": cand["camera_id"], "title": cand.get("title", ""),
            "district": cand.get("district") or "", "display_name": cand.get("display_name", ""),
            "lat": cand["lat"], "lon": cand["lon"], "image_path": None,
            "slot": slot["slot"],
        }
        return out, incoming
    log.info("rotation: no slot had an eligible candidate this cycle")
    return None


def current_readings():
    return {r["camera_id"] for r in load_json(RAIN_SAMPLE_PATH, []) if r.get("rain")}


def settle_pending(cameras, recent, readings):
    """Finish or abandon a swap staged on a previous cycle (make-before-break).

    The outgoing camera keeps serving its (still valid) reading until the incoming
    one actually reports, so the map never shows a hole. `readings` is passed in
    rather than read here so this is testable without touching disk. Returns the
    new camera list, or None if nothing changed.
    """
    retiring = [c for c in cameras if c.get("retiring_since")]
    if not retiring:
        return None

    keep, changed = list(cameras), False

    for out in retiring:
        incoming_id = out.get("replaced_by")
        age = (now_utc() - datetime.fromisoformat(out["retiring_since"])).total_seconds()
        if incoming_id in readings:
            keep = [c for c in keep if c["camera_id"] != out["camera_id"]]
            recent[out["camera_id"]] = now_utc().isoformat()
            log.info("rotation complete: %s retired, %s now reporting",
                     out["camera_id"], incoming_id)
            changed = True
        elif age > PENDING_TIMEOUT_SEC:
            # Reachable but never produced a usable frame -- abandon rather than
            # strand the set one camera oversized forever.
            keep = [c for c in keep if c["camera_id"] != incoming_id]
            for c in keep:
                if c["camera_id"] == out["camera_id"]:
                    c.pop("retiring_since", None); c.pop("replaced_by", None)
            log.warning("rotation abandoned: %s never reported in %.0fmin, keeping %s",
                        incoming_id, age / 60, out["camera_id"])
            changed = True
        else:
            log.info("rotation pending: waiting on %s (%.0fmin)", incoming_id, age / 60)

    return keep if changed else None


def find_replacement(current_cameras, blocklist):
    locations = load_json(LOCATIONS_PATH, [])
    current_ids = {c["camera_id"] for c in current_cameras}
    pool = [r for r in locations if r["lat"] is not None and r["camera_id"] not in current_ids and r["camera_id"] not in blocklist]

    while pool:
        best, best_d = None, -1
        for c in pool:
            d = min(haversine_km(c["lat"], c["lon"], s["lat"], s["lon"]) for s in current_cameras)
            if d > best_d:
                best_d, best = d, c
        pool = [c for c in pool if c["camera_id"] != best["camera_id"]]
        log.info("trying replacement %s (min-dist %.1fkm)", best["camera_id"], best_d)
        if is_live(best["camera_id"]):
            log.info("  -> live, keeping %s", best["camera_id"])
            return {
                "camera_id": best["camera_id"], "title": best.get("title", ""),
                "district": best.get("district") or "", "display_name": best.get("display_name", ""),
                "lat": best["lat"], "lon": best["lon"], "image_path": None,
            }
        log.info("  -> dead, blocklisting %s", best["camera_id"])
        blocklist.append(best["camera_id"])
        time.sleep(0.3)
    return None


def commit(cameras, strikes, blocklist, recent):
    """Persist a changed camera set and make the fetch job pick it up.

    Prunes rain_sample/annotator_state rows for departed cameras so /api/rain-map
    reflects the change immediately rather than waiting on the annotator's next pass.
    A camera that is merely *retiring* is still in `cameras`, so its reading survives.
    """
    current_ids = {c["camera_id"] for c in cameras}

    # Rewrite these two only if they read back cleanly. On a torn read we'd otherwise
    # persist an empty list and wipe every reading; skipping is harmless because the
    # annotator prunes departed cameras on its own next pass anyway.
    try:
        rain_sample = [r for r in load_json_strict(RAIN_SAMPLE_PATH, []) if r["camera_id"] in current_ids]
        state = {k: v for k, v in load_json_strict(ANNOTATOR_STATE_PATH, {}).items() if k in current_ids}
        save_json(RAIN_SAMPLE_PATH, rain_sample)
        save_json(ANNOTATOR_STATE_PATH, state)
    except LoadError as e:
        log.warning("skipping prune this cycle, unreadable mid-write (%s)", e)

    save_json(SAMPLE_CAMERAS_PATH, cameras)
    save_json(STRIKES_PATH, strikes)
    save_json(BLOCKLIST_PATH, blocklist)
    save_json(ROTATION_RECENT_PATH, recent)
    write_fetch_csv(cameras)

    # fetch_jobs.py re-reads the CSV at each lap boundary, so no restart is needed
    # in the normal case -- only kick it if it isn't running at all.
    try:
        status = session.get(f"{APP_BASE_URL}/api/status", timeout=10).json()
        if status.get("status") != "running":
            log.info("fetch job not running, starting it")
            session.post(f"{APP_BASE_URL}/api/jobs/start", timeout=10)
    except Exception as e:
        log.warning("could not check fetch job status: %s", e)


def main():
    log.info("watchdog: checking %s every %ds, replacing after %d consecutive failed checks; "
             "stall detection %s (>= %d identical frames); "
             "rotation %s (spacing >= %.1fkm, drift <= %.1fkm, recent TTL %dh)",
             SAMPLE_CAMERAS_PATH.name, CHECK_INTERVAL_SEC, STRIKE_THRESHOLD,
             "on" if STALL_ENABLED else "off", STALL_FRAMES,
             "on" if ROTATE_ENABLED else "off", MIN_SPACING_KM, MAX_ANCHOR_DRIFT_KM,
             RECENT_TTL_SEC // 3600)

    while True:
        cameras = load_json(SAMPLE_CAMERAS_PATH, [])
        strikes = load_json(STRIKES_PATH, {})
        blocklist = load_json(BLOCKLIST_PATH, [])
        recent = prune_recent(load_json(ROTATION_RECENT_PATH, {}))

        if not cameras:
            time.sleep(CHECK_INTERVAL_SEC)
            continue

        # Finish or abandon a swap staged last cycle before doing anything else.
        settled = settle_pending(cameras, recent, current_readings())
        if settled is not None:
            cameras = settled
            commit(cameras, strikes, blocklist, recent)

        dead_this_round = []
        stalled_this_round = []
        for cam in cameras:
            cid = cam["camera_id"]
            ok = is_live(cid)
            if ok:
                strikes[cid] = 0
                # Reachable but possibly frozen. Judged on the frames already on
                # disk, so this costs no extra request to a service we are trying
                # not to lean on.
                if STALL_ENABLED:
                    run = frozen_run(cid)
                    if run >= STALL_FRAMES:
                        log.warning("%s (%s) serving a frozen picture: last %d frames identical",
                                    cid, cam.get("district", ""), run)
                        stalled_this_round.append(cid)
                    elif run > 1:
                        log.info("%s briefly frozen (%d identical frames), watching", cid, run)
            else:
                strikes[cid] = strikes.get(cid, 0) + 1
                log.warning("%s (%s) failed check, strikes=%d", cid, cam.get("district", ""), strikes[cid])
                if strikes[cid] >= STRIKE_THRESHOLD:
                    dead_this_round.append(cid)
            time.sleep(0.3)

        save_json(STRIKES_PATH, strikes)

        # Stalled cameras join the dead: from here the handling is identical --
        # dropped from the sample, blocklisted so rotation cannot pick them back
        # up, replaced by one live camera, and commit() carries that through
        # sample_cameras.json, the fetch CSV, rain_sample.json and the annotator
        # state in a single pass.
        if stalled_this_round:
            log.warning("replacing frozen feeds (>= %d identical frames): %s",
                        STALL_FRAMES, stalled_this_round)
            dead_this_round.extend(stalled_this_round)

        if dead_this_round:
            log.warning("confirmed dead (>= %d consecutive strikes) or frozen: %s",
                        STRIKE_THRESHOLD, dead_this_round)
            for dead_id in dead_this_round:
                cameras = [c for c in cameras if c["camera_id"] != dead_id]
                blocklist.append(dead_id)
                strikes.pop(dead_id, None)

                replacement = find_replacement(cameras, blocklist)
                if replacement is None:
                    log.error("no live replacement found for %s, sample shrinks by one", dead_id)
                    continue
                cameras.append(replacement)
                log.warning("replaced %s -> %s (%s)", dead_id, replacement["camera_id"], replacement["district"])

                # Re-anchor this slot: the farthest-point pick was deliberate, so the
                # replacement's position becomes the new anchor rather than dragging
                # the old one around.
                slots = [s for s in load_json(SLOTS_PATH, []) if s["camera_id"] != dead_id]
                slots.append({"slot": len(slots), "anchor_lat": replacement["lat"],
                              "anchor_lon": replacement["lon"],
                              "camera_id": replacement["camera_id"]})
                save_json(SLOTS_PATH, slots)

            commit(cameras, strikes, blocklist, recent)

        elif ROTATE_ENABLED and not any(c.get("retiring_since") for c in cameras):
            # Only rotate on a quiet cycle: never two blind slots at once, and only
            # one commit per cycle.
            slots = load_slots(cameras)
            save_json(SLOTS_PATH, slots)
            swap = rotate_one(cameras, slots, blocklist, recent)
            if swap:
                out, incoming = swap
                # Make before break: add the incoming camera now, but keep serving the
                # outgoing one's reading until the incoming actually reports.
                for c in cameras:
                    if c["camera_id"] == out["camera_id"]:
                        c["retiring_since"] = now_utc().isoformat()
                        c["replaced_by"] = incoming["camera_id"]
                cameras = cameras + [incoming]
                log.info("rotation staged: %s -> %s (%s), set temporarily %d",
                         out["camera_id"], incoming["camera_id"],
                         incoming["display_name"][:40], len(cameras))
                commit(cameras, strikes, blocklist, recent)

        time.sleep(CHECK_INTERVAL_SEC)


if __name__ == "__main__":
    main()
