"""
How good is HYMETNET's rain nowcast at the cameras?

Run: .venv/bin/python scripts/nowcast_eval.py [--since 2026-10-05T22:00]

Inputs (both written by scripts/hymetnet_rain_poller.py):
  data/derived/hymetnet_rain_cameras.csv   every run: measured (lead <= 0) and forecast (+1..+6 h)
                                           rain rate at every camera, mm/h (max within ~1.5 km)
Truth: the cameras. A camera "saw rain" in the hour ending at the frame's valid time if the map
(Gemma + the live veto, data/derived/rain_shadow.csv) called rain on any of its frames in that hour.
That is the map's verdict, not a hand label -- imperfect, but the same truth for every reader below.

Compared, at each lead time, on the same camera-hours:
  forecast      the run issued `lead` hours before the valid time
  persistence   that same run's MEASURED rain at its issue hour, held unchanged ("next hour = now")
  measured      HYMETNET's measured rain for the valid hour itself, published ~45 min after the hour:
                the ceiling for any product drawn from this rain map, not usable live
Scores: AUC of the mm/h value, and POD / FAR / CSI with rain = >= 1 mm/h.
"""

import argparse
import csv
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
from sklearn.metrics import roc_auc_score

D = Path(__file__).resolve().parents[1] / "data" / "derived"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-10-05T22:00")
    args = ap.parse_args()

    fc = defaultdict(dict)        # (valid, camera) -> {lead: mm/h}
    meas = {}                     # (valid, camera) -> (lead, mm/h), keep the most refined (lowest lead)
    issue = {}                    # (run, camera) -> measured mm/h at the run's own hour (lead 0)
    for r in csv.DictReader((D / "hymetnet_rain_cameras.csv").open()):
        lead, v, cam, mm = int(r["lead_h"]), r["valid_utc"], r["camera_id"], float(r["mmh_1500m"])
        if lead > 0:
            fc[(v, cam)][lead] = (r["run_utc"], mm)
        else:
            if (v, cam) not in meas or lead < meas[(v, cam)][0]:
                meas[(v, cam)] = (lead, mm)
            if lead == 0:
                issue[(r["run_utc"], cam)] = mm

    seen = defaultdict(lambda: [0, 0])      # (valid hour, camera) -> [frames, rain frames]
    for r in csv.DictReader((D / "rain_shadow.csv").open(encoding="utf-8")):
        if not r["captured_at"] or r["captured_at"] < args.since:
            continue
        t = datetime.fromisoformat(r["captured_at"])
        valid = (t.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)).isoformat()
        s = seen[(valid, r["camera_id"])]
        s[0] += 1
        s[1] += (r.get("final") or r["gemma"]) != "No"

    print(f"camera-hours with map readings since {args.since}: {len(seen)}, "
          f"with rain {sum(v[1] > 0 for v in seen.values())}")
    print(f"{'lead':>4} {'n':>5} {'rain':>5} | {'forecast':^22} | {'persistence':^22} | {'measured (not live)':^22}")
    print(f"{'':>16}| {'AUC   POD  FAR  CSI':^22} | {'AUC   POD  FAR  CSI':^22} | {'AUC   POD  FAR  CSI':^22}")
    for lead in range(1, 7):
        y, f, p, m = [], [], [], []
        for (valid, cam), s in seen.items():
            got = fc.get((valid, cam), {}).get(lead)
            if not got or (valid, cam) not in meas:
                continue
            run, mm = got
            if (run, cam) not in issue:
                continue
            y.append(s[1] > 0)
            f.append(mm)
            p.append(issue[(run, cam)])
            m.append(meas[(valid, cam)][1])
        if not y or not any(y) or all(y):
            print(f"{lead:>4} {len(y):>5}   (not enough rain to score)")
            continue
        y = np.array(y)

        def score(x):
            x = np.array(x)
            pred = x >= 1
            hit, miss, fa = (pred & y).sum(), (~pred & y).sum(), (pred & ~y).sum()
            auc = roc_auc_score(y, x) if len(set(x)) > 1 else float("nan")
            return (f"{auc:4.2f}  {hit / max(hit + miss, 1):4.0%} {fa / max(hit + fa, 1):4.0%} "
                    f"{hit / max(hit + miss + fa, 1):4.0%}")
        print(f"{lead:>4} {len(y):>5} {y.sum():>5} | {score(f):^22} | {score(p):^22} | {score(m):^22}")


if __name__ == "__main__":
    main()
