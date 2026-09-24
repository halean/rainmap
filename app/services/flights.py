"""Arrivals and departures at Tan Son Nhat (VVTS / SGN) for the 3D map.

Three sources, none of which is a live position feed:

* Schedule: Tan Son Nhat's own live flight board (tia.vietnamairport.vn),
  scraped by `scripts/tia_poller.py` (see that file and app/services/tia.py
  for how) and read here from `data/derived/flights_tia.json`. It is the
  airport operator's official display, needs no key, and is preferred
  whenever the poller has written something within TIA_STALE_MINUTES. When
  it hasn't -- the poller isn't running, or the site is unreachable -- this
  falls back to a clearly labelled synthetic sample so the animation can
  still be exercised; the sample is never presented as real traffic.
* Wind: the latest METAR for VVTS from aviationweather.gov (no key). The wind
  picks the runway direction (07 or 25) for movements the schedule doesn't
  name a runway for -- which is always, for this source; TIA's board carries
  terminal/gate/belt but not the physical runway.
* Geometry: runway ends from OurAirports (public domain), copied in below so
  the viewer never depends on a third download.

Live ADS-B aggregators (OpenSky, adsb.lol, adsb.fi) returned no aircraft
anywhere near HCMC when checked in September 2026, so positions along the
approach and climb are animated from the times, not observed.
"""

import json
import logging
import math
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

from app.atomic_write import write_json_atomic
from app.config import (
    FLIGHTS_STORE,
    FLIGHTS_TIMEOUT_SEC,
    FLIGHTS_WINDOW_MINUTES,
    METAR_REFRESH_MINUTES,
    TIA_STALE_MINUTES,
    TIA_STORE_PATH,
)

log = logging.getLogger("flights")
UTC = timezone.utc
LOCAL = ZoneInfo("Asia/Ho_Chi_Minh")

# OurAirports runways.csv, VVTS rows (public domain). Headings are true.
AIRPORT = {
    "icao": "VVTS",
    "iata": "SGN",
    "name": "Tan Son Nhat International Airport",
    "lat": 10.8188,
    "lon": 106.652,
    "elevation_m": 10,
    "timezone": "Asia/Ho_Chi_Minh",
}
RUNWAYS = [
    {
        "name": "07L/25R",
        "length_m": 3050,
        "width_m": 45,
        "ends": {
            "07L": {"lat": 10.815, "lon": 106.637001, "heading": 69},
            "25R": {"lat": 10.8249, "lon": 106.663002, "heading": 249},
        },
    },
    {
        "name": "07R/25L",
        "length_m": 3800,
        "width_m": 45,
        "ends": {
            "07R": {"lat": 10.8115, "lon": 106.637001, "heading": 69},
            "25L": {"lat": 10.8237, "lon": 106.669998, "heading": 249},
        },
    },
]
# Assumption, not published procedure: arrivals use the northern runway
# (07L/25R) and departures the southern one (07R/25L). The viewer states this
# next to the animation.
DEFAULT_RUNWAY = {"arrival": "07L/25R", "departure": "07R/25L"}
# The board's departure times are gate times (STD) or the live estimate
# (ETD), not a runway time. Take-off is animated this long after the best of
# those, matching a typical taxi-out.
TAXI_OUT = timedelta(minutes=15)

METAR_URL = "https://aviationweather.gov/api/data/metar"
ATTRIBUTION = {
    "schedule": "Flight schedule scraped from Tan Son Nhat's official live board (tia.vietnamairport.vn)",
    "wind": "METAR via aviationweather.gov (NOAA)",
    "runways": "Runway geometry from OurAirports (public domain)",
}

_lock = threading.Lock()


class FlightsUnavailable(Exception):
    pass


# --------------------------------------------------------------------------
# Time helpers


def _parse_time(value):
    if not value:
        return None
    text = str(value).strip().replace(" ", "T")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(UTC)


def _iso(when):
    return when.astimezone(UTC).isoformat().replace("+00:00", "Z") if when else None


# --------------------------------------------------------------------------
# Wind and runway choice


def runway_direction(wind_dir, wind_speed_kt, calm_kt=5):
    """'07' or '25' from the surface wind. Below calm_kt the choice is the
    westerly 25 direction, which is what VVTS uses in the south-west monsoon
    and is stated as an assumption rather than a published preference."""
    if wind_dir is None or wind_speed_kt is None or wind_speed_kt < calm_kt:
        return "25"
    headwind_07 = math.cos(math.radians(wind_dir - 69))
    return "07" if headwind_07 > 0 else "25"


def parse_metar(payload):
    if not isinstance(payload, list) or not payload:
        raise FlightsUnavailable("no METAR for VVTS")
    ob = payload[0]
    wdir = ob.get("wdir")
    wdir = None if isinstance(wdir, str) else wdir  # "VRB" means variable
    wspd = ob.get("wspd")
    observed = ob.get("reportTime") or ob.get("obsTime")
    if isinstance(observed, (int, float)):
        observed = _iso(datetime.fromtimestamp(observed, UTC))
    return {
        "raw": ob.get("rawOb"),
        "dir": wdir,
        "speed_kt": wspd,
        "observed": observed,
        "runway_direction": runway_direction(wdir, wspd),
    }


# --------------------------------------------------------------------------
# Sample schedule (poller not running or not yet fresh)


