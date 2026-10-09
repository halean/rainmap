"""
A vision model as the rain reader, scored on the hand labels.

Run: .venv/bin/python scripts/hand_label_llm.py submit  [--model gpt-6-luna]
     .venv/bin/python scripts/hand_label_llm.py collect [--wait]
     .venv/bin/python scripts/hand_label_llm.py report  [--model gpt-6-luna]
     .venv/bin/python scripts/hand_label_llm.py flex    [--model gpt-6-luna] [--zero-shot]   flex tier
     .venv/bin/python scripts/hand_label_llm.py report  --model gpt-6-luna+fewshot
     .venv/bin/python scripts/hand_label_llm.py decide   the Decisions API's rain probability
     needs OPENAI_API_KEY in .env

Every hand-labelled frame (data/test_sets/20261003_rain7d) goes to the model through OpenAI's Batch API
(half price), with the frame before it when one exists within 20 min, the camera's name and the local
time, and the same question the judges in scripts/judge_pilot.py were asked: raining /
wet_not_raining / dry / cannot_tell. Answers are cached in data/derived/llm_reader_cache.jsonl per
(model, frame), so a rerun pays only for frames not yet answered.

The report sets the model beside the readers already scored on the same frames: Gemma's own call,
the map (Gemma + the veto as it ran then), and the hand-label classifier with each batch scored by a
model trained only on earlier batches (so batch 1 has no classifier score). Can't-tell labels and
blacklisted cameras are left out, as in scripts/hand_label_eval.py.
"""

import argparse
import base64
import json
import os
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config  # noqa: F401  (loads .env)
from scripts.hand_label_eval import SET, features, load
from scripts.judge_pilot import PROMPT, SCHEMA, phase

REPO = Path(__file__).resolve().parents[1]
CACHE = REPO / "data" / "derived" / "llm_reader_cache.jsonl"
JOBS = REPO / "data" / "derived" / "llm_reader_batches.json"
ICT = timedelta(hours=7)
VERDICTS = ["raining", "wet_not_raining", "dry", "cannot_tell"]


def frame_time(path: str) -> datetime:
    return datetime.strptime(Path(path).stem[:15], "%Y%m%d_%H%M%S").replace(tzinfo=timezone.utc)


def prev_of(img: str):
    """The camera's previous saved frame, if it is within 20 min and not the offline placeholder."""
    p = REPO / img
    files = sorted(f for f in os.listdir(p.parent) if f.endswith(".jpg"))
    i = files.index(p.name)
    if i == 0:
        return None
    q = p.parent / files[i - 1]
    gap = (frame_time(p.name) - frame_time(q.name)).total_seconds() / 60
    return (q, round(gap)) if gap <= 20 and q.stat().st_size > 5120 else None


def request(fid: str, v: dict, model: str, prefix=None) -> dict:
    t = frame_time(v["image"]) + ICT
    prev = prev_of(v["image"])
    note = f"\nThe first image is the same camera {prev[1]} min earlier, for comparison." if prev else ""
    loc = v.get("location") or v.get("where") or "an intersection"
    text = PROMPT.format(location=loc, local=t.strftime("%H:%M on %d %b"), phase=phase(t.hour), prev_note=note)
    content = list(prefix or [])
    for path in ([prev[0]] if prev else []) + [REPO / v["image"]]:
        b = base64.b64encode(Path(path).read_bytes()).decode()
        content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b}"}})
    content.append({"type": "text", "text": text})
    return {"custom_id": fid, "method": "POST", "url": "/v1/chat/completions",
            "body": {"model": model, "messages": [{"role": "user", "content": content}],
                     "response_format": {"type": "json_schema",
                                         "json_schema": {"name": "rain", "strict": True, "schema": SCHEMA}}}}


EXAMPLES = REPO / "data" / "derived" / "llm_fewshot_examples.json"
LABEL_TEXT = {"raining": "raining", "wet_not_raining": "wet_not_raining (the rain has stopped; the road is still wet)",
              "dry": "dry"}


