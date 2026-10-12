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
    {"camera_id": "d", "name": "Nguyen Van Linh - Nguyen Thi Thap 2", "lat": 10.74, "lon": 106.70,
     "why": ["official tide street"]},
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
        self.assertEqual((got["floods"], got["collector"], got["watched_cameras"]), ([], "missing", 4))

    # -- flood alerts: rain around a flood-prone spot while the river is high --------------------
    def alerts_with(self, level, rain="Medium", watching=False, highs=()):
        sample = [{"lat": 10.80 + d, "lon": 106.71, "rain": rain, "captured_at": (NOW - timedelta(minutes=5)).isoformat()}
                  for d in (0.005, 0.01, 0.015)]
        rs = Path(self.temp.name) / "sample.json"
        rs.write_text(json.dumps(sample))
        self.state.write_text(json.dumps({"cameras": {"a": watch(5, last_min=1)} if watching else {}}))
        tide = lambda now: {"available": level is not None, "level_m": level, "trend": "rising", "next_high": None}
        return floods.live_floods(self.state, self.cams, now=NOW, tide_fn=tide, rain_sample_path=rs,
                                  highs_fn=lambda: list(highs))

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

    # -- tide window: the flood watch reads the tide streets; the map reports what it saw -----------
    def high(self, minutes_from_now, h):
        return {"t": NOW + timedelta(minutes=minutes_from_now), "h": h, "source": "forecast"}

    def tide_run(self, highs, reads=None):
        """reads: {camera_id: (minutes ago, depth)} written as the flood watch's last reads."""
        cams = {cid: {"mode": "sweep", "last_read": {"read_at": (NOW - timedelta(minutes=m)).isoformat(),
                                                     "depth": d, "usable": True}}
                for cid, (m, d) in (reads or {}).items()}
        self.state.write_text(json.dumps({"cameras": cams}))
        tide = lambda now: {"available": True, "level_m": 0.9, "trend": "rising", "next_high": None}
        rs = Path(self.temp.name) / "sample.json"
        rs.write_text("[]")
        return floods.live_floods(self.state, self.cams, now=NOW, tide_fn=tide, rain_sample_path=rs,
                                  highs_fn=lambda: list(highs))

    def test_a_high_tide_reports_what_the_tide_street_reads_saw(self):
        """10 Oct: Nguyễn Thị Thập 2 under water in sunshine around a 1.65 m Nhà Bè high."""
        got = self.tide_run([self.high(30, 1.65)], {"d": (5, "flooded")})
        tw = got["tide"]["tide_window"]
        self.assertEqual(tw["high_m"], 1.65)
        self.assertEqual((tw["vision"]["tide_streets"], tw["vision"]["read"]), (1, 1))
        self.assertEqual([w["camera_id"] for w in tw["vision"]["water"]], ["d"])

    def test_no_warning_without_a_sighting(self):
        """The tide alone puts nothing on the map; only what a camera shows does."""
        got = self.tide_run([self.high(0, 1.7)], {"d": (5, "none")})
        self.assertEqual(got["alerts"], [])
        self.assertEqual(got["tide"]["tide_window"]["vision"]["water"], [])

    def test_reads_from_before_the_window_do_not_count(self):
        got = self.tide_run([self.high(0, 1.7)], {"d": (floods.TIDE_BEFORE_MIN + 5, "flooded")})
        self.assertEqual(got["tide"]["tide_window"]["vision"]["read"], 0)

    def test_a_lower_high_tide_opens_no_window(self):
        """9 Oct: a 1.52 m Nhà Bè high left the junction dry."""
        self.assertIsNone(self.tide_run([self.high(0, 1.52)])["tide"]["tide_window"])

    def test_the_window_opens_before_the_high_and_closes_after(self):
        before, after = floods.TIDE_BEFORE_MIN, floods.TIDE_AFTER_MIN
        self.assertIsNotNone(floods.tide_window([self.high(before - 1, 1.7)], NOW))
        self.assertIsNone(floods.tide_window([self.high(before + 1, 1.7)], NOW))
        self.assertIsNotNone(floods.tide_window([self.high(-(after - 1), 1.7)], NOW))
        self.assertIsNone(floods.tide_window([self.high(-(after + 1), 1.7)], NOW))

    # -- a camera's recent frames for the risk map's popups --------------------------------------
    def frames_setup(self):
        root = Path(self.temp.name) / "frames"
        for day, names in (("20261009", ["235900.jpg"]), ("20261010", ["093200_read.jpg", "093300.jpg"])):
            (root / "d" / day).mkdir(parents=True, exist_ok=True)
            for n in names:
                (root / "d" / day / n).write_bytes(b"x")
        reads = Path(self.temp.name) / "reads.csv"
        frame = str(root / "d" / "20261010" / "093200_read.jpg")
        reads.write_text("read_at,camera_id,name,reason,frame,usable,depth,wakes,stalled,flooding,mode_after,rain_fresh,rain_yes,justification\n"
                         f"2026-10-10T09:32:00+00:00,d,x,high tide,{frame},True,shallow sheet,False,False,False,sweep,,,A thin sheet.\n")
        return root, reads

    def test_frames_come_newest_first_with_their_reads(self):
        root, reads = self.frames_setup()
        got = floods.camera_frames("d", 6, self.cams, root, reads)
        self.assertEqual([f["captured_at"][:16] for f in got["frames"]], ["2026-10-10T09:33", "2026-10-10T09:32", "2026-10-09T23:59"])
        self.assertIsNone(got["frames"][0]["read"])
        self.assertEqual(got["frames"][1]["read"]["depth"], "shallow sheet")
        self.assertEqual(got["why"], ["official tide street"])

    def test_frames_only_for_flood_watch_cameras(self):
        root, reads = self.frames_setup()
        self.assertIsNone(floods.camera_frames("../d", 6, self.cams, root, reads))

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
