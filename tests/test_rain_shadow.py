"""Shadow mode's scorer and its guarantees: same answer as the trained model, never in the way."""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.services.rain_shadow as rs
from app.services.rain_luna import luna_decides

ICT = timezone(timedelta(hours=7))


def write_model(path, dims=4, pcs=2):
    rng = np.random.default_rng(0)
    np.savez(path, mu=np.zeros(dims), basis=np.eye(dims)[:, :pcs], m=np.zeros(pcs + 3), s=np.ones(pcs + 3),
             coef=np.array([1.0, 0, 0, 0, 0.5]), intercept=np.array([-0.25]),
             meta=np.array(json.dumps({"embedding_model": "gemini-embedding-2", "frames": 10, "alpha": 1.0,
                                       "first": "2026-09-13", "last": "2026-10-01"})))


class ScoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "m.npz"
        write_model(self.path)
        self.model = rs.ShadowModel(self.path)

    def test_decision_is_the_linear_score(self):
        noon = datetime(2026, 10, 1, 12, tzinfo=ICT)
        self.assertAlmostEqual(self.model.score([1, 0, 0, 0], noon), 0.75)    # 1 - 0.25, no night flag
        self.assertAlmostEqual(self.model.score([0, 0, 0, 0], noon), -0.25)

    def test_night_flag_uses_vietnam_time(self):
        """22:00 ICT is 15:00 UTC: the flag must follow the city's clock, not the server's."""
        utc_15 = datetime(2026, 10, 1, 15, tzinfo=timezone.utc)
        self.assertAlmostEqual(self.model.score([0, 0, 0, 0], utc_15), 0.25)  # -0.25 + 0.5 night


class GuaranteeTests(unittest.TestCase):
    def setUp(self):
        # The service's logger writes to logs/rain_shadow.log; keep test noise out of the real log.
        p = patch.object(rs, "log")
        p.start()
        self.addCleanup(p.stop)

    def test_off_without_a_model(self):
        with patch.object(rs, "MODEL_PATH", Path("/nonexistent/model.npz")):
            s = rs.Shadow()
        self.assertFalse(s.enabled)
        s.submit("c", "x", Path("a.jpg"), None, "No", {})  # a no-op, not an error

    def test_a_full_queue_drops_instead_of_blocking(self):
        s = rs.Shadow.__new__(rs.Shadow)
        s.enabled, s.dropped = True, 0
        s.q = rs.queue.Queue(maxsize=1)
        s.submit("c", "x", Path("a.jpg"), None, "No", {})
        s.submit("c", "x", Path("b.jpg"), None, "No", {})  # must return at once
        self.assertEqual(s.dropped, 1)


class VetoTests(unittest.TestCase):
    """Only rain from water alone, only when the classifier scores below VETO (patched to -0.3 here;
    the default is 0)."""

    def setUp(self):
        p = patch.object(rs, "VETO", -0.3)
        p.start()
        self.addCleanup(p.stop)

    def test_leftover_water_with_a_dry_classifier_is_vetoed(self):
        """1-2 Oct: Medium from 'standing water', nothing falling, classifier -1.26."""
        self.assertTrue(rs.Shadow.veto("Medium", {"water": "standing water", "falling": "no"}, (-1.26, None)))

    def test_rain_seen_falling_is_never_vetoed(self):
        self.assertFalse(rs.Shadow.veto("Medium", {"water": "soaked", "falling": "yes"}, (-2.0, None)))

    def test_a_borderline_classifier_does_not_veto(self):
        self.assertFalse(rs.Shadow.veto("Light", {"water": "soaked", "falling": "no"}, (-0.2, None)))

    def test_no_score_no_veto(self):
        """An embedding call that failed leaves Gemma's call as it was."""
        self.assertFalse(rs.Shadow.veto("Light", {"water": "soaked", "falling": "no"}, None))

    def test_a_dry_reading_is_left_alone(self):
        self.assertFalse(rs.Shadow.veto("No", {"water": "wet", "falling": "no"}, (-1.0, None)))

    def test_off_switch(self):
        with patch.object(rs, "VETO", None):
            self.assertFalse(rs.Shadow.veto("Medium", {"water": "standing water", "falling": "no"}, (-1.26, None)))


