"""
Build and submit an OpenAI Batch API job for GPT-6 Astra, reusing the exact same
prompt as rain_annotator.py (via build_prompt) so results are comparable to the
Gemma pipeline rather than measuring a different task.

Cost caveat learned while building this: GPT-6 Astra cannot disable reasoning --
minimum effort is "low" -- and reasoning tokens are billed as output tokens even
though invisible in the response. The earlier token-math estimate only counted
the ~40 visible output tokens, so real cost per call is very likely higher than
that estimate. This script exists partly to find out by how much, which is why
the default run is a small stratified sample rather than the full snapshot.

Usage:
    python scripts/astra_batch.py build <snapshot_dir> [--sample N] [--all]
    python scripts/astra_batch.py status <batch_id>
    python scripts/astra_batch.py fetch <batch_id> <out_csv>
"""
import base64
import csv
import json
import os
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.log_setup import get_logger
from scripts.rain_annotator import build_prompt

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

log = get_logger("astra_batch")

MODEL = "gpt-6-astra"
REASONING_EFFORT = "low"  # cheapest available; "none"/"minimal" are rejected by this model


def get_client():
    # Saved as OPEN_AI_KEY in .env rather than the SDK's usual OPENAI_API_KEY --
    # accept both so this doesn't silently fail on a naming mismatch.
    key = os.getenv("OPENAI_API_KEY") or os.getenv("OPEN_AI_KEY")
    if not key:
        raise RuntimeError("Set OPENAI_API_KEY or OPEN_AI_KEY in .env")
    if OpenAI is None:
        raise RuntimeError("pip install openai")
    return OpenAI(api_key=key)


def load_manifest(snapshot_dir: Path) -> list[dict]:
    rows = list(csv.DictReader((snapshot_dir / "manifest.csv").open()))
    return [r for r in rows if r["online"] == "True" and r["image_file"]]


def build_request(row: dict, snapshot_dir: Path) -> dict:
    img_path = snapshot_dir / row["image_file"]
    b64 = base64.b64encode(img_path.read_bytes()).decode("ascii")
    prompt = build_prompt(row["captured_at"])
    return {
        "custom_id": row["camera_id"],
        "method": "POST",
        "url": "/v1/responses",
        "body": {
            "model": MODEL,
            "reasoning": {"effort": REASONING_EFFORT},
            "input": [{
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": f"data:image/jpeg;base64,{b64}", "detail": "high"},
                ],
            }],
        },
    }


