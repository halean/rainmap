import csv
import json
import re
from collections import deque
from pathlib import Path
from datetime import datetime, timedelta, timezone

import requests
from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates

from app.config import HIMAWARI_BANDS, HIMAWARI_IMAGE_SIZES, HIMAWARI_MAX_AGE_HOURS
from app.services import himawari
from app.services.fetch_jobs import FetchJobManager
from app.services.vrain import rain_density

RAIN_SAMPLE_PATH = Path("data/derived/rain_sample.json")
RAIN_HISTORY_PATH = Path("data/derived/rain_history.csv")
IMAGE_STAMP_RE = re.compile(r"^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})")
HISTORY_PER_CAMERA = 12
SCAN_STAMP = "%Y%m%d%H%M"


def _checked_size(size: int | None) -> int | None:
    """Sizes are render-cache keys, so only the listed ones are servable."""
    if size is not None and size not in HIMAWARI_IMAGE_SIZES:
        raise HTTPException(
            status_code=422,
            detail=f"size must be one of {', '.join(map(str, HIMAWARI_IMAGE_SIZES))}",
        )
    return size


def _ramp(band: str) -> list[dict]:
    """A band's colour key, served rather than hardcoded in the legend so the
    two cannot drift apart."""
    infrared = himawari.band_kind(band) == "infrared"
    stops = himawari.CLOUD_STOPS if infrared else himawari.VISIBLE_STOPS
    return [
        {
            "value": value,
            "label": f"{round(value - 273.15)}\u00b0C" if infrared else f"{round(value * 100)}%",
            "color": "#%02x%02x%02x" % rgb,
            "opacity": round(alpha / 255, 3),
        }
        for value, rgb, alpha in stops
    ]


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

    @app.get("/api/rain-map/himawari")
    def himawari_scene(size: int = Query(None)) -> dict:
        """Metadata for the newest cloud-top scan, and where to fetch its image.

        The image is left to a second request so the browser can cache it
        against the scan it belongs to: the pixels only change every ten
        minutes, and they cost a multi-megabyte download from NOAA to produce.
        """
        try:
            scene = himawari.latest_scene(_checked_size(size))
        except (himawari.HimawariUnavailable, ValueError) as e:
            raise HTTPException(status_code=503, detail=str(e))
        except (requests.RequestException, OSError) as e:
            raise HTTPException(status_code=503, detail=f"Himawari fetch failed: {e}")
        south, west, north, east = scene.bounds
        return {
            "scan": scene.scan.isoformat(),
            "age_minutes": round(
                (datetime.now(timezone.utc) - scene.scan).total_seconds() / 60
            ),
            "mode": scene.mode,
            "bands": list(scene.bands),
            "label": " + ".join(HIMAWARI_BANDS[b]["label"] for b in scene.bands),
            "solar_elevation": round(himawari.solar_elevation(), 1),
            "bounds": [[south, west], [north, east]],
            "image_url": f"/api/rain-map/himawari.png"
            f"?scan={scene.scan.strftime(SCAN_STAMP)}&size={scene.size}",
            "coldest_k": scene.coldest_k,
            "brightest_albedo": scene.brightest_albedo,
            "coverage": scene.coverage,
            # The infrared ramp is the colour key and is always present. The
            # greyscale one only applies while the visible band is being drawn.
            "scale": _ramp("B13"),
            "texture_scale": _ramp("B03") if "B03" in scene.bands else None,
        }

    @app.get("/api/rain-map/himawari.png")
    def himawari_image(scan: str, size: int = Query(None)) -> Response:
        size = _checked_size(size)
        try:
            slot = datetime.strptime(scan, SCAN_STAMP).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status_code=422, detail="scan must be YYYYMMDDHHMM (UTC)")
        now = datetime.now(timezone.utc)
        if slot != himawari.floor_to_scan(slot):
            raise HTTPException(status_code=422, detail="scans start every 10 minutes")
        # Each miss downloads strips from NOAA, so the window a stranger can ask
        # for stays small even though the bucket itself goes back years.
        if not timedelta(0) <= now - slot <= timedelta(hours=HIMAWARI_MAX_AGE_HOURS):
            raise HTTPException(
                status_code=404,
                detail=f"only the last {HIMAWARI_MAX_AGE_HOURS:g} hours of scans are served",
            )
        try:
            scene = himawari.scene_at(slot, size)
        except (himawari.HimawariUnavailable, ValueError) as e:
            raise HTTPException(status_code=503, detail=str(e))
        except requests.HTTPError as e:
            status = 404 if e.response is not None and e.response.status_code == 404 else 503
            raise HTTPException(status_code=status, detail=f"Himawari fetch failed: {e}")
        except (requests.RequestException, OSError) as e:
            raise HTTPException(status_code=503, detail=f"Himawari fetch failed: {e}")
        return Response(
            content=scene.png,
            media_type="image/png",
            # The scan is pinned in the URL, so this image can never change.
            headers={"Cache-Control": "public, max-age=86400, immutable"},
        )

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
