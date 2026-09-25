"""Parsing the southern pilots' daily plan (app/services/pilot_plan.py), against
a real page saved on 2026-09-26 with the pilots' names blanked."""

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from app.services import pilot_plan as pp

FIXTURE = Path(__file__).parent / "fixtures" / "pilot_plan_2026-09-26.html"


class ParseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = FIXTURE.read_text(encoding="utf-8")
        cls.plan = pp.parse(cls.page, pp.load_berths())
        cls.today = cls.plan["days"][0]["movements"]

    def test_two_days_newest_first_with_all_three_kinds(self):
        self.assertEqual([d["date"] for d in self.plan["days"]], ["2026-09-26", "2026-09-25"])
        for d in self.plan["days"]:
            self.assertEqual({m["kind"] for m in d["movements"]}, {"inbound", "outbound", "shift"})

    def test_first_inbound_ship_as_published(self):
        m = self.today[0]
        self.assertEqual((m["vessel"], m["draft_m"], m["length_m"], m["grt"]), ("HANSA BREITENBURG", 9.3, 175.0, 18285.0))
        self.assertEqual(m["berth"]["name"], "SP-ITC (Phú Hữu)")
        self.assertEqual(m["eta"], "2026-09-26T01:00:00+07:00")

    def test_shift_has_from_and_to(self):
        shift = next(m for m in self.today if m["kind"] == "shift" and m["berth_raw"] == "CALTEX 2 - N.BE")
        self.assertIsNone(shift["from"])            # CALTEX 2 is not placed
        self.assertEqual(shift["to"]["code"], "N.BE")

    def test_status_flags_including_the_decomposed_unicode_one(self):
        flags = lambda key: sum(m[key] for d in self.plan["days"] for m in d["movements"])
        self.assertEqual(flags("postponed"), 4)
        self.assertEqual(flags("cancelled"), 8)
        self.assertGreater(flags("time_changed"), 0)

    def test_no_pilot_names_in_the_output(self):
        dumped = json.dumps(self.plan, ensure_ascii=False)
        self.assertNotIn("pilot\"", dumped.replace("pilot_boat", "").replace("pilot_changed", ""))
        for d in self.plan["days"]:
            for m in d["movements"]:
                self.assertNotRegex(m["notes"], r"HT\s+(?!đổi tàu)\S+ đổi tàu")


    def test_no_phone_numbers_in_the_output(self):
        dumped = json.dumps(self.plan, ensure_ascii=False)
        self.assertNotRegex(dumped, r"(?<!\d)0\d{9}(?!\d)")
        self.assertEqual(pp.scrub("●(ĐX)ĐL 0906989455, CAPT +84987025493"), "●(ĐX)ĐL [phone], CAPT [phone]")


class BerthTests(unittest.TestCase):
    def setUp(self):
        self.berths = pp.load_berths()

    def test_codes_normalise(self):
        self.assertEqual(pp.normalise_code("H.LONG 2(NR)"), "H.LONG 2")
        self.assertEqual(pp.normalise_code("B20NR"), "B20")
        self.assertEqual(pp.normalise_code("N.BE 03"), "N.BE 3")
        self.assertEqual(pp.normalise_code("LONG AN (NEO)"), "LONG AN")

    def test_known_terminals_are_placed_and_unknown_codes_are_not(self):
        self.assertEqual(pp.locate("SPCT(NL)", self.berths)["name"], "SPCT (Hiệp Phước)")
        self.assertEqual(pp.locate("VICT 2", self.berths)["confidence"], "name")
        self.assertEqual(pp.locate("K12A", self.berths)["confidence"], "likely")
        for code in ("M2", "H.LONG 2", "SHELL 3", "BP11-CSG(NR)", "LONGAN(NEO)"):
            self.assertIsNone(pp.locate(code, self.berths), code)

    def test_shift_splitting(self):
        self.assertEqual(pp.split_berths("VT-02 - V.TAN 2", "shift"), ["VT-02", "V.TAN 2"])
        self.assertEqual(pp.split_berths("VK102-N.BE 2", "shift"), ["VK102", "N.BE 2"])
        self.assertEqual(pp.split_berths("VT-02", "shift"), ["VT-02"])
        self.assertEqual(pp.split_berths("VT-02", "inbound"), ["VT-02"])


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.store = Path(tempfile.mkdtemp()) / "plan.json"
        self.page = FIXTURE.read_text(encoding="utf-8")
        self.calls = 0

    def fetcher(self):
        self.calls += 1
        return self.page

    def test_refetches_only_after_the_refresh_interval(self):
        t = datetime(2026, 9, 26, 3, 0, tzinfo=timezone.utc)
        pp.plan(now=t, store=self.store, fetcher=self.fetcher)
        pp.plan(now=t + timedelta(minutes=10), store=self.store, fetcher=self.fetcher)
        self.assertEqual(self.calls, 1)
        pp.plan(now=t + pp.REFRESH + timedelta(minutes=1), store=self.store, fetcher=self.fetcher)
        self.assertEqual(self.calls, 2)

    def test_last_good_copy_served_stale_when_the_site_is_down(self):
        t = datetime(2026, 9, 26, 3, 0, tzinfo=timezone.utc)
        pp.plan(now=t, store=self.store, fetcher=self.fetcher)
        def down():
            raise requests.ConnectionError("down")
        r = pp.plan(now=t + timedelta(hours=2), store=self.store, fetcher=down)
        self.assertTrue(r["stale"])
        self.assertEqual(r["days"][0]["date"], "2026-09-26")


if __name__ == "__main__":
    unittest.main()
