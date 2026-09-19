"""
Runs one model over a test-set manifest and records what it said.

Run: .venv/bin/python scripts/annotate_test_set.py <manifest_dir> --model gemini-3.8-flash
                                                   [--tier flash|pro] [--mode single|pair]
                                                   [--workers 6] [--limit N]

Writes <manifest_dir>/<model>_<mode>.csv. Resumable: rows already present are
skipped, so a run that dies at 500 of 589 picks up where it left off rather than
paying for the first 500 again.

Uses the production prompt from rain_annotator, so a disagreement is a
disagreement about the image and not about the wording.
"""

import argparse
import csv
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config
from scripts.rain_annotator import build_prompt, captured_at_from

REPO = Path(__file__).resolve().parents[1]
FIELDS = ["frame_id", "rain", "justification", "in_tokens", "out_tokens",
          "thinking_tokens", "seconds", "error"]


def parse(text: str):
    cleaned = re.sub(r"^```(json)?|```$", "", (text or "").strip(), flags=re.MULTILINE).strip()
    try:
        d = json.loads(cleaned)
        return d.get("rain", "?"), d.get("justification", "")
    except Exception:
        return "PARSE_FAIL", cleaned[:150]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest_dir")
    ap.add_argument("--model", required=True)
    ap.add_argument("--tier", default="flash", choices=["flash", "pro"])
    ap.add_argument("--mode", default="single", choices=["single", "pair"])
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0, help="0 = all")
    args = ap.parse_args()

    from google import genai
    from google.genai import types as t

    mdir = Path(args.manifest_dir)
    rows = list(csv.DictReader((mdir / "manifest.csv").open(encoding="utf-8")))
    # "flash+pro" rows are in both tiers; the Pro set is a strict subset.
    todo = [r for r in rows if args.tier in r["tier"]]
    if args.mode == "pair":
        todo = [r for r in todo if r["prev_image_path"]]

    out_path = mdir / f"{args.model.replace('/', '_')}_{args.mode}.csv"
    done = set()
    if out_path.exists():
        done = {r["frame_id"] for r in csv.DictReader(out_path.open(encoding="utf-8"))}
    todo = [r for r in todo if r["frame_id"] not in done]
    if args.limit:
        todo = todo[:args.limit]

    print(f"model {args.model} | tier {args.tier} | mode {args.mode}")
    print(f"  {len(done)} already done, {len(todo)} to go -> {out_path.name}")
    if not todo:
        return

    client = genai.Client(api_key=config.GOOGLE_API_KEY)

    def run(row):
        started = time.monotonic()
        try:
            cur = REPO / row["image_path"]
            images = [cur]
            if args.mode == "pair":
                images = [REPO / row["prev_image_path"], cur]
            parts = [build_prompt(captured_at_from(cur), two_frame=(args.mode == "pair"))]
            for p in images:
                parts.append(t.Part.from_bytes(data=p.read_bytes(), mime_type="image/jpeg"))
            resp = client.models.generate_content(
                model=args.model, contents=parts,
                config=t.GenerateContentConfig(
                    media_resolution=t.MediaResolution.MEDIA_RESOLUTION_HIGH,
                    temperature=config.GOOGLE_TEMPERATURE,
                ),
            )
            verdict, why = parse(getattr(resp, "text", ""))
            u = resp.usage_metadata
            think = getattr(u, "thoughts_token_count", 0) or 0
            return {"frame_id": row["frame_id"], "rain": verdict, "justification": why,
                    "in_tokens": u.prompt_token_count, "out_tokens": u.candidates_token_count,
                    "thinking_tokens": think, "seconds": round(time.monotonic() - started, 1),
                    "error": ""}
        except Exception as e:
            return {"frame_id": row["frame_id"], "rain": "ERROR", "justification": "",
                    "in_tokens": "", "out_tokens": "", "thinking_tokens": "",
                    "seconds": round(time.monotonic() - started, 1), "error": str(e)[:200]}

    # Append as results arrive rather than at the end: a long paid run must not
    # lose everything to a crash at frame 500.
    write_header = not out_path.exists()
    n = 0
    with out_path.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if write_header:
            w.writeheader()
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for res in pool.map(run, todo):
                w.writerow(res)
                f.flush()
                n += 1
                if n % 25 == 0:
                    print(f"  {n}/{len(todo)}")
    print(f"done: {n} rows appended to {out_path}")


if __name__ == "__main__":
    main()
