"""
R2 motion-policy e2e harness — the shared acceptance bar for the WIN-126 sweep.

Two assertions every chart in the sweep must pass:

  value_is_immediate(chart_tag, ...)
      A value edit driven from ANOTHER tile (real cross-tile path through the
      shared store — NOT a synthetic cell poke) must reach final geometry within
      ~1 frame. Samples the chart-under-test's mark geometry at t≈16ms and
      t≈300ms; PASS if they match (no ~250ms settle morph). This is R2.

  structural_animates(chart_tag, ...)
      A STRUCTURAL change (sort-by-value reorder) must animate: geometry differs
      between an early and a late sample. This guards against over-removal — the
      two-lane fix must keep the structural tween while killing the value settle.
      (R1; opt-in per chart since not every chart reorders.)

Dock constraint (discovered building this): only the ACTIVE tab in each dock is
mounted. treetable is a LEFT-dock tile, so it can only co-mount with RIGHT-dock
charts. For a LEFT-dock chart-under-test, a right-dock editable driver (scatter)
is used instead. pick_driver() encodes this.

Usage from a per-chart fixture:

    from r2_harness import R2Harness
    with R2Harness() as h:
        h.check_value_immediate("v-br-radar")
        # h.check_structural_animates("v-br-bar")  # only charts that reorder
    h.report_and_exit()

Run directly to self-test against radar (already R2-fixed, PR #63):
    uv run --with playwright python tests/e2e/r2_harness.py
"""

import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://sliceboard.localhost:1355")
URL = f"{BASE}/sliceboard/"

# Which dock each chart tab lives in (from the seed board layout). Used to pick a
# cross-dock editable driver so the driver + chart-under-test co-mount.
LEFT_DOCK = {"pack", "treemap", "treetable", "icicle", "sunburst", "bar", "bands"}
# everything else (line, area, scatter, pie, radar, concentric-arc, sankey,
# sankey-flow, tree, gantt) is RIGHT dock.


def _short(tag: str) -> str:
    return tag.replace("v-br-", "")


