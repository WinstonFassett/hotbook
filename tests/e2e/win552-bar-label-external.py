# Regression test (WIN-552): a bar's value label must follow an external edit of its value.
#
#   uv run --with playwright python tests/e2e/win552-bar-label-external.py
#   BASE_URL=http://hotbook-demos.localhost:1355 to target another host.
#   SHOT=path.png to save a screenshot of the bar-chart section after the edit.
#
# Scrubbing a value in the side table grew the bar but left its label on the old number.

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
    """Value label text and bar height for one bar, plus the table cell text."""
    return page.evaluate(
        """([section, id]) => {
            const root = document.querySelector('#' + section);
            const tile = root.querySelector('svg [data-id="' + id + '"]');
            const rect = tile.tagName === 'rect' ? tile : tile.querySelector('rect');
            const labels = Array.from(tile.querySelectorAll('text')).map(t => t.textContent.trim());
            const cell = root.querySelector('v-treetable [data-value-cell^="' + id + ':"]');
            return { labels, height: rect.getBoundingClientRect().height, cell: cell.textContent.trim() };
        }""",
        [section, bar_id],
    )


def scrub_cell(page, section: str, bar_id: str, dx: int) -> None:
    cell = page.locator(f'#{section} v-treetable [data-value-cell^="{bar_id}:"]').first
    box = cell.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(x + dx * i / 10, y)
        page.wait_for_timeout(30)
    page.mouse.up()
    page.wait_for_timeout(900)


def run(page) -> None:
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)
    section, bar_id = "bar-chart", "Feb"
    page.locator(f"#{section}").scroll_into_view_if_needed()
    page.wait_for_timeout(300)

    before = bar_state(page, section, bar_id)
    check("bar label starts equal to the table value", before["cell"] in before["labels"], str(before))

    scrub_cell(page, section, bar_id, 80)
    after = bar_state(page, section, bar_id)
    if SHOT:
        page.locator(f"#{section}").screenshot(path=SHOT)

    check("table edit changed the value", after["cell"] != before["cell"], f"{before['cell']} -> {after['cell']}")
    check("bar height follows the external edit", after["height"] > before["height"] + 2, f"{before['height']:.1f} -> {after['height']:.1f}")
    check("bar value label follows the external edit", after["cell"] in after["labels"], f"labels={after['labels']} table={after['cell']}")


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
