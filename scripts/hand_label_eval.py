"""
Scores the rain readers against the hand labels, and tests a classifier trained on them.

Run: .venv/bin/python scripts/hand_label_eval.py

The hand labels (data/test_sets/20261003_rain7d/hand_labels/, made on the labelling page,
https://claude.ai/artifact/F87tfGDaEfa5mjuaEoG1UW) answer the one question the gauges cannot: is
rain FALLING in this frame, or is the road only wet? Gauge hours lump the two together, which is
why the shadow classifier, trained on gauge labels, scores wet-after-rain roads as rain.

  batch 1  75 frames, 18-30 Sep, where the stronger-model judges disagreed (+12 controls they agreed on)
  batch 2  150 frames, 1-3 Oct, where Gemma and the embedding score disagreed (+30 where both said rain)
  batch 3  50 frames, 1-3 Oct, where both said dry, in hours a gauge within 4 km measured >= 1 mm
All batches over-sample hard frames on purpose, so every figure here is accuracy on HARD frames,
not the map's everyday accuracy.

Readers scored: Gemma (production's verdict), the map (Gemma after the shadow veto; batch 2 only,
the veto went live on 2 Oct), and the shadow classifier's live score.

Then a classifier trained on the hand labels themselves: logistic regression on the frame's image
embedding (gemini-embedding-2, 3072-d, the same vector shadow mode already pays for) plus time of
day. Tested by camera: each camera's frames are scored by a model that never saw that camera, so
near-identical frames of one street cannot flatter it.

"Can't tell" labels are left out of every score.

--save fits the classifier on ALL hand labels and writes data/derived/hand_label_model.npz, which the
annotator's shadow mode loads to make the rain call (app/services/rain_shadow.py, RAIN_DECIDER).
"""

import base64
import glob
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

REPO = Path(__file__).resolve().parents[1]
SET = REPO / "data" / "test_sets" / "20261003_rain7d"
SHADOW_EMB = REPO / "data" / "derived" / "embedding_cache" / "gemini-embedding-2.shadow.jsonl"
ICT = timedelta(hours=7)


def load():
    key = json.loads((SET / "hand_labels_key.json").read_text())
    labels = {Path(f).stem: json.loads(Path(f).read_text())["label"] for f in glob.glob(str(SET / "hand_labels/labels/*.json"))}
    live1 = json.loads((SET / "hand_labels_emb_scores.json").read_text())
    emb = {}
    for line in (SET / "hand_labels_embeddings.jsonl").open():
        d = json.loads(line)
        emb[d["key"]] = np.asarray(d["embedding"], dtype=np.float32)
    want = {v["image"] for v in key.values()} - set(emb)
    for line in SHADOW_EMB.open():
        d = json.loads(line)
        if d["key"] in want:
            emb[d["key"]] = np.frombuffer(base64.b64decode(d["v"]), dtype=np.float32)
    # Cameras the watchdog has blacklisted (lens droplets, turned away) are never read any more, so
    # their frames say nothing about the map from now on; they are left out of training and tests.
    from scripts.camera_watchdog import PERMANENT_BLACKLIST
    rows = []
    for fid, v in key.items():
        if fid not in labels or v["image"] not in emb or Path(v["image"]).parts[2] in PERMANENT_BLACKLIST:
            continue
        b2 = v.get("batch", 1) >= 2   # batches 2+ come from the shadow log: Gemma, map and live score per frame
        stem = Path(v["image"]).stem
        t = datetime.strptime(stem[:15], "%Y%m%d_%H%M%S").replace(tzinfo=timezone.utc)
        prod = v["gemma"] if b2 else v.get("production") or None
        rows.append({
            "id": fid, "batch": v.get("batch", 1), "label": labels[fid], "camera": Path(v["image"]).parts[2],
            "hour": (t + ICT).hour + (t + ICT).minute / 60, "emb": emb[v["image"]],
            "gemma": None if prod is None else prod != "No",
            "map": (v["final"] != "No") if b2 else None,
            "live": v["emb_score"] if b2 else live1[fid],
            "group": v.get("group") or ("control" if v.get("control") else "judges split"),
        })
    return rows


def features(rows):
    X = np.stack([r["emb"] for r in rows])
    h = np.array([r["hour"] for r in rows]) * 2 * math.pi / 24
    night = np.array([1.0 if r["hour"] < 6 or r["hour"] >= 18 else 0.0 for r in rows])
    return np.column_stack([X, np.sin(h), np.cos(h), night])


def cross_val_scores(rows, C=0.1, folds=5):
    """Each frame's score from a model fitted without its camera."""
    X, y = features(rows), np.array([r["label"] == "raining" for r in rows])
    groups = [r["camera"] for r in rows]
    out = np.zeros(len(rows))
    for tr, te in GroupKFold(n_splits=folds).split(X, y, groups):
        m = make_pipeline(StandardScaler(), LogisticRegression(C=C, max_iter=5000)).fit(X[tr], y[tr])
        out[te] = m.decision_function(X[te])
    return out


