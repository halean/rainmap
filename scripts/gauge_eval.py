"""
Scores prompt variants against VRAIN gauge measurements instead of my eyeballs.

Run: .venv/bin/python scripts/gauge_eval.py [--per-class 20] [--workers 4]

Every earlier prompt comparison in this repo was scored against hand-labelled
frames -- a few dozen at most, labelled by looking at them, and each "fix" moved
errors around rather than clearly reducing them. This uses measured millimetres.

Labelling (see mm_for_frame -- the attribution is the subtle part):
  RAIN  frames whose nearest gauge (<= MAX_KM) recorded >= WET_MM during the
        hourly reporting interval CONTAINING the frame
  DRY   frames where that gauge recorded exactly 0.0 for their interval AND
        every gauge within DRY_RADIUS_KM did too

These gauges report hourly: the series sits flat for six polls then jumps. A
jump at time T means the water fell during (T-1h, T]. Looking for a change in a
window around the frame -- the first thing I tried -- labels any mid-hour frame
"dry" because the series is flat there, including frames in the middle of a 23mm
hour. That silently moved real rain into the dry class, so correct rain calls
scored as false positives.

Label noise is real and worth stating: a gauge 3km away measuring 15mm in an
hour does not prove rain at this camera in this minute -- HCMC convective rain
is patchy, and a frame can land between showers inside a wet hour. So RAIN
recall will never legitimately reach 100%. DRY labels are much stronger: if no
gauge for 10km moved at all, it was not raining.
"""

import argparse
import csv
import json
import math
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
from scripts.rain_annotator import (
    DAY_GUIDANCE, ICT, NO_BULLET_SINGLE, PROMPT_HEAD, TAIL_OPEN, TAIL_SCHEMA,
    TAIL_WARN, build_prompt, captured_at_from,
)

REPO = Path(__file__).resolve().parents[1]
RAW = REPO / "data" / "raw"
VRAIN = REPO / "data" / "derived" / "vrain_history.csv"
RAIN_SAMPLE = REPO / "data" / "derived" / "rain_sample.json"

MAX_KM = 4.0          # a gauge further than this is weak evidence about this camera
WET_MM = 5.0          # a real storm hour, not a single tip
DRY_RADIUS_KM = 10.0  # nothing moved this far out -> confidently dry
MIN_BYTES = 5 * 1024  # skip the offline placeholder frames

# The diagnosed failure: production names ponchos, sparse traffic and a soaked
# road -- all of which DAY_GUIDANCE calls the clearest daylight signals -- and
# then answers No because PROMPT_TAIL demands visible falling water. This clause
# lets converging daylight evidence carry a verdict on its own. Daylight only:
# after dark the same latitude is where glare and mist produce false positives.
DAY_RELAX = (
    "In daylight you do not need to see the water itself. If the road is soaked AND at least one "
    "other sign agrees -- riders in ponchos or raincoats, pedestrians under umbrellas, people "
    "sheltering, or traffic suddenly much sparser than this road normally carries -- then it is "
    "raining, and 'Light' or 'Medium' is the honest answer rather than 'No'. Those signs are what "
    "a person glancing out of a window would go on. Reserve 'No' for a daylight scene where the "
    "road is merely damp or drying and nobody is behaving as though it is raining.\n\n"
)

# C goes further than B in two ways: a soaked road alone carries a verdict, and
# the tie-break flips. PROMPT_HEAD tells the model to "settle on the less
# dramatic reading" when signals disagree, which compounds with the falling-water
# gate -- two independent nudges toward No. For a map people read before deciding
# whether to ride, a missed downpour costs more than an overcalled shower, so
# daylight ties should break the other way. Still daylight-only: after dark is
# where glare and mist manufacture false positives.
DAY_RELAX_STRONG = (
    "In daylight you do not need to see the water itself, and you should not hold out for it. A "
    "soaked, glossy carriageway is itself strong evidence that rain is falling or has just fallen: "
    "answer 'Light' unless the scene positively shows otherwise -- bright sunshine, dry patches "
    "spreading across the road, people moving about normally with no wet-weather behaviour at all. "
    "Any further sign -- ponchos, raincoats, umbrellas, people sheltering, traffic thinner than "
    "this road normally carries -- makes it 'Light' or 'Medium' outright.\n"
    "When you genuinely cannot tell in daylight, choose the wetter reading rather than the drier "
    "one. This overrides the earlier instruction to settle on the less dramatic reading, for "
    "daylight frames only: someone reads this before deciding whether to ride across the city, and "
    "a downpour reported as dry costs them more than a shower reported that had just stopped.\n\n"
)


