# Regression test (WIN-542): bar/bands side-table Value 2 column must show and edit value2.
#
#   uv run --with playwright python tests/e2e/demos-value2-column.py
#
# The bar/bands Value 2 column rendered blank on every row and scrubbing it was a no-op,
# while radar (same valueData model) showed Value 2 correctly. Radar is the control.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")

SECTIONS = ["bar-chart", "bands-chart", "radar-chart"]

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
    # The treetable renders 0 as a blank cell.
    return float(text(page, section, node_id, key) or 0)


def is_number(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


def leaf_ids(page, section: str, key: str) -> list[str]:
    return page.eval_on_selector_all(
        f'#{section} v-treetable [data-value-cell$=":{key}"]',
        "els => els.map(e => e.dataset.valueCell.split(':')[0]).filter(id => id !== 'root')",
    )


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
    ids = leaf_ids(page, section, "value2")
    check(f"{section}: table has Value 2 rows", len(ids) >= 5, str(ids))
    for nid in ids:
        t = text(page, section, nid, "value2")
        check(f"{section} {nid}: value2 non-blank numeric", t != "" and is_number(t), repr(t))

    if len(ids) < 2:
        return
    nid = ids[1]
    v0, w0 = read(page, section, nid, "value"), read(page, section, nid, "value2")
    scrub(page, section, nid, "value2", 40)
    v1, w1 = read(page, section, nid, "value"), read(page, section, nid, "value2")
    check(f"{section} scrub {nid} value2: changes", w1 != w0, f"{w0} -> {w1}")
    check(f"{section} scrub {nid} value2: value unchanged", v1 == v0, f"{v0} -> {v1}")

    sel = page.locator(f"#{section} select:has(option[value='value2'])").first
    sel.select_option("value2")
    page.wait_for_timeout(800)
    chart = chart_values(page, section)
    matches = [i for i in ids if i in chart and round(chart[i]) == round(read(page, section, i, "value2"))]
    detail = ", ".join(f"{i}: chart={chart.get(i)} table={text(page, section, i, 'value2')!r}" for i in ids[:4])
    check(f"{section} [measure=Value 2]: chart matches table value2 (>=3)", len(matches) >= 3, detail)


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
