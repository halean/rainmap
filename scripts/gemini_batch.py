"""
Build and submit a Gemini Batch API job for gemini-3.8-flash, using the exact same
prompt (via build_prompt) and, by default, the exact same 60 camera IDs as the
GPT-6 Astra run -- same inputs, different model, so cost and quality are
genuinely comparable rather than confounded by a different random sample.

Gemini 3.8 Flash also has a free tier (like Gemma), so the real cost of this run
may be $0 regardless of the paid-rate projection below -- both are reported.

Usage:
    python scripts/gemini_batch.py build <snapshot_dir> [--like <astra_jsonl>] [--sample N] [--all]
    python scripts/gemini_batch.py status <job_name>
    python scripts/gemini_batch.py fetch <job_name> <out_csv>
"""
import base64
import csv
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import config
from app.log_setup import get_logger
from scripts.rain_annotator import build_prompt

from google import genai
from google.genai import types

log = get_logger("gemini_batch")

MODEL = "gemini-3.8-flash"
# Paid-tier reference rates (through end of 2026); this model also has a free tier,
# so real cost may be $0 -- both are reported by `fetch`.
PRICE_IN_PER_M = 0.75
PRICE_OUT_PER_M = 3.75

# This model defaults to "thinking" mode, which is billed as output tokens and is
# NOT small: a live test on one frame showed 1,376 thinking tokens against just 36
# visible output tokens -- roughly 4x the real cost of the whole call. Disabling it
# (matching the cheapest-viable-setting choice made for GPT-6 Astra's "low" effort)
# cuts cost about 4.5x. But it is not a free lunch: disabling thinking changed the
# verdict on the very first test frame (No -> Medium) for reasons that look like
# genuinely less careful weighing of the visual evidence, not noise. Worth a
# separate thinking-enabled run later if quality (not just cost) is the question.
THINKING_BUDGET = 0


def get_client():
    if not config.GOOGLE_API_KEY:
        raise RuntimeError("GOOGLE_API_KEY not set in .env")
    return genai.Client(api_key=config.GOOGLE_API_KEY)


def load_manifest(snapshot_dir: Path) -> dict[str, dict]:
    rows = list(csv.DictReader((snapshot_dir / "manifest.csv").open()))
    return {r["camera_id"]: r for r in rows if r["online"] == "True" and r["image_file"]}


def cmd_build(snapshot_dir: str, like: str | None, sample: int | None, use_all: bool):
    snapshot_dir = Path(snapshot_dir)
    by_id = load_manifest(snapshot_dir)
    log.info("%d online cameras in snapshot", len(by_id))

    if like:
        # Pin to the exact same cameras used in another provider's batch, so this
        # is a same-input comparison rather than a fresh (and differently biased) draw.
        cam_ids = [json.loads(l)["custom_id"] for l in open(like)]
        cam_ids = [c for c in cam_ids if c in by_id]
        log.info("reusing %d camera ids from %s for a same-input comparison", len(cam_ids), like)
    elif use_all:
        cam_ids = list(by_id.keys())
    else:
        n = sample or 30
        random.seed(42)
        cam_ids = random.sample(list(by_id.keys()), min(n, len(by_id)))

    ordered_ids = []
    inline_requests = []
    for cid in cam_ids:
        row = by_id[cid]
        img_bytes = (snapshot_dir / row["image_file"]).read_bytes()
        prompt = build_prompt(row["captured_at"])
        inline_requests.append({
            "contents": [{
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(img_bytes).decode("ascii")}},
                ],
            }],
            "config": {"thinking_config": {"thinking_budget": THINKING_BUDGET}},
        })
        ordered_ids.append(cid)

    # Inline batches don't carry a custom_id, so we keep our own index -> camera_id
    # mapping and rely on response order matching request order.
    (snapshot_dir / "gemini_batch_order.json").write_text(json.dumps(ordered_ids))

    client = get_client()
    job = client.batches.create(
        model=MODEL, src=inline_requests,
        config={"display_name": f"rainmap-{snapshot_dir.name}"},
    )
    log.info("submitted batch %s (%d requests, state=%s)", job.name, len(ordered_ids), job.state.name)
    (snapshot_dir / "gemini_batch_name.txt").write_text(job.name)
    print(job.name)


def cmd_status(job_name: str):
    client = get_client()
    job = client.batches.get(name=job_name)
    print(f"state: {job.state.name}")


def cmd_fetch(job_name: str, order_file: str, out_csv: str):
    client = get_client()
    job = client.batches.get(name=job_name)
    if job.state.name != "JOB_STATE_SUCCEEDED":
        print(f"not ready yet: {job.state.name}")
        return

    ordered_ids = json.loads(Path(order_file).read_text())
    responses = job.dest.inlined_responses

    fields = ["camera_id", "rain", "justification", "raw_text", "input_tokens",
              "output_tokens", "thinking_tokens", "error"]
    total_in = total_out = total_think = 0
    with open(out_csv, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for cid, r in zip(ordered_ids, responses):
            row = {"camera_id": cid, "rain": "", "justification": "", "raw_text": "",
                   "input_tokens": 0, "output_tokens": 0, "thinking_tokens": 0, "error": ""}
            if getattr(r, "error", None):
                row["error"] = str(r.error)
            else:
                resp = r.response
                text = getattr(resp, "text", "") or ""
                row["raw_text"] = text
                usage = getattr(resp, "usage_metadata", None)
                if usage:
                    row["input_tokens"] = usage.prompt_token_count or 0
                    row["output_tokens"] = usage.candidates_token_count or 0
                    row["thinking_tokens"] = usage.thoughts_token_count or 0
                    total_in += row["input_tokens"]; total_out += row["output_tokens"]; total_think += row["thinking_tokens"]
                try:
                    cleaned = text.strip().strip("`")
                    if cleaned.startswith("json"):
                        cleaned = cleaned[4:].strip()
                    parsed = json.loads(cleaned)
                    row["rain"] = parsed.get("rain", "")
                    row["justification"] = parsed.get("justification", "")
                except Exception as e:
                    row["error"] = f"parse failed: {e}"
            writer.writerow(row)

    n = len(ordered_ids)
    print(f"wrote {n} results to {out_csv}")
    print(f"totals: input={total_in} output={total_out} thinking={total_think} "
          f"(thinking_budget={THINKING_BUDGET}, so this should be ~0 -- nonzero means it leaked through)")
    billed_out = total_out + total_think
    cost = total_in * PRICE_IN_PER_M / 1e6 + billed_out * PRICE_OUT_PER_M / 1e6
    print(f"paid-rate cost if billed: ${cost:.4f}  (${cost/max(n,1):.5f}/call)")
    print(f"batch-rate (-50%) would be: ${cost/2:.4f}")
    print("actual cost may be $0 -- gemini-3.8-flash also has a free tier, same as Gemma")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "build":
        args = sys.argv[2:]
        use_all = "--all" in args
        sample = None
        like = None
        if "--sample" in args:
            sample = int(args[args.index("--sample") + 1])
        if "--like" in args:
            like = args[args.index("--like") + 1]
        cmd_build(args[0], like, sample, use_all)
    elif cmd == "status":
        cmd_status(sys.argv[2])
    elif cmd == "fetch":
        cmd_fetch(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        print(__doc__); sys.exit(1)
