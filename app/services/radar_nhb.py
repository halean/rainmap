"""Nha Be weather radar (HYMETNET), recoloured into the map's own rain classes.

HYMETNET -- the national hydro-meteorological observation centre, the same
source as the lightning feed (lightning_vn.py) -- publishes each of its radars
as a plain PNG every 10 minutes. Nha Be (station code NHB) is the one covering
Ho Chi Minh City, a few km south of the centre. Neither endpoint is documented;
both were found by watching the network tab of hymetnet.gov.vn/radar/NHB:

* the page itself lists the frames currently online, newest first, as
  `tentimesett[i] = "YYYYMMDDHHMM"` lines (UTC, ~2 hours of them);
* each frame is /dataout_web/NHB/<YYYYMMDD>/NHB_<stamp>_CMAX00.png, drawn by
  their page as an L.imageOverlay over IMAGE_BOUNDS (from their js/NHB.js).

CMAX is column-maximum reflectivity: the strongest echo anywhere above each
point, in dBZ, painted in the 5-dBZ bands of their legend (images/DBZ.jpg).
It is recoloured here rather than shown raw, for two reasons. The raw
palette's weak end (< 20 dBZ) is mostly clutter, beam artefacts and cloud
that never reaches the ground, and it covers most of the image. And the map's
camera pins speak in No / Light / Medium / Heavy -- showing the radar in the
same four words and colours lets the two be compared at a glance.

The site is plain http, which an https page may not load images from, so the
frames are fetched and recoloured server-side.
"""

import re
import time
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

import numpy as np
import requests
from PIL import Image

STATION = "NHB"
PAGE_URL = f"http://hymetnet.gov.vn/radar/{STATION}"
FRAME_URL = "http://hymetnet.gov.vn/dataout_web/{station}/{day}/{station}_{stamp}_CMAX00.png"
TIMEOUT_SEC = 20
STORE = Path("data/derived/radar_nhb")
RETENTION = timedelta(hours=48)
FRAMES_TTL_SEC = 60  # the list changes every 10 min; don't re-read their page per visitor
STAMP_RE = re.compile(r"^\d{12}$")
LIST_RE = re.compile(r'tentimesett\[\d+\]\s*=\s*"(\d{12})"')

# [[south, west], [north, east]], exactly as their own page places the image.
IMAGE_BOUNDS = [[7.950775596589935, 104.00516852724012], [13.34449996830115, 109.50019827090243]]
RADAR_SITE = (10.65961, 106.72833)

# Their legend, read off images/DBZ.jpg: every colour a frame uses, with the
# lower edge of its dBZ band. The labels skip 50, so orange spans 45-55.
LEGEND = {
    (102, 212, 251): 0,   # below 10
    (2, 109, 248): 10,
    (7, 69, 248): 15,
    (167, 250, 132): 20,
    (87, 250, 35): 25,
    (5, 224, 51): 30,
    (255, 216, 0): 35,
    (255, 166, 0): 40,
    (253, 129, 19): 45,   # 45-55
    (255, 28, 0): 55,
    (204, 0, 113): 60,
    (153, 0, 204): 65,
    (0, 0, 0): 70,        # above 70
}
MATCH_TOLERANCE = 12  # summed |RGB| distance; the frames are lossless PNG, this only absorbs rounding

# The map's rain classes (RAIN_COLORS in rain_map.html), by the lowest dBZ that
# earns each. Under 20 dBZ is left transparent, like "No" on the camera field.
CLASSES = (
    (40, "Heavy", (208, 59, 59)),
    (30, "Medium", (236, 131, 90)),
    (20, "Light", (250, 178, 25)),
)


class RadarUnavailable(Exception):
    pass


session = requests.Session()
session.headers.update({"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"})
_frames_cache = {"at": 0.0, "stamps": []}


def stamp_time(stamp):
    return datetime.strptime(stamp, "%Y%m%d%H%M").replace(tzinfo=timezone.utc)


