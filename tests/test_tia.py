"""Parsing and merging for the Tan Son Nhat flight-board scrape.

No browser here -- app/services/tia.py is pure data transforms over the cell
text scripts/tia_poller.py reads from the live grid, so these fixtures are
literal copies of rows this module has actually returned.
"""

import unittest
from datetime import datetime, timedelta, timezone

from app.services import tia

UTC = timezone.utc


class StatusTests(unittest.TestCase):
    def test_vietnamese_and_english_remarks_map_to_the_same_status(self):
        pairs = [
            ("Đã hạ cánh", "Landed", "Arrived"),
            ("Đến trễ", "Delayed", "Delayed"),
            ("Hành khách cuối lên tàu bay", "Last boarding", "GateClosed"),
            ("Đóng cửa khởi hành", "Gate closed", "GateClosed"),
            ("Hành khách lên tàu bay", "Boarding", "Boarding"),
            ("Mời hành khách làm thủ tục", "Check-in", "CheckIn"),
        ]
        for vi, en, expected in pairs:
            self.assertEqual(tia.status_of(vi), expected, vi)
            self.assertEqual(tia.status_of(en), expected, en)

    def test_unknown_and_empty_remarks(self):
        self.assertEqual(tia.status_of(""), "Unknown")
        self.assertEqual(tia.status_of(None), "Unknown")
        self.assertEqual(tia.status_of("something never seen before"), "Expected")


class RowParsingTests(unittest.TestCase):
    def test_arrival_and_departure_column_counts(self):
        arrival = tia.parse_row("arrival", ["12:00", "14:30", "Hải Phòng", "VJ 1281", "1", "3", "Đã hạ cánh"])
        self.assertEqual(arrival["other"], "Hải Phòng")
        self.assertEqual(arrival["belt"], "3")
        departure = tia.parse_row("departure", ["13:05", "16:00", "Hải Phòng", "9G 1514", "3", "32-46", "5", "Mời hành khách làm thủ tục"])
        self.assertEqual(departure["gate"], "5")
        self.assertEqual(departure["row"], "32-46")

    def test_wrong_column_count_is_skipped_not_misread(self):
        self.assertIsNone(tia.parse_row("arrival", ["12:00", "14:30", "Hải Phòng"]))
        self.assertIsNone(tia.parse_row("departure", ["1", "2", "3", "4", "5", "6", "7"]))

    def test_truncated_codeshare_cell_keeps_the_operating_flight(self):
        row = tia.parse_row("departure", ["14:25", "14:45", "SINGAPORE", "AY 6252,EY7311,GA9605,K63655,SQ", "2", "C-D", "9", "Đóng cửa khởi hành"])
        now = datetime(2026, 9, 22, 7, 0, tzinfo=UTC)
        flight = tia.normalize_row("departure", "DepInt", row, now)
        self.assertEqual(flight["number"], "AY 6252")
        self.assertEqual(flight["codeshare_raw"], "AY 6252,EY7311,GA9605,K63655,SQ")


