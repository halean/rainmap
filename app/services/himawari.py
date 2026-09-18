"""Himawari-9 cloud-top temperature, decoded from NOAA's raw instrument files.

The `noaa-himawari9` bucket publishes Himawari Standard Data, not map tiles:
one bz2-compressed binary per band per 10-minute full-disk scan, cut into ten
latitude strips. Drawing a map layer from it therefore means fetching only the
strips that cover the city, calibrating counts to brightness temperature with
the coefficients each file carries in its own header, and resampling the
geostationary grid onto the Web Mercator box Leaflet draws an overlay in.

Band 13 (10.4 um thermal infrared) is the band worth plotting here: it reads
cloud-top temperature day and night, and the coldest tops are the deep
convection that produces the city's rain. It measures cloud, not rain -- a
cold top over a dry street is entirely possible, and the layer is labelled as
cloud on the map for that reason.
"""

import bz2
import math
import struct
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from io import BytesIO

import numpy as np
import requests
from PIL import Image

from app.config import (
    HIMAWARI_BAND,
    HIMAWARI_BBOX,
    HIMAWARI_BUCKET,
    HIMAWARI_IMAGE_SIZE,
    HIMAWARI_IMAGE_SIZES,
    HIMAWARI_MAX_AGE_HOURS,
    HIMAWARI_PREFIX,
    HIMAWARI_RESOLUTION,
    HIMAWARI_SATELLITE,
    HIMAWARI_TIMEOUT_SEC,
)

UTC = timezone.utc
SCAN_INTERVAL = timedelta(minutes=10)
HEADER_BLOCKS = 11
# A scan reaches the bucket a few minutes after the instrument finishes it, and
# its strips land one at a time, so the newest slot is routinely still filling.
MAX_SLOTS_BACK = 6

# Enhanced-infrared ramp, in kelvin. Tops warmer than the first stop stay fully
# transparent: this layer exists for deep convection, and shading every last
# shallow cloud would bury the camera field underneath it. Violet and magenta
# keep it clear of the amber-to-red camera field and the blue gauge field.
CLOUD_STOPS = (
    (273.0, (148, 163, 184), 0),
    (262.0, (100, 116, 139), 45),
    (250.0, (71, 85, 105), 110),
    (240.0, (67, 56, 202), 175),
    (230.0, (124, 58, 237), 205),
    (220.0, (192, 38, 211), 225),
    (205.0, (245, 208, 254), 235),
)


class HimawariUnavailable(RuntimeError):
    """The bucket held no usable scan for the requested time."""


@dataclass(frozen=True)
class Header:
    """The fields this module needs out of an HSD file's 11 header blocks."""

    columns: int
    lines: int
    sub_lon: float
    cfac: int
    lfac: int
    coff: float
    loff: float
    rs: float
    req: float
    rpol: float
    band: int
    wavelength: float
    valid_bits: int
    gain: float
    constant: float
    rad_to_bt: tuple[float, float, float]
    light_speed: float
    planck: float
    boltzmann: float
    total_segments: int
    segment: int
    first_line: int


@dataclass(frozen=True)
class Scene:
    """One rendered scan: the PNG plus what the map needs to describe it."""

    scan: datetime
    size: int
    png: bytes
    bounds: tuple[float, float, float, float]
    coldest_k: float | None
    median_k: float | None
    coverage: float
    segments: tuple[int, ...]


