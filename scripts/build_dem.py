"""
Builds the terrain for the flood-risk map (/flood-risk): ground height, the river level at which
tidal water first reaches each cell, and the datum calibration that puts both on the Phu An tide
scale.

Run (needs rasterio and scikit-image, which the app itself does not):
    python -m venv /tmp/demenv && /tmp/demenv/bin/pip install rasterio scikit-image numpy pillow requests
    /tmp/demenv/bin/python scripts/build_dem.py [--source deltadtm|gedtm30]

Sources (both ~30 m, both bare earth -- buildings and trees removed):
- deltadtm (default): DeltaDTM v1.1 (Pronk et al., TU Delft, 2024), a coastal terrain model:
  Copernicus DEM corrected with ICESat-2 and GEDI lidar, made for exactly this -- low-lying
  coasts and deltas. Mean absolute error 0.45 m. Public domain. Shipped only inside a 17 GB
  zip per continent; the two HCMC tiles are read out of it with HTTP range requests (~10 MB).
- gedtm30: GEDTM30 v1.1 (OpenGeoHub, 2025-06), a global ensemble terrain model, CC-BY 4.0,
  read as a window of a 333 GB cloud-optimised GeoTIFF. Newer, but on 1 Oct 2026 it read
  2-3 m high over District 7's tidal-flood streets (median 4.8 m where the ground floods at
  1.6 m tides) and ~12 m over District 1 -- buildings not fully removed -- so it is kept only
  as a fallback.

Spill level: for each cell, the lowest water level in the connected river and sea system at
which water can flow to it over the ground. Computed as a morphological reconstruction by
erosion (sink filling) seeded from the sea and the river channels that run off the window's
edges. A cell floods at a tide T iff its spill level <= T -- so a low field behind a higher road
stays dry until the water tops the road, unlike a plain "below T" bathtub.

Datum: the model's heights are on EGM2008; Phu An's tide levels are on the Hon Dau national
datum. A 2026 study of the Mekong Delta put local sea level ~1.17 m (0.84-1.46) away from
EGM2008, and the terrain has its own bias besides, so rather than chain uncertain conversions
the offset is CALIBRATED: the streets the city lists as flooding at high tide take 0.1-0.3 m of
water when Phu An reads 1.6-1.77 m, so their spill level is set to CALIBRATION_REFERENCE_M on
the tide scale. The fit and its spread are written to the metadata and shown on the map.

Output, data/derived/dem/:
  hcmc_elevation.png, hcmc_spill.png   heights in decimetres + OFFSET, R high byte, G low byte,
                                       alpha 0 for open water. Rows resampled to equal Web Mercator
                                       spacing so a Leaflet image overlay lines up everywhere.
  hcmc_dem.json                        bounds, encoding, calibration, tide bands, method notes.
"""

import argparse
import io
import json
import math
import re
import unicodedata
import zipfile
from pathlib import Path

import numpy as np
import rasterio
import requests
from PIL import Image
from rasterio.merge import merge
from rasterio.windows import from_bounds
from skimage.morphology import reconstruction

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "data" / "derived" / "dem"
CACHE = OUT / "src"
# The camera network spans 10.64-10.99 N, 106.45-106.85 E; padded to take in the Can Gio coast,
# Nha Be and the Thu Duc hills. East stops at 107.0: DeltaDTM's N10E106/N11E106 tiles end there,
# and the strip beyond would read as open water.
WEST, SOUTH, EAST, NORTH = 106.35, 10.35, 107.00, 11.10
# DeltaDTM leaves water without a height -- sea, rivers, canals and ponds alike. Only water joined
# to the river system brings the tide in; a pond or quarry pit smaller than this (~0.8 km2) that
# does not touch the window's edge is given the height of its lowest shore instead.
MIN_WATER_CELLS = 1000
OFFSET = 10000  # decimetres; -1000 m .. +5553 m fits in 16 bits

DELTADTM_ZIP = "https://data.4tu.nl/file/1da2e70f-6c4d-4b03-86bd-b53e789cc629/672eba4c-1334-44c6-8119-8879ded25912"
DELTADTM_TILES = ["DeltaDTM_v1_1_N10E106.tif", "DeltaDTM_v1_1_N11E106.tif"]
GEDTM30 = ("https://s3.opengeohub.org/global/edtm/"
           "gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v20250611.tif")

