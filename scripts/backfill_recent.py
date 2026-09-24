"""One-off: build data/derived/recent/<camera_id>.json for every camera in
rain_history.csv from the log's last rows per camera.

Run once before the annotator starts writing the index live, so history
exists on day one; safe to re-run at any time (each file is replaced
atomically with the same content the log implies). Reads the log in one
pass and writes one file per camera; nothing else is touched.

    .venv/bin/python scripts/backfill_recent.py [--history PATH] [--out DIR] [--limit 12]
"""

import argparse
import csv
import sys
from collections import defaultdict, deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.recent import RECENT_DIR, RECENT_LIMIT, BadCameraId, entry_from_row, write_recent

REPO = Path(__file__).resolve().parents[1]


def backfill(history: Path, out: Path, limit: int) -> dict:
    per_camera: dict[str, deque] = defaultdict(lambda: deque(maxlen=limit * 2))  # slack: dedupe by frame below
    rows = 0
    with history.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows += 1
            camera_id = (row.get("camera_id") or "").strip()
            if not camera_id:
                continue
            per_camera[camera_id].append(entry_from_row(
                camera_id, row.get("image", ""), row.get("rain", ""), row.get("justification", ""), row.get("timestamp", ""),
            ))
    written, skipped = 0, []
    for camera_id, entries in per_camera.items():
        try:
            write_recent(camera_id, list(entries), out, limit)
            written += 1
        except BadCameraId:
            skipped.append(camera_id)
    return {"rows": rows, "cameras": len(per_camera), "written": written, "skipped": skipped}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", type=Path, default=REPO / "data" / "derived" / "rain_history.csv")
    parser.add_argument("--out", type=Path, default=REPO / RECENT_DIR)
    parser.add_argument("--limit", type=int, default=RECENT_LIMIT)
    args = parser.parse_args()
    result = backfill(args.history, args.out, args.limit)
    print(f"read {result['rows']} rows for {result['cameras']} cameras; wrote {result['written']} files to {args.out}"
          + (f"; skipped {len(result['skipped'])} with malformed ids: {result['skipped'][:5]}" if result["skipped"] else ""))


if __name__ == "__main__":
    main()
