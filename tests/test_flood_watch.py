"""Decisions in the flood watch: when to read, what counts as a flood, when a watch ends.

The model call and the site are left out; these are the rules that turn their answers
into "read this", "watch this" and "stop watching".
"""

import os
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import flood_watch as fw

UTC = timezone.utc
NOW = datetime(2026, 9, 30, 9, 30, tzinfo=UTC)
CAM = {"camera_id": "c", "name": "TL43", "lat": 10.87, "lon": 106.77}


def neighbour(dlat, rain, minutes_ago=5):
    return {"lat": CAM["lat"] + dlat, "lon": CAM["lon"], "rain": rain,
            "captured_at": (NOW - timedelta(minutes=minutes_ago)).isoformat()}


def read(depth, usable=True):
    return {"usable": usable, "depth": depth, "wakes": False, "stalled": False, "justification": ""}


class RainAroundTests(unittest.TestCase):
    def test_majority_of_fresh_neighbours(self):
        sample = [neighbour(0.01, "Light"), neighbour(0.02, "Medium"), neighbour(0.03, "No")]
        got = fw.rain_around(CAM, sample, NOW)
        self.assertEqual((got["fresh"], got["yes"], got["rain"]), (3, 2, True))

    def test_a_tie_is_not_a_majority(self):
        sample = [neighbour(0.01, "Light"), neighbour(0.02, "No")]
        self.assertFalse(fw.rain_around(CAM, sample, NOW)["rain"])

    def test_stale_readings_are_no_evidence_not_a_no(self):
        """Two fresh Light and three stale No: the stale ones must not outvote the fresh."""
        sample = [neighbour(0.01, "Light"), neighbour(0.015, "Light")] + \
                 [neighbour(0.02 + i / 1000, "No", minutes_ago=90) for i in range(3)]
        got = fw.rain_around(CAM, sample, NOW)
        self.assertEqual((got["fresh"], got["rain"]), (2, True))

    def test_one_fresh_neighbour_is_not_enough(self):
        sample = [neighbour(0.01, "Medium"), neighbour(0.02, "Medium", minutes_ago=90)]
        self.assertFalse(fw.rain_around(CAM, sample, NOW)["rain"])

    def test_cameras_beyond_the_radius_are_ignored(self):
        far = 0.1  # ~11 km
        sample = [neighbour(far, "Medium"), neighbour(far + 0.01, "Medium")]
        self.assertEqual(fw.rain_around(CAM, sample, NOW)["fresh"], 0)


class ParseTests(unittest.TestCase):
    def test_fenced_json(self):
        got = fw.parse_read('```json\n{"usable": "yes", "depth": "Flooded", "wakes": "yes", '
                            '"stalled": "no", "justification": "bow waves"}\n```')
        self.assertEqual((got["depth"], got["usable"], got["wakes"]), ("flooded", True, True))
        self.assertTrue(fw.is_flooding(got))

    def test_unknown_depth_is_an_error_not_a_guess(self):
        with self.assertRaises(ValueError):
            fw.parse_read('{"usable": "yes", "depth": "a bit", "wakes": "no", "stalled": "no"}')

    def test_unusable_frame_is_never_a_flood(self):
        self.assertFalse(fw.is_flooding(read("deep", usable=False)))


