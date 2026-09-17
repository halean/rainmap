"""
Splits the judgment in two -- perception by the model, decision in code -- and scores the
decision offline against VRAIN gauge labels.

Run: .venv/bin/python scripts/perception_eval.py [--per-class 20] [--workers 4] [--refresh]

Why split it. Scoring prompt variants against the gauge set (gauge_eval.py) showed the
model's PERCEPTION is not the weak part: on frames it called 'No' while a gauge 2km away
measured 8-15mm, its own justification read "the road is fully soaked and mirror-like, but
there are no visible streaks of falling rain". It saw the water correctly and then a
decision rule -- "only visible falling water counts" -- threw the observation away. Prompt
variants B and C tried to move that rule by rewording the same single call, and each one
moved errors around: C bought +20pt recall in daylight and immediately overcalled a busy,
normally-behaving street as rain, quoting the tie-break clause back as its reason.

So this asks the model only what it can see:
    water      how much water is lying on the road (rain_annotator's LEVEL_RULES scale)
    falling    is falling water DIRECTLY visible -- streaks, spray, ripples, lens droplets
    behaviour  are people acting like it is raining -- ponchos, umbrellas, sheltering

and leaves "is it raining" to RULES below, in Python, where it can be changed and rescored
without spending a single call. Perception is cached per frame path, so the second run of
a rule sweep costs nothing.

'behaviour' has three values, not two. The night misses were all expressway and ramp
cameras -- Trung Luong, Huynh Man Dat -- carrying cars and trucks at a distance, where no
rider or pedestrian is visible to have behaviour at all. A yes/no field makes those frames
look like positive evidence of dry ("no ponchos"), which is how a poncho-shaped rule
quietly fails on every camera that has no motorbikes in it. 'none visible' keeps absence
of evidence out of the evidence.

Labels come from gauge_eval (>= WET_MM within MAX_KM for RAIN, all gauges within
DRY_RADIUS_KM flat for DRY) and carry its caveats: HCMC convective rain is patchy, so some
RAIN frames legitimately show a dry road and no rule can or should call those.
"""

import argparse
import json
import random
import re
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config
from scripts.gauge_eval import (
    DRY_RADIUS_KM, MAX_KM, MIN_BYTES, RAIN_SAMPLE, RAW, WET_MM,
    km, load_gauges, mm_for_frame,
)
from scripts.rain_annotator import (
    BEHAVIOUR_Q, FALLING_Q, ICT, LEVEL_RULES, PERCEPTION_SCHEMA, PERCEPTION_TASK,
    PROMPT_HEAD, build_prompt, captured_at_from, phase_for,
)

REPO = Path(__file__).resolve().parents[1]
CACHE = REPO / "data" / "derived" / "perception_cache.json"

# How far back a frame counts as "the previous look at this camera". The fetch sweep is
# ~300s, so the real gap is ~5min; anything beyond 20min is a different weather situation
# and a stale comparison is worse than none.
PREV_MIN_SEC = 120
PREV_MAX_SEC = 20 * 60

LADDER = ["dry", "damp", "wet", "soaked", "standing water"]
SOAKED = LADDER.index("soaked")

# The prompt itself lives in rain_annotator, and this asks for it through the same
# build_prompt() production calls. An eval that keeps its own copy of the prompt stops
# predicting production the first time one of them is edited.
def build_perception_prompt(captured_at_iso):
    return build_prompt(captured_at_iso)


def parse_perception(text):
    cleaned = re.sub(r"^```(json)?|```$", "", (text or "").strip(), flags=re.MULTILINE).strip()
    try:
        d = json.loads(cleaned)
    except Exception:
        return None
    water = str(d.get("water", "")).strip().lower()
    if water not in LADDER:
        return None
    falling = str(d.get("falling", "")).strip().lower()
    behaviour = str(d.get("behaviour", "")).strip().lower()
    return {
        "water": LADDER.index(water),
        "falling": falling == "yes",
        "behaviour": behaviour if behaviour in ("yes", "no", "none visible") else "none visible",
    }


