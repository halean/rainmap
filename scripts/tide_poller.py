"""
Records the official tide forecast for the Saigon River from the Southern Regional Hydro-
Meteorological Station (Dai KTTV Nam Bo, kttvnb.vn): its daily "5-day tide characteristics"
bulletin, a PDF, with the measured highs and lows of the day before and forecast highs and lows,
with times, for Phu An, Nha Be and Thu Dau Mot. Heights are on the Hon Dau datum -- the scale the
city's alert levels (BD I/II/III = 1.40/1.50/1.60 m at Phu An) and the flood-risk map use.

Run: .venv/bin/python -u scripts/tide_poller.py        (needs `pdftotext`, poppler-utils)
Polls from 09:30 Vietnam time, every 30 minutes until the day's bulletin is online (latest 14:00).

Why the forecast and not a gauge: no live water level for Phu An is public. VRAIN's water service
(core-api.vrain.vn/vwater) needs a login, and HYMETNET publishes none. The bulletin is the official
forecast, so it already carries the forecasters' allowance for river flow and monsoon wind on top
of the astronomical tide -- the part a pure tide prediction misses, and at Phu An 10-30 cm of it.
app/services/tide.py turns the highs and lows into a level for any moment.

Outputs:
  data/derived/tide_kttvnb.json     the latest bulletin, parsed
  data/derived/tide_observed.csv    every measured high and low, appended once each -- the record
                                    against which the forecasts can later be scored
"""

import csv
import json
import re
import subprocess
import sys
import tempfile
import time
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import urllib3

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.atomic_write import write_json_atomic
from app.log_setup import get_logger

REPO = Path(__file__).resolve().parents[1]
OUT_PATH = REPO / "data" / "derived" / "tide_kttvnb.json"
OBSERVED_PATH = REPO / "data" / "derived" / "tide_observed.csv"
SITE = "https://kttvnb.vn"
SECTION_URL = SITE + "/index.php/thong-tin-kttv/thuy-van"
# When to look, Vietnam time. One bulletin a day, weekends included, issued 08:59-09:37 but put
# online later: across 9 Sep - 1 Oct 2026 the PDFs were uploaded (Last-Modified) between 09:21 and
# 11:26. So: first look at 09:30, just after the earliest upload seen, then every 30 minutes until
# today's bulletin is there -- each new one is picked up within half an hour of going online --
# giving up at 14:00. The previous bulletin covers five days, so a day it never comes costs little.
FIRST_POLL_ICT = (9, 30)
RETRY_MIN = 30
GIVE_UP_ICT = (14, 0)
TIMEOUT_SEC = 60
ICT = timezone(timedelta(hours=7))

# The slug of "Ban tin du bao thuy van TPHCM ra ngay DD-MM-YYYY" as the site writes it. The same
# bulletin (same PDF, HCMC_TVHN_<date>.pdf) is sometimes titled "Ban tin du bao thuy van han ngan khu vuc
# TP Ho Chi Minh ra ngay ..." -- 8 and 9 Oct 2026 -- and was missed until both titles were accepted.
BULLETIN_RE = re.compile(r'href="([^"]*/(\d{4,7})-ba-n-tin-da-ba-o-tha-y-v-n-'
                         r'(?:tphcm|ha-n-nga-n-khu-va-c-tp-ha-cha-minh)-ra-nga-y-(\d{1,2})-(\d{1,2})-(\d{4}))"')
PDF_RE = re.compile(r'(https?://kttvnb\.vn/attachments/article/\d+/[^"\s]+\.pdf)')
STATIONS = {"Phú An": "phu_an", "Nhà Bè": "nha_be", "Thủ Dầu Một": "thu_dau_mot"}
TOKEN_RE = re.compile(r"-?\d+\.\d+|ct|\*")
KINDS = ["high", "high", "low", "low"]  # column order in both tables: two highs, then two lows

log = get_logger("tide_poller")


def _clock(token: str) -> tuple[int, int] | None:
    """'06.00' -> (6, 0); '0.30' -> (0, 30); 'ct' -> None."""
    if not re.fullmatch(r"\d{1,2}\.\d{2}", token):
        return None
    h, m = token.split(".")
    return int(h), int(m)


