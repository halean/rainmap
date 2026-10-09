"""The map's live-flood layer: which watches it shows, and when it calls one stale."""

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.services import floods

UTC = timezone.utc
NOW = datetime(2026, 10, 1, 11, 0, tzinfo=UTC)
CAMS = {"cameras": [
    {"camera_id": "a", "name": "Ung Van Khiem", "lat": 10.80, "lon": 106.71},
    {"camera_id": "b", "name": "Mai Chi Tho", "lat": 10.78, "lon": 106.72},
    {"camera_id": "c", "name": "Quang Trung", "lat": 10.84, "lon": 106.66},
]}


def watch(since_min, peak="flooded", last_min=None, frame="data/flood_watch/frames/a/20261001/104401_read.jpg"):
    st = {"mode": "watch", "watch_since": (NOW - timedelta(minutes=since_min)).isoformat(),
          "peak": peak, "reads": 4, "first_frame": frame}
    if last_min is not None:
        st["last_read"] = {"read_at": (NOW - timedelta(minutes=last_min)).isoformat(), "depth": "flooded",
                           "usable": True, "justification": "bow waves", "frame": frame}
    return st


class LiveFloodTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name) / "state.json"
        self.cams = Path(self.temp.name) / "cams.json"
        self.cams.write_text(json.dumps(CAMS))

    def run_with(self, cameras):
        self.state.write_text(json.dumps({"cameras": cameras}))
        return floods.live_floods(self.state, self.cams, now=NOW)

    def test_only_watched_cameras_are_floods(self):
        got = self.run_with({"a": watch(30, last_min=1), "c": {"mode": "sweep", "peak": "deep"}})
        self.assertEqual([f["camera_id"] for f in got["floods"]], ["a"])
        f = got["floods"][0]
        self.assertEqual((f["minutes"], f["stale"], f["latest"]["depth"]), (30, False, "flooded"))
        self.assertEqual(f["latest"]["image_url"], "/media/data/flood_watch/frames/a/20261001/104401_read.jpg")

    def test_a_watch_without_new_reads_goes_stale(self):
        """Pham Van Chieu - Duong so 59, 1 Oct: one read, then the same frame for 90 min."""
        got = self.run_with({"a": watch(90, last_min=floods.STALE_MINUTES + 1)})
        self.assertTrue(got["floods"][0]["stale"])

    def test_a_watch_written_before_last_read_existed_falls_back_to_its_start(self):
        f = self.run_with({"a": watch(5)})["floods"][0]
        self.assertFalse(f["stale"])
        self.assertEqual(f["latest"]["depth"], "flooded")

    def test_live_floods_come_before_stale_ones(self):
        got = self.run_with({"a": watch(90, last_min=60), "b": watch(10, last_min=1)})
        self.assertEqual([f["camera_id"] for f in got["floods"]], ["b", "a"])

    def test_an_unservable_frame_path_is_left_out(self):
        f = self.run_with({"a": watch(5, last_min=1, frame="/tmp/elsewhere/x_read.jpg")})["floods"][0]
        self.assertIsNone(f["latest"]["image_url"])

    def test_no_state_file_says_so(self):
        got = floods.live_floods(Path(self.temp.name) / "missing.json", self.cams, now=NOW)
        self.assertEqual((got["floods"], got["collector"], got["watched_cameras"]), ([], "missing", 3))

    # -- flood alerts: rain around a flood-prone spot while the river is high --------------------
    def alerts_with(self, level, rain="Medium", watching=False):
        sample = [{"lat": 10.80 + d, "lon": 106.71, "rain": rain, "captured_at": (NOW - timedelta(minutes=5)).isoformat()}
                  for d in (0.005, 0.01, 0.015)]
        rs = Path(self.temp.name) / "sample.json"
        rs.write_text(json.dumps(sample))
        self.state.write_text(json.dumps({"cameras": {"a": watch(5, last_min=1)} if watching else {}}))
        tide = lambda now: {"available": level is not None, "level_m": level, "trend": "rising", "next_high": None}
        return floods.live_floods(self.state, self.cams, now=NOW, tide_fn=tide, rain_sample_path=rs)

    def test_rain_on_a_high_river_warns(self):
        got = self.alerts_with(1.45)
        self.assertTrue(got["tide"]["high"])
        self.assertIn("a", [a["camera_id"] for a in got["alerts"]])  # Ung Van Khiem, 10.80 N, with rain around it

    def test_rain_on_a_low_river_does_not(self):
        got = self.alerts_with(0.9)
        self.assertFalse(got["tide"]["high"])
        self.assertEqual(got["alerts"], [])

    def test_a_high_river_without_rain_does_not(self):
        self.assertEqual(self.alerts_with(1.6, rain="No")["alerts"], [])

    def test_a_flood_already_seen_is_not_also_a_warning(self):
        got = self.alerts_with(1.45, watching=True)
        self.assertNotIn("a", [a["camera_id"] for a in got["alerts"]])
        self.assertEqual([f["camera_id"] for f in got["floods"]], ["a"])

    def test_no_river_level_no_warnings(self):
        self.assertEqual(self.alerts_with(None)["alerts"], [])

    def test_route(self):
        from fastapi.testclient import TestClient
        from app.main import app
        r = TestClient(app).get("/api/rain-map/floods")
        self.assertEqual(r.status_code, 200)
        self.assertIn("floods", r.json())


if __name__ == "__main__":
    unittest.main()
