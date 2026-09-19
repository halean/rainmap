"""
Builds a labelled-evaluation manifest from frames already on disk.

Run: .venv/bin/python scripts/build_test_set.py [--hours 24] [--seed 7]

Produces data/test_sets/<stamp>/manifest.csv, one row per sampled frame. No
images are copied -- data/raw already holds them and the manifest points at
them, so a 24h set costs kilobytes rather than gigabytes.

Sampling is NESTED on purpose: the Pro tier is a strict subset of the Flash
tier. Two independent samples could not be compared to each other at all --
any difference would be the frames, not the models. Every Pro row therefore
has a Flash row for the same frame.

Each row also carries the preceding frame and the gap to it, so the same set
can evaluate single-frame and two-frame prompting without being rebuilt, and
a `gauge_delta_mm` column giving the nearest VRAIN station's accumulation
change around that moment -- real measured ground truth where the poller was
already running, blank where it was not.
"""

import argparse
import csv
import json
import math
import random
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

REPO = Path(__file__).resolve().parents[1]
RAW = REPO / "data" / "raw"
SAMPLE_CAMERAS = REPO / "data" / "derived" / "sample_cameras.json"
RAIN_SAMPLE = REPO / "data" / "derived" / "rain_sample.json"
VRAIN_HISTORY = REPO / "data" / "derived" / "vrain_history.csv"
OUT_ROOT = REPO / "data" / "test_sets"

ICT = timezone(timedelta(hours=7))
PAIR_MAX_GAP_SEC = 780  # matches rain_annotator, so pair rows mean the same thing
GAUGE_WINDOW_SEC = 1800  # how far either side of the frame to look for gauge movement

FIELDS = [
    "frame_id", "camera_id", "location_text", "lat", "lon",
    "image_path", "captured_at", "local_hour", "is_dark",
    "prev_image_path", "prev_gap_sec",
    "nearest_gauge", "gauge_km", "gauge_delta_mm",
    "tier",
]


def captured_at(stem: str):
    try:
        return datetime.strptime(stem[:15], "%Y%m%d_%H%M%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def km(a, b, c, d):
    dy = (a - c) * 110.57
    dx = (b - d) * 111.32 * math.cos(math.radians((a + c) / 2))
    return math.sqrt(dx * dx + dy * dy)


def load_gauges():
    """Per-station time series of accumulated depth, if the poller has run."""
    if not VRAIN_HISTORY.exists():
        return {}, {}
    series, coord = defaultdict(list), {}
    with VRAIN_HISTORY.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                t = datetime.fromisoformat(r["fetched_at"])
                series[r["station"]].append((t, float(r["depth_mm"] or 0)))
                coord[r["station"]] = (float(r["lat"]), float(r["lon"]))
            except (ValueError, TypeError):
                continue
    for s in series:
        series[s].sort()
    return series, coord


def gauge_delta(series, coord, lat, lon, when):
    """Nearest station, its distance, and how much it accumulated around `when`.

    Blank when the poller has no data covering that moment -- most of a 24h
    window predates it -- which is honest rather than a misleading 0.0.
    """
    if not coord or lat is None:
        return "", "", ""
    station = min(coord, key=lambda s: km(lat, lon, *coord[s]))
    pts = series[station]
    lo = when - timedelta(seconds=GAUGE_WINDOW_SEC)
    hi = when + timedelta(seconds=GAUGE_WINDOW_SEC)
    window = [v for t, v in pts if lo <= t <= hi]
    dist = round(km(lat, lon, *coord[station]), 1)
    if len(window) < 2:
        return station, dist, ""
    return station, dist, round(max(window) - min(window), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--seed", type=int, default=7, help="fixed so the set is reproducible")
    ap.add_argument("--flash-pct", type=float, default=10.0)
    ap.add_argument("--pro-pct", type=float, default=5.0)
    args = ap.parse_args()

    cams = json.loads(SAMPLE_CAMERAS.read_text())
    names = {c["camera_id"]: c for c in json.loads(RAIN_SAMPLE.read_text())}
    series, coord = load_gauges()

    cutoff = datetime.now(timezone.utc) - timedelta(hours=args.hours)
    rows = []
    for cam in cams:
        cid = cam["camera_id"]
        cdir = RAW / cid
        if not cdir.exists():
            continue
        frames = sorted(
            (t, p) for p in cdir.rglob("*.jpg")
            if (t := captured_at(p.stem)) and t >= cutoff
        )
        for i, (t, p) in enumerate(frames):
            prev_path, prev_gap = "", ""
            if i > 0:
                pt, pp = frames[i - 1]
                gap = (t - pt).total_seconds()
                if 0 < gap <= PAIR_MAX_GAP_SEC:
                    prev_path, prev_gap = str(pp.relative_to(REPO)), int(gap)
            rec = names.get(cid, {})
            lat, lon = rec.get("lat", cam.get("lat")), rec.get("lon", cam.get("lon"))
            local = t.astimezone(ICT)
            station, dist, delta = gauge_delta(series, coord, lat, lon, t)
            rows.append({
                "frame_id": f"{cid}_{p.stem}",
                "camera_id": cid,
                "location_text": rec.get("location_text") or cam.get("display_name", ""),
                "lat": lat, "lon": lon,
                "image_path": str(p.relative_to(REPO)),
                "captured_at": t.isoformat(),
                "local_hour": local.hour,
                "is_dark": local.hour < 6 or local.hour >= 18,
                "prev_image_path": prev_path,
                "prev_gap_sec": prev_gap,
                "nearest_gauge": station, "gauge_km": dist, "gauge_delta_mm": delta,
                "tier": "",
            })

    rng = random.Random(args.seed)
    rng.shuffle(rows)
    n_flash = round(len(rows) * args.flash_pct / 100)
    n_pro = round(len(rows) * args.pro_pct / 100)
    for r in rows[:n_flash]:
        r["tier"] = "flash"
    for r in rows[:n_pro]:
        r["tier"] = "flash+pro"  # nested: Pro only ever sees frames Flash also sees
    rows.sort(key=lambda r: (r["camera_id"], r["captured_at"]))

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = OUT_ROOT / stamp
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "manifest.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)

    sampled = [r for r in rows if r["tier"]]
    dark = sum(1 for r in sampled if r["is_dark"])
    paired = sum(1 for r in sampled if r["prev_image_path"])
    gauged = sum(1 for r in sampled if r["gauge_delta_mm"] != "")
    wet_gauge = sum(1 for r in sampled if r["gauge_delta_mm"] not in ("", 0.0) and r["gauge_delta_mm"])
    print(f"manifest: {out}")
    print(f"  frames in last {args.hours}h : {len(rows):,} across {len(cams)} cameras")
    print(f"  flash tier               : {n_flash} ({args.flash_pct}%)")
    print(f"  pro tier (nested subset) : {n_pro} ({args.pro_pct}%)")
    print(f"  of the sampled frames:")
    print(f"    dark (18:00-06:00 local) : {dark} ({100*dark/max(len(sampled),1):.0f}%)")
    print(f"    have a usable prev frame : {paired} ({100*paired/max(len(sampled),1):.0f}%)")
    print(f"    covered by a VRAIN gauge : {gauged}")
    print(f"    of those, gauge moved    : {wet_gauge}")


if __name__ == "__main__":
    main()
