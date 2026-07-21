"""
WIN-139: sankey group grip tracks the node bar after a drag.

The bug: frozenGripPos was a plain JS var, so clearing it in onEnd didn't
trigger gripVis to re-derive. The grip stayed stuck at the pre-drag position
while the bar moved to its new size — "handle in whitespace."

The fix: make frozenGripPos a cell so clearing it triggers re-derive.

This test:
  1. Renders the sankey in fiddleviz
  2. Finds a group grip (rect 14x4, fill #0b0d12) and its matching node bar
  3. Asserts the grip is anchored at the bar's bottom edge BEFORE drag
  4. Drags the grip down ~40px (growing the node)
  5. Asserts the grip is STILL anchored at the bar's NEW bottom edge AFTER drag
  6. Screenshots before + after for visual evidence

    uv run --with playwright python tests/e2e/win139_sankey_grip_tracking.py
"""
import os
import sys
import math
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://fiddleviz.localhost:1355")
URL = f"{BASE}/fiddleviz/"
TOL = 2.0  # px tolerance for position matching in SVG coords


def main():
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 950})
        page.on("pageerror", lambda e: failures.append(f"pageerror: {e}"))

        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(1500)

        # Activate the sankey tab via pointerdown/up (same as R2 harness)
        ok = page.evaluate("""(label) => {
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
        }""", "sankey")
        if not ok:
            failures.append("could not activate sankey tab")
            report(failures)
            return
        page.wait_for_timeout(1000)

        # Wait for geometry to stabilize
        for _ in range(10):
            g1 = sankey_geo(page)
            page.wait_for_timeout(100)
            g2 = sankey_geo(page)
            if g1 == g2:
                break

        # ── Step 1: Find group grips and their matching bars ────────────────
        # Group grips: rects with width=14, height=4, fill=#0b0d12
        # Node bars: rects with colored fill (not #0b0d12, not none), larger dims
        grips_bars = page.evaluate("""(tag) => {
            const el = document.querySelector(tag);
            if (!el) return null;
            const root = el.shadowRoot || el;
            const rects = [...root.querySelectorAll('rect')];
            const grips = [];
            const bars = [];
            for (const r of rects) {
                const w = parseFloat(r.getAttribute('width') || '0');
                const h = parseFloat(r.getAttribute('height') || '0');
                const fill = r.getAttribute('fill') || '';
                const x = parseFloat(r.getAttribute('x') || '0');
                const y = parseFloat(r.getAttribute('y') || '0');
                if (Math.abs(w - 14) < 1 && Math.abs(h - 4) < 1 && fill === '#0b0d12') {
                    const br = r.getBoundingClientRect();
                    grips.push({x, y, w, h, sx: br.x + br.width/2, sy: br.y + br.height/2, el: null});
                } else if (fill !== '#0b0d12' && fill !== 'none' && fill !== '' && w > 4 && h > 4) {
                    bars.push({x, y, w, h, bottom: y + h, cx: x + w/2});
                }
            }
            // Match each grip to its bar: grip center x ≈ bar center x, grip y+2 ≈ bar bottom
            const pairs = [];
            for (const g of grips) {
                let best = null, bestDist = Infinity;
                for (const b of bars) {
                    const dx = Math.abs((g.x + g.w/2) - b.cx);
                    const dy = Math.abs((g.y + g.h) - b.bottom);  // grip bottom ≈ bar bottom
                    const dist = dx + dy;
                    if (dist < bestDist) { bestDist = dist; best = b; }
                }
                if (best && bestDist < 20) {
                    pairs.push({grip: g, bar: best, dist: bestDist});
                }
            }
            // Return serializable (drop el refs)
            return pairs.map(p => ({
                grip: {x: p.grip.x, y: p.grip.y, w: p.grip.w, h: p.grip.h, sx: p.grip.sx, sy: p.grip.sy},
                bar: {x: p.bar.x, y: p.bar.y, w: p.bar.w, h: p.bar.h, bottom: p.bar.bottom, cx: p.bar.cx},
                dist: p.dist
            }));
        }""", "v-br-sankey")

        if not grips_bars:
            failures.append("no group grip / bar pairs found in sankey")
            report(failures)
            return

        print(f"Found {len(grips_bars)} grip/bar pairs")
        pair = grips_bars[0]
        grip = pair["grip"]
        bar = pair["bar"]

        # ── Step 2: Assert grip anchored to bar bottom BEFORE drag ───────────
        grip_bottom = grip["y"] + grip["h"]
        bar_bottom = bar["bottom"]
        delta_before = abs(grip_bottom - bar_bottom)
        print(f"BEFORE: grip_bottom={grip_bottom:.2f}  bar_bottom={bar_bottom:.2f}  delta={delta_before:.2f}")
        if delta_before > TOL:
            failures.append(f"BEFORE drag: grip not at bar bottom (delta={delta_before:.2f}px > {TOL})")
        else:
            print(f"PASS  BEFORE: grip anchored to bar bottom (delta={delta_before:.2f}px)")

        # Screenshot before
        page.screenshot(path="tests/e2e/win139_before_drag.png")

        # ── Step 3: Drag the grip down to grow the node ──────────────────────
        # Move to grip position first (triggers pointerenter → nodeActive → visible)
        sx, sy = grip["sx"], grip["sy"]
        print(f"Dragging grip at screen ({sx:.0f}, {sy:.0f}) down 40px")
        page.mouse.move(sx, sy)
        page.wait_for_timeout(200)  # let pointerenter fire
        page.mouse.down()
        for dy in range(0, 40, 5):
            page.mouse.move(sx, sy + dy)
            page.wait_for_timeout(10)
        page.wait_for_timeout(100)
        page.mouse.up()
        page.wait_for_timeout(500)  # let layout settle

        # ── Step 4: Re-read positions AFTER drag ─────────────────────────────
        after = page.evaluate("""(tag) => {
            const el = document.querySelector(tag);
            if (!el) return null;
            const root = el.shadowRoot || el;
            const rects = [...root.querySelectorAll('rect')];
            const grips = [];
            const bars = [];
            for (const r of rects) {
                const w = parseFloat(r.getAttribute('width') || '0');
                const h = parseFloat(r.getAttribute('height') || '0');
                const fill = r.getAttribute('fill') || '';
                const x = parseFloat(r.getAttribute('x') || '0');
                const y = parseFloat(r.getAttribute('y') || '0');
                if (Math.abs(w - 14) < 1 && Math.abs(h - 4) < 1 && fill === '#0b0d12') {
                    grips.push({x, y, w, h});
                } else if (fill !== '#0b0d12' && fill !== 'none' && fill !== '' && w > 4 && h > 4) {
                    bars.push({x, y, w, h, bottom: y + h, cx: x + w/2});
                }
            }
            return {grips, bars};
        }""", "v-br-sankey")

        if not after or not after["grips"] or not after["bars"]:
            failures.append("AFTER drag: could not read grips/bars")
            report(failures)
            return

        # Find the grip that's closest to where we dragged (same x center)
        target_cx = grip["x"] + grip["w"] / 2
        after_grip = min(after["grips"], key=lambda g: abs(g["x"] + g["w"]/2 - target_cx))
        # Find the matching bar (closest bottom to grip bottom)
        after_grip_bottom = after_grip["y"] + after_grip["h"]
        after_bar = min(after["bars"], key=lambda b: abs(b["bottom"] - after_grip_bottom))
        after_bar_bottom = after_bar["bottom"]

        delta_after = abs(after_grip_bottom - after_bar_bottom)
        print(f"AFTER:  grip_bottom={after_grip_bottom:.2f}  bar_bottom={after_bar_bottom:.2f}  delta={delta_after:.2f}")

        # Screenshot after
        page.screenshot(path="tests/e2e/win139_after_drag.png")

        # ── Step 5: Assert grip STILL anchored to bar bottom AFTER drag ───────
        if delta_after > TOL:
            failures.append(
                f"AFTER drag: grip NOT at bar bottom (delta={delta_after:.2f}px > {TOL}) — "
                f"the handle drifted! frozenGripPos reactivity bug."
            )
        else:
            print(f"PASS  AFTER: grip still anchored to bar bottom (delta={delta_after:.2f}px)")

        # ── Step 6: Assert the bar actually changed size (drag had effect) ───
        bar_changed = abs(after_bar["h"] - bar["h"]) > 1.0
        if not bar_changed:
            failures.append(f"drag had no effect: bar height {bar['h']:.2f} → {after_bar['h']:.2f} (no change)")
        else:
            print(f"PASS  drag had effect: bar height {bar['h']:.2f} → {after_bar['h']:.2f}")

        browser.close()

    report(failures)


def sankey_geo(page):
    return page.evaluate("""(tag) => {
        const el = document.querySelector(tag);
        if (!el) return null;
        const root = el.shadowRoot || el;
        const parts = [];
        root.querySelectorAll('rect').forEach(r => parts.push('R'+(r.getAttribute('x')||'')+','+(r.getAttribute('y')||'')+','+(r.getAttribute('width')||'')+','+(r.getAttribute('height')||'')));
        return parts.join('|');
    }""", "v-br-sankey")


def report(failures):
    if failures:
        print(f"\n{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"  FAIL  {f}")
        sys.exit(1)
    print("\nALL GRIP TRACKING CHECKS PASSED")
    print("Screenshots: tests/e2e/win139_before_drag.png, tests/e2e/win139_after_drag.png")


if __name__ == "__main__":
    main()
