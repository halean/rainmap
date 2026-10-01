"""
A trained rain classifier on image embeddings, with time of day and camera as features, scored
against the VRAIN gauges and, on the frames both have seen, against the Gemma annotator.

Run: .venv/bin/python scripts/embedding_classifier.py [--dry 1200] [--seed 11] [--paid]
     Uses GOOGLE_API_FREE_KEY (free tier) unless --paid.

Data: every gauge-labelled RAIN frame and a sample of DRY ones (perception_eval.build_sample's
labels; see embedding_eval.py for what they mean and how noisy RAIN is). Embeddings come from and
go to embedding_eval's cache, so only new frames are paid for ($0.00012 each).

Split by TIME, never at random: frames are trained on up to a cut date and tested after it.
Consecutive frames of one camera in one storm are near-copies; a random split would put copies of
test frames in training and flatter every number.

Features, each kept only if it earns its place (the ablation table):
  E  the embedding, reduced to PCA_DIMS by PCA fitted on the training frames only
  T  time of day as sin/cos of the hour (so 23:00 sits next to 00:00), plus a night flag
  C  the camera, one-hot (a camera never seen in training gets all zeros)
  L  the camera's position instead: latitude, longitude and their squares and product, so the
     model can learn a simple patch shape rather than only a straight north-south gradient, and
     -- unlike C -- say something about a camera it never saw
Model: scikit-learn's RidgeClassifier, class-balanced; its alpha is chosen by validation on the
last third of the TRAINING period, never on the test period. Ridge copes with many features, so
the embedding is also tried whole (3072 numbers, no PCA).
"""

import argparse
import json
import math
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import time

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import RidgeClassifier

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from google import genai

from app import config
from scripts.embedding_eval import EmbeddingCache, IMAGE_PRICE, embed_all, experiment_client, load_pool, mcnemar, rel, score
from scripts.perception_eval import CACHE as PERCEPTION_CACHE, SOAKED, build_sample

ICT = timezone(timedelta(hours=7))
SHADOW_MODEL = Path(__file__).resolve().parents[1] / "data" / "derived" / "rain_shadow_model.npz"
PCA_DIMS = 64
ALPHAS = [0.1, 1.0, 10.0, 100.0, 1000.0]


RF_LEAF = [1, 5, 20]


def ridge_fit(X, y, alpha):
    return RidgeClassifier(alpha=alpha, class_weight="balanced").fit(X, y)


def rf_fit(X, y, leaf):
    return RandomForestClassifier(n_estimators=300, min_samples_leaf=leaf, class_weight="balanced",
                                  max_features="sqrt", n_jobs=-1, random_state=0).fit(X, y)


def predict(model, X):
    return model.predict(X) == 1


class Features:
    """Fitted on training rows only: PCA basis, camera vocabulary, standardisation."""

    def __init__(self, rows, cache, use_time, use_cam, use_loc=False, pca=True):
        self.use_time, self.use_cam, self.use_loc = use_time, use_cam, use_loc
        E = np.stack([cache.v[rel(r["path"])] for r in rows]).astype(np.float64)
        self.mu = E.mean(0)
        if pca:
            _, _, vt = np.linalg.svd(E - self.mu, full_matrices=False)
            self.basis = vt[:PCA_DIMS].T
        else:
            self.basis = np.eye(E.shape[1])
        self.cams = sorted({r["camera"] for r in rows})
        raw = self._raw(rows, cache)
        self.m, self.s = raw.mean(0), raw.std(0) + 1e-9

    def _raw(self, rows, cache):
        E = np.stack([cache.v[rel(r["path"])] for r in rows]).astype(np.float64)
        parts = [(E - self.mu) @ self.basis]
        if self.use_time:
            h = np.array([r["captured"].astimezone(ICT).hour + r["captured"].astimezone(ICT).minute / 60 for r in rows])
            parts.append(np.stack([np.sin(2 * np.pi * h / 24), np.cos(2 * np.pi * h / 24), ((h < 6) | (h >= 18)) * 1.0], 1))
        if self.use_cam:
            idx = {c: i for i, c in enumerate(self.cams)}
            onehot = np.zeros((len(rows), len(self.cams)))
            for i, r in enumerate(rows):
                if r["camera"] in idx:
                    onehot[i, idx[r["camera"]]] = 1
            parts.append(onehot)
        if self.use_loc:
            la = np.array([r["lat"] for r in rows]) - 10.8   # centred near the city, so the squares
            lo = np.array([r["lon"] for r in rows]) - 106.7  # are not dominated by the offset
            parts.append(np.stack([la, lo, la * la, lo * lo, la * lo], 1))
        return np.hstack(parts)

    def __call__(self, rows, cache):
        return (self._raw(rows, cache) - self.m) / self.s


