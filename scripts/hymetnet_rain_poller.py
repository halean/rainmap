"""
Archives HYMETNET's hourly rain maps (hymetnet.gov.vn/rain/) and what each one says at every camera,
so the forecast can be tested as an input to the rain call.

Run: .venv/bin/python -u scripts/hymetnet_rain_poller.py

The page shows 12 hourly frames: six measured estimates (the run hour and the five before it) and six
forecasts (+1..+6 h). Each frame is one image,
    /dataout_web/COM/<YYYYMMDD>/COM_<YYYYMMDDHHmm UTC>_QPEJPA.png      2310 x 2310 RGBA
laid by the page's Leaflet map over [[8, 101], [24, 112]] -- i.e. stretched in Web Mercator, which
is how it lines up with the cameras (checked on 5 Oct 19:00 and 20:00 VN: AUC 0.82 / 0.81 against
camera rain with Mercator rows, worse with latitude-linear rows). Eight colours, in mm/h:
    white <1 | light blue 1-5 | blue 5-10 | dark blue 10-20 | yellow 20-30 | orange 30-50 |
    red 50-80 | purple >80        (legend: hymetnet.gov.vn/images/rain.jpg)

The URL depends only on the valid time, so the file at one URL is overwritten every run: the +6 h
forecast, then each newer forecast, finally the measured estimate. A forecast exists only if it was
saved while current -- hence this poller. It reads the page every POLL_SEC and downloads the twelve
frames only when the run changes (about 13 requests an hour).

Outputs:
  data/derived/hymetnet_rain/<run UTC>/<valid UTC>_<lead>.png   crop over HCMC (CROP box)
  data/derived/hymetnet_rain_cameras.csv                        per run x frame x camera:
      run_utc, lead_h (0 or less = measured), valid_utc, camera_id, mmh_point, mmh_1500m
"""

import csv
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

import numpy as np
import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.log_setup import get_logger

REPO = Path(__file__).resolve().parents[1]
PAGE = "http://hymetnet.gov.vn/rain/"
IMG = "http://hymetnet.gov.vn/dataout_web/COM/{day}/COM_{key}_QPEJPA.png"
ARCHIVE = REPO / "data" / "derived" / "hymetnet_rain"
CAMERAS_CSV = REPO / "data" / "derived" / "hymetnet_rain_cameras.csv"
CAMERA_LOCATIONS = REPO / "data" / "derived" / "camera_locations.json"
STATE = ARCHIVE / "last_run.txt"
POLL_SEC = int(os.getenv("HYMETNET_RAIN_POLL_SEC", str(10 * 60)))
BOUNDS = (8.0, 24.0, 101.0, 112.0)                 # lat0, lat1, lon0, lon1 of the image overlay
CROP = (10.3, 11.4, 106.2, 107.1)                  # lat0, lat1, lon0, lon1 kept on disk
RADIUS_PX = 3                                      # ~0.5 km a pixel here, so ~1.5 km
PALETTE = {(255, 255, 255): 0.5, (160, 210, 255): 3.0, (27, 140, 255): 7.5, (0, 53, 255): 15.0,
           (255, 245, 0): 25.0, (255, 153, 0): 40.0, (255, 0, 0): 65.0, (180, 0, 104): 90.0}
FIELDS = ["run_utc", "lead_h", "valid_utc", "camera_id", "mmh_point", "mmh_1500m"]

log = get_logger("hymetnet_rain")


def merc(lat):
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def to_px(lat, lon, h, w):
    lat0, lat1, lon0, lon1 = BOUNDS
    y = (merc(lat1) - merc(lat)) / (merc(lat1) - merc(lat0)) * h
    x = (lon - lon0) / (lon1 - lon0) * w
    return int(y), int(x)


