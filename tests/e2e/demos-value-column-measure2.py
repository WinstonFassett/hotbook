# Regression test (WIN-543): with Measure = "Value 2", the side table's Value column
# must keep showing the `value` measure, and Value 2 must be the chart-bound column.
#
#   uv run --with playwright python tests/e2e/demos-value-column-measure2.py
#
# valueData gave every leaf a `total` lens distinct from its value/value2 measure
# cells, so the treetable's primary-column pick (WIN-541: the column whose measure
# cell IS the total) always fell back to column 0. In Value 2 mode the Value column
# therefore rendered the chart value (value2) — both columns showed the same numbers —
# and scrubbing Value 2 went through the non-primary path and was a no-op.

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


def read(page, section: str, node_id: str, key: str) -> float:
    return float((value_cell(page, section, node_id, key).text_content() or "").strip() or 0)


def leaf_ids(page, section: str) -> list[str]:
    return page.eval_on_selector_all(
        f'#{section} v-treetable [data-value-cell$=":value"]',
        "els => els.map(e => e.dataset.valueCell.split(':')[0]).filter(id => id !== 'root')",
    )


def chart_values(page, section: str) -> dict:
    return page.evaluate(
        """(s) => {
          const sec = document.querySelector('#' + s);
          const el = [...sec.querySelectorAll('*')].find(e => e.dataCell && e.tagName !== 'V-TREETABLE');
          const out = {};
          for (const d of el.dataCell.value) out[d.id] = Math.round(typeof d.value === 'object' ? d.value.value : d.value);
          return out;
        }""",
        section,
    )


def set_measure(page, section: str, key: str) -> None:
    page.locator(f"#{section} select:has(option[value='value2'])").first.select_option(key)
    page.wait_for_timeout(800)


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
    ids = leaf_ids(page, section)
    check(f"{section}: table has rows", len(ids) >= 4, str(ids))
    v0 = {i: read(page, section, i, "value") for i in ids}
    w0 = {i: read(page, section, i, "value2") for i in ids}
    check(f"{section}: fixture has value != value2", sum(v0[i] != w0[i] for i in ids) >= 3, "")

    set_measure(page, section, "value2")
    chart = chart_values(page, section)
    check(f"{section} [Value 2]: chart shows value2", all(chart.get(i) == round(w0[i]) for i in ids), str(chart))
    stale = [i for i in ids if read(page, section, i, "value") != v0[i]]
    check(f"{section} [Value 2]: Value column still shows the value measure", not stale,
          ", ".join(f"{i}: {read(page, section, i, 'value')} != {v0[i]}" for i in stale[:4]))
    check(f"{section} [Value 2]: Value 2 column shows value2", all(read(page, section, i, "value2") == w0[i] for i in ids), "")

    # Value 2 is the chart-bound column now: scrubbing it must move the chart and leave Value alone.
    a = ids[1]
    scrub(page, section, a, "value2", 40)
    w1 = read(page, section, a, "value2")
    check(f"{section} [Value 2]: scrub Value 2 {a} edits", w1 > w0[a], f"{w0[a]} -> {w1}")
    check(f"{section} [Value 2]: scrub Value 2 {a} drives the chart", chart_values(page, section).get(a) == round(w1), str(chart_values(page, section).get(a)))
    check(f"{section} [Value 2]: scrub Value 2 {a} leaves Value", read(page, section, a, "value") == v0[a], f"{read(page, section, a, 'value')}")

    # Value is the off-chart measure: scrubbing it edits value only.
    b = ids[2]
    scrub(page, section, b, "value", 40)
    v1 = read(page, section, b, "value")
    check(f"{section} [Value 2]: scrub Value {b} edits", v1 > v0[b], f"{v0[b]} -> {v1}")
    check(f"{section} [Value 2]: scrub Value {b} leaves the chart", chart_values(page, section).get(b) == round(w0[b]), str(chart_values(page, section).get(b)))
    check(f"{section} [Value 2]: scrub Value {b} leaves Value 2", read(page, section, b, "value2") == w0[b], f"{read(page, section, b, 'value2')}")

    # Back to Value: both edits survive, chart follows the Value column again.
    set_measure(page, section, "value")
    chart = chart_values(page, section)
    check(f"{section} [Value]: chart shows edited value", chart.get(b) == round(v1) and chart.get(a) == round(v0[a]), f"{chart.get(a)}, {chart.get(b)}")
    check(f"{section} [Value]: Value 2 keeps its edit", read(page, section, a, "value2") == w1, f"{read(page, section, a, 'value2')}")


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
