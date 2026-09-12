from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.routes import register_routes
from app.services.fetch_jobs import FetchJobManager

app = FastAPI(title="HCMC Rain Map")
app.mount("/media", StaticFiles(directory="."), name="media")
templates = Jinja2Templates(directory="app/templates")

fetch_manager = FetchJobManager()

register_routes(
    app,
    templates=templates,
    fetch_manager=fetch_manager,
)
