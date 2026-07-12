"""
WIN-282: verify CartesianViewer smooth programmatic transitions and reduced-motion behavior.

Run with:
    uv run --with playwright python tests/e2e/win282_cartesian_viewer_smooth.py

Env:
    BASE_URL defaults to http://127.0.0.1:4523
"""

import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:4523")
URL = f"{BASE}/#cfg:only=cartesian-viewer|cartesian-viewer"


def _geometry(page):
    """Stable geometry signature of the chart's axes and grid."""
    return page.evaluate(
        """() => {
          const el = document.querySelector('md-cartesian-viewer');
          if (!el) return null;
          const root = el.shadowRoot || el;
          const parts = [];
          root.querySelectorAll('line').forEach(l => {
            parts.push(['L', l.getAttribute('x1'), l.getAttribute('y1'), l.getAttribute('x2'), l.getAttribute('y2')].join(','));
          });
          root.querySelectorAll('path').forEach(p => parts.push('P' + (p.getAttribute('d') || '')));
          root.querySelectorAll('text').forEach(t => parts.push('T' + (t.getAttribute('x') || '') + ',' + (t.getAttribute('y') || '') + ',' + t.textContent));
          return parts.join('|');
        }"""
    )


def _click_button(page, label_substring):
    ok = page.evaluate(
        """(label) => {
          const el = document.querySelector('md-cartesian-viewer');
          if (!el) return false;
          const root = el.shadowRoot || el;
          const btn = [...root.querySelectorAll('button')].find(b => (b.textContent || '').includes(label));
          if (!btn) return false;
          btn.click();
          return true;
        }""",
        label_substring,
    )
    return bool(ok)


def _wait_stable(page, quiet_ms=80, timeout_ms=1500):
    prev = _geometry(page)
    waited = 0
    while waited < timeout_ms:
        page.wait_for_timeout(quiet_ms)
        waited += quiet_ms
        cur = _geometry(page)
        if cur is not None and cur == prev:
            return
        prev = cur


def main():
    failures = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.goto(URL, wait_until="networkidle")
        page.wait_for_selector("md-cartesian-viewer")
        _wait_stable(page)

        # 1. Smooth Set ViewBox should animate (geometry changes between early and late samples).
        if not _click_button(page, "Set ViewBox"):
            failures.append("Set ViewBox button not found")
        else:
            early = _geometry(page)
            page.wait_for_timeout(80)
            late = _geometry(page)
            _wait_stable(page)
            final = _geometry(page)
            if early == late or late == final or early == final:
                failures.append("smooth Set ViewBox did not show intermediate frames")
            else:
                print("PASS: smooth Set ViewBox animates")

        _wait_stable(page)

        # 2. Reset back to the original domain so the next step has a clear transition.
        if not _click_button(page, "Reset"):
            failures.append("Reset button not found")
        _wait_stable(page)

        # 3. Toggle Smooth off (reduced-motion / immediate behavior).
        if not _click_button(page, "Smooth"):
            failures.append("Smooth toggle button not found")
        else:
            # Wait for the label to update.
            page.wait_for_timeout(50)
            # 4. Set ViewBox while smooth is off should be immediate.
            before = _geometry(page)
            if not _click_button(page, "Set ViewBox"):
                failures.append("Set ViewBox button not found for immediate test")
            else:
                page.wait_for_timeout(80)
                after = _geometry(page)
                if before == after:
                    failures.append("immediate Set ViewBox produced no change")
                elif _geometry(page) != after:
                    failures.append("immediate Set ViewBox continued to change after 80ms")
                else:
                    print("PASS: immediate/reduced-motion Set ViewBox snaps to final")

        browser.close()

    if failures:
        print("FAILURES:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("ALL WIN-282 CHECKS PASSED")


if __name__ == "__main__":
    main()