# Tide scale: Phu An (Saigon River), Hon Dau datum. Alert levels BD I/II/III = 1.40/1.50/1.60 m;
# the 2025 peak was 1.77 m (6 Nov); tides passed BD I on 75 days of 2025.
CALIBRATION_REFERENCE_M = 1.50
TIDE_BANDS = [
    {"max_m": 1.40, "label": "Reached at ordinary spring tides (≤ 1.40 m, alert I)"},
    {"max_m": 1.60, "label": "Reached at alert II–III tides (≤ 1.60 m)"},
    {"max_m": 1.80, "label": "Reached at record tides (≤ 1.80 m; 2025 peak 1.77 m)"},
    {"max_m": 2.30, "label": "Reached at a record tide + 0.5 m (rain on a high tide, surge, subsidence, sea-level rise)"},
]
# Hollows: land lower than every way out of it, so water collects. At 0.3 m a third of all cameras
# sat in one (30 m cells are noisy); 0.5 m keeps 3% of the land. Even so it is a weak guide to rain
# flooding: of the four streets the flood watch saw flood on 1 Oct, two sat in shallow hollows and
# two in none -- those floods are drains overwhelmed, which no terrain model sees.
HOLLOW_MIN_M = 0.5

# Streets on the city's tidal-flood list (So Xay dung, 2025; Tuoi Tre, Nov 2025), matched to the
# cameras that stand on them.
TIDAL_STREETS = ["tran xuan soan", "huynh tan phat", "pham huu lau", "nguyen van huong", "binh quoi",
                 "le van luong", "dao su tich", "nguyen binh -", "thao dien"]


def merc_y(lat):
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


class RangeFile(io.RawIOBase):
    """A remote file read by HTTP range requests, checked byte for byte: one short or mislabelled
    response is enough to corrupt a zip member, and 4TU refuses connections after a burst of
    small requests, so reads are few and large."""

    def __init__(self, url):
        self.s = requests.Session()
        self.url = url
        r = self.s.get(url, headers={"Range": "bytes=0-0"}, allow_redirects=True, timeout=60)
        self.size = int(r.headers["Content-Range"].split("/")[-1])
        self.pos = 0

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def readinto(self, b):
        if self.pos >= self.size:
            return 0
        n = min(len(b), self.size - self.pos)
        end = self.pos + n - 1
        for _ in range(5):
            r = self.s.get(self.url, headers={"Range": f"bytes={self.pos}-{end}"}, allow_redirects=True, timeout=180)
            if r.status_code == 206 and r.headers.get("Content-Range", "").startswith(f"bytes {self.pos}-{end}/") \
                    and len(r.content) == n:
                break
        else:
            raise IOError(f"range {self.pos}-{end} failed")
        b[:n] = r.content
        self.pos += n
        return n


def fetch_deltadtm() -> list[Path]:
    # Tiles fetched by hand (scripts/fetch_deltadtm_tiles.py, from a machine 4TU still serves) may
    # be dropped next to the output instead of in src/; use them wherever they are.
    CACHE.mkdir(parents=True, exist_ok=True)
    paths = [OUT / t if (OUT / t).exists() else CACHE / t for t in DELTADTM_TILES]
    missing = [p for p in paths if not p.exists()]
    if missing:
        z = zipfile.ZipFile(io.BufferedReader(RangeFile(DELTADTM_ZIP), buffer_size=16 << 20))
        for p in missing:
            p.write_bytes(z.read(p.name))  # zipfile checks the CRC
    return paths


def read_window(source: str):
    """Heights in metres (float32, NaN = open water) and the window's (west, north, dx, dy)."""
    if source == "gedtm30":
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
            with rasterio.open("/vsicurl/" + GEDTM30) as ds:
                win = from_bounds(WEST, SOUTH, EAST, NORTH, ds.transform).round_offsets().round_lengths()
                a = ds.read(1, window=win).astype(np.float32)
                t = ds.window_transform(win)
                nodata = ds.nodata
        a[a == nodata] = np.nan
        a /= 10.0  # stored in decimetres
    else:
        srcs = [rasterio.open(p) for p in fetch_deltadtm()]
        a, t = merge(srcs, bounds=(WEST, SOUTH, EAST, NORTH))
        nodata = srcs[0].nodata
        a = a[0].astype(np.float32)
        if nodata is not None:
            a[a == nodata] = np.nan
        for s in srcs:
            s.close()
    return a, (t.c, t.f, t.a, t.e)


