"""
Offline shadow test of the hand-label rain classifier on frames it has never seen.

Run: .venv/bin/python scripts/hand_label_shadow.py [--since 2026-10-04T00:00+07:00] [--C 0.1]

Trains scripts/hand_label_eval.py's classifier (logistic regression on the gemini-embedding-2
vector + time of day) on ALL hand labels, then scores every frame the annotator read since --since,
from the embeddings shadow mode already logged (data/derived/embedding_cache/...shadow.jsonl).
Nothing touches the live annotator: the user's choice is to test each new stretch of data offline
rather than run a shadow mode.

Scored against the VRAIN gauges with shadow_report's labels (RAIN = nearest gauge within 4 km
measured >= 5 mm in the frame's hour; DRY = every gauge within 10 km read zero). The gauges lag an
hour, which is no obstacle offline, but their RAIN hours include dry minutes, so "rain caught" is
understated for every reader alike. The fair comparison is between readers on the same frames.

Writes data/derived/hand_label_shadow.csv: one row per frame with the map's verdict and the score.
"""

import argparse
import base64
import csv
import json
import math
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.gauge_eval import load_gauges
from scripts.hand_label_eval import features, load
from scripts.shadow_report import label

REPO = Path(__file__).resolve().parents[1]
SHADOW_LOG = REPO / "data" / "derived" / "rain_shadow.csv"
SHADOW_EMB = REPO / "data" / "derived" / "embedding_cache" / "gemini-embedding-2.shadow.jsonl"
OUT = REPO / "data" / "derived" / "hand_label_shadow.csv"
ICT = timedelta(hours=7)


def is_night(t: datetime) -> bool:
    h = (t + ICT).hour
    return h < 6 or h >= 18


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-10-04T00:00+07:00")
    ap.add_argument("--C", type=float, default=0.1)
    args = ap.parse_args()
    since = datetime.fromisoformat(args.since)

    train = [r for r in load() if r["label"] != "cannot_tell"]
    model = make_pipeline(StandardScaler(), LogisticRegression(C=args.C, max_iter=5000))
    model.fit(features(train), np.array([r["label"] == "raining" for r in train]))
    print(f"trained on {len(train)} hand labels ({sum(r['label'] == 'raining' for r in train)} raining)")

    frames = {}
    for r in csv.DictReader(SHADOW_LOG.open(encoding="utf-8")):
        if r["captured_at"] and datetime.fromisoformat(r["captured_at"]) >= since:
            frames[r["image"]] = r
    emb = {}
    with SHADOW_EMB.open() as f:
        for line in f:
            d = json.loads(line)
            if d["key"] in frames:
                emb[d["key"]] = np.frombuffer(base64.b64decode(d["v"]), dtype=np.float32)
    rows = []
    for img, r in frames.items():
        if img not in emb:
            continue
        t = datetime.fromisoformat(r["captured_at"])
        lt = t + ICT
        rows.append({"img": img, "t": t, "camera": r["camera_id"], "location": r["location"],
                     "gemma": r["gemma"] != "No", "map": (r.get("final") or r["gemma"]) != "No",
                     "live": float(r["shadow_score"]), "emb": emb[img], "hour": lt.hour + lt.minute / 60})
    scores = model.decision_function(features(rows))
    for r, s in zip(rows, scores):
        r["clf"] = float(s)
    print(f"{len(rows)} frames since {args.since} scored ({len(frames) - len(rows)} without a logged embedding)")

    series, coord = load_gauges()
    where = {c["camera_id"]: (c["lat"], c["lon"]) for c in json.loads((REPO / "data/derived/camera_locations.json").read_text())}
    for r in rows:
        r["gauge"] = label(series, coord, *where[r["camera"]], r["t"]) if r["camera"] in where else None

    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["captured_at", "camera_id", "location", "image", "gemma_rain", "map_rain", "live_score", "clf_score", "gauge"])
        for r in sorted(rows, key=lambda r: r["t"]):
            w.writerow([r["t"].isoformat(), r["camera"], r["location"], r["img"], r["gemma"], r["map"],
                        round(r["live"], 4), round(r["clf"], 4), r["gauge"] or ""])

    readers = {
        "map (Gemma + live veto)": lambda r: r["map"],
        "Gemma before the veto": lambda r: r["gemma"],
        "hand-label classifier > 0": lambda r: r["clf"] > 0,
        "map by day, classifier at night": lambda r: (r["clf"] > 0) if is_night(r["t"]) else r["map"],
    }
    for title, sub in [("all", rows), ("day", [r for r in rows if not is_night(r["t"])]),
                       ("night", [r for r in rows if is_night(r["t"])])]:
        lab = [r for r in sub if r["gauge"]]
        rain = [r for r in lab if r["gauge"] == "rain"]
        dry = [r for r in lab if r["gauge"] == "dry"]
        print(f"\n{title}: {len(sub)} frames; gauge-labelled {len(rain)} rain, {len(dry)} dry")
        for name, f in readers.items():
            pins = sum(f(r) for r in sub)
            tp, fp = sum(f(r) for r in rain), sum(f(r) for r in dry)
            print(f"  {name:34s} pins {pins:5d}   rain caught {tp:4d}/{len(rain):<4d} ({tp / max(len(rain), 1):4.0%})"
                  f"   dry called rain {fp:4d}/{len(dry):<5d} ({fp / max(len(dry), 1):5.1%})")

    both = Counter((r["map"], r["clf"] > 0) for r in rows)
    print(f"\nmap vs classifier on all {len(rows)} frames: both rain {both[(True, True)]}, both dry {both[(False, False)]},"
          f" map only {both[(True, False)]}, classifier only {both[(False, True)]}")


if __name__ == "__main__":
    main()