# Each rule takes the current frame's perception and the previous frame's (or None) and
# returns whether it is raining. Everything here is free to change: rescoring a rule costs
# no API calls once the cache is warm.
RULES = {
    # What production effectively does: only water you can watch fall counts.
    "R0 falling only":
        lambda c, p: c["falling"],
    # DAY_RELAX's conjunction, made explicit and applied at any hour.
    "R1 falling | soaked+behaviour":
        lambda c, p: c["falling"] or (c["water"] >= SOAKED and c["behaviour"] == "yes"),
    # DAY_RELAX_STRONG's reading: a soaked road carries it alone.
    "R2 falling | soaked":
        lambda c, p: c["falling"] or c["water"] >= SOAKED,
    # The comparison the stateful prompt describes, done in code instead.
    "R3 falling | rising":
        lambda c, p: c["falling"] or (p is not None and c["water"] > p["water"]),
    "R4 R1 | rising":
        lambda c, p: (c["falling"] or (c["water"] >= SOAKED and c["behaviour"] == "yes")
                      or (p is not None and c["water"] > p["water"])),
    # Rising, or holding at soaked. A road that stays mirror-like rather than drying is
    # still receiving water -- in this heat a soaked road does not hold for long unaided.
    "R5 R1 | rising | holding soaked":
        lambda c, p: (c["falling"] or (c["water"] >= SOAKED and c["behaviour"] == "yes")
                      or (p is not None and c["water"] > p["water"])
                      or (p is not None and c["water"] >= SOAKED and p["water"] >= SOAKED)),
    "R6 falling | rising | holding soaked":
        lambda c, p: (c["falling"]
                      or (p is not None and c["water"] > p["water"])
                      or (p is not None and c["water"] >= SOAKED and p["water"] >= SOAKED)),
    # Threshold one step down the ladder. Added after the first run showed `falling` never
    # fires and `water >= soaked` separates the classes perfectly: the open question is
    # whether the 'wet' step is still clean or starts pulling in dry-road aftermath.
    "R7 wet+":
        lambda c, p: c["water"] >= LADDER.index("wet"),
    # Same, with an aftermath guard: visible people going about normally is the one signal
    # that a wet road is finished rain rather than current rain. 'none visible' must not
    # count as that -- absence of people is not evidence either way.
    "R8 wet+ & not behaving-dry":
        lambda c, p: c["water"] >= LADDER.index("wet") and c["behaviour"] != "no",
    "R9 soaked+ | wet+behaviour":
        lambda c, p: (c["water"] >= SOAKED
                      or (c["water"] >= LADDER.index("wet") and c["behaviour"] == "yes")),
}


def find_prev(path, frame_t):
    """The most recent frame from the same camera inside the comparison window."""
    best = None
    for q in path.parent.parent.parent.rglob("*.jpg"):
        try:
            qt = datetime.strptime(q.stem[:15], "%Y%m%d_%H%M%S").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        gap = (frame_t - qt).total_seconds()
        if PREV_MIN_SEC <= gap <= PREV_MAX_SEC and q.stat().st_size >= MIN_BYTES:
            if best is None or qt > best[1]:
                best = (q, qt)
    return best[0] if best else None


