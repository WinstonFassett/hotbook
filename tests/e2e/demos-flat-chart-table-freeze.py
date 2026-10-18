# Regression test (WIN-539): the side table holds its row order while a flat chart's value drag is live.
#
#   uv run --with playwright python tests/e2e/demos-flat-chart-table-freeze.py
#
# Sorted by value, chart drags pushed values into the table every move and the table re-sorted mid-gesture.

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


def set_sort_value(page, section: str) -> None:
    selects = page.locator(f"#{section} .chart-config-controls select")
    for i in range(selects.count()):
        opts = selects.nth(i).evaluate("el => Array.from(el.options).map(o => o.value)")
        if "index" in opts and "value" in opts:
            selects.nth(i).select_option("value")
            page.wait_for_timeout(600)
            return
    raise RuntimeError(f"no sort select in #{section}")


def row_ids(page, section: str) -> list[str]:
    return page.eval_on_selector_all(
        f"#{section} v-treetable [data-id]", "els => els.map(e => e.dataset.id)"
    )


def table_value(page, section: str, node_id: str) -> float:
    return float(
        page.locator(f'#{section} v-treetable [data-value-cell^="{node_id}:"]').first.text_content()
    )


def drag(page, section: str, node_id: str, start: tuple[float, float], delta: tuple[float, float], finish: str) -> dict:
    x, y = start
    dx, dy = delta
    before = table_value(page, section, node_id)
    order_before = row_ids(page, section)
    page.mouse.move(x, y)
    page.wait_for_timeout(100)
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(x + dx * i / 10, y + dy * i / 10)
        page.wait_for_timeout(40)
    page.wait_for_timeout(200)
    mid = table_value(page, section, node_id)
    order_mid = row_ids(page, section)
    if finish == "escape":
        page.keyboard.press("Escape")
    page.mouse.up()
    page.wait_for_timeout(900)
    return {
        "before": before,
        "mid": mid,
        "after": table_value(page, section, node_id),
        "order_before": order_before,
        "order_mid": order_mid,
        "order_after": row_ids(page, section),
    }


def bar_handle(page, node_id: str) -> tuple[float, float]:
    page.locator("#bar-chart").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    box = page.locator(f'#bar-chart v-bar-chart svg g[data-id="{node_id}"] circle').first.bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def run(page) -> None:
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)

    set_sort_value(page, "bar-chart")
    r = drag(page, "bar-chart", "Oct", bar_handle(page, "Oct"), (0, -200), "release")
    check("bar: Oct is not already first", r["order_before"][0] != "Oct", str(r["order_before"]))
    check("bar: table value updates live", r["mid"] > r["before"], f"{r['before']} -> {r['mid']}")
    check("bar: table holds order mid-drag", r["order_mid"] == r["order_before"], str(r["order_mid"]))
    check("bar: table re-sorts after release", r["order_after"][0] == "Oct", str(r["order_after"]))

    page.reload(wait_until="networkidle")
    page.wait_for_timeout(800)
    set_sort_value(page, "bar-chart")
    r = drag(page, "bar-chart", "Oct", bar_handle(page, "Oct"), (0, -200), "escape")
    check("bar(esc): table value updates live", r["mid"] > r["before"], f"{r['before']} -> {r['mid']}")
    check("bar(esc): table holds order mid-drag", r["order_mid"] == r["order_before"], str(r["order_mid"]))
    check("bar(esc): Escape reverts value", r["after"] == r["before"], f"{r['before']} -> {r['after']}")
    check("bar(esc): Escape keeps order", r["order_after"] == r["order_before"], str(r["order_after"]))

    set_sort_value(page, "radar-chart")
    page.locator("#radar-chart").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    svg = page.locator("#radar-chart v-radar-chart svg").first.bounding_box()
    cx, cy = svg["x"] + svg["width"] / 2, svg["y"] + svg["height"] / 2
    dot = page.locator('#radar-chart v-radar-chart [aria-label^="Speed:"]').first.bounding_box()
    sx, sy = dot["x"] + dot["width"] / 2, dot["y"] + dot["height"] / 2
    ux, uy = sx - cx, sy - cy
    norm = math.hypot(ux, uy) or 1.0
    r = drag(page, "radar-chart", "Speed", (sx, sy), (ux / norm * 100, uy / norm * 100), "release")
    check("radar: Speed is not already first", r["order_before"][0] != "Speed", str(r["order_before"]))
    check("radar: table value updates live", r["mid"] > r["before"], f"{r['before']} -> {r['mid']}")
    check("radar: table holds order mid-drag", r["order_mid"] == r["order_before"], str(r["order_mid"]))
    check("radar: table re-sorts after release", r["order_after"][0] == "Speed", str(r["order_after"]))


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