class R2Harness:
    def __init__(self):
        self.failures = []
        self.errors = []
        self._pw = None
        self.browser = None
        self.page = None

    def __enter__(self):
        self._pw = sync_playwright().start()
        self.browser = self._pw.chromium.launch(headless=True)
        self.page = self.browser.new_page(viewport={"width": 1600, "height": 950})
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.goto(URL, wait_until="networkidle")
        self.page.wait_for_timeout(1200)
        return self

    def __exit__(self, *a):
        if self.browser:
            self.browser.close()
        if self._pw:
            self._pw.stop()

    # ── tab / dock control ────────────────────────────────────────────────────
    def _activate(self, tab_label: str):
        # Match the tab by EXACT label and activate via pointerdown/up — NOT
        # page.click("text=..."). Two reasons the naive form failed:
        #   1. `text=` is a substring match, so "br-lc-tree" also matched
        #      "br-lc-treetable"/"br-lc-treemap" (a prefix collision) and clicked
        #      the wrong tab.
        #   2. Dock tabs activate on pointerdown→pointerup (a non-drag click path
        #      in DockView._startTabDrag), not on the DOM `click` event, so a plain
        #      click didn't switch the active panel for some tabs.
        ok = self.page.evaluate(
            """(label) => {
              const tabs = [...document.querySelectorAll('.dv-tab')];
              const tab = tabs.find(t => {
                const lbl = t.querySelector('.dv-tab-label');
                const txt = (lbl ? lbl.textContent : t.textContent) || '';
                return txt.trim() === label;
              });
              if (!tab) return false;
              tab.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0}));
              tab.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, button: 0}));
              return true;
            }""",
            tab_label,
        )
        self.page.wait_for_timeout(500)
        return ok

    def pick_driver(self, chart_short: str) -> str:
        """Return the tab label of a cross-dock editable tile to drive edits from.
        treetable (left) drives right-dock charts; scatter (right) drives left-dock."""
        if chart_short in LEFT_DOCK:
            return "br-lc-scatter"  # right-dock editable driver
        return "br-lc-treetable"    # left-dock canonical editor

    # ── geometry sampling ─────────────────────────────────────────────────────
    _GEO_JS = """(tag) => {
      const el = document.querySelector(tag);
      if (!el) return null;
      const root = el.shadowRoot || el;
      // A stable geometry signature: concat of all path 'd' + rect/circle dims.
      const parts = [];
      // Full-precision 'd' — do NOT truncate; a short settle can move geometry by
      // sub-pixel amounts that a truncated signature would hide.
      root.querySelectorAll('path').forEach(p => parts.push('P'+(p.getAttribute('d')||'')));
      root.querySelectorAll('rect').forEach(r => parts.push('R'+(r.getAttribute('y')||'')+','+(r.getAttribute('height')||'')+','+(r.getAttribute('width')||'')+','+(r.getAttribute('x')||'')));
      root.querySelectorAll('circle').forEach(c => parts.push('C'+(c.getAttribute('cx')||'')+','+(c.getAttribute('cy')||'')+','+(c.getAttribute('r')||'')));
      return parts.join('|');
    }"""

    def _geo(self, tag: str):
        return self.page.evaluate(self._GEO_JS, tag)

    def _wait_geo_stable(self, tag: str, quiet_ms: int = 100, timeout_ms: int = 2000):
        """Block until the chart's geometry stops changing (two consecutive equal
        samples `quiet_ms` apart), or `timeout_ms` elapses. Used to wait out a
        mount/enter tween before baselining a value-immediate check."""
        prev = self._geo(tag)
        waited = 0
        while waited < timeout_ms:
            self.page.wait_for_timeout(quiet_ms)
            waited += quiet_ms
            cur = self._geo(tag)
            if cur is not None and cur == prev:
                return
            prev = cur

    # ── cross-tile edit driver ────────────────────────────────────────────────
    def _drive_treetable_edit(self, target_id=None):
        """Drag a visible editable value cell in the treetable to change a shared
        leaf's value. If target_id is given, edit that node's row (so the edit
        lands on a leaf the chart-under-test actually displays). Returns True if
        an edit was driven."""
        cell = self.page.evaluate("""(targetId) => {
          const tt = document.querySelector('v-br-treetable');
          if (!tt) return null;
          const root = tt.shadowRoot || tt;
          let cs = [...root.querySelectorAll('[data-editable-value]')]
            .map(c => ({c, key: c.getAttribute('data-editable-value'), r: c.getBoundingClientRect()}))
            .filter(o => o.r.width>0 && o.r.y>60 && o.r.y<900);
          if (targetId) {
            const match = cs.filter(o => o.key.split(':')[0] === targetId);
            if (match.length) cs = match;
          }
          if (!cs.length) return null;
          const o = cs[0];
          return {x: o.r.x + o.r.width/2, y: o.r.y + o.r.height/2, key: o.key};
        }""", target_id)
        if not cell:
            return False
        # numberDrag is a HORIZONTAL scrubber (right = +, pxPerUnit≈4). Drag right
        # ~120px to raise the value by ~30 units. Uses pointer events via the shared
        # dragController — Playwright mouse synthesizes matching pointer events.
        self.page.mouse.move(cell["x"], cell["y"])
        self.page.mouse.down()
        for dx in range(0, 120, 10):
            self.page.mouse.move(cell["x"] + dx, cell["y"])
            self.page.wait_for_timeout(8)
        self.page.mouse.up()
        return True

    def _drive_scatter_edit(self):
        """Drag a scatter point up to change its y-value (cross-tile driver for
        left-dock charts-under-test)."""
        pt = self.page.evaluate("""() => {
          const el = document.querySelector('v-br-scatter');
          if (!el) return null;
          const root = el.shadowRoot || el;
          const cs = [...root.querySelectorAll('circle')]
            .map(c => ({c, r: c.getBoundingClientRect()}))
            .filter(o => o.r.width>0 && o.r.y>60 && o.r.y<900);
          if (!cs.length) return null;
          const o = cs[Math.min(5, cs.length-1)];
          return {x: o.r.x + o.r.width/2, y: o.r.y + o.r.height/2};
        }""")
        if not pt:
            return False
        self.page.mouse.move(pt["x"], pt["y"])
        self.page.mouse.down()
        for dy in range(0, 80, 8):
            self.page.mouse.move(pt["x"], pt["y"] - dy)
            self.page.wait_for_timeout(8)
        self.page.mouse.up()
        return True

    def _drive_edit(self, driver_label: str, target_id=None):
        if "treetable" in driver_label:
            return self._drive_treetable_edit(target_id)
        return self._drive_scatter_edit()

    def _displayed_leaf_id(self, tag: str):
        """A leaf id the chart-under-test actually renders (so a cross-tile edit to
        it is observable). Reads the element's data cell; returns None if absent."""
        return self.page.evaluate("""(tag) => {
          const el = document.querySelector(tag);
          const dc = el && (el.dataCell || el.__data);
          const arr = dc && (dc.peek ? dc.peek() : dc.value);
          if (!arr || !arr.length) return null;
          const d = arr[Math.min(2, arr.length-1)];
          return d.id ?? d.name ?? null;
        }""", tag)

    # ── assertions ────────────────────────────────────────────────────────────
    def check_value_immediate(self, tag: str):
        short = _short(tag)
        driver = self.pick_driver(short)
        # Mount driver + chart-under-test in their respective docks.
        self._activate(driver)
        self._activate(f"br-lc-{short}")
        # Re-activate driver's dock partner is automatic (different dock). Confirm both mounted.
        both = self.page.evaluate(
            "(a,b)=>({a: !!document.querySelector(a), b: !!document.querySelector(b)})",
            tag,
        )
        if not both["a"]:
            self._fail(f"{short}: chart-under-test not mounted (dock issue)")
            return
        # Wait out any MOUNT/ENTER animation before baselining. Re-activating a
        # tab remounts the chart, and hier charts (treemap/pack) tween their tiles
        # into place on enter — sampling during that settle would misread it as
        # value settle-lag (false FAIL). Poll until geometry is stable across two
        # consecutive frames (or give up after ~2s).
        self._wait_geo_stable(tag)
        target_id = self._displayed_leaf_id(tag)
        base = self._geo(tag)
        if not self._drive_edit(driver, target_id):
            self._fail(f"{short}: could not drive a cross-tile edit via {driver}")
            return
        # Sample a dense early window + a settled sample. A value change is IMMEDIATE
        # iff the geometry at the FIRST frame after the edit already equals the final
        # geometry — i.e. it never passed through intermediate positions. Any CSS/tween
        # settle (even a short 100ms one) leaves the first frame between base and final.
        # Sampling only at 16ms vs 336ms misses fast settles: dense-sample instead.
        early = []
        for _ in range(6):                       # ~6 frames, ~0–90ms
            self.page.wait_for_timeout(15)
            early.append(self._geo(tag))
        self.page.wait_for_timeout(320)
        final = self._geo(tag)
        if any(g is None for g in early) or final is None:
            self._fail(f"{short}: geometry unreadable")
            return
        if final == base:
            self._fail(f"{short}: cross-tile edit produced NO change — driver/edit didn't propagate")
            return
        # Immediate ⇔ every early frame already equals final (no intermediate positions).
        drifting = [i for i, g in enumerate(early) if g != final]
        if not drifting:
            self._pass(f"{short}: cross-tile value edit is immediate (all early frames == final)")
        else:
            self._fail(
                f"{short}: value settle-lag — {len(drifting)}/{len(early)} early frames "
                f"differ from final (R2 violation; first divergent frame #{drifting[0]})"
            )

    def check_structural_animates(self, tag: str, sort_select_label="br-lc-"):
        """Trigger a sort-by-value reorder on the chart-under-test and assert its
        geometry animates (early != late).

        Flips the chart element's own `sortBy` PROPERTY rather than hunting a
        `<select>` on the page: the Order dropdown lives in a separate grid
        header (not nested with the chart element), so `querySelectorAll('select')
        [0]` grabbed the WRONG tile's dropdown when multiple tiles were mounted —
        a false FAIL. The property drives the same code path deterministically.
        Resets sortBy back to 'index' afterward so this check can't contaminate a
        following value-immediate check on the same page session."""
        short = _short(tag)
        self._activate(f"br-lc-{short}")
        prev = self.page.evaluate(
            """(tag) => { const el = document.querySelector(tag);
                 if (!el || !('sortBy' in el)) return null;
                 const prev = el.sortBy; el.sortBy = 'value'; return prev; }""",
            tag,
        )
        if prev is None:
            self._fail(f"{short}: chart element has no sortBy property to trigger reorder")
            return
        self.page.wait_for_timeout(16)
        early = self._geo(tag)
        self.page.wait_for_timeout(300)
        late = self._geo(tag)
        # Restore so a later value-immediate check runs from a clean, unsorted state.
        self.page.evaluate(
            "(a) => { const el = document.querySelector(a.tag); if (el) el.sortBy = a.prev; }",
            {"tag": tag, "prev": prev},
        )
        self.page.wait_for_timeout(350)
        if early != late:
            self._pass(f"{short}: structural reorder animates (geometry moves over time)")
        else:
            self._fail(f"{short}: reorder did NOT animate (structural lane broken by over-removal?)")

    # ── reporting ─────────────────────────────────────────────────────────────
    def _pass(self, msg):
        print(f"PASS  {msg}")

    def _fail(self, msg):
        print(f"FAIL  {msg}")
        self.failures.append(msg)

    def report_and_exit(self):
        if self.errors:
            print(f"\nPAGE ERRORS: {self.errors}")
        if self.failures or self.errors:
            print(f"\n{len(self.failures)} failure(s), {len(self.errors)} page error(s)")
            sys.exit(1)
        print("\nALL R2 HARNESS CHECKS PASSED")


