"""Parsing and merging for Tan Son Nhat's official flight board (tia.vietnamairport.vn).

This is the airport operator's own live departure/arrival display, not a
documented API: a Blazor Server app whose six pages -- {Arr,Dep}{Dom,VJ,Int}
for {arrival,departure} x {non-VietJet domestic, VietJet domestic,
international} -- each carry a live Kendo grid over a persistent WebSocket.
`scripts/tia_poller.py` drives a headless browser to read them (see that
file for why); everything in this module is a pure data transform so it can
be unit tested without a browser.

Column layout, read straight off the grid (positional, not by header text,
since the header row is hidden behind the same Kendo markup on every page):
  arrival:   STD, ETD, From,        Flight, Terminal, Belt, Remark
  departure: STD, ETD, Destination, Flight, Terminal, Row,  Gate, Remark

The board shows only clock times (no date) for the current day's rotation,
carries its remarks in whichever of Vietnamese/English the display happens to
be showing when scraped (the language itself rotates), and a heavily
code-shared departure's Flight cell is sometimes visually truncated by the
grid ("AY 6252,EY7311,...,SQ" with no trailing number) -- the first code is
kept as the operating flight, the raw cell as `codeshare_raw`.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc
LOCAL = ZoneInfo("Asia/Ho_Chi_Minh")

# The board's departure times are gate/off-block times (STD) or the live
# estimate of the same (ETD), never a runway time. 3d/flights-motion.js
# treats a departure's `time` as the take-off/rotation instant, so this is
# added to approximate taxi-out -- matching the assumption already stated in
# 3d/README.md and app/services/flights.py's own (sample-schedule) TAXI_OUT.
DEPARTURE_TAXI_OUT = timedelta(minutes=15)

# Path segment -> (kind, carrier group). The carrier group is provenance only;
# the row's own Terminal cell is what the viewer uses.
LINKS = {
    "ArrDom": ("arrival", "domestic"),
    "ArrVJ": ("arrival", "vietjet"),
    "ArrInt": ("arrival", "international"),
    "DepDom": ("departure", "domestic"),
    "DepVJ": ("departure", "vietjet"),
    "DepInt": ("departure", "international"),
}
ARRIVAL_FIELDS = ("std", "etd", "other", "flight", "terminal", "belt", "remark")
DEPARTURE_FIELDS = ("std", "etd", "other", "flight", "terminal", "row", "gate", "remark")

# Both languages the board has been observed to show, mapped to a small,
# stable status vocabulary the viewer can render without caring which
# language happened to be showing when a row was scraped. Matched by
# substring, case-insensitively, longest phrase first so e.g. "Last boarding"
# is not shadowed by "Boarding".
_STATUS_PHRASES = [
    ("đã hạ cánh", "Arrived"), ("landed", "Arrived"),
    ("đã cất cánh", "Departed"), ("departed", "Departed"),
    ("đến trễ", "Delayed"), ("delayed", "Delayed"), ("late", "Delayed"),
    ("hành khách cuối lên tàu bay", "GateClosed"), ("last boarding", "GateClosed"),
    ("đóng cửa khởi hành", "GateClosed"), ("gate closed", "GateClosed"),
    ("đổi cửa khởi hành", "Boarding"), ("gate change", "Boarding"),
    ("hành khách lên tàu bay", "Boarding"), ("boarding", "Boarding"),
    ("đóng quầy thủ tục", "CheckIn"), ("hành khách cuối làm thủ tục", "CheckIn"),
    ("last check-in", "CheckIn"),
    ("mời hành khách làm thủ tục", "CheckIn"), ("check-in", "CheckIn"),
    ("hủy chuyến", "Canceled"), ("cancel", "Canceled"),
]


def status_of(remark):
    text = (remark or "").strip().lower()
    for phrase, status in _STATUS_PHRASES:
        if phrase in text:
            return status
    return "Expected" if text else "Unknown"


def parse_row(kind, cells):
    """Positional grid cells into a labelled dict. `kind` is 'arrival' or
    'departure' (picks the 7- vs 8-column layout). Returns None for a row
    that doesn't match either shape, rather than guessing."""
    fields = ARRIVAL_FIELDS if kind == "arrival" else DEPARTURE_FIELDS
    if len(cells) != len(fields):
        return None
    return dict(zip(fields, (c.strip() for c in cells)))


