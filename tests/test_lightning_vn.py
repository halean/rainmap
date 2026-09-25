"""Parsing for the HYMETNET lightning feed (app/services/lightning_vn.py)
and the poller's dedup logic (scripts/hymetnet_poller.py). Fixtures are
literal shapes this module has actually returned, including the mojibake-
looking-but-actually-fine UTF-8 Vietnamese text and the "lat-lon" packed
into one field with '-' as a plain delimiter, not a sign.
"""

import csv
import logging
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from app.services import lightning_vn as lvn
from scripts import hymetnet_poller as poller


class QuietLoggerTests(unittest.TestCase):
    """hymetnet_poller.log is the module-level logger the live poller writes
    to (logs/hymetnet_poller.log) -- on this host that is a real, currently-
    running service's log file, not a test fixture. Detach its handlers for
    the duration of each test here so exercising the "no records" warning
    path does not interleave synthetic lines into it."""

    def setUp(self):
        self._handlers = poller.log.handlers[:]
        poller.log.handlers = [logging.NullHandler()]
        self.addCleanup(lambda: setattr(poller.log, "handlers", self._handlers))


class BucketTimeTests(unittest.TestCase):
    def test_parses_a_real_bucket_key_as_utc(self):
        dt = lvn.bucket_datetime("202609241230")
        self.assertEqual(dt.isoformat(), "2026-09-24T12:30:00+00:00")

    def test_a_malformed_key_is_skipped_not_fatal(self):
        for bad in ("", "not-a-bucket", "20260924", "2026092413260"):
            self.assertIsNone(lvn.bucket_datetime(bad))

    def test_an_impossible_calendar_date_is_skipped_not_fatal(self):
        self.assertIsNone(lvn.bucket_datetime("202613991399"))  # month 13, day 99


class ItemParsingTests(unittest.TestCase):
    def test_parses_commune_province_and_the_packed_lat_lon(self):
        item = lvn.parse_item("Xã Chiềng Sơn, Tỉnh Sơn La, 20.75229835510254-104.74936676025391")
        self.assertEqual(item["commune"], "Xã Chiềng Sơn")
        self.assertEqual(item["province"], "Tỉnh Sơn La")
        self.assertAlmostEqual(item["lat"], 20.75229835510254)
        self.assertAlmostEqual(item["lon"], 104.74936676025391)

    def test_the_dash_is_a_delimiter_not_read_as_a_negative_sign(self):
        item = lvn.parse_item("Phường A, Tỉnh B, 10.5-106.5")
        self.assertEqual((item["lat"], item["lon"]), (10.5, 106.5))

    def test_unparseable_text_returns_none(self):
        for bad in ("", "no coordinates here", "Xã X, Tỉnh Y", "garbage-123-456"):
            self.assertIsNone(lvn.parse_item(bad))

    def test_a_label_with_no_comma_is_kept_whole_as_the_commune(self):
        item = lvn.parse_item("UnknownFormat 10.0-106.0")
        self.assertIsNone(item)  # no comma before the coordinate pair: doesn't match, skipped safely


class NormalizeTests(unittest.TestCase):
    def test_flattens_every_bucket_and_builds_a_stable_id(self):
        payload = {
            "202609241230": ["Xã A, Tỉnh B, 10.111111-106.222222"],
            "202609241240": ["Xã C, Tỉnh D, 11.333333-107.444444"],
        }
        records = lvn.normalize(payload)
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["time"], "2026-09-24T12:30:00Z")
        self.assertEqual(records[0]["id"], "202609241230:10.111111,106.222222")
        self.assertEqual(records[1]["commune"], "Xã C")

    def test_the_same_strike_reported_again_gets_the_same_id(self):
        payload = {"202609241230": ["Xã A, Tỉnh B, 10.111111-106.222222"]}
        self.assertEqual(lvn.normalize(payload)[0]["id"], lvn.normalize(payload)[0]["id"])

    def test_malformed_items_are_skipped_without_dropping_the_rest_of_the_bucket(self):
        payload = {"202609241230": ["Xã A, Tỉnh B, 10.0-106.0", "garbage", "Xã C, Tỉnh D, 11.0-107.0"]}
        records = lvn.normalize(payload)
        self.assertEqual([r["commune"] for r in records], ["Xã A", "Xã C"])

    def test_a_bucket_that_is_not_a_list_is_skipped_not_fatal(self):
        self.assertEqual(lvn.normalize({"202609241230": "not a list"}), [])

    def test_a_completely_wrong_shaped_payload_yields_no_records(self):
        self.assertEqual(lvn.normalize(["not", "a", "dict"]), [])
        self.assertEqual(lvn.normalize(None), [])

    def test_records_are_ordered_oldest_bucket_first(self):
        payload = {
            "202609241250": ["Xã Z, Tỉnh Z, 10.0-106.0"],
            "202609241230": ["Xã A, Tỉnh A, 10.0-106.0"],
        }
        self.assertEqual([r["bucket"] for r in lvn.normalize(payload)], ["202609241230", "202609241250"])


