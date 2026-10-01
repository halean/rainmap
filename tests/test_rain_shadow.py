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


if __name__ == "__main__":
    unittest.main()
