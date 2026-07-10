"""
WIN-139: Real conservation check — sum(in) == sum(out) at every interior node.

Reads link values directly from the sankey component's reactive cells by
evaluating the SVG geometry: each ribbon's width = value * pxPerUnit. By
measuring ribbon widths at each node's faces, we can verify conservation.

Actually simpler: we inject a debug hook that exposes the link values.
But the component doesn't expose them. So we measure ribbon widths from
the SVG paths' bounding boxes at each node face.

Simplest approach: read the bar heights and ribbon widths from the SVG
and check that at each node, the sum of incoming ribbon widths equals
the sum of outgoing ribbon widths (within tolerance).

    uv run --with playwright python tests/e2e/win139_conservation_real.py
"""
import os, sys, math
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook.localhost:1355")
URL = f"{BASE}/sliceboard/"
TOL = 0.5  # px tolerance for conservation check


def main():
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 950})
        page.on("pageerror", lambda e: failures.append(f"pageerror: {e}"))

        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(1500)

        # Activate sankey tab
        ok = page.evaluate("""(label) => {
            const tabs = [...document.querySelectorAll('.dv-tab')];
            const tab = tabs.find(t => {
                const lbl = t.querySelector('.dv-tab-label');
                return ((lbl ? lbl.textContent : t.textContent) || '').trim() === label;
            });
            if (!tab) return false;
            tab.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0}));
            tab.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, button: 0}));
            return true;
        }""", "br-lc-sankey")
        if not ok:
            failures.append("could not activate br-lc-sankey tab")
            return report(failures)
        page.wait_for_timeout(2000)

        # ── Read conservation BEFORE drag ─────────────────────────────────────
        cons = read_conservation(page)
        if cons is None:
            failures.append("could not read conservation data")
            return report(failures)

        print(f"BEFORE drag: {cons['node_count']} nodes, {cons['link_count']} links")
        for v in cons["violations"]:
            failures.append(f"BEFORE: {v}")
        if not cons["violations"]:
            print(f"PASS  conservation before drag (all {cons['interior_count']} interior nodes balanced)")

        # ── Drag a group grip ─────────────────────────────────────────────────
        # Find a group grip (rect 14x4, fill #0b0d12) and drag it
        grip_screen = page.evaluate("""() => {
            const el = document.querySelector('v-br-sankey');
            const root = el.shadowRoot || el;
            const rects = [...root.querySelectorAll('rect')];
            for (const r of rects) {
                const w = parseFloat(r.getAttribute('width') || '0');
                const h = parseFloat(r.getAttribute('height') || '0');
                const fill = r.getAttribute('fill') || '';
                if (Math.abs(w - 14) < 1 && Math.abs(h - 4) < 1 && fill === '#0b0d12') {
                    const br = r.getBoundingClientRect();
                    return {sx: br.x + br.width/2, sy: br.y + br.height/2};
                }
            }
            return null;
        }""")
        if not grip_screen:
            failures.append("no group grip found to drag")
            return report(failures)

        sx, sy = grip_screen["sx"], grip_screen["sy"]
        print(f"\nDragging group grip at ({sx:.0f}, {sy:.0f}) down 40px")
        page.mouse.move(sx, sy)
        page.wait_for_timeout(300)
        page.mouse.down()
        for dy in range(0, 40, 5):
            page.mouse.move(sx, sy + dy)
            page.wait_for_timeout(15)
        page.wait_for_timeout(100)
        page.mouse.up()
        page.wait_for_timeout(800)

        # ── Read conservation AFTER drag ──────────────────────────────────────
        cons_after = read_conservation(page)
        if cons_after is None:
            failures.append("could not read conservation data after drag")
            return report(failures)

        print(f"AFTER drag: {cons_after['node_count']} nodes, {cons_after['link_count']} links")
        for v in cons_after["violations"]:
            failures.append(f"AFTER: {v}")
        if not cons_after["violations"]:
            print(f"PASS  conservation after drag (all {cons_after['interior_count']} interior nodes balanced)")

        # ── Also verify values actually changed ───────────────────────────────
        changed = False
        for i in range(min(len(cons["link_widths"]), len(cons_after["link_widths"]))):
            if abs(cons["link_widths"][i] - cons_after["link_widths"][i]) > 0.5:
                changed = True
                break
        if not changed:
            failures.append("drag had no effect on link widths")
        else:
            print(f"PASS  drag changed link widths")

        page.screenshot(path="tests/e2e/win139_conservation_after.png")
        browser.close()

    report(failures)


