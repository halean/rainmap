"""
A/B: does an image embedding read rain off a camera frame as well as the Gemma annotator?

Run: .venv/bin/python scripts/embedding_eval.py [--per-class 150] [--seed 11] [--model gemini-embedding-2]

Truth: the VRAIN gauges, never either model -- perception_eval.build_sample's RAIN (nearest gauge
<= 4 km measured >= 5 mm in the hour containing the frame) and DRY (every gauge within 10 km read
zero) frames. RAIN labels are the noisy ones (convective rain is patchy, a frame can fall between
showers), so neither arm can reach 100% there; DRY labels are strong.

A  Gemma: the production decision rule (rain_annotator.decide, perception_eval's R2: water seen
   falling, or the road soaked or worse) on perception_eval's prompt. Readings come from and go
   to perception_eval's cache (data/derived/perception_cache.json). That prompt has no per-camera
   notes, unlike production, which adds them for a handful of cameras.
B  Embedding, the simplest possible classifier: no training. The frame's embedding is compared with
   the embeddings of the words "rain" and "dry" (gemini-embedding-2 puts text and images in one
   space) and called rain if it sits closer to "rain". Also reported: one threshold on that margin,
   tuned on the earlier half of the frames by date and scored only on the later half -- a random
   split would leak, since consecutive frames from one storm are near-copies.

Uses GOOGLE_API_FREE_KEY (free tier) unless --paid.
Embeddings are cached per model in data/derived/embedding_cache/, keyed by frame path (or "text:"),
so a rerun, or new anchor words, pays only for what is new. Cost: $0.00012 per new image at
standard prices (Gemini API pricing, 1 Oct 2026); text is negligible.
"""

import argparse
import base64
import json
import math
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from google import genai
from google.genai import types as t

from app import config
from scripts.perception_eval import CACHE as PERCEPTION_CACHE, SOAKED, build_perception_prompt, build_sample, parse_perception
from scripts.rain_annotator import captured_at_from

REPO = Path(__file__).resolve().parents[1]
EMB_DIR = REPO / "data" / "derived" / "embedding_cache"
ANCHORS = {"rain": "rain", "dry": "dry"}
ICT = timezone(timedelta(hours=7))
IMAGE_PRICE = 0.00012


def experiment_client(paid: bool = False):
    """The free-tier key unless --paid: these are experiments, and the free tier embeds for nothing.
    Refuses to fall back silently to the paid key."""
    key = config.GOOGLE_API_KEY if paid else config.GOOGLE_API_FREE_KEY
    if not key:
        sys.exit("GOOGLE_API_FREE_KEY is not set in .env (or pass --paid to use GOOGLE_API_KEY)")
    return genai.Client(api_key=key)


def retry_wait(err, attempt):
    """Seconds to wait before retrying: the API's own 'retry in Ns' on a rate limit (the free tier
    hits it), otherwise a short growing pause."""
    m = re.search(r"retry in ([0-9.]+)\s*s", str(err), re.IGNORECASE)
    return float(m.group(1)) + 1 if m else 5 * (attempt + 1)


# ---- embedding cache -------------------------------------------------------------------------------
class EmbeddingCache:
    """One JSONL file per model: {"key": ..., "v": base64 float32}. Appended as it goes, so an
    interrupted run keeps what it paid for."""

    def __init__(self, model: str):
        EMB_DIR.mkdir(parents=True, exist_ok=True)
        self.path = EMB_DIR / f"{model}.jsonl"
        self.v = {}
        # Also the annotator's shadow-mode embeddings (app/services/rain_shadow.py), which only it
        # writes; reading both means a frame it already embedded is never paid for twice.
        for path in [self.path, *sorted(EMB_DIR.glob(f"{model}.*.jsonl"))]:
            if not path.exists():
                continue
            for line in path.read_text().splitlines():
                d = json.loads(line)
                self.v[d["key"]] = np.frombuffer(base64.b64decode(d["v"]), dtype=np.float32)

    def put(self, key: str, vec) -> None:
        a = np.asarray(vec, dtype=np.float32)
        self.v[key] = a
        with self.path.open("a") as f:
            f.write(json.dumps({"key": key, "v": base64.b64encode(a.tobytes()).decode()}) + "\n")


def rel(p: Path) -> str:
    return str(p.relative_to(REPO))


def embed_all(client, model, cache, sample, workers):
    for name, text in ANCHORS.items():
        if f"text:{text}" not in cache.v:
            r = client.models.embed_content(model=model, contents=text)
            cache.put(f"text:{text}", r.embeddings[0].values)
    todo = [r["path"] for r in sample if rel(r["path"]) not in cache.v]

    def one(p):
        # One image per call: several parts in one request may be combined into one embedding.
        for attempt in range(6):
            try:
                r = client.models.embed_content(
                    model=model, contents=[t.Part.from_bytes(data=p.read_bytes(), mime_type="image/jpeg")])
                return p, r.embeddings[0].values
            except Exception as e:
                if attempt == 5:
                    print(f"   embedding failed for {rel(p)}: {str(e)[:120]}")
                    return p, None
                time.sleep(retry_wait(e, attempt))

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for p, v in pool.map(one, todo):
            if v is not None:
                cache.put(rel(p), v)
    return len(todo)


