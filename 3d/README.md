# HCMC Rain Map · 3D

The 3D viewer is served at https://muaroi.dynv6.net/3d/ from
`/media/150G/rainmap/3d/`. The main `/rain-map` page links here.
Nginx serves these static files directly; weather requests use the existing
same-origin `/api/rain-map` routes. No separate 3D service is required.

The initial Central HCMC view looks through the falling rain. Camera density
refreshes every minute; VRAIN accumulation and Himawari cloud imagery refresh
every two minutes. The legend shares the 2D map's saved hide/show preference.

## What belongs in Git

Keep the viewer HTML/CSS/JavaScript, bundled `vendor/` runtime and its license,
this README, and `tools/` in Git. Generated `3d/assets/` (GLBs, manifest,
search/camera indexes and compressed feature records), `3d/build-cache/`,
`3d/.venv-build/` and downloaded OSM PBFs are ignored. Ignoring files leaves the
currently deployed assets on disk. A fresh checkout needs a build before the
3D map can load.

Source camera coordinates are already versioned at
`data/derived/camera_locations.json`. The builder uses the full coordinate list,
not the rotating live rain sample. Keep the source camera revision and OSM PBF
for reproducibility.

## Rebuild assets on the Oracle VM

Run from `/media/150G/rainmap`. Use Python **3.10 or newer**; the VM's default
`python3` is 3.8, while the existing service `.venv/bin/python` is 3.10.
Create a separate build environment; these commands do not install anything
into the service environment:

```sh
cd /media/150G/rainmap
.venv/bin/python -m venv 3d/.venv-build
3d/.venv-build/bin/python -m pip install -r 3d/tools/requirements.txt
mkdir -p 3d/build-cache
curl -L --fail --retry 3 \
  -o 3d/build-cache/vietnam-260918.osm.pbf \
  https://download.geofabrik.de/asia/vietnam-260918.osm.pbf
```

The deployed model used the 18 September 2026 extract. Verify that exact input:

```sh
printf '%s\n' 'c9809abbc9ea4c9be0be9823f09a1b1268abb86249040245a8ba193a8057231b  3d/build-cache/vietnam-260918.osm.pbf' | sha256sum -c -
```

Historical extracts may expire. If the URL is unavailable, use an archived copy
of that PBF for the same source, or download `vietnam-latest.osm.pbf` from the
same Geofabrik directory. For a different extract, pass its actual URL with
`--source-url` and expect different geometry/counts; do not apply the old hash.
The builder records the supplied URL and computes the PBF hash in the manifest.

Build into a new staging directory, then validate it before publishing:

```sh
build_stage="3d/build-cache/assets-$(date +%Y%m%d-%H%M%S)"
3d/.venv-build/bin/python -u 3d/tools/build.py \
  3d/build-cache/vietnam-260918.osm.pbf \
  --cameras data/derived/camera_locations.json \
  --source-url https://download.geofabrik.de/asia/vietnam-260918.osm.pbf \
  --output "$build_stage"
3d/.venv-build/bin/python 3d/tools/validate_models.py --assets "$build_stage"
```

Use the same shell for these commands so `build_stage` remains set. National
OSM parsing and mesh generation take several minutes and substantial memory;
allow space for the PBF, staging output and the previous assets. The deployed
snapshot has 504 tiles plus an overview, approximately 486 MB of GLB data.
The builder writes only inside the output directory. Validation checks GLB
structure, vertex data, manifest sizes, triangle winding and camera coverage.

After validation succeeds, publish during a quiet moment (the two renames
leave a brief gap for new asset requests). Keep the backup for rollback:

```sh
assets_backup="3d/build-cache/assets-previous-$(date +%Y%m%d-%H%M%S)"
if [ -d 3d/assets ]; then mv 3d/assets "$assets_backup"; fi
if ! mv "$build_stage" 3d/assets; then
  if [ -d "$assets_backup" ]; then mv "$assets_backup" 3d/assets; fi
  exit 1
fi
```

No FastAPI restart or Nginx reload is needed for updated static assets. Reload
`/3d/`, confirm Central HCMC loads detailed buildings, try street search, and
check the camera rain, gauge and cloud statuses. Weather service availability
is independent of the asset build.

## Coverage and accuracy

The original build covers the rectangle around 753 camera locations, padded
by 0.01 degrees: west 106.442713, south 10.632472, east 106.860624, north
10.998295. This is not the full municipal boundary. Source data is OpenStreetMap
via Geofabrik, © OpenStreetMap contributors, ODbL 1.0.

Models use metres, X east / Y up / Z south, relative to 106.65° E, 10.81° N.
Road widths and most building heights are estimated from OSM tags or defaults;
terrain is flat. The manifest documents the assumptions. The camera rain field
is spatial interpolation of ordinal readings, not measured mm/h. Cloud imagery
is shown at a schematic 2.5 km height, not a measured cloud altitude.

