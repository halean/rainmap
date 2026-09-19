"""
Collects rendered Himawari-9 frames so a recent window can be replayed.

Why a poller and not on demand: a twelve-hour history at ten-minute steps only
exists if every scan was drawn while it was current. Nothing can reconstruct
08:20 at noon except having fetched it at 08:20.

What it costs, measured rather than estimated: a daylight scan is a 71 MB fetch
(the visible band's two 0.5 km strips, plus the infrared band's, which are
cheap) and about 26 seconds to decode and draw. A night scan is 6 MB. At 144
scans a day that is ~5.0 GB/day, of which the visible band is 83%. Set
HIMAWARI_POLL=infrared to keep every scan round the clock for ~0.86 GB/day and
give up the daylight texture -- the band that identifies convection is in both,
and the city's storms peak after dark, when visible is blank anyway.

The bytes are inbound on an open NOAA dataset built for bulk access, and the
frames themselves are a few hundred KB each: the cost is the fetching, not the
keeping.
"""

import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import (
    HIMAWARI_IMAGE_SIZE,
    HIMAWARI_POLL,
    HIMAWARI_RETENTION_HOURS,
    HIMAWARI_STORE,
)
from app.log_setup import get_logger
from app.services import himawari

UTC = timezone.utc
log = get_logger("himawari_poller")

# Scans land a few minutes after the instrument finishes, and the strips arrive
# one at a time. Checking every minute picks a new one up promptly without
# hammering the bucket: resolve_plan only makes HEAD requests until a scan is
# complete, and caches its answer for a minute anyway.
POLL_SECONDS = 60
# A fetch that fails is retried on the next pass, but a scan that keeps failing
# should not be retried forever -- it is almost certainly never going to appear.
MAX_ATTEMPTS = 3


def bands_to_collect(slot):
    """Which bands this poller wants for a scan, before the sun is consulted."""
    if HIMAWARI_POLL == "infrared":
        return ("B13",)
    return himawari.bands_for(slot)


def main():
    if HIMAWARI_POLL == "off":
        log.info("HIMAWARI_POLL=off; collection disabled")
        return
    log.info(
        "collecting %s frames at size %d into %s, keeping %.0f h",
        HIMAWARI_POLL, HIMAWARI_IMAGE_SIZE, HIMAWARI_STORE, HIMAWARI_RETENTION_HOURS,
    )
    attempts = {}
    while True:
        try:
            now = datetime.now(UTC)
            bands = bands_to_collect(now)
            slot, plan = himawari.resolve_plan(now, bands)
            stamp = slot.strftime("%Y%m%d%H%M")
            if himawari.load_scene(slot, HIMAWARI_IMAGE_SIZE) is not None:
                pass  # already collected; nothing to do until the next scan lands
            elif attempts.get(stamp, 0) >= MAX_ATTEMPTS:
                pass  # given up on this one; it will age out of `attempts` below
            else:
                attempts[stamp] = attempts.get(stamp, 0) + 1
                started = time.monotonic()
                scene = himawari.render(slot, plan, HIMAWARI_IMAGE_SIZE)
                path = himawari.save_scene(scene)
                log.info(
                    "%s %s (%s) -> %s, %d KB in %.1fs",
                    stamp, scene.mode, "+".join(scene.bands),
                    path.name, len(scene.png) // 1024, time.monotonic() - started,
                )
            dropped = himawari.prune_store(now)
            if dropped:
                log.info("pruned %d frame(s) past %.0f h", dropped, HIMAWARI_RETENTION_HOURS)
            # Forget attempt counters for scans that have aged out, so the dict
            # cannot grow for the life of the process.
            kept = {f["stamp"] for f in himawari.stored_frames(now=now)}
            attempts = {s: n for s, n in attempts.items() if s in kept or s == stamp}
        except himawari.HimawariUnavailable as e:
            log.info("no scan to collect: %s", e)
        except Exception:
            # One bad scan must not end the collection; the next pass retries.
            log.exception("collection pass failed")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
