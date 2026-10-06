"""Shadow mode: a second opinion on every frame Gemma reads -- logged, and with one narrow veto.

THE VETO (since 2 Oct 2026, 01:50 ICT): when Gemma calls rain only from water on the road -- nothing
seen falling -- and this classifier scores the frame dry (below VETO, default 0: it leans dry at all), the
reading is published as "No". That is the after-the-storm night error: on 1-2 Oct Gemma put Medium
pins on dry streets for hours (gauges 0 mm in 3 h, no radar echo) and this classifier called every
one of them dry. It never vetoes rain Gemma saw falling and never adds rain, so it can only remove
pins of that one kind. RAIN_SHADOW_VETO=off disables it; every veto is logged.

After the annotator accepts a reading, this embeds the same frame (gemini-embedding-2) and scores
it with the ridge classifier trained by scripts/embedding_classifier.py --save, then logs both
verdicts side by side. Nothing it does reaches the map: the point is to collect, over real storms,
how often the two disagree and -- scored against the gauges by scripts/shadow_report.py -- which
one was right when they did, before deciding whether the classifier should ever act (look again
sooner, or a "second opinion" note on the pin).

Never in the annotator's way: one background worker, a bounded queue that drops work rather than
grow, and every failure logged and swallowed. With no model file, or RAIN_SHADOW=0, it is off.

Key: GOOGLE_API_FREE_KEY when set (embeddings are free there; these are public camera frames),
else GOOGLE_API_KEY -- RAIN_SHADOW_KEY=paid forces the paid one.

Outputs:
  data/derived/rain_shadow.csv                                  one row per scored frame
  data/derived/embedding_cache/gemini-embedding-2.shadow.jsonl  the embeddings, for retraining --
      written only by this process; scripts/embedding_eval.py's cache reads it too
"""

import base64
import csv
import json
import math
import os
import queue
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from app import config
from app.log_setup import get_logger

REPO = Path(__file__).resolve().parents[2]
MODEL_PATH = REPO / "data" / "derived" / "rain_shadow_model.npz"
LOG_PATH = REPO / "data" / "derived" / "rain_shadow.csv"
EMB_PATH = REPO / "data" / "derived" / "embedding_cache" / "gemini-embedding-2.shadow.jsonl"
ICT = timezone(timedelta(hours=7))
FIELDS = ["scored_at", "camera_id", "location", "image", "captured_at", "gemma", "gemma_water",
          "gemma_falling", "gemma_behaviour", "water_since", "shadow_score", "shadow_rain", "agree", "final",
          "gemma_said"]
_veto = os.getenv("RAIN_SHADOW_VETO", "0").strip().lower()
VETO = None if _veto in ("off", "none", "") else float(_veto)
QUEUE_MAX = 200  # ~35 min of the annotator's output; past that something is wrong, so drop

log = get_logger("rain_shadow")


class ShadowModel:
    """The ridge classifier as plain arrays: features are the embedding projected on a PCA basis,
    sin/cos of the hour and a night flag, standardised; rain iff the decision value > 0."""

    def __init__(self, path: Path = MODEL_PATH):
        z = np.load(path)
        self.mu, self.basis, self.m, self.s = z["mu"], z["basis"], z["m"], z["s"]
        self.coef, self.intercept = z["coef"], float(z["intercept"][0])
        self.meta = json.loads(str(z["meta"]))

    def score(self, embedding, captured: datetime) -> float:
        local = captured.astimezone(ICT)
        h = local.hour + local.minute / 60
        x = np.concatenate([(np.asarray(embedding, dtype=np.float64) - self.mu) @ self.basis,
                            [math.sin(2 * math.pi * h / 24), math.cos(2 * math.pi * h / 24),
                             1.0 if (h < 6 or h >= 18) else 0.0]])
        return float(((x - self.m) / self.s) @ self.coef + self.intercept)


