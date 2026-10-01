"""
How has shadow mode's second opinion compared with Gemma, and when they disagreed, who was right?

Run: .venv/bin/python scripts/shadow_report.py [--since 2026-10-02]

Reads data/derived/rain_shadow.csv (app/services/rain_shadow.py) and scores both verdicts against
the VRAIN gauges with gauge_eval's labels: RAIN = nearest gauge <= 4 km measured >= 5 mm in the hour
containing the frame; DRY = every gauge within 10 km read zero. Frames with neither label (light
rain, no gauge close enough, or the gauge hour not reported yet) count in the agreement table only.
"""

import argparse
import csv
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.gauge_eval import DRY_RADIUS_KM, MAX_KM, WET_MM, km, load_gauges, mm_for_frame

REPO = Path(__file__).resolve().parents[1]
LOG = REPO / "data" / "derived" / "rain_shadow.csv"


def label(series, coord, lat, lon, t):
    st = min(coord, key=lambda s: km(lat, lon, *coord[s]))
    if km(lat, lon, *coord[st]) > MAX_KM:
        return None
    mm = mm_for_frame(series, st, t)
    if mm is None:
        return None
    if mm >= WET_MM:
        return "rain"
    near = [s for s in coord if km(lat, lon, *coord[s]) <= DRY_RADIUS_KM]
    if mm == 0 and all((mm_for_frame(series, s, t) or 0) == 0 for s in near):
        return "dry"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", help="only frames captured on or after this date (YYYY-MM-DD)")
    args = ap.parse_args()
    if not LOG.exists():
        sys.exit(f"no shadow log yet ({LOG.relative_to(REPO)})")
    rows = list(csv.DictReader(LOG.open(encoding="utf-8")))
    if args.since:
        rows = [r for r in rows if (r["captured_at"] or "") >= args.since]
    if not rows:
        sys.exit("no rows")

    agree = Counter((r["gemma"] != "No", r["shadow_rain"] == "True") for r in rows)
    print(f"{len(rows)} frames scored, {rows[0]['captured_at'][:16]} .. {rows[-1]['captured_at'][:16]}")
    print(f"   both dry {agree[(False, False)]}, both rain {agree[(True, True)]}, "
          f"gemma rain / shadow dry {agree[(True, False)]}, gemma dry / shadow rain {agree[(False, True)]}")

    series, coord = load_gauges()
    where = {c["camera_id"]: (c["lat"], c["lon"]) for c in json.loads((REPO / "data" / "derived" / "camera_locations.json").read_text())}
    scored = []
    for r in rows:
        if r["camera_id"] not in where or not r["captured_at"]:
            continue
        truth = label(series, coord, *where[r["camera_id"]], datetime.fromisoformat(r["captured_at"]))
        if truth:
            scored.append({**r, "truth": truth, "g": r["gemma"] != "No", "s": r["shadow_rain"] == "True"})
    print(f"\n{len(scored)} of them have a gauge label ({sum(x['truth'] == 'rain' for x in scored)} rain, "
          f"{sum(x['truth'] == 'dry' for x in scored)} dry)")
    for name, k in [("gemma", "g"), ("shadow", "s")]:
        rain = [x for x in scored if x["truth"] == "rain"]
        dry = [x for x in scored if x["truth"] == "dry"]
        rec = sum(x[k] for x in rain) / len(rain) if rain else float("nan")
        far = sum(x[k] for x in dry) / len(dry) if dry else float("nan")
        print(f"   {name:7s} rain caught {rec:5.0%}   dry called rain {far:5.0%}")
    dis = [x for x in scored if x["g"] != x["s"]]
    if dis:
        right = Counter("gemma" if x["g"] == (x["truth"] == "rain") else "shadow" for x in dis)
        print(f"\nwhen they disagreed ({len(dis)} labelled frames): gemma right {right['gemma']}, shadow right {right['shadow']}")
        for x in dis[-10:]:
            print(f"   {x['captured_at'][:16]} {x['location'][:38]:38s} gemma {x['gemma']:6s} shadow "
                  f"{'rain' if x['s'] else 'dry':4s} ({float(x['shadow_score']):+.2f})  gauges: {x['truth']}   {x['image']}")


if __name__ == "__main__":
    main()
