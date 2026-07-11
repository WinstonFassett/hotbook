# E2E check for the docs bidirectional demos page.
#
#   uv run --with playwright python tests/e2e/docs-bidirectional.py
#   BASE_URL=http://localhost:4173 uv run --with playwright python tests/e2e/docs-bidirectional.py
#
# Requires chromium: uv run --with playwright playwright install chromium
# Default BASE_URL targets the dev server (localhost:4321); point it at a static
# server over apps/docs/dist to validate the production build.
#
# Gotcha this encodes: Diagram gates its rAF loop on viewport intersection, so a
# chart below the fold will not animate. Always scrollIntoView before asserting
# geometry changes.

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
    page.on(
        "console",
        lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None,
    )

    # ── homepage ────────────────────────────────────────────────────────────
    page.goto(BASE, wait_until="networkidle")
    check("homepage title", "hotbook" in page.title(), page.title())

    # ── demos page renders all three elements ───────────────────────────────
    page.goto(f"{BASE}/demos/bidirectional", wait_until="networkidle")
    page.wait_for_timeout(1000)
    for tag, min_marks in [("v-br-bar", 4), ("v-br-icicle", 6), ("v-br-treetable", 0)]:
        info = page.evaluate(
            """(tag) => {
                const el = document.querySelector(tag);
                if (!el) return null;
                const root = el.shadowRoot || el;
                return { rects: root.querySelectorAll('rect').length,
                         text: (root.textContent || '').replace(/\\s+/g, ' ').slice(0, 80) };
            }""",
            tag,
        )
        check(f"{tag} mounted", info is not None)
        if info and min_marks:
            check(f"{tag} renders marks", info["rects"] >= min_marks, f"rects={info['rects']}")
    tt_text = page.evaluate(
        "() => { const el = document.querySelector('v-br-treetable');"
        "  return ((el.shadowRoot || el).textContent || '').replace(/\\s+/g, ' '); }"
    )
    check("treetable shows group totals", "Engineering 120" in tt_text, tt_text[:80])

    # ── bar demo: table input → chart cell ──────────────────────────────────
    bar = page.evaluate(
        """async () => {
            const input = document.querySelector('#bar-table-container input[type=number]');
            const chart = document.querySelector('v-br-bar');
            if (!input || !chart) return null;
            const before = chart.dataCell.value[0].value;
            input.value = '77';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 300));
            return { before, after: chart.dataCell.value[0].value };
        }"""
    )
    check("bar table→chart", bar is not None and bar["after"] == 77, str(bar))

    # ── icicle ↔ treetable: shared-cell write reflows both ─────────────────
    page.locator("v-br-icicle").scroll_into_view_if_needed()
    page.wait_for_timeout(1000)  # let the rAF gate wake up
    sync = page.evaluate(
        """async () => {
            const icicle = document.querySelector('v-br-icicle');
            const tt = document.querySelector('v-br-treetable');
            const root = tt.externalRoot;
            const stack = [root];
            let target = null;
            while (stack.length) {
                const n = stack.pop();
                if (n.value.id === 'frontend') { target = n; break; }
                (n.children || []).forEach((c) => stack.push(c));
            }
            if (!target) return { err: 'frontend node not found' };
            const sr = icicle.shadowRoot;
            const geom = () => Array.from(sr.querySelectorAll('rect'))
                .map((r) => [r.getAttribute('x'), r.getAttribute('y'),
                             r.getAttribute('width'), r.getAttribute('height')].join(':'))
                .join('|');
            const before = geom();
            target.value.total.value = 200;
            await new Promise((r) => setTimeout(r, 2000));
            return {
                icicleReflowed: before !== geom(),
                treetableShows200: /200/.test((tt.shadowRoot || tt).textContent),
            };
        }"""
    )
    check("shared cell → treetable updates", bool(sync.get("treetableShows200")), str(sync))
    check("shared cell → icicle reflows", bool(sync.get("icicleReflowed")), str(sync))

    browser.close()

benign = ("favicon",)
real_errors = [e for e in errors if not any(b in e for b in benign)]
check("no page errors", not real_errors, "; ".join(real_errors[:5]))

print()
if failures:
    print(f"FAILED: {len(failures)} — {', '.join(failures)}")
    sys.exit(1)
print("ALL CHECKS PASSED")
