"""The southern maritime pilots' daily plan for the Ho Chi Minh City area.

Hoa tiêu Hàng hải Miền Nam publishes, on a public page with no login, the
ships its pilots will take in, out, and between berths today and yesterday:

    https://www.pilotcosouth.vn/ke-hoach-dieu-dong-tau/hoa-tieu-hang-hai-mien-nam-khu-vuc-tphcm-2

Each day ("KẾ HOẠCH DẪN TÀU TRONG NGÀY dd.mm.yyyy") has three tables, in this
order: Tàu vào cảng (inbound), Tàu rời cảng (outbound), Tàu dời tại cảng
(shifting). Columns: N., Hoa tiêu (pilot), the ship, M'n (draft, m), Dài
(length, m), GRT, Cầu bến (berth; "FROM - TO" for shifts), Cano (pilot boat,
inbound only), T.g (time), Ghi chú (notes). The notes carry status markers in
"●(...)": Đổi giờ (time changed), Bỏ (cancelled), Lùi ngày (postponed to
another day), "HT … đổi tàu" (pilot changed), ĐX; and often "Eta HHMM".

It is a plan, not tracking: times move during the day, and it covers only
ships large enough to need a pilot. Pilot names, and the captains' and agents'
phone numbers some notes carry, are published but dropped here -- nothing
on the map needs them.

Berth codes are placed with data/metadata/pilot_berths.json; codes it doesn't
cover are left unplaced rather than guessed.
"""

import html
import json
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

from app.atomic_write import write_json_atomic

ICT = timezone(timedelta(hours=7))
URL = "https://www.pilotcosouth.vn/ke-hoach-dieu-dong-tau/hoa-tieu-hang-hai-mien-nam-khu-vuc-tphcm-2"
STORE = Path("data/derived/pilot_plan.json")
BERTHS = Path("data/metadata/pilot_berths.json")
REFRESH = timedelta(minutes=30)
TIMEOUT_SEC = 30

KINDS = {"Tàu vào cảng": "inbound", "Tàu rời cảng": "outbound", "Tàu dời tại cảng": "shift"}
DAY_RE = re.compile(r"KẾ HOẠCH DẪN TÀU TRONG NGÀY\s+(\d{1,2})\.(\d{1,2})\.(\d{4})")
MARKS = {"Đổi giờ": "time_changed", "Bỏ": "cancelled", "Lùi ngày": "postponed"}


class PlanUnavailable(Exception):
    pass


def _text(fragment):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


def _number(value):
    try:
        return float(value.replace(",", "."))
    except (AttributeError, ValueError):
        return None


PHONE_RE = re.compile(r"(?<!\d)(?:\+?84|0)\d{8,10}(?!\d)")


def scrub(notes):
    """Notes without people's details: pilots' names in "HT … đổi tàu" and the
    phone numbers of captains and agents ("CAPT 09…", "ĐL 09…")."""
    notes = re.sub(r"HT\s+[^;)]*đổi tàu", "HT đổi tàu", notes)
    return " ".join(PHONE_RE.sub("[phone]", notes).split())


def normalise_code(raw):
    """'H.LONG 2(NR)' -> 'H.LONG 2', 'B20NR' -> 'B20', 'N.BE 03' -> 'N.BE 3'."""
    code = re.sub(r"\([^)]*\)", " ", raw.upper())
    code = re.sub(r"(?<=\d)\s*N[RL]\b", " ", code)
    code = re.sub(r"\b0+(\d)", r"\1", code)
    return " ".join(code.split())


def split_berths(raw, kind):
    """A shift's berth cell is 'FROM - TO'. A bare hyphen also separates two
    berths ('VK102-N.BE 2') unless one side has no letters, as in 'VT-02'."""
    if kind == "shift":
        parts = [p.strip() for p in re.split(r"\s+-\s+", raw) if p.strip()]
        if len(parts) == 1 and "-" in raw:
            a, _, b = raw.partition("-")
            if re.search(r"[A-Za-z]", a) and re.search(r"[A-Za-z]", b):
                parts = [a.strip(), b.strip()]
        if len(parts) == 2:
            return parts
    return [raw.strip()] if raw.strip() else []


def load_berths(path=BERTHS):
    return json.loads(Path(path).read_text(encoding="utf-8"))["berths"]


def locate(raw, berths):
    """The berths-table entry for a raw code, or None."""
    code = normalise_code(raw)
    for b in berths:
        if code in [normalise_code(c) for c in b.get("codes", [])] \
                or ("prefix" in b and code.startswith(b["prefix"])) \
                or ("pattern" in b and re.match(b["pattern"], code)):
            return {"code": code, "name": b["name"], "lat": b["lat"], "lon": b["lon"],
                    "confidence": b["confidence"], "osm": b["osm"]}
    return None


