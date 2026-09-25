"""HCMC Metro Line 1 timetable, from the operator's app API.

HURC1's app (HCMC Metro HURC) reads its timetable from an undocumented API --
see docs/metro-line-1-api.md for how it was found. One request per direction
returns the whole day's departures at every stop:

    GET https://api.metrohcm.ttgt.vn/transit/scheduled_trips?routeId=384&varId=1
    -> {"7003": ["05:00", "05:15", ...], "7004": ["05:02", ...], ...}

varId 1 runs toward Suối Tiên, 2 toward Bến Thành. The same trip sits at the
same index in every stop's list. Times are local (ICT). There is no date
parameter, so it is taken as today's timetable and refetched once per local
day; the last good copy is kept on disk and served if a refetch fails.
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from app.atomic_write import write_json_atomic

ICT = timezone(timedelta(hours=7))
API = "https://api.metrohcm.ttgt.vn/transit/scheduled_trips"
ROUTE_ID = 384
DIRECTIONS = {"1": "Suối Tiên", "2": "Bến Thành"}      # varId -> heading toward
STORE = Path("data/derived/metro_timetable.json")
TIMEOUT_SEC = 20


class TimetableUnavailable(Exception):
    pass


def parse_trips(payload):
    """Validate one direction's response: {stopId: ["HH:MM", ...]}, every
    stop with the same number of trips. Returns it with times as given."""
    if not isinstance(payload, dict) or not payload:
        raise TimetableUnavailable("timetable response is empty or not an object")
    counts = set()
    for stop, times in payload.items():
        if not isinstance(times, list) or not all(isinstance(t, str) and len(t) == 5 and t[2] == ":" for t in times):
            raise TimetableUnavailable(f"stop {stop}: times are not a list of HH:MM")
        counts.add(len(times))
    if len(counts) != 1:
        raise TimetableUnavailable(f"stops disagree on the number of trips: {sorted(counts)}")
    return payload


def fetch(session=None):
    s = session or requests
    directions = {}
    for var_id in DIRECTIONS:
        r = s.get(API, params={"routeId": ROUTE_ID, "varId": var_id}, timeout=TIMEOUT_SEC,
                  headers={"User-Agent": "hcmc-rainmap (personal project)"})
        r.raise_for_status()
        directions[var_id] = parse_trips(r.json())
    return directions


def timetable(now=None, store=STORE, fetcher=fetch):
    """Today's timetable (ICT), fetched at most once per local day."""
    now = now or datetime.now(ICT)
    today = now.astimezone(ICT).date().isoformat()
    cached = None
    if store.exists():
        try:
            cached = json.loads(store.read_text())
        except (OSError, ValueError):
            cached = None
    if cached and cached.get("date") == today:
        return cached
    try:
        record = {"date": today, "fetched_at": now.astimezone(timezone.utc).isoformat(),
                  "route_id": ROUTE_ID, "toward": DIRECTIONS, "directions": fetcher()}
    except (requests.RequestException, ValueError, TimetableUnavailable) as e:
        if cached:
            return {**cached, "stale": True, "error": str(e)}
        raise TimetableUnavailable(f"HURC timetable unavailable: {e}") from e
    store.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(store, record)
    return record
