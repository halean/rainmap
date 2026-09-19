"""
Graded wetness carried forward, instead of a binary dry/wet flag.

Run: .venv/bin/python scripts/graded_probe.py

Earlier attempts treated the road as dry-or-wet and the transition as a switch:
  two-frame (variant D)  "already wet in BOTH frames is aftermath -> No"
                         killed genuine continuing rain mid-downpour
  stateful (binary)      caught the onset, then went quiet immediately

Both fail for the same reason: wet->wet is treated as carrying no information.
It does. A road that is getting WETTER is still being rained on; a road drying
out is not. So the model reports a wetness LEVEL, and the level's direction of
travel drives the verdict:

    level up            water is arriving -> rain, intensity from the jump size
    level same, wet     ambiguous, and staler with every step: the run of
                        unchanged steps is fed back so confidence decays
    level down          drying out -> rain has stopped

The decay matters because rain here is finite and abrupt. One step at the same
level means little; four means the road has simply been wet for twenty minutes.

Scored against VRAIN gauges rather than my own reading of the frames: run the
chain across a storm a gauge measured, and check the rain period the chain
reports lines up with the hour the gauge recorded.
"""

import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config
from scripts.gauge_eval import km, load_gauges, mm_for_frame
from scripts.rain_annotator import (
    DARK_GUIDANCE, DAY_GUIDANCE, DAY_RELAX, ICT, PROMPT_HEAD, TAIL_OPEN,
    TAIL_WARN, captured_at_from,
)

REPO = Path(__file__).resolve().parents[1]
RAW = REPO / "data" / "raw"

LEVELS = ["dry", "damp", "wet", "soaked", "standing water"]

LEVEL_RULES = (
    "Report how much water is lying on the road, on this scale:\n"
    "    dry            matte surface, no sheen\n"
    "    damp           darkened but not reflecting much\n"
    "    wet            reflecting light across most of the carriageway\n"
    "    soaked         mirror-like, water visibly covering the surface\n"
    "    standing water pooling, puddles, vehicles throwing up spray\n\n"
)

STATE_RULES = (
    "The same camera was judged {mins} minutes ago:\n"
    "    water on the road then: {level}\n"
    "    verdict then: {rain}\n"
    "{staleness}"
    "\nWhat that tells you:\n"
    "- MORE water now than then means water has been arriving in between. It is raining. Pick the "
    "intensity from how big the change is: dry to soaked in a few minutes means it came down hard.\n"
    "- LESS water now than then means the road is drying and the rain has stopped. Answer 'No' "
    "unless you can actually see water falling in this frame.\n"
    "- The SAME amount of water tells you less than either. The rain may still be falling steadily, "
    "or it may have stopped and left the road wet -- both look alike. Decide on what is visible in "
    "this frame right now: streaks in the light, spray off vehicles, ripples in standing water, "
    "riders in ponchos. Without any of that, an unchanged wet road is more likely to be the "
    "aftermath than the rain itself.\n\n"
)

STALENESS = (
    "    the road has been at that same level for {mins} minutes now, with nothing new arriving\n"
)

NO_BULLET = (
    "- 'No': no water is falling right now. A wet road on its own is not rain -- rain here stops as "
    "abruptly as it starts and leaves the street soaked behind it.\n\n"
)

SCHEMA = (
    "Respond with STRICT JSON only, no markdown fences, no extra text, matching this schema: "
    '{"water": "<one of: dry, damp, wet, soaked, standing water>", '
    '"rain": "<one of: No, Light, Medium, Heavy>", '
    '"justification": "<one short sentence about the street itself, for a reader who sees only '
    'this photo -- never mention frames, comparisons, or earlier judgments>"}'
)


def build(iso, prev):
    local = datetime.fromisoformat(iso).astimezone(ICT)
    is_dark = local.hour < 6 or local.hour >= 18
    when = (f"This frame was captured at {local.strftime('%H:%M')} local time in Ho Chi Minh City, "
            f"which is {'after dark' if is_dark else 'daylight'}.\n\n")
    state = ""
    if prev:
        stale = ""
        if prev["flat_mins"] >= 10:
            stale = STALENESS.format(mins=prev["flat_mins"])
        state = STATE_RULES.format(mins=prev["mins"], level=prev["level"].upper(),
                                   rain=prev["rain"], staleness=stale)
    # DAY_RELAX is what production now ships. The previous run of this probe
    # omitted it, which is why the model named raincoats all through the
    # downpour and still answered No: the gradient had saturated at "soaked"
    # and nothing else was permitted to carry a daylight verdict.
    guidance = DARK_GUIDANCE if is_dark else DAY_GUIDANCE + DAY_RELAX
    return (PROMPT_HEAD + when + guidance
            + LEVEL_RULES + state + TAIL_OPEN + NO_BULLET + TAIL_WARN + SCHEMA)