def haversine_km(lat1, lon1, lat2, lon2):
    import math
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def cmd_build(snapshot_dir: str, sample: int | None, use_all: bool, near: list[tuple[float, float]] | None = None):
    snapshot_dir = Path(snapshot_dir)
    rows = load_manifest(snapshot_dir)
    log.info("%d online cameras in snapshot", len(rows))

    if not use_all:
        n = sample or 30
        random.seed(42)
        if near:
            # Rain is rare and localized (HCMC storms are short and small-area), so a
            # plain random sample would very likely miss it entirely. Bias toward
            # cameras near known-currently-raining points -- half the sample from
            # nearby, half a random spread for a genuine dry baseline.
            radius_km = 6.0
            close = [r for r in rows if any(
                haversine_km(float(r["lat"]), float(r["lon"]), lat, lon) <= radius_km for lat, lon in near
            )]
            n_close = min(n // 2, len(close))
            chosen = random.sample(close, n_close)
            remaining = [r for r in rows if r not in chosen]
            chosen += random.sample(remaining, min(n - n_close, len(remaining)))
            log.info("biased sample: %d within %.0fkm of known rain, %d random baseline",
                     n_close, radius_km, len(chosen) - n_close)
        else:
            chosen = random.sample(rows, min(n, len(rows)))
        log.info("sampling %d of %d for an initial cost/quality check "
                 "(pass --all once real reasoning-token cost is known)", len(chosen), len(rows))
        rows = chosen

    batch_file = snapshot_dir / "astra_batch_input.jsonl"
    with batch_file.open("w") as f:
        for row in rows:
            f.write(json.dumps(build_request(row, snapshot_dir)) + "\n")
    log.info("wrote %d requests to %s", len(rows), batch_file)

    client = get_client()
    uploaded = client.files.create(file=batch_file.open("rb"), purpose="batch")
    batch = client.batches.create(
        input_file_id=uploaded.id,
        endpoint="/v1/responses",
        completion_window="24h",
        metadata={"snapshot": snapshot_dir.name, "count": str(len(rows))},
    )
    log.info("submitted batch %s (%d requests, status=%s)", batch.id, len(rows), batch.status)

    (snapshot_dir / "astra_batch_id.txt").write_text(batch.id)
    print(batch.id)


def cmd_status(batch_id: str):
    client = get_client()
    b = client.batches.retrieve(batch_id)
    print(f"status: {b.status}")
    print(f"requests: completed={b.request_counts.completed} failed={b.request_counts.failed} "
          f"total={b.request_counts.total}")
    if b.status == "completed":
        print(f"output_file_id: {b.output_file_id}")


def cmd_fetch(batch_id: str, out_csv: str):
    client = get_client()
    b = client.batches.retrieve(batch_id)
    if b.status != "completed":
        print(f"not ready yet: {b.status}")
        return
    content = client.files.content(b.output_file_id).text

    fields = ["camera_id", "rain", "justification", "raw_text", "input_tokens",
              "output_tokens", "reasoning_tokens", "error"]
    total_in = total_out = total_reason = 0
    with open(out_csv, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for line in content.splitlines():
            rec = json.loads(line)
            cid = rec["custom_id"]
            row = {"camera_id": cid, "rain": "", "justification": "", "raw_text": "",
                   "input_tokens": 0, "output_tokens": 0, "reasoning_tokens": 0, "error": ""}
            if rec.get("error"):
                row["error"] = str(rec["error"])
            else:
                body = rec["response"]["body"]
                usage = body.get("usage", {})
                row["input_tokens"] = usage.get("input_tokens", 0)
                row["output_tokens"] = usage.get("output_tokens", 0)
                row["reasoning_tokens"] = usage.get("output_tokens_details", {}).get("reasoning_tokens", 0)
                total_in += row["input_tokens"]; total_out += row["output_tokens"]; total_reason += row["reasoning_tokens"]
                text = "".join(
                    c.get("text", "") for item in body.get("output", [])
                    if item.get("type") == "message" for c in item.get("content", [])
                )
                row["raw_text"] = text
                try:
                    parsed = json.loads(text.strip().strip("`").removeprefix("json").strip())
                    row["rain"] = parsed.get("rain", "")
                    row["justification"] = parsed.get("justification", "")
                except Exception as e:
                    row["error"] = f"parse failed: {e}"
            writer.writerow(row)

    n = len(content.splitlines())
    print(f"wrote {n} results to {out_csv}")
    print(f"totals: input={total_in} output={total_out} (of which reasoning={total_reason})")
    GPT6_IN, GPT6_OUT = 10.00, 50.00
    cost = total_in * GPT6_IN / 1e6 + total_out * GPT6_OUT / 1e6
    print(f"actual standard-rate cost for this batch: ${cost:.4f}  (${cost/max(n,1):.5f}/call)")
    print(f"batch-rate (-50%) would be: ${cost/2:.4f}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "build":
        args = sys.argv[2:]
        use_all = "--all" in args
        sample = None
        if "--sample" in args:
            sample = int(args[args.index("--sample") + 1])
        near = None
        if "--near" in args:
            # --near lat1,lon1 lat2,lon2 ...
            i = args.index("--near") + 1
            pairs = []
            while i < len(args) and "," in args[i]:
                lat, lon = args[i].split(",")
                pairs.append((float(lat), float(lon)))
                i += 1
            near = pairs
        cmd_build(args[0], sample, use_all, near)
    elif cmd == "status":
        cmd_status(sys.argv[2])
    elif cmd == "fetch":
        cmd_fetch(sys.argv[2], sys.argv[3])
    else:
        print(__doc__); sys.exit(1)