def pick_examples(n_per_cell=4, seed=5):
    """A fixed set of hand-labelled frames shown to the model before every question: raining /
    wet_not_raining / dry x day / night, a few per cell, no camera twice. Written once to EXAMPLES and
    reused, so the prompt prefix -- and with it OpenAI's prompt cache -- stays identical. These frames
    are excluded from every score."""
    if EXAMPLES.exists():
        return json.loads(EXAMPLES.read_text())
    import random
    rng = random.Random(seed)
    rows = [r for r in load() if r["label"] in LABEL_TEXT]
    rng.shuffle(rows)
    night = lambda r: r["hour"] < 6 or r["hour"] >= 18
    newest = max(r["batch"] for r in rows)
    out, cams = [], set()
    for lab in LABEL_TEXT:
        for nt in (False, True):
            got = 0
            for r in rows:
                if r["label"] == lab and night(r) == nt and r["camera"] not in cams and got < n_per_cell:
                    out.append(r["id"]); cams.add(r["camera"]); got += 1
    EXAMPLES.write_text(json.dumps(out))
    return out


def fewshot_prefix(key, items):
    """The fixed opening of every few-shot request: instructions, then each example frame and its label."""
    ex = pick_examples()
    content = [{"type": "text", "text":
                "You will judge whether rain is falling in traffic-camera frames from Ho Chi Minh City. First, "
                f"{len(ex)} frames from these same cameras, each labelled by a person who looked closely. Learn "
                "from them what rain falling looks like here, as against a road that is only wet after rain, "
                "by day and by night."}]
    for k, fid in enumerate(ex, 1):
        v = key[fid]
        t = frame_time(v["image"]) + ICT
        b = base64.b64encode((REPO / v["image"]).read_bytes()).decode()
        content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b}"}})
        label = json.loads(Path(SET / "hand_labels" / "labels" / f"{fid}.json").read_text())["label"]
        content.append({"type": "text", "text": f"Example {k} ({items.get(fid, {}).get('where', '')}, "
                                                f"{t:%H:%M} local): {LABEL_TEXT[label]}."})
    content.append({"type": "text", "text": "Now the frame to judge."})
    return content


def load_cache():
    got = {}
    if CACHE.exists():
        for line in CACHE.open():
            d = json.loads(line)
            got[(d["model"], d["id"])] = d
    return got


def client():
    from openai import OpenAI
    return OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def submit(model: str):
    key = json.loads((SET / "hand_labels_key.json").read_text())
    items = {i["id"]: i for i in json.loads((SET / "hand_labels_items.json").read_text())}
    usable = {r["id"] for r in load() if r["label"] != "cannot_tell"}
    cache = load_cache()
    jobs = json.loads(JOBS.read_text()) if JOBS.exists() else []
    pending = {(j["model"], i) for j in jobs for i in j["ids"]}
    todo = [f for f in sorted(usable) if (model, f) not in cache and (model, f) not in pending]
    if not todo:
        print("nothing to submit")
        return
    path = REPO / "data" / "derived" / f"llm_reader_{model}_{datetime.now(timezone.utc):%Y%m%dT%H%M%S}.jsonl"
    with path.open("w") as f:
        for fid in todo:
            v = {**key[fid], "location": items.get(fid, {}).get("where")}
            f.write(json.dumps(request(fid, v, model)) + "\n")
    c = client()
    up = c.files.create(file=path.open("rb"), purpose="batch")
    b = c.batches.create(input_file_id=up.id, endpoint="/v1/chat/completions", completion_window="24h")
    jobs.append({"model": model, "id": b.id, "ids": todo, "input": str(path.relative_to(REPO))})
    JOBS.write_text(json.dumps(jobs, indent=1))
    print(f"{model}: submitted {len(todo)} frames as batch {b.id} ({path.stat().st_size / 1e6:.1f} MB)")


