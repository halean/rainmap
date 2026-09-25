"""Blocklist expiry, the site-outage guard, and rotating dead cameras out: a camera judged dead gets another chance after BLOCKLIST_TTL_SEC.

The site's outages are site-wide, so candidates probed during one are blocklisted
alongside genuinely dead cameras; expiry is what stops an outage doing lasting damage.
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import camera_watchdog as wd


class BlocklistExpiryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self._real = wd.BLOCKLIST_PATH
        wd.BLOCKLIST_PATH = self.tmp / "watchdog_blocklist.json"
        self.addCleanup(setattr, wd, "BLOCKLIST_PATH", self._real)
        # wd.log writes to the live logs/watchdog.log; keep test releases out of it
        wd.log.disabled = True
        self.addCleanup(setattr, wd.log, "disabled", False)

    def write(self, data):
        wd.BLOCKLIST_PATH.write_text(json.dumps(data))

    def ago(self, seconds):
        return (wd.now_utc() - timedelta(seconds=seconds)).isoformat()

    def test_expired_entries_are_released_and_fresh_ones_kept(self):
        self.write({"old": self.ago(wd.BLOCKLIST_TTL_SEC + 60), "new": self.ago(60)})
        self.assertEqual(set(wd.load_blocklist()), {"new"})

    def test_legacy_list_is_migrated_and_not_released_at_once(self):
        # the old file had no times: everything on it gets a full TTL from now,
        # rather than being released (or kept forever) in one go
        self.write(["a", "b"])
        bl = wd.load_blocklist()
        self.assertEqual(set(bl), {"a", "b"})
        for stamp in bl.values():
            age = (wd.now_utc() - wd.datetime.fromisoformat(stamp)).total_seconds()
            self.assertLess(age, 5)

    def test_missing_file_is_an_empty_blocklist(self):
        self.assertEqual(wd.load_blocklist(), {})

    def test_blocked_camera_is_excluded_from_the_pool_until_released(self):
        locations = [{"camera_id": "x", "lat": 10.8, "lon": 106.7}]
        bl = {}
        wd.block(bl, "x")
        self.assertEqual(wd.eligible_pool(locations, set(), bl, {}), [])
        self.write({"x": self.ago(wd.BLOCKLIST_TTL_SEC + 1)})
        self.assertEqual([c["camera_id"] for c in wd.eligible_pool(locations, set(), wd.load_blocklist(), {})], ["x"])

    def test_default_ttl_is_three_hours(self):
        self.assertEqual(wd.BLOCKLIST_TTL_SEC, 3 * 3600)


class SiteOutageTests(unittest.TestCase):
    """Most of the sample unreachable together is the site, not the cameras."""

    def cycle(self, unreachable, total=40, offline=0):
        states = {}
        for i in range(total):
            states[f"c{i}"] = wd.UNREACHABLE if i < unreachable else wd.OFFLINE if i < unreachable + offline else wd.LIVE
        return states

    def test_site_wide_failure_is_an_outage(self):
        self.assertTrue(wd.site_outage(self.cycle(38)))

    def test_half_unreachable_is_an_outage(self):
        self.assertTrue(wd.site_outage(self.cycle(20)))

    def test_a_few_dead_cameras_are_not(self):
        # real deaths come one or two at a time; these must still strike out
        self.assertFalse(wd.site_outage(self.cycle(3)))
        self.assertFalse(wd.site_outage(self.cycle(19)))

    def test_cameras_the_site_reports_offline_do_not_make_an_outage(self):
        # the site answered for these: that is news about the cameras, not the site
        self.assertFalse(wd.site_outage(self.cycle(0, offline=30)))

    def test_all_live_is_not(self):
        self.assertFalse(wd.site_outage(self.cycle(0)))

    def test_tiny_sample_never_declares_an_outage(self):
        self.assertFalse(wd.site_outage(self.cycle(3, total=3)))


FULL = b"\xff\xd8\xff" + b"x" * (wd.OFFLINE_THRESHOLD + 10)
PLACEHOLDER = b"\xff\xd8\xff" + b"z" * 100


class OfflineMinutesTests(unittest.TestCase):
    """How long the fetch job has been handed only the site's offline placeholder."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self._root = wd.RAW_ROOT
        wd.RAW_ROOT = self.tmp
        self.addCleanup(setattr, wd, "RAW_ROOT", self._root)
        self.now = 2_000_000_000

    def write(self, frames):
        """frames: [(bytes, minutes_ago)], oldest first."""
        day = self.tmp / "cam" / "2026" / "09" / "25"
        day.mkdir(parents=True, exist_ok=True)
        for i, (body, ago) in enumerate(frames):
            f = day / f"20260925_{100000 + i:06d}.jpg"
            f.write_bytes(body)
            t = self.now - ago * 60
            os.utime(f, (t, t))

    def test_placeholders_since_45_min_ago(self):
        self.write([(FULL, 60), (PLACEHOLDER, 45), (PLACEHOLDER, 30), (PLACEHOLDER, 2)])
        self.assertAlmostEqual(wd.offline_minutes("cam", now=self.now), 45)

    def test_a_real_frame_last_means_live(self):
        self.write([(PLACEHOLDER, 45), (PLACEHOLDER, 30), (FULL, 2)])
        self.assertEqual(wd.offline_minutes("cam", now=self.now), 0)

    def test_one_placeholder_is_not_enough(self):
        self.write([(FULL, 60), (PLACEHOLDER, 50)])
        self.assertEqual(wd.offline_minutes("cam", now=self.now), 0)

    def test_no_frames_is_not_offline(self):
        # nothing on disk means the site never answered: unreachable, not offline
        self.assertEqual(wd.offline_minutes("nobody", now=self.now), 0)


