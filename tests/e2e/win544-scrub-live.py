# Regression test (WIN-544): lens-fed charts (bar, radar) must follow a side-table scrub live.
#
#   uv run --with playwright python tests/e2e/win544-scrub-live.py
#   BASE_URL=http://hotbook-demos.localhost:1355 to target another host.
#   SHOT=path.png to save a screenshot of the bar-chart section mid-scrub.
#
# Scrubbing a value cell in the side table moved the table number on every pointer move,
# but the bar and the radar point stayed put until the pointer was released.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")
SHOT = os.environ.get("SHOT")

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


def bar_state(page, section: str, bar_id: str) -> dict:
    return page.evaluate(
        """([section, id]) => {
            const root = document.querySelector('#' + section);
            const tile = root.querySelector('svg [data-id="' + id + '"]');
            const rect = tile.tagName === 'rect' ? tile : tile.querySelector('rect');
            const cell = root.querySelector('v-treetable [data-value-cell^="' + id + ':"]');
            return { height: rect.getBoundingClientRect().height, cell: cell.textContent.trim() };
        }""",
        [section, bar_id],
    )


def radar_state(page, section: str, spoke_id: str) -> dict:
    return page.evaluate(
        """([section, id]) => {
            const root = document.querySelector('#' + section);
            const dot = root.querySelector('svg [data-focusable="spoke"][aria-label^="' + id + ':"] circle');
            const svg = dot.ownerSVGElement.getBoundingClientRect();
            const b = dot.getBoundingClientRect();
            const cx = b.x + b.width / 2 - (svg.x + svg.width / 2);
            const cy = b.y + b.height / 2 - (svg.y + svg.height / 2);
            const cell = root.querySelector('v-treetable [data-value-cell^="' + id + ':"]');
            return { r: Math.hypot(cx, cy), cell: cell.textContent.trim() };
        }""",
        [section, spoke_id],
    )


def scrub(page, section: str, node_id: str, dx: int, sample):
    """Press on the table cell, move in steps, sample before release, then release."""
    page.locator(f"#{section}").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    cell = page.locator(f'#{section} v-treetable [data-value-cell^="{node_id}:"]').first
    box = cell.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    before = sample()
    page.mouse.move(x, y)
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(x + dx * i / 10, y)
        page.wait_for_timeout(30)
    page.wait_for_timeout(200)
    mid = sample()
    if SHOT and section == "bar-chart":
        page.locator(f"#{section}").screenshot(path=SHOT)
    page.mouse.up()
    page.wait_for_timeout(900)
    after = sample()
    return before, mid, after


def run(page) -> None:
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)

    before, mid, after = scrub(page, "bar-chart", "Feb", 80, lambda: bar_state(page, "bar-chart", "Feb"))
    check("bar: table cell changes mid-scrub", mid["cell"] != before["cell"], f"{before['cell']} -> {mid['cell']}")
    check("bar: bar height follows mid-scrub", mid["height"] > before["height"] + 2, f"{before['height']:.1f} -> {mid['height']:.1f}")
    check("bar: bar height settles on release", after["height"] > before["height"] + 2, f"{before['height']:.1f} -> {after['height']:.1f}")

    before, mid, after = scrub(page, "radar-chart", "Speed", 80, lambda: radar_state(page, "radar-chart", "Speed"))
    check("radar: table cell changes mid-scrub", mid["cell"] != before["cell"], f"{before['cell']} -> {mid['cell']}")
    check("radar: point moves mid-scrub", abs(mid["r"] - before["r"]) > 1, f"r {before['r']:.1f} -> {mid['r']:.1f}")
    check("radar: point settles on release", abs(after["r"] - before["r"]) > 1, f"r {before['r']:.1f} -> {after['r']:.1f}")


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_context(viewport={"width": 1600, "height": 1000}).new_page()
        try:
            run(page)
        except Exception as e:
            print(f"ERROR  {e}", file=sys.stderr)
            failures.append(f"exception: {e}")
        finally:
            browser.close()
    if failures:
        print(f"\n{len(failures)} FAILURES: {', '.join(failures)}")
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
