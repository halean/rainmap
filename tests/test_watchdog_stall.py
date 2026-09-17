"""Frozen-feed detection: the case is a camera that stays reachable while its picture stops.

is_live() cannot see this -- the endpoint returns a valid full-size JPEG either way -- so
these tests pin the one thing that can: whether the newest stored frames are byte-identical.
"""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import camera_watchdog as wd

FULL = b"\xff\xd8\xff" + b"x" * (wd.OFFLINE_THRESHOLD + 10)  # a plausible full-size frame
PLACEHOLDER = b"\xff\xd8\xff" + b"z" * 100                   # the site's dead-camera image


class FrozenRunTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self._real_root = wd.RAW_ROOT
        wd.RAW_ROOT = self.tmp
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.addCleanup(setattr, wd, "RAW_ROOT", self._real_root)

    def write(self, camera_id, frames):
        """frames: list of bytes, written in chronological filename order."""
        day = self.tmp / camera_id / "2026" / "09" / "17"
        day.mkdir(parents=True, exist_ok=True)
        for i, body in enumerate(frames):
            (day / f"20260917_{100000 + i:06d}.jpg").write_bytes(body)

    def test_live_feed_reports_one(self):
        self.write("live", [FULL + bytes([i]) for i in range(6)])
        self.assertEqual(wd.frozen_run("live"), 1)

    def test_frozen_feed_is_caught(self):
        # last four identical, so it reaches the replacement threshold
        self.write("frozen", [FULL + b"a", FULL + b"b"] + [FULL + b"same"] * 4)
        run = wd.frozen_run("frozen")
        self.assertEqual(run, 4)
        self.assertGreaterEqual(run, wd.STALL_FRAMES)

    def test_brief_freeze_is_left_alone(self):
        # three identical is the longest genuine freeze in the stored history, and
        # those cameras recovered on their own -- it must be logged, not acted on
        self.write("blip", [FULL + b"a", FULL + b"b", FULL + b"c"] + [FULL + b"same"] * 3)
        self.assertLess(wd.frozen_run("blip"), wd.STALL_FRAMES)

    def test_placeholders_are_not_a_stall(self):
        # identical forever by nature, but under the size threshold: that is the
        # liveness check's job, and counting it here would double-report every
        # dead camera as a frozen one
        self.write("offline", [PLACEHOLDER] * 6)
        self.assertEqual(wd.frozen_run("offline"), 1)

    def test_new_camera_is_not_a_stall(self):
        self.write("fresh", [FULL + b"a", FULL + b"b"])
        self.assertEqual(wd.frozen_run("fresh"), 1)

    def test_unknown_camera_is_not_a_stall(self):
        self.assertEqual(wd.frozen_run("never-fetched"), 1)


if __name__ == "__main__":
    unittest.main()
