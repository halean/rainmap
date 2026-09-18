from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app import config
from app.log_setup import get_logger
from app.routes import register_routes
from app.services.fetch_jobs import FetchJobManager

log = get_logger("app")
fetch_manager = FetchJobManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Pick the camera sweep back up after a restart.

    The sweep is a daemon thread owned by this process, so it dies with it and
    leaves no trace beyond frames quietly ceasing to arrive. Starting it here
    ties it to the process it lives in, rather than to whoever remembers to
    POST /api/jobs/start afterwards.
    """
    if config.FETCH_AUTOSTART:
        try:
            log.info("fetch sweep autostarted: %s", fetch_manager.start()["job_id"])
        except RuntimeError as already:
            log.info("fetch sweep left alone: %s", already)  # someone got there first
        except Exception:
            # The map is still worth serving without the sweep, but this must
            # never be the silence it is meant to prevent.
            log.exception("fetch sweep failed to autostart; frames will go stale")
    yield


app = FastAPI(title="HCMC Rain Map", lifespan=lifespan)
app.mount("/media", StaticFiles(directory="."), name="media")
templates = Jinja2Templates(directory="app/templates")

register_routes(
    app,
    templates=templates,
    fetch_manager=fetch_manager,
)
