# Regression test (WIN-544): lens-fed charts (bar, radar) must follow a side-table
# value scrub live, not only once the scrub is released.
#
#   uv run --with playwright python tests/e2e/demos-table-scrub-live-chart.py
#
# A table-cell scrub is a Kernel draft. Kernel charts preview drafts via the
# broadcast; flat charts are fed through BiNode `total` lenses, which the
# bi-adapter only wrote back on Kernel publish (commit). So the bar/radar sat
# still during the drag and jumped on release.

import math
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


BAR_HEIGHT = """(id) => document.querySelector('#bar-chart v-bar-chart svg g[data-id="' + id + '"] rect')
  .getBoundingClientRect().height"""

RADAR_RADIUS = """(id) => {
  const svg = document.querySelector('#radar-chart v-radar-chart svg').getBoundingClientRect();
  const b = document.querySelector('#radar-chart [aria-label^="' + id + ':"]').getBoundingClientRect();
  return Math.hypot(b.x + b.width / 2 - (svg.x + svg.width / 2), b.y + b.height / 2 - (svg.y + svg.height / 2));
}"""


def cell(page, section: str, node_id: str):
    return page.locator(f'#{section} v-treetable [data-value-cell="{node_id}:value"]').first


def scrub(page, section: str, node_id: str, dx: int, finish: str, measure: str, arg: str) -> dict:
    page.locator(f"#{section}").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    c = cell(page, section, node_id)
    box = c.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    r = {"table_before": float(c.text_content()), "before": page.evaluate(measure, arg)}
    page.mouse.move(x, y)
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(x + dx * i / 10, y)
        page.wait_for_timeout(30)
    page.wait_for_timeout(250)
    r["table_mid"] = float(c.text_content())
    r["mid"] = page.evaluate(measure, arg)
    if finish == "escape":
        page.keyboard.press("Escape")
        page.wait_for_timeout(700)  # let the settle transition finish
        r["escaped"] = page.evaluate(measure, arg)
    page.mouse.up()
    page.wait_for_timeout(700)
    r["after"] = page.evaluate(measure, arg)
    r["table_after"] = float(c.text_content())
    return r


def grew(a: float, b: float) -> bool:
    return b > a + 2


def run(page) -> None:
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)

    r = scrub(page, "bar-chart", "Feb", 80, "release", BAR_HEIGHT, "Feb")
    check("bar: table scrubs live", r["table_mid"] > r["table_before"], f"{r['table_before']} -> {r['table_mid']}")
    check("bar: bar follows mid-scrub", grew(r["before"], r["mid"]), f"h {r['before']:.1f} -> {r['mid']:.1f}")
    check("bar: bar holds after release", grew(r["before"], r["after"]), f"h {r['after']:.1f}")

    r = scrub(page, "bar-chart", "Mar", 80, "escape", BAR_HEIGHT, "Mar")
    check("bar(esc): bar follows mid-scrub", grew(r["before"], r["mid"]), f"h {r['before']:.1f} -> {r['mid']:.1f}")
    check("bar(esc): Escape reverts the bar", abs(r["escaped"] - r["before"]) < 2, f"h {r['escaped']:.1f} vs {r['before']:.1f}")
    check("bar(esc): bar stays reverted", abs(r["after"] - r["before"]) < 2, f"h {r['after']:.1f}")
    check("bar(esc): table reverts", r["table_after"] == r["table_before"], f"{r['table_after']}")

    r = scrub(page, "radar-chart", "Speed", 80, "release", RADAR_RADIUS, "Speed")
    check("radar: table scrubs live", r["table_mid"] > r["table_before"], f"{r['table_before']} -> {r['table_mid']}")
    check("radar: dot follows mid-scrub", grew(r["before"], r["mid"]), f"r {r['before']:.1f} -> {r['mid']:.1f}")
    check("radar: dot holds after release", grew(r["before"], r["after"]), f"r {r['after']:.1f}")

    r = scrub(page, "radar-chart", "Power", 80, "escape", RADAR_RADIUS, "Power")
    check("radar(esc): dot follows mid-scrub", grew(r["before"], r["mid"]), f"r {r['before']:.1f} -> {r['mid']:.1f}")
    check("radar(esc): Escape reverts the dot", abs(r["escaped"] - r["before"]) < 2, f"r {r['escaped']:.1f} vs {r['before']:.1f}")


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