## Landmark models

Some landmarks are modelled rather than extruded, each from its OSM outline
and photographs, and each replaces its generic block when that block's tile
streams in (and in the skyline layer). Their notes, with sources and what is
approximate, are beside them:
- **Built on rectangles:** `notre-dame.js`, `ben-thanh.js` and
  `independence-palace.js`.
- **Built on outlines with `landmark-kit.js`:** `majestic.js`, `rex.js`,
  `opera-house.js`, `state-bank.js`, `post-office.js`, `city-hall.js`,
  `bitexco.js`, `landmark81.js`, `nha-rong.js`, `continental.js`,
  `city-museum.js`, `tan-dinh.js`, `jade-emperor.js`, `binh-tay.js` and
  `thien-hau.js`, listed in `LANDMARKS` in `viewer.js`.

Hồ Con Rùa is modelled at its mapped lake centre (`ho-con-rua.js`, see
[HO-CON-RUA.md](HO-CON-RUA.md)), with its five-pier tower, flared crown, basin
and footbridges. The **Hồ Con Rùa** button opens its camera view.

Twenty-one bridges -- Ba Son, Phú Mỹ, Thủ Thiêm, the Mống, the Bình Lợi
railway bridge, Sài Gòn 1 and 2, Khánh Hội, Ông Lãnh, Calmette, Nguyễn Văn
Cừ, Chữ Y, Tân Thuận 1 and 2, and over the Đồng Nai Nhơn Trạch, Đồng Nai
(old and new), Hóa An (old and new), Bửu Hòa and the Ghềnh railway bridge
-- are modelled in `bridges.js` (see `BRIDGES.md`) in
place of the generic flat ribbons.

The North-South railway and its yards, which the generic model leaves out,
are drawn by `railway.js` (see `RAILWAY.md`); Metro Line 1 by `metro.js`.

A Princess 60 motor yacht lies at the Vinhomes Central Park Marina below
Landmark 81, with sunbathers aboard (`yacht.js`, see `YACHT.md`).

The open-top tour bus runs the Red Route on its timetable (`opentour.js`, see
`OPENTOUR.md`); the **Open tour** button follows one.

The two yachts from the Vinhomes marina circle the Saigon River continuously
at 35 knots (`rivertour.js`, see `RIVERTOUR.md`); the **River tour** button
follows one.

Along the river tour, 27 riverfront towers are modelled in detail -- every
floor and bay, ~100k triangles each, built only near the camera
(`riverfront.js`, see `RIVERFRONT.md`).

Bitexco was missing from the generic model (only its podium was there), and
Landmark 81 was a slab over its whole site. The flag now stands on Landmark
81's modelled spire.

Landmarks with a flagpole (the palace, the Rex, the Post Office, City Hall,
Bitexco, the City Museum and Bình Tây) return its top in `flags`; the viewer
hangs one flag on each with `createFlagSet` in `flag.js`. They share the
tower flag's texture (the yellow star on red), turn downwind by the same
METAR poll, and wave -- a travelling wave growing towards the fly end, at a
rate set by the wind at their height -- only when the camera is within about
250-450 m, staying flat and costing nothing further away.

## Persistent skyline

`assets/skyline.glb` keeps building roofs and walls reaching at least 40 m
visible across the city. It reuses geometry and heights from the detailed
models, including Landmark 81. Each skyline section hides only when its
corresponding detailed tile is loaded and visible, avoiding doubled surfaces.
The Buildings toggle controls both layers. The central view faces northeast
toward Landmark 81. Missing OSM heights remain estimates; this layer does not
invent heights for buildings with incomplete source tags.

The full builder automatically generates the skyline and includes its size,
height threshold and tile coverage in the manifest. To regenerate it without
fetching or reparsing OSM, run from the repository root:

```sh
3d/.venv-build/bin/python 3d/tools/skyline.py
3d/.venv-build/bin/python 3d/tools/validate_models.py
```

For staged assets, pass `--assets "$build_stage"` to both commands. The skyline
is generated output under the already-ignored `3d/assets/` directory. The
original snapshot produces a roughly 1.5 MB skyline across 72 tiles.

## Flights at Tân Sơn Nhất

The **FLIGHTS · TÂN SƠN NHẤT** panel and the **Airport** view animate arrivals
and departures on the two runways, to the clock. `/api/rain-map/flights` (see
`app/services/flights.py`) serves three sources, none of which is a live
position feed:

- **Schedule: `scripts/tia_poller.py`**, a daemon that scrapes Tan Son
  Nhat's own live flight board at [tia.vietnamairport.vn](https://tia.vietnamairport.vn/) --
  the airport operator's official display, not a documented API. It is a
  Blazor Server app whose grid updates stream over a persistent WebSocket
  (so `networkidle` never fires and cannot be used to detect a loaded page),
  with six independently loadable pages: `{Arr,Dep}{Dom,VJ,Int}` for
  arrival/departure across three carrier groups (non-VietJet domestic,
  VietJet domestic, international). The terminal buttons visible on any one
  page just link between these six; they are not an in-page filter. The
  poller visits one page per minute round-robin -- the whole board refreshes
  every six minutes -- waits for the `#page` grid-page indicator to appear
  (the signal that the Kendo grid has actually rendered rows), reads the
  visible table, and merges normalized flights into
  `data/derived/flights_tia.json`, pruning anything not re-seen for
  `TIA_STALE_MINUTES` (default 14, just over one cycle). Run it alongside the
  web service:
  ```sh
  .venv/bin/python scripts/tia_poller.py
  ```
  It needs Playwright (`requirements.txt`) and a Chromium binary; on this
  ARM64 host, Playwright's own bundled download is unsupported, so it launches
  `/usr/bin/chromium-browser` (the system package) directly -- see
  `CHROMIUM_PATH` in the script if that differs on another host. Parsing is
  in `app/services/tia.py`, kept separate from the browser driving so it can
  be unit tested without one.
- **Wind: VVTS METAR** from aviationweather.gov, no key, refreshed every 30
  minutes. It chooses runway direction 07 or 25 by headwind; below 5 kt the
  viewer assumes 25. The board carries terminal, gate and belt, but not the
  physical runway.
- **Runway geometry: OurAirports** (public domain), copied into the service.

**When the poller isn't running, or the site can't be reached, the endpoint
serves a synthetic sample** labelled `SAMPLE` in amber, rather than showing a
frozen scrape as if it were current. No real flight number is ever invented,
and the panel says so.

Aircraft positions are **not tracked**. OpenSky, adsb.lol and adsb.fi showed no
ADS-B coverage within 250 nm of HCMC when checked in September 2026, so each
movement is animated along a schematic profile from its board time (its live
ETD/ETA when the board has one, otherwise STD/STA): a 3° final at about 140 kt
to a touchdown 450 m past the threshold, roll-out and taxi; or a 42-second
take-off roll, rotation and climb at 14 m/s. Departures are animated 15
minutes after their gate/estimated time, approximating taxi-out, since the
board gives no runway time. Arrivals are drawn on 07L/25R and departures on
07R/25L; this is an assumption, not the airport's published procedure.
Aircraft only animate while the view is centred within 5 km of the airport;
the runways themselves are always drawn.

The board's remarks (Vietnamese or English -- the display language itself
rotates) are mapped to a small status vocabulary in `app/services/tia.py`
(`Arrived`, `Delayed`, `GateClosed`, `Boarding`, `CheckIn`, ...) so the panel
reads the same regardless of which language happened to be showing when a row
was scraped. A heavily code-shared departure's flight-number cell is
sometimes visually truncated by the grid itself (e.g. `"AY 6252,EY7311,...,SQ"`
with no trailing number on the last code); the first code is kept as the
operating flight and the raw cell is kept alongside it.

## Lightning

The **Lightning** toggle under RAIN & CLOUDS (`3d/lightning.js`) animates
flashes over the camera field's own Medium/Heavy rain reports -- **off by
default, and labelled with a flashing-images warning**, since it is exactly
that: repeated bright flashes, which is a real photosensitivity concern.
Nothing about it is measured; it is a dramatisation of the existing rain
classification, not a lightning detection feed (no free one covering HCMC
was found). A second, independent **Thunder sound** toggle (also off by
default, and inert unless Lightning itself is on) adds synthesised audio --
no audio asset is fetched or shipped.

Flashes are placed over cameras reporting rain at or above
`STORM_MIN_CLASS` (currently 1, Light -- set for inspection; 2, Medium, is
the honest threshold, since Light rain rarely means convection). About
half of them (`SHEET_FRACTION`) are intracloud "sheet" lightning -- a
diffuse glow inside the cloud deck with no visible channel, which in a
tropical storm outnumbers cloud-to-ground flashes. The rest are strikes: a
branched channel from the cloud deck to one of the tallest buildings
within 1.5 km of a qualifying camera when one exists, weighted heavily
toward height (so Landmark 81 or Bitexco-scale towers get struck far more
often than a 40 m rooftop), and otherwise to the ground near the camera.
Candidate sites are also weighted toward the viewer (`viewWeight`: near
the camera and in front of it), because a flash 15 km behind the camera
is invisible and its thunder arrives most of a minute later at a whisper
-- the storm still flashes elsewhere, just rarely. After the toggle is
switched on the first flash comes within ~2 s; after that the storm's own
pacing applies, and the panel line counts down to the next one. Individual towers are recovered from `assets/skyline.glb` by
clustering its vertices on a 50 m ground grid and keeping each cell's apex
height, because the skyline mesh merges every tall building in a tile into
one buffer (`3d/tools/skyline.py` buckets by material per tile, not per
building) -- a one-time pass over ~60k vertices at load time.

