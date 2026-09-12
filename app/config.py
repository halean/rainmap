import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_URL = "https://giaothong.hochiminhcity.gov.vn/render/ImageHandler.ashx"
RAW_OUTPUT_ROOT = Path(os.getenv("RAW_OUTPUT_ROOT", "data/raw"))
OFFLINE_LOG_CSV = Path(os.getenv("OFFLINE_LOG_CSV", "data/metadata/offline_events.csv"))
OFFLINE_SIZE_THRESHOLD = int(os.getenv("OFFLINE_SIZE_THRESHOLD", str(5 * 1024)))
FETCH_DELAY_SEC = float(os.getenv("FETCH_DELAY_SEC", "0.2"))
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}

# Target wall-clock duration for one full pass over the camera list. Requests are
# paced evenly across this window instead of being fired back to back: the annotator
# only consumes one frame per camera per cooldown (~350s), so sweeping faster than
# this just burns disk and hammers a public service for frames nobody looks at.
# If the source site is slow enough that a pass already overruns the window, no
# extra delay is added.
SWEEP_INTERVAL_SEC = float(os.getenv("SWEEP_INTERVAL_SEC", "300"))

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_MODEL = os.getenv("GOOGLE_MODEL", "gemma-3-27b-it")
GOOGLE_API_TIMEOUT_SEC = float(os.getenv("GOOGLE_API_TIMEOUT_SEC", "90"))

COLLAGE_ROOT = Path(os.getenv("COLLAGE_ROOT", "data/derived/collages"))
COLLAGE_CELL_W = int(os.getenv("COLLAGE_CELL_W", "512"))
COLLAGE_CELL_H = int(os.getenv("COLLAGE_CELL_H", "288"))
COLLAGE_JPEG_QUALITY = int(os.getenv("COLLAGE_JPEG_QUALITY", "95"))

ANALYSIS_MAX_WORKERS = int(os.getenv("ANALYSIS_MAX_WORKERS", "4"))
ANALYSIS_KEEP_LAST = int(os.getenv("ANALYSIS_KEEP_LAST", "200"))
FETCH_KEEP_LAST = int(os.getenv("FETCH_KEEP_LAST", "50"))
