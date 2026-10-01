"""
Experiment: watch the cameras most likely to show street flooding, and follow a flood
while it lasts.

Run: .venv/bin/python -u scripts/flood_watch.py
     .venv/bin/python scripts/flood_watch.py --read FRAME.jpg [FRAME.jpg ...]   (one-off reads)

What it does, in one loop:
- Sweeps the cameras in data/metadata/flood_cameras.json, one every FLOOD_SWEEP_SPACING_SEC
  (52 cameras at 10s is a lap of about nine minutes). Frames go to data/flood_watch/frames/,
  not data/raw/, so nothing here can disturb the rain map's own sweep or the annotator.
- Reads a frame with the vision model only when it has rain around it: a majority of the
  nearest rain-map cameras (data/derived/rain_sample.json) currently reporting rain. Flooding
  without rain nearby is possible -- a high tide -- but reading every frame of every lap would
  cost ~8,000 calls a day for frames that are nearly all dry.
- A read that sees flooding puts that camera under watch: fetched every FLOOD_WATCH_INTERVAL_SEC
  and read every time, rain or not, since standing water outlasts the rain that made it. The
  watch ends after FLOOD_CLEAR_READS reads in a row with the lanes clear of water (or
  FLOOD_WATCH_MAX_HOURS), and the camera goes back to the ordinary sweep.

The model is asked only what it can see -- how deep the water on the road is, in steps defined
by what it covers -- and the code decides what counts as a flood (FLOOD_DEPTHS). Same split as
the rain annotator's perception path, for the same reason: the threshold can be moved without
spending a call.

Outputs (all operational, not versioned):
  data/flood_watch/frames/<camera>/<YYYYMMDD>/<HHMMSS>[_read].jpg   frames; unread ones are pruned
  data/derived/flood_reads.csv     one row per model read
  data/derived/flood_events.csv    one row per flood, written when it ends
  data/derived/flood_watch_state.json   per-camera mode, survives restarts
"""

import argparse
import csv
import hashlib
import json
import math
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config
from app.log_setup import get_logger
from app.services.insights import InsightsService
from scripts.rain_annotator import ICT, quota_retry_after

REPO = Path(__file__).resolve().parents[1]
CAMERAS_PATH = REPO / "data" / "metadata" / "flood_cameras.json"
RAIN_SAMPLE_PATH = REPO / "data" / "derived" / "rain_sample.json"
FRAMES_ROOT = Path(os.getenv("FLOOD_FRAMES_ROOT", str(REPO / "data" / "flood_watch" / "frames")))
STATE_PATH = REPO / "data" / "derived" / "flood_watch_state.json"
READS_PATH = REPO / "data" / "derived" / "flood_reads.csv"
EVENTS_PATH = REPO / "data" / "derived" / "flood_events.csv"

SWEEP_SPACING_SEC = float(os.getenv("FLOOD_SWEEP_SPACING_SEC", "10"))
WATCH_INTERVAL_SEC = float(os.getenv("FLOOD_WATCH_INTERVAL_SEC", "60"))
CLEAR_READS = int(os.getenv("FLOOD_CLEAR_READS", "3"))
WATCH_MAX_HOURS = float(os.getenv("FLOOD_WATCH_MAX_HOURS", "6"))

# "Rain around": the rain map's cameras are spaced 3-4 km apart, so 6 km takes in the two to
# five nearest. A reading older than 30 minutes is a different weather situation. With fewer
# than two fresh neighbours there is no evidence either way, and no read.
NEIGHBOUR_KM = float(os.getenv("FLOOD_NEIGHBOUR_KM", "6"))
NEIGHBOUR_MAX = int(os.getenv("FLOOD_NEIGHBOUR_MAX", "5"))
NEIGHBOUR_MIN = int(os.getenv("FLOOD_NEIGHBOUR_MIN", "2"))
NEIGHBOUR_FRESH_MIN = float(os.getenv("FLOOD_NEIGHBOUR_FRESH_MIN", "30"))

# The annotator budgets 10,000 of a 14,000/day quota on the same key; this stays inside the rest.
DAILY_READ_CAP = int(os.getenv("FLOOD_DAILY_READ_CAP", "1500"))
READ_WORKERS = int(os.getenv("FLOOD_READ_WORKERS", "2"))
KEEP_UNREAD_HOURS = float(os.getenv("FLOOD_KEEP_UNREAD_HOURS", "2"))

