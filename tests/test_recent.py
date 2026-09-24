"""The per-camera recent-readings index (app/services/recent.py).

Pins the properties the design leans on: one file per camera, most-recent
first and trimmed to the limit, one entry per frame even when a frame is
recorded twice (a restart re-processing it), camera ids that cannot become
arbitrary paths, a backfill that agrees with the log, and -- the reason the
index exists as files at all -- a reader never sees a torn file while a
writer is replacing it.
"""

import json
import tempfile
import threading
import unittest
from pathlib import Path

from app.services import recent
from scripts.backfill_recent import backfill

CAM = "6792f1008c5ed4001b27f41f"


def rec(image, rain="Light", when="2026-09-24T03:00:00+00:00", cam=CAM):
    return {"camera_id": cam, "image_url": f"/media/data/raw/{cam}/2026/09/24/{image}", "rain": rain,
            "justification": f"j-{image}", "updated_at": when}


class EntryTests(unittest.TestCase):
    def test_entry_reconstructs_capture_time_and_path_from_the_frame_name(self):
        e = recent.entry_from_row(CAM, "20260924_101530.jpg", "Heavy", "j", "2026-09-24T10:16:00+00:00")
        self.assertEqual(e["captured_at"], "2026-09-24T10:15:30Z")
        self.assertEqual(e["image_url"], f"/media/data/raw/{CAM}/2026/09/24/20260924_101530.jpg")
        self.assertEqual(e["rain"], "Heavy")

    def test_a_frame_without_a_stamp_is_kept_but_carries_no_time_or_url(self):
        e = recent.entry_from_row(CAM, "weird.jpg", "No", "j", "")
        self.assertIsNone(e["captured_at"])
        self.assertIsNone(e["image_url"])

    def test_camera_id_must_be_24_hex_chars_before_it_becomes_a_path(self):
        for bad in ("", "../../etc/passwd", "6792F1008C5ED4001B27F41F", "6792f1008c5ed4001b27f41", "x" * 24):
            with self.assertRaises(recent.BadCameraId):
                recent.recent_path(bad, Path("/tmp"))


class RecordTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)

    def test_keeps_only_the_newest_limit_entries_most_recent_first(self):
        for i in range(20):
            recent.record_reading(rec(f"20260924_10{i:02d}00.jpg"), self.base, limit=12)
        entries = recent.load_recent(CAM, self.base)
        self.assertEqual(len(entries), 12)
        self.assertEqual(entries[0]["image"], "20260924_101900.jpg")
        self.assertEqual(entries[-1]["image"], "20260924_100800.jpg")

    def test_recording_the_same_frame_twice_replaces_rather_than_duplicates(self):
        recent.record_reading(rec("20260924_100000.jpg", rain="No"), self.base)
        recent.record_reading(rec("20260924_100000.jpg", rain="Heavy"), self.base)
        entries = recent.load_recent(CAM, self.base)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["rain"], "Heavy")

    def test_out_of_order_arrival_still_sorts_by_capture_time(self):
        recent.record_reading(rec("20260924_100500.jpg"), self.base)
        recent.record_reading(rec("20260924_100000.jpg"), self.base)
        self.assertEqual([e["image"] for e in recent.load_recent(CAM, self.base)], ["20260924_100500.jpg", "20260924_100000.jpg"])

    def test_a_corrupt_file_is_treated_as_empty_not_fatal(self):
        path = recent.recent_path(CAM, self.base)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{not json")
        self.assertEqual(recent.load_recent(CAM, self.base), [])
        recent.record_reading(rec("20260924_100000.jpg"), self.base)  # and can be written over
        self.assertEqual(len(recent.load_recent(CAM, self.base)), 1)

    def test_cameras_get_separate_files(self):
        other = "aaaaaaaaaaaaaaaaaaaaaaaa"
        recent.record_reading(rec("20260924_100000.jpg"), self.base)
        recent.record_reading(rec("20260924_100000.jpg", cam=other), self.base)
        self.assertTrue((self.base / f"{CAM}.json").exists())
        self.assertTrue((self.base / f"{other}.json").exists())
        self.assertEqual(recent.load_recent(other, self.base)[0]["image_url"], f"/media/data/raw/{other}/2026/09/24/20260924_100000.jpg")

    def test_a_reader_never_sees_a_torn_file_while_the_writer_replaces_it(self):
        # The whole reason this is a per-file index: os.replace is atomic, so
        # every read parses, and every parsed file is a complete snapshot.
        stop = threading.Event()
        problems = []

        def reader():
            path = recent.recent_path(CAM, self.base)
            while not stop.is_set():
                try:
                    text = path.read_text(encoding="utf-8")
                except FileNotFoundError:
                    continue
                try:
                    data = json.loads(text)
                except ValueError:
                    problems.append("torn read"); continue
                if data.get("camera_id") != CAM or not isinstance(data.get("entries"), list):
                    problems.append("incomplete snapshot")

        t = threading.Thread(target=reader); t.start()
        try:
            for i in range(300):
                recent.record_reading(rec(f"20260924_{i // 60:02d}{i % 60:02d}00.jpg"), self.base)
        finally:
            stop.set(); t.join()
        self.assertEqual(problems, [])


class BackfillTests(unittest.TestCase):
    def test_backfill_writes_the_last_rows_per_camera_from_the_log(self):
        with tempfile.TemporaryDirectory() as temp:
            history = Path(temp) / "rain_history.csv"
            lines = ["timestamp,camera_id,location_text,rain,justification,image"]
            for i in range(30):
                lines.append(f"2026-09-24T10:{i:02d}:00+00:00,{CAM},Somewhere,Light,j{i},20260924_10{i:02d}00.jpg")
            lines.append(f"2026-09-24T11:00:00+00:00,bbbbbbbbbbbbbbbbbbbbbbbb,Elsewhere,No,k,20260924_110000.jpg")
            lines.append("2026-09-24T11:00:00+00:00,not-a-camera-id,Bad,No,k,20260924_110000.jpg")
            history.write_text("\n".join(lines) + "\n", encoding="utf-8")
            out = Path(temp) / "recent"
            result = backfill(history, out, 12)
            self.assertEqual(result["written"], 2)
            self.assertEqual(result["skipped"], ["not-a-camera-id"])
            entries = recent.load_recent(CAM, out)
            self.assertEqual(len(entries), 12)
            self.assertEqual(entries[0]["image"], "20260924_102900.jpg")   # newest first
            self.assertEqual(entries[0]["captured_at"], "2026-09-24T10:29:00Z")
            self.assertEqual(recent.load_recent("bbbbbbbbbbbbbbbbbbbbbbbb", out)[0]["rain"], "No")
            self.assertFalse((out / "not-a-camera-id.json").exists())


if __name__ == "__main__":
    unittest.main()


class HistoryEndpointTests(unittest.TestCase):
    """The reader side: /api/rain-map/rain-history serves the index, not the log."""

    def setUp(self):
        from unittest.mock import patch
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        patcher = patch.object(recent, "RECENT_DIR", Path(self.temp.name))
        patcher.start()
        self.addCleanup(patcher.stop)
        from fastapi.testclient import TestClient
        from app.main import app
        self.client = TestClient(app)

    def test_serves_the_index_most_recent_first_with_the_page_contract(self):
        for i in range(15):
            recent.record_reading(rec(f"20260924_10{i:02d}00.jpg", rain="Light" if i % 2 else "No"), Path(self.temp.name))
        r = self.client.get(f"/api/rain-map/rain-history?camera_id={CAM}")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(len(body), 12)
        self.assertEqual(set(body[0]), {"captured_at", "rain", "justification", "image_url"})
        self.assertEqual(body[0]["captured_at"], "2026-09-24T10:14:00Z")
        self.assertEqual(body[0]["image_url"], f"/media/data/raw/{CAM}/2026/09/24/20260924_101400.jpg")
        self.assertEqual(self.client.get(f"/api/rain-map/rain-history?camera_id={CAM}&limit=3").json()[2]["captured_at"], "2026-09-24T10:12:00Z")

    def test_unknown_camera_is_empty_and_a_bad_id_is_refused(self):
        self.assertEqual(self.client.get("/api/rain-map/rain-history?camera_id=bbbbbbbbbbbbbbbbbbbbbbbb").json(), [])
        self.assertEqual(self.client.get("/api/rain-map/rain-history?camera_id=../../etc/passwd").status_code, 422)