def _parse(raw: bytes) -> tuple[Header, np.ndarray]:
    """Read an uncompressed HSD file. The header blocks are walked by the
    length each one declares rather than by fixed offsets, so a file that
    carries a longer optional block still lands on the right fields."""
    offsets, cursor = {}, 0
    for _ in range(HEADER_BLOCKS):
        number, length = struct.unpack_from("<BH", raw, cursor)
        offsets[number] = cursor + 3
        cursor += length
    if set(offsets) != set(range(1, HEADER_BLOCKS + 1)):
        raise ValueError(f"unexpected HSD header blocks: {sorted(offsets)}")

    bits, columns, lines = struct.unpack_from("<HHH", raw, offsets[2])
    if bits != 16:
        raise ValueError(f"expected 16-bit pixels, file declares {bits}")
    sub_lon, cfac, lfac, coff, loff, rs, req, rpol = struct.unpack_from(
        "<dIIffddd", raw, offsets[3]
    )
    calibration = "<HdHHHdd"
    band, wavelength, valid_bits, _err, _outside, gain, constant = struct.unpack_from(
        calibration, raw, offsets[5]
    )
    infrared = offsets[5] + struct.calcsize(calibration)
    c0, c1, c2 = struct.unpack_from("<3d", raw, infrared)
    light_speed, planck, boltzmann = struct.unpack_from("<3d", raw, infrared + 6 * 8)
    total_segments, segment, first_line = struct.unpack_from("<BBH", raw, offsets[7])

    pixels = columns * lines
    expected = cursor + pixels * 2
    if len(raw) != expected:
        raise ValueError(f"HSD file is {len(raw)} bytes, header implies {expected}")
    counts = np.frombuffer(raw, dtype="<u2", count=pixels, offset=cursor).reshape(lines, columns)
    return (
        Header(
            columns=columns,
            lines=lines,
            sub_lon=sub_lon,
            cfac=cfac,
            lfac=lfac,
            coff=coff,
            loff=loff,
            rs=rs,
            req=req,
            rpol=rpol,
            band=band,
            wavelength=wavelength,
            valid_bits=valid_bits,
            gain=gain,
            constant=constant,
            rad_to_bt=(c0, c1, c2),
            light_speed=light_speed,
            planck=planck,
            boltzmann=boltzmann,
            total_segments=total_segments,
            segment=segment,
            first_line=first_line,
        ),
        counts,
    )


def _forward(header: Header, lat, lon):
    """Geographic degrees to the instrument's (column, line), by the CGMS
    normalized geostationary projection, plus a mask of the points that face
    the satellite at all. Column and line are 1-based, as the format counts."""
    lat, lon = np.radians(lat), np.radians(lon)
    flattening = header.rpol**2 / header.req**2
    geocentric = np.arctan(flattening * np.tan(lat))
    radius = header.rpol / np.sqrt(1 - (1 - flattening) * np.cos(geocentric) ** 2)
    offset = lon - math.radians(header.sub_lon)

    r1 = header.rs - radius * np.cos(geocentric) * np.cos(offset)
    r2 = -radius * np.cos(geocentric) * np.sin(offset)
    r3 = radius * np.sin(geocentric)
    # The point faces the satellite when the line of sight meets it before the
    # limb; the far side of the disk projects onto valid-looking pixels without
    # this test.
    visible = r1 * (header.rs - r1) > r2**2 + r3**2

    norm = np.sqrt(r1**2 + r2**2 + r3**2)
    x = np.degrees(np.arctan2(-r2, r1))
    y = np.degrees(np.arcsin(np.clip(-r3 / norm, -1.0, 1.0)))
    column = header.coff + x * header.cfac / 65536.0
    line = header.loff + y * header.lfac / 65536.0
    return column, line, visible


def brightness_temperature(header: Header, counts: np.ndarray) -> np.ndarray:
    """Calibrate raw counts to kelvin, NaN where the file has no measurement.

    Counts convert to radiance by the file's own linear gain, then to an
    effective temperature by inverting Planck's law, then to brightness
    temperature by the file's quadratic correction.
    """
    valid = counts < (1 << header.valid_bits)
    radiance = header.gain * counts.astype(np.float64) + header.constant
    # Gain is negative in the infrared -- high counts are cold. Radiance at or
    # below zero has no temperature, so it drops out with the flagged pixels.
    valid &= radiance > 0

    wavelength = header.wavelength * 1e-6
    hc = header.planck * header.light_speed
    with np.errstate(divide="ignore", invalid="ignore"):
        # Radiance is stored per micrometre; Planck's law here wants per metre.
        spectral = np.where(valid, radiance, 1.0) * 1e6
        effective = (hc / (header.boltzmann * wavelength)) / np.log1p(
            2 * header.planck * header.light_speed**2 / (spectral * wavelength**5)
        )
    c0, c1, c2 = header.rad_to_bt
    kelvin = c0 + c1 * effective + c2 * effective**2
    return np.where(valid, kelvin, np.nan)


