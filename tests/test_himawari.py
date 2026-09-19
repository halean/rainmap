"""Himawari decoding, checked against a synthetic Himawari Standard Data file.

Nothing here touches the network: the fixture builds the same 11-block header
layout the real files carry, so a change to the parser that would misread a
NOAA file fails here too.
"""

import math
import struct
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.config import HIMAWARI_BANDS, HIMAWARI_IMAGE_SIZES, HIMAWARI_MAX_AGE_HOURS
from app.services import himawari

UTC = timezone.utc

# The real full-disk 2 km grid, as band 13 files declare it.
COLUMNS, LINES_PER_SEGMENT, SEGMENTS = 5500, 550, 10
SUB_LON, FACTOR, OFFSET = 140.7, 20466275, 2750.5
GAIN, CONSTANT = -0.0037525074318633814, 15.197657722429469
RAD_TO_BT = (-0.118260812197365, 1.00101143081895, -1.80800453227613e-06)
LIGHT, PLANCK, BOLTZMANN = 299792458.0, 6.62606957e-34, 1.3806488e-23


# A real B03 file's calibration tail: c', the calibration date in MJD, and an
# updated gain pair. These sit exactly where B13 keeps its Planck coefficients.
VIS_GAIN, VIS_CONSTANT = 0.30510371, -6.102074
C_PRIME, CAL_MJD = 0.00192798475658132, 60940.86111111112


def hsd_file(segment=4, lines=LINES_PER_SEGMENT, counts=None, blocks=11, band=13):
    """A minimal but structurally faithful HSD file, infrared or visible."""
    if counts is None:
        counts = np.full((lines, COLUMNS), 1500, dtype="<u2")
    bodies = {
        1: b"\0" * 279,
        2: struct.pack("<HHHB", 16, COLUMNS, lines, 0) + b"\0" * 40,
        3: struct.pack(
            "<dIIffddd", SUB_LON, FACTOR, FACTOR, OFFSET, OFFSET, 42164.0, 6378.137, 6356.7523
        )
        + b"\0" * 80,
        4: b"\0" * 136,
        5: (
            struct.pack("<HdHHHdd", 13, 10.4074, 12, 65535, 65534, GAIN, CONSTANT)
            + struct.pack("<3d", *RAD_TO_BT)
            + struct.pack("<3d", 0.0, 0.0, 0.0)
            + struct.pack("<3d", LIGHT, PLANCK, BOLTZMANN)
            + b"\0" * 40
        ) if band == 13 else (
            struct.pack("<HdHHHdd", 3, 0.6397, 11, 65535, 65534, VIS_GAIN, VIS_CONSTANT)
            + struct.pack("<4d", C_PRIME, CAL_MJD, 0.30901666, -6.180333)
            + b"\0" * 64
        ),
        6: b"\0" * 256,
        7: struct.pack("<BBH", SEGMENTS, segment, (segment - 1) * LINES_PER_SEGMENT + 1)
        + b"\0" * 40,
        8: b"\0" * 78,
        9: b"\0" * 92,
        10: b"\0" * 44,
        11: b"\0" * 256,
    }
    header = b"".join(
        struct.pack("<BH", number, len(bodies[number]) + 3) + bodies[number]
        for number in range(1, blocks + 1)
    )
    return header + counts.tobytes()