def decode(png: bytes) -> np.ndarray:
    """mm/h grid (class midpoints); 0 where nothing is drawn."""
    a = np.asarray(Image.open(BytesIO(png)).convert("RGBA"))
    g = np.zeros(a.shape[:2], dtype=np.float32)
    drawn = a[..., 3] > 0
    for (r, gg, b), v in PALETTE.items():
        g[drawn & (a[..., 0] == r) & (a[..., 1] == gg) & (a[..., 2] == b)] = v
    return g


def parse_page(html: str):
    """[(valid_key, lead_h)] in page order, and the run's base label ('05:00 (VN) 06-10-2026')."""
    keys = dict(re.findall(r'tentimesett\[(\d+)\] = "(\d{12})"', html))
    labels = dict(re.findall(r'tentimesettvn\[(\d+)\] = "([^"]+)"', html))
    frames = []
    for i, k in keys.items():
        lab = labels.get(i, "")
        lead = int(lab.split(" ")[0].split("+")[1]) if "+" in lab.split(" ")[0] else None
        frames.append((k, lead, lab))
    base = next((lab for _, lead, lab in frames if lead is None), "")
    # measured frames: lead 0 for the run hour, negative for the hours before it
    run_key = max(k for k, lead, _ in frames if lead is None)
    run_t = datetime.strptime(run_key, "%Y%m%d%H%M")
    out = []
    for k, lead, _ in frames:
        if lead is None:
            lead = int((datetime.strptime(k, "%Y%m%d%H%M") - run_t).total_seconds() // 3600)
        out.append((k, lead))
    return sorted(out), run_key


def main():
    cams = [c for c in json.loads(CAMERA_LOCATIONS.read_text()) if c.get("lat")]
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    last = STATE.read_text().strip() if STATE.exists() else ""
    s = requests.Session()
    s.headers["User-Agent"] = "Mozilla/5.0"
    log.info("polling %s every %ds; %d cameras", PAGE, POLL_SEC, len(cams))
    while True:
        try:
            frames, run_key = parse_page(s.get(PAGE, timeout=30).text)
            if run_key != last:
                rows, run_dir = [], ARCHIVE / run_key
                run_dir.mkdir(exist_ok=True)
                for key, lead in frames:
                    r = s.get(IMG.format(day=key[:8], key=key), timeout=60)
                    r.raise_for_status()
                    g = decode(r.content)
                    h, w = g.shape
                    y0, x0 = to_px(CROP[1], CROP[2], h, w)
                    y1, x1 = to_px(CROP[0], CROP[3], h, w)
                    Image.open(BytesIO(r.content)).crop((x0, y0, x1, y1)).save(run_dir / f"{key}_{lead:+d}.png")
                    valid = datetime.strptime(key, "%Y%m%d%H%M").replace(tzinfo=timezone.utc).isoformat()
                    for c in cams:
                        y, x = to_px(c["lat"], c["lon"], h, w)
                        if not (0 <= y < h and 0 <= x < w):
                            continue
                        box = g[max(0, y - RADIUS_PX):y + RADIUS_PX + 1, max(0, x - RADIUS_PX):x + RADIUS_PX + 1]
                        rows.append({"run_utc": run_key, "lead_h": lead, "valid_utc": valid, "camera_id": c["camera_id"],
                                     "mmh_point": float(g[y, x]), "mmh_1500m": float(box.max())})
                new = not CAMERAS_CSV.exists()
                with CAMERAS_CSV.open("a", newline="") as f:
                    wr = csv.DictWriter(f, fieldnames=FIELDS)
                    if new:
                        wr.writeheader()
                    wr.writerows(rows)
                STATE.write_text(run_key)
                last = run_key
                hcm = sum(1 for r in rows if r["lead_h"] == 1 and r["mmh_1500m"] >= 1)
                log.info("run %s: %d frames, %d camera rows; %d cameras with >=1 mm/h forecast at +1 h",
                         run_key, len(frames), len(rows), hcm)
        except Exception as e:
            log.warning("poll failed: %s", str(e)[:300])
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