FETCH_TIMEOUT_SEC = 25
OFFLINE_THRESHOLD = 5 * 1024  # the site's offline placeholder is smaller than any real frame
# A run of unanswered requests is the site being down (it was, 09:00-09:03 UTC on 1 Oct), not
# the cameras. Back off rather than spend the outage hammering it.
OUTAGE_AFTER = 5
OUTAGE_PAUSE_SEC = 120

DEPTHS = ["none", "edge puddles", "shallow sheet", "flooded", "deep"]
FLOOD_DEPTHS = {"flooded", "deep"}
# What ends a watch: the lanes clear of water. A shallow sheet neither starts a watch nor
# ends one -- at TL43 - KCX Linh Trung 2 on 30 Sep the model called 16:12 'flooded' (bow
# waves) and 16:42 'shallow sheet' while bikes were still kicking wakes across the whole
# junction, so counting a sheet as clear would drop a flood that is still there.
CLEAR_DEPTHS = {"none", "edge puddles"}

LIVE, OFFLINE, UNREACHABLE, SAME = "live", "offline", "unreachable", "same"
SWEEP, WATCH = "sweep", "watch"

READ_FIELDS = ["read_at", "camera_id", "name", "reason", "frame", "usable", "depth", "wakes",
               "stalled", "flooding", "mode_after", "rain_fresh", "rain_yes", "justification"]
EVENT_FIELDS = ["camera_id", "name", "started_at", "ended_at", "minutes", "peak_depth", "reads",
                "end_reason", "first_frame"]

log = get_logger("flood_watch")


FLOOD_PROMPT = (
    "You are looking at one frame from a fixed traffic camera in Ho Chi Minh City{when}. Describe "
    "only the water lying on the road -- not the weather, not whether it is raining.\n\n"
    "How deep is the water on the carriageway (the lanes where vehicles drive)? Choose one:\n"
    "- 'none': the road is dry or just wet. Glossy reflections, rain on the lens and a few small "
    "puddles do not count.\n"
    "- 'edge puddles': water lies along the kerbs, gutters or an unpaved shoulder, but the lanes "
    "themselves are clear.\n"
    "- 'shallow sheet': a thin layer of water across part or all of the lanes. Vehicles throw "
    "spray, but the water is too shallow to see a wake, and tyres are not visibly sunk in it.\n"
    "- 'flooded': water clearly lying on the lanes, deep enough to cover the bottom of the wheels "
    "or reach the kerb top. Vehicles push a wake or bow wave through it; riders may lift their "
    "feet.\n"
    "- 'deep': water near or above motorbike wheel hubs or seats, car wheels mostly under water, "
    "stalled or pushed vehicles, people wading.\n\n"
    "At night, judge depth from wakes, kerbs and wheels, not from how bright the reflections "
    "are -- a wet road under street lights looks like a mirror at any depth.\n\n"
    "Also say whether the road can be judged at all ('usable'): 'no' if the lens is fogged or "
    "smeared so the road surface cannot be seen, the frame is black or frozen-looking, or the "
    "road is out of view.\n\n"
    "Respond with STRICT JSON only, no markdown fences, no extra text: "
    '{{"usable": "<yes|no>", "depth": "<none|edge puddles|shallow sheet|flooded|deep>", '
    '"wakes": "<yes|no>", "stalled": "<yes|no>", '
    '"justification": "<one short sentence on what the water on the road looks like>"}}'
)


def build_prompt(captured_at: datetime | None) -> str:
    when = ""
    if captured_at:
        local = captured_at.astimezone(ICT)
        when = f", captured at {local.strftime('%H:%M')} local time"
    return FLOOD_PROMPT.format(when=when)


