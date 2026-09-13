# HCMC Rain Map

Live rain-intensity map of Ho Chi Minh City, read off the city's public
traffic-camera feed by a vision model, plotted on real OpenStreetMap tiles
with a real-radar (RainViewer) comparison layer.

## How it works

- **`app/`** -- a small FastAPI service. `/rain-map` serves the map page;
  `/api/rain-map` serves the current readings as JSON; `/api/jobs/start`
  and `/api/jobs/stop` control the camera-image fetch sweep.
- **`scripts/rain_annotator.py`** -- watches the sampled cameras for fresh
  frames and asks Gemma (via Google's free Gemma API tier) to read rain
  intensity off each one. Rate-limited to a fixed daily API budget
  regardless of how fast the source site responds.
- **`scripts/camera_watchdog.py`** -- periodically health-checks the
  sampled cameras directly against the traffic-camera site and swaps out
  any that fail consistently (3+ consecutive checks) for a live
  replacement, picked to preserve spatial spacing across the city.
- **`scripts/vrain_poller.py`** -- records nearby VRAIN rain-gauge readings
  (vrain.vn) every 10 minutes into `data/derived/vrain_history.csv`. Pure
  collection: nothing reads it yet. Intended as measured ground truth to score
  the vision model's readings against later -- see `NOTES.md`.
- **`data/derived/`** -- small JSON/CSV state: camera coordinates (fetched
  from the traffic system's own coordinate API), the current 40-camera
  sample, and the live rain readings.
- **`data/raw/`** -- downloaded camera snapshots (gitignored, regenerated
  by the fetch job).

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in GOOGLE_API_KEY
```

## Run

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000 &
python scripts/rain_annotator.py &
python scripts/camera_watchdog.py &
python scripts/vrain_poller.py &
curl -X POST http://127.0.0.1:8000/api/jobs/start
```

Then open `http://localhost:8000/rain-map`.
