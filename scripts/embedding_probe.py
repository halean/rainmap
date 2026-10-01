"""
Does an embedding model work for this account's Gemini API key?

Run: .venv/bin/python scripts/embedding_probe.py [MODEL] [--image FRAME.jpg] [--paid]
     Probes GOOGLE_API_FREE_KEY (free tier) unless --paid, which probes GOOGLE_API_KEY.
     MODEL defaults to gemini-embedding-2.

Checks, each reported on its own so one failure does not hide the rest:
  1. which models this key can see that support embedContent, and whether MODEL is one of them
  2. text: three short texts -> vector size, latency, and a sanity check that the two about rain
     on a street sit closer to each other than to the unrelated one
  3. a reduced output size (output_dimensionality=768), if the model takes one
  4. an image: one camera frame (the newest in data/raw unless --image is given) -- only works
     if the model is multimodal; a text-only model is reported as such, not as a failure

Costs a handful of embedding calls. Prints nothing secret.
"""

import argparse
import math
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from google import genai
from google.genai import types as t

from app import config

REPO = Path(__file__).resolve().parents[1]
TEXTS = [
    "Heavy rain is falling on a busy street; riders wear raincoats and the road is flooded.",
    "A downpour has left water standing across the road and motorbikes push through it.",
    "The museum's new exhibition of porcelain opens on Saturday morning.",
]


def why(err: Exception) -> str:
    """One line on what an API error means for this check."""
    s = str(err)
    code = re.search(r"\b(400|401|403|404|429|500|503)\b", s)
    hint = {
        "404": "model not found, or not available to this key/API version",
        "403": "the key is not allowed to use it (project, region or billing)",
        "401": "the key itself was rejected",
        "429": "quota or rate limit -- the model exists and the key reaches it",
        "400": "request rejected -- often an input type or parameter the model does not take",
    }.get(code.group(1) if code else "", "unexpected error")
    return f"{hint}: {s[:300]}"


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


def newest_frame() -> Path | None:
    frames = sorted((REPO / "data" / "raw").glob("*/*/*/*/*.jpg"), key=lambda p: p.stat().st_mtime)
    return frames[-1] if frames else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model", nargs="?", default="gemini-embedding-2")
    ap.add_argument("--image", type=Path)
    ap.add_argument("--paid", action="store_true", help="probe GOOGLE_API_KEY instead of GOOGLE_API_FREE_KEY")
    args = ap.parse_args()
    key = config.GOOGLE_API_KEY if args.paid else config.GOOGLE_API_FREE_KEY
    if not key:
        sys.exit(f"{'GOOGLE_API_KEY' if args.paid else 'GOOGLE_API_FREE_KEY'} is not set (.env)")
    client = genai.Client(api_key=key)
    print(f"key: {'GOOGLE_API_KEY (paid)' if args.paid else 'GOOGLE_API_FREE_KEY (free tier)'}")
    model = args.model
    results = {}

    print(f"== 1. embedding models visible to this key")
    try:
        found = []
        for m in client.models.list():
            actions = getattr(m, "supported_actions", None) or []
            if "embedContent" in actions or "embed" in m.name.lower():
                found.append((m.name.removeprefix("models/"), ",".join(actions)))
        for name, actions in sorted(found):
            print(f"   {name:40s} {actions}")
        listed = any(name == model or name.startswith(model + "-") for name, _ in found)
        print(f"   {model}: {'LISTED' if listed else 'not listed'}")
        results["listed"] = listed
    except Exception as e:
        print(f"   could not list models: {why(e)}")

    print(f"\n== 2. text embedding with {model}")
    try:
        t0 = time.monotonic()
        r = client.models.embed_content(model=model, contents=TEXTS)
        ms = (time.monotonic() - t0) * 1000
        vecs = [e.values for e in r.embeddings]
        print(f"   OK: {len(vecs)} vectors of {len(vecs[0])} dims in {ms:.0f} ms")
        near, far = cosine(vecs[0], vecs[1]), max(cosine(vecs[0], vecs[2]), cosine(vecs[1], vecs[2]))
        print(f"   similarity rain/rain {near:.3f}, rain/unrelated {far:.3f} -> "
              f"{'sensible' if near > far else 'SUSPICIOUS: unrelated text scored closer'}")
        results["text"] = True
    except Exception as e:
        print(f"   FAILED: {why(e)}")
        results["text"] = False

    print(f"\n== 3. reduced size (output_dimensionality=768)")
    if results.get("text"):
        try:
            r = client.models.embed_content(model=model, contents=TEXTS[0],
                                            config=t.EmbedContentConfig(output_dimensionality=768))
            print(f"   OK: {len(r.embeddings[0].values)} dims")
        except Exception as e:
            print(f"   not supported: {why(e)}")
    else:
        print("   skipped (text embedding failed)")

    print(f"\n== 4. image embedding")
    frame = args.image or newest_frame()
    if not results.get("text"):
        print("   skipped (text embedding failed)")
    elif not frame or not frame.exists():
        print("   skipped: no frame found (pass --image FRAME.jpg)")
    else:
        try:
            t0 = time.monotonic()
            r = client.models.embed_content(
                model=model, contents=[t.Part.from_bytes(data=frame.read_bytes(), mime_type="image/jpeg")])
            ms = (time.monotonic() - t0) * 1000
            v = r.embeddings[0].values
            print(f"   OK: {frame.relative_to(REPO) if frame.is_relative_to(REPO) else frame} -> {len(v)} dims in {ms:.0f} ms")
            results["image"] = True
        except Exception as e:
            print(f"   not supported for images (or failed): {why(e)}")
            results["image"] = False

    verdict = "WORKS" if results.get("text") else "DOES NOT WORK"
    extra = "" if "image" not in results else (", images too" if results["image"] else ", text only")
    print(f"\n{model}: {verdict} for this key{extra if results.get('text') else ''}")
    sys.exit(0 if results.get("text") else 1)


if __name__ == "__main__":
    main()