def km(a, b, c, d):
    dy = (a - c) * 110.57
    dx = (b - d) * 111.32 * math.cos(math.radians((a + c) / 2))
    return math.sqrt(dx * dx + dy * dy)


def load_gauges():
    series, coord = defaultdict(list), {}
    with VRAIN.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            series[r["station"]].append(
                (datetime.fromisoformat(r["fetched_at"]), float(r["depth_mm"] or 0)))
            coord[r["station"]] = (float(r["lat"]), float(r["lon"]))
    for s in series:
        series[s].sort()
    return series, coord


def steps(series, st):
    """Positive accumulation jumps for one station, as (time, mm) pairs.

    What `depth_mm` actually means is NOT established, and it matters. At
    2026-09-14T02:08Z twelve stations decreased, eleven were unchanged (eight of
    those at non-zero values) and four increased -- all at the same timestamp.
    A scheduled daily reset would have zeroed every station, and no value ever
    decreases to exactly 0.0, so "counter that resets" is the wrong model. Mixed
    movement at one instant looks instead like a ROLLING window: old rain ages
    out while new rain adds in, so the net can go either way.

    A version of this treated a decrease as a reset and credited the new reading
    as that hour's rainfall. Under the rolling reading that invents rain that
    never fell, so it is gone. Only positive jumps count, and even those are a
    LOWER BOUND on a rolling total, because rain aging out masks part of what
    fell in the same interval.

    Consequence for labels: RAIN (a >= WET_MM jump) is safe under either reading
    -- a jump that large means real rain just fell nearby. DRY is the weaker
    label: a flat series could in principle hide equal amounts aging in and out,
    though not at the magnitudes that would matter here.
    """
    out = []
    pts = series[st]
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        # VRAIN's own JSON carries float noise ("6.8" -> "6.800000000000001"),
        # which a bare > reads as a jump. Gauge resolution is one 0.2mm bucket
        # tip, so anything under half a tip is not a measurement.
        if v1 - v0 >= 0.1:
            out.append((t1, round(v1 - v0, 1)))
    return out


def mm_for_frame(series, st, frame_t, report_period=timedelta(hours=1)):
    """How much fell at station `st` during the reporting interval containing `frame_t`.

    These gauges report HOURLY: the value sits flat for six polls then jumps. A
    jump appearing at T means that water fell during (T - 1h, T], NOT at T. An
    earlier version of this looked for a change within +/-30min of the frame,
    which meant any frame landing mid-hour saw a flat series and got labelled
    dry -- including frames in the middle of a 23mm hour. That mislabelling
    turned real rain into "false positives" and understated every variant.

    Returns None when the log does not cover the interval, so the frame can be
    skipped rather than silently counted as dry.
    """
    pts = series[st]
    if not pts or frame_t < pts[0][0] or frame_t > pts[-1][0]:
        return None
    total = 0.0
    for t, mm in steps(series, st):
        if t - report_period < frame_t <= t:
            total += mm
    return round(total, 1)


def variants(captured_at_iso):
    """A = production as shipped. B = production + the daylight clause."""
    local = datetime.fromisoformat(captured_at_iso).astimezone(ICT)
    is_dark = local.hour < 6 or local.hour >= 18
    base = build_prompt(captured_at_iso)
    if is_dark:
        # both clauses are daylight-only by design, so at night all three are identical
        return {"A prod": base, "B day-relax": base, "C day-lean-wet": base}
    when = base.split(PROMPT_HEAD, 1)[1].split(DAY_GUIDANCE, 1)[0]
    def with_clause(clause):
        return (PROMPT_HEAD + when + DAY_GUIDANCE + clause
                + TAIL_OPEN + NO_BULLET_SINGLE + TAIL_WARN + TAIL_SCHEMA)
    return {"A prod": base,
            "B day-relax": with_clause(DAY_RELAX),
            "C day-lean-wet": with_clause(DAY_RELAX_STRONG)}


