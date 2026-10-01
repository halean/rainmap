"""The Saigon River's water level now, from the official tide forecast (scripts/tide_poller.py).

The bulletin gives only highs and lows with their times. Between two of them the level follows
a half cosine -- the shape of a tide between turning points, and the usual way tide tables are
read between their entries -- so the level at any moment is interpolated from the pair around it.

This is an ESTIMATE from a forecast, never a measurement, and the payload says so: there is no
public live gauge for Phu An. The forecast's own error is unknown until scripts/tide_poller.py's
record of measured highs and lows (data/derived/tide_observed.csv) is long enough to score it.

Ownership: scripts/tide_poller.py writes tide_kttvnb.json atomically; this module only reads it.
"""

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

TIDE_PATH = Path("data/derived/tide_kttvnb.json")
STATION = "phu_an"
# The bulletin comes out daily around 09:00 and covers five days; past a day and a half without a
# new one the poller has stopped or the site has changed, and the estimate should say it is old.
STALE_HOURS = 36
SERIES_BACK_HOURS = 12
SERIES_AHEAD_HOURS = 48
SERIES_STEP_MIN = 15


def _load(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _extremes(station: dict) -> list[tuple[datetime, float, str]]:
    """Measured extremes of the day before, then the forecast; one entry per time, the measured
    one winning where both exist."""
    by_time = {}
    for src in ("forecast", "observed"):
        for e in station.get(src, []):
            by_time[e["t"]] = (datetime.fromisoformat(e["t"]), e["h"], e["kind"], src)
    return sorted(by_time.values())


def level_at(ext, t: datetime) -> float | None:
    for (t0, h0, *_), (t1, h1, *_) in zip(ext, ext[1:]):
        if t0 <= t <= t1:
            f = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
            return h0 + (h1 - h0) * (1 - math.cos(math.pi * f)) / 2
    return None


def tide_now(path: Path = TIDE_PATH, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    data = _load(path)
    if not data or STATION not in data.get("stations", {}):
        return {"available": False, "reason": "no tide bulletin yet (scripts/tide_poller.py)"}
    st = data["stations"][STATION]
    ext = _extremes(st)
    level = level_at(ext, now)
    after = [e for e in ext if e[0] > now]
    nxt = lambda kind: next(({"t": e[0].isoformat(), "h": e[1], "source": e[3]} for e in after if e[2] == kind), None)
    soon = level_at(ext, now + timedelta(minutes=10))
    issued = datetime.fromisoformat(data["issued_at"])
    start = now - timedelta(hours=SERIES_BACK_HOURS)
    series = []
    for k in range(int((SERIES_BACK_HOURS + SERIES_AHEAD_HOURS) * 60 / SERIES_STEP_MIN) + 1):
        t = start + timedelta(minutes=k * SERIES_STEP_MIN)
        h = level_at(ext, t)
        if h is not None:
            series.append([t.isoformat(), round(h, 3)])
    return {
        "available": level is not None,
        "reason": None if level is not None else "now is outside the bulletin's five days",
        "station": st["name"],
        "datum": data.get("datum", "Hon Dau"),
        "now": now.isoformat(),
        "level_m": round(level, 3) if level is not None else None,
        "trend": None if level is None or soon is None else ("rising" if soon > level else "falling"),
        "next_high": nxt("high"),
        "next_low": nxt("low"),
        "alert_levels_m": data.get("alert_levels_m", {}),
        "extremes": [{"t": t.isoformat(), "h": h, "kind": k, "source": s} for t, h, k, s in ext],
        "series": series,
        "estimate": "interpolated between the official forecast's highs and lows; not a gauge reading",
        "bulletin": {"issued_at": data["issued_at"], "source_page": data.get("source_page"),
                     "pdf_url": data.get("pdf_url"), "stale": now - issued > timedelta(hours=STALE_HOURS)},
    }
