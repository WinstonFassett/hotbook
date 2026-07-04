# P1 lifecycle contract test — runs against the docs demos page (which registers
# the custom elements) but exercises dynamically created elements.
#
#   uv run --with playwright python tests/e2e/element-lifecycle.py
#   BASE_URL=... to target another server.
#
# Asserts the constructor-scope + pure-scene contract on the icicle:
#   1. data can be set AFTER appendChild (no set-before-append folklore)
#   2. data can be SWAPPED wholesale post-mount (cardinality change reconciles)
#   3. drill state + rendering survive a DOM move (disconnect → reconnect)

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:4321")
failures: list[str] = []
errors: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(f"{BASE}/demos/bidirectional", wait_until="networkidle")
    page.wait_for_timeout(500)

    # Build a playground at the TOP of the viewport (rAF gate needs visibility).
    page.evaluate(
        """() => {
            const pg = document.createElement('div');
            pg.id = 'playground';
            pg.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;background:#111;display:flex;gap:8px;';
            pg.innerHTML = '<div id="slot-a" style="width:420px;height:300px"></div>'
                         + '<div id="slot-b" style="width:420px;height:300px"></div>';
            document.body.appendChild(pg);
        }"""
    )

    # ── 1. data AFTER append ────────────────────────────────────────────────
    r1 = page.evaluate(
        """async () => {
            const charts = window.vizformCharts;
            if (!charts) return { err: 'window.vizformCharts not exposed by demos harness' };
            const { leaf, group } = charts;
            const mk = (suffix, a, b) => group('r' + suffix, 'Root' + suffix, '#333', [
              group('g1' + suffix, 'G1' + suffix, '#5b8def', [
                leaf('a' + suffix, 'A' + suffix, a, '#86acf5'),
                leaf('b' + suffix, 'B' + suffix, b, '#86acf5'),
              ]),
              leaf('c' + suffix, 'C' + suffix, 30, '#a6df5e'),
            ]);
            window.__mkTree = mk;

            const el = document.createElement('v-br-icicle');
            el.style.cssText = 'display:block;width:400px;height:280px';
            el.setAttribute('no-source', '');
            document.getElementById('slot-a').appendChild(el);   // append FIRST
            await new Promise(r => setTimeout(r, 400));
            const rectsBefore = el.shadowRoot.querySelectorAll('rect').length;
            el.data = mk('X', 40, 60);                           // data AFTER
            window.__el = el;
            await new Promise(r => setTimeout(r, 1200));  // outlive the 850ms leave-timer
            const rects = el.shadowRoot.querySelectorAll('rect').length;
            const ids = Array.from(el.shadowRoot.querySelectorAll('[data-id]')).map(r => r.dataset.id);
            return { rectsBefore, rects, hasAX: ids.includes('aX'), ids: ids.slice(0, 8) };
        }"""
    )
    check(
        "data settable after mount",
        isinstance(r1, dict) and not r1.get("err") and r1.get("hasAX", False),
        str(r1),
    )

    # ── 2. wholesale data swap (different cardinality) ─────────────────────
    r2 = page.evaluate(
        """async () => {
            const el = window.__el, mk = window.__mkTree;
            // cardinality change: two extra leaves under g1Y
            const { leaf, group } = window.vizformCharts;
            const swap = group('rY', 'RootY', '#333', [
              group('g1Y', 'G1Y', '#5b8def', [
                leaf('aY', 'AY', 10, '#86acf5'),
                leaf('bY', 'BY', 20, '#86acf5'),
                leaf('dY', 'DY', 15, '#86acf5'),
                leaf('eY', 'EY', 5,  '#86acf5'),
              ]),
              leaf('cY', 'CY', 30, '#a6df5e'),
            ]);
            el.data = swap;
            await new Promise(r => setTimeout(r, 1200));  // outlive the 850ms leave-timer
            const ids = Array.from(el.shadowRoot.querySelectorAll('[data-id]')).map(r => r.dataset.id);
            return { hasNew: ids.includes('dY') && ids.includes('eY'), goneOld: !ids.includes('aX'), ids: ids.slice(0, 10) };
        }"""
    )
    check(
        "wholesale data swap reconciles",
        isinstance(r2, dict) and r2.get("hasNew", False) and r2.get("goneOld", False),
        str(r2),
    )

    # ── 3. DOM move survival: drill, reparent, drill state intact ──────────
    r3 = page.evaluate(
        """async () => {
            const el = window.__el;
            el.drillNodeId = 'g1Y';                       // drill into G1Y
            await new Promise(r => setTimeout(r, 1200));  // let drill tween settle
            const before = el.shadowRoot.querySelectorAll('[data-id]').length;
            document.getElementById('slot-b').appendChild(el);  // disconnect + reconnect
            await new Promise(r => setTimeout(r, 900));
            const after = el.shadowRoot.querySelectorAll('[data-id]').length;
            return {
              drillSurvived: el.drillNodeId === 'g1Y',
              rendersAfterMove: after > 0,
              before, after,
            };
        }"""
    )
    check(
        "drill state survives DOM move",
        isinstance(r3, dict) and r3.get("drillSurvived", False),
        str(r3),
    )
    check(
        "renders after DOM move",
        isinstance(r3, dict) and r3.get("rendersAfterMove", False),
        str(r3),
    )

    # ── 4. edits still flow after the move (cells intact) ──────────────────
    r4 = page.evaluate(
        """async () => {
            const el = window.__el;
            const root = el.data;
            const g1 = root.children[0];
            const a = g1.children[0];
            const geom = () => Array.from(el.shadowRoot.querySelectorAll('rect'))
              .map(r => r.getAttribute('height')).join(',');
            const before = geom();
            a.value.total.value = 80;
            await new Promise(r => setTimeout(r, 800));
            return { reflowed: before !== geom() };
        }"""
    )
    check("edits reflow after move", isinstance(r4, dict) and r4.get("reflowed", False), str(r4))

    browser.close()

real_errors = [e for e in errors if "favicon" not in e]
check("no page errors", not real_errors, "; ".join(real_errors[:5]))

print()
if failures:
    print(f"FAILED: {len(failures)} — {', '.join(failures)}")
    sys.exit(1)
print("ALL LIFECYCLE CHECKS PASSED")