def connected_water(h: np.ndarray) -> np.ndarray:
    """Fill small isolated water bodies in place (lowest shore height); return the mask of the
    water that stays: the sea, the rivers and the canals joined to them."""
    from scipy import ndimage
    water = np.isnan(h)
    labels, n = ndimage.label(water, structure=np.ones((3, 3)))
    sizes = np.bincount(labels.ravel())
    edge_ids = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    keep = sizes >= MIN_WATER_CELLS
    keep[edge_ids] = True
    keep[0] = False
    small = water & ~keep[labels]
    if small.any():
        # Each land cell next to a small water body takes that body's label; the minimum height
        # over those cells is the body's lowest shore.
        near = ndimage.grey_dilation(np.where(small, labels, 0), size=3)
        shore = np.where(~water & (near > 0), near, 0)
        ids = np.unique(shore[shore > 0])
        lowest = dict(zip(ids, ndimage.minimum(np.nan_to_num(h), labels=shore, index=ids)))
        fill = np.vectorize(lambda i: lowest.get(i, np.nan), otypes=[np.float32])
        h[small] = fill(labels[small])
    return water & keep[labels]


def spill_levels(h: np.ndarray, water: np.ndarray) -> np.ndarray:
    """Sink-filled heights seeded from the connected water and river channels at the window edge."""
    land = h[~water & np.isfinite(h)]
    floor = float(np.nanmin(land)) - 1.0
    z = np.where(water | np.isnan(h), floor, h)
    seed = np.full_like(z, z.max())
    # Only connected water is a source. The rivers leaving the window (Saigon, Dong Nai, Vam Co)
    # are themselves water in DeltaDTM and touch the edge, so no land cell is seeded -- a rice
    # field on the edge must not count as a source of its own.
    seed[water] = floor
    return reconstruction(seed, z, method="erosion").astype(np.float32)


def norm(s):
    s = unicodedata.normalize("NFD", s or "").replace("đ", "d").replace("Đ", "D")
    return re.sub(r"[̀-ͯ]", "", s).lower()


def sample(grid, west, north, dx, dy, lat, lon, r=2):
    i, j = int((lat - north) / dy), int((lon - west) / dx)
    w = grid[max(i - r, 0):i + r + 1, max(j - r, 0):j + r + 1]
    return float(np.nanmedian(w)) if np.isfinite(w).any() else float("nan")


def calibrate(h, spill, geo):
    """Offset (model metres - tide metres) from the tidal-flood streets' cameras."""
    cams = json.loads((REPO / "data" / "derived" / "camera_locations.json").read_text())
    tidal = [c for c in cams if any(k in norm(c["display_name"]) for k in TIDAL_STREETS)]
    v = np.array([sample(spill, *geo, c["lat"], c["lon"]) for c in tidal])
    v = v[np.isfinite(v)]
    offset = float(np.median(v)) - CALIBRATION_REFERENCE_M
    return offset, {"cameras": int(v.size), "reference_m": CALIBRATION_REFERENCE_M,
                    "spill_p25_m": round(float(np.percentile(v, 25)) - offset, 2),
                    "spill_p75_m": round(float(np.percentile(v, 75)) - offset, 2)}


def pack(grid, path):
    valid = np.isfinite(grid)
    v = np.where(valid, np.round(grid * 10) + OFFSET, 0).astype(np.uint16)
    rgba = np.zeros(grid.shape + (4,), np.uint8)
    rgba[..., 0] = v >> 8
    rgba[..., 1] = v & 255
    rgba[..., 3] = np.where(valid, 255, 0)
    Image.fromarray(rgba, "RGBA").save(path, optimize=True)


