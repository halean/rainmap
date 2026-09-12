import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from app.services.fetch_jobs import FetchJobManager

RAIN_SAMPLE_PATH = Path("data/derived/rain_sample.json")


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
