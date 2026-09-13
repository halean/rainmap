"""
One-off burst capture of the full camera fleet's CURRENT frames, for building a
labeled test set. Run when rain is actually happening somewhere in the city --
HCMC storms are short and localized (see rain_annotator.py's own prompt notes),
so waiting for the regular paced sweep (one lap per 5 min across only 41 cameras)
would miss it or catch it too late.

Deliberately decouples capture from classification: downloading 753 images takes
a few minutes, but classifying them through Gemma at ~18s/call would take ~2
hours even with 2 workers -- by which point the storm has passed. The image
content is fixed at capture time regardless of when it's labeled, so we grab
everything now and classify later (with Gemma, GPT-6 Astra, Gemini, whatever) at
whatever pace is convenient.
"""
import csv
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.log_setup import get_logger

REPO = Path(__file__).resolve().parents[1]
LOCATIONS_PATH = REPO / "data" / "derived" / "camera_locations.json"
SNAPSHOT_ROOT = REPO / "data" / "test_sets"

BASE_IMG = "https://giaothong.hochiminhcity.gov.vn/render/ImageHandler.ashx"
OFFLINE_THRESHOLD = 5 * 1024
FETCH_TIMEOUT = 20
FETCH_DELAY_SEC = 0.25  # sequential and polite -- concurrency previously caused false failures on this site

log = get_logger("storm_snapshot")


def main():
    locations = json.loads(LOCATIONS_PATH.read_text())
    live = [l for l in locations if l.get("lat") is not None and l.get("cam_status") != "NOT_IMAGE"]
    log.info("storm snapshot: capturing %d cameras (of %d total)", len(live), len(locations))

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = SNAPSHOT_ROOT / stamp
    out_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"})

    manifest_path = out_dir / "manifest.csv"
    fields = ["camera_id", "district", "title", "display_name", "lat", "lon",
              "captured_at", "image_file", "size_bytes", "online", "error"]
    online_count = 0

    with manifest_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for i, cam in enumerate(live):
            cid = cam["camera_id"]
            row = {"camera_id": cid, "district": cam.get("district") or "",
                   "title": cam.get("title", ""), "display_name": cam.get("display_name", ""),
                   "lat": cam["lat"], "lon": cam["lon"],
                   "captured_at": datetime.now(timezone.utc).isoformat(),
                   "image_file": "", "size_bytes": 0, "online": False, "error": ""}
            try:
                resp = session.get(f"{BASE_IMG}?id={cid}", timeout=FETCH_TIMEOUT)
                ctype = resp.headers.get("Content-Type", "")
                if resp.status_code != 200 or "text" in ctype.lower():
                    row["error"] = f"HTTP {resp.status_code} {ctype}"
                else:
                    size = len(resp.content)
                    row["size_bytes"] = size
                    if size >= OFFLINE_THRESHOLD:
                        fname = f"{cid}.jpg"
                        (out_dir / fname).write_bytes(resp.content)
                        row["image_file"] = fname
                        row["online"] = True
                        online_count += 1
                    else:
                        row["error"] = "offline placeholder"
            except Exception as e:
                row["error"] = str(e)

            writer.writerow(row)
            if (i + 1) % 100 == 0:
                f.flush()
                log.info("  %d/%d captured (%d online so far)", i + 1, len(live), online_count)

            time.sleep(FETCH_DELAY_SEC)

    log.info("storm snapshot complete: %d/%d online, saved to %s", online_count, len(live), out_dir)
    print(str(out_dir))


if __name__ == "__main__":
    main()