class ReplaceDeadTests(unittest.TestCase):
    """A dead camera is rotated out for a live one near its slot's anchor."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        for name in ("LOCATIONS_PATH", "SLOTS_PATH"):
            old = getattr(wd, name)
            setattr(wd, name, self.tmp / f"{name}.json")
            self.addCleanup(setattr, wd, name, old)
        wd.log.disabled = True
        self.addCleanup(setattr, wd.log, "disabled", False)
        self._probe, self._sleep = wd.probe, wd.time.sleep
        self.addCleanup(setattr, wd, "probe", self._probe)
        self.addCleanup(setattr, wd.time, "sleep", self._sleep)
        wd.time.sleep = lambda s: None
        # dead camera at the slot anchor; one far-away neighbour; candidates
        # 0.5 km (unreachable), 1 km (live) and 2 km (live) from the anchor
        self.cameras = [
            {"camera_id": "dead", "lat": 10.80, "lon": 106.70},
            {"camera_id": "far", "lat": 10.95, "lon": 106.90},
        ]
        wd.save_json(wd.SLOTS_PATH, [
            {"slot": 0, "anchor_lat": 10.80, "anchor_lon": 106.70, "camera_id": "dead"},
            {"slot": 1, "anchor_lat": 10.95, "anchor_lon": 106.90, "camera_id": "far"},
        ])
        wd.save_json(wd.LOCATIONS_PATH, [
            {"camera_id": "near-silent", "lat": 10.8045, "lon": 106.70},
            {"camera_id": "near-live", "lat": 10.809, "lon": 106.70, "display_name": "Near"},
            {"camera_id": "further-live", "lat": 10.818, "lon": 106.70},
        ])

    def test_nearest_live_camera_takes_the_slot_and_the_anchor_stays(self):
        states = {"near-silent": wd.UNREACHABLE, "near-live": wd.LIVE, "further-live": wd.LIVE}
        saved = []
        wd.probe = lambda cid, save=False: (save and saved.append(cid), states[cid])[1]
        bl = {}
        new = wd.replace_dead(self.cameras, "dead", bl, allow_fallback=True)
        self.assertIn("near-live", saved)  # its probe frame is kept for the annotator
        self.assertEqual([c["camera_id"] for c in new], ["near-live", "far"])
        slot = next(s for s in json.loads(wd.SLOTS_PATH.read_text()) if s["slot"] == 0)
        self.assertEqual(slot["camera_id"], "near-live")
        self.assertEqual((slot["anchor_lat"], slot["anchor_lon"]), (10.80, 106.70))
        self.assertNotIn("near-silent", bl)  # no answer is not evidence it is dead

    def test_candidate_the_site_reports_offline_is_blocklisted(self):
        states = {"near-silent": wd.OFFLINE, "near-live": wd.LIVE, "further-live": wd.LIVE}
        wd.probe = lambda cid, save=False: states[cid]
        bl = {}
        wd.replace_dead(self.cameras, "dead", bl, allow_fallback=True)
        self.assertIn("near-silent", bl)

    def test_nothing_answering_keeps_the_dead_camera_rather_than_shrinking(self):
        wd.probe = lambda cid, save=False: wd.UNREACHABLE
        self.assertIsNone(wd.replace_dead(self.cameras, "dead", {}, allow_fallback=False))


class ProbeSavesFrameTests(unittest.TestCase):
    """A camera probed on its way into the sample keeps that frame for the annotator."""

    class Resp:
        def __init__(self, body, status=200, ctype="image/jpeg"):
            self.content, self.status_code, self.headers = body, status, {"Content-Type": ctype}

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self._root, self._get = wd.RAW_ROOT, wd.session.get
        wd.RAW_ROOT = self.tmp
        self.addCleanup(setattr, wd, "RAW_ROOT", self._root)
        self.addCleanup(setattr, wd.session, "get", self._get)

    def frames(self, cid):
        return sorted(p for p in (self.tmp / cid).rglob("*") if p.is_file())

    def test_live_frame_is_saved_like_a_fetched_one(self):
        wd.session.get = lambda url, timeout: self.Resp(FULL)
        self.assertEqual(wd.probe("cam", save=True), wd.LIVE)
        [f] = self.frames("cam")
        self.assertRegex(f.relative_to(self.tmp).as_posix(), r"^cam/\d{4}/\d{2}/\d{2}/\d{8}_\d{6}\.jpg$")
        self.assertEqual(f.read_bytes(), FULL)

    def test_plain_probe_saves_nothing(self):
        wd.session.get = lambda url, timeout: self.Resp(FULL)
        wd.probe("cam")
        self.assertEqual(self.frames("cam"), [])

    def test_placeholder_is_never_saved(self):
        wd.session.get = lambda url, timeout: self.Resp(PLACEHOLDER)
        self.assertEqual(wd.probe("cam", save=True), wd.OFFLINE)
        self.assertEqual(self.frames("cam"), [])


if __name__ == "__main__":
    unittest.main()