# ---- the frame pool, frozen on disk ---------------------------------------------------------------
POOL_PATH = REPO / "data" / "derived" / "embedding_eval_pool.json"


def load_pool(seed: int, until: datetime, rebuild: bool = False) -> list[dict]:
    """Every gauge-labelled frame, in build_sample's shuffled order, saved once and reused.

    Rebuilding it from the live data each run drew a different pool every time -- the watchdog
    rotates the cameras build_sample draws from, and frames near the end only get a label once the
    next gauge reading lands -- so every run re-embedded hundreds of frames. --rebuild-pool on
    purpose, for fresh data."""
    if POOL_PATH.exists() and not rebuild:
        d = json.loads(POOL_PATH.read_text())
        rows = d["rows"]
    else:
        rows_, _, _ = build_sample(10 ** 7, seed, until=until)
        rows = [{"path": rel(Path(r["path"]).resolve()), "camera": r["camera"], "gauge": r["gauge"],
                 "km": r["km"], "mm": r["mm"], "truth": r["truth"], "captured": r["captured"].isoformat()}
                for r in rows_]
        POOL_PATH.write_text(json.dumps({"seed": seed, "until": until.isoformat(), "rows": rows}, ensure_ascii=False))
    for r in rows:
        r["path"] = REPO / r["path"]
        r["captured"] = datetime.fromisoformat(r["captured"]) if isinstance(r["captured"], str) else r["captured"]
    return rows


def take_sample(pool, per_class):
    wet = [r for r in pool if r["truth"] == "rain"][:per_class]
    dry = [r for r in pool if r["truth"] == "dry"][:per_class]
    return wet + dry


# ---- Gemma, via perception_eval's cache -----------------------------------------------------------
def gemma_readings(client, sample, workers):
    cache = json.loads(PERCEPTION_CACHE.read_text()) if PERCEPTION_CACHE.exists() else {}
    todo = [str(r["path"]) for r in sample if str(r["path"]) not in cache]

    def one(path_str):
        p = Path(path_str)
        for attempt in range(3):
            try:
                resp = client.models.generate_content(
                    model=config.GOOGLE_MODEL,
                    contents=[build_perception_prompt(captured_at_from(p)),
                              t.Part.from_bytes(data=p.read_bytes(), mime_type="image/jpeg")],
                    config=t.GenerateContentConfig(media_resolution=t.MediaResolution.MEDIA_RESOLUTION_HIGH,
                                                   temperature=config.GOOGLE_TEMPERATURE))
                return path_str, parse_perception(getattr(resp, "text", ""))
            except Exception as e:
                time.sleep(retry_wait(e, attempt))
        return path_str, None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, (k, v) in enumerate(pool.map(one, todo), 1):
            cache[k] = v
            if i % 25 == 0:
                print(f"   gemma {i}/{len(todo)}")
                PERCEPTION_CACHE.write_text(json.dumps(cache, indent=1))
    PERCEPTION_CACHE.write_text(json.dumps(cache, indent=1))
    return cache, len(todo)


# ---- scoring --------------------------------------------------------------------------------------
def score(rows, key):
    tp = sum(1 for r in rows if r["truth"] == "rain" and r[key])
    fn = sum(1 for r in rows if r["truth"] == "rain" and not r[key])
    fp = sum(1 for r in rows if r["truth"] == "dry" and r[key])
    tn = sum(1 for r in rows if r["truth"] == "dry" and not r[key])
    rec = tp / (tp + fn) if tp + fn else float("nan")
    far = fp / (fp + tn) if fp + tn else float("nan")
    prec = tp / (tp + fp) if tp + fp else float("nan")
    return {"n": len(rows), "rain caught": rec, "dry called rain": far, "rain calls right": prec,
            "balanced acc": (rec + (1 - far)) / 2}


def mcnemar(rows, a, b):
    """Exact two-sided McNemar on the frames where exactly one arm is right."""
    ok = lambda r, k: (r[k] == (r["truth"] == "rain"))
    only_a = sum(1 for r in rows if ok(r, a) and not ok(r, b))
    only_b = sum(1 for r in rows if ok(r, b) and not ok(r, a))
    n, k = only_a + only_b, min(only_a, only_b)
    p = min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n) if n else 1.0
    return only_a, only_b, p


