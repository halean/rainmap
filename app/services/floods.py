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
import math
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

STATE_PATH = Path("data/derived/flood_watch_state.json")
RAIN_SAMPLE_PATH = Path("data/derived/rain_sample.json")
# A flood-prone spot is flagged when it is raining around it AND the Saigon River (Phu An,
# Hon Dau datum) is at least this high: drains empty into a river that cannot take them. 1.3 m is
# just under alert I (1.40); one number to tune once the flood watch has confirmed some floods.
ALERT_TIDE_M = float(os.getenv("FLOOD_ALERT_TIDE_M", "1.3"))

# "Rain around": the rain map's cameras are spaced 3-4 km apart, so 6 km takes in the two to
# five nearest. A reading older than 30 minutes is a different weather situation. With fewer
# than two fresh neighbours there is no evidence either way. Shared with scripts/flood_watch.py.
NEIGHBOUR_KM = float(os.getenv("FLOOD_NEIGHBOUR_KM", "6"))
NEIGHBOUR_MAX = int(os.getenv("FLOOD_NEIGHBOUR_MAX", "5"))
NEIGHBOUR_MIN = int(os.getenv("FLOOD_NEIGHBOUR_MIN", "2"))
NEIGHBOUR_FRESH_MIN = float(os.getenv("FLOOD_NEIGHBOUR_FRESH_MIN", "30"))


def km(lat1, lon1, lat2, lon2) -> float:
    dy = (lat2 - lat1) * 111.0
    dx = (lon2 - lon1) * 111.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def _reading_time(rec: dict) -> datetime | None:
    for key in ("captured_at", "updated_at"):
        try:
            return datetime.fromisoformat(rec[key])
        except (KeyError, TypeError, ValueError):
            continue
    return None


def rain_around(cam: dict, sample: list[dict], now: datetime) -> dict:
    """What the rain map's nearest cameras say right now.

    rain is True only on a majority of at least NEIGHBOUR_MIN fresh readings. A stale or
    missing reading is not a 'No' -- it is no evidence -- so it is left out of the count
    rather than allowed to outvote the cameras that do see rain.
    """
    near = sorted(
        ((km(cam["lat"], cam["lon"], s["lat"], s["lon"]), s) for s in sample
         if s.get("lat") is not None and s.get("lon") is not None),
        key=lambda pair: pair[0],
    )
    near = [s for d, s in near if d <= NEIGHBOUR_KM][:NEIGHBOUR_MAX]
    fresh = [s for s in near
             if (t := _reading_time(s)) and now - t <= timedelta(minutes=NEIGHBOUR_FRESH_MIN)]
    yes = [s for s in fresh if str(s.get("rain", "No")) != "No"]
    return {
        "fresh": len(fresh),
        "yes": len(yes),
        "rain": len(fresh) >= NEIGHBOUR_MIN and 2 * len(yes) > len(fresh),
    }


def flood_alerts(cameras: list[dict], watched: set, tide: dict, sample: list[dict], now: datetime) -> list[dict]:
    """Flood-prone cameras not already under watch where it is raining around them on a high river."""
    level = tide.get("level_m") if tide.get("available") else None
    if level is None or level < ALERT_TIDE_M:
        return []
    out = []
    for c in cameras:
        if c["camera_id"] in watched:
            continue  # already a flood seen on camera; the map shows that instead
        ra = rain_around(c, sample, now)
        if ra["rain"]:
            out.append({"camera_id": c["camera_id"], "name": c["name"], "lat": c["lat"], "lon": c["lon"],
                        "rain_yes": ra["yes"], "rain_fresh": ra["fresh"]})
    return out
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


def _tide_and_alerts(cameras: dict, watched: set, now: datetime, tide_fn, rain_sample_path: Path) -> dict:
    t = tide_fn(now=now)
    summary = {"available": bool(t.get("available")), "level_m": t.get("level_m"), "trend": t.get("trend"),
               "next_high": t.get("next_high"), "alert_level_m": ALERT_TIDE_M,
               "high": bool(t.get("available") and t.get("level_m") is not None and t["level_m"] >= ALERT_TIDE_M)}
    alerts = flood_alerts(list(cameras.values()), watched, t, _load(rain_sample_path, []), now)
    return {"tide": summary, "alerts": alerts}


def live_floods(state_path: Path = STATE_PATH, cameras_path: Path = CAMERAS_PATH,
                now: datetime | None = None, tide_fn=None, rain_sample_path: Path = RAIN_SAMPLE_PATH) -> dict:
    now = now or datetime.now(timezone.utc)
    if tide_fn is None:
        from app.services.tide import tide_now as tide_fn
    state = _load(state_path, None)
    cameras = {c["camera_id"]: c for c in _load(cameras_path, {}).get("cameras", [])}
    if state is None:
        return {"floods": [], "watched_cameras": len(cameras), "collector": "missing",
                "generated_at": now.isoformat(), **_tide_and_alerts(cameras, set(), now, tide_fn, rain_sample_path)}

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
    watched = {f["camera_id"] for f in floods}
    return {"floods": floods, "watched_cameras": len(cameras), "collector": "ok",
            "generated_at": now.isoformat(), **_tide_and_alerts(cameras, watched, now, tide_fn, rain_sample_path)}