def to_mercator_rows(grid, north, south):
    rows = grid.shape[0]
    yn, ys = merc_y(north), merc_y(south)
    lat = np.degrees(2 * np.arctan(np.exp(yn + (ys - yn) * (np.arange(rows) + 0.5) / rows)) - np.pi / 2)
    src = np.clip(((north - lat) / (north - south) * rows).astype(int), 0, rows - 1)
    return grid[src]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["deltadtm", "gedtm30"], default="deltadtm")
    args = ap.parse_args()

    h, geo = read_window(args.source)
    west, north, dx, dy = geo
    rows, cols = h.shape
    south, east = north + dy * rows, west + dx * cols
    water = connected_water(h)
    spill = spill_levels(h, water)
    spill[water] = np.nan
    h[water] = np.nan
    offset, fit = calibrate(h, spill, geo)

    OUT.mkdir(parents=True, exist_ok=True)
    pack(to_mercator_rows(h, north, south), OUT / "hcmc_elevation.png")
    pack(to_mercator_rows(spill, north, south), OUT / "hcmc_spill.png")

    lat_mid = math.radians((north + south) / 2)
    cell_area = abs(dy) * 111320 * abs(dx) * 111320 * math.cos(lat_mid)
    src = {
        "deltadtm": ("DeltaDTM v1.1 (TU Delft, 2024), 30 m coastal bare-earth terrain, public domain",
                     "https://doi.org/10.4121/21997565"),
        "gedtm30": ("GEDTM30 v1.1 (OpenGeoHub, 2025), 30 m bare-earth terrain, CC-BY 4.0", GEDTM30),
    }[args.source]
    tide_spill = spill - offset
    land = np.isfinite(tide_spill)
    shares = {b["max_m"]: round(float(np.mean(tide_spill[land] <= b["max_m"]) * 100), 1) for b in TIDE_BANDS}
    meta = {
        "bounds": [[south, west], [north, east]],
        "width": cols, "height": rows, "rows": "web-mercator",
        "cell_area_m2": round(cell_area, 1),
        "encoding": {"unit": "dm", "offset": OFFSET, "value": "R*256+G - offset", "nodata": "alpha 0"},
        "source": src[0], "source_url": src[1],
        "source_short": f'<a href="{src[1]}" target="_blank" rel="noopener">{src[0].split(",")[0]}</a>',
        "datum": {"offset_m": round(offset, 3),
                  "meaning": "model height - offset = height on the Phu An tide scale (Hon Dau datum)",
                  "calibration": fit},
        "tide": {"station": "Phu An (Saigon River)", "datum": "Hon Dau", "bands": TIDE_BANDS,
                 "alert_levels_m": {"I": 1.40, "II": 1.50, "III": 1.60}, "record_2025_m": 1.77,
                 "days_over_alert1_2025": 75, "share_of_land_reached_pct": shares},
        "hollow_min_m": HOLLOW_MIN_M,
        "method_html": (
            f"Ground heights from {src[0]}. Colours show the <b>spill level</b>: the lowest Phú An tide at "
            "which water from the rivers and sea can flow to a spot over the ground, so a low field behind "
            "a higher road stays dry until the road is topped. Heights are moved onto the tide scale by "
            f"calibrating against the {fit['cameras']} cameras on the city's tidal-flood streets, which take "
            f"0.1–0.3 m of water at 1.6–1.77 m tides (offset {offset:+.2f} m; those streets' spill levels "
            f"then span {fit['spill_p25_m']:.2f}–{fit['spill_p75_m']:.2f} m, middle half). "
            f"Purple marks hollows at least {HOLLOW_MIN_M:.1f} m deep, where water collects; it is a weak guide "
            "to rain flooding, which mostly comes from drains overwhelmed, not from the shape of the ground. "
            "<br><br>What it misses: dikes, riverside walls and tide gates narrower than ~30 m; drains and "
            "pumps; rain on top of the tide; land sinking since the terrain was measured (up to several cm a "
            "year in parts of the city). A 30 m cell averages a whole block, so one street can sit a few "
            "decimetres off. Read it as where tidal water is <i>able</i> to reach, not a forecast."),
    }
    (OUT / "hcmc_dem.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    print(f"{args.source}: {cols}x{rows}, offset {offset:+.2f} m (tidal cameras n={fit['cameras']}, "
          f"spill IQR {fit['spill_p25_m']:.2f}..{fit['spill_p75_m']:.2f} m); land reached by band: {shares}")


if __name__ == "__main__":
    main()