def _url(key: str) -> str:
    return f"{HIMAWARI_BUCKET.rstrip('/')}/{key}"


def _key(slot: datetime, segment: int) -> str:
    """The bucket's object key. The trailing 10 in the segment field is the
    number of strips a full-disk scan is cut into, not part of the index."""
    return (
        f"{HIMAWARI_PREFIX}/{slot:%Y/%m/%d/%H%M}/"
        f"HS_{HIMAWARI_SATELLITE}_{slot:%Y%m%d_%H%M}_{HIMAWARI_BAND}"
        f"_FLDK_{HIMAWARI_RESOLUTION}_S{segment:02d}10.DAT.bz2"
    )


def _exists(key: str) -> bool:
    return requests.head(_url(key), timeout=HIMAWARI_TIMEOUT_SEC).status_code == 200


# Scratch space for building a frame, not a result cache. A strip is ~6 MB
# decompressed, and once a scan has been rendered its strips are never wanted
# again -- the finished PNG is 100x smaller and answers the same request. So
# this stays small on purpose and `render` below is the cache that grows.
@lru_cache(maxsize=3)
def _segment(slot: datetime, segment: int) -> tuple[Header, np.ndarray]:
    """One decoded strip, held only long enough to draw the scans that need it."""
    response = requests.get(_url(_key(slot, segment)), timeout=HIMAWARI_TIMEOUT_SEC)
    response.raise_for_status()
    return _parse(bz2.decompress(response.content))


_SEGMENT_INDEX: dict[tuple, tuple[int, ...]] = {}


