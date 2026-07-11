"""
R2 motion-policy e2e harness — the shared acceptance bar for the WIN-126 sweep.

Two assertions every chart in the sweep must pass:

  check_value_immediate(chart_tag, ...)
      A value edit committed through the SAME store path a UI numberDrag would
      hit (window.__hotbook.setCell → commit(updateRow(...))) must reach final
      geometry within ~1 frame on the chart-under-test. Dense-samples early
      frames + a settled sample; PASS if every early frame already equals the
      final (no ~250ms settle morph). This is R2.

  check_structural_animates(chart_tag, ...)
      A STRUCTURAL change (sort-by-value reorder) must animate: geometry differs
      between an early and a late sample. Guards against over-removal — the
      two-lane fix must keep the structural tween while killing the value settle.
      (R1; opt-in per chart since not every chart reorders.)

Value-edit driver: `window.__hotbook.setCell(dsId, rowId, measureKey, v)` is
registered by apps/hotbook/src/main.ts (DEV builds only) and takes the exact
same code path as a treetable numberDrag commit — `commit(updateRow(ws, ...))`.
This retires the earlier driver-tile approach (numberDrag scrubber on a
co-mounted treetable/scatter), which was blocked by:
  * dock split — treetable+chart-under-test needed to share a dock, forcing
    per-chart driver selection (pick_driver);
  * measure mismatch — gantt reads start/end, but the driver only wrote est/act;
  * pointer flakiness — synthetic PointerEvent timing failed intermittently.
The hook removes all three by talking to the workspace directly. Nothing about
the reactive/render path being tested changes — only the pointer choreography
does.

Usage from a per-chart fixture:

    from r2_harness import R2Harness
    with R2Harness() as h:
        h.check_value_immediate("v-br-radar")
        # h.check_structural_animates("v-br-bar")  # only charts that reorder
    h.report_and_exit()

Run directly to self-test against treemap (WIN-127 fix landed):
    uv run --with playwright python tests/e2e/r2_harness.py

Env: BASE_URL (default http://hotbook.localhost:1355). Point at a Netlify
deploy preview to verify a PR without a local dev server.
"""