def _extremes(tokens: list[str], day: datetime) -> list[dict]:
    """Four (height, clock) pairs -> extremes on `day`. 'ct' (no second high or low that day) and
    '*' (no data) pairs are skipped. Each time belongs to the row's own date: the 00:xx entries are
    that morning's, which keeps the series alternating high, low, high, low."""
    out = []
    for k in range(4):
        if 2 * k + 1 >= len(tokens):
            break
        h, c = tokens[2 * k], _clock(tokens[2 * k + 1])
        if c is None or not re.fullmatch(r"-?\d+\.\d+", h):
            continue
        t = day.replace(hour=c[0] % 24, minute=c[1])
        out.append({"t": t.isoformat(), "h": float(h), "kind": KINDS[k]})
    return sorted(out, key=lambda e: e["t"])


def _station_in(line: str) -> str | None:
    for name, key in STATIONS.items():
        if line.strip().startswith(name) or re.search(rf"\s{name}\s", " " + line + " "):
            return key
    return None


def parse_bulletin(text: str) -> dict:
    issued = re.search(r"Tin phát lúc:\s*(\d{1,2}):(\d{2}) giờ ngày (\d{1,2}) tháng (\d{1,2}) năm (\d{4})", text)
    if not issued:
        raise ValueError("no issue time found")
    hh, mm, d, mo, y = map(int, issued.groups())
    issued_at = datetime(y, mo, d, hh, mm, tzinfo=ICT)

    obs = re.search(r"MỰC NƯỚC THỰC ĐO NGÀY (\d{2})/(\d{2})/(\d{4})", text)
    fc_at = text.find("MỰC NƯỚC DỰ BÁO")
    if not obs or fc_at < 0:
        raise ValueError("tables not found")
    obs_day = datetime(int(obs.group(3)), int(obs.group(2)), int(obs.group(1)), tzinfo=ICT)

    stations = {key: {"name": name, "observed": [], "forecast": []} for name, key in STATIONS.items()}
    for line in text[obs.end():fc_at].splitlines():
        key = _station_in(line)
        if key:
            stations[key]["observed"] = _extremes(TOKEN_RE.findall(line), obs_day)

    # Forecast rows: "  [Station]  DD/MM  H  hh.mm  H  hh.mm  H  hh.mm  H  hh.mm", five per station,
    # the name on whichever row the layout put it. A block ends when the date stops increasing.
    blocks, cur, prev = [], None, None
    for line in text[fc_at:].splitlines():
        m = re.search(r"(?<![\d/])(\d{2})/(\d{2})(?![\d/])\s+(.*)$", line)
        if not m:
            continue
        day, month = int(m.group(1)), int(m.group(2))
        year = issued_at.year + (1 if month < issued_at.month else 0)  # a December bulletin forecasting into January
        date = datetime(year, month, day, tzinfo=ICT)
        if cur is None or prev is None or date <= prev:
            cur = {"station": None, "rows": []}
            blocks.append(cur)
        prev = date
        cur["rows"].append((date, TOKEN_RE.findall(m.group(3))))
        key = _station_in(line[:m.start()])
        if key:
            cur["station"] = key
    for b in blocks:
        if b["station"]:
            stations[b["station"]]["forecast"] = sorted(
                (e for date, tokens in b["rows"] for e in _extremes(tokens, date)), key=lambda e: e["t"])

    alerts = dict(re.findall(r"BĐ (I{1,3}) : (\d\.\d{2}) m", text))
    return {
        "issued_at": issued_at.isoformat(),
        "observed_date": obs_day.date().isoformat(),
        "datum": "Hon Dau",
        "alert_levels_m": {k: float(v) for k, v in alerts.items()} or {"I": 1.40, "II": 1.50, "III": 1.60},
        "stations": stations,
    }


def get(session: requests.Session, url: str) -> requests.Response:
    """GET, falling back to an unverified connection when the site's certificate fails to verify.
    kttvnb.vn's certificate expired on 9 Oct 2026; the bulletins are public, so the cost of trusting
    an unverified answer is at worst a wrong tide forecast, against no forecast at all. Every fallback
    is logged, so the log shows when the site renews it."""
    try:
        return session.get(url, timeout=TIMEOUT_SEC)
    except requests.exceptions.SSLError as e:
        log.warning("certificate check failed for %s (%s); fetching unverified", url.split("/")[2],
                    str(e).split("certificate verify failed: ")[-1].split(" (_ssl")[0][:60])
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", urllib3.exceptions.InsecureRequestWarning)
            return session.get(url, timeout=TIMEOUT_SEC, verify=False)