def bal_acc(y, p):
    rec = ((p == 1) & (y == 1)).sum() / max((y == 1).sum(), 1)
    spec = ((p == 0) & (y == 0)).sum() / max((y == 0).sum(), 1)
    return (rec + spec) / 2


def train(rows, cache, use_time, use_cam, use_loc=False, pca=True, kind="ridge"):
    """Pick alpha (ridge) or leaf size (random forest) on the last third of the training period,
    then refit on all of it."""
    fitter, grid = (ridge_fit, ALPHAS) if kind == "ridge" else (rf_fit, RF_LEAF)
    cut = int(len(rows) * 2 / 3)
    fit, val = rows[:cut], rows[cut:]
    yv = np.array([r["truth"] == "rain" for r in val]) * 1
    best = None
    f = Features(fit, cache, use_time, use_cam, use_loc, pca)
    Xf, Xv = f(fit, cache), f(val, cache)
    yf = np.array([r["truth"] == "rain" for r in fit]) * 1
    for alpha in grid:
        acc = bal_acc(yv, predict(fitter(Xf, yf, alpha), Xv) * 1)
        if best is None or acc > best[0]:
            best = (acc, alpha)
    f = Features(rows, cache, use_time, use_cam, use_loc, pca)
    m = fitter(f(rows, cache), np.array([r["truth"] == "rain" for r in rows]) * 1, best[1])
    return f, m, best[1]


def save_model(tr, te, rows, cache, model_name, test_score):
    """Refit embedding + time of day (PCA 64) on every pool frame -- alpha still chosen within
    the training period -- and save it as plain arrays: app/services/rain_shadow.py scores with numpy
    alone, so the annotator needs neither scikit-learn nor this script."""
    _, _, alpha = train(tr, cache, True, False, False, True)
    f = Features(rows, cache, True, False, False, True)
    m = ridge_fit(f(rows, cache), np.array([r["truth"] == "rain" for r in rows]) * 1, alpha)
    meta = {"embedding_model": model_name, "features": "embedding PCA64 + sin/cos hour + night flag",
            "alpha": alpha, "frames": len(rows), "rain_frames": sum(r["truth"] == "rain" for r in rows),
            "first": rows[0]["captured"].isoformat(), "last": rows[-1]["captured"].isoformat(),
            "held_out_score": test_score}
    np.savez(SHADOW_MODEL, mu=f.mu, basis=f.basis, m=f.m, s=f.s, coef=m.coef_.ravel(),
             intercept=np.array(m.intercept_).ravel(), meta=np.array(json.dumps(meta, default=float)))
    print(f"\nsaved {SHADOW_MODEL.relative_to(Path(__file__).resolve().parents[1])}: trained on {len(rows)} frames, alpha {alpha}")


