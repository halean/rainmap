"""Quota pacing for the annotator.

The limit that binds is input tokens per project per MINUTE, shared by every
camera and by anything else using the same key. So a rejection is not one
camera's problem -- it means the next call is about to fail too. Retrying it on
the next 60s poll, which is what this used to do, turns one refused call into a
storm that outlives its cause: on 2026-09-14 that produced 1013 errors over 47
minutes while successful throughput never rose above its normal ~5.5/min.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import rain_annotator as annot


class QuotaClassificationTests(unittest.TestCase):
    QUOTA = (
        'Google API error 429: {"error": {"code": 429, "message": "You exceeded your '
        "current quota... Quota exceeded for metric: generativelanguage.googleapis.com/"
        "generate_content_paid_tier_2_input_token_count, limit: 16000, model: gemma-4-31b"
        '\\nPlease retry in 18.2237487s.", "status": "RESOURCE_EXHAUSTED"}}'
    )

    def test_the_api_s_own_delay_is_honoured(self):
        """Google states the wait precisely; guessing would either stall the map
        or walk straight back into the same bucket."""
        wait = annot.quota_retry_after(Exception(self.QUOTA))
        self.assertGreaterEqual(wait, 18.2237487)
        self.assertLess(wait, 18.2237487 + 3.0)  # jitter only

    def test_a_quota_error_without_a_delay_still_pauses(self):
        wait = annot.quota_retry_after(Exception("Google API error 429: slow down"))
        self.assertGreaterEqual(wait, annot.QUOTA_FALLBACK_SEC)

    def test_status_alone_is_enough(self):
        """Matching the status rather than the wording means a reworded quota
        message still pauses instead of being treated as one camera's fault."""
        self.assertIsNotNone(annot.quota_retry_after(Exception("RESOURCE_EXHAUSTED")))

    def test_ordinary_failures_are_not_quota_failures(self):
        for text in ("Connection timed out", "ValueError: bad json", "500 internal error",
                     "HTTP 4290 not a status"):
            self.assertIsNone(annot.quota_retry_after(Exception(text)), text)

    def test_jitter_spreads_the_retry(self):
        """Without it the whole due list wakes at one instant and re-collides."""
        waits = {annot.quota_retry_after(Exception(self.QUOTA)) for _ in range(50)}
        self.assertGreater(len(waits), 40)


class BackoffTests(unittest.TestCase):
    def test_it_grows_and_then_stops_growing(self):
        with patch.object(annot.random, "uniform", lambda a, b: 1.0):
            delays = [annot.backoff_for(n) for n in range(1, 10)]
        self.assertEqual(delays[0], annot.BACKOFF_BASE_SEC)
        self.assertTrue(all(b >= a for a, b in zip(delays, delays[1:])), delays)
        self.assertEqual(delays[-1], annot.BACKOFF_MAX_SEC)

    def test_the_first_retry_is_slower_than_the_poll(self):
        """The whole point: a failure must not come straight back on the next
        pass, which is what made the storm self-sustaining."""
        with patch.object(annot.random, "uniform", lambda a, b: a):
            self.assertGreater(annot.backoff_for(1), annot.POLL_SECONDS)

    def test_jittered_within_bounds(self):
        for n in (1, 3, 12):
            for _ in range(20):
                d = annot.backoff_for(n)
                self.assertGreaterEqual(d, annot.BACKOFF_BASE_SEC * 0.8)
                self.assertLessEqual(d, annot.BACKOFF_MAX_SEC * 1.2)


if __name__ == "__main__":
    unittest.main()