class ParsingTests(unittest.TestCase):
    def test_header_fields_and_pixels(self):
        counts = np.arange(LINES_PER_SEGMENT * COLUMNS, dtype="<u2").reshape(
            LINES_PER_SEGMENT, COLUMNS
        )
        header, pixels = himawari._parse(hsd_file(counts=counts))
        self.assertEqual((header.columns, header.lines), (COLUMNS, LINES_PER_SEGMENT))
        self.assertEqual((header.segment, header.first_line), (4, 1651))
        self.assertEqual(header.total_segments, SEGMENTS)
        self.assertEqual((header.band, header.valid_bits), (13, 12))
        self.assertAlmostEqual(header.sub_lon, SUB_LON)
        self.assertAlmostEqual(header.wavelength, 10.4074, places=4)
        np.testing.assert_array_equal(pixels, counts)

    def test_blocks_are_walked_by_declared_length(self):
        """The optional blocks vary in size between files, so the parser must
        follow each block's own length rather than fixed offsets."""
        grown, start = bytearray(hsd_file()), 0
        for _ in range(7):  # walk to block 8, the first of the variable-length ones
            start += struct.unpack_from("<H", grown, start + 1)[0]
        length = struct.unpack_from("<H", grown, start + 1)[0]
        struct.pack_into("<H", grown, start + 1, length + 32)
        grown[start + length : start + length] = b"\0" * 32
        header, pixels = himawari._parse(bytes(grown))
        self.assertEqual(header.first_line, 1651)
        self.assertEqual(pixels.shape, (LINES_PER_SEGMENT, COLUMNS))

    def test_truncated_body_is_rejected(self):
        with self.assertRaises(ValueError):
            himawari._parse(hsd_file()[:-2])

    def test_missing_block_is_rejected(self):
        with self.assertRaises(ValueError):
            himawari._parse(hsd_file(blocks=10))


class CalibrationTests(unittest.TestCase):
    def setUp(self):
        self.header, _ = himawari._parse(hsd_file())

    def test_counts_convert_to_plausible_temperatures(self):
        counts = np.array([[1000, 1500, 2000, 2500, 3000]], dtype="<u2")
        kelvin = himawari.brightness_temperature(self.header, counts)
        self.assertTrue(np.all(np.diff(kelvin[0]) < 0), "higher counts must be colder")
        self.assertTrue(np.all((150 < kelvin) & (kelvin < 340)), kelvin)

    def test_flagged_pixels_have_no_temperature(self):
        counts = np.array([[65535, 65534, 4096, 1500]], dtype="<u2")
        kelvin = himawari.brightness_temperature(self.header, counts)
        self.assertTrue(np.all(np.isnan(kelvin[0, :3])))
        self.assertFalse(np.isnan(kelvin[0, 3]))

    def test_planck_inversion_round_trips(self):
        """Radiance recovered from the temperature must match the radiance the
        gain produced, which is the step a sign or unit slip would break."""
        count = 1500.0
        radiance = GAIN * count + CONSTANT
        kelvin = float(himawari.brightness_temperature(self.header, np.array([[1500]], "<u2"))[0, 0])
        c0, c1, c2 = RAD_TO_BT
        effective = (-c1 + math.sqrt(c1**2 - 4 * c2 * (c0 - kelvin))) / (2 * c2)
        wavelength = 10.4074e-6
        spectral = (2 * PLANCK * LIGHT**2 / wavelength**5) / (
            math.exp(PLANCK * LIGHT / (BOLTZMANN * wavelength * effective)) - 1
        )
        self.assertAlmostEqual(spectral / 1e6, radiance, places=6)


