import csv
import json
import re
from collections import deque
from pathlib import Path
from datetime import datetime

from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from app.services.fetch_jobs import FetchJobManager
from app.services.vrain import rain_density

RAIN_SAMPLE_PATH = Path("data/derived/rain_sample.json")
RAIN_HISTORY_PATH = Path("data/derived/rain_history.csv")
IMAGE_STAMP_RE = re.compile(r"^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})")
HISTORY_PER_CAMERA = 12


def _camera_history(camera_id: str, limit: int) -> list[dict]:
    """Most-recent-first annotation history for one camera, read from the
    append-only rain_history.csv log (oldest-first on disk)."""
    if not RAIN_HISTORY_PATH.exists():
        return []
    recent: deque[dict] = deque(maxlen=limit)
    with RAIN_HISTORY_PATH.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("camera_id") != camera_id:
                continue
            image = row.get("image", "")
            m = IMAGE_STAMP_RE.match(image)
            image_url = None
            captured_at = None
            if m:
                y, mo, d, h, mi, s = m.groups()
                image_url = f"/media/data/raw/{camera_id}/{y}/{mo}/{d}/{image}"
                captured_at = f"{y}-{mo}-{d}T{h}:{mi}:{s}Z"
            recent.append(
                {
                    "captured_at": captured_at,
                    "rain": row.get("rain"),
                    "justification": row.get("justification"),
                    "image_url": image_url,
                }
            )
    return list(reversed(recent))


def register_routes(
    app: FastAPI,
    *,
    templates: Jinja2Templates,
    fetch_manager: FetchJobManager,
) -> None:
    @app.get("/", response_class=RedirectResponse)
    def root() -> RedirectResponse:
        return RedirectResponse(url="/rain-map")

    @app.get("/rain-map", response_class=HTMLResponse)
    def rain_map(request: Request) -> HTMLResponse:
        return templates.TemplateResponse("rain_map.html", {"request": request})

    @app.get("/api/rain-map")
    def rain_map_data() -> list[dict]:
        if not RAIN_SAMPLE_PATH.exists():
            return []
        return json.loads(RAIN_SAMPLE_PATH.read_text())

    @app.get("/api/rain-map/rain-history")
    def rain_history(camera_id: str, limit: int = HISTORY_PER_CAMERA) -> list[dict]:
        limit = max(1, min(limit, 50))
        return _camera_history(camera_id, limit)

    @app.get("/api/rain-map/vrain")
    def vrain_density(hours: int = Query(3, ge=1, le=24), at: datetime | None = None) -> dict:
        if at is not None and at.tzinfo is None:
            raise HTTPException(status_code=422, detail="at must include a timezone")
        return rain_density(hours=hours, at=at)

    @app.get("/api/status")
    def get_status() -> dict:
        return fetch_manager.snapshot()

    @app.post("/api/jobs/start")
    def start_job() -> dict:
        try:
            return fetch_manager.start()
        except RuntimeError as e:
            raise HTTPException(status_code=409, detail=str(e))

    @app.post("/api/jobs/stop")
    def stop_job() -> dict:
        try:
            return fetch_manager.stop()
        except RuntimeError as e:
            raise HTTPException(status_code=409, detail=str(e))
