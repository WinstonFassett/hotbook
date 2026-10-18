# Regression test (WIN-552): the bar chart's value label must update after an external
# edit (side-table scrub), not just the bar geometry.
#
#   uv run --with playwright python tests/e2e/demos-bar-value-label-external-edit.py
#
# Each bar's label/aria-label derived from a per-id datum cell. External writes mutate
# the datum in place and republish the array, so the datum cell's value was the same
# object (Object.is) and the label never recomputed; the geometry only moved because the
# value scale is rebuilt from the array.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


BAR = """(id) => {
  const g = document.querySelector('#bar-chart v-bar-chart svg g[data-id="' + id + '"]');
  const nums = [...g.querySelectorAll('text')].map(t => (t.textContent || '').trim()).filter(t => /^-?\\d+$/.test(t));
  return { height: g.querySelector('rect').getBoundingClientRect().height, aria: g.getAttribute('aria-label'), label: nums[0] ?? null };
}"""


def cell(page, node_id: str):
    return page.locator(f'#bar-chart v-treetable [data-value-cell="{node_id}:value"]').first


def scrub(page, node_id: str, dx: int) -> None:
    page.locator("#bar-chart").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    box = cell(page, node_id).bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(x + dx * i / 10, y)
        page.wait_for_timeout(30)
    page.mouse.up()
    page.wait_for_timeout(800)


def run(page) -> None:
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)

    before = page.evaluate(BAR, "Feb")
    v0 = float(cell(page, "Feb").text_content())
    check("bar: label matches table before edit", before["label"] == str(round(v0)), f"{before['label']} vs {v0}")

    scrub(page, "Feb", 80)
    v1 = float(cell(page, "Feb").text_content())
    after = page.evaluate(BAR, "Feb")
    check("bar: table edit took", v1 > v0, f"{v0} -> {v1}")
    check("bar: bar grew", after["height"] > before["height"] + 2, f"{before['height']:.1f} -> {after['height']:.1f}")
    check("bar: value label follows the external edit", after["label"] == str(round(v1)), f"label {after['label']} vs table {v1}")
    check("bar: aria-label follows the external edit", after["aria"] == f"Feb: {round(v1)}", f"{after['aria']}")

    # Second edit on the same bar: the label must keep tracking, not just once.
    scrub(page, "Feb", -40)
    v2 = float(cell(page, "Feb").text_content())
    again = page.evaluate(BAR, "Feb")
    check("bar: label follows a second edit", v2 != v1 and again["label"] == str(round(v2)), f"label {again['label']} vs table {v2}")


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
