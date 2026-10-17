# Regression test (WIN-538): side-table value scrub must work while sorted by value.
#
#   uv run --with playwright python tests/e2e/demos-table-scrub-sorted.py
#
# Sorted by value, each write re-rendered the rows and cancelled the live numberDrag.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


def set_sort_value(page, section: str) -> None:
    selects = page.locator(f"#{section} .chart-config-controls select")
    for i in range(selects.count()):
        opts = selects.nth(i).evaluate("el => Array.from(el.options).map(o => o.value)")
        if "index" in opts and "value" in opts:
            selects.nth(i).select_option("value")
            page.wait_for_timeout(600)
            return
    raise RuntimeError(f"no sort select in #{section}")


def cell(page, section: str, node_id: str):
    return page.locator(f'#{section} v-treetable [data-value-cell^="{node_id}:"]').first


def row_ids(page, section: str) -> list[str]:
    return page.eval_on_selector_all(
        f"#{section} v-treetable [data-id]", "els => els.map(e => e.dataset.id)"
    )


def scrub(page, section: str, node_id: str, dx: int, finish: str) -> dict:
    page.locator(f"#{section}").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    c = cell(page, section, node_id)
    box = c.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    before = float(c.text_content())
    order_before = row_ids(page, section)
    page.mouse.move(x, y)
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(x + dx * i / 10, y)
        page.wait_for_timeout(30)
    mid = float(cell(page, section, node_id).text_content())
    order_mid = row_ids(page, section)
    if finish == "escape":
        page.keyboard.press("Escape")
    page.mouse.up()
    page.wait_for_timeout(700)
    return {
        "before": before,
        "mid": mid,
        "after": float(cell(page, section, node_id).text_content()),
        "order_before": order_before,
        "order_mid": order_mid,
        "order_after": row_ids(page, section),
    }


def run(page) -> None:
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)

    set_sort_value(page, "bar-chart")
    r = scrub(page, "bar-chart", "Feb", 80, "escape")
    check("bar: value scrubs live while sorted", r["mid"] > r["before"], f"{r['before']} -> {r['mid']}")
    check("bar: rows hold order mid-scrub", r["order_mid"] == r["order_before"], str(r["order_mid"]))
    check("bar: Escape reverts", r["after"] == r["before"], f"{r['after']}")

    r = scrub(page, "bar-chart", "Feb", 80, "release")
    check("bar: release commits", r["after"] > r["before"], f"{r['before']} -> {r['after']}")
    i_feb, i_mar = r["order_after"].index("Feb"), r["order_after"].index("Mar")
    check("bar: rows re-sort after release", i_feb < i_mar, str(r["order_after"]))

    set_sort_value(page, "icicle")
    r = scrub(page, "icicle", "aapl", 80, "release")
    check("icicle: leaf scrubs while sorted", r["after"] > r["before"], f"{r['before']} -> {r['after']}")
    check("icicle: rows hold order mid-scrub", r["order_mid"] == r["order_before"], "")


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