class Shadow:
    def __init__(self):
        self.enabled = os.getenv("RAIN_SHADOW", "1") != "0" and MODEL_PATH.exists()
        if not self.enabled:
            log.info("shadow mode off (%s)", "RAIN_SHADOW=0" if MODEL_PATH.exists() else f"no model at {MODEL_PATH}")
            return
        paid = os.getenv("RAIN_SHADOW_KEY", "").lower() == "paid" or not config.GOOGLE_API_FREE_KEY
        from google import genai
        self.client = genai.Client(api_key=config.GOOGLE_API_KEY if paid else config.GOOGLE_API_FREE_KEY)
        # The free key has a daily cap (hit at 02:14 ICT on 2 Oct, after a day of experiments), and the
        # veto is silently off while every call is refused. So: free while it lasts, paid when the free
        # key says quota -- ~$0.00012 a frame, ~$1 a day at most.
        self.paid_client = None if paid or not config.GOOGLE_API_KEY else genai.Client(api_key=config.GOOGLE_API_KEY)
        self.fallbacks = 0
        self.model = ShadowModel()
        self.q = queue.Queue(maxsize=QUEUE_MAX)
        self.dropped = 0
        threading.Thread(target=self._run, name="rain-shadow", daemon=True).start()
        log.info("shadow mode on: %s key, model trained on %s frames (%s .. %s)",
                 "paid" if paid else "free", self.model.meta["frames"], self.model.meta["first"][:10],
                 self.model.meta["last"][:10])

    def score_frame(self, img_path: Path, captured_at: str | None):
        """(score, embedding) for a frame, or None if off or the call fails. Called from the
        annotator's worker threads, before the verdict is published, so the veto can use it."""
        if not self.enabled:
            return None
        try:
            from google.genai import types as t
            p = img_path if img_path.is_absolute() else REPO / img_path
            contents = [t.Part.from_bytes(data=p.read_bytes(), mime_type="image/jpeg")]
            try:
                r = self.client.models.embed_content(model=self.model.meta["embedding_model"], contents=contents)
            except Exception as e:
                if self.paid_client is None or not ("429" in str(e) or "RESOURCE_EXHAUSTED" in str(e)):
                    raise
                self.fallbacks += 1
                if self.fallbacks % 100 == 1:
                    log.warning("free key over quota; using the paid key (%d frame(s) so far)", self.fallbacks)
                r = self.paid_client.models.embed_content(model=self.model.meta["embedding_model"], contents=contents)
            vec = np.asarray(r.embeddings[0].values, dtype=np.float32)
            captured = datetime.fromisoformat(captured_at) if captured_at else datetime.now(timezone.utc)
            return self.model.score(vec, captured), vec
        except Exception as e:
            log.warning("scoring %s failed: %s", img_path, str(e)[:600])
            return None

    @staticmethod
    def veto(verdict: str, result: dict, scored) -> bool:
        """Overrule a rain call made from water alone when the classifier is clearly dry."""
        if VETO is None or scored is None or verdict == "No":
            return False
        falling = str(result.get("falling", "")).lower().strip() in ("yes", "true")
        return not falling and scored[0] < VETO

    def submit(self, cam_id: str, location: str, img_path: Path, captured_at: str | None,
               verdict: str, result: dict, water_since: str | None = None, scored=None, final: str | None = None) -> None:
        """water_since: when this camera's road last changed level (the annotator's own state) --
        a road soaked for an hour with nothing seen falling is the leftover-water signature."""
        if not self.enabled:
            return
        try:
            self.q.put_nowait((cam_id, location, img_path, captured_at, verdict,
                               {**result, "_since": water_since, "_scored": scored, "_final": final or verdict}))
        except queue.Full:
            self.dropped += 1
            if self.dropped % 50 == 1:
                log.warning("shadow queue full; %d frame(s) dropped so far", self.dropped)

    def _run(self):
        from google.genai import types as t
        while True:
            cam_id, location, img_path, captured_at, verdict, result = self.q.get()
            try:
                p = img_path if img_path.is_absolute() else REPO / img_path
                scored = result.get("_scored")
                if scored is None:  # not scored before publishing (the call failed then); one more try
                    scored = self.score_frame(img_path, captured_at)
                    if scored is None:
                        continue
                score, vec = scored
                gemma_rain = verdict != "No"
                self._append(LOG_PATH, FIELDS, {
                    "scored_at": datetime.now(timezone.utc).isoformat(), "camera_id": cam_id,
                    "location": location, "image": str(p.relative_to(REPO)), "captured_at": captured_at,
                    "gemma": verdict, "gemma_water": result.get("water", ""), "gemma_falling": result.get("falling", ""),
                    "gemma_behaviour": result.get("behaviour", ""), "water_since": result.get("_since") or "",
                    "shadow_score": round(score, 4), "shadow_rain": score > 0, "agree": (score > 0) == gemma_rain,
                    "final": result.get("_final", verdict),
                    # Gemma's own words. rain_history.csv keeps what was published, and decide()
                    # swaps Gemma's description for a fixed line when water alone carries the call.
                    "gemma_said": str(result.get("justification", "")).strip()})
                EMB_PATH.parent.mkdir(parents=True, exist_ok=True)
                with EMB_PATH.open("a") as f:
                    f.write(json.dumps({"key": str(p.relative_to(REPO)),
                                        "v": base64.b64encode(vec.tobytes()).decode()}) + "\n")
                if (score > 0) != gemma_rain:
                    log.info("[%s] %s: gemma %s, shadow %s (%.3f)", cam_id, location, verdict,
                             "rain" if score > 0 else "dry", score)
            except Exception as e:
                log.warning("[%s] shadow scoring failed: %s", cam_id, str(e)[:600])

    @staticmethod
    def _append(path: Path, fields, row):
        # A log written with older columns is set aside, not appended to: mixed headers would
        # silently shift every later column.
        if path.exists():
            with path.open(encoding="utf-8") as f:
                head = f.readline().strip().split(",")
            if head != fields:
                path.rename(path.with_name(f"{path.stem}.{datetime.now(timezone.utc):%Y%m%dT%H%M%S}{path.suffix}"))
        new = not path.exists()
        with path.open("a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            if new:
                w.writeheader()
            w.writerow(row)