class HandLabelModelTests(unittest.TestCase):
    """The saved hand-label classifier scores with numpy exactly as scripts/hand_label_eval.py fits it:
    standardise [embedding, sin hour, cos hour, night], dot the weights, add the intercept."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "hand.npz"
        np.savez(self.path, mean=np.zeros(5), scale=np.full(5, 2.0), coef=np.array([1.0, -1.0, 0, 0, 3.0]),
                 intercept=np.array([-0.5]), meta=np.array(json.dumps({"labels": 3, "trained_at": "x"})))

    def test_score_formula_and_feature_order(self):
        m = rs.HandLabelModel(self.path)
        day = datetime(2026, 10, 6, 12, 0, tzinfo=ICT)     # noon: sin 0, cos -1, not night
        self.assertAlmostEqual(m.score([4.0, 2.0], day), (4 - 2) / 2 - 0.5)
        night = datetime(2026, 10, 6, 23, 0, tzinfo=ICT)   # the night flag carries weight 3 / scale 2
        self.assertAlmostEqual(m.score([4.0, 2.0], night) - m.score([4.0, 2.0], datetime(2026, 10, 6, 17, 0, tzinfo=ICT)), 1.5)

    def test_hour_is_local_time(self):
        m = rs.HandLabelModel(self.path)
        utc = datetime(2026, 10, 6, 5, 0, tzinfo=timezone.utc)   # 12:00 ICT
        self.assertAlmostEqual(m.score([0, 0], utc), m.score([0, 0], datetime(2026, 10, 6, 12, 0, tzinfo=ICT)))


class ReloadTests(unittest.TestCase):
    """A retrained model is picked up by the running annotator; a broken file leaves the old one."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "hand.npz"
        self.save(labels=3)
        for p in (patch.object(rs, "HAND_MODEL_PATH", self.path), patch.object(rs, "HAND_MODEL_CHECK_SEC", 0),
                  patch.object(rs, "log")):
            p.start()
            self.addCleanup(p.stop)
        self.s = rs.Shadow.__new__(rs.Shadow)
        self.s.hand, self.s.hand_mtime, self.s.hand_checked = rs.HandLabelModel(self.path), self.path.stat().st_mtime, 0

    def save(self, labels, path=None):
        np.savez(path or self.path, mean=np.zeros(5), scale=np.ones(5), coef=np.zeros(5), intercept=np.array([0.0]),
                 meta=np.array(json.dumps({"labels": labels, "trained_at": "x"})))

    def touch_later(self):
        import os
        st = self.path.stat()
        os.utime(self.path, (st.st_atime, st.st_mtime + 10))

    def test_a_new_file_is_loaded(self):
        self.save(labels=9)
        self.touch_later()
        self.s.reload_hand_model()
        self.assertEqual(self.s.hand.meta["labels"], 9)

    def test_a_broken_file_keeps_the_old_model(self):
        self.path.write_bytes(b"not a model")
        self.touch_later()
        self.s.reload_hand_model()
        self.assertEqual(self.s.hand.meta["labels"], 3)


class DeciderTests(unittest.TestCase):
    def setUp(self):
        p = patch.object(rs, "DECIDER", "classifier")
        p.start()
        self.addCleanup(p.stop)

    def test_rain_keeps_gemmas_grade_and_words(self):
        self.assertEqual(rs.classifier_decides("Medium", "Rain is pouring.", 0.8), ("Medium", "Rain is pouring."))

    def test_rain_gemma_missed_is_light_with_a_plain_line(self):
        """Gemma's 'the road is merely wet' would contradict a rain badge."""
        verdict, words = rs.classifier_decides("No", "The road is wet but nothing is falling.", 0.4)
        self.assertEqual(verdict, "Light")
        self.assertNotIn("nothing is falling", words)

    def test_dry_overrules_gemma_and_keeps_its_description(self):
        self.assertEqual(rs.classifier_decides("Light", "Glossy road, riders in raincoats.", -0.2),
                         ("No", "Glossy road, riders in raincoats."))

    def test_no_score_leaves_the_old_path(self):
        self.assertIsNone(rs.classifier_decides("Light", "x", None))

    def test_off_switch(self):
        with patch.object(rs, "DECIDER", "gemma"):
            self.assertIsNone(rs.classifier_decides("No", "x", 2.0))


