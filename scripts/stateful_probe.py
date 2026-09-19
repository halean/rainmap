"""
Prototype: carry the PREVIOUS JUDGMENT forward instead of the previous frame.

Run: .venv/bin/python scripts/stateful_probe.py

Not wired into production. Evaluates a third approach against the two already
measured in NOTES.md:

  single-frame  one image, no memory        -> misses the dry->wet transition
  two-frame     two images, compare them    -> catches it, but painted Heavy on
                                               dry roads (~10%) and leaked
                                               "in both frames" into popup text
  stateful      one image + last verdict    -> this

The model must also report the road surface, because a rain verdict alone cannot
carry the state: "No" covers both a dry road and a wet one with nothing falling,
and the whole transition rule turns on telling those apart.

Rules given to the model:
  dry -> wet   water fell in between; that is rain
  wet -> wet   tells you nothing new; judge THIS frame on its own for whether
               rain is still falling
  dry -> dry   no rain

Known risk this design has and two-frame does not: error propagation. A wrong
road state persists into later calls, so one bad read can poison a run. The
traces below print road state at every step so that is visible rather than
hidden.
"""

import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config
from scripts.rain_annotator import (
    DARK_GUIDANCE, DAY_GUIDANCE, ICT, PROMPT_HEAD, TAIL_OPEN, TAIL_WARN,
    captured_at_from,
)
from datetime import datetime

REPO = Path(__file__).resolve().parents[1]
RAW = REPO / "data" / "raw"

STATE_RULES = (
    "You also have the judgment made for this same camera {mins} minutes ago:\n"
    "    road surface then: {road}\n"
    "    verdict then: {rain}\n"
    "    reason then: {why}\n\n"
    "Use it like this:\n"
    "- If the road was DRY then and is WET now, water fell in between. That is rain -- report it "
    "as rain even if you cannot see anything falling in this frame, and pick the intensity the "
    "change implies: dry to fully soaked in a few minutes means it came down hard.\n"
    "- If the road was WET then and is still WET now, that tells you nothing new. The rain may "
    "have stopped and left the road wet. Judge THIS frame on its own merits: is water still "
    "falling right now?\n"
    "- If the road was DRY then and is DRY now, no rain has fallen.\n\n"
)

NO_BULLET = (
    "- 'No': no water is falling right now. A wet road on its own is not rain -- rain here stops "
    "as abruptly as it starts and leaves the street soaked behind it.\n\n"
)

# The road field inherits none of DARK_GUIDANCE's warnings, because those are
# written about evidence FOR RAIN. Diagnosed failure: at 03:48 a traffic light
# turned red, threw a red sheen across dry asphalt, the road read flipped
# dry->wet, and the transition rule dutifully reported Heavy rain on a dry night.
ROAD_GUIDANCE = (
    "Judging the road surface is a separate question from judging rain, and at night it is easy "
    "to get wrong. Call the road WET only if the sheen is broad and continuous across the surface "
    "-- the whole carriageway holding light, puddles, tyre tracks through standing water. Do NOT "
    "call it wet because of coloured pools of light from traffic signals, shop signs or "
    "headlights: those sit on dry asphalt too, and they move and change colour as the signals do "
    "while the road itself has not changed. If the only thing that looks different from a moment "
    "ago is the colour or position of reflected light, the road is unchanged.\n\n"
)

SCHEMA = (
    "Respond with STRICT JSON only, no markdown fences, no extra text, matching this schema: "
    '{"road": "<one of: dry, wet>", '
    '"rain": "<one of: No, Light, Medium, Heavy>", '
    '"justification": "<one short sentence about the street itself, for a reader who sees only '
    'this photo -- never mention frames, comparisons, or earlier judgments>"}'
)


