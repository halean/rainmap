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
  collection; `app/services/vrain.py` reads this log for the gauge density layer.
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

## VRAIN gauge density

Enable **VRAIN gauge density** in the map legend. Choose 1, 3, 6, or 24 hours
of accumulation, or a historical end time in Vietnam time (UTC+7). **Latest**
returns to the most recent logged observation. The blue field interpolates
observed increases within 12 km of gauges; click a gauge for its amount and
coverage. The camera density can be toggled independently.

If Nginx restricts public paths, allow the JavaScript asset as well as the map
and gauge API. The deployed `muaroi.conf` includes this exact-file rule:

```nginx
location = /media/app/static/vrain.js {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Validate with `sudo nginx -t` before `sudo systemctl reload nginx`.

`GET /api/rain-map/vrain?hours=3` returns amounts, coverage, log freshness, and
reset evidence. Optional `at=2026-09-14T15:30:00%2B07:00` selects history.

### Reset inference from the September 14–16 logs

27 stations were sampled over roughly 48 hours. In Vietnam time:

| Date | Last poll before decrease | First poll after decrease | Stations decreasing |
| --- | --- | --- | --- |
| September 14 | 19:59:22 | 20:09:24 | 24 |
| September 15 | 20:00:40 | 20:10:41 | 11 |

This supports a daily reset around **20:00–20:10 ICT**, with two days of
evidence. Twelve stations also decreased at **09:08 on September 14**; that
did not repeat the next day and is treated as an unexplained correction.
Tiny floating-point changes are rounded away before detecting decreases.

The reader infers recurring reset hours from synchronized decreases at three
or more stations on at least two dates. It excludes the observed synchronized
decrease intervals, intervals overlapping 20:00–20:15 for the inferred daily
reset, individual decreases, and gaps over 25 minutes. It never adds a negative
change or interprets the new total after a reset as new rain. The same reset
evidence is used when viewing historical periods.

Amounts sum positive changes observed inside the selected period. Source
changes arrive roughly hourly, so the field represents recent accumulated
rain, not an instantaneous rain rate. Window-boundary intervals are excluded
instead of prorating unknown rainfall. Incomplete amounts are lower bounds;
zero means no observed increase, not proof of dry weather. Stale stations are
excluded from the field, and a stale overall log is labelled with its last
observation time. Reset inference remains provisional until more days accrue.

See [tests/README.md](tests/README.md) for automated and browser checks.
