# Tests

Install `requirements-dev.txt`, then run:

```bash
.venv/bin/python -m unittest discover -s tests -v
node --check app/static/vrain.js
node --check app/static/himawari.js
```

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