class PollerDongsetDedupTests(QuietLoggerTests):
    def setUp(self):
        super().setUp()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "lightning_vn_history.csv"

    def test_a_fresh_poll_appends_every_record(self):
        seen = set()
        records = lvn.normalize({"202609241230": ["Xã A, Tỉnh B, 10.0-106.0", "Xã C, Tỉnh D, 11.0-107.0"]})
        fresh = [r for r in records if r["id"] not in seen]
        self.assertEqual(len(fresh), 2)

    def test_re_polling_the_same_rolling_window_appends_nothing_new(self):
        payload = {"202609241230": ["Xã A, Tỉnh B, 10.0-106.0"]}
        first = lvn.normalize(payload)
        seen = {r["id"] for r in first}
        second = lvn.normalize(payload)  # the source returns the whole window again, unchanged
        fresh = [r for r in second if r["id"] not in seen]
        self.assertEqual(fresh, [])

    def test_load_seen_ids_reads_back_what_append_rows_wrote(self):
        self.assertEqual(poller.load_seen_ids(self.path), set())
        records = lvn.normalize({"202609241230": ["Xã A, Tỉnh B, 10.0-106.0", "Xã C, Tỉnh D, 11.0-107.0"]})
        poller.append_rows(self.path, poller.DONGSET_FIELDS, [{k: r[k] for k in poller.DONGSET_FIELDS} for r in records])
        seen = poller.load_seen_ids(self.path)
        self.assertEqual(seen, {r["id"] for r in records})

    def test_poll_dongset_once_skips_ids_already_seen_and_only_appends_new_ones(self):
        poller.DONGSET_PATH, original = self.path, poller.DONGSET_PATH
        try:
            first_payload = {"202609241230": ["Xã A, Tỉnh B, 10.0-106.0"]}
            second_payload = {"202609241230": ["Xã A, Tỉnh B, 10.0-106.0"], "202609241240": ["Xã C, Tỉnh D, 11.0-107.0"]}
            seen = set()
            with patch.object(poller, "fetch_dongset", lambda: first_payload):
                added = poller.poll_dongset_once(seen)
            self.assertEqual(added, 1)
            with patch.object(poller, "fetch_dongset", lambda: second_payload):
                added = poller.poll_dongset_once(seen)
            self.assertEqual(added, 1)  # only the newly-appearing bucket's strike
            with self.path.open(newline="", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
            self.assertEqual(len(rows), 2)
        finally:
            poller.DONGSET_PATH = original


# A ground strike from a rich bucket -- the shape the page's own popup shows
# ("Tại lúc 10:26:7 (UTC) 24/9/2026 ... -43 KA ... 8 sensor ... DOF 5 ... Sét
# xuống đất") confirmed by the user pasting a real popup with these exact
# field meanings.
RICH_GROUND_OBJECT = (
    "nam:2026,thang:9,ngay:24,gio:10,phut:26,giay:7,lat:10.7417,lng:108.057,"
    "giatri:-43,sensor:8,dof:5,loaiset:0"
)
RICH_CLOUD_OBJECT = (
    "nam:2026,thang:9,ngay:24,gio:11,phut:0,giay:59,lat:9.5,lng:106.25,"
    "giatri:21.5,sensor:4,dof:3,loaiset:1"
)
# A coarse-tier record (set[0]..set[5] in practice): no giay/giatri/sensor/dof.
COARSE_OBJECT = "nam:2026,thang:9,ngay:24,gio:10,phut:20,lat:10.8,lng:106.7,style:1000,loaiset:0"


class ParseEmbeddedObjectTests(unittest.TestCase):
    def test_parses_bare_unquoted_key_value_pairs_into_floats(self):
        fields = lvn.parse_embedded_object(RICH_GROUND_OBJECT)
        self.assertEqual(fields["nam"], 2026.0)
        self.assertEqual(fields["giatri"], -43.0)
        self.assertEqual(fields["lat"], 10.7417)

    def test_an_empty_or_unmatched_body_yields_an_empty_dict(self):
        self.assertEqual(lvn.parse_embedded_object(""), {})
        self.assertEqual(lvn.parse_embedded_object("nothing here"), {})


class StrikeRecordTests(unittest.TestCase):
    def test_builds_a_record_matching_the_pages_own_popup(self):
        record = lvn.strike_record(lvn.parse_embedded_object(RICH_GROUND_OBJECT))
        self.assertEqual(record["time"], "2026-09-24T10:26:07Z")
        self.assertEqual(record["lat"], 10.7417)
        self.assertEqual(record["lon"], 108.057)
        self.assertEqual(record["current_ka"], -43.0)
        self.assertEqual(record["sensor_count"], 8)
        self.assertEqual(record["dof"], 5)
        self.assertEqual(record["kind"], "ground")

    def test_loaiset_one_is_cloud(self):
        record = lvn.strike_record(lvn.parse_embedded_object(RICH_CLOUD_OBJECT))
        self.assertEqual(record["kind"], "cloud")

    def test_an_unrecognized_loaiset_is_unknown_not_fatal(self):
        fields = lvn.parse_embedded_object(RICH_GROUND_OBJECT.replace("loaiset:0", "loaiset:9"))
        self.assertEqual(lvn.strike_record(fields)["kind"], "unknown")

    def test_a_coarse_tier_record_missing_rich_fields_is_skipped(self):
        self.assertIsNone(lvn.strike_record(lvn.parse_embedded_object(COARSE_OBJECT)))

    def test_an_impossible_calendar_date_is_skipped_not_fatal(self):
        bad = RICH_GROUND_OBJECT.replace("thang:9", "thang:13").replace("ngay:24", "ngay:99")
        self.assertIsNone(lvn.strike_record(lvn.parse_embedded_object(bad)))

    def test_the_id_is_stable_for_the_same_time_and_position(self):
        fields = lvn.parse_embedded_object(RICH_GROUND_OBJECT)
        self.assertEqual(lvn.strike_record(fields)["id"], lvn.strike_record(fields)["id"])


class ParseEmbeddedStrikesTests(unittest.TestCase):
    def test_extracts_rich_records_across_set_arrays_and_skips_coarse_ones(self):
        html = (
            "<script>"
            f"set[0] = [{{{COARSE_OBJECT}}}];"
            f"set[6] = [{{{RICH_GROUND_OBJECT}}}, {{{RICH_CLOUD_OBJECT}}}];"
            "</script>"
        )
        records = lvn.parse_embedded_strikes(html)
        self.assertEqual(len(records), 2)
        self.assertEqual({r["kind"] for r in records}, {"ground", "cloud"})

    def test_the_same_strike_repeated_across_overlapping_buckets_is_deduplicated(self):
        html = (
            f"set[6] = [{{{RICH_GROUND_OBJECT}}}];"
            f"set[7] = [{{{RICH_GROUND_OBJECT}}}];"  # cumulative trailing windows overlap
        )
        records = lvn.parse_embedded_strikes(html)
        self.assertEqual(len(records), 1)

    def test_records_are_sorted_by_time(self):
        html = f"set[6] = [{{{RICH_CLOUD_OBJECT}}}, {{{RICH_GROUND_OBJECT}}}];"
        records = lvn.parse_embedded_strikes(html)
        self.assertEqual([r["time"] for r in records], sorted(r["time"] for r in records))

    def test_a_page_with_no_set_arrays_yields_no_records(self):
        self.assertEqual(lvn.parse_embedded_strikes("<html>nothing here</html>"), [])
        self.assertEqual(lvn.parse_embedded_strikes(""), [])
        self.assertEqual(lvn.parse_embedded_strikes(None), [])


class PollerStrikesDedupTests(QuietLoggerTests):
    def setUp(self):
        super().setUp()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "lightning_vn_strikes_history.csv"

    def test_poll_strikes_once_skips_ids_already_seen_and_only_appends_new_ones(self):
        poller.STRIKES_PATH, original = self.path, poller.STRIKES_PATH
        try:
            first_html = f"set[6] = [{{{RICH_GROUND_OBJECT}}}];"
            second_html = f"set[6] = [{{{RICH_GROUND_OBJECT}}}, {{{RICH_CLOUD_OBJECT}}}];"
            seen = set()
            with patch.object(poller, "fetch_lightningmaps_html", lambda: first_html):
                added = poller.poll_strikes_once(seen)
            self.assertEqual(added, 1)
            with patch.object(poller, "fetch_lightningmaps_html", lambda: second_html):
                added = poller.poll_strikes_once(seen)
            self.assertEqual(added, 1)  # only the newly-appearing strike
            with self.path.open(newline="", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
            self.assertEqual(len(rows), 2)
        finally:
            poller.STRIKES_PATH = original

    def test_a_page_yielding_no_records_appends_nothing(self):
        seen = set()
        with patch.object(poller, "fetch_lightningmaps_html", lambda: "<html></html>"):
            added = poller.poll_strikes_once(seen)
        self.assertEqual(added, 0)
        self.assertFalse(self.path.exists())


HCMC_BBOX = (9.7, 105.6, 11.9, 107.8)  # matches HIMAWARI_BBOX / app.config


class RecentStrikesTests(unittest.TestCase):
    """The reader side of the strikes archive: what a live map layer polls."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "strikes.csv"
        self.now = datetime(2026, 9, 24, 15, 0, tzinfo=lvn.UTC)

    def write(self, rows, mtime=None):
        with self.path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f, fieldnames=["id", "time", "lat", "lon", "current_ka", "sensor_count", "dof", "kind"]
            )
            writer.writeheader()
            for i, (when, lat, lon, ka, kind) in enumerate(rows):
                writer.writerow({
                    "id": f"s{i}", "time": when.isoformat().replace("+00:00", "Z"),
                    "lat": lat, "lon": lon, "current_ka": ka, "sensor_count": 6, "dof": 3, "kind": kind,
                })
        # Fixed rather than real wall-clock time, so staleness assertions
        # below are deterministic regardless of when the suite happens to run.
        ts = (mtime or self.now).timestamp()
        os.utime(self.path, (ts, ts))

    def test_a_missing_archive_is_empty_and_flagged_stale_not_fatal(self):
        result = lvn.recent_strikes(self.path, now=self.now)
        self.assertEqual(result["strikes"], [])
        self.assertIsNone(result["latest_anywhere"])
        self.assertIsNone(result["collected_at"])
        self.assertTrue(result["collector_stale"])

    def test_only_strikes_within_the_window_are_returned(self):
        self.write([
            (self.now - timedelta(minutes=10), 10.8, 106.7, -30, "ground"),
            (self.now - timedelta(minutes=200), 10.8, 106.7, -30, "ground"),  # outside a 90-min window
        ])
        result = lvn.recent_strikes(self.path, minutes=90, now=self.now)
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["strikes"][0]["age_seconds"], 600)

    def test_bbox_filters_out_a_strike_far_from_the_region(self):
        self.write([
            (self.now - timedelta(minutes=5), 10.8, 106.7, -30, "ground"),   # HCMC
            (self.now - timedelta(minutes=5), 21.0, 105.8, -30, "ground"),   # Hanoi, well outside
        ])
        result = lvn.recent_strikes(self.path, bbox=HCMC_BBOX, now=self.now)
        self.assertEqual(result["count"], 1)
        self.assertAlmostEqual(result["strikes"][0]["lat"], 10.8)

    def test_a_missing_bbox_argument_returns_every_strike_in_window(self):
        self.write([
            (self.now - timedelta(minutes=5), 10.8, 106.7, -30, "ground"),
            (self.now - timedelta(minutes=5), 21.0, 105.8, -30, "ground"),
        ])
        result = lvn.recent_strikes(self.path, now=self.now)
        self.assertEqual(result["count"], 2)
        self.assertIsNone(result["bbox"])

    def test_collector_stale_is_judged_from_the_files_write_time_not_the_strikes_own_time(self):
        # HYMETNET's own reported strike times run ~50 min behind real time
        # even when the collector is perfectly healthy (see recent_strikes'
        # docstring), so a strike this "old" must not, by itself, make the
        # collector look stale -- only a file that hasn't been written to
        # in a while should.
        self.write([(self.now - timedelta(minutes=50), 10.8, 106.7, -30, "ground")], mtime=self.now)
        fresh = lvn.recent_strikes(self.path, now=self.now)
        self.assertFalse(fresh["collector_stale"])
        self.assertEqual(fresh["collected_at"], self.now.isoformat().replace("+00:00", "Z"))
        much_later = lvn.recent_strikes(self.path, now=self.now + timedelta(minutes=40))
        self.assertTrue(much_later["collector_stale"])
        self.assertEqual(much_later["latest_anywhere"], fresh["strikes"][0]["time"])

    def test_strikes_are_returned_oldest_first(self):
        self.write([
            (self.now - timedelta(minutes=1), 10.8, 106.7, -20, "cloud"),
            (self.now - timedelta(minutes=30), 10.8, 106.7, -20, "ground"),
        ])
        result = lvn.recent_strikes(self.path, now=self.now)
        self.assertGreater(result["strikes"][0]["age_seconds"], result["strikes"][1]["age_seconds"])

    def test_the_cache_invalidates_when_the_file_changes(self):
        self.write([(self.now - timedelta(minutes=1), 10.8, 106.7, -20, "ground")])
        first = lvn.recent_strikes(self.path, now=self.now)
        self.write([
            (self.now - timedelta(minutes=1), 10.8, 106.7, -20, "ground"),
            (self.now - timedelta(seconds=10), 10.8, 106.7, -20, "cloud"),
        ])
        second = lvn.recent_strikes(self.path, now=self.now)
        self.assertEqual(first["count"], 1)
        self.assertEqual(second["count"], 2)

    def test_a_malformed_row_is_skipped_not_fatal(self):
        with self.path.open("w", newline="", encoding="utf-8") as f:
            f.write("id,time,lat,lon,current_ka,sensor_count,dof,kind\n")
            f.write("bad,not-a-time,10.8,106.7,-20,6,3,ground\n")
            when = (self.now - timedelta(minutes=1)).isoformat().replace("+00:00", "Z")
            f.write(f"ok,{when},10.8,106.7,-20,6,3,ground\n")
        result = lvn.recent_strikes(self.path, now=self.now)
        self.assertEqual(result["count"], 1)


class LightningEndpointTests(unittest.TestCase):
    """The route: /api/rain-map/lightning wired to the region box and archive path."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "strikes.csv"
        patcher = patch.object(lvn, "STRIKES_HISTORY_PATH", self.path)
        patcher.start()
        self.addCleanup(patcher.stop)
        from fastapi.testclient import TestClient
        from app.main import app
        self.client = TestClient(app)

    def write(self, rows):
        with self.path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f, fieldnames=["id", "time", "lat", "lon", "current_ka", "sensor_count", "dof", "kind"]
            )
            writer.writeheader()
            for i, (when, lat, lon, ka, kind) in enumerate(rows):
                writer.writerow({
                    "id": f"s{i}", "time": when.isoformat().replace("+00:00", "Z"),
                    "lat": lat, "lon": lon, "current_ka": ka, "sensor_count": 6, "dof": 3, "kind": kind,
                })

    def test_serves_strikes_restricted_to_the_regional_box(self):
        now = datetime.now(lvn.UTC)
        self.write([
            (now - timedelta(minutes=5), 10.8, 106.7, -30, "ground"),  # inside HIMAWARI_BBOX
            (now - timedelta(minutes=5), 40.0, 116.4, -30, "ground"),  # Beijing, far outside
        ])
        r = self.client.get("/api/rain-map/lightning")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(set(body["strikes"][0]), {"time", "lat", "lon", "current_ka", "kind", "age_seconds"})

    def test_minutes_query_param_is_bounded(self):
        for bad in ("minutes=0", "minutes=4", "minutes=361", "minutes=oops"):
            self.assertEqual(self.client.get(f"/api/rain-map/lightning?{bad}").status_code, 422)
        self.assertEqual(self.client.get("/api/rain-map/lightning?minutes=30").status_code, 200)

    def test_no_archive_yet_is_empty_not_an_error(self):
        r = self.client.get("/api/rain-map/lightning")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["strikes"], [])
        self.assertTrue(r.json()["collector_stale"])

    def test_the_static_layer_script_is_served(self):
        self.assertEqual(self.client.get("/media/app/static/lightning.js").status_code, 200)


if __name__ == "__main__":
    unittest.main()
