# Tests

Install `requirements-dev.txt`, then run:

```bash
.venv/bin/python -m unittest discover -s tests -v
node --check app/static/vrain.js
```

The tests use temporary gauge histories and an in-process FastAPI client. They
do not fetch camera images, call vision models, or modify the collected logs.

For a browser check, open `/rain-map`, enable **VRAIN gauge density**, disable
**Camera rain density**, select **3 hours**, and set the end to
**2026-09-14 15:30** (Vietnam time). With the September 14–16 log, 13 stations
show increases, including Củ Chi at 39.6 mm and Hóc Môn at 20.4 mm. Check the
blue field, gauge popups, period selector, layer toggles, and **Latest** button.