def sample_schedule(now, window_minutes=FLIGHTS_WINDOW_MINUTES):
    """A synthetic cadence so the runway animation can be seen without the
    scraper running. Every movement is labelled as a sample. Nothing here is
    a real flight, and the numbers are chosen so they cannot be mistaken for
    one.
    """
    start = now - timedelta(minutes=120)
    end = start + timedelta(minutes=window_minutes)
    flights = []
    slot = start.replace(second=0, microsecond=0)
    slot -= timedelta(minutes=slot.minute % 4)
    index = 0
    while slot < end:
        local_hour = slot.astimezone(LOCAL).hour
        if 5 <= local_hour <= 23:
            kind = "arrival" if index % 2 == 0 else "departure"
            size = ("narrow", "narrow", "wide", "regional")[index % 4]
            flights.append({
                "id": f"sample:{index}:{_iso(slot)}",
                "kind": kind,
                "number": f"SAMPLE {index % 90 + 10}",
                "callsign": None,
                "airline": "Sample schedule",
                "aircraft": {"narrow": "Sample narrow-body", "wide": "Sample wide-body", "regional": "Sample turboprop"}[size],
                "registration": None,
                "size": size,
                "other": {"iata": None, "icao": None, "name": "sample route", "lat": None, "lon": None},
                "scheduled": _iso(slot),
                "revised": None,
                "runway_time": _iso(slot),
                "time": _iso(slot),
                "time_source": "sample",
                "runway": None,
                "status": "Sample",
                "cargo": False,
                "quality": ["Sample"],
                "terminal": None, "gate": None, "belt": None, "remark": None,
            })
        slot += timedelta(minutes=4)
        index += 1
    return flights


# --------------------------------------------------------------------------
# TIA board (data/derived/flights_tia.json, written by scripts/tia_poller.py)


def read_tia(now, path=None, stale_after_minutes=TIA_STALE_MINUTES):
    """The poller's merged flight list, or None if it hasn't written anything
    fresh enough -- distinct from "fresh but empty" (a real quiet spell),
    which returns an empty list, not None."""
    path = Path(path or TIA_STORE_PATH)
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None, "no data from scripts/tia_poller.py yet"
    generated = _parse_time(record.get("generated_at"))
    if generated is None:
        return None, "flights_tia.json has no generated_at"
    age = (now - generated).total_seconds() / 60
    if age > stale_after_minutes:
        return None, f"last scrape {age:.0f} min ago (stale after {stale_after_minutes:g})"
    flights = sorted(record.get("flights") or [], key=lambda f: f["time"])
    return {"flights": flights, "generated_at": record["generated_at"]}, None


# --------------------------------------------------------------------------
# METAR fetch and disk cache (the only thing this module still fetches live)


def _store_path(name):
    return Path(FLIGHTS_STORE) / f"{name}.json"


def _read(name):
    try:
        return json.loads(_store_path(name).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write(name, data):
    Path(FLIGHTS_STORE).mkdir(parents=True, exist_ok=True)
    write_json_atomic(_store_path(name), data)


def _age_minutes(record, now):
    fetched = _parse_time((record or {}).get("fetched_at"))
    return (now - fetched).total_seconds() / 60 if fetched else math.inf


def fetch_metar(now):
    response = requests.get(METAR_URL, params={"ids": AIRPORT["icao"], "format": "json"},
                            timeout=FLIGHTS_TIMEOUT_SEC)
    response.raise_for_status()
    wind = parse_metar(response.json())
    wind["fetched_at"] = _iso(now)
    return wind


def _cached(name, refresh_minutes, fetch, now):
    """Serve the stored record while fresh; otherwise refetch, and fall back
    to the stale record (flagged) when the refetch fails."""
    record = _read(name)
    age = _age_minutes(record, now)
    if record is not None and age < refresh_minutes:
        return record, None
    try:
        fresh = fetch(now)
    except (requests.RequestException, ValueError, FlightsUnavailable, OSError) as e:
        log.warning("%s refresh failed: %s", name, e)
        if record is None:
            return None, str(e)
        return record, f"stale ({age:.0f} min): {e}"
    _write(name, fresh)
    return fresh, None


def status(now=None):
    """The document `/api/rain-map/flights` serves."""
    now = now or datetime.now(UTC)
    with _lock:
        wind, wind_error = _cached("metar", METAR_REFRESH_MINUTES, fetch_metar, now)
        tia_result, tia_note = read_tia(now)
    if tia_result is not None:
        provider, flights, fetched_at, error = "tia", tia_result["flights"], tia_result["generated_at"], None
    else:
        provider, flights, fetched_at, error = "sample", sample_schedule(now), _iso(now), tia_note
    return {
        "generated_at": _iso(now),
        "airport": AIRPORT,
        "runways": RUNWAYS,
        "default_runway": DEFAULT_RUNWAY,
        "taxi_out_minutes": int(TAXI_OUT.total_seconds() // 60),
        "wind": wind,
        "wind_error": wind_error,
        "source": {
            "provider": provider,
            "sample": provider == "sample",
            "fetched_at": fetched_at,
            "stale_after_minutes": TIA_STALE_MINUTES,
            "error": error,
            "attribution": ATTRIBUTION,
        },
        "flights": flights,
    }
