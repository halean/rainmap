"""
Keeps every run of the heavy-rain nowcast that VnExpress shows on its flood map, so it can be
scored against the cameras later (scripts/vne_forecast_eval.py).

Run: .venv/bin/python -u scripts/vne_forecast_logger.py

The feed: VnExpress's 159-flood-point page (vnexpress.net/...-5127780.html) reads
  https://anh-cao-keu-default-rtdb.asia-southeast1.firebasedatabase.app/hymetnet/latest/rain.json
a public-read Firebase copy of HYMETNET's heavy-rain page (hymetnet.gov.vn/rain/), refreshed by
their own server job about once an hour. It holds only the LATEST run -- six "heavy rain points"
frames (+1..+6 h from the run, district-level points) -- so a run not saved while it is current is
gone. Hence a poller, like the radar one.

Started 2026-10-05 at the user's request to see how the forecast does; it is VnExpress's database,
so this stays light: one ~40 KB read every POLL_SEC, and a run is written only when updatedAt
changes (about 24 a day).

Outputs:
  data/derived/vne_forecast/<updatedAt>.json   each run as fetched, plus fetched_at
  data/derived/vne_forecast_points.csv          one row per heavy-rain point per frame
"""

import csv
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.log_setup import get_logger

REPO = Path(__file__).resolve().parents[1]
URL = "https://anh-cao-keu-default-rtdb.asia-southeast1.firebasedatabase.app/hymetnet/latest/rain.json"
RUN_DIR = REPO / "data" / "derived" / "vne_forecast"
POINTS_CSV = REPO / "data" / "derived" / "vne_forecast_points.csv"
POLL_SEC = int(os.getenv("VNE_FORECAST_POLL_SEC", str(15 * 60)))
FIELDS = ["updated_at", "fetched_at", "run_vn", "frame", "lead_h", "valid_utc", "province", "district", "lat", "lon", "rank"]

log = get_logger("vne_forecast")


def lead_hours(time_vn: str):
    """'16:00+03 (VN) 05-10-2026' -> 3; an observed slot ('16:00 (VN) ...') -> 0."""
    head = (time_vn or "").split(" ")[0]
    return int(head.split("+")[1]) if "+" in head else 0


def save_run(payload: dict, fetched_at: str) -> int:
    updated = payload.get("updatedAt") or payload.get("data", {}).get("fetchedAt") or fetched_at
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    (RUN_DIR / f"{updated.replace(':', '')}.json").write_text(
        json.dumps({"fetched_at": fetched_at, **payload}, ensure_ascii=False))
    new = not POINTS_CSV.exists()
    n = 0
    with POINTS_CSV.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if new:
            w.writeheader()
        for fr in payload.get("data", {}).get("stormFrames", []):
            valid = datetime.strptime(fr["timeKey"], "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
            for p in fr.get("points", []):
                lat, lon = float(p["latitude"]), float(p["longitude"])
                if lat > 100 and lon < 30:      # the feed sometimes swaps them
                    lat, lon = lon, lat
                w.writerow({"updated_at": updated, "fetched_at": fetched_at, "run_vn": fr.get("timeVn", ""),
                            "frame": fr.get("frameIndex", ""), "lead_h": lead_hours(fr.get("timeVn", "")),
                            "valid_utc": valid.isoformat(), "province": p.get("province", ""),
                            "district": p.get("district", ""), "lat": lat, "lon": lon, "rank": p.get("rank", "")})
                n += 1
    return n


def main():
    log.info("polling %s every %ds", URL, POLL_SEC)
    seen = {p.stem for p in RUN_DIR.glob("*.json")} if RUN_DIR.exists() else set()
    session = requests.Session()
    while True:
        try:
            r = session.get(URL, timeout=30)
            r.raise_for_status()
            payload = r.json()
            updated = (payload.get("updatedAt") or "").replace(":", "")
            if updated and updated not in seen:
                n = save_run(payload, datetime.now(timezone.utc).isoformat())
                seen.add(updated)
                log.info("new run %s: %d heavy-rain points", payload.get("updatedAt"), n)
        except Exception as e:                        # a missed poll costs nothing; the next one retries
            log.warning("poll failed: %s", str(e)[:300])
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
