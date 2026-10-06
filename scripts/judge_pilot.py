"""
Judge pilot: which stronger model should label the 7-day rain test set, and what will it cost?

Run: .venv/bin/python scripts/judge_pilot.py submit  [--judges a,b,...] [--n 200]
     .venv/bin/python scripts/judge_pilot.py collect [--wait]
     .venv/bin/python scripts/judge_pilot.py report
     Claude judges need ANTHROPIC_API_KEY in .env or an `ant auth login` profile; Gemini uses
     GOOGLE_API_KEY. A judge without credentials is skipped, not fatal.

The full set (data/test_sets/20261003_rain7d/manifest.csv, ~11.7k frames from the seven rainiest days)
is too dear to label with a model that has not been checked. So: 200 frames from it, four strata,
every candidate judge asked the same question about the same frames, and scored where the gauges are
strongest --
  strong_rain   a gauge within 4 km measured >= 5 mm in the hour holding the frame      (60)
  light_rain    1-5 mm in that hour                                                       (40)
  just_after    gauges back to 0, under 60 min after a >= 1 mm hour -- wet roads, drips   (50)
  settled_dry   gauges at 0, 60-120 min after the rain -- the clearest dry the set holds (50)
Neither label is truth for one frame (a wet hour can hold dry minutes; drizzle can miss a gauge),
so a good judge is one that says "raining" on most strong_rain frames and few settled_dry ones,
and agrees with the other good judges.

Each judge sees the frame before (when one exists within 20 min) and the frame itself, with the local
time, and answers raining / wet_not_raining / dry / cannot_tell. Only "raining" counts as rain. The
prompt names the known traps (water on the lens, lingering wet roads, night glare) without leaning
either way, because the judge is meant to settle exactly those cases.

Everything goes through the providers' batch APIs (half price; results usually within the hour, at
most 24 h). `submit` sends the batches and records them in data/derived/judge_pilot_batches.json;
`collect` fetches finished ones into data/derived/judge_pilot.jsonl, one answer per (judge, frame).
So a restart loses nothing, a rerun or an added judge only pays for what is new, and the tokens the
report projects for the full set were billed exactly as that run would be.

Claude judges run without a refusal fallback on purpose: a fallback answers with a different model,
which would credit one judge with another's labels. A refusal is recorded as an error instead.
"""

import argparse
import base64
import csv
import json
import os
import random
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config

REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "data" / "test_sets" / "20261003_rain7d" / "manifest.csv"
CACHE = REPO / "data" / "derived" / "judge_pilot.jsonl"
JOBS = REPO / "data" / "derived" / "judge_pilot_batches.json"  # batches submitted, not yet collected
FULL_SET = 11707

STRATA = {"strong_rain": 60, "light_rain": 40, "just_after": 50, "settled_dry": 50}
VERDICTS = ["raining", "wet_not_raining", "dry", "cannot_tell"]

# $ per million tokens at BATCH prices (input, output), checked 3 Oct 2026 against
# platform.claude.com/docs/en/about-claude/pricing and ai.google.dev/gemini-api/docs/pricing.
BATCH_PRICE = {
    "claude-fable-5-1": (5.0, 25.0),
    "claude-opus-5-5": (2.0, 10.0),
    "claude-sonnet-5-5": (1.0, 5.0),
    "claude-haiku-4-5": (0.5, 2.5),
    "gemini-3.1-pro-preview": (1.0, 6.0),
    "gemini-3.8-flash": (0.375, 1.875),
    "gemini-2.5-pro": (0.625, 5.0),
}
DEFAULT_JUDGES = "gemini-3.1-pro-preview,gemini-3.8-flash,claude-opus-5-5,claude-sonnet-5-5"

SCHEMA = {
    "type": "object",
    "properties": {
        "rain_now": {"type": "string", "enum": VERDICTS},
        "intensity": {"type": "string", "enum": ["none", "light", "moderate", "heavy"]},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "evidence": {"type": "string"},
    },
    "required": ["rain_now", "intensity", "confidence", "evidence"],
    "additionalProperties": False,
}

PROMPT = """These are frames from a public traffic camera at {location}, Ho Chi Minh City, Vietnam.
The last image is the frame to judge, taken at {local} local time ({phase}).{prev_note}

Is rain falling at this street at the moment of the last frame?

- raining: rain is falling now, at any intensity.
- wet_not_raining: the street is wet but rain is not falling now (it has stopped).
- dry: the street is dry and nothing is falling.
- cannot_tell: the image does not allow a judgment (too dark, lens blocked, frozen or broken frame).

Things that make this hard, in both directions: water drops on the camera's lens or housing can stay
long after rain stops, and can also be the only visible sign of light rain at night; roads stay wet
and reflective for an hour or more after rain; headlights and street lamps make dry roads glare at
night; light rain is often visible only as streaks against lights, splashes in puddles, spray from
tyres, or people under umbrellas and in raincoats. Weigh what the image actually shows.

Answer with rain_now, intensity (none if not raining), your confidence, and one sentence of evidence
naming what you saw."""


