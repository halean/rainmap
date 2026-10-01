"""Live street floods for the map: the cameras scripts/flood_watch.py is watching right now.

Ownership:
- Writer: scripts/flood_watch.py, and only it. It keeps each camera's mode ('sweep' or
  'watch'), when the watch began, the deepest water seen, and the latest read with its frame,
  and saves the whole file through write_json_atomic, so a reader sees the old file or the
  new one, never a torn one.
- Reader: this module, for GET /api/rain-map/floods. It never writes.

Only cameras under watch are returned. A watch is a flood the model has seen and that has
not yet had three reads in a row with the lanes clear; a camera that has gone back to the
sweep is not a flood any more, whatever it once was.

A watch can outlive its evidence: when the camera site stops answering, or one camera keeps
re-serving the same frame (Pham Van Chieu - Duong so 59 did, on 1 Oct, with a frame three
hours old), no new read arrives and the watch stays open. Those are flagged 'stale' rather
than dropped, so the map can say "flooded when last seen" instead of claiming it is still
flooded now or pretending it never was.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

STATE_PATH = Path("data/derived/flood_watch_state.json")
CAMERAS_PATH = Path("data/metadata/flood_cameras.json")
# Watched cameras are read every minute; a quarter of an hour without one means the site or
# the camera has stopped giving us frames.
STALE_MINUTES = 15
DEPTH_ORDER = ["none", "edge puddles", "shallow sheet", "flooded", "deep"]


def _load(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def _frame_url(frame: str | None) -> str | None:
    # Frames are stored repo-relative (data/flood_watch/frames/...), and the app serves the
    # repo root under /media. An absolute path (FLOOD_FRAMES_ROOT set elsewhere) is not
    # servable, and is left out rather than turned into a broken link.
    if not frame or frame.startswith("/"):
        return None
    return "/media/" + frame


def _parse(ts: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(ts) if ts else None
    except ValueError:
        return None


def live_floods(state_path: Path = STATE_PATH, cameras_path: Path = CAMERAS_PATH,
                now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    state = _load(state_path, None)
    cameras = {c["camera_id"]: c for c in _load(cameras_path, {}).get("cameras", [])}
    if state is None:
        return {"floods": [], "watched_cameras": len(cameras), "collector": "missing",
                "generated_at": now.isoformat()}

    floods = []
    for cid, st in state.get("cameras", {}).items():
        cam = cameras.get(cid)
        if st.get("mode") != "watch" or cam is None:
            continue
        since = _parse(st.get("watch_since"))
        last = st.get("last_read") or {}
        last_at = _parse(last.get("read_at")) or since
        age_min = (now - last_at).total_seconds() / 60 if last_at else None
        floods.append({
            "camera_id": cid,
            "name": cam["name"],
            "lat": cam["lat"],
            "lon": cam["lon"],
            "since": st.get("watch_since"),
            "minutes": round((now - since).total_seconds() / 60) if since else None,
            "peak_depth": st.get("peak"),
            "reads": st.get("reads", 0),
            "latest": {
                "read_at": last.get("read_at") or st.get("watch_since"),
                "depth": last.get("depth") or st.get("peak"),
                "usable": last.get("usable", True),
                "justification": last.get("justification", ""),
                "image_url": _frame_url(last.get("frame") or st.get("first_frame")),
            },
            "first_image_url": _frame_url(st.get("first_frame")),
            "stale": age_min is None or age_min > STALE_MINUTES,
            "minutes_since_read": round(age_min) if age_min is not None else None,
        })
    # Deepest and freshest first, so a list view leads with what matters.
    floods.sort(key=lambda f: (f["stale"], -DEPTH_ORDER.index(f["peak_depth"])
                               if f["peak_depth"] in DEPTH_ORDER else 0, f["since"] or ""))
    return {"floods": floods, "watched_cameras": len(cameras), "collector": "ok",
            "generated_at": now.isoformat()}