def _segments_for_bbox(slot: datetime) -> tuple[int, ...]:
    """Which strips cover the bounding box.

    Read off a real file's own projection block rather than from grid constants
    copied out of the product spec, then cached: the full-disk geometry is
    identical for every scan of a given band, so this costs one extra strip
    download per process.
    """
    index = (HIMAWARI_BAND, HIMAWARI_RESOLUTION, HIMAWARI_BBOX)
    if index not in _SEGMENT_INDEX:
        header, _ = _segment(slot, 1)
        south, west, north, east = HIMAWARI_BBOX
        lat = np.linspace(south, north, 64)[:, None]
        lon = np.linspace(west, east, 64)[None, :]
        _, line, visible = _forward(header, lat, lon)
        if not visible.any():
            raise HimawariUnavailable("the bounding box is not on the satellite's disk")
        lines = np.rint(line[visible]).astype(int)
        first = max(1, (int(lines.min()) - 1) // header.lines + 1)
        last = min(header.total_segments, (int(lines.max()) - 1) // header.lines + 1)
        _SEGMENT_INDEX[index] = tuple(range(first, last + 1))
    return _SEGMENT_INDEX[index]


def floor_to_scan(when: datetime) -> datetime:
    return when.astimezone(UTC).replace(
        minute=when.astimezone(UTC).minute // 10 * 10, second=0, microsecond=0
    )


_RESOLVED: tuple[datetime, datetime, tuple[int, ...]] | None = None
# A scan only changes every ten minutes, so re-probing the bucket for every
# browser that asks would spend requests to learn the same answer.
RESOLVE_CACHE = timedelta(seconds=60)


def resolve_scan(now: datetime | None = None) -> tuple[datetime, tuple[int, ...]]:
    """The newest scan whose strips are all in the bucket."""
    global _RESOLVED
    now = now or datetime.now(UTC)
    if _RESOLVED is not None and timedelta(0) <= now - _RESOLVED[0] < RESOLVE_CACHE:
        return _RESOLVED[1], _RESOLVED[2]
    slot = floor_to_scan(now)
    for _ in range(MAX_SLOTS_BACK):
        if _exists(_key(slot, 1)):
            segments = _segments_for_bbox(slot)
            if all(_exists(_key(slot, segment)) for segment in segments):
                _RESOLVED = (now, slot, segments)
                return slot, segments
        slot -= SCAN_INTERVAL
    raise HimawariUnavailable(
        f"no complete {HIMAWARI_BAND} scan in the {MAX_SLOTS_BACK * 10} minutes before "
        f"{floor_to_scan(now):%Y-%m-%d %H:%M} UTC"
    )


def sample_bbox(parts, size: int) -> np.ndarray:
    """Kelvin on a Web Mercator grid over the bounding box, NaN off the strips.

    Sampling in Mercator rather than plate carree is what lets Leaflet place
    the result with a plain image overlay, the way the gauge field is placed.
    """
    south, west, north, east = HIMAWARI_BBOX
    mercator = lambda deg: math.log(math.tan(math.pi / 4 + math.radians(deg) / 2))  # noqa: E731
    top, bottom = mercator(north), mercator(south)
    rows = top + (bottom - top) * (np.arange(size) + 0.5) / size
    lat = np.degrees(2 * np.arctan(np.exp(rows)) - math.pi / 2)[:, None]
    lon = (west + (east - west) * (np.arange(size) + 0.5) / size)[None, :]

    header = parts[0][0]
    column, line, visible = _forward(header, lat, lon)
    columns = np.rint(column).astype(np.int64)
    lines = np.rint(line).astype(np.int64)

    kelvin = np.full((size, size), np.nan)
    for strip, counts in parts:
        on_strip = (
            visible
            & (lines >= strip.first_line)
            & (lines < strip.first_line + strip.lines)
            & (columns >= 1)
            & (columns <= strip.columns)
        )
        if not on_strip.any():
            continue
        taken = counts[lines[on_strip] - strip.first_line, columns[on_strip] - 1]
        kelvin[on_strip] = brightness_temperature(strip, taken)
    return kelvin


def colorize(kelvin: np.ndarray) -> np.ndarray:
    """The infrared ramp as RGBA. Warm tops and missing data are transparent."""
    stops = list(reversed(CLOUD_STOPS))  # np.interp wants ascending temperatures
    knots = [stop[0] for stop in stops]
    clamped = np.clip(np.nan_to_num(kelvin, nan=knots[-1]), knots[0], knots[-1])
    rgba = np.zeros((*kelvin.shape, 4), dtype=np.uint8)
    for channel in range(3):
        rgba[..., channel] = np.rint(
            np.interp(clamped, knots, [stop[1][channel] for stop in stops])
        )
    alpha = np.interp(clamped, knots, [stop[2] for stop in stops])
    rgba[..., 3] = np.rint(np.where(np.isnan(kelvin), 0, alpha))
    return rgba


# Big enough to hold every (scan, size) the image endpoint will serve, so a
# caller cycling scan stamps finds finished PNGs in memory rather than making
# the service fetch from NOAA again. Derived from the window rather than fixed,
# so widening the window cannot quietly reopen that. At ~57 KB a PNG this is a
# few megabytes; the strips behind them would have been hundreds.
RENDER_CACHE = max(8, int(HIMAWARI_MAX_AGE_HOURS * 6) * len(HIMAWARI_IMAGE_SIZES))


@lru_cache(maxsize=RENDER_CACHE)
def render(slot: datetime, segments: tuple[int, ...], size: int) -> Scene:
    parts = [_segment(slot, segment) for segment in segments]
    kelvin = sample_bbox(parts, size)
    measured = kelvin[~np.isnan(kelvin)]
    png = BytesIO()
    Image.fromarray(colorize(kelvin), "RGBA").save(png, format="PNG", optimize=True)
    return Scene(
        scan=slot,
        size=size,
        png=png.getvalue(),
        bounds=HIMAWARI_BBOX,
        coldest_k=round(float(measured.min()), 1) if measured.size else None,
        median_k=round(float(np.median(measured)), 1) if measured.size else None,
        coverage=round(float(measured.size / kelvin.size), 3),
        segments=segments,
    )


def latest_scene(size: int | None = None) -> Scene:
    slot, segments = resolve_scan()
    return render(slot, segments, size or HIMAWARI_IMAGE_SIZE)


def scene_at(slot: datetime, size: int | None = None) -> Scene:
    return render(slot, _segments_for_bbox(slot), size or HIMAWARI_IMAGE_SIZE)
