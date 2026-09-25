# HCMC Rain Map

Live rain-intensity map of Ho Chi Minh City, read off the city's public
traffic-camera feed by a vision model, plotted on real OpenStreetMap tiles
with a real-radar (RainViewer) comparison layer, rain-gauge readings, and
satellite cloud tops decoded straight from Himawari-9's raw instrument files.

## How it works

- **`app/`** -- a small FastAPI service. `/rain-map` serves the map page;
  `/api/rain-map` serves the current readings as JSON; `/api/jobs/start`
  and `/api/jobs/stop` control the camera-image fetch sweep.
- **`scripts/rain_annotator.py`** -- watches the sampled cameras for fresh
  frames and asks Gemma (via Google's free Gemma API tier) to read rain
  intensity off each one. Rate-limited to a fixed daily API budget
  regardless of how fast the source site responds.
- **`scripts/camera_watchdog.py`** -- periodically health-checks the
  sampled cameras directly against the traffic-camera site and rotates out
  any that fail consistently (3+ consecutive checks), or that the site has
  served only its offline placeholder for 30+ minutes, for the nearest live
  camera to the same slot, so spatial spacing across the city holds. A check
  where most cameras simply don't answer is treated as a site outage and not
  held against the cameras; blocklisted cameras get another chance after 3 h.
- **`app/services/himawari.py`** -- decodes Himawari-9 band 13 cloud-top
  temperature from NOAA's open mirror of the raw satellite files and renders
  it as a map overlay. Fetched on demand, not polled.
- **`scripts/himawari_poller.py`** -- draws a satellite frame every 10 minutes
  into `data/derived/himawari/` and prunes past the retention window, so a
  recent span can be replayed. A history only exists if each scan was drawn
  while it was current, which is the whole reason this polls rather than
  waiting to be asked.
- **`scripts/vrain_poller.py`** -- records nearby VRAIN rain-gauge readings
  (vrain.vn) every 10 minutes into `data/derived/vrain_history.csv`. Pure
  collection; `app/services/vrain.py` reads this log for the gauge density layer.
- **`scripts/hymetnet_poller.py`** -- records Vietnam's official lightning
  feed (`hymetnet.gov.vn`, the national hydro-meteorological observation
  centre's own public map, reverse-engineered the same way as VRAIN and the
  TIA flight board -- see `app/services/lightning_vn.py`) every 3 minutes,
  from two complementary, undocumented sources on the same site:
  - `GET http://hymetnet.gov.vn/dongset` -- commune-level (a few km, named
    places), into `data/derived/lightning_vn_history.csv`.
  - A plain `GET` of `http://hymetnet.gov.vn/lightningmaps/` itself --
    exact coordinates, second, peak current (kA), sensor count, DOF, and
    ground/cloud classification, embedded directly in the page's HTML as
    `set[N] = [{...}];` literals rather than fetched separately, into
    `data/derived/lightning_vn_strikes_history.csv`.

  Neither source has HTTPS on this host (both are plain HTTP). Pure
  collection for now -- nothing reads this yet; the 3D map's lightning
  layer still dramatises from camera rain reports rather than this real
  feed.
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
python scripts/himawari_poller.py &
curl -X POST http://127.0.0.1:8000/api/jobs/start   # or set FETCH_AUTOSTART=1
```

Then open `http://localhost:8000/rain-map`.

The camera sweep runs as a daemon thread inside the service process, so it stops
whenever that process does and nothing says so: the map keeps serving the frames
it already has while no new ones arrive. `FETCH_AUTOSTART=1` starts the sweep
with the service, so a restart picks it back up. It is off unless set, because a
test or a local run should not sweep the city's public camera site merely by
importing the app. Starting it twice is harmless -- the second start is refused
and logged, not an error.

Nothing else here is supervised: the service and the three scripts above are
whatever you started by hand, so a crash or a reboot needs starting them again.

## VRAIN gauge density

Enable **VRAIN gauge density** in the map legend. Choose 1, 3, 6, or 24 hours
of accumulation, or a historical end time in Vietnam time (UTC+7). **Latest**
returns to the most recent logged observation. The blue field interpolates
observed increases within 12 km of gauges; click a gauge for its amount and
coverage. The camera density can be toggled independently.

If Nginx restricts public paths, allow each layer's JavaScript asset as well
as the map and the layer APIs. `/api/rain-map` already covers every layer's
API, but a static asset needs a rule of its own, and the deployed
`muaroi.conf` names each one rather than opening `/media/app/static/`:

```nginx
location = /media/app/static/vrain.js {
    alias /media/150G/rainmap/app/static/vrain.js;
    add_header Cache-Control "no-cache";   # revalidate per load (ETag/304)
}
```

Adding a layer therefore means adding a rule. Until one exists the script
404s, the page loads without it, and the layer is simply absent from the
legend rather than visibly broken. Validate with `sudo nginx -t` before
`sudo systemctl reload nginx`.

### Caching and who does what

Every viewer polls the same handful of URLs whose data changes every 1-10
minutes, so the split is: Python computes a response once, **nginx** serves
it to everyone for a short while, browsers hold static things for longer.

- **API microcache.** `/api/rain-map*` and `/rain-map` are cached by nginx
  (`conf.d/rainmap-cache.conf` defines the store under
  `/var/cache/nginx/rainmap`; the `location` blocks in `muaroi.conf` use
  it): 20 s for API responses, 10 s for the page, GET only, keyed on the
  full URL so `?hours=`/`?at=`/`?camera_id=` variants are separate.
  `proxy_cache_lock` lets one request refresh while the rest are served
  the cached or stale copy, so a crowd never stampedes the backend, and an
  upstream `Cache-Control` (the immutable Himawari PNG) overrides the
  default. The `X-Cache` response header says `HIT`/`MISS`/`STALE`. With
  this in place the backend answers roughly once per URL per 20 s
  regardless of how many people are watching.
- **Camera frames** (`/media/data/raw/`) are served by nginx straight from
  disk with `alias` -- no cache directory involved -- and marked
  `immutable` for a year, since each filename is a unique capture time and
  a frame never changes once written. Python no longer serves image bytes,
  and the page no longer appends a cache-buster to them.
- **Per-camera history** (`/api/rain-map/rain-history`) reads the annotator's
  small per-camera index (`data/derived/recent/`, see
  `app/services/recent.py`) rather than scanning `rain_history.csv`, so its
  cost no longer grows with the archive; the microcache covers it too.

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

## Satellite cloud tops

Enable **Satellite (Himawari-9)** in the map legend. There is no band to pick:
the sun decides what the layer is made of.

**By day** the visible band (band 3, 0.64 um reflected sunlight, 0.5 km) is
drawn as greyscale cloud texture with the infrared cold-top ramp composited
over it. **After dark** the visible band sees nothing, so only the infrared
remains (band 13, 10.4 um, 2 km). The switch happens at
`HIMAWARI_MIN_SUN_DEG` of solar elevation over the city, computed locally --
below it, nothing is fetched.

Both bands are drawn in daylight rather than the visible one alone, because
they are not two resolutions of the same measurement. Reflected light is how
thick a cloud is; emitted heat is how high it reached. Through afternoon
convection those agree closely -- over one 14:30 scan, r = -0.93 between albedo
and brightness temperature, with 165 disagreeing pixels out of 262,144. On a
09:30 scan of thick low cloud that collapses to r = -0.34 and 3.7% of the box
reads bright-but-warm: a warm stratus deck that the visible band alone paints
as though it were a storm. Infrared costs 6 MB a scan against the visible
band's 65 MB, so keeping it is nearly free and removes that failure entirely.

The band set is chosen from the *scan's* timestamp, not the clock, so a pinned
image URL renders the same picture whenever it is fetched and can be cached as
immutable.

Neither band measures rain. A cold top, or a bright deck, over a dry street is
entirely possible, and reflected light cannot tell low stratus from a
thunderstorm at all. This is context for the camera readings, not a second
opinion on them.

`noaa-himawari9` publishes Himawari Standard Data rather than map tiles: one
bz2-compressed binary per band per 10-minute full-disk scan, cut into ten
latitude strips of about 3 MB each.

```
AHI-L1b-FLDK/2026/09/18/1910/HS_H09_20260918_1910_B13_FLDK_R20_S0410.DAT.bz2
             ^date  ^scan                  ^band  ^2 km   ^strip 4 of 10
```

Serving a layer from that means, per scan: find the newest scan whose strips
have all landed (the newest directory in the bucket is routinely still
filling), download only the strips `HIMAWARI_BBOX` crosses -- currently one or
two -- calibrate counts to brightness temperature with the coefficients each
file carries in its own header, and resample the geostationary grid into the
Web Mercator box Leaflet draws an image overlay in. Rendered scans and decoded
strips are cached in the process, so the ten minutes until the next scan cost
nothing further.

Bands are declared in `HIMAWARI_BANDS`, each with the grid it ships on and its
kind. The kind decides how the file is *read*, not just how it is drawn: a
visible file carries its radiance-to-albedo factor at the byte offset an
infrared file uses for Planck coefficients, so reading one as the other returns
temperatures in the tens of millions, which clamp to transparent and draw a
blank layer with no error anywhere. `HIMAWARI_BAND` sets the default.

### Collecting a replay window

`scripts/himawari_poller.py` keeps `HIMAWARI_RETENTION_HOURS` (12 by default)
of rendered frames on disk. `GET /api/rain-map/himawari/frames` lists them
oldest-first with an image URL each -- the window an animation would step
through. Without the poller running it is simply empty: 08:20 cannot be
reconstructed at noon.

What it costs, measured rather than estimated. A daylight scan is a 71 MB fetch
and ~20 s to decode and draw; a night scan is 6 MB. At 144 scans a day:

| `HIMAWARI_POLL` | Collected | Per day |
| --- | --- | --- |
| `auto` (default) | every scan, visible band in daylight | ~5.0 GB |
| `infrared` | every scan, infrared only | ~0.86 GB |
| `off` | nothing; the layer stays on-demand | 0 |

The visible band is 83% of that. Dropping it costs the daylight texture but not
the band that identifies convection, and the city's storms peak after dark when
visible is blank anyway. The bytes are inbound on an open NOAA dataset built
for bulk access; the frames themselves are a few hundred KB, so twelve hours is
tens of megabytes. The cost is the fetching, not the keeping.

A collected frame is served from disk without touching NOAA, and stays servable
even once it is older than `HIMAWARI_MAX_AGE_HOURS` -- that limit exists to stop
a stranger making the service download arbitrary old scans, and a frame already
drawn costs nothing.

`GET /api/rain-map/himawari` returns the newest scan's time, bounds, colour
scale, coldest top, and the URL of its image. `GET /api/rain-map/himawari.png`
takes a `scan` stamp (`202609181940`, UTC, on the 10-minute grid) so each image
caches against the scan it belongs to; it serves only the last
`HIMAWARI_MAX_AGE_HOURS` of scans, because every miss is a fresh multi-megabyte
download from NOAA even though the bucket itself reaches back to 2022.

The projection was checked against a midday scene over Indochina, where warm
land against cool sea traced the coastline at Hong Kong, Da Nang, and Borneo.

See [tests/README.md](tests/README.md) for automated and browser checks.

## 3D rain map

The [3D map](https://muaroi.dynv6.net/3d/) is served from `3d/` and uses the
same weather APIs as the main map. Generated model assets are excluded from
Git and must be rebuilt after a fresh checkout. See [3D asset rebuild instructions](3d/README.md)
for the isolated Python environment, source OSM/camera data, staged build,
validation and publishing commands.
