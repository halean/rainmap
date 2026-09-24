"""Poll Tan Son Nhat's official flight board (tia.vietnamairport.vn) for the
3D map's runway animation.

The board is the airport operator's own live display, not a REST API: a
Blazor Server app that pushes grid updates over a persistent WebSocket, and
which has no `networkidle` moment to wait on for exactly that reason -- the
socket is always "active" network traffic. It has six pages, one per
direction x carrier group ({Arr,Dep}{Dom,VJ,Int}), each independently
loadable; the terminal buttons visible on any one page just navigate between
these six, they are not a filter within one page.

One page is visited per minute, round-robin, so the full set is refreshed
every six minutes -- gentle enough that this reads as a browser tab left open
and reloaded occasionally, not a scraper hammering an internal airport
display. A single headless Chromium is kept open across visits; only the page
is reloaded. Settling is `#page` (the "1/2" grid page indicator) becoming
present -- the one element that only exists once the Kendo grid has actually
rendered rows, unlike `networkidle` which the open WebSocket defeats.

Parsing lives in app/services/tia.py so it can be unit tested without a
browser; this script only drives Playwright and writes the merged result.
"""

import asyncio
import json
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.atomic_write import write_json_atomic
from app.config import TIA_STORE_PATH
from app.log_setup import get_logger
from app.services import tia

# Shared with app/services/flights.py's reader via app.config, so a custom
# TIA_STORE_PATH in .env moves both sides together.
OUT_PATH = TIA_STORE_PATH

BASE_URL = "https://tia.vietnamairport.vn"
LINK_ORDER = ["ArrDom", "ArrVJ", "ArrInt", "DepDom", "DepVJ", "DepInt"]
VISIT_INTERVAL_SEC = 60  # one link per tick; six ticks covers the full board
PAGE_READY_TIMEOUT_MS = 20000
# After the grid settles, wait this long for a second page ("2/2") to appear
# so a two-page board isn't only ever sampled on page 1. Bounded well under
# VISIT_INTERVAL_SEC so a slow page never delays the next link.
PAGE_FLIP_WAIT_SEC = 25
CHROMIUM_PATH = "/usr/bin/chromium-browser"  # system build; see 3d/README.md

UTC = timezone.utc
log = get_logger("tia_poller")


def _read_previous():
    try:
        return json.loads(OUT_PATH.read_text(encoding="utf-8")).get("flights", [])
    except (OSError, ValueError):
        return []


async def _grid_rows(page):
    """Cell text for every row of whichever k-grid-table is actually visible
    -- the DOM carries a second, hidden one (seemingly a preload for the next
    rotation) that must not be read as live data."""
    return await page.evaluate(
        """() => {
            const tables = [...document.querySelectorAll('table.k-grid-table')]
                .filter(t => t.offsetParent !== null);
            const best = tables.sort((a, b) =>
                b.querySelectorAll('tbody tr').length - a.querySelectorAll('tbody tr').length)[0];
            if (!best) return [];
            return [...best.querySelectorAll('tbody tr')]
                .map(tr => [...tr.children].map(td => td.innerText));
        }"""
    )


async def visit(browser, link):
    """One link's current page, and its second page if the board flips to one
    while we're there. Returns normalized flights, or raises on failure --
    the caller decides what a failed visit means for the merged set."""
    page = await browser.new_page(viewport={"width": 1600, "height": 1000})
    try:
        # "load", not "networkidle": the board's own WebSocket never goes idle.
        await page.goto(f"{BASE_URL}/{link}", wait_until="load", timeout=30000)
        await page.wait_for_selector("#page", timeout=PAGE_READY_TIMEOUT_MS)
        await page.wait_for_timeout(400)  # let the just-rendered row set settle
        now = datetime.now(UTC)
        rows = await _grid_rows(page)
        flights = tia.rows_from_grid(link, rows, now)
        first_page_text = await page.evaluate("document.querySelector('#page')?.innerText")
        deadline = time.monotonic() + PAGE_FLIP_WAIT_SEC
        while time.monotonic() < deadline:
            await page.wait_for_timeout(1500)
            current = await page.evaluate("document.querySelector('#page')?.innerText")
            if current and current != first_page_text:
                now2 = datetime.now(UTC)
                flights += tia.rows_from_grid(link, await _grid_rows(page), now2)
                break
        return flights
    finally:
        try:
            await asyncio.wait_for(page.close(), 5)
        except BaseException:
            pass


