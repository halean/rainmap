"""Metro Line 1 timetable fetch and daily cache (app/services/metro.py)."""

import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import requests

from app.services import metro

GOOD = {"7003": ["05:00", "05:15"], "7004": ["05:02", "05:17"]}


class ParseTests(unittest.TestCase):
    def test_accepts_a_real_shaped_response(self):
        self.assertEqual(metro.parse_trips(GOOD), GOOD)

    def test_rejects_empty_or_ragged(self):
        for bad in ({}, "", {"7003": ["05:00"], "7004": ["05:02", "05:17"]}, {"7003": ["5:00"]}):
            with self.assertRaises(metro.TimetableUnavailable):
                metro.parse_trips(bad)


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()) / "tt.json"
        self.calls = 0

    def fetcher(self):
        self.calls += 1
        return {"1": GOOD, "2": GOOD}

    def test_fetches_once_per_local_day(self):
        day = datetime(2026, 9, 26, 10, 0, tzinfo=metro.ICT)
        a = metro.timetable(now=day, store=self.tmp, fetcher=self.fetcher)
        b = metro.timetable(now=day.replace(hour=22), store=self.tmp, fetcher=self.fetcher)
        self.assertEqual(self.calls, 1)
        self.assertEqual(a["date"], "2026-09-26")
        self.assertEqual(b["directions"]["1"], GOOD)
        metro.timetable(now=datetime(2026, 9, 27, 0, 5, tzinfo=metro.ICT), store=self.tmp, fetcher=self.fetcher)
        self.assertEqual(self.calls, 2)

    def test_serves_yesterdays_copy_marked_stale_if_the_api_fails(self):
        metro.timetable(now=datetime(2026, 9, 26, 10, 0, tzinfo=metro.ICT), store=self.tmp, fetcher=self.fetcher)
        def down():
            raise requests.ConnectionError("down")
        r = metro.timetable(now=datetime(2026, 9, 27, 10, 0, tzinfo=metro.ICT), store=self.tmp, fetcher=down)
        self.assertTrue(r["stale"])
        self.assertEqual(r["date"], "2026-09-26")

    def test_no_copy_and_no_api_is_an_error(self):
        def down():
            raise requests.ConnectionError("down")
        with self.assertRaises(metro.TimetableUnavailable):
            metro.timetable(now=datetime(2026, 9, 26, tzinfo=metro.ICT), store=self.tmp, fetcher=down)


if __name__ == "__main__":
    unittest.main()
