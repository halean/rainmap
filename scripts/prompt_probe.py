"""
Scores prompt variants against hand-labelled frames, to stop prompt tuning from
being one-case-at-a-time guesswork (see NOTES.md: every previous iteration fixed
one failure and broke another, and this harness exists because that happened
again).

Run: .venv/bin/python scripts/prompt_probe.py [single|pairs|all]

Not part of the pipeline -- nothing imports it and it changes no state. It
re-asks the production model about frames whose answer we believe we know, under
several prompts, and prints the disagreements side by side. To extend it, add
rows to FRAMES (single-frame) or PAIRS (previous+current), and variants to
single_variants() / pair_variants().

Gemma 4 note: `thinking_budget` is rejected by this model ("Thinking budget is not
supported for this model"), though it DOES think by default -- baseline calls
report a non-zero `thoughts_token_count`. Deliberation can only be reached through
the prompt, not the API knob. `include_thoughts=True` is accepted if you want to
read the reasoning.
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.insights import InsightsService
from scripts.rain_annotator import TWO_FRAME_PRE, build_prompt, captured_at_from

REPO = Path(__file__).resolve().parents[1]
RAW = REPO / "data" / "raw"

NDT = "63b548ecbfd3d90017ea77d2"  # Nguyễn Duy Trinh - Võ Chí Công 1
LPH = "6792f16e8c5ed4001b27f482"  # Cao tốc LT-DG - Trạm thu phí Long Phước


def frame(camera_id: str, name: str) -> Path:
    """name is a bare frame stem, YYYYMMDD_HHMMSS -- the date drives the path."""
    return RAW / camera_id / name[0:4] / name[4:6] / name[6:8] / f"{name}.jpg"


# Labels are read off the frames themselves: at NDT the road is visibly dry
# through 18:35 local and fully soaked at 18:40, so it rained hard in between.
# "rain" means water was falling at that moment. Frames where a stopped downpour
# and a running one are genuinely indistinguishable are marked unknown and are
# excluded from scoring rather than guessed at.
FRAMES = [
    (NDT, "20260913_103532", "dry",     "17:35 daylight, road dry"),
    (NDT, "20260913_111020", "dry",     "18:10 dusk, road dry"),
    (NDT, "20260913_112021", "dry",     "18:20 dark, road dry"),
    (NDT, "20260913_113013", "dry",     "18:30 dark, road dry"),
    (NDT, "20260913_113513", "dry",     "18:35 dark, road dry (last dry frame)"),
    (NDT, "20260913_114013", "rain",    "18:40 soaked -- it just poured"),
    (NDT, "20260913_114514", "rain",    "18:45 spray off moving car"),
    (NDT, "20260913_115013", "unknown", "18:50 very wet, may have eased"),
    (NDT, "20260913_120013", "unknown", "19:00 soaked, may have stopped"),
]

PAIRS = [
    (NDT, "20260913_111020", "20260913_112021", "dry",  "18:10->18:20 dry->dry"),
    (NDT, "20260913_113013", "20260913_113513", "dry",  "18:30->18:35 dry->dry"),
    (NDT, "20260913_113513", "20260913_114013", "rain", "18:35->18:40 DRY->SOAKED"),
    (NDT, "20260913_114013", "20260913_114514", "rain", "18:40->18:45 wet->wetter"),
    (NDT, "20260913_115013", "20260913_120013", "dry",  "18:50->19:00 aftermath"),
    (NDT, "20260913_122508", "20260913_123506", "dry",  "19:25->19:35 aftermath"),
    # Long Phước: the counter-case. 12:12 has dense visible streaks, so rain is
    # demonstrably still falling minutes either side of it -- this is where an
    # "already wet in both frames = aftermath" rule wrongly reports No.
    (LPH, "20260913_120225", "20260913_120725", "rain", "12:02->12:07 dry->wet"),
    (LPH, "20260913_120725", "20260913_121229", "rain", "12:07->12:12 dense streaks"),
    (LPH, "20260913_121229", "20260913_121725", "rain", "12:12->12:17 mid-downpour"),
]

REASON_FIRST = (
    "\n\nBefore answering, work through the scene step by step: the road surface, the air, the "
    "vehicles and what they throw up, the people and what they are wearing. Weigh what each one "
    "supports, then commit. Output only the final JSON.\n\n"
)


def single_variants(captured_at: str | None) -> dict[str, str]:
    base = build_prompt(captured_at)
    return {"A prod": base, "B reason-first": base + REASON_FIRST}


def pair_variants(captured_at: str | None) -> dict[str, str]:
    return {
        # control: two frames, but the old single-frame 'No' bullet
        "C two-frame": TWO_FRAME_PRE + build_prompt(captured_at),
        # what production now sends for a pair
        "D prod-pair": build_prompt(captured_at, two_frame=True),
    }


def parse(text: str) -> tuple[str, str]:
    cleaned = re.sub(r"^```(json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    try:
        d = json.loads(cleaned)
        return d.get("rain", "?"), d.get("justification", "")
    except Exception:
        return "PARSE_FAIL", cleaned[:110]


def report(rows: list[dict], names: list[str], title: str) -> None:
    print(f"\n{'=' * 86}\n{title}\n{'=' * 86}")
    print(f"{'case':<30} {'expect':<8} " + " ".join(f"{n:<15}" for n in names))
    print("-" * 86)
    for r in rows:
        print(f"{r['desc']:<30} {r['truth']:<8} " + " ".join(f"{r.get(n, '-'):<15}" for n in names))
    print("\nscored on labelled cases only (unknown excluded):")
    for n in names:
        ok = wrong = 0
        for r in rows:
            if r["truth"] == "unknown":
                continue
            got = r.get(n) in ("Light", "Medium", "Heavy")
            ok, wrong = (ok + 1, wrong) if got == (r["truth"] == "rain") else (ok, wrong + 1)
        print(f"  {n:<15} {ok} correct, {wrong} wrong")
    print("\nmisses:")
    for r in rows:
        for n in names:
            if r["truth"] == "unknown":
                continue
            got = r.get(n) in ("Light", "Medium", "Heavy")
            if got != (r["truth"] == "rain"):
                print(f"  [{n}] {r['desc']} -> {r.get(n)}: {r.get(n + '_why', '')[:95]}")


def run_single(svc: InsightsService) -> None:
    names = list(single_variants(None))
    rows = []
    for cam, name, truth, desc in FRAMES:
        p = frame(cam, name)
        if not p.exists():
            print(f"missing {p}")
            continue
        row = {"truth": truth, "desc": desc}
        for vname, prompt in single_variants(captured_at_from(p)).items():
            try:
                v, why = parse(svc.google_generate_with_prompt([p], prompt))
            except Exception as e:
                v, why = "ERROR", str(e)[:90]
            row[vname], row[vname + "_why"] = v, why
            print(f"  {desc[:28]:<28} {vname:<15} -> {v}")
        rows.append(row)
    report(rows, names, "SINGLE FRAME")


def run_pairs(svc: InsightsService) -> None:
    names = list(pair_variants(None))
    rows = []
    for cam, a, b, truth, desc in PAIRS:
        pa, pb = frame(cam, a), frame(cam, b)
        if not (pa.exists() and pb.exists()):
            print(f"missing {pa} or {pb}")
            continue
        row = {"truth": truth, "desc": desc}
        for vname, prompt in pair_variants(captured_at_from(pb)).items():
            try:
                v, why = parse(svc.google_generate_with_prompt([pa, pb], prompt))
            except Exception as e:
                v, why = "ERROR", str(e)[:90]
            row[vname], row[vname + "_why"] = v, why
            print(f"  {desc[:28]:<28} {vname:<15} -> {v}")
        rows.append(row)
    report(rows, names, "TWO FRAME (previous + current)")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    svc = InsightsService()
    if mode in ("single", "all"):
        run_single(svc)
    if mode in ("pairs", "all"):
        run_pairs(svc)


if __name__ == "__main__":
    main()
