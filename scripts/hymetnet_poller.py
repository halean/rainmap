"""Records Vietnam's official lightning feed (HYMETNET) as a raw append-only
log, the same shape as scripts/vrain_poller.py: collection only, so the
archive exists to build on later.

Design notes, mirroring vrain_poller.py's:
- The feed is the same unauthenticated JSON HYMETNET's own public map
  (hymetnet.gov.vn/lightningmaps/) fetches for anonymous visitors -- see
  app/services/lightning_vn.py for how it was found and its shape. No
  documented partner API is known; if HYMETNET ever publishes one, that is
  the route to take instead of this reverse-engineered endpoint.
- Every poll returns the *entire* current ~1 hour rolling window, not just
  what changed, so a missed poll or two loses nothing -- the next one
  catches up. Buckets refresh every 10 minutes; this polls more often than
  that only so a new bucket is picked up promptly, not to extract more data
  than the source actually has.
- Deduplication is against what is already on disk: at startup this reads
  every id already logged (a strike is uniquely (bucket, lat, lon), and a
  bucket's own content never changes once past), so a restart cannot
  re-append the same strike, and so it can run indefinitely without an
  in-memory set that only grows.
"""

import csv
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.log_setup import get_logger
from app.services.lightning_vn import normalize, parse_embedded_strikes

REPO = Path(__file__).resolve().parents[1]
# Two independent archives for the two sources -- see app/services/lightning_vn.py.
DONGSET_PATH = REPO / "data" / "derived" / "lightning_vn_history.csv"
DONGSET_FIELDS = ["id", "time", "bucket", "commune", "province", "lat", "lon"]
STRIKES_PATH = REPO / "data" / "derived" / "lightning_vn_strikes_history.csv"
STRIKES_FIELDS = ["id", "time", "lat", "lon", "current_ka", "sensor_count", "dof", "kind"]

HYMETNET_URL = "http://hymetnet.gov.vn/dongset"  # no HTTPS on this host; verified, not an oversight
LIGHTNINGMAPS_URL = "http://hymetnet.gov.vn/lightningmaps/"
POLL_INTERVAL_SEC = 180
TIMEOUT_SEC = 30

log = get_logger("hymetnet_poller")


def load_seen_ids(path: Path) -> set:
    if not path.exists():
        return set()
    with path.open(newline="", encoding="utf-8") as f:
        return {row["id"] for row in csv.DictReader(f) if row.get("id")}


def fetch_dongset() -> dict:
    r = requests.get(HYMETNET_URL, timeout=TIMEOUT_SEC, headers={"Accept": "application/json"})
    r.raise_for_status()
    return r.json()


def fetch_lightningmaps_html() -> str:
    r = requests.get(LIGHTNINGMAPS_URL, timeout=TIMEOUT_SEC, headers={"Accept": "text/html"})
    r.raise_for_status()
    return r.text


def append_rows(path: Path, fields: list[str], rows: list[dict]) -> None:
    write_header = not path.exists()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        if write_header:
            writer.writeheader()
        writer.writerows(rows)


def poll_dongset_once(seen: set) -> int:
    records = normalize(fetch_dongset())
    if not records:
        # Legitimately possible (no lightning anywhere in the country this
        # hour) but also what a reshaped response looks like, so it is worth
        # a line in the log either way -- just not an exception.
        log.info("dongset: no strikes in the current window")
        return 0
    fresh = [r for r in records if r["id"] not in seen]
    if not fresh:
        return 0
    append_rows(DONGSET_PATH, DONGSET_FIELDS, [{k: r[k] for k in DONGSET_FIELDS} for r in fresh])
    seen.update(r["id"] for r in fresh)
    return len(fresh)


def poll_strikes_once(seen: set) -> int:
    records = parse_embedded_strikes(fetch_lightningmaps_html())
    if not records:
        # Unlike dongset's, an empty result here is the more suspicious
        # case: the page always renders *some* recent window in practice,
        # so this usually means the embed was restructured, not that
        # nothing struck anywhere the sensors reach.
        log.warning("strikes: none found in the page -- its embedded format may have changed")
        return 0
    fresh = [r for r in records if r["id"] not in seen]
    if not fresh:
        return 0
    append_rows(STRIKES_PATH, STRIKES_FIELDS, [{k: r[k] for k in STRIKES_FIELDS} for r in fresh])
    seen.update(r["id"] for r in fresh)
    return len(fresh)


def main():
    dongset_seen = load_seen_ids(DONGSET_PATH)
    strikes_seen = load_seen_ids(STRIKES_PATH)
    log.info("hymetnet poller starting: every %ds, %d dongset + %d strike records already logged",
             POLL_INTERVAL_SEC, len(dongset_seen), len(strikes_seen))
    while True:
        try:
            n = poll_dongset_once(dongset_seen)
            if n:
                log.info("dongset: recorded %d new entr%s", n, "y" if n == 1 else "ies")
        except Exception as e:
            # A collector that dies on a transient network blip loses the
            # whole series; the next tick is only POLL_INTERVAL_SEC away.
            log.warning("dongset poll failed: %s", e)
        try:
            n = poll_strikes_once(strikes_seen)
            if n:
                log.info("strikes: recorded %d new strike(s)", n)
        except Exception as e:
            log.warning("strikes poll failed: %s", e)
        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main()