def collect(wait: bool):
    c = client()
    while True:
        jobs = json.loads(JOBS.read_text()) if JOBS.exists() else []
        left = []
        for j in jobs:
            b = c.batches.retrieve(j["id"])
            if b.status in ("validating", "in_progress", "finalizing"):
                left.append(j)
                print(f"{j['model']} {j['id']}: {b.status} {b.request_counts}")
                continue
            if b.status != "completed" or not b.output_file_id:
                print(f"{j['model']} {j['id']}: {b.status} -- nothing to collect")
                continue
            n = 0
            with CACHE.open("a") as f:
                for line in c.files.content(b.output_file_id).text.splitlines():
                    d = json.loads(line)
                    body = (d.get("response") or {}).get("body") or {}
                    try:
                        ans = json.loads(body["choices"][0]["message"]["content"])
                        usage = body.get("usage", {})
                        f.write(json.dumps({"model": j["model"], "id": d["custom_id"], "answer": ans,
                                            "in": usage.get("prompt_tokens"), "out": usage.get("completion_tokens")}) + "\n")
                        n += 1
                    except Exception as e:
                        print(f"  {d.get('custom_id')}: unreadable answer ({str(e)[:80]})")
            print(f"{j['model']} {j['id']}: collected {n} answers")
        JOBS.write_text(json.dumps(left, indent=1))
        if not (wait and left):
            return
        time.sleep(60)


def report(model: str):
    from scripts.hand_label_fusion import clf
    key = json.loads((SET / "hand_labels_key.json").read_text())
    cache = load_cache()
    rows = [r for r in load() if r["label"] != "cannot_tell"]
    examples = set(json.loads(EXAMPLES.read_text())) if EXAMPLES.exists() else set()
    for r in rows:
        r["y"] = r["label"] == "raining"
        r["example"] = r["id"] in examples
        d = cache.get((model, r["id"]))
        r["llm"] = d["answer"].get("rain_now") if d else None
    # hand-label classifier, each batch scored by a model trained on earlier batches only
    for b in sorted({r["batch"] for r in rows}):
        train, test = [r for r in rows if r["batch"] < b], [r for r in rows if r["batch"] == b]
        if train and any(r["y"] for r in train):
            for r, s in zip(test, clf(0.1).fit(features(train), [r["y"] for r in train]).decision_function(features(test))):
                r["clf"] = s
    # the few-shot examples are left out of every reader's score, so zero-shot and few-shot runs
    # are compared on the same frames
    answered = [r for r in rows if r["llm"] and not r["example"]]
    ds = [cache[(model, r["id"])] for r in answered]
    print(f"{model}: {len(answered)} of {len(rows)} labelled frames answered; answers {dict(Counter(r['llm'] for r in answered))}")
    if ds:
        tin, tout = np.mean([d["in"] or 0 for d in ds]), np.mean([d["out"] or 0 for d in ds])
        print(f"  tokens per frame: {tin:.0f} in, {tout:.0f} out")

    def line(name, sub, call):
        sub = [r for r in sub if call(r) is not None]
        if not sub:
            return
        y = np.array([r["y"] for r in sub])
        p = np.array([bool(call(r)) for r in sub])
        print(f"    {name:30s} agree {(p == y).mean():4.0%} ({(p == y).sum()}/{len(y)})   rain caught {(p & y).sum()}/{y.sum()}"
              f"   pins that were rain {(p & y).sum()}/{p.sum()}")

    readers = [(model, lambda r: None if r["llm"] in (None, "cannot_tell") else r["llm"] == "raining"),
               ("Gemma", lambda r: r["gemma"]),
               ("map (Gemma + veto)", lambda r: r["map"]),
               ("hand-label classifier", lambda r: None if "clf" not in r else r["clf"] > 0)]
    night = lambda r: r["hour"] < 6 or r["hour"] >= 18
    newest = max(r["batch"] for r in rows)
    for title, sub in [("all labelled frames", answered),
                       ("batches 4-6 (4-6 Oct)", [r for r in answered if 4 <= r["batch"] <= 6]),
                       (f"batch {newest} (newest)", [r for r in answered if r["batch"] == newest]),
                       ("day", [r for r in answered if not night(r)]), ("night", [r for r in answered if night(r)])]:
        print(f"\n  {title} ({len(sub)} frames, {sum(r['y'] for r in sub)} raining)")
        for name, f in readers:
            line(name, sub, f)
    ct = sum(r["llm"] == "cannot_tell" for r in answered)
    print(f"\n  {model} answered cannot_tell on {ct} frames (left out of its own line)")


