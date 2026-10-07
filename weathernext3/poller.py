"""
Keeps every WeatherNext 3 run over HCMC: hourly rain, 1-48 h ahead, on the 0.1 deg grid, so it can
be scored against the cameras later.

Run: .venv/bin/python -u weathernext3/poller.py

The source: Google DeepMind's WeatherNext 3 ensemble, linked into BigQuery project
test-gemini-441412 as dataset weathernext_3 (Analytics Hub listing). A new run starts every hour and
appears about 7.5 h later; each covers 1-48 h ahead (the 00 UTC run, 1-360 h). Past runs stay in the table, so a gap is
backfilled on the next poll.

Cost: queried through the `bq` CLI (gcloud login halean111@gmail.com). BigQuery's dry-run estimate
for one run is ~875 GB, but the table is clustered by location and a run over the HCMC box bills
65-120 MB (checked 6 Oct 2026); the run list bills the 10 MB minimum. ~24 runs a day is ~3 GB a day,
inside the free 1 TB a month. A bytes-billed cap cannot guard this (BigQuery checks it against the
estimate and refuses), so each pull's bill is read back and the poller stops if one tops
WN_MAX_BILLED_MB.

Outputs:
  weathernext3/runs/<init YYYYmmddTHHZ>.csv   one row per cell per hour: rain in mm/h
    tp_*     the model's total precipitation, ensemble p10..p90 and mean
    imerg_*  the same calibrated to IMERG (satellite) rain
    exp_*    Google's experimental precipitation field
"""

import csv
import io
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.log_setup import get_logger

HERE = Path(__file__).resolve().parent
RUN_DIR = HERE / "runs"
PROJECT = "test-gemini-441412"
TABLE = f"`{PROJECT}.weathernext_3.weathernext_3_0_0_0p1deg`"
BOX = "POLYGON((106.35 10.35, 107.05 10.35, 107.05 11.20, 106.35 11.20, 106.35 10.35))"
POLL_SEC = int(os.getenv("WN_POLL_SEC", str(20 * 60)))
SINCE = os.getenv("WN_SINCE", "2026-10-01 00:00:00")      # backfill start (UTC); the camera logs start 1 Oct
MAX_BILLED_MB = float(os.getenv("WN_MAX_BILLED_MB", "1000"))
BQ = Path.home() / "google-cloud-sdk" / "bin" / "bq"

RAIN = {f"tp_{s}": f"total_precipitation_1hr_{s}" for s in ("p10", "p25", "p50", "p75", "p90", "mean")}
RAIN |= {f"imerg_{s}": f"imerg_tp_1hr_{s}" for s in ("p50", "p90", "mean")}
RAIN |= {f"exp_{s}": f"experimental_tp_1hr_{s}" for s in ("p50", "p90", "mean")}

log = get_logger("weathernext")


class OverBudget(Exception):
    pass


def bq(sql: str) -> list[dict]:
    """Run a query, check its bill, return the rows."""
    job = f"wn_{uuid.uuid4().hex}"
    out = subprocess.run([str(BQ), f"--project_id={PROJECT}", "--format=csv", "query", "--use_legacy_sql=false",
                          f"--job_id={job}", "--max_rows=1000000"],
                         input=sql, capture_output=True, text=True, timeout=900)
    if out.returncode:
        raise RuntimeError((out.stderr or out.stdout)[-500:])
    info = subprocess.run([str(BQ), f"--project_id={PROJECT}", "--format=json", "show", "-j", job],
                          capture_output=True, text=True, timeout=120)
    billed = int(json.loads(info.stdout)["statistics"]["query"].get("totalBytesBilled", 0)) / 1e6
    if billed > MAX_BILLED_MB:
        raise OverBudget(f"job {job} billed {billed:.0f} MB, over WN_MAX_BILLED_MB={MAX_BILLED_MB:.0f}")
    text = out.stdout[out.stdout.find("\n") + 1:] if out.stdout.startswith("Waiting") else out.stdout
    return list(csv.DictReader(io.StringIO(text)))


def run_times() -> list[str]:
    rows = bq(f"""SELECT DISTINCT FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', init_time) AS t FROM {TABLE}
                  WHERE init_time >= TIMESTAMP('{SINCE}') AND ST_INTERSECTS(geography, ST_GEOGPOINT(106.7, 10.8))
                  ORDER BY t""")
    return [r["t"] for r in rows]


def name(init: str) -> str:
    return datetime.strptime(init, "%Y-%m-%d %H:%M:%S").strftime("%Y%m%dT%HZ")


def pull(init: str) -> int:
    cols = ", ".join(f"ROUND(f.{src} * 1000, 4) AS {dst}" for dst, src in RAIN.items())   # metres -> mm
    rows = bq(f"""SELECT ST_Y(geography) AS lat, ST_X(geography) AS lon, f.time AS valid_utc, f.hours AS lead_h, {cols}
                  FROM {TABLE}, UNNEST(forecast) AS f
                  WHERE init_time = TIMESTAMP('{init}') AND ST_INTERSECTS(geography, ST_GEOGFROMTEXT('{BOX}'))
                  ORDER BY valid_utc, lat, lon""")
    if not rows:
        raise RuntimeError(f"run {init}: no rows")
    RUN_DIR.mkdir(exist_ok=True)
    tmp = RUN_DIR / f"{name(init)}.csv.tmp"
    with tmp.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["init_utc", *rows[0].keys()])
        w.writeheader()
        for r in rows:
            r["lat"], r["lon"] = f"{float(r['lat']):.2f}", f"{float(r['lon']):.2f}"
            w.writerow({"init_utc": init, **r})
    tmp.replace(RUN_DIR / f"{name(init)}.csv")
    return len(rows)


def main():
    log.info("polling WeatherNext 3 over HCMC every %ds, runs since %s", POLL_SEC, SINCE)
    while True:
        try:
            have = {p.stem for p in RUN_DIR.glob("*.csv")} if RUN_DIR.exists() else set()
            new = [t for t in run_times() if name(t) not in have]
            for t in new:
                log.info("run %s: %d rows", t, pull(t))
        except OverBudget as e:
            log.error("stopping: %s", e)
            return
        except Exception as e:                        # a missed poll costs nothing; the next one retries
            log.warning("poll failed: %s", str(e)[:300])
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
