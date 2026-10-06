"""
Fusion test on the newest hand-labelled batch: train on every earlier batch, test on the newest.

Run: .venv/bin/python scripts/hand_label_fusion.py [--test-batch N]   (default: the newest batch)

The question each new batch answers: does adding an input to the rain call help on days the model
has never seen? Inputs, added one at a time:
  embedding  hand-label classifier score (scripts/hand_label_eval.py; gemini-embedding-2 + time)
  gemma      Gemma's own readings: water level, rain seen falling, night flag
  nearby     cameras within 5 km read within 15 min: share the map called rain, share the
             embedding scored rain
  radar      Nha Be radar over the last 20 min: the 2 km clean reading minus this camera's median
             (permanent clutter), the 5 km clean max, the share of the 2 km disc at >= 20 dBZ
Gauges are deliberately not an input (they report an hour late).

Training frames need Gemma's readings (batches 2+, from the shadow log) and radar (archive from
1 Oct 22:30 UTC). The embedding score of every training frame is out-of-fold (camera-grouped), so the
fusion never learns from a score that saw its own label. Test frames are scored by models fitted on
the training batches only. The map's verdict (Gemma + the live veto) is shown on the same frames.
"""

import argparse
import csv
import json
import math
import statistics
import sys
from bisect import bisect_right
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.hand_label_eval import SET, features, load

REPO = Path(__file__).resolve().parents[1]
D = REPO / "data" / "derived"
LEVELS = ["dry", "damp", "wet", "soaked", "standing water"]
INPUTS = {
    "embedding": ["e"],
    "gemma": ["water", "falling", "night"],
    "nearby": ["nb_map", "nb_emb"],
    "radar": ["excess2", "clean_5km", "rain_share_2km"],
}


def clf(C):
    return make_pipeline(StandardScaler(), LogisticRegression(C=C, max_iter=5000))