def storms(rows):
    """Distinct rain episodes: rain frames more than 3 h apart start a new one."""
    ts = sorted(r["captured"] for r in rows if r["truth"] == "rain")
    return sum(1 for a, b in zip([None] + ts, ts) if a is None or b - a > timedelta(hours=3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", type=int, default=1200, help="dry frames to sample (all rain frames are used)")
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--until", default="2026-10-01T17:00:00+00:00",
                    help="freeze the frame pool at this time, so reruns reuse the same frames (and cache)")
    ap.add_argument("--model", default="gemini-embedding-2")
    ap.add_argument("--workers", type=int, default=2, help="parallel calls (the free tier's limits are low)")
    ap.add_argument("--paid", action="store_true", help="use GOOGLE_API_KEY instead of GOOGLE_API_FREE_KEY")
    ap.add_argument("--rebuild-pool", action="store_true", help="relabel frames from the live data (new pool)")
    ap.add_argument("--save", action="store_true",
                    help=f"refit embedding + time of day on ALL pool frames and save it for the annotator's shadow mode ({SHADOW_MODEL})")
    args = ap.parse_args()

    t0 = time.monotonic()
    allrows = load_pool(args.seed, datetime.fromisoformat(args.until), args.rebuild_pool)
    n_wet, n_dry = sum(r["truth"] == "rain" for r in allrows), sum(r["truth"] == "dry" for r in allrows)
    print(f"[{time.monotonic() - t0:.0f}s] pool: {n_wet} rain / {n_dry} dry gauge-labelled frames")
    wet = [r for r in allrows if r["truth"] == "rain"]
    # build_sample has already shuffled with this seed; keeping its order means the first 150 dry
    # frames are the ones embedding_eval.py's sample (and so Gemma) read, and the head to head
    # below gets dry frames as well as rain ones.
    dry = [r for r in allrows if r["truth"] == "dry"]
    rows = wet + dry[:args.dry]
    import json
    from scripts.gauge_eval import RAIN_SAMPLE
    where = {c["location_text"]: (c["lat"], c["lon"]) for c in json.loads(RAIN_SAMPLE.read_text()) if c.get("lat") is not None}
    for r in rows:
        r["path"] = Path(r["path"]).resolve()
        r["lat"], r["lon"] = where[r["camera"]]

    client = experiment_client(args.paid)
    t0 = time.monotonic()
    cache = EmbeddingCache(args.model)
    print(f"[{time.monotonic() - t0:.0f}s] loaded {len(cache.v)} cached embeddings")
    t0 = time.monotonic()
    new = embed_all(client, args.model, cache, rows, args.workers)
    print(f"[{time.monotonic() - t0:.0f}s] embedded {new} new frames")
    rows = [r for r in rows if rel(r["path"]) in cache.v]
    print(f"{len(wet)} rain + {min(args.dry, len(dry))} dry frames; {new} newly embedded (~${new * IMAGE_PRICE:.2f})")

    rows.sort(key=lambda r: r["captured"])
    # Cut so that roughly 60% of the RAIN frames are in training: rain comes in a few storms, and a
    # cut by frame count could leave the test period with almost none.
    rain_ts = [r["captured"] for r in rows if r["truth"] == "rain"]
    cut_t = rain_ts[int(len(rain_ts) * 0.6)]
    tr = [r for r in rows if r["captured"] < cut_t]
    te = [r for r in rows if r["captured"] >= cut_t]
    print(f"train {tr[0]['captured']:%d %b} - {tr[-1]['captured']:%d %b %H:%M}: {len(tr)} frames "
          f"({sum(r['truth'] == 'rain' for r in tr)} rain, {storms(tr)} storms); "
          f"test {te[0]['captured']:%d %b %H:%M} - {te[-1]['captured']:%d %b}: {len(te)} frames "
          f"({sum(r['truth'] == 'rain' for r in te)} rain, {storms(te)} storms)")
    unseen = {r["camera"] for r in te} - {r["camera"] for r in tr}
    if unseen:
        print(f"   {len(unseen)} test cameras never seen in training (camera feature is zero for them)")

    print(f"\n{'model / features':28s}{'param':>6s} {'rain caught':>12s} {'dry->rain':>10s} {'rain right':>11s} {'bal.acc':>8s}")
    preds, models = {}, {}
    for name, ut, uc, ul, pca, kind in [("E   embedding (PCA 64)", False, False, False, True, "ridge"),
                                        ("E*  embedding, whole", False, False, False, False, "ridge"),
                                        ("E+T + time of day", True, False, False, True, "ridge"),
                                        ("E+T+C + camera id", True, True, False, True, "ridge"),
                                        ("E+T+L + camera x,y", True, False, True, True, "ridge"),
                                        ("RF  E (PCA 64)", False, False, False, True, "rf"),
                                        ("RF  E+T", True, False, False, True, "rf"),
                                        ("RF  E+T+L", True, False, True, True, "rf")]:
        f, m, l2 = train(tr, cache, ut, uc, ul, pca, kind)
        models[name] = (f, m, l2)
        p = predict(m, f(te, cache))
        for r, v in zip(te, p):
            r[name] = bool(v)
        s = score(te, name)
        preds[name] = s
        print(f"{name:28s}{l2:6g} {s['rain caught']:12.0%} {s['dry called rain']:10.0%} "
              f"{s['rain calls right']:11.0%} {s['balanced acc']:8.0%}")

    # Head to head with Gemma: every gauge-labelled frame after the cut that Gemma has read
    # (perception_eval's cache), whether or not it was in the classifier's own test set. Fair, since
    # the classifier never trained on anything after the cut.
    import json
    pc = json.loads(PERCEPTION_CACHE.read_text()) if PERCEPTION_CACHE.exists() else {}
    both = []
    for r in allrows:
        g = pc.get(str(r["path"])) or pc.get(str(Path(r["path"]).resolve()))
        if g and r["captured"] >= cut_t:
            both.append({**r, "path": Path(r["path"]).resolve(), "lat": where[r["camera"]][0],
                         "lon": where[r["camera"]][1], "gemma": bool(g["falling"] or g["water"] >= SOAKED)})
    if both:
        missing = embed_all(client, args.model, cache, both, args.workers)
        both = [r for r in both if rel(r["path"]) in cache.v]
        best_name = max(preds, key=lambda k: preds[k]["balanced acc"])
        f, m, _ = models[best_name]
        for r, v in zip(both, predict(m, f(both, cache))):
            r[best_name] = bool(v)
        print(f"\nhead to head on the {len(both)} frames after the cut that Gemma has read "
              f"({sum(r['truth'] == 'rain' for r in both)} rain, {sum(r['truth'] == 'dry' for r in both)} dry; "
              f"{missing} embedded for this):")
        for label, key in [("A  gemma (production rule)", "gemma"), (f"B  {best_name}", best_name)]:
            s_ = score(both, key)
            print(f"   {label:34s} rain caught {s_['rain caught']:4.0%}  dry->rain {s_['dry called rain']:4.0%}  "
                  f"rain right {s_['rain calls right']:4.0%}  bal.acc {s_['balanced acc']:4.0%}")
        a, b, p = mcnemar(both, "gemma", best_name)
        print(f"   only gemma right {a}, only classifier right {b}, McNemar p = {p:.3f}")
        # Combining the two in code, not in the prompt: the classifier's verdict never reaches Gemma.
        for r in both:
            r["either"] = r["gemma"] or r[best_name]
            r["both agree"] = r["gemma"] and r[best_name]
        for label, key in [("A or B  (rain if either says rain)", "either"), ("A and B (rain only if both do)", "both agree")]:
            s_ = score(both, key)
            print(f"   {label:34s} rain caught {s_['rain caught']:4.0%}  dry->rain {s_['dry called rain']:4.0%}  "
                  f"rain right {s_['rain calls right']:4.0%}  bal.acc {s_['balanced acc']:4.0%}")
    else:
        print("\n(no frames after the cut read by Gemma -- run embedding_eval.py for the head to head)")

    if args.save:
        save_model(tr, te, rows, cache, args.model, preds.get("E+T + time of day"))

    night = [r for r in te if not (6 <= r["captured"].astimezone(ICT).hour < 18)]
    day = [r for r in te if r not in night]
    for label, sub in [("day", day), ("night", night)]:
        if sub:
            s = score(sub, "E+T+L + camera x,y")
            print(f"E+T+L {label:5s}: n={s['n']:4d} rain caught {s['rain caught']:4.0%} dry->rain {s['dry called rain']:4.0%}")


if __name__ == "__main__":
    main()
