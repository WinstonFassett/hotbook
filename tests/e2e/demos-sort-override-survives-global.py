# Regression test — per-chart sort override must survive global sort toggle.
#
#   uv run --with playwright python tests/e2e/demos-sort-override-survives-global.py
#   BASE_URL=http://hotbook-demos.localhost:1355 to target another host.
#
# Guards the A5 regression: the demos page had a mutable `let config` global
# sort that fought per-chart sort selectors. Changing the global sort button
# clobbered any per-chart override. Root cause: the demos page was entirely
# imperative (no cell/derive/effect) — `applySort` loop walked `mounted[]`
# using the stale global, overwriting per-chart overrides.
# Fix: `globalSort` cell + per-chart `sortOverride` cells + `wireSort` effect.
# The effect reads `effective = override ?? global` — charts with an override
# are untouched by global changes.
#
# Assertion:
#   Set the bar chart's per-chart sort to "value" via its config selector.
#   Click the global sort button (toggle global to value, then back to index).
#   The bar chart must STAY sorted by value throughout — the per-chart
#   override blocks the global from clobbering it.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")
URL = f"{BASE}/"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


# Read the bar chart's effective sort from the reactive cell state.
# The demos page tracks per-chart sort in `chartSortStates` map keyed by element.
BAR_SORT_JS = """() => {
  // The bar chart element on the demos page.
  const el = document.querySelector('v-br-bar') || document.querySelector('v-bar-chart');
  if (!el) return { error: 'no bar chart element found' };
  // Read the data array order to determine effective sort.
  const arr = el.dataCell?.peek?.() || el.dataCell?.value || [];
  const ids = arr.map(d => d.id ?? d.label ?? d.name);
  const vals = Object.fromEntries(arr.map(d => [d.id ?? d.label ?? d.name, d.value]));
  // Check if sorted descending by value (value sort) or by insertion order (index sort).
  const byValue = [...arr].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const isValueSorted = ids.every((id, i) => {
    const sortedId = byValue[i]?.id ?? byValue[i]?.label ?? byValue[i]?.name;
    return id === sortedId;
  });
  return { isValueSorted, ids, vals: ids.map(id => [id, vals[id]]) };
}"""


def run(page) -> None:
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(800)

    # Find the bar chart's per-chart sort selector in its config controls.
    # The demos page builds a <select> with options "Order" and "Value" per chart.
    bar_section = page.locator("#bar-chart").first
    if bar_section.count() == 0:
        check("bar-chart section exists", False, "no #bar-chart section")
        return

    # The per-chart sort <select> lives inside .chart-config-controls under the bar section.
    # It's the select with "index" and "value" options (not measure value/value2).
    all_selects = bar_section.locator(".chart-config-controls select")
    sort_select_idx = None
    for i in range(all_selects.count()):
        opts = all_selects.nth(i).evaluate("el => Array.from(el.options).map(o => o.value)")
        if 'index' in opts and 'value' in opts:
            sort_select_idx = i
            break
    if sort_select_idx is None:
        check("per-chart sort selector exists", False, "no select with index/value options")
        return
    sort_select = all_selects.nth(sort_select_idx)

    # Set per-chart sort to "value".
    sort_select.select_option("value")
    page.wait_for_timeout(500)

    snap1 = page.evaluate(BAR_SORT_JS)
    check("bar sorted by value after per-chart selector", snap1.get("isValueSorted"), str(snap1))

    # Find the global sort button in the repro-config-bar.
    global_btn = page.locator(".repro-config-bar button:has-text('sort:')").first
    if global_btn.count() == 0:
        check("global sort button exists", False, "no sort button in .repro-config-bar")
        return

    # Click global sort button once (toggles global to the other value).
    global_btn.click()
    page.wait_for_timeout(500)
    snap2 = page.evaluate(BAR_SORT_JS)
    check("bar still value-sorted after 1st global toggle", snap2.get("isValueSorted"), str(snap2))

    # Click global sort button again (toggles global back).
    global_btn.click()
    page.wait_for_timeout(500)
    snap3 = page.evaluate(BAR_SORT_JS)
    check("bar still value-sorted after 2nd global toggle", snap3.get("isValueSorted"), str(snap3))


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context()
        page = ctx.new_page()
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
