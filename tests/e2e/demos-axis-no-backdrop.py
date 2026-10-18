# Regression test (WIN-546): bar/bands value axis must not draw a framed backdrop box.
#
#   uv run --with playwright python tests/e2e/demos-axis-no-backdrop.py
#
# bar-chart.ts drew a "solid backdrop" rect behind the fixed value axis. The bar CSS
# strokes every rect with var(--text-color), so it rendered as a white box around the
# whole y-axis column (BarChart) / x-axis strip (Bands). Line and area axes have none.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")

SECTIONS = ["bar-chart", "bands-chart"]

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


# Visible rects that sit on the chart's left edge (vertical axis column) or bottom edge
# (horizontal axis strip) and span most of the chart. Bars never do; the backdrop did.
AXIS_BOXES = """(s) => {
  const host = document.querySelector('#' + s + ' v-bar-chart, #' + s + ' v-bands-chart')
    || [...document.querySelectorAll('#' + s + ' *')].find(e => e.shadowRoot || e.querySelector?.('svg'));
  const svg = host.querySelector('svg') || host.shadowRoot?.querySelector('svg');
  const sb = svg.getBoundingClientRect();
  const out = [];
  for (const r of svg.querySelectorAll('rect')) {
    const cs = getComputedStyle(r);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const b = r.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) continue;
    const leftColumn = Math.abs(b.left - sb.left) < 6 && b.height > sb.height * 0.6;
    const bottomStrip = (b.top - sb.top) > sb.height - 45 && b.width > sb.width * 0.6;
    if (leftColumn || bottomStrip) {
      out.push({ fill: r.getAttribute('fill'), x: Math.round(b.left - sb.left), y: Math.round(b.top - sb.top),
                 w: Math.round(b.width), h: Math.round(b.height) });
    }
  }
  return { count: svg.querySelectorAll('rect').length, boxes: out };
}"""


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(1000)
    for sec in SECTIONS:
        page.locator(f"#{sec}").scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        res = page.evaluate(AXIS_BOXES, sec)
        check(f"{sec}: chart rendered rects", res["count"] >= 5, f"rects={res['count']}")
        check(f"{sec}: no framed box around the value axis", not res["boxes"], str(res["boxes"]))
    browser.close()

if failures:
    print(f"{len(failures)} check(s) failed")
    sys.exit(1)
print("All checks passed")