class ProjectionTests(unittest.TestCase):
    def setUp(self):
        self.header, _ = himawari._parse(hsd_file())

    def test_sub_satellite_point_is_the_grid_centre(self):
        column, line, visible = himawari._forward(self.header, np.array(0.0), np.array(SUB_LON))
        self.assertTrue(visible)
        self.assertAlmostEqual(float(column), OFFSET, places=6)
        self.assertAlmostEqual(float(line), OFFSET, places=6)

    def test_line_grows_southward_and_column_eastward(self):
        lat = np.array([[20.0], [0.0], [-20.0]])
        lon = np.array([[130.0, 140.7, 150.0]])
        column, line, _ = himawari._forward(self.header, lat, lon)
        self.assertTrue(np.all(np.diff(line[:, 0]) > 0))
        self.assertTrue(np.all(np.diff(column[0, :]) > 0))

    def test_the_city_lands_where_the_bucket_puts_it(self):
        """Ho Chi Minh City sits in strip 4 of the 2 km full disk, at the pixel
        these numbers name. The placement was checked against a midday scene,
        where the warm land traced the coastline at Hong Kong, Da Nang and
        Borneo; if it moves, the layer is quietly sampling somewhere else."""
        column, line, visible = himawari._forward(
            self.header, np.array(10.78), np.array(106.70)
        )
        self.assertTrue(visible)
        self.assertAlmostEqual(float(column), 1059.58, places=2)
        self.assertAlmostEqual(float(line), 2179.66, places=2)
        self.assertEqual(int(line) // LINES_PER_SEGMENT + 1, 4)

    def test_the_far_side_of_the_earth_is_not_visible(self):
        _, _, visible = himawari._forward(self.header, np.array(0.0), np.array(SUB_LON - 180))
        self.assertFalse(visible)


class SceneTests(unittest.TestCase):
    def setUp(self):
        himawari._segment.cache_clear()
        himawari.render.cache_clear()
        himawari._SEGMENT_INDEX.clear()
        self.addCleanup(himawari._SEGMENT_INDEX.clear)
        self.addCleanup(himawari._segment.cache_clear)
        self.addCleanup(himawari.render.cache_clear)

    def fake_segment(self, slot, segment, band=None):
        """Strips of a disk whose temperature falls off to the south, so a
        sampling error shows up as a discontinuity rather than as noise."""
        first = (segment - 1) * LINES_PER_SEGMENT + 1
        rows = np.arange(first, first + LINES_PER_SEGMENT)[:, None]
        # Counts must stay under the 12 valid bits the header declares, or every
        # pixel reads as a flagged one and the field comes back empty.
        counts = np.broadcast_to(500 + (rows - 1651) * 3, (LINES_PER_SEGMENT, COLUMNS))
        return himawari._parse(
            hsd_file(segment=segment, counts=np.ascontiguousarray(counts, dtype="<u2"))
        )

    def test_bbox_selects_the_strips_it_crosses(self):
        with patch.object(himawari, "_segment", self.fake_segment):
            segments = himawari._segments_for_bbox(datetime(2026, 9, 18, 19, 30, tzinfo=UTC))
        self.assertEqual(segments, (4, 5))

    def test_sampled_field_is_continuous_across_the_strip_seam(self):
        with patch.object(himawari, "_segment", self.fake_segment):
            parts = [self.fake_segment(None, s) for s in (4, 5)]
            kelvin = himawari.sample_bbox(parts, 128)
        self.assertFalse(np.isnan(kelvin).any(), "the box should be fully covered")
        steps = np.diff(kelvin, axis=0)
        self.assertTrue(np.all(steps <= 0), "south must stay colder")
        # Output rows are finer than the 2 km grid, so neighbours differ by at
        # most one instrument line. Sampling the wrong strip would jump by the
        # 550 lines between them, which is tens of kelvin.
        self.assertLess(np.abs(steps).max(), 1.0, "a seam would show as a jump in kelvin")
        self.assertGreater(kelvin[0].mean() - kelvin[-1].mean(), 1.0, "the gradient is real")

    def test_render_produces_a_png_and_statistics(self):
        with patch.object(himawari, "_segment", self.fake_segment):
            scene = himawari.render(datetime(2026, 9, 18, 19, 30, tzinfo=UTC), (4, 5), 128)
        self.assertTrue(scene.png.startswith(b"\x89PNG"))
        self.assertEqual(scene.coverage, 1.0)
        self.assertEqual(scene.band, "B13")
        self.assertLess(scene.extreme, scene.median)  # infrared reports its coldest top


class ColorTests(unittest.TestCase):
    def test_warm_tops_and_gaps_are_transparent(self):
        rgba = himawari.colorize(np.array([[300.0, 273.0, np.nan, 200.0]]))
        self.assertEqual(list(rgba[0, 0]), [148, 163, 184, 0])
        self.assertEqual(rgba[0, 1, 3], 0)
        self.assertEqual(rgba[0, 2, 3], 0)
        self.assertEqual(rgba[0, 3, 3], himawari.CLOUD_STOPS[-1][2])

    def test_colder_tops_are_never_less_opaque(self):
        kelvin = np.linspace(200, 300, 400).reshape(1, -1)
        alpha = himawari.colorize(kelvin)[0, :, 3].astype(int)
        self.assertTrue(np.all(np.diff(alpha) <= 0))


class ScanResolutionTests(unittest.TestCase):
    def setUp(self):
        himawari._RESOLVED.clear()
        self.addCleanup(himawari._RESOLVED.clear)
        himawari._SEGMENT_INDEX.clear()
        himawari._SEGMENT_INDEX[(himawari.HIMAWARI_BAND,
                                 HIMAWARI_BANDS[himawari.HIMAWARI_BAND]["resolution"],
                                 himawari.HIMAWARI_BBOX)] = (4, 5)
        self.addCleanup(himawari._SEGMENT_INDEX.clear)

    def test_key_matches_the_buckets_naming(self):
        key = himawari._key(datetime(2026, 9, 18, 19, 10, tzinfo=UTC), 4)
        self.assertEqual(
            key,
            "AHI-L1b-FLDK/2026/09/18/1910/HS_H09_20260918_1910_B13_FLDK_R20_S0410.DAT.bz2",
        )

    def test_incomplete_scans_are_skipped(self):
        """A directory appears in the bucket before all of its strips do."""
        now = datetime(2026, 9, 18, 19, 45, tzinfo=UTC)
        published = {
            himawari._key(datetime(2026, 9, 18, 19, 20, tzinfo=UTC), 1),  # strip 1 only
            *(himawari._key(datetime(2026, 9, 18, 19, 10, tzinfo=UTC), s) for s in (1, 4, 5)),
        }
        with patch.object(himawari, "_exists", published.__contains__):
            slot, segments = himawari.resolve_scan(now)
        self.assertEqual(slot, datetime(2026, 9, 18, 19, 10, tzinfo=UTC))
        self.assertEqual(segments, (4, 5))

    def test_a_silent_bucket_raises_rather_than_hanging_on(self):
        with patch.object(himawari, "_exists", lambda key: False):
            with self.assertRaises(himawari.HimawariUnavailable):
                himawari.resolve_scan(datetime(2026, 9, 18, 19, 45, tzinfo=UTC))

    def test_a_resolved_scan_is_not_re_probed_for_every_caller(self):
        now = datetime(2026, 9, 18, 19, 45, tzinfo=UTC)
        published = {himawari._key(datetime(2026, 9, 18, 19, 10, tzinfo=UTC), s) for s in (1, 4, 5)}
        with patch.object(himawari, "_exists", side_effect=published.__contains__) as probe:
            himawari.resolve_scan(now)
            calls = probe.call_count
            himawari.resolve_scan(now + timedelta(seconds=30))
            self.assertEqual(probe.call_count, calls, "the cached answer should be reused")
            himawari.resolve_scan(now + himawari.RESOLVE_CACHE)
            self.assertGreater(probe.call_count, calls, "a stale answer should be re-probed")

    def test_floor_to_scan(self):
        self.assertEqual(
            himawari.floor_to_scan(datetime(2026, 9, 18, 19, 49, 59, tzinfo=UTC)),
            datetime(2026, 9, 18, 19, 40, tzinfo=UTC),
        )


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        # A scan on the 10-minute grid, recent enough for the endpoint's window.
        self.slot = datetime.now(UTC).replace(second=0, microsecond=0)
        self.slot -= timedelta(minutes=self.slot.minute % 10 + 20)
        self.scene = himawari.Scene(
            scan=self.slot, size=256, band="B13", png=b"\x89PNG\r\n\x1a\n",
            bounds=himawari.HIMAWARI_BBOX, extreme=212.3, median=278.0,
            coverage=1.0, segments=(4, 5),
        )

    def test_metadata_points_at_the_pinned_image(self):
        with patch.object(himawari, "latest_scene", return_value=self.scene):
            body = self.client.get("/api/rain-map/himawari").json()
        self.assertEqual(body["scan"], self.slot.isoformat())
        expected = (datetime.now(UTC) - self.slot).total_seconds() / 60
        self.assertAlmostEqual(body["age_minutes"], expected, delta=1)
        self.assertEqual(body["bounds"], [[9.7, 105.6], [11.9, 107.8]])
        self.assertIn(self.slot.strftime("%Y%m%d%H%M"), body["image_url"])
        self.assertEqual(body["scale"][0]["label"], "0\u00b0C")

    def test_unavailable_bucket_is_a_503(self):
        with patch.object(himawari, "latest_scene", side_effect=himawari.HimawariUnavailable("no scan")):
            response = self.client.get("/api/rain-map/himawari")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "no scan")

    def test_image_is_served_with_a_permanent_cache(self):
        with patch.object(himawari, "scene_at", return_value=self.scene):
            response = self.client.get(
                f"/api/rain-map/himawari.png?scan={self.slot.strftime('%Y%m%d%H%M')}"
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/png")
        self.assertIn("immutable", response.headers["cache-control"])

    def test_bad_and_out_of_window_scans_are_refused(self):
        with patch.object(himawari, "scene_at", return_value=self.scene) as fetch:
            codes = [
                self.client.get("/api/rain-map/himawari.png?scan=not-a-time").status_code,
                self.client.get("/api/rain-map/himawari.png?scan=202609181915").status_code,
                self.client.get("/api/rain-map/himawari.png?scan=202001010000").status_code,
                self.client.get(
                    f"/api/rain-map/himawari.png?scan={(self.slot + timedelta(hours=1)):%Y%m%d%H%M}"
                ).status_code,
            ]
        self.assertEqual(codes, [422, 422, 404, 404])  # unparsable, off-grid, too old, in the future
        fetch.assert_not_called()


class CacheTests(unittest.TestCase):
    """A frame must cost one download, once -- not one per request.

    The image endpoint serves any scan in its window, so anything that can ask
    for scans in a cycle (a viewer stepping back through them, an animation, or
    someone hammering the URL) walks the whole window repeatedly. If the cache
    of finished frames is smaller than that window, every lap re-renders, and
    re-rendering needs strips that were long since evicted -- so every lap goes
    back to NOAA for megabytes it already downloaded.
    """

    def setUp(self):
        himawari._SEGMENT_INDEX.clear()
        himawari._SEGMENT_INDEX[(himawari.HIMAWARI_BAND,
                                 HIMAWARI_BANDS[himawari.HIMAWARI_BAND]["resolution"],
                                 himawari.HIMAWARI_BBOX)] = (4, 5)
        self.addCleanup(himawari._SEGMENT_INDEX.clear)
        self.fetched = []

    def strip(self, slot, segment, band=None):
        self.fetched.append((slot, segment))
        first = (segment - 1) * LINES_PER_SEGMENT + 1
        rows = np.arange(first, first + LINES_PER_SEGMENT)[:, None]
        counts = np.broadcast_to(500 + (rows - 1651) * 3, (LINES_PER_SEGMENT, COLUMNS))
        return himawari._parse(
            hsd_file(segment=segment, counts=np.ascontiguousarray(counts, dtype="<u2"))
        )

    def walk(self, frames, passes):
        render = himawari.lru_cache(maxsize=himawari.RENDER_CACHE)(himawari.render.__wrapped__)
        cached_strip = himawari.lru_cache(maxsize=3)(self.strip)
        base = datetime(2026, 9, 18, 18, tzinfo=UTC)
        with patch.object(himawari, "_segment", cached_strip):
            for _ in range(passes):
                for i in range(frames):
                    render(base + timedelta(minutes=10 * i), (4, 5), 512)

    def test_a_full_window_is_downloaded_once_however_often_it_is_walked(self):
        frames = int(HIMAWARI_MAX_AGE_HOURS * 6)
        self.walk(frames, passes=3)
        self.assertEqual(len(self.fetched), len(set(self.fetched)),
                         "a strip was fetched more than once across the three passes")
        self.assertEqual(len(self.fetched), frames * 2, "two strips per scan, once each")

    def test_the_result_cache_covers_everything_the_endpoint_will_serve(self):
        """The bound that makes the above true. Widening the window without
        widening this would quietly restore the re-downloading."""
        servable = int(HIMAWARI_MAX_AGE_HOURS * 6) * len(HIMAWARI_IMAGE_SIZES)
        self.assertGreaterEqual(himawari.RENDER_CACHE, servable)

    def test_strips_are_not_the_cache_that_grows(self):
        """Holding the window in strips would cost ~100x the memory of holding
        it in finished PNGs, for the same saved downloads."""
        self.assertLessEqual(himawari._segment.cache_info().maxsize, 4)


class SizeAllowlistTests(unittest.TestCase):
    """Size is a cache key too, so cycling it thrashes exactly as scans do."""

    def setUp(self):
        self.client = TestClient(app)
        self.slot = datetime.now(UTC).replace(second=0, microsecond=0)
        self.slot -= timedelta(minutes=self.slot.minute % 10 + 20)

    def test_listed_sizes_are_accepted(self):
        scene = himawari.Scene(scan=self.slot, size=256, band="B13", png=b"\x89PNG", bounds=himawari.HIMAWARI_BBOX,
                               extreme=210.0, median=270.0, coverage=1.0, segments=(4, 5))
        with patch.object(himawari, "latest_scene", return_value=scene):
            for size in HIMAWARI_IMAGE_SIZES:
                self.assertEqual(
                    self.client.get(f"/api/rain-map/himawari?size={size}").status_code, 200, size
                )

    def test_unlisted_sizes_are_refused_before_any_fetch(self):
        with patch.object(himawari, "latest_scene") as meta, patch.object(himawari, "scene_at") as png:
            stamp = self.slot.strftime("%Y%m%d%H%M")
            for size in (129, 511, 777, 2048):
                self.assertEqual(
                    self.client.get(f"/api/rain-map/himawari?size={size}").status_code, 422, size)
                self.assertEqual(
                    self.client.get(
                        f"/api/rain-map/himawari.png?scan={stamp}&size={size}").status_code, 422, size)
        meta.assert_not_called()
        png.assert_not_called()

    def test_the_configured_default_is_always_servable(self):
        self.assertIn(himawari.HIMAWARI_IMAGE_SIZE, HIMAWARI_IMAGE_SIZES)


class VisibleBandTests(unittest.TestCase):
    """The visible band is not the infrared one with a different palette.

    A B03 file carries c' -- the radiance-to-albedo factor -- at the byte offset
    a B13 file uses for its Planck coefficients. Reading one as the other raises
    nothing: it returns temperatures in the tens of millions, which clamp to the
    transparent end of the infrared ramp and draw an empty layer. The band has to
    decide how its own file is read.
    """

    def setUp(self):
        self.vis, _ = himawari._parse(hsd_file(band=3))
        self.ir, _ = himawari._parse(hsd_file(band=13))

    def test_each_kind_carries_only_its_own_coefficients(self):
        self.assertEqual(self.vis.band, 3)
        self.assertAlmostEqual(self.vis.albedo_factor, C_PRIME)
        self.assertIsNone(self.vis.rad_to_bt)
        self.assertIsNone(self.vis.planck)
        self.assertEqual(self.ir.band, 13)
        self.assertIsNone(self.ir.albedo_factor)
        self.assertIsNotNone(self.ir.rad_to_bt)

    def test_counts_convert_to_plausible_albedo(self):
        counts = np.array([[0, 200, 800, 1600, 2047]], dtype="<u2")
        albedo = himawari.reflectance(self.vis, counts)
        self.assertTrue(np.all(np.diff(albedo[0]) > 0), "brighter counts are brighter cloud")
        # Uncorrected for solar angle, so it runs a little past 1 on the brightest tops.
        self.assertGreater(albedo[0, -1], 0.9)
        self.assertLess(albedo[0, -1], 1.3)
        self.assertLess(abs(albedo[0, 0]), 0.05)

    def test_eleven_bit_flags_are_honoured(self):
        """B03 declares 11 valid bits where B13 declares 12, so the threshold
        has to come from the file rather than from a constant."""
        counts = np.array([[2048, 65535, 2047]], dtype="<u2")
        albedo = himawari.reflectance(self.vis, counts)
        self.assertTrue(np.all(np.isnan(albedo[0, :2])))
        self.assertFalse(np.isnan(albedo[0, 2]))

    def test_physical_dispatches_on_the_band(self):
        counts = np.array([[1500]], dtype="<u2")
        self.assertAlmostEqual(float(himawari.physical(self.ir, counts)),
                               float(himawari.brightness_temperature(self.ir, counts)))
        self.assertAlmostEqual(float(himawari.physical(self.vis, counts)),
                               float(himawari.reflectance(self.vis, counts)))

    def test_the_infrared_path_on_a_visible_file_is_the_bug_this_prevents(self):
        """Demonstrates why the branch exists rather than trusting the offsets."""
        wrong = himawari.brightness_temperature(
            himawari.Header(**{**self.vis.__dict__,
                               "rad_to_bt": (C_PRIME, CAL_MJD, 0.309),
                               "light_speed": LIGHT, "planck": PLANCK, "boltzmann": BOLTZMANN}),
            np.array([[1500]], dtype="<u2"))
        self.assertGreater(float(wrong), 1e6)  # tens of millions of kelvin
        self.assertEqual(himawari.colorize(wrong, "B13")[0, 0, 3], 0)  # and so, invisible


class VisibleRampTests(unittest.TestCase):
    def test_dark_ground_and_gaps_draw_nothing(self):
        rgba = himawari.colorize(np.array([[0.0, 0.06, np.nan, 0.9]]), "B03")
        self.assertEqual(rgba[0, 0, 3], 0)
        self.assertEqual(rgba[0, 1, 3], 0)
        self.assertEqual(rgba[0, 2, 3], 0)
        self.assertEqual(rgba[0, 3, 3], himawari.VISIBLE_STOPS[-1][2])

    def test_brighter_cloud_is_never_less_opaque(self):
        alpha = himawari.colorize(np.linspace(0, 1, 400).reshape(1, -1), "B03")[0, :, 3].astype(int)
        self.assertTrue(np.all(np.diff(alpha) >= 0))

    def test_the_two_ramps_run_in_opposite_directions(self):
        """Infrared is drawn for its coldest values and visible for its
        brightest, so a shared ramp would invert one of them."""
        self.assertGreater(himawari.CLOUD_STOPS[0][0], himawari.CLOUD_STOPS[-1][0])
        self.assertLess(himawari.VISIBLE_STOPS[0][0], himawari.VISIBLE_STOPS[-1][0])


class DaylightGateTests(unittest.TestCase):
    NOON = datetime(2026, 9, 19, 5, 0, tzinfo=UTC)     # 12:00 ICT
    MIDNIGHT = datetime(2026, 9, 19, 17, 0, tzinfo=UTC)  # 00:00 ICT

    def test_the_sun_is_where_it_should_be(self):
        self.assertGreater(himawari.solar_elevation(self.NOON), 60)
        self.assertLess(himawari.solar_elevation(self.MIDNIGHT), -40)

    def test_infrared_is_never_gated(self):
        self.assertTrue(himawari.is_lit("B13", self.MIDNIGHT))
        self.assertTrue(himawari.is_lit("B13", self.NOON))

    def test_visible_is_offered_only_in_daylight(self):
        self.assertTrue(himawari.is_lit("B03", self.NOON))
        self.assertFalse(himawari.is_lit("B03", self.MIDNIGHT))

    def test_a_dark_request_never_reaches_the_bucket(self):
        """65 MB is too much to spend discovering the sun is down."""
        with patch.object(himawari, "resolve_scan") as fetch:
            with patch.object(himawari, "solar_elevation", return_value=-20.0):
                with self.assertRaises(himawari.HimawariUnavailable):
                    himawari.latest_scene(band="B03")
        fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
