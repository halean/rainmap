"""
Rain fusion: one learned classifier over every signal, instead of hand-written rules.

Run: .venv/bin/python scripts/fusion_train.py

Each frame Gemma has read becomes one row of features, all things known at the moment of the frame:
  gemma     water level (0 dry .. 4 standing water), rain seen falling, people dressed for rain,
            minutes the road has held its current level (live frames only)
  embedding the ridge score of the frame's image embedding -- fitted only on EARLIER frames: rows in
            the training period get out-of-fold scores from rolling earlier blocks, the test period a
            score from a model fitted on the whole training period
  radar     strongest echo within 1/2/5 km in the last 30 min (data/derived/radar_cameras.csv), and the
            2 km reading minus this camera's median -- the radar sees permanent clutter over the
            central city (~400 cameras at >= 20 dBZ in dry weather), so the excess is what moves
  gauge     the nearest gauge's LAST COMPLETED hour before the frame -- never the hour being labelled
  time      sin/cos of the hour, night flag
Missing values (radar before its archive began on 1 Oct, minutes-at-level before the shadow log)
stay NaN: HistGradientBoostingClassifier handles them natively, so older frames still count.

Labels: the gauges (gauge_eval's RAIN >= 5 mm in the frame's hour within 4 km / DRY all zero within
10 km). Split by time: train on the earlier 60% of rain frames' span, test on the rest, against
Gemma's production rule and the embedding alone, on the same frames.

Sources of frames: perception_eval's cache (Gemma readings from the evaluations) and the shadow log
(every frame the annotator reads, from 1 Oct; app/services/rain_shadow.py).
"""

import csv
import json
import math
import sys
from bisect import bisect_right
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import RidgeClassifier

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.embedding_eval import EmbeddingCache, rel, score
from scripts.gauge_eval import load_gauges, mm_for_frame
from scripts.perception_eval import CACHE as PERCEPTION_CACHE, LADDER, SOAKED
from scripts.shadow_report import label

REPO = Path(__file__).resolve().parents[1]
SHADOW_LOG = REPO / "data" / "derived" / "rain_shadow.csv"
RADAR_CSV = REPO / "data" / "derived" / "radar_cameras.csv"
ICT = timezone(timedelta(hours=7))
FEATURES = ["water", "falling", "behaviour_yes", "behaviour_none", "minutes_at_level", "emb_score",
            "radar_1km", "radar_2km", "radar_5km", "radar_excess_2km", "radar_share_2km",
            "gauge_last_hour", "hour_sin", "hour_cos", "night"]


def frame_time(path: Path) -> datetime:
    return datetime.strptime(path.stem[:15], "%Y%m%d_%H%M%S").replace(tzinfo=timezone.utc)


def gemma_rows():
    """(path, camera_id, captured, gemma fields) from the evaluation cache and the shadow log."""
    out = {}
    if PERCEPTION_CACHE.exists():
        for k, v in json.loads(PERCEPTION_CACHE.read_text()).items():
            if not v:
                continue
            p = Path(k).resolve()
            out[rel(p)] = {"path": p, "camera_id": p.parts[-5], "captured": frame_time(p), "water": v["water"],
                           "falling": bool(v["falling"]), "behaviour": v["behaviour"], "since": None}
    if SHADOW_LOG.exists():
        for r in csv.DictReader(SHADOW_LOG.open(encoding="utf-8")):
            if r["camera_id"] == "test" or r["gemma_water"] not in LADDER:
                continue
            p = (REPO / r["image"]).resolve()
            out[rel(p)] = {"path": p, "camera_id": r["camera_id"], "captured": datetime.fromisoformat(r["captured_at"]),
                           "water": LADDER.index(r["gemma_water"]), "falling": r["gemma_falling"] in ("True", "yes", "true"),
                           "behaviour": r.get("gemma_behaviour") or "none visible",
                           "since": datetime.fromisoformat(r["water_since"]) if r.get("water_since") else None}
    return list(out.values())


