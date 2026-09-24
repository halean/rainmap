"""The hang-proofing in scripts/tia_poller.py.

The poller once sat for 38 hours inside a Playwright launch() that never
returned: the driver process was alive with no Chromium under it, and the
Python client waits on the driver pipe with no client-side timeout. These
pin the two pieces that make that impossible now: every driver call runs
under a deadline that ends by killing the driver's process tree, and that
tree walk actually finds and kills descendants.
"""

import asyncio
import logging
import os
import signal
import time
import unittest
from unittest.mock import patch

from scripts import tia_poller


class QuietLoggerTests(unittest.TestCase):
    """tia_poller.log is the module-level logger the live poller writes to
    (logs/tia_poller.log) -- on this host that is a real, currently-running
    service's log file, not a test fixture. Detach its handlers for the
    duration of each test here so exercising with_deadline's error path
    does not interleave synthetic "hung thing" lines into it."""

    def setUp(self):
        self._handlers = tia_poller.log.handlers[:]
        tia_poller.log.handlers = [logging.NullHandler()]
        self.addCleanup(lambda: setattr(tia_poller.log, "handlers", self._handlers))


class ProcessTreeTests(QuietLoggerTests):
    def test_descendants_finds_a_grandchild_and_kill_descendants_ends_it(self):
        # os.fork()+os.waitpid(), not subprocess.Popen: the DeadlineTests
        # above call asyncio.run(), which installs an asyncio child watcher
        # in this process, and that watcher can reap a subprocess.Popen
        # child out from under it before Popen's own wait() sees it -- a
        # known asyncio/subprocess interaction, unrelated to the code under
        # test. A raw fork sidesteps it entirely: we reap the pid ourselves.
        pid = os.fork()
        if pid == 0:
            os.setsid()
            if os.fork() == 0:  # the grandchild, standing in for Chromium under the driver
                time.sleep(300)
                os._exit(0)
            time.sleep(300)
            os._exit(0)
        try:
            time.sleep(0.3)
            found = tia_poller.descendants(os.getpid())
            self.assertIn(pid, found)
            self.assertTrue(any(p != pid for p in found), "the grandchild was not found")
            tia_poller.kill_descendants(os.getpid())
            _, status = os.waitpid(pid, 0)
            self.assertTrue(os.WIFSIGNALED(status), f"child was not killed by a signal, status={status}")
            self.assertEqual(os.WTERMSIG(status), signal.SIGKILL)
        finally:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


class DeadlineTests(QuietLoggerTests):
    def test_a_prompt_call_returns_its_result(self):
        async def quick():
            await asyncio.sleep(0.01)
            return "ok"
        self.assertEqual(asyncio.run(tia_poller.with_deadline(quick(), 2, "quick")), "ok")

    def test_a_hung_call_is_cut_off_the_driver_tree_killed_and_DriverWedged_raised(self):
        # kill_descendants ending the driver's process is what makes a real
        # stuck Playwright await raise quickly (a closed pipe errors the
        # pending read); the mock's Event models that same effect here,
        # rather than falling through to with_deadline's own 10 s grace
        # window, which exists for OS calls to actually land, not for this.
        killed = []
        release = asyncio.Event()
        async def hung():
            await release.wait()
            raise ConnectionError("driver pipe closed")
        def fake_kill(pid=None):
            killed.append(True)
            release.set()
        with patch.object(tia_poller, "kill_descendants", fake_kill):
            started = time.monotonic()
            with self.assertRaises(tia_poller.DriverWedged):
                asyncio.run(tia_poller.with_deadline(hung(), 0.3, "hung thing"))
            self.assertLess(time.monotonic() - started, 3)
        self.assertEqual(killed, [True])

    def test_a_call_that_raises_promptly_propagates_its_own_error(self):
        async def broken():
            raise ValueError("page changed")
        with self.assertRaises(ValueError):
            asyncio.run(tia_poller.with_deadline(broken(), 2, "broken"))


if __name__ == "__main__":
    unittest.main()
