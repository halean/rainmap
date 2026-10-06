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


if __name__ == "__main__":
    unittest.main()
