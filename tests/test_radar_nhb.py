"""Recolouring and frame-list parsing for the Nha Be radar (app/services/radar_nhb.py).

The legend colours are the literal RGB values HYMETNET's frames use, read off a
real frame and matched to their images/DBZ.jpg tick marks.
"""

import unittest
from io import BytesIO

import numpy as np
from PIL import Image

from app.services import radar_nhb as radar


def frame(colours):
    """A 1-row RGBA PNG, one pixel per (r, g, b) -- None for transparent."""
    a = np.zeros((1, len(colours), 4), np.uint8)
    for i, c in enumerate(colours):
        if c is not None:
            a[0, i] = (*c, 255)
    buf = BytesIO()
    Image.fromarray(a).save(buf, format="PNG")
    return buf.getvalue()


def pixels(png):
    return [tuple(p) for p in np.array(Image.open(BytesIO(png)).convert("RGBA"))[0]]


class RecolorTests(unittest.TestCase):
    def test_bands_map_to_the_map_classes(self):
        light, medium, heavy = (250, 178, 25, 255), (236, 131, 90, 255), (208, 59, 59, 255)
        png, counts = radar.recolor(frame([
            (167, 250, 132),  # 20-25 dBZ
            (87, 250, 35),    # 25-30
            (5, 224, 51),     # 30-35
            (255, 216, 0),    # 35-40
            (255, 166, 0),    # 40-45
            (253, 129, 19),   # 45-55
            (204, 0, 113),    # 60-65
        ]))
        self.assertEqual(pixels(png), [light, light, medium, medium, heavy, heavy, heavy])
        self.assertEqual((counts["Light"], counts["Medium"], counts["Heavy"]), (2, 2, 3))

    def test_weak_echoes_are_dropped(self):
        # < 10, 10-15 and 15-20 dBZ: mostly clutter and cloud, never drawn
        png, counts = radar.recolor(frame([(102, 212, 251), (2, 109, 248), (7, 69, 248)]))
        self.assertTrue(all(p[3] == 0 for p in pixels(png)))
        self.assertEqual(counts["below_20dbz"], 3)

    def test_transparent_stays_transparent(self):
        png, _ = radar.recolor(frame([None, (5, 224, 51), None]))
        self.assertEqual([p[3] for p in pixels(png)], [0, 255, 0])

    def test_unknown_colour_is_dropped_not_guessed(self):
        png, counts = radar.recolor(frame([(120, 60, 200)]))
        self.assertEqual(pixels(png)[0][3], 0)
        self.assertEqual(counts["unmatched"], 1)

    def test_near_match_from_rounding_still_counts(self):
        png, counts = radar.recolor(frame([(103, 211, 250), (6, 224, 50)]))
        self.assertEqual(counts["below_20dbz"], 1)
        self.assertEqual(counts["Medium"], 1)


class FrameListTests(unittest.TestCase):
    def test_parses_the_station_page_list_newest_first(self):
        html = '''tentimesett = new Array()
tentimesett[0] = "202609251130"
tentimesett[1] = "202609251120"
tentimesett[2] = "202609251110"
var active = 11'''
        self.assertEqual(radar.parse_frame_list(html), ["202609251130", "202609251120", "202609251110"])

    def test_page_without_a_list_gives_nothing(self):
        self.assertEqual(radar.parse_frame_list("<html>maintenance</html>"), [])

    def test_bad_stamp_is_rejected_before_any_fetch(self):
        with self.assertRaises(ValueError):
            radar.frame_png("../../etc/passwd")


if __name__ == "__main__":
    unittest.main()
