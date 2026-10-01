"""
Archives the Nha Be weather radar (HYMETNET) and what it shows at every camera.

Run: .venv/bin/python -u scripts/radar_poller.py

HYMETNET publishes a frame every 10 minutes (app/services/radar_nhb.py has the endpoints) but keeps
only ~2 hours online, so anything not saved now is gone. The rain-fusion classifier needs the radar
at each camera at the moment of every frame Gemma reads, over weeks of storms, to learn when to trust
it -- hence an archive, started before there is anything to train.

Every 10 minutes: fetch every frame online that is not yet saved (so a restart backfills ~2 hours),
keep the raw PNG, and for every camera in data/derived/camera_locations.json record the strongest
echo (dBZ, column maximum) within 1, 2 and 5 km, and the share of the 2 km disc at >= 20 dBZ.

Outputs:
  data/derived/radar_archive/YYYYMMDD/NHB_YYYYMMDDHHMM.png   raw frames, ~76 KB each (~11 MB a day)
  data/derived/radar_cameras.csv                             one row per frame per camera
dBZ reads as: none -- no echo drawn (clear); 0 -- below 10 dBZ; 10/15 -- mostly clutter or cloud;
20+ light rain; 30+ moderate; 40+ heavy (radar_nhb's classes).
"""

import csv
import json
import math
import sys
import time
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import numpy as np
import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.log_setup import get_logger
from app.services import radar_nhb as r

REPO = Path(__file__).resolve().parents[1]
ARCHIVE = REPO / "data" / "derived" / "radar_archive"
CAMERAS_CSV = REPO / "data" / "derived" / "radar_cameras.csv"
CAMERA_LOCATIONS = REPO / "data" / "derived" / "camera_locations.json"
INTERVAL_SEC = 600
RADII_KM = (1, 2, 5)
FIELDS = ["stamp", "camera_id", "dbz_1km", "dbz_2km", "dbz_5km", "rain_share_2km"]

log = get_logger("radar_poller")

# Packed RGB -> dBZ (band floor); anything not in the legend reads as no echo.
_LUT = {(c[0] << 16) | (c[1] << 8) | c[2]: v for c, v in r.LEGEND.items()}


def decode(png: bytes) -> np.ndarray:
    """Frame -> dBZ grid: float, NaN where no echo is drawn."""
    a = np.asarray(Image.open(BytesIO(png)).convert("RGBA"))
    packed = (a[..., 0].astype(np.int64) << 16) | (a[..., 1].astype(np.int64) << 8) | a[..., 2]
    out = np.full(packed.shape, np.nan, dtype=np.float32)
    for code, v in _LUT.items():
        out[(packed == code) & (a[..., 3] > 0)] = v
    return out


def camera_features(dbz: np.ndarray, cams: list[dict]) -> list[dict]:
    (s, w), (n, e) = r.IMAGE_BOUNDS
    h, wd = dbz.shape
    km_x = (e - w) * 111.32 * math.cos(math.radians(10.8)) / wd
    km_y = (n - s) * 111.32 / h
    rows = []
    for c in cams:
        x, y = (c["lon"] - w) / (e - w) * wd, (n - c["lat"]) / (n - s) * h
        rec = {"camera_id": c["camera_id"]}
        for rk in RADII_KM:
            rx, ry = int(rk / km_x) + 1, int(rk / km_y) + 1
            x0, x1, y0, y1 = max(int(x) - rx, 0), min(int(x) + rx + 1, wd), max(int(y) - ry, 0), min(int(y) + ry + 1, h)
            win = dbz[y0:y1, x0:x1]
            yy, xx = np.mgrid[y0:y1, x0:x1]
            disc = ((xx - x) * km_x) ** 2 + ((yy - y) * km_y) ** 2 <= rk * rk
            vals = win[disc]
            vals = vals[~np.isnan(vals)]
            rec[f"dbz_{rk}km"] = float(vals.max()) if vals.size else ""
            if rk == 2:
                rec["rain_share_2km"] = round(float((win[disc] >= 20).sum()) / max(int(disc.sum()), 1), 3)
        rows.append(rec)
    return rows


def saved(stamp: str) -> Path:
    return ARCHIVE / stamp[:8] / f"NHB_{stamp}.png"


def poll_once(session: requests.Session, cams: list[dict]) -> int:
    new = 0
    for stamp in sorted(r.available_frames()):  # oldest first, so the CSV stays in time order
        p = saved(stamp)
        if p.exists():
            continue
        png = session.get(r.FRAME_URL.format(station=r.STATION, day=stamp[:8], stamp=stamp), timeout=r.TIMEOUT_SEC)
        png.raise_for_status()
        rows = camera_features(decode(png.content), cams)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(png.content)  # after decoding: a frame on disk is a frame whose rows were written
        write_header = not CAMERAS_CSV.exists()
        with CAMERAS_CSV.open("a", newline="") as f:
            wr = csv.DictWriter(f, fieldnames=FIELDS)
            if write_header:
                wr.writeheader()
            for row in rows:
                wr.writerow({"stamp": stamp, **row})
        new += 1
    return new


def main():
    cams = [c for c in json.loads(CAMERA_LOCATIONS.read_text()) if c.get("lat") is not None]
    log.info("radar poller starting: every %ds, %d cameras -> %s", INTERVAL_SEC, len(cams), ARCHIVE)
    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0"
    while True:
        try:
            n = poll_once(session, cams)
            if n:
                log.info("saved %d new frame(s)", n)
        except Exception as e:
            # A missed poll costs nothing while HYMETNET keeps two hours online.
            log.warning("poll failed: %s", e)
        time.sleep(INTERVAL_SEC)


if __name__ == "__main__":
    main()