# Deadlines. Playwright's Python client waits on the driver pipe with no
# client-side timeout, so if the driver wedges (observed: a relaunch that
# never returned, for 38 hours, with the driver process alive and no
# Chromium under it) an un-deadlined await hangs the whole loop forever.
VISIT_TIMEOUT_SEC = 90     # goto 30 s + page-ready 20 s + page-flip 25 s + slack
LAUNCH_TIMEOUT_SEC = 45
# If nothing has been written for this long despite attempts, assume the
# driver is sick even if individual calls keep returning errors promptly.
STALL_SEC = 15 * 60


class DriverWedged(RuntimeError):
    pass


def descendants(pid):
    """All processes below `pid`, deepest first, from /proc (no psutil)."""
    children = {}
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open(f"/proc/{entry}/stat") as f:
                stat = f.read()
            ppid = int(stat[stat.rindex(")") + 2:].split()[1])
        except (OSError, ValueError, IndexError):
            continue
        children.setdefault(ppid, []).append(int(entry))
    out, stack = [], [pid]
    while stack:
        for child in children.get(stack.pop(), []):
            out.append(child); stack.append(child)
    return out[::-1]


def kill_descendants(pid=None):
    """Pull the plug on a wedged driver and any Chromium it spawned. A
    SIGKILLed driver closes the pipe, which is what finally makes a stuck
    Playwright await raise instead of waiting forever."""
    for child in descendants(pid or os.getpid()):
        try:
            os.kill(child, signal.SIGKILL)
        except OSError:
            pass


async def with_deadline(coro, seconds, what):
    """Await `coro` for at most `seconds`. On overrun, kill the driver tree so
    the stuck await can end, then raise DriverWedged. Plain wait_for is not
    enough: it cancels and then waits for the task, and a task stuck on a
    dead pipe -- including a page.close() in a finally -- never finishes."""
    task = asyncio.ensure_future(coro)
    done, _ = await asyncio.wait({task}, timeout=seconds)
    if task in done:
        return task.result()
    log.error("%s exceeded %ds; killing the browser driver", what, seconds)
    kill_descendants()
    try:
        await asyncio.wait_for(task, 10)
    except BaseException:
        pass
    raise DriverWedged(f"{what} hung")


async def run_forever():
    from playwright.async_api import async_playwright

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    current = {f["id"]: f for f in _read_previous()}
    index = 0
    while True:  # one Playwright driver lifetime per iteration
        playwright = None
        last_success = time.monotonic()
        try:
            playwright = await with_deadline(async_playwright().start(), LAUNCH_TIMEOUT_SEC, "starting playwright")

            async def launch():
                return await with_deadline(
                    playwright.chromium.launch(executable_path=CHROMIUM_PATH, headless=True,
                                               args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]),
                    LAUNCH_TIMEOUT_SEC, "launching chromium")

            browser = await launch()
            log.info("browser driver started")
            while True:
                link = LINK_ORDER[index % len(LINK_ORDER)]
                index += 1
                started = time.monotonic()
                # Chromium can die under memory pressure independently of any
                # one visit; a closed browser fails every new_page() until it
                # is relaunched.
                if not browser.is_connected():
                    log.warning("browser was closed; relaunching")
                    browser = await launch()
                try:
                    fresh = await with_deadline(visit(browser, link), VISIT_TIMEOUT_SEC, f"visit to {link}")
                    now = datetime.now(UTC)
                    merged = tia.merge(list(current.values()), fresh, now)
                    current = {f["id"]: f for f in merged}
                    write_json_atomic(OUT_PATH, {
                        "generated_at": now.isoformat().replace("+00:00", "Z"),
                        "last_link": link,
                        "flights": merged,
                    })
                    last_success = time.monotonic()
                    log.info("%s: %d rows -> %d flights tracked", link, len(fresh), len(merged))
                except DriverWedged:
                    raise
                except Exception as e:
                    # A stuck or redesigned page should not take the whole board
                    # offline: keep serving the last good merge and try the next
                    # link next tick. app/services/flights.py treats a stale file
                    # as stale, not absent.
                    log.warning("visit to %s failed (%s: %s); keeping previous data", link, type(e).__name__, str(e).splitlines()[0][:120])
                    if time.monotonic() - last_success > STALL_SEC:
                        raise DriverWedged(f"no successful visit for {STALL_SEC // 60} min")
                elapsed = time.monotonic() - started
                await asyncio.sleep(max(1.0, VISIT_INTERVAL_SEC - elapsed))
        except Exception as e:
            log.error("restarting the browser driver: %s: %s", type(e).__name__, str(e).splitlines()[0][:160])
        # Tear down whatever is left, forcibly if it will not stop, then start over.
        if playwright is not None:
            try:
                await asyncio.wait_for(playwright.stop(), 10)
            except BaseException:
                pass
        kill_descendants()
        await asyncio.sleep(5)


if __name__ == "__main__":
    try:
        asyncio.run(run_forever())
    except KeyboardInterrupt:
        pass