def latest_bulletin_url(session: requests.Session) -> tuple[str, str]:
    html = get(session, SECTION_URL).text
    found = BULLETIN_RE.findall(html)
    if not found:
        raise ValueError("no bulletin link on the section page -- the slug may have changed")
    href, art_id, d, m, y = max(found, key=lambda f: int(f[1]))  # highest article id = newest
    page = SITE + href if href.startswith("/") else href
    pdf = PDF_RE.search(get(session, page).text)
    if not pdf:
        raise ValueError(f"no PDF attached to {page}")
    return page, pdf.group(1)


def pdf_text(session: requests.Session, url: str) -> str:
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "b.pdf"
        p.write_bytes(get(session, url).content)
        return subprocess.run(["pdftotext", "-layout", str(p), "-"], check=True, capture_output=True,
                              text=True, timeout=60).stdout


def record_observed(parsed: dict) -> int:
    seen = set()
    if OBSERVED_PATH.exists():
        with OBSERVED_PATH.open(newline="", encoding="utf-8") as f:
            seen = {(r["station"], r["t"]) for r in csv.DictReader(f)}
    rows = [{"station": key, "t": e["t"], "h_m": e["h"], "kind": e["kind"], "bulletin": parsed["issued_at"]}
            for key, st in parsed["stations"].items() for e in st["observed"] if (key, e["t"]) not in seen]
    if rows:
        new = not OBSERVED_PATH.exists()
        with OBSERVED_PATH.open("a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["station", "t", "h_m", "kind", "bulletin"])
            if new:
                w.writeheader()
            w.writerows(rows)
    return len(rows)


def poll_once(session: requests.Session) -> str:
    page, pdf = latest_bulletin_url(session)
    parsed = parse_bulletin(pdf_text(session, pdf))
    if not parsed["stations"]["phu_an"]["forecast"]:
        raise ValueError("bulletin parsed but has no Phu An forecast -- layout may have changed")
    parsed.update(source_page=page, pdf_url=pdf, fetched_at=datetime.now(timezone.utc).isoformat())
    write_json_atomic(OUT_PATH, parsed)
    n = record_observed(parsed)
    pa = parsed["stations"]["phu_an"]["forecast"]
    return f"bulletin {parsed['issued_at']}: Phu An {len(pa)} forecast extremes, {n} new observed"


def next_poll(now: datetime, have_today: bool) -> datetime:
    """When to look next: the next slot in today's 09:30-14:00 window while today's bulletin is
    still missing, otherwise tomorrow's 09:30."""
    local = now.astimezone(ICT)
    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    first = day.replace(hour=FIRST_POLL_ICT[0], minute=FIRST_POLL_ICT[1])
    last = day.replace(hour=GIVE_UP_ICT[0], minute=GIVE_UP_ICT[1])
    if not have_today and local < last:
        if local < first:
            return first
        steps = int((local - first).total_seconds() // (RETRY_MIN * 60)) + 1
        t = first + timedelta(minutes=RETRY_MIN * steps)
        if t <= last:
            return t
    return first + timedelta(days=1)


def bulletin_date() -> str | None:
    """The Vietnam-time date of the saved bulletin's issue, or None."""
    try:
        return datetime.fromisoformat(json.loads(OUT_PATH.read_text())["issued_at"]).astimezone(ICT).date().isoformat()
    except (OSError, ValueError, KeyError):
        return None


def poll(session: requests.Session) -> None:
    try:
        log.info(poll_once(session))
    except Exception as e:
        # A missed poll costs nothing while the last bulletin covers five days.
        log.warning("poll failed: %s", e)


def main():
    log.info("tide poller starting: from %02d:%02d ICT every %d min until the day's bulletin is online (until %02d:%02d) -> %s",
             *FIRST_POLL_ICT, RETRY_MIN, *GIVE_UP_ICT, OUT_PATH)
    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0"
    # Only if there is nothing yet: a restart must not leave the map without a tide until the next slot.
    if not OUT_PATH.exists():
        poll(session)
    while True:
        now = datetime.now(timezone.utc)
        today = now.astimezone(ICT).date().isoformat()
        have_today = bulletin_date() == today
        due = next_poll(now, have_today)
        if not have_today and due.date().isoformat() != today and now.astimezone(ICT).hour >= GIVE_UP_ICT[0]:
            log.warning("no bulletin for %s by %02d:%02d; trying again tomorrow", today, *GIVE_UP_ICT)
        log.info("next poll %s", due.isoformat())
        # Sleep in steps, so a suspended or clock-adjusted host still wakes close to the slot.
        while (left := (due - datetime.now(timezone.utc)).total_seconds()) > 0:
            time.sleep(min(left, 600))
        poll(session)


if __name__ == "__main__":
    main()
