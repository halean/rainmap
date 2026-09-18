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

# Pinned to 0 deliberately. Left at the model default, a borderline frame is close
# to a coin flip -- the same prompt on the same two frames returned Medium, Medium,
# Medium, No, No across five runs, while temperature=0 returned the same verdict
# five times out of five. Two costs of not pinning it: a camera's reading could
# change between passes with nothing in the world having changed, and prompt A/B
# results were swamped by sampling noise (see NOTES.md).
GOOGLE_TEMPERATURE = float(os.getenv("GOOGLE_TEMPERATURE", "0"))

COLLAGE_ROOT = Path(os.getenv("COLLAGE_ROOT", "data/derived/collages"))
COLLAGE_CELL_W = int(os.getenv("COLLAGE_CELL_W", "512"))
COLLAGE_CELL_H = int(os.getenv("COLLAGE_CELL_H", "288"))
COLLAGE_JPEG_QUALITY = int(os.getenv("COLLAGE_JPEG_QUALITY", "95"))

ANALYSIS_MAX_WORKERS = int(os.getenv("ANALYSIS_MAX_WORKERS", "4"))
ANALYSIS_KEEP_LAST = int(os.getenv("ANALYSIS_KEEP_LAST", "200"))
FETCH_KEEP_LAST = int(os.getenv("FETCH_KEEP_LAST", "50"))

# Himawari-9 cloud tops, read from NOAA's open mirror of the raw instrument
# files. Band 13 (10.4 um) is thermal infrared: it works at night, when most of
# the city's convective rain arrives. R20 is the 2 km grid that band is
# distributed on; the resolution tag is part of the object key, so the two move
# together. The box is wider than the camera sample so panning off the city
# still shows cloud, and every extra degree of it costs bandwidth: a strip is
# ~3 MB compressed and the box currently spans one or two of them per scan.
HIMAWARI_BUCKET = os.getenv("HIMAWARI_BUCKET", "https://noaa-himawari9.s3.amazonaws.com/")
HIMAWARI_PREFIX = os.getenv("HIMAWARI_PREFIX", "AHI-L1b-FLDK")
HIMAWARI_SATELLITE = os.getenv("HIMAWARI_SATELLITE", "H09")
HIMAWARI_BAND = os.getenv("HIMAWARI_BAND", "B13")
HIMAWARI_RESOLUTION = os.getenv("HIMAWARI_RESOLUTION", "R20")
HIMAWARI_BBOX = tuple(  # south, west, north, east
    float(v) for v in os.getenv("HIMAWARI_BBOX", "9.7,105.6,11.9,107.8").split(",")
)
HIMAWARI_IMAGE_SIZE = int(os.getenv("HIMAWARI_IMAGE_SIZE", "512"))
# Every accepted size is a separate render-cache key, so an open range lets one
# caller cycle sizes, evict the cache and make the service pull strips from NOAA
# again for images it has already drawn. A short list bounds what can be asked
# for; the configured default is always servable.
HIMAWARI_IMAGE_SIZES = tuple(sorted({256, 512, 1024, HIMAWARI_IMAGE_SIZE}))
HIMAWARI_TIMEOUT_SEC = float(os.getenv("HIMAWARI_TIMEOUT_SEC", "60"))
# How far back the PNG endpoint will serve. The bucket holds years, and each
# miss is a multi-megabyte download, so a public endpoint should not accept an
# arbitrary date.
HIMAWARI_MAX_AGE_HOURS = float(os.getenv("HIMAWARI_MAX_AGE_HOURS", "6"))

# Start the camera sweep together with the service. The sweep runs as a daemon
# thread inside the uvicorn process, so every restart drops it silently: the map
# keeps serving the frames it already has and nothing reports that new ones
# stopped arriving. Off by default, so a test or a local run never sweeps the
# city's public camera site just by importing the app.
FETCH_AUTOSTART = os.getenv("FETCH_AUTOSTART", "").strip().lower() in {"1", "true", "yes", "on"}
