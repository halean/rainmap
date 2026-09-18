"""The camera sweep is a daemon thread inside the service process, so it dies
with every restart. These cover the hook that picks it back up -- and the guard
that keeps a test run from sweeping the city's camera site by accident.
"""

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import config, main


class AutostartTests(unittest.TestCase):
    def client(self, autostart):
        """A client that runs the lifespan, which a bare TestClient does not."""
        patcher = patch.object(config, "FETCH_AUTOSTART", autostart)
        patcher.start()
        self.addCleanup(patcher.stop)
        return TestClient(main.app)

    def test_off_unless_set(self):
        """Opt-in is a property of the code, not of whatever .env this machine
        happens to carry -- a deployment that sets the flag must not be able to
        make this pass vacuously. Checked with the variable removed outright."""
        import importlib
        import os
        # config calls load_dotenv() at import, so the deployment's .env would
        # put the variable straight back. Silence it to see the bare default.
        with patch("dotenv.load_dotenv", lambda *a, **k: False):
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop("FETCH_AUTOSTART", None)
                self.assertFalse(importlib.reload(config).FETCH_AUTOSTART)
        importlib.reload(config)  # restore this machine's actual setting

    def test_the_lifespan_respects_the_flag(self):
        """An unguarded hook would have every test run that uses the lifespan
        fetching from the city's public camera site."""
        with patch.object(main.fetch_manager, "start") as start:
            with self.client(autostart=False):
                pass
        start.assert_not_called()

    def test_enabled_starts_the_sweep_once(self):
        with patch.object(main.fetch_manager, "start", return_value={"job_id": "abc123"}) as start:
            with self.client(autostart=True) as client:
                self.assertEqual(client.get("/api/status").status_code, 200)
        start.assert_called_once_with()

    def test_a_sweep_already_running_is_left_alone(self):
        """start() raises on a double start. That is the normal case when
        someone POSTs /api/jobs/start as well, not a reason to fail startup."""
        with patch.object(main.fetch_manager, "start",
                          side_effect=RuntimeError("A fetch job is already running.")):
            with patch.object(main.log, "exception") as failed:
                with patch.object(main.log, "info") as noted:
                    with self.client(autostart=True) as client:
                        self.assertEqual(client.get("/api/status").status_code, 200)
        failed.assert_not_called()  # a race with a manual start is not a failure
        self.assertIn("left alone", noted.call_args[0][0])

    def test_a_failed_sweep_is_logged_not_swallowed(self):
        """The map is still worth serving without the sweep, but a silent
        failure here would be the exact thing the hook exists to prevent."""
        with patch.object(main.fetch_manager, "start", side_effect=OSError("disk full")):
            with patch.object(main.log, "exception") as logged:
                with self.client(autostart=True) as client:
                    self.assertEqual(client.get("/api/status").status_code, 200)
        logged.assert_called_once()

    def test_env_values_that_count_as_on(self):
        import importlib
        for value, expected in (("1", True), ("true", True), ("YES", True), ("on", True),
                                ("", False), ("0", False), ("no", False), ("off", False)):
            with patch.dict("os.environ", {"FETCH_AUTOSTART": value}):
                self.assertIs(importlib.reload(config).FETCH_AUTOSTART, expected, value)
        importlib.reload(config)  # leave the module as the rest of the suite found it


if __name__ == "__main__":
    unittest.main()