class LunaDeciderTests(unittest.TestCase):
    def test_rain_keeps_gemmas_grade_and_words(self):
        self.assertEqual(luna_decides("Medium", "Rain is pouring.", {"rain_now": "raining", "intensity": "light"}),
                         ("Medium", "Rain is pouring."))

    def test_rain_gemma_missed_takes_lunas_grade_and_a_plain_line(self):
        """The classifier seconds it."""
        verdict, words = luna_decides("No", "The road is wet but nothing is falling.",
                                      {"rain_now": "raining", "intensity": "moderate"}, 0.3)
        self.assertEqual(verdict, "Medium")
        self.assertNotIn("nothing is falling", words)

    def test_rain_no_other_reader_sees_is_not_published(self):
        """Quốc Lộ 22 - Võ Văn Điều, 6 Oct 01:55 ICT: a dry, clear road; Gemma No, classifier -16."""
        self.assertEqual(luna_decides("No", "A dry road at night.", {"rain_now": "raining", "intensity": "light"}, -16.0),
                         ("No", "A dry road at night."))
        self.assertEqual(luna_decides("No", "x", {"rain_now": "raining", "intensity": "light"}, None)[0], "No")

    def test_at_night_rain_needs_gemma_and_a_classifier_not_strongly_dry(self):
        """8 Oct, 04:33 ICT, QL1 - KCN Vĩnh Lộc: a drying road; luna and Gemma Light, classifier -12.9."""
        rain = {"rain_now": "raining", "intensity": "light"}
        night = datetime(2026, 10, 8, 4, 33, tzinfo=ICT)
        self.assertEqual(luna_decides("Light", "Wet road.", rain, -12.9, night), ("No", "Wet road."))
        self.assertEqual(luna_decides("Light", "Rain.", rain, -2.0, night), ("Light", "Rain."))
        self.assertEqual(luna_decides("No", "x", rain, 2.0, night)[0], "No")     # the classifier alone is not enough

    def test_by_day_either_reader_seconds_it(self):
        rain = {"rain_now": "raining", "intensity": "light"}
        noon = datetime(2026, 10, 8, 12, 0, tzinfo=ICT)
        self.assertEqual(luna_decides("Light", "Rain.", rain, -12.9, noon), ("Light", "Rain."))
        self.assertEqual(luna_decides("No", "x", rain, 0.5, noon)[0], "Light")

    def test_night_follows_vietnam_time(self):
        """21:30 UTC is 04:30 ICT, still night; 22:30 UTC is 05:30 ICT, day; 13:00 UTC is 20:00 ICT, not
        yet night (night is 22:00-05:00 ICT)."""
        rain = {"rain_now": "raining", "intensity": "light"}
        self.assertEqual(luna_decides("No", "x", rain, 1.0, datetime(2026, 10, 7, 21, 30, tzinfo=timezone.utc))[0], "No")
        self.assertEqual(luna_decides("No", "x", rain, 1.0, datetime(2026, 10, 7, 22, 30, tzinfo=timezone.utc))[0], "Light")
        self.assertEqual(luna_decides("No", "x", rain, 1.0, datetime(2026, 10, 7, 13, 0, tzinfo=timezone.utc))[0], "Light")

    def test_wet_or_dry_is_no_with_gemmas_description(self):
        for said in ("wet_not_raining", "dry"):
            self.assertEqual(luna_decides("Light", "Glossy road.", {"rain_now": said, "intensity": "none"}),
                             ("No", "Glossy road."))

    def test_no_answer_or_cannot_tell_passes_on(self):
        self.assertIsNone(luna_decides("Light", "x", None))
        self.assertIsNone(luna_decides("Light", "x", {"rain_now": "cannot_tell", "intensity": "none"}))

    def test_the_classifier_still_answers_under_the_luna_decider(self):
        """It is luna's fallback, so DECIDER=luna must not switch it off."""
        with patch.object(rs, "DECIDER", "luna"):
            self.assertEqual(rs.classifier_decides("No", "x", 0.5)[0], "Light")


if __name__ == "__main__":
    unittest.main()