def phase(hour: int) -> str:
    return "night" if hour < 5 or hour >= 19 else "dawn" if hour < 6 else "dusk" if hour >= 18 else "daylight"


def pick(seed: int, n: int) -> list[dict]:
    rows = list(csv.DictReader(MANIFEST.open(encoding="utf-8")))
    pools = defaultdict(list)
    for r in rows:
        mm = float(r["gauge_mm_4km"])
        if r["class"] == "rain_hour":
            pools["strong_rain" if mm >= 5 else "light_rain"].append(r)
        else:
            pools["just_after" if int(r["min_after_rain"]) < 60 else "settled_dry"].append(r)
    rng, out = random.Random(seed), []
    scale = n / sum(STRATA.values())
    for s, k in STRATA.items():
        out += [{**r, "stratum": s} for r in rng.sample(pools[s], round(k * scale))]
    return out


def prompt_for(r: dict) -> str:
    local = datetime.strptime(r["captured_ict"], "%Y-%m-%d %H:%M")
    prev_note = ""
    if r["prev_image"]:
        gap = (datetime.strptime(Path(r["image"]).stem[:15], "%Y%m%d_%H%M%S")
               - datetime.strptime(Path(r["prev_image"]).stem[:15], "%Y%m%d_%H%M%S"))
        prev_note = f"\nThe first image is the same camera {round(gap.total_seconds() / 60)} min earlier, for comparison."
    return PROMPT.format(location=r["location"] or "an intersection", local=local.strftime("%H:%M on %d %b"),
                         phase=phase(local.hour), prev_note=prev_note)


def images(r: dict) -> list[bytes]:
    paths = ([r["prev_image"]] if r["prev_image"] else []) + [r["image"]]
    return [(REPO / p).read_bytes() for p in paths]


def judge_ready(model) -> bool:
    """Gemini uses GOOGLE_API_KEY from .env; Claude an ANTHROPIC_API_KEY or an `ant auth login` profile."""
    if not model.startswith("claude"):
        return bool(config.GOOGLE_API_KEY)
    creds = Path.home() / ".config" / "anthropic" / "credentials"
    return bool(os.getenv("ANTHROPIC_API_KEY")) or any(creds.glob("*.json"))


