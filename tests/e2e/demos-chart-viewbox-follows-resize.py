# Regression test: a chart's SVG viewBox must track its host size across resizes.
#
#   uv run --with playwright python tests/e2e/demos-chart-viewbox-follows-resize.py
#   BASE_URL=http://hotbook-demos.localhost:1355 to target another host.
#
# Charts called `_setViewBox(Wc.value, Hc.value)` once at mount, so the viewBox
# froze at the initial host size. Geometry re-laid out at the new width but the
# pointer is mapped through the viewBox, so after any resize hover/click picked
# the wrong datum (area chart: pointer on Jan 20 highlighted ~Jan 12) and the
# plot rendered scaled-down.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")
SECTIONS = ["line-chart", "area-chart", "scatter-chart", "radar-chart", "concentric-arc", "gantt"]

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


def sizes(page, section: str) -> dict:
    return page.evaluate(
        """s => {
          const svg = document.querySelector(`#${s} svg[viewBox]`);
          const r = svg.getBoundingClientRect();
          const vb = svg.viewBox.baseVal;
          return { boxW: r.width, boxH: r.height, vbW: vb.width, vbH: vb.height };
        }""",
        section,
    )


def assert_tracks(page, tag: str) -> None:
    for sec in SECTIONS:
        page.locator(f"#{sec}").scroll_into_view_if_needed()
        page.wait_for_timeout(250)
        s = sizes(page, sec)
        ok = abs(s["boxW"] - s["vbW"]) <= 1 and abs(s["boxH"] - s["vbH"]) <= 1
        check(f"{sec} [{tag}]: viewBox matches box", ok, str(s))


def run(page) -> None:
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)
    assert_tracks(page, "initial 1600")

    page.set_viewport_size({"width": 703, "height": 900})
    page.wait_for_timeout(1200)
    assert_tracks(page, "narrowed to 703")

    page.set_viewport_size({"width": 1600, "height": 1000})
    page.wait_for_timeout(1200)
    assert_tracks(page, "widened to 1600")

    # Mounted narrow, then widened past the initial size (the reverse direction).
    page.set_viewport_size({"width": 703, "height": 900})
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(800)
    assert_tracks(page, "reloaded at 703")
    page.set_viewport_size({"width": 1600, "height": 1000})
    page.wait_for_timeout(1200)
    assert_tracks(page, "widened from 703 mount")


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
