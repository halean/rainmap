# Tests

Install `requirements-dev.txt`, then run:

```bash
.venv/bin/python -m unittest discover -s tests -v
node --check app/static/vrain.js
node --check app/static/himawari.js
```

The 3D viewer modules are ES modules; Node only checks them under an `.mjs`
name (`cp 3d/flights.js /tmp/f.mjs && node --check /tmp/f.mjs`).

The tests use temporary gauge histories, a synthetic Himawari Standard Data
file, and an in-process FastAPI client. They do not fetch camera images, reach
the NOAA bucket, call vision models, or modify the collected logs.

For a browser check, open `/rain-map`, enable **VRAIN gauge density**, disable
**Camera rain density**, select **3 hours**, and set the end to
**2026-09-14 15:30** (Vietnam time). With the September 14–16 log, 13 stations
show increases, including Củ Chi at 39.6 mm and Hóc Môn at 20.4 mm. Check the
blue field, gauge popups, period selector, layer toggles, and **Latest** button.

For the satellite layer, enable **Satellite cloud tops (Himawari-9)**. It
should draw within a few seconds -- the first scan of a process downloads a
strip more than it needs, to read the grid geometry out of a real file -- and
report a scan time within about 25 minutes of now in Vietnam time. Check that
the colour key matches the image, that the basemap's roads and labels stay
readable underneath, and that toggling off removes the overlay. To see it in
weather worth looking at, compare a cold violet patch against the cameras
under it: the cameras will not always agree, and that is the layer working as
described rather than failing.

For the airport animation, open `/3d/`, click **Airport**, and zoom in on the
runways. Without `scripts/tia_poller.py` running (or before its first fresh
scrape) the panel says **SAMPLE SCHEDULE** and an amber-labelled aircraft
lands or takes off every four minutes (arrivals on the northern runway,
departures on the southern). With the poller running, the list shows real
flight numbers, terminal/gate/belt and remark, "estimated" or "scheduled"
next to each, and the status line shows the METAR wind and the runway
direction it chose. Check that aircraft disappear when the view moves away
from the airport and that toggling **Runway movements** off hides the
runways too.

For lightning and thunder (`tests/lightning_audio.mjs` also checks that
`3d/thunder.js` has no three.js/DOM references, since `thunder-worker.js`
imports it in a Web Worker), run:
```bash
node --loader ./tests/three-loader.mjs tests/lightning_audio.mjs
node --loader ./tests/three-loader.mjs tests/lightning_sky.mjs
```

For the flight animation's minimum time separation (the live board rounds to
5-minute marks, so several flights of the same kind often share one
published time; without separation they'd animate exactly on top of each
other on their one assumed runway):
```bash
node --loader ./tests/three-loader.mjs tests/flights_anim.mjs
```
(`three-loader.mjs` redirects the bare `three` import to the vendored copy
and forces ESM for `3d/*.js`, since Node otherwise treats a plain `.js` file
as CommonJS.) In the browser, the **Lightning** checkbox under RAIN & CLOUDS
is off by default and carries a flashing-images warning; it must be checked
before anything strikes, regardless of rain. With it on and a camera
reporting rain (any class while `STORM_MIN_CLASS` is 1), the first flash
should come within ~2 s, then every few seconds to tens of seconds -- more
often at Heavy -- mostly in front of and near the camera, with the panel
line counting down to the next one; the whole sky should visibly lift in
the same instant the bolt appears, not a moment later. A strike should read
as several return strokes down one branched channel, with the branches only
lit by the first (check `window.cityModel.lightning.lastFlashCount` and
`lastFlashKind`: `sheet`, `ground` or `building`); about half of the flashes
are diffuse in-cloud sheet flashes with no channel. A strike near a tall
building (check `lastTarget.building`) should hit its rooftop rather than
the ground. Turning Lightning off mid-flash should clear it instantly, not
fade out. **Thunder sound** is a second, independent opt-in (needs Lightning
on to ever fire). It is synthesised from the bolt and your viewpoint, so:
it arrives only after the sound's travel time from the channel (the panel
line under the toggle says how long, and `lastThunder` carries the numbers
-- from the default Central HCMC view that is typically 6-9 s, which is
correct, not a bug); a strike close to the camera cracks sharply while a
distant one only rumbles; it rolls for as long as the channel's near-to-far
spread; it pans to the side the channel is on; and no two sound alike,
because no two channels or viewpoints are.

For the real sun/moon and its water reflection:
```bash
node --loader ./tests/three-loader.mjs tests/sky_astronomy.mjs
node --loader ./tests/three-loader.mjs tests/sky_render.mjs
```
In the browser, `window.cityModel.sky` reports which body is up, its real
altitude/azimuth, and the moon's illuminated fraction/phase -- cross-check
against an actual almanac for today's date rather than eyeballing it. Only
one body renders at a time; its on-screen height is capped near the
horizon regardless of true altitude (see `DISPLAY_ALTITUDE_CAP` in
`3d/sky-render.js`), since the default camera presets look down at street
level rather than at the sky.

For double-clicking a high-rise to teleport to its roof (`tests/highrise_teleport.mjs`
covers `tallBuildings()`'s clustering and `nearestHighrise()`'s snap-radius
matching directly, without a browser):
```bash
node --loader ./tests/three-loader.mjs tests/highrise_teleport.mjs
```
In the browser, double-click a tall building (roughly 40 m+; skyline.py's
`minimum_height`) in either the overview or a loaded detail tile. The
camera should re-centre near its rooftop, at a similar distance/angle to
the other preset views, not jump to an unrelated spot. Double-clicking open
ground, a low building, or empty sky should do nothing -- no snapping to a
distant tower just because it was the closest thing found.

For the flag on Landmark 81 (`3d/flag.js`, cloth solver in `3d/cloth.js`) and
the Metro Line 1 layer (`3d/metro.js`: timetable running and the demo fallback):

```sh
node --loader ./tests/three-loader.mjs tests/flag.mjs
node --loader ./tests/three-loader.mjs tests/cloth.mjs
node --loader ./tests/three-loader.mjs tests/flag_cloth.mjs
node --loader ./tests/three-loader.mjs tests/metro_demo.mjs
node --loader ./tests/three-loader.mjs tests/metro_timetable.mjs
.venv/bin/python -m unittest tests.test_metro_timetable
.venv/bin/python -m unittest tests.test_pilot_plan   # port pilot plan parser
```

For the Independence Palace (`3d/independence-palace.js`, see `3d/INDEPENDENCE-PALACE.md`):
```sh
node --loader ./tests/three-loader.mjs tests/independence_palace.mjs
```

For the landmarks built on OSM outlines with `3d/landmark-kit.js` (the Majestic, the Rex, the Opera House, the State Bank, the Post Office, City Hall, Bitexco, Landmark 81, Nhà Rồng, the Continental, the City Museum, Tân Định Church, the Jade Emperor Pagoda, Bình Tây Market and the Thiên Hậu Temple):
```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