class Gemini:
    """Batch jobs with inline requests. Inline input is capped at 20 MB per job, so frames go in chunks."""
    CHUNK_BYTES = 14 * 1024 * 1024

    def __init__(self, model):
        from google import genai
        from google.genai import types as t
        self.model, self.t = model, t
        self.client = genai.Client(api_key=config.GOOGLE_API_KEY)

    def submit(self, rows):
        t, jobs, chunk, size = self.t, [], [], 0
        for r in rows + [None]:
            b = images(r) if r else []
            if chunk and (r is None or size + sum(map(len, b)) * 4 // 3 > self.CHUNK_BYTES):
                reqs = [t.InlinedRequest(
                    contents=[t.Content(role="user", parts=[t.Part.from_bytes(data=x, mime_type="image/jpeg")
                                                            for x in images(c)] + [t.Part(text=prompt_for(c))])],
                    config=t.GenerateContentConfig(response_mime_type="application/json",
                                                   response_json_schema=SCHEMA)) for c in chunk]
                job = self.client.batches.create(model=self.model, src=reqs,
                                                 config={"display_name": f"judge-pilot-{len(jobs)}"})
                jobs.append({"id": job.name, "images": [c["image"] for c in chunk]})
                chunk, size = [], 0
            if r:
                chunk.append(r)
                size += sum(map(len, b)) * 4 // 3
        return jobs

    def collect(self, job):
        """None while running; else [(image, answer, in, out) or (image, error)] in request order."""
        j = self.client.batches.get(name=job["id"])
        # The API now answers BATCH_STATE_*, which this SDK's JobState enum does not know (it keeps the raw
        # string and warns), so match on the suffix and wait for a state that is known to be final.
        state = str(getattr(j.state, "value", j.state) or "")
        if not state.endswith(("SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED")):
            return None
        resps = (j.dest.inlined_responses if j.dest else None) or []
        out = []
        for img, ir in zip(job["images"], resps + [None] * (len(job["images"]) - len(resps))):
            if ir is None or ir.error or not ir.response:
                out.append((img, f"{state}: {getattr(ir, 'error', None)}"))
                continue
            u = ir.response.usage_metadata
            try:
                out.append((img, json.loads(ir.response.text), u.prompt_token_count or 0,
                            (u.candidates_token_count or 0) + (u.thoughts_token_count or 0)))
            except Exception as e:
                out.append((img, f"unparsable: {e}"))
        return out


class Claude:
    """Message Batches API. custom_id must be [a-zA-Z0-9_-]{1,64}, so frames go by index."""

    def __init__(self, model):
        import anthropic
        self.model = model
        self.client = anthropic.Anthropic(max_retries=4)

    def request(self, r):
        content = []
        imgs = images(r)
        for i, b in enumerate(imgs):
            if len(imgs) == 2:
                content.append({"type": "text", "text": "Earlier frame:" if i == 0 else "Frame to judge:"})
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                         "data": base64.standard_b64encode(b).decode()}})
        content.append({"type": "text", "text": prompt_for(r)})
        return {"model": self.model, "max_tokens": 8000, "messages": [{"role": "user", "content": content}],
                "output_config": {"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}}}

    def submit(self, rows):
        from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
        from anthropic.types.messages.batch_create_params import Request
        reqs = [Request(custom_id=f"f{i}", params=MessageCreateParamsNonStreaming(**self.request(r)))
                for i, r in enumerate(rows)]
        b = self.client.messages.batches.create(requests=reqs)
        return [{"id": b.id, "images": [r["image"] for r in rows]}]

    def collect(self, job):
        b = self.client.messages.batches.retrieve(job["id"])
        if b.processing_status != "ended":
            return None
        out = []
        for res in self.client.messages.batches.results(job["id"]):
            img = job["images"][int(res.custom_id[1:])]
            if res.result.type != "succeeded":
                out.append((img, f"{res.result.type}: {getattr(res.result, 'error', '')}"))
                continue
            m = res.result.message
            if m.stop_reason == "refusal":
                out.append((img, f"refusal: {getattr(m.stop_details, 'category', None)}"))
                continue
            try:
                text = next(x.text for x in m.content if x.type == "text")
                out.append((img, json.loads(text), m.usage.input_tokens, m.usage.output_tokens))
            except Exception as e:
                out.append((img, f"unparsable: {e}"))
        return out


def judge_for(model):
    return Claude(model) if model.startswith("claude") else Gemini(model)


def verdict(answer) -> str | None:
    """rain_now from an answer, tolerating the shapes Gemini's batch API returns: its batch mode does not
    enforce response_json_schema, so some answers come wrapped in a list, or as a boolean, or under
    "raining". A boolean False says only "not raining", so it maps to wet_not_raining's side of the
    raining / not-raining split the report scores, never to dry."""
    if isinstance(answer, list) and answer:
        answer = answer[0]
    if not isinstance(answer, dict):
        return None
    v = answer.get("rain_now", answer.get("raining"))
    if isinstance(v, bool):
        return "raining" if v else "not_raining"
    return v if v in VERDICTS else None


def load_cache():
    got = {}
    if CACHE.exists():
        for line in CACHE.open(encoding="utf-8"):
            d = json.loads(line)
            got[(d["judge"], d["image"])] = d
    return got


def load_jobs():
    return json.loads(JOBS.read_text()) if JOBS.exists() else []


def save_jobs(jobs):
    JOBS.parent.mkdir(parents=True, exist_ok=True)
    JOBS.write_text(json.dumps(jobs, indent=1))


def submit(sample, names, cache):
    jobs = load_jobs()
    pending = {(j["judge"], img) for j in jobs for img in j["images"]}
    for name in names:
        if not judge_ready(name):
            print(f"{name}: no credentials, skipped (Claude: ANTHROPIC_API_KEY in .env, or `ant auth login`)")
            continue
        todo = [r for r in sample if "answer" not in cache.get((name, r["image"]), {})
                and (name, r["image"]) not in pending]
        if not todo:
            print(f"{name}: nothing to submit")
            continue
        new = judge_for(name).submit(todo)
        for j in new:
            j.update(judge=name, submitted=datetime.now().isoformat(timespec="seconds"))
        jobs += new
        save_jobs(jobs)
        print(f"{name}: submitted {len(todo)} frames in {len(new)} batch(es): {', '.join(j['id'] for j in new)}")


def collect(cache) -> int:
    """Write every finished batch's answers to the cache; return how many batches are still running."""
    jobs, left = load_jobs(), []
    with CACHE.open("a", encoding="utf-8") as f:
        for job in jobs:
            got = judge_for(job["judge"]).collect(job)
            if got is None:
                left.append(job)
                continue
            for g in got:
                d = ({"judge": job["judge"], "image": g[0], "answer": g[1], "in": g[2], "out": g[3]}
                     if len(g) == 4 else {"judge": job["judge"], "image": g[0], "error": g[1]})
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
                cache[(job["judge"], g[0])] = d
            ok = sum(len(g) == 4 for g in got)
            print(f"{job['judge']}: batch {job['id']} done, {ok}/{len(got)} answered")
    save_jobs(left)
    return len(left)


def report(sample, judges, cache):
    def said(j, r):
        d = cache.get((j, r["image"]))
        return verdict(d["answer"]) if d and "answer" in d else None

    print(f"\n{len(sample)} frames: " + ", ".join(f"{s} {sum(r['stratum'] == s for r in sample)}" for s in STRATA)
          + f"; {sum(r['night'] == '1' for r in sample)} at night\n")
    head = f"{'judge':24s}" + "".join(f"{s:>14s}" for s in STRATA) + f"{'cannot_tell':>13s}{'errors':>8s}"
    print("share answering 'raining'")
    print(head)
    rows = [("production (Gemma)", lambda r: None if not r["production"] else
             ("raining" if r["production"] != "No" else "dry"))]
    rows += [(j, (lambda j: lambda r: said(j, r))(j)) for j in judges]
    for name, f in rows:
        line = f"{name:24s}"
        for s in STRATA:
            xs = [f(r) for r in sample if r["stratum"] == s]
            xs = [x for x in xs if x and x != "cannot_tell"]
            line += f"{(sum(x == 'raining' for x in xs) / len(xs)) if xs else float('nan'):>9.0%} ({len(xs):>2d})"
        ct = sum(f(r) == "cannot_tell" for r in sample)
        err = sum(1 for r in sample if name in judges and f(r) is None)
        print(line + f"{ct:>13d}{err:>8d}")

    print("\nfull-set cost at batch prices, from this pilot's measured tokens")
    for j in judges:
        ds = [cache[(j, r["image"])] for r in sample if "answer" in cache.get((j, r["image"]), {})]
        if not ds:
            continue
        tin, tout = sum(d["in"] for d in ds) / len(ds), sum(d["out"] for d in ds) / len(ds)
        pi, po = BATCH_PRICE.get(j, (float("nan"), float("nan")))
        print(f"  {j:24s} {tin:6.0f} in / {tout:5.0f} out per frame  ->  ${FULL_SET * (tin * pi + tout * po) / 1e6:6.0f}")

    print("\nagreement on raining-or-not (frames both answered, cannot_tell dropped)")
    for i, a in enumerate(judges):
        for b in judges[i + 1:]:
            pairs = [(said(a, r), said(b, r)) for r in sample]
            pairs = [(x, y) for x, y in pairs if x and y and "cannot_tell" not in (x, y)]
            if pairs:
                print(f"  {a:24s} {b:24s} {sum((x == 'raining') == (y == 'raining') for x, y in pairs) / len(pairs):5.0%} of {len(pairs)}")

    for j in judges:
        c = Counter(said(j, r) for r in sample if r["stratum"] == "settled_dry" and said(j, r) == "raining")
        if c:
            print(f"\n{j}: 'raining' on settled_dry frames")
            for r in sample:
                if r["stratum"] == "settled_dry" and said(j, r) == "raining":
                    print(f"   {r['captured_ict']} {r['location'][:34]:34s} {str(cache[(j, r['image'])]['answer'])[:110]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["submit", "collect", "report"],
                    help="submit: send batches; collect: fetch finished ones (--wait to block); report: score")
    ap.add_argument("--judges", default=DEFAULT_JUDGES)
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--wait", action="store_true", help="collect: poll every 2 min until no batch is running")
    args = ap.parse_args()

    sample = pick(args.seed, args.n)
    names = [j.strip() for j in args.judges.split(",") if j.strip()]
    cache = load_cache()
    if args.step == "submit":
        submit(sample, names, cache)
    elif args.step == "collect":
        while (left := collect(cache)) and args.wait:
            print(f"{left} batch(es) still running", flush=True)
            time.sleep(120)
        print(f"{left} batch(es) still running" if left else "all batches collected")
    else:
        report(sample, [n for n in names if any(k[0] == n for k in cache)], cache)


if __name__ == "__main__":
    main()
