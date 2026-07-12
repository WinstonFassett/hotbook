# Regression test — sunburst divider drag must not freeze under sort-by-value.
#
#   uv run --with playwright python tests/e2e/win257-sunburst-resize-freeze.py
#   BASE_URL=http://demos.localhost:1355 to target another demos host.
#
# WIN-257. Bug: on the demos page with sort:value, resizing a sunburst slice
# (drag a divider knob) freezes mid-gesture — the handle jumps off the slice
# and the drag no longer moves the boundary. Root cause: sort:value re-ranked
# siblings mid-drag (values shifted), the partition remapped x0/x1 to a new
# order, and the handleWindow forEach diff destroyed the currently-dragging
# handle. Rules 2/5/7 all violated.
#
# Fix: sunburst captures a frozen sibling sort key at pointerdown on any
# divider handle and holds that order through the whole gesture. Layout still
# updates x0/x1 proportionally so arcs preview live, but no re-rank happens
# until the gesture releases.
#
# Assertion: after a horizontal drag on a divider knob under sort:value, the
# knob must have moved a meaningful pixel distance in the drag direction —
# not stuck within a few px of its origin.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://demos.localhost:1355")
URL = f"{BASE}/demos/#cfg:sort=value|sunburst"

failures: list[str] = []
errors: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


# Find the first line-handle knob inside the sunburst demo section and return
# its viewport-center coordinates. line-handle emits a <g> with a <line> and a
# central hit circle; we hit the bounding-box center.
FIND_KNOB_JS = """() => {
  const section = document.querySelector('#sunburst');
  if (!section) return null;
  const el = section.querySelector('v-sunburst');
  if (!el) return null;
  const root = el.shadowRoot || el;
  // Handles live in a layer of <g> under the top layer. Grab first divider.
  const handles = [...root.querySelectorAll('g[data-kind="divider"], g.handle, g')]
    .filter(g => g.querySelector && g.querySelector('line'));
  if (!handles.length) return null;
  const h = handles[0];
  const r = h.getBoundingClientRect();
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}"""


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(1200)

    check("v-sunburst mounted", page.query_selector("v-sunburst") is not None)

    knob = page.evaluate(FIND_KNOB_JS)
    if not knob:
        check("found a divider knob", False)
    else:
        x0, y0 = knob["cx"], knob["cy"]
        page.mouse.move(x0, y0)
        page.wait_for_timeout(60)
        page.mouse.down()
        # Drag in ~40px steps to give the layout time to preview live.
        for step in range(1, 6):
            page.mouse.move(x0 + step * 40, y0 + step * 10, steps=8)
            page.wait_for_timeout(30)
        page.mouse.up()
        page.wait_for_timeout(200)

        after = page.evaluate(FIND_KNOB_JS)
        # The knob DOM node may re-key on release; either way the divider under
        # that region should have shifted well past the freeze radius.
        moved = after and (abs(after["cx"] - x0) + abs(after["cy"] - y0)) > 30
        check(
            "divider knob moved (no freeze)",
            bool(moved),
            f"start=({x0:.0f},{y0:.0f}) end=({after and after['cx']:.0f},{after and after['cy']:.0f})",
        )

    check("no page errors", not errors, "; ".join(errors))
    browser.close()

if failures or errors:
    print(f"\nFAILURES: {failures}  ERRORS: {errors}")
    sys.exit(1)
print("\nALL WIN-257 CHECKS PASSED")
