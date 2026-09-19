"""Himawari-9 cloud-top temperature, decoded from NOAA's raw instrument files.

The `noaa-himawari9` bucket publishes Himawari Standard Data, not map tiles:
one bz2-compressed binary per band per 10-minute full-disk scan, cut into ten
latitude strips. Drawing a map layer from it therefore means fetching only the
strips that cover the city, calibrating counts to brightness temperature with
the coefficients each file carries in its own header, and resampling the
geostationary grid onto the Web Mercator box Leaflet draws an overlay in.

Two bands are drawn. Band 13 (10.4 um thermal infrared) reads cloud-top
temperature day and night, and the coldest tops are the deep convection that
produces the city's rain. Band 3 (0.64 um visible) is four times finer and
resolves individual convective towers, but it only sees reflected sunlight, so
it is blank at night and cannot tell a bright low deck from a thunderstorm.

Both measure cloud, not rain -- a cold top over a dry street is entirely
possible, and the layer is labelled as cloud on the map for that reason.

The bands are not interchangeable at the file level either: a visible file
carries its albedo coefficient at the byte offset an infrared file uses for
Planck coefficients, so each kind is calibrated by its own path.
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
    HIMAWARI_BANDS,
    HIMAWARI_BBOX,
    HIMAWARI_BUCKET,
    HIMAWARI_IMAGE_SIZE,
    HIMAWARI_IMAGE_SIZES,
    HIMAWARI_MAX_AGE_HOURS,
    HIMAWARI_MIN_SUN_DEG,
    HIMAWARI_PREFIX,
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


# Visible imagery in albedo, as greyscale rather than white-on-transparent.
# An all-white ramp is nearly invisible over a pale basemap -- the first version
# of this drew the cloud correctly and you could not see it. So thin cloud is
# grey and darkens the map, thick cloud goes white, and only genuinely clear
# ground stays transparent. That is also how a visible satellite image reads.
VISIBLE_STOPS = (
    (0.06, (120, 130, 145), 0),
    (0.14, (126, 136, 150), 80),
    (0.28, (168, 176, 188), 160),
    (0.45, (219, 224, 231), 210),
    (0.70, (255, 255, 255), 242),
)

# Bands 7-16 are the thermal infrared ones; 1-6 are visible and near-infrared.
INFRARED_BANDS = range(7, 17)


def band_kind(band: str) -> str:
    return HIMAWARI_BANDS[band]["kind"]


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
    # Exactly one of these is set, decided by the band: infrared files carry the
    # Planck coefficients, visible files carry the radiance-to-albedo factor.
    rad_to_bt: tuple[float, float, float] | None
    light_speed: float | None
    planck: float | None
    boltzmann: float | None
    albedo_factor: float | None
    total_segments: int
    segment: int
    first_line: int


@dataclass(frozen=True)
class Scene:
    """One rendered scan: the PNG plus what the map needs to describe it."""

    scan: datetime
    size: int
    # Drawn bottom-up: ((band, strips), ...). One band at night, two by day.
    plan: tuple[tuple[str, tuple[int, ...]], ...]
    png: bytes
    bounds: tuple[float, float, float, float]
    coldest_k: float | None
    brightest_albedo: float | None
    coverage: float

    @property
    def bands(self) -> tuple[str, ...]:
        return tuple(band for band, _ in self.plan)

    @property
    def mode(self) -> str:
        return "daylight" if len(self.plan) > 1 else "night"


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
    # Same offset, different meaning. An infrared file continues with the Planck
    # coefficients; a visible file continues with c', the factor turning radiance
    # into albedo, followed by its calibration date and an updated gain pair.
    # Reading one as the other does not fail -- it returns nonsense, so the band
    # decides which is read.
    tail = offsets[5] + struct.calcsize(calibration)
    if band in INFRARED_BANDS:
        rad_to_bt = struct.unpack_from("<3d", raw, tail)
        light_speed, planck, boltzmann = struct.unpack_from("<3d", raw, tail + 6 * 8)
        albedo_factor = None
    else:
        rad_to_bt = light_speed = planck = boltzmann = None
        albedo_factor = struct.unpack_from("<d", raw, tail)[0]
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
            rad_to_bt=rad_to_bt,
            light_speed=light_speed,
            planck=planck,
            boltzmann=boltzmann,
            albedo_factor=albedo_factor,
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


def reflectance(header: Header, counts: np.ndarray) -> np.ndarray:
    """Calibrate raw counts to albedo, NaN where the file has no measurement.

    Albedo here is the instrument's reflectance factor, not corrected for solar
    angle, so it runs a little past 1.0 on the brightest tops. That is fine for
    drawing: the ramp saturates well below it.
    """
    valid = counts < (1 << header.valid_bits)
    radiance = header.gain * counts.astype(np.float64) + header.constant
    return np.where(valid, header.albedo_factor * radiance, np.nan)


def physical(header: Header, counts: np.ndarray) -> np.ndarray:
    """Counts to the quantity this band actually measures."""
    if header.band in INFRARED_BANDS:
        return brightness_temperature(header, counts)
    return reflectance(header, counts)


def _url(key: str) -> str:
    return f"{HIMAWARI_BUCKET.rstrip('/')}/{key}"


def _key(slot: datetime, segment: int, band: str = HIMAWARI_BAND) -> str:
    """The bucket's object key. The trailing 10 in the segment field is the
    number of strips a full-disk scan is cut into, not part of the index."""
    return (
        f"{HIMAWARI_PREFIX}/{slot:%Y/%m/%d/%H%M}/"
        f"HS_{HIMAWARI_SATELLITE}_{slot:%Y%m%d_%H%M}_{band}"
        f"_FLDK_{HIMAWARI_BANDS[band]['resolution']}_S{segment:02d}10.DAT.bz2"
    )


def _exists(key: str) -> bool:
    return requests.head(_url(key), timeout=HIMAWARI_TIMEOUT_SEC).status_code == 200


# Scratch space for building a frame, not a result cache. A strip is ~6 MB
# decompressed, and once a scan has been rendered its strips are never wanted
# again -- the finished PNG is 100x smaller and answers the same request. So
# this stays small on purpose and `render` below is the cache that grows.
@lru_cache(maxsize=3)
def _segment(slot: datetime, segment: int, band: str = HIMAWARI_BAND) -> tuple[Header, np.ndarray]:
    """One decoded strip, held only long enough to draw the scans that need it."""
    response = requests.get(_url(_key(slot, segment, band)), timeout=HIMAWARI_TIMEOUT_SEC)
    response.raise_for_status()
    return _parse(bz2.decompress(response.content))


_SEGMENT_INDEX: dict[tuple, tuple[int, ...]] = {}


def _segments_for_bbox(slot: datetime, band: str = HIMAWARI_BAND) -> tuple[int, ...]:
    """Which strips cover the bounding box.

    Read off a real file's own projection block rather than from grid constants
    copied out of the product spec, then cached: the full-disk geometry is
    identical for every scan of a given band, so this costs one extra strip
    download per process.
    """
    index = (band, HIMAWARI_BANDS[band]["resolution"], HIMAWARI_BBOX)
    if index not in _SEGMENT_INDEX:
        header, _ = _segment(slot, 1, band)
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


_RESOLVED: dict[tuple[str, ...], tuple[datetime, datetime, tuple]] = {}
# A scan only changes every ten minutes, so re-probing the bucket for every
# browser that asks would spend requests to learn the same answer.
RESOLVE_CACHE = timedelta(seconds=60)


def bands_for(when: datetime) -> tuple[str, ...]:
    """Which bands to draw for a scan taken at `when`.

    Decided from the scan's own timestamp rather than from the clock, so a
    pinned image URL renders the same thing forever and can be cached as
    immutable. Visible goes first: it is the greyscale base, and the infrared
    cold-top ramp is composited over it.

    Both, in daylight, because they are not the same measurement. Reflected
    light is cloud thickness; emitted heat is cloud height. Through afternoon
    convection the two agree closely (r = -0.93 over one scan), but on a morning
    of thick low cloud that collapses to -0.34, and visible alone paints a warm
    stratus deck as though it were a storm. Infrared costs 6 MB against
    visible's 65, so keeping it is nearly free and removes that failure.
    """
    return ("B03", "B13") if is_lit("B03", when) else ("B13",)


def resolve_plan(now: datetime | None = None,
                 bands: tuple[str, ...] | None = None
                 ) -> tuple[datetime, tuple[tuple[str, tuple[int, ...]], ...]]:
    """The newest scan where every band we intend to draw has fully landed."""
    now = now or datetime.now(UTC)
    bands = bands or bands_for(now)
    cached = _RESOLVED.get(bands)
    if cached is not None and timedelta(0) <= now - cached[0] < RESOLVE_CACHE:
        return cached[1], cached[2]
    slot = floor_to_scan(now)
    for _ in range(MAX_SLOTS_BACK):
        plan = []
        for band in bands:
            # Strip 1 is the cheap probe; the rest are only checked if it exists.
            if not _exists(_key(slot, 1, band)):
                break
            segments = _segments_for_bbox(slot, band)
            if not all(_exists(_key(slot, segment, band)) for segment in segments):
                break
            plan.append((band, segments))
        else:
            _RESOLVED[bands] = (now, slot, tuple(plan))
            return slot, tuple(plan)
        slot -= SCAN_INTERVAL
    raise HimawariUnavailable(
        f"no complete {'+'.join(bands)} scan in the {MAX_SLOTS_BACK * 10} minutes "
        f"before {floor_to_scan(now):%Y-%m-%d %H:%M} UTC"
    )


def resolve_scan(now: datetime | None = None,
                 band: str = HIMAWARI_BAND) -> tuple[datetime, tuple[int, ...]]:
    """One band's newest complete scan."""
    slot, plan = resolve_plan(now, (band,))
    return slot, plan[0][1]