def parse_read(text: str) -> dict:
    """Model text -> {usable, depth, wakes, stalled, justification}. Raises on junk."""
    cleaned = re.sub(r"^```(json)?|```$", "", (text or "").strip(), flags=re.MULTILINE).strip()
    raw = json.loads(cleaned)
    depth = str(raw.get("depth", "")).strip().lower()
    if depth not in DEPTHS:
        raise ValueError(f"unknown depth {depth!r}")
    yes = lambda k: str(raw.get(k, "")).strip().lower() == "yes"
    return {
        "usable": yes("usable"),
        "depth": depth,
        "wakes": yes("wakes"),
        "stalled": yes("stalled"),
        "justification": str(raw.get("justification", "")).strip(),
    }


def is_flooding(read: dict) -> bool:
    return read["usable"] and read["depth"] in FLOOD_DEPTHS


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


def new_camera_state() -> dict:
    return {"mode": SWEEP, "watch_since": None, "clear_streak": 0, "peak": None,
            "reads": 0, "first_frame": None, "last_md5": None, "last_fetch": 0.0}


def apply_read(st: dict, read: dict, frame: str, now: datetime) -> str | None:
    """Advance one camera's watch state with a read. Returns 'start', 'end' or None.

    An unusable frame -- fogged lens, black frame -- says nothing about the water, so it
    neither starts a watch nor counts toward ending one.
    """
    if not read["usable"]:
        return None
    if is_flooding(read):
        st["clear_streak"] = 0
        if st["peak"] is None or DEPTHS.index(read["depth"]) > DEPTHS.index(st["peak"]):
            st["peak"] = read["depth"]
        if st["mode"] != WATCH:
            st.update(mode=WATCH, watch_since=now.isoformat(), reads=1, first_frame=frame)
            return "start"
        st["reads"] += 1
        return None
    if st["mode"] == WATCH:
        st["reads"] += 1
        if read["depth"] not in CLEAR_DEPTHS:
            st["clear_streak"] = 0  # water still on the lanes: the road has not cleared yet
            return None
        st["clear_streak"] += 1
        if st["clear_streak"] >= CLEAR_READS:
            return "end"
    return None


def watch_expired(st: dict, now: datetime) -> bool:
    if st["mode"] != WATCH or not st["watch_since"]:
        return False
    return now - datetime.fromisoformat(st["watch_since"]) > timedelta(hours=WATCH_MAX_HOURS)


def close_watch(st: dict, cam: dict, now: datetime, reason: str) -> dict:
    """Reset a camera to the sweep and return the flood_events row for the watch just ended."""
    started = datetime.fromisoformat(st["watch_since"])
    row = {
        "camera_id": cam["camera_id"], "name": cam["name"], "started_at": st["watch_since"],
        "ended_at": now.isoformat(), "minutes": round((now - started).total_seconds() / 60),
        "peak_depth": st["peak"], "reads": st["reads"], "end_reason": reason,
        "first_frame": st["first_frame"],
    }
    st.update(mode=SWEEP, watch_since=None, clear_streak=0, peak=None, reads=0, first_frame=None)
    return row


def frames_to_prune(root: Path, now_ts: float, keep_hours: float) -> list[Path]:
    """Frames nobody read, older than keep_hours. Read frames are kept: they are the record."""
    cutoff = now_ts - keep_hours * 3600
    return [p for p in root.rglob("*.jpg")
            if not p.stem.endswith("_read") and p.stat().st_mtime < cutoff]


def shown(path: Path) -> str:
    """A frame's path as recorded: repo-relative when it is inside the repo (the default
    FRAMES_ROOT), absolute when FLOOD_FRAMES_ROOT points elsewhere."""
    try:
        return str(path.relative_to(REPO))
    except ValueError:
        return str(path)


def append_csv(path: Path, fields: list[str], row: dict) -> None:
    new = not path.exists()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        if new:
            w.writeheader()
        w.writerow(row)


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1))
    tmp.replace(STATE_PATH)