def flex(model: str, workers: int = 4, fewshot: bool = True):
    """Ordinary calls on the flex tier (batch prices, slower, sometimes refused for capacity -- so long
    timeouts and retries). Few-shot: every frame not used as an example is asked with the examples in
    front, cached as '<model>+fewshot'. Zero-shot: every labelled frame, no examples, cached as '<model>'
    (the same key a batch run uses). Answers are cached as they arrive."""
    from concurrent.futures import ThreadPoolExecutor
    import threading
    tag = f"{model}+fewshot" if fewshot else model
    key = json.loads((SET / "hand_labels_key.json").read_text())
    items = {i["id"]: i for i in json.loads((SET / "hand_labels_items.json").read_text())}
    prefix = fewshot_prefix(key, items) if fewshot else None
    ex = set(pick_examples()) if fewshot else set()
    cache = load_cache()
    todo = [r["id"] for r in load() if r["label"] != "cannot_tell" and r["id"] not in ex and (tag, r["id"]) not in cache]
    print(f"{tag}: {len(todo)} frames to ask ({len(ex)} examples in every prompt)" if fewshot
          else f"{tag}: {len(todo)} frames to ask, no examples", flush=True)
    c = client().with_options(timeout=900, max_retries=0)
    lock, done = threading.Lock(), [0]

    def one(fid):
        body = request(fid, {**key[fid], "location": items.get(fid, {}).get("where")}, model, prefix)["body"]
        for attempt in range(6):
            try:
                r = c.chat.completions.create(**body, service_tier="flex")
                ans = json.loads(r.choices[0].message.content)
                row = {"model": tag, "id": fid, "answer": ans, "in": r.usage.prompt_tokens, "out": r.usage.completion_tokens}
                with lock, CACHE.open("a") as f:
                    f.write(json.dumps(row) + "\n")
                    done[0] += 1
                    if done[0] % 25 == 0:
                        print(f"  {done[0]}/{len(todo)}", flush=True)
                return
            except Exception as e:          # 429 "resource unavailable" on flex, timeouts: back off, retry
                wait = 30 * (attempt + 1)
                print(f"  {fid}: {str(e)[:120]} -- retry in {wait}s", flush=True)
                time.sleep(wait)
        print(f"  {fid}: gave up", flush=True)

    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(one, todo))
    print(f"{tag}: {done[0]} answered", flush=True)