def build_sample(per_class, seed):
    series, coord = load_gauges()
    cams = [c for c in json.loads(RAIN_SAMPLE.read_text()) if c.get("lat") is not None]
    lo = min(t for s in series for t, _ in series[s])
    hi = max(t for s in series for t, _ in series[s])

    wet_frames, dry_frames = [], []
    for c in cams:
        st = min(coord, key=lambda s: km(c["lat"], c["lon"], *coord[s]))
        dist = km(c["lat"], c["lon"], *coord[st])
        if dist > MAX_KM:
            continue
        near = [s for s in coord if km(c["lat"], c["lon"], *coord[s]) <= DRY_RADIUS_KM]
        cdir = RAW / c["camera_id"]
        if not cdir.exists():
            continue
        # sorted(), because rglob's order is filesystem order: without this a fixed seed
        # still shuffles a differently-ordered list on each run and the "same" sample is
        # not the same sample. gauge_eval has this bug; two runs there drew different sets.
        for p in sorted(cdir.rglob("*.jpg")):
            try:
                ft = datetime.strptime(p.stem[:15], "%Y%m%d_%H%M%S").replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            if not (lo <= ft <= hi) or p.stat().st_size < MIN_BYTES:
                continue
            r = mm_for_frame(series, st, ft)
            if r is None:
                continue
            row = {"path": p, "camera": c["location_text"], "gauge": st,
                   "km": round(dist, 1), "mm": r, "captured": ft}
            if r >= WET_MM:
                wet_frames.append(row)
            elif r == 0 and all((mm_for_frame(series, s, ft) or 0) == 0 for s in near):
                dry_frames.append(row)

    rng = random.Random(seed)
    rng.shuffle(wet_frames)
    rng.shuffle(dry_frames)
    sample = wet_frames[:per_class] + dry_frames[:per_class]
    for r in sample:
        r["truth"] = "rain" if r["mm"] >= WET_MM else "dry"
    return sample, len(wet_frames), len(dry_frames)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-class", type=int, default=20)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--refresh", action="store_true", help="ignore cached perceptions")
    args = ap.parse_args()

    sample, n_wet, n_dry = build_sample(args.per_class, args.seed)
    print(f"gauge-anchored set: {sum(1 for r in sample if r['truth']=='rain')} rain, "
          f"{sum(1 for r in sample if r['truth']=='dry')} dry (from {n_wet} / {n_dry} candidates)")

    for r in sample:
        r["prev"] = find_prev(r["path"], r["captured"])
    have_prev = sum(1 for r in sample if r["prev"])
    print(f"previous frame available: {have_prev}/{len(sample)}")

    cache = {} if args.refresh or not CACHE.exists() else json.loads(CACHE.read_text())
    wanted = {str(r["path"]) for r in sample} | {str(r["prev"]) for r in sample if r["prev"]}
    todo = sorted(wanted - set(cache))
    print(f"perception: {len(wanted) - len(todo)} cached, {len(todo)} to fetch")

    if todo:
        from google import genai
        from google.genai import types as t
        client = genai.Client(api_key=config.GOOGLE_API_KEY)

        def run(path_str):
            p = Path(path_str)
            prompt = build_perception_prompt(captured_at_from(p))
            for attempt in range(3):
                try:
                    resp = client.models.generate_content(
                        model=config.GOOGLE_MODEL,
                        contents=[prompt, t.Part.from_bytes(
                            data=p.read_bytes(), mime_type="image/jpeg")],
                        config=t.GenerateContentConfig(
                            media_resolution=t.MediaResolution.MEDIA_RESOLUTION_HIGH,
                            temperature=config.GOOGLE_TEMPERATURE),
                    )
                    return path_str, parse_perception(getattr(resp, "text", ""))
                except Exception:
                    if attempt == 2:
                        return path_str, None
                    time.sleep(4)

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for i, (path_str, got) in enumerate(pool.map(run, todo), 1):
                cache[path_str] = got
                if i % 20 == 0:
                    print(f"  {i}/{len(todo)}")
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(cache, indent=1))

    scored = []
    for r in sample:
        cur = cache.get(str(r["path"]))
        if not cur:
            continue
        prev = cache.get(str(r["prev"])) if r["prev"] else None
        scored.append({**r, "cur": cur, "prev_p": prev})
    print(f"scored: {len(scored)}/{len(sample)} (rest failed to parse)\n")

    # What the three observations look like per class -- the ceiling on any rule built
    # from them. If 'falling' is rarely true on RAIN frames, no decision rule that
    # requires it can score well, and that is a fact about the camera, not the prompt.
    print("perception by truth class:")
    for truth in ("rain", "dry"):
        rows = [r for r in scored if r["truth"] == truth]
        if not rows:
            continue
        soaked = sum(1 for r in rows if r["cur"]["water"] >= SOAKED)
        falling = sum(1 for r in rows if r["cur"]["falling"])
        beh_yes = sum(1 for r in rows if r["cur"]["behaviour"] == "yes")
        beh_none = sum(1 for r in rows if r["cur"]["behaviour"] == "none visible")
        rising = sum(1 for r in rows if r["prev_p"] and r["cur"]["water"] > r["prev_p"]["water"])
        held = sum(1 for r in rows if r["prev_p"] and r["cur"]["water"] >= SOAKED
                   and r["prev_p"]["water"] >= SOAKED)
        print(f"  {truth:<5} n={len(rows):<3} soaked+={soaked:<3} falling={falling:<3} "
              f"behaviour:yes={beh_yes:<3} none={beh_none:<3} rising={rising:<3} held-soaked={held}")
        hist = defaultdict(int)
        for r in rows:
            hist[LADDER[r["cur"]["water"]]] += 1
        print("        water: " + "  ".join(f"{k}={hist[k]}" for k in LADDER))

    print()
    print(f"{'rule':<34} {'rain recall':<15} {'dry precision':<16} {'overall'}")
    print("-" * 82)
    nr = sum(1 for r in scored if r["truth"] == "rain")
    nd = sum(1 for r in scored if r["truth"] == "dry")
    for name, rule in RULES.items():
        tp = sum(1 for r in scored if r["truth"] == "rain" and rule(r["cur"], r["prev_p"]))
        fp = sum(1 for r in scored if r["truth"] == "dry" and rule(r["cur"], r["prev_p"]))
        print(f"{name:<34} {tp}/{nr} ({100*tp/max(nr,1):>4.0f}%)    "
              f"{nd-fp}/{nd} ({100*(nd-fp)/max(nd,1):>4.0f}%)     {tp+nd-fp}/{len(scored)}")


if __name__ == "__main__":
    main()