import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook.localhost:1355")
URL = f"{BASE}/hotbook/"

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
        #   1. `text=` is a substring match, so "tree" also matched
        #      "treetable"/"treemap" (a prefix collision) and clicked
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

    def _require_hook(self):
        """Fail loudly if the DEV-only __hotbook hook is missing (production build
        or old commit). Every value_immediate check depends on it."""
        ok = self.page.evaluate(
            "() => typeof window.__hotbook === 'object' && typeof window.__hotbook.setCell === 'function'"
        )
        if not ok:
            raise RuntimeError(
                "window.__hotbook.setCell is not available — is this a DEV build of hotbook? "
                "The hook is registered in apps/hotbook/src/main.ts under `if (import.meta.env.DEV)`."
            )

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

    # ── hook-driven edit ──────────────────────────────────────────────────────
    def _displayed_leaf_id(self, tag: str):
        """A leaf id the chart-under-test actually renders — so the edit lands on a
        row this chart is subscribed to and the geometry change is observable."""
        return self.page.evaluate("""(tag) => {
          const el = document.querySelector(tag);
          const dc = el && (el.dataCell || el.__data);
          const arr = dc && (dc.peek ? dc.peek() : dc.value);
          if (!arr || !arr.length) return null;
          const d = arr[Math.min(2, arr.length-1)];
          return d.id ?? d.name ?? null;
        }""", tag)

    def _chart_measure_key(self, tag: str):
        """The chart's currently-rendered measure key (each chart exposes this as
        a property on the custom element)."""
        return self.page.evaluate(
            "(tag) => { const el = document.querySelector(tag); return el ? (el.measureKey ?? null) : null; }",
            tag,
        )

    def _drive_edit(self, tag: str):
        """Commit a value edit via the DEV hook — same code path a UI numberDrag
        takes (commit → updateRow → render). Returns True on success, False if
        the chart-under-test's row/measure can't be identified.

        Row picking order (first that works):
          1. el.dataCell / el.__data — bireactive charts expose their data cell.
          2. DOM data-id — the chart element has [data-id] marks (treemap, pack,
             sunburst, icicle, hier charts).
          3. window.__hotbook.rowIds(dsId) — first row of the active dataset;
             works for any chart that renders every dataset row.
        Measure key picking order:
          1. el.measureKey property (all hotbook charts expose this).
          2. window.__hotbook.measureKeys(dsId)[0] — first numeric measure.
        """
        info = self.page.evaluate(
            """(tag) => {
              const el = document.querySelector(tag);
              if (!el) return {ok:false, reason:'no element'};
              const dsId = window.__hotbook.activeDatasetId();
              if (!dsId) return {ok:false, reason:'no active dataset'};
              const measureKey = el.measureKey || window.__hotbook.measureKeys(dsId)[0];
              if (!measureKey) return {ok:false, reason:'no measureKey'};
              const allIds = window.__hotbook.rowIds(dsId);
              // Row candidates, most-preferred first:
              //   1. Rows the chart renders via DOM [data-id] marks.
              //   2. Rows the chart's data cell / __data exposes.
              //   3. Every dataset row.
              // Then filter to ones that already have the target measure (i.e.
              // are LEAVES the chart layouts against, not group aggregates that
              // ignore direct writes) — writing to a group row that recomputes
              // its measure from children produces no geometry change.
              const seen = new Set();
              const candidates = [];
              const add = (id) => { if (id && !seen.has(id) && allIds.includes(id)) { seen.add(id); candidates.push(id); } };
              const root = el.shadowRoot || el;
              root.querySelectorAll('[data-id]').forEach(m => add(m.getAttribute('data-id')));
              const dc = el.dataCell || el.__data;
              const arr = dc && (dc.peek ? dc.peek() : dc.value);
              if (arr) for (const d of arr) add(d.id ?? d.name);
              allIds.forEach(add);
              let rowId = null;
              let cur = 0;
              for (const cand of candidates) {
                const v = window.__hotbook.getCell(dsId, cand, measureKey);
                if (typeof v === 'number' && v !== 0) { rowId = cand; cur = v; break; }
              }
              if (!rowId && candidates.length) rowId = candidates[0];
              if (!rowId) return {ok:false, reason:'no candidate rows in dataset'};
              const next = cur + Math.max(30, Math.abs(cur) * 0.5 || 30);
              window.__hotbook.setCell(dsId, rowId, measureKey, next);
              return {ok:true, rowId, measureKey, from: cur, to: next, candidateCount: candidates.length};
            }""",
            tag,
        )
        return bool(info and info.get("ok"))

    # ── assertions ────────────────────────────────────────────────────────────
    def check_value_immediate(self, tag: str):
        short = _short(tag)
        self._require_hook()
        # Mount the chart-under-test. No driver tile needed — the hook writes
        # directly to the workspace, so dock layout doesn't matter.
        self._activate(f"{short}")
        if not self.page.evaluate("(t) => !!document.querySelector(t)", tag):
            self._fail(f"{short}: chart-under-test not mounted (tab not found?)")
            return
        # Wait out any MOUNT/ENTER animation before baselining. Re-activating a
        # tab remounts the chart, and hier charts (treemap/pack) tween their tiles
        # into place on enter — sampling during that settle would misread it as
        # value settle-lag (false FAIL). Poll until geometry is stable across two
        # consecutive frames (or give up after ~2s).
        self._wait_geo_stable(tag)
        base = self._geo(tag)
        if not self._drive_edit(tag):
            self._fail(f"{short}: could not commit a hook-driven edit (missing rowId / measureKey / dataset)")
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

    def check_structural_animates(self, tag: str, sort_select_label=""):
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
        self._activate(f"{short}")
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
