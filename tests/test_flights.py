"""Tân Sơn Nhất arrivals/departures behind the 3D runway animation.

app/services/tia.py's own tests cover scraped-row parsing; this file covers
what app/services/flights.py does with the poller's merged output --
preferring it while fresh, falling back to a labelled sample when it isn't --
plus the METAR-driven runway choice, which is independent of the schedule
source.
"""

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.services import flights

UTC = timezone.utc


class WindTests(unittest.TestCase):
    def test_runway_direction_follows_headwind_and_calm_default(self):
        self.assertEqual(flights.runway_direction(260, 8), "25")
        self.assertEqual(flights.runway_direction(40, 8), "07")
        self.assertEqual(flights.runway_direction(90, 3), "25")   # calm: assumed 25
        self.assertEqual(flights.runway_direction(None, 10), "25")

    def test_metar_parse_handles_variable_wind(self):
        wind = flights.parse_metar([{"rawOb": "METAR VVTS VRB02KT", "wdir": "VRB", "wspd": 2, "obsTime": 1790031600}])
        self.assertIsNone(wind["dir"])
        self.assertEqual(wind["runway_direction"], "25")
        self.assertEqual(wind["observed"], "2026-09-21T23:00:00Z")
        with self.assertRaises(flights.FlightsUnavailable):
            flights.parse_metar([])


class TiaReadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "flights_tia.json"
        self.now = datetime(2026, 9, 22, 7, 0, tzinfo=UTC)

    def write(self, generated_at, flights_list):
        self.path.write_text(json.dumps({"generated_at": generated_at, "flights": flights_list}))

    def test_fresh_scrape_is_used_and_sorted_by_time(self):
        self.write("2026-09-22T06:58:00Z", [
            {"id": "b", "time": "2026-09-22T08:00:00Z"},
            {"id": "a", "time": "2026-09-22T07:30:00Z"},
        ])
        result, note = flights.read_tia(self.now, path=self.path)
        self.assertIsNone(note)
        self.assertEqual([f["id"] for f in result["flights"]], ["a", "b"])

    def test_stale_scrape_is_rejected_with_a_reason(self):
        self.write("2026-09-22T06:00:00Z", [{"id": "a", "time": "2026-09-22T07:30:00Z"}])
        result, note = flights.read_tia(self.now, path=self.path, stale_after_minutes=14)
        self.assertIsNone(result)
        self.assertIn("60 min ago", note)

    def test_missing_file_is_reported_not_raised(self):
        result, note = flights.read_tia(self.now, path=self.path)
        self.assertIsNone(result)
        self.assertIn("tia_poller", note)

    def test_fresh_but_genuinely_empty_scrape_is_not_the_same_as_missing(self):
        self.write("2026-09-22T06:59:00Z", [])
        result, note = flights.read_tia(self.now, path=self.path)
        self.assertIsNone(note)
        self.assertEqual(result["flights"], [])


class StatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.tia_path = Path(self.temp.name) / "flights_tia.json"
        for name, value in (("FLIGHTS_STORE", Path(self.temp.name) / "cache"), ("TIA_STORE_PATH", self.tia_path)):
            patcher = patch.object(flights, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.now = datetime(2026, 9, 22, 1, 0, tzinfo=UTC)
        self.metar = [{"rawOb": "METAR VVTS 220000Z 26004KT", "wdir": 260, "wspd": 4, "reportTime": "2026-09-22T00:00:00.000Z"}]

    def fake_metar_get(self):
        metar = self.metar

        def get(url, **kwargs):
            class R:
                status_code = 200

                def raise_for_status(self):
                    pass

                def json(self):
                    return metar
            return R()
        return get

    def test_fresh_tia_scrape_is_preferred_over_sample(self):
        self.tia_path.write_text(json.dumps({
            "generated_at": "2026-09-22T00:58:00Z",
            "flights": [{"id": "tia:arrival:ArrDom:VN 1:2026-09-22T01:30:00Z", "time": "2026-09-22T01:30:00Z"}],
        }))
        with patch.object(flights.requests, "get", self.fake_metar_get()):
            got = flights.status(self.now)
        self.assertEqual(got["source"]["provider"], "tia")
        self.assertFalse(got["source"]["sample"])
        self.assertIsNone(got["source"]["error"])
        self.assertEqual(len(got["flights"]), 1)
        self.assertEqual(got["wind"]["runway_direction"], "25")

    def test_missing_or_stale_scrape_falls_back_to_labelled_sample(self):
        with patch.object(flights.requests, "get", self.fake_metar_get()):
            got = flights.status(self.now)
        self.assertEqual(got["source"]["provider"], "sample")
        self.assertTrue(got["source"]["sample"])
        self.assertIsNotNone(got["source"]["error"])
        self.assertTrue(got["flights"])
        self.assertTrue(all(f["time_source"] == "sample" and f["number"].startswith("SAMPLE") for f in got["flights"]))

    def test_route_serves_runways_and_sample(self):
        with patch.object(flights.requests, "get", self.fake_metar_get()):
            response = TestClient(app).get("/api/rain-map/flights")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual([r["name"] for r in body["runways"]], ["07L/25R", "07R/25L"])
        self.assertEqual(body["airport"]["icao"], "VVTS")
        self.assertEqual(body["default_runway"], {"arrival": "07L/25R", "departure": "07R/25L"})
        self.assertEqual(body["source"]["provider"], "sample")


if __name__ == "__main__":
    unittest.main()
