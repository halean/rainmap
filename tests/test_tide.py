"""The official tide bulletin (kttvnb.vn) parsed, and the level between its highs and lows."""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import tide
from scripts.tide_poller import BULLETIN_RE, next_poll, parse_bulletin

FIXTURE = Path(__file__).parent / "fixtures" / "kttvnb_tide_20261001.txt"  # bulletin 274/2026
ICT = timezone(timedelta(hours=7))


class ParseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = parse_bulletin(FIXTURE.read_text())

    def test_issue_time_and_alert_levels(self):
        self.assertEqual(self.p["issued_at"], "2026-10-01T08:59:00+07:00")
        self.assertEqual(self.p["alert_levels_m"], {"I": 1.40, "II": 1.50, "III": 1.60})

    def test_measured_extremes_of_the_day_before(self):
        pa = self.p["stations"]["phu_an"]["observed"]
        self.assertEqual([(e["t"][11:16], e["h"], e["kind"]) for e in pa],
                         [("00:00", -0.82, "low"), ("05:00", 1.50, "high"), ("13:00", -1.56, "low"), ("19:00", 1.49, "high")])

    def test_forecast_alternates_high_and_low(self):
        """Times are on the row's own date: Phu An 01/10 lists lows at 14:00 and 01:00, and only
        reading 01:00 as that morning keeps low, high, low, high."""
        for key in ("phu_an", "nha_be", "thu_dau_mot"):
            kinds = [e["kind"] for e in self.p["stations"][key]["forecast"]]
            self.assertTrue(all(a != b for a, b in zip(kinds, kinds[1:])), key)

    def test_ct_means_no_second_extreme(self):
        """Phu An 05/10 has 'ct' for its second high: four extremes on the other days, three that day."""
        days = [e["t"][:10] for e in self.p["stations"]["phu_an"]["forecast"]]
        self.assertEqual(days.count("2026-10-05"), 3)
        self.assertEqual(days.count("2026-10-01"), 4)


class BulletinLinkTests(unittest.TestCase):
    """The HCMC bulletin goes out under two titles; 8-9 Oct 2026 used the second and were missed."""

    def test_both_titles_are_found_and_others_are_not(self):
        html = "".join(f'<a href="/index.php/thong-tin-kttv/thuy-van/100-thong-tin-kttv/thuy-van/{slug}">x</a>' for slug in (
            "29315-ba-n-tin-da-ba-o-tha-y-v-n-tphcm-ra-nga-y-10-10-2026",
            "29301-ba-n-tin-da-ba-o-tha-y-v-n-ha-n-nga-n-khu-va-c-tp-ha-cha-minh-ra-nga-y-09-10-2026",
            "29302-tin-tria-u-c-a-ng-tra-n-sa-ng-sa-i-ga-n-ra-nga-y-09-10-2026",
            "29303-ba-n-tin-da-ba-o-ha-i-v-n-va-ng-bia-n-tp-ha-cha-minh-10-nga-y-ta-i-nga-y-09-10-2026"))
        self.assertEqual([f[1] for f in BULLETIN_RE.findall(html)], ["29315", "29301"])


class ScheduleTests(unittest.TestCase):
    def next(self, h, m, have_today=False):
        return next_poll(datetime(2026, 10, 1, h, m, tzinfo=ICT), have_today).strftime("%d %H:%M")

    def test_first_look_just_after_the_earliest_upload(self):
        self.assertEqual(self.next(0, 5), "01 09:30")
        self.assertEqual(self.next(9, 29), "01 09:30")

    def test_retries_every_half_hour_until_it_is_online(self):
        """1 Oct's bulletin went online at 11:26; the 11:30 look finds it."""
        self.assertEqual(self.next(9, 30), "01 10:00")
        self.assertEqual(self.next(11, 0), "01 11:30")
        self.assertEqual(self.next(13, 31), "01 14:00")

    def test_gives_up_at_two_and_waits_for_tomorrow(self):
        self.assertEqual(self.next(14, 0), "02 09:30")
        self.assertEqual(self.next(21, 10), "02 09:30")

    def test_once_today_is_in_nothing_until_tomorrow(self):
        self.assertEqual(self.next(11, 30, have_today=True), "02 09:30")

    def test_a_utc_clock_is_converted(self):
        self.assertEqual(next_poll(datetime(2026, 10, 1, 2, 40, tzinfo=timezone.utc), False).isoformat(),
                         "2026-10-01T10:00:00+07:00")  # 09:40 ICT


class LevelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "tide.json"
        self.path.write_text(json.dumps(parse_bulletin(FIXTURE.read_text())))

    def at(self, y, mo, d, h, mi=0):
        return tide.tide_now(self.path, now=datetime(y, mo, d, h, mi, tzinfo=ICT))

    def test_level_at_a_turning_point_is_the_forecast(self):
        self.assertAlmostEqual(self.at(2026, 10, 1, 20)["level_m"], 1.42, places=3)

    def test_midway_is_the_mean_and_the_trend_follows(self):
        got = self.at(2026, 10, 1, 17)  # 14:00 low -1.66 -> 20:00 high 1.42
        self.assertAlmostEqual(got["level_m"], (-1.66 + 1.42) / 2, places=3)
        self.assertEqual(got["trend"], "rising")
        self.assertEqual(got["next_high"]["h"], 1.42)

    def test_measured_day_before_is_used(self):
        got = self.at(2026, 9, 30, 19)
        self.assertAlmostEqual(got["level_m"], 1.49, places=3)

    def test_outside_the_bulletin_is_unavailable_not_a_guess(self):
        got = self.at(2026, 10, 9, 12)
        self.assertFalse(got["available"])
        self.assertTrue(got["bulletin"]["stale"])

    def test_missing_file(self):
        self.assertFalse(tide.tide_now(Path(self.temp.name) / "none.json")["available"])


if __name__ == "__main__":
    unittest.main()