if __name__ == "__main__":
    # Self-test that the harness has TEETH by proving it distinguishes the TWO
    # LANES on the same chart — the whole point of the R2 sweep:
    #   value_immediate  → a cross-tile value edit SNAPS (write-through, R2)
    #   structural_animates → a sort reorder still TWEENS (R1)
    # A harness that couldn't tell these apart would pass or fail both together.
    # treemap (WIN-127) is the reference chart: post-fix it must pass BOTH.
    # (Historically this self-test asserted treemap FAILED value_immediate — a
    # genuine JS-tween lag on x/y/w/h — but WIN-127 fixed it, so the teeth are now
    # demonstrated via the two-lane distinction rather than a known violator.)
    print("— self-test: treemap must SNAP on value edit AND ANIMATE on sort (two lanes) —")
    with R2Harness() as h:
        h.check_value_immediate("v-br-treemap")
        value_immediate_ok = not h.failures
        h.check_structural_animates("v-br-treemap")
        structural_animates_ok = not h.failures
    ok = value_immediate_ok and structural_animates_ok and not h.errors
    print(
        f"\nself-test: value_immediate={value_immediate_ok}  "
        f"structural_animates={structural_animates_ok}  page_errors={len(h.errors)}"
    )
    print("HARNESS HAS TEETH ✓" if ok else "HARNESS SELF-TEST FAILED ✗")
    sys.exit(0 if ok else 1)