def table(title, rows, arms):
    print(f"\n{title}")
    print(f"   {'':34s}{'n':>5s} {'rain caught':>12s} {'dry->rain':>10s} {'rain right':>11s} {'bal.acc':>8s}")
    for label, key in arms:
        s = score(rows, key)
        print(f"   {label:34s}{s['n']:5d} {s['rain caught']:12.0%} {s['dry called rain']:10.0%} "
              f"{s['rain calls right']:11.0%} {s['balanced acc']:8.0%}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-class", type=int, default=150)
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--until", default="2026-10-01T17:00:00+00:00",
                    help="freeze the frame pool at this time, so reruns reuse the same frames (and cache)")
    ap.add_argument("--model", default="gemini-embedding-2")
    ap.add_argument("--workers", type=int, default=2, help="parallel calls (the free tier's limits are low)")
    ap.add_argument("--skip-gemma", action="store_true", help="embedding arm only")
    ap.add_argument("--paid", action="store_true", help="use GOOGLE_API_KEY instead of GOOGLE_API_FREE_KEY")
    ap.add_argument("--rebuild-pool", action="store_true", help="relabel frames from the live data (new pool)")
    args = ap.parse_args()

    client = experiment_client(args.paid)
    pool = load_pool(args.seed, datetime.fromisoformat(args.until), args.rebuild_pool)
    sample = take_sample(pool, args.per_class)
    n_wet, n_dry = sum(r["truth"] == "rain" for r in pool), sum(r["truth"] == "dry" for r in pool)
    print(f"gauge-labelled sample: {sum(r['truth'] == 'rain' for r in sample)} rain, "
          f"{sum(r['truth'] == 'dry' for r in sample)} dry (from {n_wet} / {n_dry} candidates)")

    cache = EmbeddingCache(args.model)
    new_img = embed_all(client, args.model, cache, sample, args.workers)
    print(f"embeddings: {new_img} new images (~${new_img * IMAGE_PRICE:.2f}), the rest from {cache.path.relative_to(REPO)}")

    unit = lambda v: v / np.linalg.norm(v)
    a_rain, a_dry = unit(cache.v[f"text:{ANCHORS['rain']}"]), unit(cache.v[f"text:{ANCHORS['dry']}"])
    rows = []
    for r in sample:
        v = cache.v.get(rel(r["path"]))
        if v is None:
            continue
        u = unit(v)
        hour = r["captured"].astimezone(ICT).hour
        rows.append({**r, "margin": float(u @ a_rain - u @ a_dry), "day": 6 <= hour < 18})
    for r in rows:
        r["emb"] = r["margin"] > 0

    arms = [("B  embedding: closer to \"rain\"", "emb")]
    if not args.skip_gemma:
        pcache, new_g = gemma_readings(client, rows, args.workers)
        print(f"gemma: {new_g} new reads, the rest from {PERCEPTION_CACHE.relative_to(REPO)}")
        for r in rows:
            p = pcache.get(str(r["path"]))
            r["gemma"] = None if p is None else bool(p["falling"] or p["water"] >= SOAKED)
        rows = [r for r in rows if r["gemma"] is not None]
        arms = [("A  gemma (production rule)", "gemma")] + arms

    # One tuned threshold: chosen on the earlier half by date, scored on the later half only.
    rows.sort(key=lambda r: r["captured"])
    half = len(rows) // 2
    early, late = rows[:half], rows[half:]
    cands = sorted({round(r["margin"], 4) for r in early})
    best = max(cands, key=lambda th: score([{**r, "x": r["margin"] > th} for r in early], "x")["balanced acc"])
    for r in rows:
        r["emb_tuned"] = r["margin"] > best
    print(f"tuned margin threshold {best:+.4f} (from {early[0]['captured']:%d %b} - {early[-1]['captured']:%d %b}); "
          f"scored on {late[0]['captured']:%d %b} - {late[-1]['captured']:%d %b}")

    table("ALL FRAMES (no training involved)", rows, arms)
    table("LATER HALF (where the tuned threshold is fair)", late, arms + [("B' embedding: tuned threshold", "emb_tuned")])
    table("DAY (06-18 ICT)", [r for r in rows if r["day"]], arms)
    table("NIGHT", [r for r in rows if not r["day"]], arms)
    if not args.skip_gemma:
        a, b, p = mcnemar(rows, "gemma", "emb")
        print(f"\npaired, all frames: only gemma right {a}, only embedding right {b}, McNemar p = {p:.3f}"
              f" -> {'a real difference' if p < 0.05 else 'not distinguishable at this sample size'}")
    m = np.array([r["margin"] for r in rows]); y = np.array([r["truth"] == "rain" for r in rows])
    print(f"margin (rain - dry similarity): rain frames median {np.median(m[y]):+.4f}, dry frames median {np.median(m[~y]):+.4f}")


if __name__ == "__main__":
    main()