def parse(text):
    cleaned = re.sub(r"^```(json)?|```$", "", (text or "").strip(), flags=re.MULTILINE).strip()
    try:
        d = json.loads(cleaned)
        lvl = str(d.get("water", "?")).lower().strip()
        return lvl, d.get("rain", "?"), d.get("justification", "")
    except Exception:
        return "?", "PARSE_FAIL", cleaned[:110]


def rank(level):
    return LEVELS.index(level) if level in LEVELS else None


def frames(cam, day, lo, hi):
    d = RAW / cam / "2026" / "09" / day
    if not d.exists():
        return []
    return sorted(p for p in d.glob("*.jpg")
                  if lo <= p.stem[9:15] <= hi and p.stat().st_size >= 5 * 1024)


def run(client, t, cam, day, lo, hi, label, gauge_note):
    fr = frames(cam, day, lo, hi)
    print(f"\n{'=' * 104}\n{label}\n  {gauge_note}\n{'=' * 104}")
    print(f"  {'local':<7} {'water':<14} {'dir':<5} {'rain':<7} {'gauge':<9} justification")
    print("  " + "-" * 100)
    series, coord = load_gauges()
    prev = None
    for p in fr:
        iso = captured_at_from(p)
        for attempt in range(3):
            try:
                resp = client.models.generate_content(
                    model=config.GOOGLE_MODEL,
                    contents=[build(iso, prev),
                              t.Part.from_bytes(data=p.read_bytes(), mime_type="image/jpeg")],
                    config=t.GenerateContentConfig(
                        media_resolution=t.MediaResolution.MEDIA_RESOLUTION_HIGH,
                        temperature=config.GOOGLE_TEMPERATURE),
                )
                break
            except Exception as e:
                if attempt == 2:
                    print(f"  {p.stem[9:15]} ERROR {str(e)[:60]}")
                    resp = None
                time.sleep(4)
        if resp is None:
            continue
        level, rain, why = parse(getattr(resp, "text", ""))
        ft = datetime.fromisoformat(iso)
        loc = ft.astimezone(ICT).strftime("%H:%M")

        arrow, flat = "-", 0
        if prev:
            a, b = rank(prev["level"]), rank(level)
            if a is not None and b is not None:
                arrow = "UP" if b > a else ("down" if b < a else "same")
                flat = prev["flat_mins"] + prev["mins"] if arrow == "same" else 0
        gm = mm_for_frame(series, min(coord, key=lambda s: km(
            *COORDS[cam], *coord[s])), ft)
        gtxt = f"+{gm}mm" if gm else ("0.0" if gm == 0 else "n/a")
        mark = "  <<<" if rain != "No" else ""
        print(f"  {loc:<7} {level:<14} {arrow:<5} {rain:<7} {gtxt:<9} {why[:46]}{mark}")
        gap = 5 if prev is None else round((ft - prev["ft"]).total_seconds() / 60)
        prev = {"level": level, "rain": rain, "mins": gap, "ft": ft, "flat_mins": flat}


COORDS = {}


def main():
    from google import genai
    from google.genai import types as t
    cams = {c["camera_id"]: c for c in json.loads(
        (REPO / "data" / "derived" / "rain_sample.json").read_text())}
    for cid, c in cams.items():
        if c.get("lat") is not None:
            COORDS[cid] = (c["lat"], c["lon"])
    client = genai.Client(api_key=config.GOOGLE_API_KEY)

    cases = [
        # gauge-confirmed storm: Hóc Môn 1.3km away recorded +17.2mm in the hour
        # ending 07:09Z and +3.2mm the hour before. The chain should light up
        # across that and then decay, not stay lit all afternoon.
        ("6623ef2b6f998a001b252753", "14", "053000", "090000",
         "QL 22 - Nguyễn Văn Bứa 1 area, 12:30-16:00 local, 14 Sep",
         "gauge Hóc Môn 1.3km: +3.2mm hour ending 06:09Z, +17.2mm hour ending 07:09Z"),
        # known dry night, where the binary two-frame version invented Heavy
        ("6623ef2b6f998a001b252753", "13", "202000", "205500",
         "same camera, 03:20-03:55 local, 13 Sep",
         "gauge Hóc Môn flat all night -- must stay No"),
    ]
    for cam, day, lo, hi, label, note in cases:
        if cam not in COORDS:
            print(f"skip {label}: camera not in current sample")
            continue
        run(client, t, cam, day, lo, hi, label, note)


if __name__ == "__main__":
    main()
