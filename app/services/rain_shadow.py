"""Shadow mode: a second opinion on every frame Gemma reads, logged and never shown.

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
          "gemma_falling", "gemma_behaviour", "water_since", "shadow_score", "shadow_rain", "agree"]
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
        self.model = ShadowModel()
        self.q = queue.Queue(maxsize=QUEUE_MAX)
        self.dropped = 0
        threading.Thread(target=self._run, name="rain-shadow", daemon=True).start()
        log.info("shadow mode on: %s key, model trained on %s frames (%s .. %s)",
                 "paid" if paid else "free", self.model.meta["frames"], self.model.meta["first"][:10],
                 self.model.meta["last"][:10])

    def submit(self, cam_id: str, location: str, img_path: Path, captured_at: str | None,
               verdict: str, result: dict, water_since: str | None = None) -> None:
        """water_since: when this camera's road last changed level (the annotator's own state) --
        a road soaked for an hour with nothing seen falling is the leftover-water signature."""
        if not self.enabled:
            return
        try:
            self.q.put_nowait((cam_id, location, img_path, captured_at, verdict, {**result, "_since": water_since}))
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
                r = self.client.models.embed_content(
                    model=self.model.meta["embedding_model"],
                    contents=[t.Part.from_bytes(data=p.read_bytes(), mime_type="image/jpeg")])
                vec = np.asarray(r.embeddings[0].values, dtype=np.float32)
                captured = datetime.fromisoformat(captured_at) if captured_at else datetime.now(timezone.utc)
                score = self.model.score(vec, captured)
                gemma_rain = verdict != "No"
                self._append(LOG_PATH, FIELDS, {
                    "scored_at": datetime.now(timezone.utc).isoformat(), "camera_id": cam_id,
                    "location": location, "image": str(p.relative_to(REPO)), "captured_at": captured_at,
                    "gemma": verdict, "gemma_water": result.get("water", ""), "gemma_falling": result.get("falling", ""),
                    "gemma_behaviour": result.get("behaviour", ""), "water_since": result.get("_since") or "",
                    "shadow_score": round(score, 4), "shadow_rain": score > 0, "agree": (score > 0) == gemma_rain})
                EMB_PATH.parent.mkdir(parents=True, exist_ok=True)
                with EMB_PATH.open("a") as f:
                    f.write(json.dumps({"key": str(p.relative_to(REPO)),
                                        "v": base64.b64encode(vec.tobytes()).decode()}) + "\n")
                if (score > 0) != gemma_rain:
                    log.info("[%s] %s: gemma %s, shadow %s (%.3f)", cam_id, location, verdict,
                             "rain" if score > 0 else "dry", score)
            except Exception as e:
                log.warning("[%s] shadow scoring failed: %s", cam_id, str(e)[:200])

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
