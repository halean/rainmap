import csv
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.services.vrain import infer_resets, rain_density, read_history

UTC = timezone.utc


class GaugeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "gauges.csv"
        self.start = datetime(2026, 9, 14, 12, tzinfo=UTC)

    def write(self, rows):
        with self.path.open("w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["fetched_at", "station", "lat", "lon", "depth_mm", "level"])
            writer.writerows((t.isoformat(), name, 10.8, 106.7, value, "") for t, name, value in rows)

    def sequence(self, values, name="A", start=None):
        return [( (start or self.start) + timedelta(minutes=10 * i), name, v) for i, v in enumerate(values)]

    def test_increases_plateaus_and_float_noise(self):
        self.write(self.sequence([0, 1, 1, 1.0000000001, 2, 2, 2]))
        result = rain_density(self.path, hours=1, at=self.start + timedelta(hours=1))
        self.assertEqual(result["points"][0]["rain_mm"], 2)
        self.assertEqual(result["points"][0]["coverage"], 1)
        self.assertFalse(result["points"][0]["partial"])

    def test_repeated_reset_and_single_correction(self):
        rows = []
        for day in range(2):
            for name in "ABC":
                rows += self.sequence([10, 0, 1], name, self.start + timedelta(days=day, minutes=50))
        # A single synchronized correction in the morning is not a daily reset.
        for name in "ABC":
            rows += self.sequence([4, 2], name, self.start - timedelta(hours=11))
        self.write(rows)
        reset = infer_resets(read_history(self.path))
        self.assertEqual([r["local_hour"] for r in reset["daily"]], [20])
        self.assertEqual(reset["daily"][0]["days_observed"], 2)
        result = rain_density(self.path, hours=1, at=self.start + timedelta(days=1, hours=1, minutes=10))
        self.assertTrue(all(p["rain_mm"] is None for p in result["points"]))

    def test_decrease_and_long_gap_do_not_create_rain(self):
        self.write(self.sequence([10, 3, 4]) + [(self.start + timedelta(hours=1), "A", 20)])
        point = rain_density(self.path, hours=1, at=self.start + timedelta(hours=1))["points"][0]
        self.assertEqual(point["rain_mm"], 1)
        self.assertEqual(point["excluded_intervals"], 2)
        self.assertTrue(point["partial"])

    def test_station_staleness(self):
        self.write(self.sequence([0, 1], "A") + self.sequence([0] * 7, "B"))
        result = rain_density(self.path, hours=1, at=self.start + timedelta(hours=1))
        point = next(p for p in result["points"] if p["station"] == "A")
        self.assertTrue(point["stale"])
        self.assertIsNone(point["rain_mm"])

    def test_invalid_rows_sort_duplicates_and_cache_refresh(self):
        rows = self.sequence([0, 1, 2])
        self.write(list(reversed(rows)) + [rows[1]])
        with self.path.open("a") as f:
            f.write("bad,row\n2026-09-14T12:00:00+00:00,X,nan,106,4,\n")
        self.assertEqual(len(read_history(self.path)["A"]), 3)
        first = rain_density(self.path)
        self.write(self.sequence([0, 1, 2, 3]))
        self.assertNotEqual(rain_density(self.path)["latest"], first["latest"])

    def test_missing_history_and_api_validation(self):
        result = rain_density(self.path)
        self.assertEqual(result["points"], [])
        self.assertTrue(result["stale"])
        with TestClient(app) as client:
            for query in ("hours=0", "hours=25", "at=2026-09-14T12:00:00", "at=oops"):
                self.assertEqual(client.get("/api/rain-map/vrain?" + query).status_code, 422)
            with patch("app.routes.rain_density", return_value=result):
                self.assertEqual(client.get("/api/rain-map/vrain").json(), result)
            self.assertEqual(client.get("/rain-map").status_code, 200)
            self.assertEqual(client.get("/media/app/static/vrain.js").status_code, 200)

    def test_historical_query_does_not_use_later_rain(self):
        self.write(self.sequence([0, 0, 0, 0, 0, 0, 9]))
        result = rain_density(self.path, hours=1, at=self.start + timedelta(minutes=50))
        self.assertEqual(result["points"][0]["rain_mm"], 0)


if __name__ == "__main__":
    unittest.main()