def read_conservation(page):
    """Read ribbon widths and check in=out at every interior node."""
    return page.evaluate("""() => {
        const el = document.querySelector('v-br-sankey');
        if (!el) return null;
        const root = el.shadowRoot || el;
        const svg = root.querySelector('svg');
        if (!svg) return null;

        // Node bars: rects with colored fill (not #0b0d12), w > 4, h > 4
        const rects = [...root.querySelectorAll('rect')];
        const bars = rects
            .filter(r => {
                const fill = r.getAttribute('fill') || '';
                const w = parseFloat(r.getAttribute('width') || '0');
                const h = parseFloat(r.getAttribute('height') || '0');
                return fill !== '#0b0d12' && fill !== 'none' && fill !== '' && w > 4 && h > 4;
            })
            .map(r => ({
                x0: parseFloat(r.getAttribute('x') || '0'),
                y0: parseFloat(r.getAttribute('y') || '0'),
                x1: parseFloat(r.getAttribute('x') || '0') + parseFloat(r.getAttribute('width') || '0'),
                y1: parseFloat(r.getAttribute('y') || '0') + parseFloat(r.getAttribute('height') || '0'),
            }));

        // Ribbons: paths with fill that's not var(--text-color) and not none
        const paths = [...root.querySelectorAll('path')];
        const ribbons = [];
        for (const p of paths) {
            const fill = p.getAttribute('fill') || '';
            if (fill === 'var(--text-color)' || fill === 'none' || fill === '') continue;
            const d = p.getAttribute('d') || '';
            if (!d.startsWith('M ')) continue;
            // Get bounding box in SVG coords
            const bbox = p.getBBox();
            ribbons.push({x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height, d: d.slice(0, 30)});
        }

        // For conservation, we need to know which ribbons connect to which nodes.
        // We can infer this from the ribbon path's start/end x coordinates.
        // A ribbon starts at a source node's right face (x1) and ends at a
        // target node's left face (x0).
        //
        // Parse the first M x y from each ribbon path to get the start point,
        // and the last x y before Z to get the end point.
        const ribbonEnds = [];
        for (const p of paths) {
            const fill = p.getAttribute('fill') || '';
            if (fill === 'var(--text-color)' || fill === 'none' || fill === '') continue;
            const d = p.getAttribute('d') || '';
            if (!d.startsWith('M ')) continue;
            // Parse M x y ... and find the last L x y before Z
            const match = d.match(/^M\\s+([\\d.]+)\\s+([\\d.-]+)/);
            if (!match) continue;
            const startX = parseFloat(match[1]);
            const startY = parseFloat(match[2]);
            // The ribbon path format is:
            //   M sx (sy-h) C ... tx (ty-h) L tx (ty+h) C ... sx (sy+h) Z
            // Target x appears after L
            const lMatch = d.match(/L\\s+([\\d.]+)\\s+([\\d.-]+)/);
            if (!lMatch) continue;
            const endX = parseFloat(lMatch[1]);
            const endY = parseFloat(lMatch[2]);
            // Ribbon width = 2*h where h = width/2. The path starts at (sy-h) and
            // ends at (sy+h) before Z. So width = last_y - first_y.
            const zMatch = d.match(/([\\d.]+)\\s+([\\d.-]+)\\s+Z$/);
            if (!zMatch) continue;
            const lastY = parseFloat(zMatch[2]);
            const width = Math.abs(lastY - startY);
            // Center y at source face = startY + width/2
            // Center y at target face = endY - width/2 (endY is bottom of target face)
            const srcCenterY = startY + width / 2;
            const tgtCenterY = endY - width / 2;
            ribbonEnds.push({
                startX, startY: srcCenterY, endX, endY: tgtCenterY,
                width,
                d: d.slice(0, 20)
            });
        }

        // Match ribbons to nodes: a ribbon's start x ≈ source node's x1 AND
        // start y is within the source node's y range. Same for end/target.
        const TOL = 3;
        for (const r of ribbonEnds) {
            r.srcNode = -1;
            r.tgtNode = -1;
            for (let i = 0; i < bars.length; i++) {
                // Source: start x ≈ bar x1, start y within bar y range
                if (Math.abs(r.startX - bars[i].x1) < TOL &&
                    r.startY >= bars[i].y0 - TOL && r.startY <= bars[i].y1 + TOL) {
                    r.srcNode = i;
                }
                // Target: end x ≈ bar x0, end y within bar y range
                if (Math.abs(r.endX - bars[i].x0) < TOL &&
                    r.endY >= bars[i].y0 - TOL && r.endY <= bars[i].y1 + TOL) {
                    r.tgtNode = i;
                }
            }
        }

        // For each node, sum incoming and outgoing ribbon widths
        const violations = [];
        let interiorCount = 0;
        for (let i = 0; i < bars.length; i++) {
            const inLinks = ribbonEnds.filter(r => r.tgtNode === i);
            const outLinks = ribbonEnds.filter(r => r.srcNode === i);
            if (inLinks.length === 0 || outLinks.length === 0) continue; // boundary node
            interiorCount++;
            const inSum = inLinks.reduce((a, r) => a + r.width, 0);
            const outSum = outLinks.reduce((a, r) => a + r.width, 0);
            const delta = Math.abs(inSum - outSum);
            if (delta > 0.5) {
                violations.push(
                    `node ${i}: in_sum=${inSum.toFixed(2)} != out_sum=${outSum.toFixed(2)} (delta=${delta.toFixed(2)}px)`
                );
            }
        }

        return {
            node_count: bars.length,
            link_count: ribbonEnds.length,
            interior_count: interiorCount,
            violations,
            link_widths: ribbonEnds.map(r => r.width)
        };
    }""")


def report(failures):
    if failures:
        print(f"\n{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"  FAIL  {f}")
        sys.exit(1)
    print("\nALL CONSERVATION CHECKS PASSED")


if __name__ == "__main__":
    main()