class Radar:
    def __init__(self):
        self.by_cam = defaultdict(list)  # camera -> [(time, d1, d2, d5, share)]
        if not RADAR_CSV.exists():
            return
        f = lambda x: float(x) if x != "" else np.nan
        for r in csv.DictReader(RADAR_CSV.open()):
            t = datetime.strptime(r["stamp"], "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
            self.by_cam[r["camera_id"]].append((t, f(r["dbz_1km"]), f(r["dbz_2km"]), f(r["dbz_5km"]), f(r["rain_share_2km"])))
        self.base = {}
        for cam, rows in self.by_cam.items():
            rows.sort()
            # Clutter level: the camera's median 2 km reading (no echo counted as 0). Rain is rare,
            # so the median is what this spot shows in dry weather.
            self.base[cam] = float(np.median([0 if np.isnan(x[2]) else x[2] for x in rows]))

    def at(self, cam, t):
        rows = self.by_cam.get(cam, [])
        lo = [x for x in rows if t - timedelta(minutes=30) <= x[0] <= t]
        if not lo:
            return [np.nan] * 5
        mx = lambda i: np.nanmax([x[i] for x in lo]) if any(not np.isnan(x[i]) for x in lo) else 0.0
        d2 = mx(2)
        return [mx(1), d2, mx(3), d2 - self.base.get(cam, 0.0), max(x[4] for x in lo)]


def gauge_last_hour(series, coord, where, cam, t):
    if cam not in where:
        return np.nan
    lat, lon = where[cam]
    st = min(coord, key=lambda s: math.hypot((coord[s][0] - lat) * 111, (coord[s][1] - lon) * 109))
    v = mm_for_frame(series, st, t - timedelta(hours=1))
    return np.nan if v is None else v


def main():
    series, coord = load_gauges()
    where = {c["camera_id"]: (c["lat"], c["lon"]) for c in json.loads((REPO / "data" / "derived" / "camera_locations.json").read_text())}
    cache = EmbeddingCache("gemini-embedding-2")
    radar = Radar()

    rows = []
    for g in gemma_rows():
        if g["camera_id"] not in where or rel(g["path"]) not in cache.v:
            continue
        truth = label(series, coord, *where[g["camera_id"]], g["captured"])
        if truth is None:
            continue
        local = g["captured"].astimezone(ICT)
        h = local.hour + local.minute / 60
        rows.append({**g, "truth": truth, "y": int(truth == "rain"),
                     "gemma_rule": bool(g["falling"] or g["water"] >= SOAKED),
                     "feat": {"water": g["water"], "falling": float(g["falling"]),
                              "behaviour_yes": float(g["behaviour"] == "yes"),
                              "behaviour_none": float(g["behaviour"] == "none visible"),
                              "minutes_at_level": (g["captured"] - g["since"]).total_seconds() / 60 if g["since"] else np.nan,
                              **dict(zip(["radar_1km", "radar_2km", "radar_5km", "radar_excess_2km", "radar_share_2km"],
                                         radar.at(g["camera_id"], g["captured"]))),
                              "gauge_last_hour": gauge_last_hour(series, coord, where, g["camera_id"], g["captured"]),
                              "hour_sin": math.sin(2 * math.pi * h / 24), "hour_cos": math.cos(2 * math.pi * h / 24),
                              "night": float(h < 6 or h >= 18)}})
    rows.sort(key=lambda r: r["captured"])
    n_rain = sum(r["y"] for r in rows)
    with_radar = sum(not np.isnan(r["feat"]["radar_2km"]) for r in rows)
    print(f"{len(rows)} gauge-labelled frames with a Gemma reading and an embedding: {n_rain} rain, "
          f"{len(rows) - n_rain} dry; {with_radar} with radar")
    if n_rain < 20 or len(rows) - n_rain < 20:
        sys.exit("too few labelled frames of one class to train yet")

    rain_t = [r["captured"] for r in rows if r["y"]]
    cut = rain_t[int(len(rain_t) * 0.6)]
    tr = [r for r in rows if r["captured"] < cut]
    te = [r for r in rows if r["captured"] >= cut]

    # Embedding score: out-of-fold for training rows (each block scored by a ridge fitted on the
    # blocks before it), then one ridge on all training rows for the test rows.
    E = lambda rs: np.stack([cache.v[rel(r["path"])] for r in rs]).astype(np.float64)
    blocks = np.array_split(np.arange(len(tr)), 5)
    for i, b in enumerate(blocks):
        prev = np.concatenate(blocks[:i]) if i else np.array([], dtype=int)
        ys = [tr[j]["y"] for j in prev]
        if len(set(ys)) < 2:
            for j in b:
                tr[j]["feat"]["emb_score"] = np.nan
            continue
        m = RidgeClassifier(alpha=1.0, class_weight="balanced").fit(E([tr[j] for j in prev]), ys)
        for j, s in zip(b, m.decision_function(E([tr[j] for j in b]))):
            tr[j]["feat"]["emb_score"] = float(s)
    m = RidgeClassifier(alpha=1.0, class_weight="balanced").fit(E(tr), [r["y"] for r in tr])
    for r, s in zip(te, m.decision_function(E(te))):
        r["feat"]["emb_score"] = float(s)
        r["emb_rule"] = s > 0

    X = lambda rs: np.array([[r["feat"].get(f, np.nan) for f in FEATURES] for r in rs], dtype=np.float64)
    clf = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=300, class_weight="balanced",
                                         l2_regularization=1.0, random_state=0).fit(X(tr), [r["y"] for r in tr])
    for r, p in zip(te, clf.predict(X(te))):
        r["fusion"] = bool(p)

    print(f"train {tr[0]['captured']:%d %b} - {tr[-1]['captured']:%d %b}: {len(tr)} frames ({sum(r['y'] for r in tr)} rain); "
          f"test {te[0]['captured']:%d %b} - {te[-1]['captured']:%d %b}: {len(te)} frames ({sum(r['y'] for r in te)} rain)")
    print(f"\n{'':34s}{'rain caught':>12s} {'dry->rain':>10s} {'rain right':>11s} {'bal.acc':>8s}")
    for name, key in [("gemma (production rule)", "gemma_rule"), ("embedding (ridge)", "emb_rule"), ("FUSION (boosted trees)", "fusion")]:
        s = score(te, key)
        print(f"{name:34s}{s['rain caught']:12.0%} {s['dry called rain']:10.0%} {s['rain calls right']:11.0%} {s['balanced acc']:8.0%}")
    for label_, sub in [("  night", [r for r in te if r["feat"]["night"]]), ("  day", [r for r in te if not r["feat"]["night"]])]:
        if sub:
            g, f = score(sub, "gemma_rule"), score(sub, "fusion")
            print(f"{label_:6s} n={len(sub):3d}  gemma bal.acc {g['balanced acc']:.0%}  fusion bal.acc {f['balanced acc']:.0%}")
    try:
        from sklearn.inspection import permutation_importance
        imp = permutation_importance(clf, X(te), [r["y"] for r in te], scoring="balanced_accuracy", n_repeats=10, random_state=0)
        top = sorted(zip(FEATURES, imp.importances_mean), key=lambda x: -x[1])
        print("\nwhat the fusion leans on (drop in balanced accuracy when shuffled):",
              ", ".join(f"{f} {v:+.3f}" for f, v in top if abs(v) >= 0.005) or "nothing stands out")
    except Exception as e:
        print(f"(importance not computed: {e})")


if __name__ == "__main__":
    main()
