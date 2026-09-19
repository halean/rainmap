"""The frame store behind satellite replay.

A twelve-hour history only exists because every scan was drawn while it was
current -- nothing can reconstruct 08:20 at noon. So the store is the point of
the poller, and losing it to a restart would cost a re-fetch of the window at
71 MB a daylight scan.
"""

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.services import himawari

UTC = timezone.utc


def scene(slot, size=512, bands=("B13",), png=b"\x89PNG\r\n\x1a\n"):
    return himawari.Scene(
        scan=slot, size=size, plan=tuple((b, (4, 5)) for b in bands), png=png,
        bounds=himawari.HIMAWARI_BBOX, coldest_k=211.5,
        brightest_albedo=0.8 if "B03" in bands else None, coverage=1.0,
    )


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        patcher = patch.object(himawari, "HIMAWARI_STORE", Path(self.temp.name))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.now = datetime(2026, 9, 19, 12, 0, tzinfo=UTC)

    def test_a_saved_frame_comes_back_intact(self):
        saved = scene(self.now, bands=("B03", "B13"), png=b"\x89PNG-payload")
        himawari.save_scene(saved)
        got = himawari.load_scene(self.now, 512)
        self.assertEqual(got.png, b"\x89PNG-payload")
        self.assertEqual(got.bands, ("B03", "B13"))
        self.assertEqual(got.mode, "daylight")
        self.assertEqual(got.coldest_k, 211.5)
        self.assertEqual(got.brightest_albedo, 0.8)

    def test_a_missing_frame_is_none_not_an_error(self):
        """The caller falls back to drawing it, so absence must be cheap."""
        self.assertIsNone(himawari.load_scene(self.now, 512))

    def test_a_different_size_is_a_miss(self):
        himawari.save_scene(scene(self.now, size=512))
        self.assertIsNone(himawari.load_scene(self.now, 1024))
        self.assertIsNotNone(himawari.load_scene(self.now, 512))

    def test_an_indexed_frame_whose_file_vanished_is_a_miss(self):
        """Index and files can disagree -- a half-finished prune, a cleaned
        disk. The frame must then be redrawn, not served as zero bytes."""
        himawari.save_scene(scene(self.now))
        next(Path(self.temp.name).glob("*.png")).unlink()
        self.assertIsNone(himawari.load_scene(self.now, 512))

    def test_a_corrupt_index_does_not_take_the_layer_down(self):
        himawari.save_scene(scene(self.now))
        (Path(self.temp.name) / himawari.INDEX_NAME).write_text("{ not json")
        self.assertEqual(himawari.read_index(), {})
        self.assertIsNone(himawari.load_scene(self.now, 512))

    def test_frames_are_listed_oldest_first(self):
        for minutes in (0, 30, 10, 20):
            himawari.save_scene(scene(self.now - timedelta(minutes=minutes)))
        scans = [f["scan"] for f in himawari.stored_frames(now=self.now)]
        self.assertEqual(scans, sorted(scans))
        self.assertEqual(len(scans), 4)

    def test_retention_prunes_files_and_index_together(self):
        keep = self.now - timedelta(hours=2)
        drop = self.now - timedelta(hours=13)
        himawari.save_scene(scene(keep))
        himawari.save_scene(scene(drop))
        self.assertEqual(himawari.prune_store(self.now), 1)
        self.assertEqual(len(list(Path(self.temp.name).glob("*.png"))), 1)
        self.assertEqual(list(himawari.read_index()), [keep.strftime("%Y%m%d%H%M")])
        self.assertIsNone(himawari.load_scene(drop, 512))

    def test_pruning_an_empty_store_is_harmless(self):
        self.assertEqual(himawari.prune_store(self.now), 0)

    def test_listing_respects_the_window(self):
        himawari.save_scene(scene(self.now - timedelta(minutes=20)))
        himawari.save_scene(scene(self.now - timedelta(hours=6)))
        self.assertEqual(len(himawari.stored_frames(hours=1, now=self.now)), 1)
        self.assertEqual(len(himawari.stored_frames(hours=12, now=self.now)), 2)


class FrameEndpointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        patcher = patch.object(himawari, "HIMAWARI_STORE", Path(self.temp.name))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = TestClient(app)

    def test_an_uncollected_window_is_empty_not_an_error(self):
        body = self.client.get("/api/rain-map/himawari/frames").json()
        self.assertEqual(body["count"], 0)
        self.assertEqual(body["frames"], [])

    def test_collected_frames_are_listed_with_their_images(self):
        now = datetime.now(UTC).replace(second=0, microsecond=0)
        now -= timedelta(minutes=now.minute % 10)
        for minutes in (0, 10, 20):
            himawari.save_scene(scene(now - timedelta(minutes=minutes)))
        body = self.client.get("/api/rain-map/himawari/frames").json()
        self.assertEqual(body["count"], 3)
        self.assertIn("scan=", body["frames"][0]["image_url"])
        self.assertEqual(body["frames"][0]["mode"], "night")

    def test_a_stored_frame_is_served_without_a_fetch(self):
        """Serving what is already drawn must never reach NOAA."""
        now = datetime.now(UTC).replace(second=0, microsecond=0)
        now -= timedelta(minutes=now.minute % 10 + 20)
        himawari.save_scene(scene(now, png=b"\x89PNG-stored"))
        with patch.object(himawari, "scene_at") as drawn:
            r = self.client.get(f"/api/rain-map/himawari.png?scan={now:%Y%m%d%H%M}&size=512")
        self.assertEqual(r.content, b"\x89PNG-stored")
        drawn.assert_not_called()

    def test_a_collected_frame_outlives_the_fetch_window(self):
        """The age limit exists to stop a stranger making us download old
        scans. A frame already on disk costs nothing, so it is still served."""
        old = datetime.now(UTC).replace(second=0, microsecond=0) - timedelta(hours=11)
        old -= timedelta(minutes=old.minute % 10)
        himawari.save_scene(scene(old, png=b"\x89PNG-old"))
        r = self.client.get(f"/api/rain-map/himawari.png?scan={old:%Y%m%d%H%M}&size=512")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.content, b"\x89PNG-old")

    def test_an_uncollected_old_scan_is_still_refused(self):
        old = datetime.now(UTC).replace(second=0, microsecond=0) - timedelta(hours=11)
        old -= timedelta(minutes=old.minute % 10)
        with patch.object(himawari, "scene_at") as drawn:
            r = self.client.get(f"/api/rain-map/himawari.png?scan={old:%Y%m%d%H%M}&size=512")
        self.assertEqual(r.status_code, 404)
        drawn.assert_not_called()


if __name__ == "__main__":
    unittest.main()