def build(captured_at_iso, prev):
    local = datetime.fromisoformat(captured_at_iso).astimezone(ICT)
    is_dark = local.hour < 6 or local.hour >= 18
    when = (
        f"This frame was captured at {local.strftime('%H:%M')} local time in Ho Chi Minh City, "
        f"which is {'after dark' if is_dark else 'daylight'}.\n\n"
    )
    state = ""
    if prev:
        state = STATE_RULES.format(
            mins=prev["mins"], road=prev["road"].upper(), rain=prev["rain"],
            why=prev["justification"][:150],
        )
    return (
        PROMPT_HEAD + when + (DARK_GUIDANCE if is_dark else DAY_GUIDANCE)
        + ROAD_GUIDANCE + state + TAIL_OPEN + NO_BULLET + TAIL_WARN + SCHEMA
    )


def parse(text):
    cleaned = re.sub(r"^```(json)?|```$", "", (text or "").strip(), flags=re.MULTILINE).strip()
    try:
        d = json.loads(cleaned)
        return d.get("road", "?"), d.get("rain", "?"), d.get("justification", "")
    except Exception:
        return "?", "PARSE_FAIL", cleaned[:120]


def run_sequence(client, t, cam_id, frames, label, truth):
    print(f"\n{'=' * 96}\n{label}\n  ground truth: {truth}\n{'=' * 96}")
    print(f"  {'local':<7} {'road':<5} {'rain':<7} justification")
    print("  " + "-" * 92)
    prev = None
    out = []
    for p in frames:
        iso = captured_at_from(p)
        prompt = build(iso, prev)
        for attempt in range(3):
            try:
                resp = client.models.generate_content(
                    model=config.GOOGLE_MODEL,
                    contents=[prompt, t.Part.from_bytes(data=p.read_bytes(), mime_type="image/jpeg")],
                    config=t.GenerateContentConfig(
                        media_resolution=t.MediaResolution.MEDIA_RESOLUTION_HIGH,
                        temperature=config.GOOGLE_TEMPERATURE,
                    ),
                )
                break
            except Exception as e:
                if attempt == 2:
                    print(f"  {p.stem[9:15]} ERROR {str(e)[:70]}")
                    resp = None
                time.sleep(3)
        if resp is None:
            continue
        road, rain, why = parse(getattr(resp, "text", ""))
        local = datetime.fromisoformat(iso).astimezone(ICT).strftime("%H:%M")
        flag = "  <<<" if rain != "No" else ""
        print(f"  {local:<7} {road:<5} {rain:<7} {why[:66]}{flag}")
        out.append((local, road, rain))
        gap = 5
        if prev is not None:
            gap = round((datetime.fromisoformat(iso) - prev["iso"]).total_seconds() / 60)
        prev = {"road": road, "rain": rain, "justification": why,
                "mins": gap, "iso": datetime.fromisoformat(iso)}
    return out


def frames_between(cam_id, lo, hi):
    d = RAW / cam_id / "2026" / "09" / "13"
    return sorted(p for p in d.glob("*.jpg") if lo <= p.stem[9:15] <= hi)


def main():
    from google import genai
    from google.genai import types as t
    client = genai.Client(api_key=config.GOOGLE_API_KEY)

    # 1. the known transition: dry through 18:35 local, soaked from 18:40.
    # 2. a dry night on a camera that false-positived under two-frame, with every
    #    nearby gauge flat all night -- this is the regression test.
    cases = [
        ("63b548ecbfd3d90017ea77d2", "110500", "120500",
         "Nguyễn Duy Trinh - Võ Chí Công  (18:05-19:05 local)",
         "DRY until 18:35, RAIN ~18:35-18:45, wet/uncertain after"),
        ("6623ef2b6f998a001b252753", "202000", "205500",
         "Phan Văn Hớn - Trần Văn Mười  (03:20-03:55 local)",
         "NO RAIN -- all gauges within 10km flat all night; two-frame called Heavy here"),
    ]
    for cam, lo, hi, label, truth in cases:
        fr = frames_between(cam, lo, hi)
        if not fr:
            print(f"no frames for {label}")
            continue
        run_sequence(client, t, cam, fr, label, truth)


if __name__ == "__main__":
    main()
