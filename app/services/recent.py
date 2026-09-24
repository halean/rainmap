"""The per-camera "recent readings" index: the last few classified frames of
each camera, one small JSON file per camera under data/derived/recent/.

Why it exists: the request-time alternative is scanning rain_history.csv --
an append-only log that is already 3+ MB and grows every day -- to find one
camera's last dozen rows, which costs a third of a second per popup and
gets worse with the archive. This index is constant-size per camera and is
written by the one process that knows a reading just happened.

Ownership:
- Writer: scripts/rain_annotator.py, and only it. It writes each camera's
  file right after appending the history row for the same reading. Its
  worker pool never hands the same camera to two workers in one pass, so
  per-camera files need no lock. The watchdog rotates cameras in and out of
  the sample but never produces a reading, and must not write here.
- Readers: app/routes.py (later), and the retention job, which must read
  these to know which frames are still referenced.
- Atomicity: every write goes through write_json_atomic (temp file in the
  same directory, fsync, os.replace), so a concurrent reader sees the old
  file or the new one, never a torn one. That is a filesystem guarantee,
  not cooperation between processes.

The CSV stays the archive for analysis; it just stops being read per request.
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from app.atomic_write import write_json_atomic

RECENT_DIR = Path("data/derived/recent")
RECENT_LIMIT = 12
# Camera ids are 24 hex characters (MongoDB-style object ids from the city's
# camera site). Anything else must never become a filename.
CAMERA_ID_RE = re.compile(r"^[0-9a-f]{24}$")
IMAGE_STAMP_RE = re.compile(r"^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})")


class BadCameraId(ValueError):
    pass


def recent_path(camera_id: str, base: Path = RECENT_DIR) -> Path:
    if not CAMERA_ID_RE.match(camera_id or ""):
        raise BadCameraId(f"not a camera id: {camera_id!r}")
    return Path(base) / f"{camera_id}.json"


def entry_from_row(camera_id: str, image: str, rain: str, justification: str, recorded_at: str) -> dict:
    """One index entry from the fields a history row carries. `image` is the
    frame's basename (YYYYMMDD_HHMMSS.jpg); its timestamp is the capture
    time, and its path under data/raw is reconstructed from it."""
    image = (image or "").strip()
    m = IMAGE_STAMP_RE.match(image)
    if m:
        y, mo, d, h, mi, s = m.groups()
        captured_at = f"{y}-{mo}-{d}T{h}:{mi}:{s}Z"
        image_url = f"/media/data/raw/{camera_id}/{y}/{mo}/{d}/{image}"
    else:
        captured_at, image_url = None, None
    return {
        "captured_at": captured_at,
        "rain": rain,
        "justification": justification,
        "image_url": image_url,
        "image": image or None,
        "recorded_at": recorded_at or None,
    }


def entry_from_record(rec: dict) -> dict:
    """The same entry, from the record the annotator builds for a reading."""
    return entry_from_row(
        rec.get("camera_id", ""),
        Path(rec.get("image_url", "")).name,
        rec.get("rain", ""),
        rec.get("justification", ""),
        rec.get("updated_at", ""),
    )


def load_recent(camera_id: str, base: Path = RECENT_DIR) -> list[dict]:
    """Most-recent-first entries, or [] when there is no file yet or it is
    unreadable -- absence is the normal state for a camera never annotated."""
    path = recent_path(camera_id, base)  # a bad id raises; only unreadable files are tolerated below
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    entries = data.get("entries") if isinstance(data, dict) else None
    return entries if isinstance(entries, list) else []


def merge_entries(existing: list[dict], new: list[dict], limit: int = RECENT_LIMIT) -> list[dict]:
    """Combine entries, one per frame (the newest record for a frame wins),
    most-recent-first by capture time, trimmed to `limit`. Entries without a
    parseable frame stamp sort last and are the first trimmed."""
    by_image: dict = {}
    for e in list(existing) + list(new):
        key = e.get("image") or e.get("image_url") or id(e)
        by_image[key] = e
    ordered = sorted(by_image.values(), key=lambda e: (e.get("captured_at") or ""), reverse=True)
    return ordered[:limit]


def record_reading(rec: dict, base: Path = RECENT_DIR, limit: int = RECENT_LIMIT) -> Path:
    """Fold one reading into its camera's file. Safe to call twice for the
    same frame (it replaces rather than duplicates), so a restart that
    re-processes a frame cannot corrupt the index."""
    camera_id = rec.get("camera_id", "")
    path = recent_path(camera_id, base)
    entries = merge_entries(load_recent(camera_id, base), [entry_from_record(rec)], limit)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(path, {
        "camera_id": camera_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "entries": entries,
    })
    return path


def write_recent(camera_id: str, entries: list[dict], base: Path = RECENT_DIR, limit: int = RECENT_LIMIT) -> Path:
    """Replace a camera's file outright (the backfill uses this)."""
    path = recent_path(camera_id, base)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(path, {
        "camera_id": camera_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "entries": merge_entries([], entries, limit),
    })
    return path