def probe(model: str):
    """Does the few-shot prefix get cached? Two direct calls on different frames (the second should read
    the cache the first wrote), then a one-request batch, printing each call's token accounting."""
    key = json.loads((SET / "hand_labels_key.json").read_text())
    items = {i["id"]: i for i in json.loads((SET / "hand_labels_items.json").read_text())}
    prefix = fewshot_prefix(key, items)
    ex = set(pick_examples())
    test = [r["id"] for r in load() if r["label"] != "cannot_tell" and r["id"] not in ex]
    c = client()
    for fid in test[:2]:
        body = request(fid, {**key[fid], "location": items.get(fid, {}).get("where")}, model, prefix)["body"]
        t0 = time.monotonic()
        r = c.chat.completions.create(**body)
        u = r.usage
        print(f"direct call {fid}: {time.monotonic() - t0:.1f}s; prompt {u.prompt_tokens} tokens, cached "
              f"{u.prompt_tokens_details.cached_tokens}, output {u.completion_tokens} -> {r.choices[0].message.content[:90]}")
    fid = test[2]
    path = REPO / "data" / "derived" / f"llm_reader_probe_{datetime.now(timezone.utc):%Y%m%dT%H%M%S}.jsonl"
    path.write_text(json.dumps(request(fid, {**key[fid], "location": items.get(fid, {}).get("where")}, model, prefix)) + "\n")
    up = c.files.create(file=path.open("rb"), purpose="batch")
    b = c.batches.create(input_file_id=up.id, endpoint="/v1/chat/completions", completion_window="24h")
    print(f"one-request batch {b.id} submitted for {fid}; waiting")
    while b.status in ("validating", "in_progress", "finalizing"):
        time.sleep(20)
        b = c.batches.retrieve(b.id)
    if b.status == "completed" and b.output_file_id:
        d = json.loads(c.files.content(b.output_file_id).text.splitlines()[0])
        u = d["response"]["body"]["usage"]
        print(f"batch call {fid}: prompt {u['prompt_tokens']} tokens, cached "
              f"{(u.get('prompt_tokens_details') or {}).get('cached_tokens')}, output {u['completion_tokens']}")
    else:
        print(f"batch ended {b.status}")


# The Decisions API (POST /v1/decisions, public beta from 6 Oct 2026): gpt-6-luna answers a predicate with a
# probability instead of prose, billed for input tokens only ($0.10 / 1M). The frame is shown exactly as to
# the chat reader (previous frame, camera, local time); the question is the same rain definition.
DECIDE_TAG = "decisions:gpt-6-luna"
# The chat reader's own question as a choice: its four answers with their definitions, the hard-cases
# paragraph, and the context sentence word for word. choice_rev lists the answers in reverse, because
# early users report the order shifts the probabilities.
CHOICES = [
    {"value": "raining", "description": "rain is falling now, at any intensity."},
    {"value": "wet_not_raining", "description": "the street is wet but rain is not falling now (it has stopped)."},
    {"value": "dry", "description": "the street is dry and nothing is falling."},
    {"value": "cannot_tell", "description": "the image does not allow a judgment (too dark, lens blocked, frozen or broken frame)."},
]
RAIN_QUESTION = (
    "Is rain falling at this street at the moment of the last frame? "
    "Things that make this hard, in both directions: water drops on the camera's lens or housing can stay "
    "long after rain stops, and can also be the only visible sign of light rain at night; roads stay wet "
    "and reflective for an hour or more after rain; headlights and street lamps make dry roads glare at "
    "night; light rain is often visible only as streaks against lights, splashes in puddles, spray from "
    "tyres, or people under umbrellas and in raincoats. Weigh what the image actually shows.")
VARIANTS = {"predicate": DECIDE_TAG, "choice": "decisions-choice:gpt-6-luna", "choice_rev": "decisions-choice-rev:gpt-6-luna"}
RAIN_PREDICATE = (
    "Rain is falling at this street at the moment of the last frame, at any intensity. "
    "Things that make this hard, in both directions: water drops on the camera's lens or housing can stay "
    "long after rain stops, and can also be the only visible sign of light rain at night; roads stay wet "
    "and reflective for an hour or more after rain; headlights and street lamps make dry roads glare at "
    "night; light rain is often visible only as streaks against lights, splashes in puddles, spray from "
    "tyres, or people under umbrellas and in raincoats. Weigh what the image actually shows.")


