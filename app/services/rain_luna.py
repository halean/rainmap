"""
gpt-6-luna as the rain reader: a trial from 6 Oct 2026, for a few days.

On the hand labels (data/test_sets/20261003_rain7d, scripts/hand_label_llm.py) luna zero-shot agreed with
the labeller on 75% of 485 frames and 80% of batch 8, against 74% for the old path (Gemma + veto) and
72% for the hand-label classifier. Each frame is asked exactly as it was scored there: the same prompt
(scripts/judge_pilot.py), the camera's previous frame when one is within 20 min, no examples.

The call runs beside Gemma's in the annotator's worker (start() before Gemma, answer() after), so it adds
little to a reading: ~9 s on the flex tier (half price) against Gemma's ~6-12 s. A flex call refused for
capacity is retried once on the standard tier; a frame luna cannot answer in time, or answers
cannot_tell, falls back to the hand-label classifier and then the old path.

Cost: ~720 tokens in and ~250 out a frame, ~$0.0001 on flex: ~$1 a day at 10,000 frames.
Off: RAIN_DECIDER=classifier (or gemma) at the annotator's launch.
"""

import json
import os
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

from app import config  # noqa: F401  (loads .env)
from app.log_setup import get_logger

REPO = Path(__file__).resolve().parents[2]
MODEL = os.getenv("LUNA_MODEL", "gpt-6-luna")
WAIT_SEC = float(os.getenv("LUNA_WAIT_SEC", "40"))     # longest the annotator waits for an answer
WORKERS = int(os.getenv("LUNA_WORKERS", "4"))

# luna's intensity -> the map's levels
LEVEL = {"light": "Light", "moderate": "Medium", "heavy": "Heavy"}

log = get_logger("rain_luna")


class Luna:
    def __init__(self):
        self.enabled = bool(os.getenv("OPENAI_API_KEY"))
        if not self.enabled:
            log.warning("luna off: no OPENAI_API_KEY")
            return
        from openai import OpenAI
        from scripts.hand_label_llm import request   # the request exactly as scored on the hand labels
        self.request = request
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY")).with_options(max_retries=0)
        self.pool = ThreadPoolExecutor(WORKERS, thread_name_prefix="luna")
        log.info("luna on: %s zero-shot, flex tier, waits up to %.0fs", MODEL, WAIT_SEC)

    def start(self, img_path: Path, location: str) -> Future | None:
        if not self.enabled:
            return None
        try:
            rel = str((img_path if img_path.is_absolute() else REPO / img_path).relative_to(REPO))
            return self.pool.submit(self._ask, rel, location)
        except Exception as e:
            log.warning("luna not started for %s: %s", img_path, str(e)[:300])
            return None

    def _ask(self, rel: str, location: str) -> dict:
        body = self.request(Path(rel).stem, {"image": rel, "location": location}, MODEL)["body"]
        t0 = time.monotonic()
        for tier in ("flex", "default"):
            try:
                r = self.client.with_options(timeout=WAIT_SEC).chat.completions.create(**body, service_tier=tier)
                ans = json.loads(r.choices[0].message.content)
                return {**ans, "tier": tier, "secs": round(time.monotonic() - t0, 1),
                        "tokens_in": r.usage.prompt_tokens, "tokens_out": r.usage.completion_tokens}
            except Exception as e:
                if tier == "default":
                    raise
                log.info("luna flex refused for %s (%s); trying standard", rel, str(e)[:120])

    def answer(self, fut: Future | None) -> dict | None:
        """luna's answer, or None if it was off, failed or is still out after WAIT_SEC in all."""
        if fut is None:
            return None
        try:
            return fut.result(timeout=WAIT_SEC)
        except Exception as e:
            log.warning("luna gave no answer: %s", str(e)[:300] or type(e).__name__)
            return None


def luna_decides(gemma_verdict: str, gemma_said: str, ans: dict | None, clf_score=None):
    """(verdict, justification) when luna makes the call, or None to leave it to the next reader.

    luna's rain is published only when Gemma or the hand-label classifier (score > 0) also sees rain.
    Alone it put a pin on a dry, clear road at Quốc Lộ 22 - Võ Văn Điều (6 Oct, 01:55 ICT; Gemma No,
    classifier -16). On the hand labels the second reader cuts false pins 45 -> 34 (35 -> 25 at night)
    and misses 2 more of 137 rain frames.

    Rain keeps Gemma's grade when Gemma also saw rain, else luna's own grade; Gemma's caption is
    kept when it agrees, as with the classifier, and a plain line replaces it when it would
    contradict the badge."""
    if ans is None or ans.get("rain_now") not in ("raining", "wet_not_raining", "dry"):
        return None
    seconded = gemma_verdict != "No" or (clf_score is not None and clf_score > 0)
    if ans["rain_now"] == "raining" and seconded:
        if gemma_verdict != "No":
            return gemma_verdict, gemma_said
        return LEVEL.get(ans.get("intensity"), "Light"), "Rain is falling here, by the look of the scene."
    return "No", gemma_said