class Watcher:
    def __init__(self):
        self.cameras = load_json(CAMERAS_PATH, {}).get("cameras", [])
        if not self.cameras:
            raise SystemExit(f"no cameras in {CAMERAS_PATH}")
        self.by_id = {c["camera_id"]: c for c in self.cameras}
        saved = load_json(STATE_PATH, {})
        self.cams = {cid: {**new_camera_state(), **saved.get("cameras", {}).get(cid, {})}
                     for cid in self.by_id}
        for st in self.cams.values():
            st["last_fetch"] = 0.0  # monotonic clock; meaningless across restarts
        self.budget = saved.get("budget", {"date": None, "reads": 0})
        self.session = requests.Session()
        self.session.headers["User-Agent"] = (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36")
        self.svc = InsightsService()
        self.pool = ThreadPoolExecutor(max_workers=READ_WORKERS)
        self.pending = {}  # camera_id -> (future, frame path, reason, rain dict)
        self.read_pause_until = 0.0
        self.unreachable_run = 0

    # -- persistence -------------------------------------------------------------------------
    def save(self):
        save_state({"cameras": self.cams, "budget": self.budget})

    def budget_left(self, now: datetime) -> bool:
        today = now.astimezone(ICT).date().isoformat()
        if self.budget["date"] != today:
            self.budget = {"date": today, "reads": 0}
        return self.budget["reads"] < DAILY_READ_CAP

    # -- the site ----------------------------------------------------------------------------
    def fetch(self, cid: str) -> tuple[str, Path | None]:
        st = self.cams[cid]
        st["last_fetch"] = time.monotonic()
        try:
            resp = self.session.get(config.BASE_URL, params={"id": cid, "t": int(time.time() * 1000)},
                                    timeout=FETCH_TIMEOUT_SEC)
        except requests.RequestException:
            self.unreachable_run += 1
            return UNREACHABLE, None
        if resp.status_code >= 500:
            self.unreachable_run += 1
            return UNREACHABLE, None
        self.unreachable_run = 0
        if (resp.status_code != 200 or "text" in resp.headers.get("Content-Type", "").lower()
                or len(resp.content) < OFFLINE_THRESHOLD):
            return OFFLINE, None
        digest = hashlib.md5(resp.content).hexdigest()
        if digest == st["last_md5"]:
            return SAME, None  # the site re-serving a frozen frame; nothing new to look at
        st["last_md5"] = digest
        now = datetime.now(timezone.utc)
        path = FRAMES_ROOT / cid / now.strftime("%Y%m%d") / f"{now.strftime('%H%M%S')}.jpg"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(resp.content)
        return LIVE, path

    # -- reads -------------------------------------------------------------------------------
    def submit(self, cid: str, frame: Path, reason: str, rain: dict | None) -> bool:
        now = datetime.now(timezone.utc)
        if cid in self.pending or time.monotonic() < self.read_pause_until or not self.budget_left(now):
            return False
        self.budget["reads"] += 1
        captured = datetime.strptime(frame.parent.name + frame.stem[:6], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        fut = self.pool.submit(self.svc.google_generate_with_prompt, [frame], build_prompt(captured))
        self.pending[cid] = (fut, frame, reason, rain)
        return True

    def collect(self):
        for cid, (fut, frame, reason, rain) in list(self.pending.items()):
            if not fut.done():
                continue
            del self.pending[cid]
            cam, st = self.by_id[cid], self.cams[cid]
            now = datetime.now(timezone.utc)
            try:
                read = parse_read(fut.result())
            except Exception as e:
                wait = quota_retry_after(e)
                if wait is not None:
                    self.read_pause_until = max(self.read_pause_until, time.monotonic() + wait)
                    log.info("quota: reads paused %.0fs", wait)
                else:
                    log.warning("[%s] read failed: %s", cam["name"], str(e)[:200])
                continue
            kept = frame.with_name(frame.stem + "_read.jpg")
            frame.rename(kept)
            event = apply_read(st, read, shown(kept), now)
            ended = close_watch(st, cam, now, f"{CLEAR_READS} clear reads") if event == "end" else None
            append_csv(READS_PATH, READ_FIELDS, {
                "read_at": now.isoformat(), "camera_id": cid, "name": cam["name"], "reason": reason,
                "frame": shown(kept), "usable": read["usable"], "depth": read["depth"],
                "wakes": read["wakes"], "stalled": read["stalled"], "flooding": is_flooding(read),
                "mode_after": st["mode"], "rain_fresh": rain["fresh"] if rain else "",
                "rain_yes": rain["yes"] if rain else "", "justification": read["justification"],
            })
            log.info("[%s] %s read: %s%s -- %s", cam["name"], reason, read["depth"],
                     "" if read["usable"] else " (unusable)", read["justification"])
            if event == "start":
                log.warning("FLOOD at %s (%s): watching every %ds -- %s", cam["name"], read["depth"],
                            WATCH_INTERVAL_SEC, shown(kept))
            elif ended:
                append_csv(EVENTS_PATH, EVENT_FIELDS, ended)
                log.warning("flood over at %s after %s min (peak %s); back to the sweep",
                            cam["name"], ended["minutes"], ended["peak_depth"])
            self.save()

    # -- the loop ----------------------------------------------------------------------------
    def sweep_one(self, cid: str):
        status, frame = self.fetch(cid)
        if status != LIVE:
            return
        rain = rain_around(self.by_id[cid], load_json(RAIN_SAMPLE_PATH, []), datetime.now(timezone.utc))
        if rain["rain"]:
            self.submit(cid, frame, "rain around", rain)

    def watch_due(self):
        for cid, st in self.cams.items():
            if st["mode"] != WATCH:
                continue
            now = datetime.now(timezone.utc)
            if watch_expired(st, now):
                row = close_watch(st, self.by_id[cid], now, f"over {WATCH_MAX_HOURS:g}h")
                append_csv(EVENTS_PATH, EVENT_FIELDS, row)
                log.warning("watch on %s dropped after %gh without clearing", self.by_id[cid]["name"],
                            WATCH_MAX_HOURS)
                self.save()
                continue
            if cid in self.pending or time.monotonic() - st["last_fetch"] < WATCH_INTERVAL_SEC:
                continue
            status, frame = self.fetch(cid)
            if status == LIVE:
                self.submit(cid, frame, "watch", None)

    def prune(self):
        if not FRAMES_ROOT.exists():
            return
        old = frames_to_prune(FRAMES_ROOT, time.time(), KEEP_UNREAD_HOURS)
        pending = {str(f) for _, f, _, _ in self.pending.values()}
        for p in old:
            if str(p) not in pending:
                p.unlink(missing_ok=True)

    def run(self):
        watching = [self.by_id[c]["name"] for c, s in self.cams.items() if s["mode"] == WATCH]
        log.info("flood watch starting: %d cameras, one every %gs (lap %.1f min); watch every %gs, "
                 "clear after %d reads; %d reads/day cap%s", len(self.cameras), SWEEP_SPACING_SEC,
                 len(self.cameras) * SWEEP_SPACING_SEC / 60, WATCH_INTERVAL_SEC, CLEAR_READS,
                 DAILY_READ_CAP, f"; still watching {', '.join(watching)}" if watching else "")
        i, next_sweep = 0, 0.0
        while True:
            try:
                self.collect()
                self.watch_due()
                if time.monotonic() >= next_sweep:
                    cid = self.cameras[i % len(self.cameras)]["camera_id"]
                    i += 1
                    next_sweep = time.monotonic() + SWEEP_SPACING_SEC
                    if self.cams[cid]["mode"] != WATCH:  # a watched camera is already fetched more often
                        self.sweep_one(cid)
                    if i % len(self.cameras) == 0:
                        self.prune()
                        self.save()
                if self.unreachable_run >= OUTAGE_AFTER:
                    log.warning("site not answering (%d in a row); pausing %ds", self.unreachable_run,
                                OUTAGE_PAUSE_SEC)
                    time.sleep(OUTAGE_PAUSE_SEC)
                    self.unreachable_run = 0
            except Exception as e:
                # One bad frame or file must not end an unattended watch.
                log.exception("loop error: %s", e)
            time.sleep(1)


def read_files(paths: list[str]) -> None:
    svc = InsightsService()
    for p in map(Path, paths):
        try:
            read = parse_read(svc.google_generate_with_prompt([p], build_prompt(None)))
            print(f"{p}: {read['depth']}{'' if read['usable'] else ' (unusable)'} "
                  f"flooding={is_flooding(read)} wakes={read['wakes']} -- {read['justification']}")
        except Exception as e:
            print(f"{p}: failed: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--read", nargs="+", metavar="FRAME", help="read these frames once and exit")
    args = ap.parse_args()
    if args.read:
        read_files(args.read)
        return
    Watcher().run()


if __name__ == "__main__":
    main()
