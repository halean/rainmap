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
"""

import csv
import json
import math
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.log_setup import get_logger

REPO = Path(__file__).resolve().parents[1]
SAMPLE_CAMERAS_PATH = REPO / "data" / "derived" / "sample_cameras.json"
LOCATIONS_PATH = REPO / "data" / "derived" / "camera_locations.json"
RAIN_SAMPLE_PATH = REPO / "data" / "derived" / "rain_sample.json"
ANNOTATOR_STATE_PATH = REPO / "data" / "derived" / "annotator_state.json"
FETCH_CSV_PATH = REPO / "data" / "metadata" / "cameras_sample40.csv"
STRIKES_PATH = REPO / "data" / "derived" / "watchdog_strikes.json"
BLOCKLIST_PATH = REPO / "data" / "derived" / "watchdog_blocklist.json"

BASE_IMG = "https://giaothong.hochiminhcity.gov.vn/render/ImageHandler.ashx"
OFFLINE_THRESHOLD = 5 * 1024
CHECK_TIMEOUT = 25

CHECK_INTERVAL_SEC = 20 * 60   # health-check cadence
STRIKE_THRESHOLD = 3            # consecutive failed cycles before replacing (~1hr at 20min cadence)
APP_BASE_URL = "http://127.0.0.1:8000"

log = get_logger("watchdog")

session = requests.Session()
session.headers.update({"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"})


def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            return default
    return default


def save_json(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))


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


def write_fetch_csv(cameras):
    with FETCH_CSV_PATH.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Prop_CamId"])
        for c in cameras:
            w.writerow([c["camera_id"]])


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


def main():
    log.info("watchdog: checking %s every %ds, replacing after %d consecutive failed checks",
             SAMPLE_CAMERAS_PATH.name, CHECK_INTERVAL_SEC, STRIKE_THRESHOLD)

    while True:
        cameras = load_json(SAMPLE_CAMERAS_PATH, [])
        strikes = load_json(STRIKES_PATH, {})
        blocklist = load_json(BLOCKLIST_PATH, [])

        if not cameras:
            time.sleep(CHECK_INTERVAL_SEC)
            continue

        dead_this_round = []
        for cam in cameras:
            cid = cam["camera_id"]
            ok = is_live(cid)
            if ok:
                strikes[cid] = 0
            else:
                strikes[cid] = strikes.get(cid, 0) + 1
                log.warning("%s (%s) failed check, strikes=%d", cid, cam.get("district", ""), strikes[cid])
                if strikes[cid] >= STRIKE_THRESHOLD:
                    dead_this_round.append(cid)
            time.sleep(0.3)

        save_json(STRIKES_PATH, strikes)

        if dead_this_round:
            log.warning("confirmed dead (>= %d consecutive strikes): %s", STRIKE_THRESHOLD, dead_this_round)
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

            # drop stale rain_sample/annotator_state rows for cameras no longer in the set
            # (rain_annotator.py also does this on its own reload, but do it here too so
            # /api/rain-map reflects the swap immediately rather than waiting up to 60s)
            current_ids = {c["camera_id"] for c in cameras}
            rain_sample = [r for r in load_json(RAIN_SAMPLE_PATH, []) if r["camera_id"] in current_ids]
            annotator_state = {k: v for k, v in load_json(ANNOTATOR_STATE_PATH, {}).items() if k in current_ids}
            save_json(RAIN_SAMPLE_PATH, rain_sample)
            save_json(ANNOTATOR_STATE_PATH, annotator_state)

            save_json(SAMPLE_CAMERAS_PATH, cameras)
            save_json(STRIKES_PATH, strikes)
            save_json(BLOCKLIST_PATH, blocklist)
            write_fetch_csv(cameras)
            restart_fetch_job()

        time.sleep(CHECK_INTERVAL_SEC)


if __name__ == "__main__":
    main()
