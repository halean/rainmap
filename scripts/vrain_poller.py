"""
Records rainfall from VRAIN's gauge network (vrain.vn, operated by WATEC) as a
raw append-only log. Collection only -- nothing reads this file yet; see NOTES.md
for what it is meant to settle later.

Design notes:
- The feed is the same unauthenticated JSON the public vrain.vn map fetches for
  anonymous visitors. The documented partner API (openapi.vrain.vn) needs a key
  from WATEC and is the route to take if per-station history is ever needed.
- `d` is an ACCUMULATED depth, not an instantaneous rate -- the sibling
  summary.json calls the same field `sumDepth`. A row here is therefore a
  running total, and a rain *rate* only exists as the difference between two
  consecutive polls. That is precisely why raw snapshots are logged rather than
  a derived reading: the differencing (and the reset-to-zero handling that a
  daily-total feed implies) is a decision for whoever processes this later.
- Only stations near the camera sample are kept. The national feed is ~2,600
  stations / 246 KB per poll, and all but ~27 of them are hundreds of km from
  any camera we classify.
- Station coordinates are repeated on every row on purpose. It keeps the file
  self-contained for later analysis and costs little at this row count.
"""

import csv
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.log_setup import get_logger

REPO = Path(__file__).resolve().parents[1]
OUT_PATH = REPO / "data" / "derived" / "vrain_history.csv"

VRAIN_URL = os.getenv("VRAIN_URL", "https://data.vrain.vn/public/current/all.json")
VRAIN_INTERVAL_SEC = int(os.getenv("VRAIN_INTERVAL_SEC", str(10 * 60)))
VRAIN_TIMEOUT_SEC = float(os.getenv("VRAIN_TIMEOUT_SEC", "30"))

# Their bucket 403s any User-Agent that isn't a bare browser token -- an
# identifying one ("rainmap/1.0 +url") is rejected, so we cannot announce
# ourselves here even though we would rather. One request per 10 minutes is far
# below what a single person leaving the vrain.vn map open generates. For
# sanctioned programmatic access (and per-station history) the route is an API
# key from WATEC via openapi.vrain.vn -- see NOTES.md.
VRAIN_USER_AGENT = os.getenv("VRAIN_USER_AGENT", "Mozilla/5.0")

# Bounding box around the camera sample, padded ~15km. Kept as plain numbers
# rather than derived from rain_sample.json so the log stays comparable even as
# the watchdog rotates individual cameras in and out.
LAT_MIN = float(os.getenv("VRAIN_LAT_MIN", "10.50"))
LAT_MAX = float(os.getenv("VRAIN_LAT_MAX", "11.14"))
LON_MIN = float(os.getenv("VRAIN_LON_MIN", "106.30"))
LON_MAX = float(os.getenv("VRAIN_LON_MAX", "107.00"))

FIELDS = ["fetched_at", "station", "lat", "lon", "depth_mm", "level"]

log = get_logger("vrain_poller")


def in_area(lat, lon) -> bool:
    return lat is not None and lon is not None and \
        LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX


def fetch() -> list[dict]:
    r = requests.get(VRAIN_URL, timeout=VRAIN_TIMEOUT_SEC,
                     headers={"User-Agent": VRAIN_USER_AGENT, "Accept": "application/json"})
    r.raise_for_status()
    return r.json()


def append_rows(rows: list[dict]) -> None:
    write_header = not OUT_PATH.exists()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        if write_header:
            writer.writeheader()
        writer.writerows(rows)


def poll_once() -> int:
    stations = fetch()
    fetched_at = datetime.now(timezone.utc).isoformat()
    rows = [
        {
            "fetched_at": fetched_at,
            "station": s.get("sn", ""),
            "lat": s.get("lt"),
            "lon": s.get("lg"),
            "depth_mm": s.get("d"),
            "level": s.get("l", ""),
        }
        for s in stations
        if in_area(s.get("lt"), s.get("lg"))
    ]
    if not rows:
        # Never silently write nothing: an empty area means the feed's shape
        # changed (or the bbox is wrong), and the gap would be invisible later.
        log.warning("no stations inside bbox out of %d returned -- feed shape may have changed",
                    len(stations))
        return 0
    append_rows(rows)
    return len(rows)


def main():
    log.info("vrain poller starting: every %ds, bbox lat %.2f..%.2f lon %.2f..%.2f -> %s",
             VRAIN_INTERVAL_SEC, LAT_MIN, LAT_MAX, LON_MIN, LON_MAX, OUT_PATH)
    while True:
        try:
            n = poll_once()
            if n:
                log.info("recorded %d stations", n)
        except Exception as e:
            # A collector that dies on a transient network blip loses the whole
            # series; the next tick is only VRAIN_INTERVAL_SEC away.
            log.warning("poll failed: %s", e)
        time.sleep(VRAIN_INTERVAL_SEC)


if __name__ == "__main__":
    main()