def decision_body(v: dict, variant: str = "predicate") -> dict:
    t = frame_time(v["image"]) + ICT
    prev = prev_of(v["image"])
    note = f" The first image is the same camera {prev[1]} min earlier, for comparison." if prev else ""
    loc = v.get("location") or v.get("where") or "an intersection"
    if variant == "predicate":
        text = (f"Frames from a public traffic camera at {loc}, Ho Chi Minh City, Vietnam. The last image is the "
                f"frame to judge, taken at {t.strftime('%H:%M on %d %b')} local time ({phase(t.hour)}).{note}")
    else:   # the chat prompt's opening, word for word
        text = PROMPT.split("\n\nIs rain")[0].format(location=loc, local=t.strftime("%H:%M on %d %b"),
                                                      phase=phase(t.hour), prev_note=note.replace(" The first", "\nThe first"))
    content = [{"type": "input_text", "text": text}]
    for path in ([prev[0]] if prev else []) + [REPO / v["image"]]:
        b = base64.b64encode(Path(path).read_bytes()).decode()
        content.append({"type": "input_image", "image_url": f"data:image/jpeg;base64,{b}"})
    if variant == "predicate":
        q = {"type": "predicate", "name": "rain_now", "instructions": RAIN_PREDICATE}
    else:
        q = {"type": "choice", "name": "rain_now", "instructions": RAIN_QUESTION,
             "choices": CHOICES[::-1] if variant == "choice_rev" else CHOICES}
    return {"model": "gpt-6-luna", "input": [{"role": "user", "content": content}], "questions": [q]}


def decide(variant: str = "predicate", workers: int = 4):
    """Every labelled frame through the Decisions API; answers cached as they arrive."""
    tag = VARIANTS[variant]
    from concurrent.futures import ThreadPoolExecutor
    import threading
    key = json.loads((SET / "hand_labels_key.json").read_text())
    items = {i["id"]: i for i in json.loads((SET / "hand_labels_items.json").read_text())}
    cache = load_cache()
    todo = [r["id"] for r in load() if r["label"] != "cannot_tell" and (tag, r["id"]) not in cache]
    print(f"{tag}: {len(todo)} frames to ask", flush=True)
    c = client().with_options(timeout=120, max_retries=2)
    lock, done = threading.Lock(), [0]

    def one(fid):
        body = decision_body({**key[fid], "location": items.get(fid, {}).get("where")}, variant)
        for attempt in range(4):
            try:
                t0 = time.monotonic()
                r = c.post("/decisions", body=body, cast_to=object)
                a = r["answers"][0]
                ans = {"probability": a["probability"]} if variant == "predicate" else \
                    {"choice": a["choice"], "probabilities": a["probabilities"], "confidence": a.get("confidence")}
                row = {"model": tag, "id": fid, "answer": ans,
                       "in": r["usage"]["input_tokens"], "out": 0, "secs": round(time.monotonic() - t0, 2)}
                with lock, CACHE.open("a") as f:
                    f.write(json.dumps(row) + "\n")
                    done[0] += 1
                    if done[0] % 50 == 0:
                        print(f"  {done[0]}/{len(todo)}", flush=True)
                return
            except Exception as e:
                print(f"  {fid}: {str(e)[:150]} -- retry", flush=True)
                time.sleep(10 * (attempt + 1))
        print(f"  {fid}: gave up", flush=True)

    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(one, todo))
    print(f"{tag}: {done[0]} answered", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["submit", "collect", "report", "probe", "flex", "decide"])
    ap.add_argument("--model", default="gpt-6-luna")
    ap.add_argument("--wait", action="store_true")
    ap.add_argument("--zero-shot", action="store_true", help="flex: no examples in the prompt")
    ap.add_argument("--variant", default="predicate", choices=list(VARIANTS), help="decide: question type")
    a = ap.parse_args()
    {"submit": lambda: submit(a.model), "collect": lambda: collect(a.wait), "report": lambda: report(a.model),
     "probe": lambda: probe(a.model), "flex": lambda: flex(a.model, fewshot=not a.zero_shot), "decide": lambda: decide(a.variant)}[a.step]()


if __name__ == "__main__":
    main()
