# Regression test (WIN-545): a table value of 0 must render "0", not a blank cell.
#
#   uv run --with playwright python tests/e2e/demos-table-zero.py
#   BASE_URL=http://hotbook-demos.localhost:1355 to target another host.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


def run(page) -> None:
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)
    start = page.locator('#gantt v-treetable [data-value-cell="t1:start"]').first.text_content()
    check("gantt Discovery start renders 0", start.strip() == "0", repr(start))
    end = page.locator('#gantt v-treetable [data-value-cell="t1:end"]').first.text_content()
    check("gantt Discovery end renders 7.0", end.strip() == "7.0", repr(end))
    blanks = page.eval_on_selector_all(
        "section:not([id^=sankey]) v-treetable [data-value-cell]",
        "els => els.filter(e => e.textContent.trim() === '').map(e => e.dataset.valueCell)",
    )
    check("no blank value cells outside sankey", not blanks, str(blanks[:8]))


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_context(viewport={"width": 1600, "height": 1000}).new_page()
        try:
            run(page)
        except Exception as e:
            print(f"ERROR  {e}", file=sys.stderr)
            failures.append(f"exception: {e}")
        finally:
            browser.close()
    if failures:
        print(f"\n{len(failures)} FAILURES: {', '.join(failures)}")
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
