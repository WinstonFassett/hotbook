# Regression test — local same-chart edit must trigger sort reorder.
#
#   uv run --with playwright python tests/e2e/sort-local-edit-reorder.py
#   BASE_URL=http://hotbook.localhost:1355 to target another hotbook host.
#
# Guards the bug where a bar/bands chart sorted by value would NOT reorder when
# an item's value was edited from WITHIN that same chart (wheel/drag), even though
# a cross-tile edit of the same datum did reorder. Root cause: after a gesture
# ends (gestureActive → false) nothing re-ran applyData, so the frozen display
# order was never reconciled against the already-correct sorted store state.
# Fix: bindTile listens for `gesturecommit` (detail.canceled) and re-applies data
# once, deferred, on a real commit — and skips the re-apply on Esc-cancel so it
# can't clobber the revert.
#
# Two assertions:
#   COMMIT: wheel a small bar UP → its datum moves toward the front AND the whole
#           display order stays value-sorted (descending).
#   CANCEL: Esc during the wheel gesture reverts the value with no net change and
#           leaves the order value-sorted (no clobber).

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook.localhost:1355")
URL = f"{BASE}/hotbook/"

failures: list[str] = []
errors: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


SNAP_JS = """() => {
  const el = document.querySelector('v-br-bar');
  if (!el || !el.dataCell) return null;
  const arr = el.dataCell.peek();
  return { order: arr.map(d => d.id ?? d.name),
           vals: Object.fromEntries(arr.map(d => [d.id ?? d.name, d.value])) };
}"""

SMALL_BAR_JS = """() => {
  const el = document.querySelector('v-br-bar');
  const root = el.shadowRoot || el;
  const vw = window.innerWidth, vh = window.innerHeight;
  let rects = [...root.querySelectorAll('rect')].map(r => ({ b: r.getBoundingClientRect() }))
    .filter(o => o.b.width>0 && o.b.height>0 && o.b.x>=0 && o.b.x<vw && o.b.y>=0 && o.b.y<vh);
  rects.sort((a,b)=> a.b.height - b.b.height);
  const t = rects[Math.min(2, rects.length-1)];
  return { cx: t.b.x + t.b.width/2, cy: t.b.y + t.b.height - 4 };
}"""


def is_desc_sorted(snap) -> bool:
    vals = [snap["vals"][i] for i in snap["order"]]
    return all(vals[i] >= vals[i + 1] - 1e-9 for i in range(len(vals) - 1))


def run(page, cancel: bool):
    s0 = page.evaluate(SNAP_JS)
    bar = page.evaluate(SMALL_BAR_JS)
    page.mouse.move(bar["cx"], bar["cy"])
    page.wait_for_timeout(150)
    page.keyboard.down("Control")
    for _ in range(45):
        page.mouse.wheel(0, -60)
        page.wait_for_timeout(12)
    if cancel:
        # Esc must land BEFORE releasing Ctrl — releasing Ctrl commits the wheel.
        page.wait_for_timeout(50)
        page.keyboard.press("Escape")
        page.wait_for_timeout(50)
    page.keyboard.up("Control")
    page.wait_for_timeout(900)  # debounce + gesturecommit + microtask reorder
    s1 = page.evaluate(SNAP_JS)
    changed = [k for k in s0["vals"] if abs(s0["vals"][k] - s1["vals"][k]) > 1e-6]
    return s0, s1, changed


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(1000)

    page.click("text=bar")
    page.wait_for_timeout(600)

    # Set the bar tile's Order dropdown to Value (3rd <select> in DOM order).
    selects = page.query_selector_all("select")
    selects[3].select_option("value")
    page.wait_for_timeout(600)

    check("v-br-bar mounted", page.query_selector("v-br-bar") is not None)

    # COMMIT
    s0, s1, changed = run(page, cancel=False)
    if not changed:
        check("commit: a datum changed value", False, "wheel hit no bar")
    else:
        cid = changed[0]
        oldpos, newpos = s0["order"].index(cid), s1["order"].index(cid)
        check(
            "commit: local edit reorders + stays sorted",
            newpos < oldpos and is_desc_sorted(s1),
            f"{cid} {s0['vals'][cid]}→{s1['vals'][cid]} pos {oldpos}→{newpos} sorted={is_desc_sorted(s1)}",
        )

    # CANCEL
    s0c, s1c, changedc = run(page, cancel=True)
    check(
        "esc-cancel: reverts value, no clobber, stays sorted",
        len(changedc) == 0 and is_desc_sorted(s1c),
        f"changed={changedc} sorted={is_desc_sorted(s1c)}",
    )

    check("no page errors", not errors, "; ".join(errors))
    browser.close()

if failures or errors:
    print(f"\nFAILURES: {failures}  ERRORS: {errors}")
    sys.exit(1)
print("\nALL SORT-REORDER CHECKS PASSED")