def _clock(value, day):
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", value or "")
    if not m:
        return None
    return datetime(day.year, day.month, day.day, int(m[1]), int(m[2]), tzinfo=ICT).isoformat()


def parse(page, berths):
    """The plan page -> [{"date", "movements": [...]}], newest day first."""
    # The page mixes precomposed and decomposed Vietnamese (its "Lùi ngày" is
    # letters plus combining accents), so compare in one form.
    page = unicodedata.normalize("NFC", page)
    days = [date(int(y), int(m), int(d)) for d, m, y in DAY_RE.findall(_text(page))]
    tables = re.findall(r"<table.*?</table>", page, re.S | re.I)
    parsed, unplaced = [], set()
    table_day = -1
    for table in tables:
        rows = [[_text(c) for c in re.findall(r"<t[dh].*?</t[dh]>", r, re.S | re.I)]
                for r in re.findall(r"<tr.*?</tr>", table, re.S | re.I)]
        if not rows:
            continue
        header = rows[0]
        kind = next((KINDS[h] for h in header if h in KINDS), None)
        if kind is None:
            continue
        if kind == "inbound":
            table_day += 1          # each day's block starts with its inbound table
        if not 0 <= table_day < len(days):
            raise PlanUnavailable("more ship tables than day headings; the page layout changed")
        day = days[table_day]
        col = {name: i for i, name in enumerate(header)}
        ship_col = next(i for i, h in enumerate(header) if h in KINDS)
        for r in rows[1:]:
            if len(r) < len(header) or not r[ship_col]:
                continue
            get = lambda name: r[col[name]] if name in col else ""
            notes = get("Ghi chú")
            marks = [m.strip() for group in re.findall(r"\(([^)]*)\)", notes) for m in group.split(";")]
            eta = re.search(r"\bETA\s*(\d{2})(\d{2})\b", notes, re.I)
            codes = split_berths(get("Cầu bến"), kind)
            places = [locate(c, berths) for c in codes]
            unplaced.update(normalise_code(c) for c, p in zip(codes, places) if p is None)
            parsed.append({
                "date": day.isoformat(),
                "kind": kind,
                "vessel": r[ship_col],
                "draft_m": _number(get("M'n")),
                "length_m": _number(get("Dài")),
                "grt": _number(get("GRT")),
                "berth_raw": get("Cầu bến"),
                "from": places[0] if kind == "shift" and len(places) == 2 else None,
                "to": places[1] if kind == "shift" and len(places) == 2 else None,
                "berth": places[0] if kind != "shift" and places else None,
                "time": _clock(get("T.g"), day),
                "pilot_boat": _clock(get("Cano"), day),
                "eta": _clock(f"{eta[1]}:{eta[2]}", day) if eta else None,
                **{flag: any(m == key for m in marks) for key, flag in MARKS.items()},
                "pilot_changed": any("đổi tàu" in m for m in marks),
                "notes": scrub(notes),
            })
    by_day = {}
    for m in parsed:
        by_day.setdefault(m["date"], []).append(m)
    return {"days": [{"date": d, "movements": by_day[d]} for d in sorted(by_day, reverse=True)],
            "unplaced_berths": sorted(unplaced)}


def fetch(session=None):
    s = session or requests
    r = s.get(URL, timeout=TIMEOUT_SEC, headers={"User-Agent": "hcmc-rainmap (personal project)"})
    r.raise_for_status()
    r.encoding = r.encoding or "utf-8"
    return r.text


def plan(now=None, store=STORE, fetcher=fetch, berths_path=BERTHS):
    """The latest plan, refetched at most every REFRESH; the last good copy is
    served (marked stale) if a refetch fails."""
    now = now or datetime.now(timezone.utc)
    cached = None
    if store.exists():
        try:
            cached = json.loads(store.read_text())
        except (OSError, ValueError):
            cached = None
    if cached and now - datetime.fromisoformat(cached["fetched_at"]) < REFRESH:
        return cached
    try:
        record = {"source": URL, "fetched_at": now.isoformat(),
                  **parse(fetcher(), load_berths(berths_path))}
        if not record["days"]:
            raise PlanUnavailable("no ship tables found on the page")
    except (requests.RequestException, PlanUnavailable, ValueError) as e:
        if cached:
            return {**cached, "stale": True, "error": str(e)}
        raise PlanUnavailable(f"pilot plan unavailable: {e}") from e
    store.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(store, record)
    return record