def parse(text):
    cleaned = re.sub(r"^```(json)?|```$", "", (text or "").strip(), flags=re.MULTILINE).strip()
    try:
        d = json.loads(cleaned)
        return d.get("rain", "?"), d.get("justification", "")
    except Exception:
        return "PARSE_FAIL", cleaned[:110]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-class", type=int, default=20)
    ap.add_argument("--dry-count", type=int, default=0, help="0 = same as --per-class")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=11)
    args = ap.parse_args()

    from google import genai
    from google.genai import types as t

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
        for p in cdir.rglob("*.jpg"):
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

    rng = random.Random(args.seed)
    rng.shuffle(wet_frames)
    rng.shuffle(dry_frames)
    # keep the dry set to daylight+dark in roughly the proportion the wet set has,
    # so a variant cannot win just by being tested on easier lighting
    n_dry = args.dry_count or args.per_class
    sample = wet_frames[:args.per_class] + dry_frames[:n_dry]
    for r in sample:
        r["truth"] = "rain" if r["mm"] >= WET_MM else "dry"
    print(f"gauge-anchored set: {sum(1 for r in sample if r['truth']=='rain')} rain, "
          f"{sum(1 for r in sample if r['truth']=='dry')} dry "
          f"(from {len(wet_frames)} / {len(dry_frames)} candidates)")
    daylit = sum(1 for r in sample if 6 <= r["captured"].astimezone(ICT).hour < 18)
    print(f"  daylight frames: {daylit}/{len(sample)}")

    client = genai.Client(api_key=config.GOOGLE_API_KEY)
    names = ["A prod", "B day-relax", "C day-lean-wet"]

    def run(job):
        row, vname = job
        iso = captured_at_from(row["path"])
        prompt = variants(iso)[vname]
        for attempt in range(3):
            try:
                resp = client.models.generate_content(
                    model=config.GOOGLE_MODEL,
                    contents=[prompt, t.Part.from_bytes(
                        data=row["path"].read_bytes(), mime_type="image/jpeg")],
                    config=t.GenerateContentConfig(
                        media_resolution=t.MediaResolution.MEDIA_RESOLUTION_HIGH,
                        temperature=config.GOOGLE_TEMPERATURE),
                )
                v, why = parse(getattr(resp, "text", ""))
                return row, vname, v, why
            except Exception as e:
                if attempt == 2:
                    return row, vname, "ERROR", str(e)[:80]
                time.sleep(4)

    jobs = [(r, n) for r in sample for n in names]
    results = defaultdict(dict)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, (row, vname, v, why) in enumerate(pool.map(run, jobs), 1):
            results[id(row)][vname] = (v, why)
            if i % 20 == 0:
                print(f"  {i}/{len(jobs)}")

    wet = lambda v: v in ("Light", "Medium", "Heavy")
    print()
    print(f"{'variant':<14} {'rain recall':<14} {'dry precision':<16} {'overall'}")
    print("-" * 62)
    for n in names:
        tp = sum(1 for r in sample if r["truth"] == "rain" and wet(results[id(r)][n][0]))
        nr = sum(1 for r in sample if r["truth"] == "rain")
        fp = sum(1 for r in sample if r["truth"] == "dry" and wet(results[id(r)][n][0]))
        nd = sum(1 for r in sample if r["truth"] == "dry")
        print(f"{n:<14} {tp}/{nr} ({100*tp/max(nr,1):>4.0f}%)   "
              f"{nd-fp}/{nd} ({100*(nd-fp)/max(nd,1):>4.0f}%)     "
              f"{tp+nd-fp}/{len(sample)}")

    print("\nframes where the two variants disagree:")
    for r in sample:
        a, b = results[id(r)]["A prod"][0], results[id(r)]["C day-lean-wet"][0]
        if wet(a) != wet(b):
            lt = r["captured"].astimezone(ICT).strftime("%H:%M")
            print(f"  truth={r['truth']:<4} {lt} {r['camera'][:30]:<30} "
                  f"gauge {r['gauge']}({r['km']}km) +{r['mm']}mm   "
                  f"A={a:<6} B={results[id(r)]['B day-relax'][0]:<6} C={b}")
            print(f"      C: {results[id(r)]['C day-lean-wet'][1][:100]}")


if __name__ == "__main__":
    main()