def radar_lookup():
    rad, vals = defaultdict(list), defaultdict(list)
    num = lambda x: float(x) if x != "" else 0.0       # blank = no echo drawn
    for r in csv.DictReader((D / "radar_cameras.csv").open()):
        t = datetime.strptime(r["stamp"], "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
        d = {k: num(r[k]) for k in ("rain_share_2km", "clean_2km", "clean_5km")}
        rad[r["camera_id"]].append((t, d))
        vals[r["camera_id"]].append(d["clean_2km"])
    for v in rad.values():
        v.sort(key=lambda x: x[0])
    med = {c: statistics.median(v) for c, v in vals.items()}

    def at(cam, t):
        v = rad.get(cam)
        if not v:
            return None
        i = bisect_right([x[0] for x in v], t)
        recent = [d for tt, d in v[max(0, i - 3):i] if t - tt <= timedelta(minutes=20)]
        if not recent:
            return None
        out = {k: max(d[k] for d in recent) for k in recent[0]}
        out["excess2"] = out["clean_2km"] - med[cam]
        return out
    return at


def nearby_lookup():
    rows = []
    for r in csv.DictReader((D / "rain_shadow.csv").open(encoding="utf-8")):
        if r["captured_at"]:
            rows.append((datetime.fromisoformat(r["captured_at"]), r["camera_id"],
                         (r.get("final") or r["gemma"]) != "No", float(r["shadow_score"]) > 0))
    rows.sort(key=lambda x: x[0])
    ts = [x[0] for x in rows]
    where = {c["camera_id"]: (c["lat"], c["lon"]) for c in json.loads((D / "camera_locations.json").read_text())}

    def km(a, b):
        return math.hypot((a[0] - b[0]) * 110.57, (a[1] - b[1]) * 111.32 * math.cos(math.radians((a[0] + b[0]) / 2)))

    def at(cam, t):
        lo, hi = bisect_right(ts, t - timedelta(minutes=15)), bisect_right(ts, t + timedelta(minutes=15))
        nb = [x for x in rows[lo:hi] if x[1] != cam and cam in where and x[1] in where and km(where[cam], where[x[1]]) <= 5]
        return (float(np.mean([x[2] for x in nb])), float(np.mean([x[3] for x in nb]))) if nb else (0.0, 0.0)
    return at


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test-batch", type=int)
    args = ap.parse_args()

    key = json.loads((SET / "hand_labels_key.json").read_text())
    rows = [r for r in load() if r["label"] != "cannot_tell"]
    test_b = args.test_batch or max(r["batch"] for r in rows)
    radar, nearby = radar_lookup(), nearby_lookup()
    for r in rows:
        v = key[r["id"]]
        r["y"] = r["label"] == "raining"
        if r["batch"] < 2:
            continue
        t = datetime.fromisoformat(v["captured_at"])
        rd = radar(r["camera"], t)
        r["has_radar"] = rd is not None
        r.update(rd or {})
        r["water"] = LEVELS.index(v["gemma_water"]) if v["gemma_water"] in LEVELS else 0
        r["falling"] = 1.0 if str(v["gemma_falling"]).lower() in ("yes", "true") else 0.0
        r["night"] = 1.0 if (r["hour"] < 6 or r["hour"] >= 18) else 0.0
        r["nb_map"], r["nb_emb"] = nearby(r["camera"], t)

    earlier = [r for r in rows if r["batch"] < test_b]
    test = [r for r in rows if r["batch"] == test_b and r.get("has_radar")]
    fuse = [r for r in earlier if r["batch"] >= 2 and r.get("has_radar")]

    # embedding score: test frames from a model on all earlier frames; fusion-training frames out of fold
    emb = clf(0.1).fit(features(earlier), [r["y"] for r in earlier])
    for r, s in zip(test, emb.decision_function(features(test))):
        r["e"] = s
    X_all, y_all = features(earlier), np.array([r["y"] for r in earlier])
    pos = {id(r): i for i, r in enumerate(earlier)}
    y_f, g_f = np.array([r["y"] for r in fuse]), [r["camera"] for r in fuse]
    for tr, te in StratifiedGroupKFold(5, shuffle=True, random_state=0).split(np.zeros(len(fuse)), y_f, g_f):
        held, cams = {pos[id(fuse[i])] for i in te}, {g_f[i] for i in te}
        keep = [i for i, r in enumerate(earlier) if i not in held and r["camera"] not in cams]
        m = clf(0.1).fit(X_all[keep], y_all[keep])
        for i, s in zip(te, m.decision_function(X_all[[pos[id(fuse[i])] for i in te]])):
            fuse[i]["e"] = s

    y = np.array([r["y"] for r in test])
    print(f"test: batch {test_b}, {len(test)} frames ({y.sum()} raining) | fusion trained on batches 2-{test_b - 1}: "
          f"{len(fuse)} frames ({y_f.sum()} raining) | embedding classifier on {len(earlier)} frames")

    def show(name, pred, score=None):
        auc = f"   AUC {roc_auc_score(y, score):.2f}" if score is not None and 0 < y.sum() < len(y) else ""
        print(f"  {name:36s} agree {(pred == y).mean():4.0%} ({(pred == y).sum()}/{len(y)})   rain caught {(pred & y).sum()}/{y.sum()}"
              f"   pins that were rain {(pred & y).sum()}/{pred.sum()}{auc}")

    show("map (Gemma + live veto)", np.array([key[r["id"]]["final"] != "No" for r in test]))
    steps = [["embedding"], ["radar"], ["embedding", "gemma"], ["embedding", "gemma", "nearby"],
             ["embedding", "gemma", "radar"], ["embedding", "gemma", "nearby", "radar"]]
    for step in steps:
        cols = [c for k in step for c in INPUTS[k]]
        if step == ["embedding"]:
            s = np.array([r["e"] for r in test])
        else:
            m = clf(1.0).fit(np.array([[r[c] for c in cols] for r in fuse]), y_f)
            s = m.decision_function(np.array([[r[c] for c in cols] for r in test]))
        show(" + ".join(step), s > 0, s)


if __name__ == "__main__":
    main()
