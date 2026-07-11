"""
WIN-143 acceptance: measureKey swap must animate (structural lane), not snap.

After the fix, changing the measure dropdown on a hier chart (treemap, pack,
icicle, sunburst) must produce a transition — geometry differs between an early
and a late sample. Before the fix, the two-lane gate only tracked sortBy, so a
measureKey swap was classified as "not a reorder" → animate=false → snap.

Also verifies R2 is not regressed: cross-tile value edits still snap (immediate).

    uv run --with playwright python tests/e2e/win143-measurekey-transition.py
"""
import sys
from r2_harness import R2Harness


def _change_measure_dropdown(page, chart_short):
    """Find the measure <select> in the chart-under-test's tile header and pick
    a DIFFERENT option. Returns the new value, or None if no dropdown / no alt."""
    return page.evaluate("""(short) => {
      // The chart element lives in a dock panel. Find the panel that contains it,
      // then find its measure <select> (title-less, class tile-measure-select).
      // The measure select is the one WITHOUT a title attribute (depth/sort/orient
      // selects all have titles). If xKey/yKey selects exist, skip those too.
      const tag = 'v-br-' + short;
      const el = document.querySelector(tag);
      if (!el) return null;
      // Walk up to the dock panel container.
      let panel = el.closest('.dv-panel') || el.parentElement;
      while (panel && !panel.querySelector('.tile-measure-select')) {
        panel = panel.parentElement;
      }
      if (!panel) return null;
      const selects = [...panel.querySelectorAll('select.tile-measure-select')];
      // The measure select: no title, not inside an axis label group.
      // Filter to selects that have >1 option and no title.
      const measureSelects = selects.filter(s => !s.title && s.options.length > 1);
      if (!measureSelects.length) return null;
      const sel = measureSelects[0];
      const current = sel.value;
      // Pick the first option that differs from current.
      let newVal = null;
      for (const opt of sel.options) {
        if (opt.value !== current) { newVal = opt.value; break; }
      }
      if (!newVal) return null;
      sel.value = newVal;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { from: current, to: newVal };
    }""", chart_short)


with R2Harness() as h:
    for tag in ("v-br-treemap", "v-br-pack"):
        short = _short_tag = tag.replace("v-br-", "")

        # 1. R2 not regressed: value edit still immediate
        h.check_value_immediate(tag)

        # 2. R1 not regressed: sort reorder still animates
        h.check_structural_animates(tag)

        # 3. NEW: measureKey swap must animate (the WIN-143 fix)
        h._activate(f"{short}")
        h._wait_geo_stable(tag)
        result = _change_measure_dropdown(h.page, short)
        if not result:
            h._fail(f"{short}: no measure dropdown found to test measureKey swap")
            continue
        h.page.wait_for_timeout(16)
        early = h._geo(tag)
        h.page.wait_for_timeout(350)
        late = h._geo(tag)
        # Change the dropdown back so we don't contaminate other checks
        _change_measure_dropdown(h.page, short)
        h.page.wait_for_timeout(400)
        if early is None or late is None:
            h._fail(f"{short}: geometry unreadable after measureKey swap")
        elif early == late:
            h._fail(f"{short}: measureKey swap did NOT animate (snap — two-lane gate misses measureKey)")
        else:
            h._pass(f"{short}: measureKey swap animates (geometry moves over time)")

    h.report_and_exit()
