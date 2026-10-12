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
# Tide alone can flood the official tide streets, rain or not. 10 Oct 2026: Nguyễn Văn Linh - Nguyễn Thị Thập
# was under water in sunshine from 35 min before the Nhà Bè high (1.65 m forecast, 15:30 ICT) to about
# 90 min after; the 1.52 m (9 Oct, 15:00) and 1.26 m (8 Oct, 13:30) daytime highs left it dry. Nhà Bè,
# downstream, peaks about an hour before Phú An and is the better clock for District 7. So from
# TIDE_BEFORE_MIN before to TIDE_AFTER_MIN after a Nhà Bè high of at least TIDE_ONLY_M (alert III) the flood
# watch reads every tide street, rain or not, and the map reports what those reads saw -- not a warning
# on all 34: on 10 Oct only the District 7 ones had water. Three days at one junction: tune with more.
TIDE_ONLY_STATION = "nha_be"
TIDE_ONLY_M = float(os.getenv("FLOOD_TIDE_ONLY_M", "1.6"))
TIDE_BEFORE_MIN = float(os.getenv("FLOOD_TIDE_BEFORE_MIN", "45"))
TIDE_AFTER_MIN = float(os.getenv("FLOOD_TIDE_AFTER_MIN", "90"))

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


def is_tide_street(cam: dict) -> bool:
    return any("tide street" in str(w) for w in cam.get("why") or [])


def tide_window(highs: list[dict], now: datetime) -> dict | None:
    """The high tide whose flooding window contains now, if it is high enough; else None."""
    for e in highs:
        if (e["h"] >= TIDE_ONLY_M
                and e["t"] - timedelta(minutes=TIDE_BEFORE_MIN) <= now <= e["t"] + timedelta(minutes=TIDE_AFTER_MIN)):
            return e
    return None


def flood_alerts(cameras: list[dict], watched: set, tide: dict, sample: list[dict], now: datetime) -> list[dict]:
    """Flood-prone cameras not already under watch where it is raining around them on a high river."""
    level = tide.get("level_m") if tide.get("available") else None
    river_high = level is not None and level >= ALERT_TIDE_M
    out = []
    for c in cameras:
        if c["camera_id"] in watched:
            continue  # already a flood seen on camera; the map shows that instead
        reasons, a = [], {"camera_id": c["camera_id"], "name": c["name"], "lat": c["lat"], "lon": c["lon"]}
        if river_high:
            ra = rain_around(c, sample, now)
            if ra["rain"]:
                reasons.append("rain")
                a.update(rain_yes=ra["yes"], rain_fresh=ra["fresh"])
        if reasons:
            out.append({**a, "reasons": reasons})
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


WATER_DEPTHS = {"shallow sheet", "flooded", "deep"}


def tide_vision(cameras: dict, state: dict | None, window_from: datetime) -> dict:
    """What the flood watch's reads of the tide streets have seen since the tide window opened."""
    tide_cams = {cid: c for cid, c in cameras.items() if is_tide_street(c)}
    read, water = [], []
    for cid, c in tide_cams.items():
        last = ((state or {}).get("cameras", {}).get(cid) or {}).get("last_read") or {}
        at = _parse(last.get("read_at"))
        if at is None or at < window_from or not last.get("usable", True):
            continue
        read.append(cid)
        if last.get("depth") in WATER_DEPTHS:
            water.append({"camera_id": cid, "name": c["name"], "depth": last["depth"], "read_at": last["read_at"]})
    return {"tide_streets": len(tide_cams), "read": len(read), "water": water}


def _tide_and_alerts(cameras: dict, watched: set, now: datetime, tide_fn, rain_sample_path: Path, highs_fn,
                     state: dict | None = None) -> dict:
    t = tide_fn(now=now)
    w = tide_window(highs_fn(), now)
    summary = {"available": bool(t.get("available")), "level_m": t.get("level_m"), "trend": t.get("trend"),
               "next_high": t.get("next_high"), "alert_level_m": ALERT_TIDE_M,
               "high": bool(t.get("available") and t.get("level_m") is not None and t["level_m"] >= ALERT_TIDE_M),
               "tide_window": None if w is None else {
                   "station": "Nhà Bè", "high_at": w["t"].isoformat(), "high_m": w["h"], "source": w["source"],
                   "from": (w["t"] - timedelta(minutes=TIDE_BEFORE_MIN)).isoformat(),
                   "to": (w["t"] + timedelta(minutes=TIDE_AFTER_MIN)).isoformat(), "threshold_m": TIDE_ONLY_M,
                   "vision": tide_vision(cameras, state, w["t"] - timedelta(minutes=TIDE_BEFORE_MIN))}}
    alerts = flood_alerts(list(cameras.values()), watched, t, _load(rain_sample_path, []), now)
    return {"tide": summary, "alerts": alerts}