def _flight_identity(raw):
    """The first flight number in a possibly comma-separated, sometimes
    truncated codeshare cell, e.g. 'AY 6252,EY7311,...,SQ' -> 'AY 6252'."""
    first = raw.split(",")[0].strip()
    return first or raw.strip()


def _parse_clock(value, now_local):
    """'HH:MM' -> the nearest UTC instant to `now_local`, allowing a day
    rollover either way: the board only shows the current rotation, so a time
    that reads many hours in the past or future almost certainly belongs to
    the adjacent calendar day rather than today."""
    value = (value or "").strip()
    if not value or ":" not in value:
        return None
    try:
        hour, minute = (int(p) for p in value.split(":", 1))
    except ValueError:
        return None
    if not (0 <= hour < 24 and 0 <= minute < 60):
        return None
    candidate = now_local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    for offset in (-1, 0, 1):
        shifted = candidate + timedelta(days=offset)
        if abs((shifted - now_local).total_seconds()) <= 14 * 3600:
            return shifted.astimezone(UTC)
    return candidate.astimezone(UTC)


def _iso(when):
    return when.astimezone(UTC).isoformat().replace("+00:00", "Z") if when else None


def normalize_row(kind, link, row, now):
    """One parsed row into the shape app/services/flights.py's viewer schema
    uses. `time` prefers ETD (the board's live estimate) over STD; the board
    gives no separate runway/touchdown time, so 'estimated'/'scheduled' is as
    precise as time_source gets here."""
    now_local = now.astimezone(LOCAL)
    std = _parse_clock(row["std"], now_local)
    etd = _parse_clock(row["etd"], now_local)
    best, source = (etd, "estimated") if etd else (std, "scheduled")
    if not best:
        return None
    if kind == "departure":
        # `scheduled`/`revised` below keep the board's own gate times for
        # display; only `time` (what the animation uses) gets the taxi-out
        # allowance -- see DEPARTURE_TAXI_OUT above and 3d/README.md.
        best = best + DEPARTURE_TAXI_OUT
    flight_raw = row["flight"]
    number = _flight_identity(flight_raw)
    remark = row["remark"]
    return {
        "id": f"tia:{kind}:{link}:{number}:{_iso(std or best)}",
        "kind": kind,
        "number": number or None,
        "callsign": None,
        "airline": None,
        "aircraft": None,
        "registration": None,
        "size": "narrow",  # the board carries no aircraft type; see 3d/flights.js
        "other": {"iata": None, "icao": None, "name": row["other"], "lat": None, "lon": None},
        "scheduled": _iso(std),
        "revised": _iso(etd) if etd else None,
        "runway_time": None,
        "time": _iso(best),
        "time_source": source,
        "runway": None,
        "status": status_of(remark),
        "cargo": False,
        "quality": ["Live"],
        "terminal": row["terminal"] or None,
        "gate": row.get("gate") or None,
        "belt": row.get("belt") or None,
        "checkin_row": row.get("row") or None,
        "remark": remark or None,
        "codeshare_raw": flight_raw if "," in flight_raw else None,
        "source_link": link,
        "seen_at": _iso(now),
    }


def rows_from_grid(link, cells_by_row, now):
    """A poll's captured rows (list of cell-text lists) into normalized
    flights. Malformed rows are skipped, not raised on -- one grid glitch
    should not drop the whole poll."""
    kind = LINKS[link][0]
    out = []
    for cells in cells_by_row:
        row = parse_row(kind, cells)
        if row is None:
            continue
        flight = normalize_row(kind, link, row, now)
        if flight:
            out.append(flight)
    return out


# How long a flight is kept after its last sighting. The board drops a
# movement from its grid once it scrolls past (or is well past its time), and
# the six-link rotation only revisits any one page every ~6 minutes, so this
# has to comfortably outlast one full cycle.
STALE_AFTER_MINUTES = 20


def merge(previous, fresh, now, stale_after_minutes=STALE_AFTER_MINUTES):
    """Fold one poll's rows into the running set, keyed by id. A flight not
    re-seen this poll keeps its last known fields until `stale_after_minutes`
    of silence, so a single missed rotation slot doesn't blank it out."""
    merged = {f["id"]: dict(f) for f in previous}
    for f in fresh:
        merged[f["id"]] = f
    cutoff = now - timedelta(minutes=stale_after_minutes)
    return [f for f in merged.values() if datetime.fromisoformat(f["seen_at"].replace("Z", "+00:00")) >= cutoff]