def sample_bbox(parts, size: int) -> np.ndarray:
    """The band's own quantity on a Web Mercator grid, NaN off the strips.

    Kelvin for infrared, albedo for visible -- `physical` decides from the
    header, so the caller never has to know which band it asked for.

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

    values = np.full((size, size), np.nan)
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
        values[on_strip] = physical(strip, taken)
    return values


def colorize(values: np.ndarray, band: str = HIMAWARI_BAND) -> np.ndarray:
    """The band's ramp as RGBA. Missing data is always transparent, and so is
    the clear end of each scale -- warm tops in the infrared, dark ground in
    the visible."""
    stops = CLOUD_STOPS if band_kind(band) == "infrared" else VISIBLE_STOPS
    # np.interp needs ascending knots; the infrared table descends in kelvin.
    stops = sorted(stops, key=lambda stop: stop[0])
    knots = [stop[0] for stop in stops]
    # Missing data is parked on whichever end of this ramp is fully transparent.
    clear = knots[-1] if stops[-1][2] == 0 else knots[0]
    clamped = np.clip(np.nan_to_num(values, nan=clear), knots[0], knots[-1])
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    for channel in range(3):
        rgba[..., channel] = np.rint(
            np.interp(clamped, knots, [stop[1][channel] for stop in stops])
        )
    alpha = np.interp(clamped, knots, [stop[2] for stop in stops])
    rgba[..., 3] = np.rint(np.where(np.isnan(values), 0, alpha))
    return rgba


# Big enough to hold every (scan, size) the image endpoint will serve, so a
# caller cycling scan stamps finds finished PNGs in memory rather than making
# the service fetch from NOAA again. Derived from the window rather than fixed,
# so widening the window cannot quietly reopen that. At ~57 KB a PNG this is a
# few megabytes; the strips behind them would have been hundreds.
RENDER_CACHE = max(8, int(HIMAWARI_MAX_AGE_HOURS * 6) * len(HIMAWARI_IMAGE_SIZES))


@lru_cache(maxsize=RENDER_CACHE)
def render(slot: datetime, plan: tuple[tuple[str, tuple[int, ...]], ...], size: int) -> Scene:
    """Draw the plan's bands into one image, bottom band first.

    Compositing here rather than in the browser keeps it a single request and a
    single cached PNG, and means the layer's appearance does not depend on two
    images arriving together.
    """
    canvas = None
    coldest = brightest = coverage = None
    for band, segments in plan:
        values = sample_bbox([_segment(slot, seg, band) for seg in segments], size)
        measured = values[~np.isnan(values)]
        if band_kind(band) == "infrared":
            coldest = float(measured.min()) if measured.size else None
            # Coverage is reported from the infrared layer: it is the one always
            # drawn, and the one whose absence would mean an empty map.
            coverage = round(float(measured.size / values.size), 3)
        elif measured.size:
            brightest = float(measured.max())
        layer = Image.fromarray(colorize(values, band), "RGBA")
        canvas = layer if canvas is None else Image.alpha_composite(canvas, layer)

    png = BytesIO()
    canvas.save(png, format="PNG", optimize=True)
    return Scene(
        scan=slot,
        size=size,
        plan=plan,
        png=png.getvalue(),
        bounds=HIMAWARI_BBOX,
        coldest_k=round(coldest, 1) if coldest is not None else None,
        brightest_albedo=round(brightest, 3) if brightest is not None else None,
        coverage=coverage if coverage is not None else 0.0,
    )


def solar_elevation(when: datetime | None = None) -> float:
    """Sun angle over the middle of the box, in degrees.

    Enough for a daylight gate -- a degree either way decides nothing here, and
    it saves a 65 MB download to discover the visible band is dark.
    """
    when = (when or datetime.now(UTC)).astimezone(UTC)
    south, west, north, east = HIMAWARI_BBOX
    lat, lon = math.radians((south + north) / 2), (west + east) / 2
    day = when.timetuple().tm_yday
    declination = math.radians(23.44) * math.sin(2 * math.pi * (284 + day) / 365)
    hours = when.hour + when.minute / 60 + when.second / 3600
    hour_angle = math.radians(15 * (hours + lon / 15 - 12))
    return math.degrees(math.asin(
        math.sin(lat) * math.sin(declination)
        + math.cos(lat) * math.cos(declination) * math.cos(hour_angle)
    ))


def is_lit(band: str, when: datetime | None = None) -> bool:
    """Whether this band has anything to show right now."""
    return band_kind(band) == "infrared" or solar_elevation(when) >= HIMAWARI_MIN_SUN_DEG


def latest_scene(size: int | None = None, now: datetime | None = None) -> Scene:
    """The current satellite view. No band to choose -- the sun decides."""
    slot, plan = resolve_plan(now)
    return render(slot, plan, size or HIMAWARI_IMAGE_SIZE)


def scene_at(slot: datetime, size: int | None = None) -> Scene:
    """A pinned scan, rebuilt exactly as it was drawn when it was current.

    The band set comes from the scan's own time, so an image URL issued at noon
    still renders the daylight composite when it is fetched after dark.
    """
    plan = tuple((band, _segments_for_bbox(slot, band)) for band in bands_for(slot))
    return render(slot, plan, size or HIMAWARI_IMAGE_SIZE)
