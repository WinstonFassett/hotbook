# Regression test (WIN-543): with Measure = Value 2, the side table's Value
# column must still show and edit the `value` measure — not value2.
#
#   uv run --with playwright python tests/e2e/demos-value-column-under-measure2.py
#
# Cause: the treetable binds its primary column to the node's kernel `total`
# (the active measure). The demos model built `total` as a separate lens, so the
# "which measure is primary" probe (measures[key] === total) never matched and
# fell back to the first column — "value" — which then mirrored value2.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")

SECTIONS = ["bar-chart", "radar-chart"]

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


def value_cell(page, section: str, node_id: str, key: str):
    return page.locator(f'#{section} v-treetable [data-value-cell="{node_id}:{key}"]').first


def text(page, section: str, node_id: str, key: str) -> str:
    return (value_cell(page, section, node_id, key).text_content() or "").strip()


def read(page, section: str, node_id: str, key: str) -> float:
    return float(text(page, section, node_id, key) or 0)


def leaf_ids(page, section: str, key: str = "value2") -> list[str]:
    return page.eval_on_selector_all(
        f'#{section} v-treetable [data-value-cell$=":{key}"]',
        "els => els.map(e => e.dataset.valueCell.split(':')[0]).filter(id => id !== 'root')",
    )


def set_measure(page, section: str, key: str) -> bool:
    sel = page.locator(f"#{section} select:has(option[value='value2'])").first
    if sel.count() == 0:
        return False
    sel.select_option(key)
    page.wait_for_timeout(800)
    return True


def chart_values(page, section: str) -> dict:
    return page.evaluate(
        """(s) => {
          const sec = document.querySelector('#' + s);
          const el = [...sec.querySelectorAll('*')].find(e => e.dataCell && e.tagName !== 'V-TREETABLE');
          const out = {};
          for (const d of el.dataCell.value) out[d.id] = d.value;
          return out;
        }""",
        section,
    )


def scrub(page, section: str, node_id: str, key: str, dx: int) -> None:
    page.locator(f"#{section}").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    box = value_cell(page, section, node_id, key).bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(x + dx * i / 10, y)
        page.wait_for_timeout(30)
    page.mouse.up()
    page.wait_for_timeout(700)


def check_section(page, section: str) -> None:
    if not set_measure(page, section, "value"):
        check(f"{section}: has measure selector", False)
        return
    ids = leaf_ids(page, section)
    if len(ids) < 2:
        check(f"{section}: >=2 rows", False, str(ids))
        return
    nid = ids[1]
    v0, w0 = read(page, section, nid, "value"), read(page, section, nid, "value2")
    check(f"{section} {nid}: value != value2 baseline", v0 != w0, f"value={v0} value2={w0}")

    set_measure(page, section, "value2")
    v1, w1 = read(page, section, nid, "value"), read(page, section, nid, "value2")
    check(f"{section} {nid} [measure=v2]: Value column still shows value", v1 == v0, f"{v0} -> {v1}")
    check(f"{section} {nid} [measure=v2]: Value 2 column shows value2", w1 == w0, f"{w0} -> {w1}")

    scrub(page, section, nid, "value", 80)
    v2, w2 = read(page, section, nid, "value"), read(page, section, nid, "value2")
    check(f"{section} scrub {nid} Value under measure=v2: value changes", v2 != v0, f"{v0} -> {v2}")
    check(f"{section} scrub {nid} Value under measure=v2: value2 unchanged", w2 == w0, f"{w0} -> {w2}")

    scrub(page, section, nid, "value2", 80)
    v3, w3 = read(page, section, nid, "value"), read(page, section, nid, "value2")
    check(f"{section} scrub {nid} Value 2 under measure=v2: value2 changes", w3 != w0, f"{w0} -> {w3}")
    check(f"{section} scrub {nid} Value 2 under measure=v2: value unchanged", v3 == v2, f"{v2} -> {v3}")

    set_measure(page, section, "value")
    v4, w4 = read(page, section, nid, "value"), read(page, section, nid, "value2")
    check(f"{section} {nid} [back to measure=v]: Value column shows scrubbed value", v4 == v3, f"{v3} -> {v4}")
    check(f"{section} {nid} [back to measure=v]: Value 2 column shows scrubbed value2", w4 == w3, f"{w3} -> {w4}")


def run(page) -> None:
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)
    for section in SECTIONS:
        check_section(page, section)


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