def parse_frame_list(html):
    """Frame stamps listed on the station page, newest first, de-duplicated."""
    return list(dict.fromkeys(LIST_RE.findall(html)))


def available_frames():
    """Stamps currently online, newest first. Cached for FRAMES_TTL_SEC."""
    if time.monotonic() - _frames_cache["at"] < FRAMES_TTL_SEC and _frames_cache["stamps"]:
        return _frames_cache["stamps"]
    try:
        resp = session.get(PAGE_URL, timeout=TIMEOUT_SEC)
        resp.raise_for_status()
    except requests.RequestException as e:
        if _frames_cache["stamps"]:
            return _frames_cache["stamps"]  # a stale list beats none; frames themselves are immutable
        raise RadarUnavailable(f"HYMETNET radar page unavailable: {e}") from e
    stamps = parse_frame_list(resp.text)
    if not stamps:
        raise RadarUnavailable("HYMETNET radar page listed no frames")
    _frames_cache.update(at=time.monotonic(), stamps=stamps)
    return stamps


def class_for(dbz):
    for lowest, name, rgb in CLASSES:
        if dbz >= lowest:
            return name, rgb
    return None, None


def recolor(png_bytes):
    """Their CMAX frame -> an RGBA PNG in the map's classes, plus pixel counts.

    Colours are matched to the legend by nearest entry within MATCH_TOLERANCE;
    anything that matches nothing (a colour they add later, say) is dropped and
    counted rather than guessed at.
    """
    src = np.array(Image.open(BytesIO(png_bytes)).convert("RGBA"))
    opaque = src[..., 3] > 0
    rgb = src[..., :3].astype(np.int32)
    keys = (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]
    uniq, inverse = np.unique(keys[opaque], return_inverse=True)

    legend = np.array(list(LEGEND.keys()), dtype=np.int32)
    dbz_of = np.array(list(LEGEND.values()))
    out_colour = np.zeros((len(uniq), 4), np.uint8)
    counts = {"Light": 0, "Medium": 0, "Heavy": 0, "below_20dbz": 0, "unmatched": 0}
    per_colour = np.bincount(inverse, minlength=len(uniq))
    for i, key in enumerate(uniq):
        c = np.array([(key >> 16) & 255, (key >> 8) & 255, key & 255])
        dist = np.abs(legend - c).sum(axis=1)
        j = int(dist.argmin())
        if dist[j] > MATCH_TOLERANCE:
            counts["unmatched"] += int(per_colour[i])
            continue
        name, colour = class_for(dbz_of[j])
        if name is None:
            counts["below_20dbz"] += int(per_colour[i])
            continue
        out_colour[i] = (*colour, 255)
        counts[name] += int(per_colour[i])

    out = np.zeros_like(src)
    out[opaque] = out_colour[inverse]
    buf = BytesIO()
    Image.fromarray(out).save(buf, format="PNG", optimize=True)
    return buf.getvalue(), counts


def _prune():
    cutoff = datetime.now(timezone.utc) - RETENTION
    for f in STORE.glob("*.png"):
        try:
            if stamp_time(f.stem) < cutoff:
                f.unlink()
        except (ValueError, OSError):
            continue


def frame_png(stamp):
    """The recoloured frame for a stamp, from disk if already drawn.

    A published frame never changes, so each is fetched from HYMETNET once.
    """
    if not STAMP_RE.match(stamp or ""):
        raise ValueError("time must be YYYYMMDDHHMM (UTC)")
    path = STORE / f"{stamp}.png"
    if path.exists():
        return path.read_bytes()
    url = FRAME_URL.format(station=STATION, day=stamp[:8], stamp=stamp)
    try:
        resp = session.get(url, timeout=TIMEOUT_SEC)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise RadarUnavailable(f"HYMETNET radar frame unavailable: {e}") from e
    if "image" not in resp.headers.get("Content-Type", ""):
        raise RadarUnavailable("HYMETNET returned something other than an image")
    png, _counts = recolor(resp.content)
    STORE.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_bytes(png)
    tmp.replace(path)
    _prune()
    return png