class TimeTests(unittest.TestCase):
    def test_etd_wins_over_std_and_scheduled_falls_back(self):
        now = datetime(2026, 9, 22, 7, 0, tzinfo=UTC)  # 14:00 ICT
        row = tia.parse_row("arrival", ["13:10", "14:45", "Hà Nội", "VN 211", "3", "2", "Đã hạ cánh"])
        flight = tia.normalize_row("arrival", "ArrDom", row, now)
        self.assertEqual(flight["time"], "2026-09-22T07:45:00Z")  # 14:45 ICT
        self.assertEqual(flight["time_source"], "estimated")
        self.assertEqual(flight["scheduled"], "2026-09-22T06:10:00Z")

        no_etd = tia.parse_row("arrival", ["13:10", "", "Hà Nội", "VN 211", "3", "2", ""])
        flight2 = tia.normalize_row("arrival", "ArrDom", no_etd, now)
        self.assertEqual(flight2["time_source"], "scheduled")
        self.assertEqual(flight2["time"], flight2["scheduled"])

    def test_missing_std_and_etd_yields_no_flight(self):
        row = tia.parse_row("arrival", ["", "", "Hà Nội", "VN 211", "3", "2", ""])
        now = datetime(2026, 9, 22, 7, 0, tzinfo=UTC)
        self.assertIsNone(tia.normalize_row("arrival", "ArrDom", row, now))

    def test_departure_time_gets_taxi_out_but_scheduled_field_does_not(self):
        # The board's STD/ETD are gate times; the animation's `time` needs the
        # take-off instant, so only `time` is shifted by DEPARTURE_TAXI_OUT.
        now = datetime(2026, 9, 22, 7, 0, tzinfo=UTC)
        row = tia.parse_row("departure", ["13:05", "16:00", "Hải Phòng", "9G 1514", "3", "32-46", "5", ""])
        flight = tia.normalize_row("departure", "DepDom", row, now)
        self.assertEqual(flight["revised"], "2026-09-22T09:00:00Z")  # 16:00 ICT, unshifted
        self.assertEqual(flight["time"], "2026-09-22T09:15:00Z")     # +15 min taxi-out
        self.assertEqual(flight["time_source"], "estimated")

        no_etd = tia.parse_row("departure", ["13:05", "", "Hải Phòng", "9G 1514", "3", "32-46", "5", ""])
        flight2 = tia.normalize_row("departure", "DepDom", no_etd, now)
        self.assertEqual(flight2["scheduled"], "2026-09-22T06:05:00Z")
        self.assertEqual(flight2["time"], "2026-09-22T06:20:00Z")

    def test_clock_time_near_midnight_rolls_to_the_nearer_day(self):
        # Arrivals here, not departures, to isolate day-rollover from the
        # separate departure taxi-out offset (covered above).
        # 23:55 ICT: a 00:10 STD is 15 min in the future (tomorrow), not 23h45m ago (today).
        now = datetime(2026, 9, 22, 16, 55, tzinfo=UTC)
        row = tia.parse_row("arrival", ["00:10", "", "Hà Nội", "VN 1", "3", "1", ""])
        flight = tia.normalize_row("arrival", "ArrDom", row, now)
        self.assertEqual(flight["time"], "2026-09-22T17:10:00Z")  # 00:10 ICT Sept 23 == 17:10 UTC Sept 22

        # 00:20 ICT: a 23:50 STD is 30 min in the past (today), not tomorrow.
        now2 = datetime(2026, 9, 22, 17, 20, tzinfo=UTC)
        row2 = tia.parse_row("arrival", ["23:50", "", "Hà Nội", "VN 1", "3", "1", ""])
        flight2 = tia.normalize_row("arrival", "ArrDom", row2, now2)
        self.assertEqual(flight2["time"], "2026-09-22T16:50:00Z")


class GridAndMergeTests(unittest.TestCase):
    def test_malformed_row_does_not_drop_the_rest_of_the_poll(self):
        cells = [
            ["12:00", "14:30", "Hải Phòng", "VJ 1281", "1", "3", "Đã hạ cánh"],
            ["truncated", "row"],
            ["14:05", "14:20", "Phú Quốc", "VJ 338", "1", "2", "Đã hạ cánh"],
        ]
        now = datetime(2026, 9, 22, 7, 0, tzinfo=UTC)
        flights = tia.rows_from_grid("ArrVJ", cells, now)
        self.assertEqual([f["number"] for f in flights], ["VJ 1281", "VJ 338"])

    def test_merge_updates_seen_flights_and_keeps_unseen_ones_until_stale(self):
        now = datetime(2026, 9, 22, 7, 0, tzinfo=UTC)
        first = tia.rows_from_grid("ArrVJ", [["12:00", "14:30", "Hải Phòng", "VJ 1281", "1", "3", "Đã hạ cánh"]], now)
        merged1 = tia.merge([], first, now)
        self.assertEqual(len(merged1), 1)

        later = now + timedelta(minutes=6)
        second = tia.rows_from_grid("ArrDom", [["13:00", "13:30", "Hà Nội", "VN 1", "3", "1", "Đã hạ cánh"]], later)
        merged2 = tia.merge(merged1, second, later)
        self.assertEqual({f["number"] for f in merged2}, {"VJ 1281", "VN 1"})  # VJ 1281 survives unseen

    def test_merge_drops_a_flight_not_reseen_within_the_staleness_window(self):
        now = datetime(2026, 9, 22, 7, 0, tzinfo=UTC)
        first = tia.rows_from_grid("ArrVJ", [["12:00", "14:30", "Hải Phòng", "VJ 1281", "1", "3", "Đã hạ cánh"]], now)
        merged1 = tia.merge([], first, now)
        much_later = now + timedelta(minutes=25)
        merged2 = tia.merge(merged1, [], much_later, stale_after_minutes=tia.STALE_AFTER_MINUTES)
        self.assertEqual(merged2, [])

    def test_a_reseen_flight_replaces_rather_than_duplicates(self):
        now = datetime(2026, 9, 22, 7, 0, tzinfo=UTC)
        row = [["12:00", "14:30", "Hải Phòng", "VJ 1281", "1", "3", "Đã hạ cánh"]]
        merged1 = tia.merge([], tia.rows_from_grid("ArrVJ", row, now), now)
        later = now + timedelta(minutes=1)
        row2 = [["12:00", "14:35", "Hải Phòng", "VJ 1281", "1", "3", "Đến trễ"]]
        merged2 = tia.merge(merged1, tia.rows_from_grid("ArrVJ", row2, later), later)
        self.assertEqual(len(merged2), 1)
        self.assertEqual(merged2[0]["status"], "Delayed")


if __name__ == "__main__":
    unittest.main()
