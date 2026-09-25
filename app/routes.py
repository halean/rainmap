import json
from pathlib import Path
from datetime import datetime, timedelta, timezone

import requests
from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates

from app.config import (
    HIMAWARI_BANDS,
    HIMAWARI_BBOX,
    HIMAWARI_IMAGE_SIZES,
    HIMAWARI_MAX_AGE_HOURS,
    HIMAWARI_RETENTION_HOURS,
)
from app.services import flights, himawari, lightning_vn, radar_nhb, recent
from app.services.fetch_jobs import FetchJobManager
from app.services.vrain import rain_density

RAIN_SAMPLE_PATH = Path("data/derived/rain_sample.json")
# The index holds this many per camera (recent.RECENT_LIMIT); the endpoint cannot return more.
HISTORY_PER_CAMERA = recent.RECENT_LIMIT
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
    """Most-recent-first readings for one camera, from the per-camera index
    the annotator maintains (app/services/recent.py) -- a few KB read,
    constant regardless of how large the history log grows. The log itself
    is no longer touched at request time. A camera with no index file has no
    history; an id that isn't a camera id is refused rather than turned into
    a path."""
    try:
        entries = recent.load_recent(camera_id, base=recent.RECENT_DIR)
    except recent.BadCameraId:
        raise HTTPException(status_code=422, detail="camera_id must be a 24-character hex id")
    return [
        {
            "captured_at": e.get("captured_at"),
            "rain": e.get("rain"),
            "justification": e.get("justification"),
            "image_url": e.get("image_url"),
        }
        for e in entries[:limit]
    ]


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
        limit = max(1, min(limit, recent.RECENT_LIMIT))
        return _camera_history(camera_id, limit)

    @app.get("/api/rain-map/vrain")
    def vrain_density(hours: int = Query(3, ge=1, le=24), at: datetime | None = None) -> dict:
        if at is not None and at.tzinfo is None:
            raise HTTPException(status_code=422, detail="at must include a timezone")
        return rain_density(hours=hours, at=at)

    @app.get("/api/rain-map/lightning")
    def lightning_recent(minutes: int = Query(90, ge=5, le=360)) -> dict:
        """Real strikes from HYMETNET's rich feed (scripts/hymetnet_poller.py),
        not a dramatization -- see app/services/lightning_vn.py. Restricted to
        HIMAWARI_BBOX, the same regional box the satellite layer uses, so an
        approaching storm is visible before it reaches the city."""
        return lightning_vn.recent_strikes(lightning_vn.STRIKES_HISTORY_PATH, minutes=minutes, bbox=HIMAWARI_BBOX)

    @app.get("/api/rain-map/radar")
    def radar_frames() -> dict:
        """Nha Be weather radar (HYMETNET): the frames online, newest first.

        Each frame is served recoloured into the map's own classes by
        /api/rain-map/radar.png -- see app/services/radar_nhb.py for why.
        """
        try:
            stamps = radar_nhb.available_frames()
        except radar_nhb.RadarUnavailable as e:
            raise HTTPException(status_code=503, detail=str(e))
        now = datetime.now(timezone.utc)
        frames = [
            {
                "time": radar_nhb.stamp_time(s).isoformat(),
                "age_minutes": round((now - radar_nhb.stamp_time(s)).total_seconds() / 60),
                "image_url": f"/api/rain-map/radar.png?time={s}",
            }
            for s in stamps
        ]
        return {
            "station": "Nhà Bè",
            "source": "HYMETNET (Trung tâm Kỹ thuật quan trắc KTTV)",
            "product": "CMAX column-maximum reflectivity, recoloured by dBZ",
            "site": list(radar_nhb.RADAR_SITE),
            "bounds": radar_nhb.IMAGE_BOUNDS,
            "classes": [
                {"name": name, "min_dbz": lowest, "color": "#%02x%02x%02x" % rgb}
                for lowest, name, rgb in radar_nhb.CLASSES
            ],
            "latest": frames[0],
            "frames": frames,
        }

    @app.get("/api/rain-map/radar.png")
    def radar_image(time: str) -> Response:
        if not radar_nhb.STAMP_RE.match(time):
            raise HTTPException(status_code=422, detail="time must be YYYYMMDDHHMM (UTC)")
        try:
            if time not in radar_nhb.available_frames() and not (radar_nhb.STORE / f"{time}.png").exists():
                # Only frames HYMETNET currently lists (or already drawn) -- a
                # stranger shouldn't be able to make us fetch arbitrary paths.
                raise HTTPException(status_code=404, detail="no such radar frame online")
            png = radar_nhb.frame_png(time)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        except radar_nhb.RadarUnavailable as e:
            raise HTTPException(status_code=503, detail=str(e))
        return Response(
            content=png,
            media_type="image/png",
            # The time is pinned in the URL, so this image can never change.
            headers={"Cache-Control": "public, max-age=86400, immutable"},
        )

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

    @app.get("/api/rain-map/himawari/frames")
    def himawari_frames(hours: float = Query(None, gt=0, le=48)) -> dict:
        """The collected window, oldest first -- what a replay would step through.

        Empty unless `scripts/himawari_poller.py` is running: a frame can only
        be had by drawing it while its scan was current.
        """
        frames = himawari.stored_frames(hours)
        return {
            "retention_hours": HIMAWARI_RETENTION_HOURS,
            "count": len(frames),
            "frames": [
                {
                    "scan": f["scan"],
                    "mode": f["mode"],
                    "bands": f["bands"],
                    "coldest_k": f.get("coldest_k"),
                    "coverage": f.get("coverage"),
                    "image_url": f"/api/rain-map/himawari.png"
                    f"?scan={f['stamp']}&size={f['size']}",
                }
                for f in frames
            ],
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
        stored = himawari.load_scene(slot, size)
        if stored is None and not timedelta(0) <= now - slot <= timedelta(hours=HIMAWARI_MAX_AGE_HOURS):
            # The window only limits what may be *fetched*. A frame already
            # collected is free to serve, however old the retention lets it get.
            raise HTTPException(
                status_code=404,
                detail=f"only the last {HIMAWARI_MAX_AGE_HOURS:g} hours of scans are served",
            )
        try:
            # A collected frame costs a disk read; a miss costs a multi-megabyte
            # fetch from NOAA and ~26 s to draw, so the store is checked first.
            scene = stored or himawari.scene_at(slot, size)
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

    @app.get("/api/rain-map/flights")
    def flights_schedule() -> dict:
        """Arrivals and departures at Tan Son Nhat, with runway geometry and
        the wind that picks the runway direction. Served from a disk cache so
        the free schedule tier is touched a handful of times a day."""
        return flights.status()

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
