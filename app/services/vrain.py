"""Infer gauge accumulation increases and recurring resets from the local log.

Amounts are observed positive changes, not instantaneous rates. Hourly source
updates limit temporal precision; resets, corrections and gaps remain unknown.
"""

import csv
import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from statistics import median

ICT = timezone(timedelta(hours=7))
UTC = timezone.utc
HISTORY_PATH = Path("data/derived/vrain_history.csv")
MAX_GAP = timedelta(minutes=25)


def read_history(path):
    stations = defaultdict(dict)
    with Path(path).open(newline="", encoding="utf-8") as source:
        for row in csv.DictReader(source):
            try:
                at = datetime.fromisoformat(row["fetched_at"])
                lat, lon, depth = (float(row[k]) for k in ("lat", "lon", "depth_mm"))
                name = row["station"].strip()
                if (not name or at.tzinfo is None or not all(map(math.isfinite, (lat, lon, depth)))
                        or not -90 <= lat <= 90 or not -180 <= lon <= 180 or depth < 0):
                    continue
                stations[name][at] = {"at": at, "lat": lat, "lon": lon, "depth": round(depth, 3)}
            except (ValueError, TypeError, KeyError, AttributeError):
                continue  # also tolerates a partially appended final CSV row
    return {name: [rows[t] for t in sorted(rows)] for name, rows in stations.items()}


def infer_resets(stations):
    drops = defaultdict(list)
    for name, rows in stations.items():
        for before, after in zip(rows, rows[1:]):
            if after["at"] - before["at"] <= MAX_GAP and after["depth"] < before["depth"] - 0.001:
                drops[after["at"]].append((name, before["at"]))
    events = []
    for at, rows in sorted(drops.items()):
        if len(rows) >= 3:
            events.append({"before": max(t for _, t in rows).isoformat(), "at": at.isoformat(),
                           "local_hour": at.astimezone(ICT).hour,
                           "stations": sorted(name for name, _ in rows)})
    by_hour = defaultdict(list)
    for event in events:
        by_hour[event["local_hour"]].append(event)
    schedules = []
    for hour, evidence in sorted(by_hour.items()):
        days = {datetime.fromisoformat(e["at"]).astimezone(ICT).date() for e in evidence}
        if len(days) < 2:
            continue
        minutes = [datetime.fromisoformat(e["at"]).astimezone(ICT).minute for e in evidence]
        schedules.append({"local_hour": hour, "observed_minute": round(median(minutes)),
                          "days_observed": len(days), "events": evidence})
    return {"timezone": "Asia/Ho_Chi_Minh", "daily": schedules, "decrease_events": events}


@lru_cache(maxsize=2)
def _load(path, mtime_ns, size):
    stations = read_history(path)
    return stations, infer_resets(stations)


def rain_density(path=HISTORY_PATH, *, hours=3, at=None, now=None):
    path = Path(path)
    now = now or datetime.now(UTC)
    if at is not None and at.tzinfo is None:
        raise ValueError("at must include a timezone")
    if not path.exists():
        stations, resets = {}, infer_resets({})
    else:
        stat = path.stat()
        stations, resets = _load(str(path.resolve()), stat.st_mtime_ns, stat.st_size)
    timestamps = [r["at"] for rows in stations.values() for r in rows]
    latest = max(timestamps) if timestamps else None
    end = min(at or now, latest) if latest else (at or now)
    start = end - timedelta(hours=hours)
    # Explicit synchronized drops and recurring reset windows are excluded even
    # for gauges that increased across the reset (new-cycle rain is ambiguous).
    events = [(datetime.fromisoformat(e["before"]), datetime.fromisoformat(e["at"]))
              for e in resets["decrease_events"]]
    daily_hours = {r["local_hour"] for r in resets["daily"]}
    points = []
    for name, rows in stations.items():
        available = [r for r in rows if r["at"] <= end]
        if not available:
            continue
        last = available[-1]
        total = 0.0
        excluded = 0
        valid_seconds = 0.0
        for before, after in zip(available, available[1:]):
            a, b = before["at"], after["at"]
            if b <= start or a >= end:
                continue
            delta = after["depth"] - before["depth"]
            reset = any(a < stop and b > begin for begin, stop in events)
            local = a.astimezone(ICT)
            for offset in range((b.date() - a.date()).days + 2):
                day = local.date() + timedelta(days=offset)
                for hour in daily_hours:
                    boundary = datetime.combine(day, datetime.min.time(), ICT).replace(hour=hour)
                    reset |= a < boundary + timedelta(minutes=15) and b > boundary
            if b - a > MAX_GAP or delta < -0.001 or reset or a < start:
                excluded += 1
                continue
            valid_seconds += (b - a).total_seconds()
            total += max(0, delta)
        coverage = min(1, valid_seconds / (hours * 3600))
        stale = end - last["at"] > MAX_GAP
        points.append({"station": name, "lat": last["lat"], "lon": last["lon"],
                       "rain_mm": round(total, 3) if coverage > 0 and not stale else None,
                       "coverage": round(coverage, 3), "excluded_intervals": excluded,
                       "partial": coverage < 0.9 or excluded > 0,
                       "observed_at": last["at"].isoformat(), "stale": stale})
    return {"points": points, "window_hours": hours, "start": start.isoformat(), "end": end.isoformat(),
            "history_start": min(timestamps).isoformat() if timestamps else None,
            "latest": latest.isoformat() if latest else None,
            "stale": latest is None or now - latest > MAX_GAP,
            "resets": resets,
            "method": "Positive gauge increases; reset, decrease and missing intervals excluded. "
                      "Updates are approximately hourly; partial totals are lower bounds."}