def live_floods(state_path: Path = STATE_PATH, cameras_path: Path = CAMERAS_PATH,
                now: datetime | None = None, tide_fn=None, rain_sample_path: Path = RAIN_SAMPLE_PATH,
                highs_fn=None) -> dict:
    now = now or datetime.now(timezone.utc)
    if tide_fn is None:
        from app.services.tide import tide_now as tide_fn
    if highs_fn is None:
        from app.services.tide import station_highs
        highs_fn = lambda: station_highs(station=TIDE_ONLY_STATION)
    state = _load(state_path, None)
    cameras = {c["camera_id"]: c for c in _load(cameras_path, {}).get("cameras", [])}
    if state is None:
        return {"floods": [], "watched_cameras": len(cameras), "collector": "missing",
                "generated_at": now.isoformat(), **_tide_and_alerts(cameras, set(), now, tide_fn, rain_sample_path, highs_fn)}

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
            "generated_at": now.isoformat(), **_tide_and_alerts(cameras, watched, now, tide_fn, rain_sample_path, highs_fn, state)}


# ---- recent frames of one flood-watch camera, for the risk map's popups ---------------------------------
FRAMES_ROOT = Path("data/flood_watch/frames")
READS_PATH = Path("data/derived/flood_reads.csv")
READS_TAIL_BYTES = 4_000_000   # ~15,000 reads: the last day or two, enough to label the frames shown


def _recent_reads(camera_id: str, reads_path: Path = READS_PATH) -> dict:
    """{frame path: (depth, justification, reason)} for this camera's reads near the end of flood_reads.csv.
    Only the tail is read: the file grows by every read and the popup shows the last few frames."""
    import csv, io
    try:
        with reads_path.open("rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - READS_TAIL_BYTES))
            tail = f.read().decode("utf-8", errors="replace")
        header = reads_path.open(encoding="utf-8").readline()
    except OSError:
        return {}
    if size > READS_TAIL_BYTES:
        tail = tail.split("\n", 1)[-1]   # drop the partial first line
    else:
        tail = tail.split("\n", 1)[-1]   # drop the header; it is re-added below
    out = {}
    for r in csv.DictReader(io.StringIO(header + tail)):
        if r.get("camera_id") == camera_id:
            out[r["frame"]] = (r.get("depth"), r.get("justification"), r.get("reason"))
    return out


def camera_frames(camera_id: str, n: int = 6, cameras_path: Path = CAMERAS_PATH, root: Path = FRAMES_ROOT,
                  reads_path: Path = READS_PATH) -> dict | None:
    """The newest n saved frames of a flood-watch camera, newest first, each with the read it got (if any).
    None for a camera that is not in the flood watch, so the route cannot be pointed at other folders."""
    cams = {c["camera_id"]: c for c in _load(cameras_path, {}).get("cameras", [])}
    if camera_id not in cams:
        return None
    days = sorted((d for d in (root / camera_id).glob("[0-9]" * 8) if d.is_dir()), reverse=True)[:2]
    files = sorted((p for d in days for p in d.glob("*.jpg")), key=lambda p: (p.parent.name, p.name), reverse=True)[:n]
    reads = _recent_reads(camera_id, reads_path) if files else {}
    out = []
    for p in files:
        rel = str(p)
        r = reads.get(rel)
        captured = datetime.strptime(p.parent.name + p.stem[:6], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        out.append({"url": _frame_url(rel), "captured_at": captured.isoformat(),
                    "read": None if r is None else {"depth": r[0], "justification": r[1], "reason": r[2]}})
    c = cams[camera_id]
    return {"camera_id": camera_id, "name": c["name"], "why": c.get("why", []), "frames": out}


# ---- camera-specific notes for the rain map's popups ------------------------------------------------------
NOTES_PATH = Path("data/metadata/camera_notes.json")


def camera_notes(now: datetime | None = None, notes_path: Path = NOTES_PATH, highs_fn=None) -> dict:
    """{camera_id: {"note": str, "tide_now": str | None}}. tide_now is set for a 'tide' note while a high
    tide's window is open: the water on that road may then be tidal, not rain."""
    notes = _load(notes_path, {}).get("notes", {})
    if not notes:
        return {}
    now = now or datetime.now(timezone.utc)
    if highs_fn is None:
        from app.services.tide import station_highs
        highs_fn = lambda: station_highs(station=TIDE_ONLY_STATION)
    w = tide_window(highs_fn(), now) if any(n.get("tide") for n in notes.values()) else None
    tide_now = None
    if w:
        at = w["t"].astimezone(timezone(timedelta(hours=7))).strftime("%H:%M")
        tide_now = (f"High tide now (Nhà Bè {w['h']:.2f} m at {at}, {'measured' if w['source'] == 'observed' else 'forecast'}): "
                    f"water on this road may be the tide, not rain.")
    return {cid: {"note": n.get("note", ""), "tide_now": tide_now if n.get("tide") else None} for cid, n in notes.items()}