def line(name, rows, call):
    rows = [r for r in rows if call(r) is not None]
    if not rows:
        return
    tp = sum(call(r) and r["label"] == "raining" for r in rows)
    fp = sum(call(r) and r["label"] != "raining" for r in rows)
    fn = sum(not call(r) and r["label"] == "raining" for r in rows)
    agree = sum(call(r) == (r["label"] == "raining") for r in rows)
    print(f"  {name:40s} agree {agree:3d}/{len(rows):<3d} ({agree / len(rows):4.0%})   rain caught {tp:3d}/{tp + fn:<3d}"
          f"   rain calls right {tp:3d}/{tp + fp}")


def main():
    rows = [r for r in load() if r["label"] != "cannot_tell"]
    print(f"{len(rows)} labelled frames (can't-tell dropped): "
          + ", ".join(f"{k} {v}" for k, v in Counter(r["label"] for r in rows).items()))
    for b in (1, 2):
        print(f"  batch {b}: " + ", ".join(f"{g} {n}" for g, n in Counter(r["group"] for r in rows if r["batch"] == b).items()))

    cv = cross_val_scores(rows)
    for r, s in zip(rows, cv):
        r["new"] = s
    y = [r["label"] == "raining" for r in rows]
    print(f"\nseparation (AUC; 1.0 perfect, 0.5 coin toss) on all {len(rows)}:"
          f"  live shadow score {roc_auc_score(y, [r['live'] for r in rows]):.2f},"
          f"  classifier trained on hand labels {roc_auc_score(y, cv):.2f} (by camera)")

    for title, sub in [("batch 2 (1-3 Oct, live era)", [r for r in rows if r["batch"] == 2]),
                       ("all frames", rows)]:
        print(f"\n{title}")
        line("Gemma", sub, lambda r: r["gemma"])
        line("map (Gemma + shadow veto)", sub, lambda r: r["map"])
        line("live shadow score > 0", sub, lambda r: r["live"] > 0)
        line("hand-label classifier > 0", sub, lambda r: r["new"] > 0)
        line("Gemma, vetoed when hand-label clf < 0", sub,
             lambda r: None if r["gemma"] is None else (r["gemma"] and r["new"] >= 0))
        line("Gemma OR hand-label clf > 1", sub,
             lambda r: None if r["gemma"] is None else (r["gemma"] or r["new"] > 1))

    print("\nbatch 2 by group (what Gemma / the map / the new classifier got right)")
    for g in ("veto_zone", "miss_zone", "border", "both_rain"):
        sub = [r for r in rows if r["group"] == g]
        rain = sum(r["label"] == "raining" for r in sub)
        ok = lambda f: sum(f(r) == (r["label"] == "raining") for r in sub)
        print(f"  {g:10s} n={len(sub):3d}, raining {rain:3d}   Gemma {ok(lambda r: r['gemma']):3d}   map {ok(lambda r: r['map']):3d}"
              f"   hand-label clf {ok(lambda r: r['new'] > 0):3d}")

    for night in (False, True):
        sub = [r for r in rows if (r["hour"] < 6 or r["hour"] >= 18) == night]
        print(f"\n{'night' if night else 'day'} ({len(sub)} frames)")
        line("Gemma", sub, lambda r: r["gemma"])
        line("hand-label classifier > 0", sub, lambda r: r["new"] > 0)
        line("Gemma, vetoed when hand-label clf < 0", sub,
             lambda r: None if r["gemma"] is None else (r["gemma"] and r["new"] >= 0))


MODEL_OUT = REPO / "data" / "derived" / "hand_label_model.npz"


def save_model(C=0.1):
    """Fit on every hand label and save as plain arrays, so the annotator scores with numpy alone:
    score = ((x - mean) / scale) @ coef + intercept, x = features() of one frame; rain iff score > 0."""
    rows = [r for r in load() if r["label"] != "cannot_tell"]
    y = np.array([r["label"] == "raining" for r in rows])
    m = make_pipeline(StandardScaler(), LogisticRegression(C=C, max_iter=5000)).fit(features(rows), y)
    sc, lr = m.named_steps["standardscaler"], m.named_steps["logisticregression"]
    meta = {"trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "labels": len(rows),
            "raining": int(y.sum()), "batches": sorted({r["batch"] for r in rows}), "C": C,
            "embedding_model": "gemini-embedding-2",
            "features": "embedding (3072) + sin/cos of the hour (ICT) + night flag (18:00-06:00 ICT)"}
    np.savez(MODEL_OUT, mean=sc.mean_, scale=sc.scale_, coef=lr.coef_.ravel(), intercept=lr.intercept_,
             meta=json.dumps(meta))
    print(f"saved {MODEL_OUT.relative_to(REPO)}: {meta['labels']} labels ({meta['raining']} raining), batches {meta['batches']}")


if __name__ == "__main__":
    save_model() if "--save" in sys.argv else main()