class WatchStateTests(unittest.TestCase):
    def setUp(self):
        self.st = fw.new_camera_state()

    def step(self, depth, usable=True, minutes=0):
        return fw.apply_read(self.st, read(depth, usable), "f.jpg", NOW + timedelta(minutes=minutes))

    def test_flood_starts_a_watch(self):
        self.assertIsNone(self.step("shallow sheet"))
        self.assertEqual(self.step("flooded"), "start")
        self.assertEqual(self.st["mode"], fw.WATCH)
        self.assertEqual(self.st["first_frame"], "f.jpg")

    def test_ends_after_clear_reads_in_a_row(self):
        self.step("flooded")
        events = [self.step(d, minutes=i) for i, d in enumerate(["none", "edge puddles", "none"], 1)]
        self.assertEqual(events, [None, None, "end"])

    def test_shallow_sheet_holds_the_watch_and_resets_the_count(self):
        """TL43 on 30 Sep: 'flooded' at 16:12, 'shallow sheet' at 16:42 with wakes still crossing."""
        self.step("flooded")
        self.step("none")
        self.step("none")
        self.assertIsNone(self.step("shallow sheet"))
        self.assertEqual(self.st["clear_streak"], 0)
        self.assertEqual([self.step("none") for _ in range(3)], [None, None, "end"])

    def test_unusable_frames_do_not_count_toward_clearing(self):
        self.step("flooded")
        for _ in range(5):
            self.assertIsNone(self.step("none", usable=False))
        self.assertEqual(self.st["mode"], fw.WATCH)

    def test_peak_depth_is_kept(self):
        self.step("flooded")
        self.step("deep")
        self.step("flooded")
        self.assertEqual(self.st["peak"], "deep")

    def test_close_watch_resets_and_reports(self):
        self.step("deep")
        row = fw.close_watch(self.st, CAM, NOW + timedelta(minutes=45), "3 clear reads")
        self.assertEqual((row["minutes"], row["peak_depth"], row["end_reason"]), (45, "deep", "3 clear reads"))
        self.assertEqual(self.st["mode"], fw.SWEEP)
        self.assertIsNone(self.st["watch_since"])

    def test_watch_expires_after_the_cap(self):
        self.step("flooded")
        self.assertFalse(fw.watch_expired(self.st, NOW + timedelta(hours=fw.WATCH_MAX_HOURS - 0.1)))
        self.assertTrue(fw.watch_expired(self.st, NOW + timedelta(hours=fw.WATCH_MAX_HOURS + 0.1)))

    def test_a_watch_goes_stale_without_new_frames(self):
        """Mai Chí Thọ - Đồng Văn Cống 2, 8 Oct: no new frame for 82 min after a flooded read."""
        self.step("flooded")
        self.assertIsNone(fw.watch_stale(self.st, NOW + timedelta(minutes=fw.WATCH_STALE_MIN - 1)))
        self.assertEqual(fw.watch_stale(self.st, NOW + timedelta(minutes=fw.WATCH_STALE_MIN + 1)), NOW)

    def test_a_new_frame_keeps_the_watch_fresh(self):
        self.step("flooded")
        self.st["last_new_frame"] = (NOW + timedelta(minutes=8)).isoformat()
        self.assertIsNone(fw.watch_stale(self.st, NOW + timedelta(minutes=fw.WATCH_STALE_MIN + 1)))

    def test_a_stale_close_is_dated_to_the_last_frame(self):
        self.step("flooded")
        last = fw.watch_stale(self.st, NOW + timedelta(minutes=82))
        row = fw.close_watch(self.st, CAM, last, "no new frame")
        self.assertEqual(row["minutes"], 0)

    def test_state_saved_before_the_field_existed_falls_back_to_the_watch_start(self):
        self.step("flooded")
        del self.st["last_new_frame"]
        self.assertEqual(fw.watch_stale(self.st, NOW + timedelta(minutes=fw.WATCH_STALE_MIN + 1)), NOW)

    def test_no_staleness_outside_a_watch(self):
        self.assertIsNone(fw.watch_stale(self.st, NOW + timedelta(hours=5)))


class PruneTests(unittest.TestCase):
    def test_only_old_unread_frames_go(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            old, old_read, new = root / "a" / "1.jpg", root / "a" / "2_read.jpg", root / "a" / "3.jpg"
            old.parent.mkdir()
            for p in (old, old_read, new):
                p.write_bytes(b"x")
            past = time.time() - 3 * 3600
            for p in (old, old_read):
                os.utime(p, (past, past))
            self.assertEqual(fw.frames_to_prune(root, time.time(), 2), [old])


if __name__ == "__main__":
    unittest.main()