**Channel.** `boltChannel` builds the path by midpoint displacement (split,
push the midpoint sideways by a fraction of the segment length, recurse),
which gives the multi-scale tortuosity of a real channel, plus side
branches that leave it partway down and die out in mid-air like a stepped
leader's. It is drawn as camera-facing ribbons -- a white core and a
blue-violet halo -- so it has luminous width rather than being a one-pixel
line; branches are thinner and only light with the first stroke.

**Strokes.** A flash is several return strokes down that one channel
(`makeStrokes`): 1-6 for a strike (about 15% are single), 2-5 pulses for a
sheet flash, ~35-115 ms apart, each cooling in ~40 ms; a later stroke is
often brighter than the one before it, and some are followed by a
continuing current that keeps the channel glowing dimly for up to a few
hundred ms. `brightnessAt` sums those curves and everything visible -- the
channel, its halo, the light on the city, the ambient boost and the sky
colour -- follows that one curve per frame, so they rise and cool together.

**Thunder** (`3d/thunder.js`, rendered in `thunder-worker.js` so the flash
never stutters, with an inline fallback) is synthesised from the channel's
geometry and the listener (the viewer's camera), not from a canned
envelope. Every part of the channel is a different distance away, so its
sound arrives at a different time: onset after the nearest part's travel
time at `SPEED_OF_SOUND` (349 m/s, warm humid air), then the rest rolling
in over the seconds it takes sound from the farther parts to arrive. The
channel is sampled every ~25 m (jittered, so a segment pointing at the
listener cannot form an arrival comb -- 25 m is a 72 ms step, a 14 Hz
machine-gun rate); each element adds a smooth, overlapping window into
three band envelopes (low, mid, high) at its arrival time, with amplitude
falling as 1/distance and weighted by how broadside the element is to the
line of sight (a line source radiates sideways, so parts crossing the view
are the claps), the highs fading fast with distance and the lows hardly at
all (air absorbs highs first: close thunder cracks, far thunder only
rumbles), and the window widening with distance and longest for the low
band (dispersion and scattering). Because the elements are dense and the
windows overlap, the envelopes are continuous -- they swell where arrivals
bunch up and sag between, but never break into separate hits.

Those envelopes shape continuous noise split into steep (24 dB/oct) bands
below ~150 Hz, ~150-500 Hz and above; a gentle 6 dB/oct split left so much
200-1000 Hz in the "low" band that it rattled. The bass band is kept broad
within the bass on purpose (a very narrow band flutters deeply and fast),
and a fast follower flattens the deep dips that any bass noise has of its
own -- the slow roll still comes from the envelopes, the grain is just held
steadier. Later strokes re-excite the channel, weaker and more smeared (a
sharp copy per stroke 35-115 ms apart would be burst fire); a slow
(~0.3-1.5 Hz) irregular modulation adds the uneven swell of a real roll.
The render is gently soft-clipped, its loudness eased off with distance
(only partly: fully physical falloff would leave most of the city
inaudible), panned to the side of the view the channel is on, and sent
through a diffuse synthetic city reverb (a dense cloud of small
reflections, deliberately not a few strong echoes -- reverberation also
smooths whatever pulsing is left). It is rendered at 16 kHz (`RENDER_RATE`;
nothing in thunder lives above a few kHz) and resampled by the
AudioContext. Every strike's thunder also includes hidden, roughly horizontal in-cloud
channels continuing from the top of the visible bolt (two arms, 1.5-4.5 km
each, in different directions, weighted up because that is where most of
a flash's charge is): without them a strike is a 2.5 km stick whose sound
all arrives within a second or two -- a boom, not a roll. A slow AGC on
the envelope keeps the roll within a few dB of the clap instead of a
dozen below it, and a decay (about 3.5 s to a third) then lets it taper
and end, so a strike's thunder is a clap and a 5-8 s rumble with irregular
swells (capped at 10 s) -- neither a drum hit nor a drone. A sheet flash's
thunder comes from the in-cloud channels alone, which is why it is a
lower, more delayed roll. The panel reports each flash's thunder delay and
distance, and `window.cityModel.lightning.lastThunder` carries the
numbers.

Busier storms flash more often -- roughly every 3-8 s at Heavy, 8-18 s at
Medium -- a pacing choice, not a real flash-rate figure.
`tests/lightning_audio.mjs` pins the thunder physics (onset, spread,
distance filtering, panning, bounds) and the audio-graph wiring;
`tests/lightning_sky.mjs` covers the stroke sequence and the flash timing;
neither needs a browser. See `tests/README.md`.
