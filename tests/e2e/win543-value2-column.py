# Regression test (WIN-543): with Measure set to "Value 2", the side table's Value
# column must mirror the value2 data on every row, live, and edits through that
# column must write value2. Switching Measure back to "Value" restores the value data.
#
#   uv run --with playwright python tests/e2e/win543-value2-column.py
#   BASE_URL=http://hotbook-demos.localhost:1355 to target another host.
#
# Every section whose Measure picker offers "Value 2" is checked. The flat charts
# already followed the picker; the sankey sections kept showing value.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")

SCRUB_SECTIONS = ["bar-chart", "sankey-simple"]

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


def picker_sections(page) -> list[str]:
    return page.eval_on_selector_all(
        "section",
        "els => els.filter(s => s.querySelector(\"select option[value='value2']\")).map(s => s.id)",
    )


def table(page, section: str) -> dict[str, dict[str, str]]:
    # {row id: {column key: cell text}} for every value cell in the section's side table.
    return page.evaluate(
        """(s) => {
          const out = {};
          for (const c of document.querySelectorAll('#' + s + ' v-treetable [data-value-cell]')) {
            const i = c.dataset.valueCell.lastIndexOf(':');
            const id = c.dataset.valueCell.slice(0, i), key = c.dataset.valueCell.slice(i + 1);
            (out[id] ||= {})[key] = c.textContent.trim();
          }
          return out;
        }""",
        section,
    )


def set_measure(page, section: str, key: str) -> None:
    page.locator(f"#{section} select:has(option[value='value2'])").first.select_option(key)
    page.wait_for_timeout(800)


def leaf_rows(rows: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    # Rows that carry a value2 datum (sankey group rows render value2 blank).
    return {rid: r for rid, r in rows.items() if rid != "root" and r.get("value2", "") != ""}


def scrub(page, section: str, row_id: str, dx: int) -> None:
    page.locator(f"#{section}").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    box = page.locator(f'#{section} v-treetable [data-value-cell="{row_id}:value"]').first.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(x + dx * i / 10, y)
        page.wait_for_timeout(30)
    page.mouse.up()
    page.wait_for_timeout(700)


def check_section(page, section: str) -> None:
    before = leaf_rows(table(page, section))
    check(f"{section}: table has rows with a value2 datum", len(before) >= 2, str(list(before)[:4]))

    set_measure(page, section, "value2")
    rows = leaf_rows(table(page, section))
    mismatched = [f"{rid}: value={r['value']!r} value2={r['value2']!r}" for rid, r in rows.items() if r.get("value") != r.get("value2")]
    check(f"{section} [measure=Value 2]: every Value cell equals the row's value2 datum", not mismatched, "; ".join(mismatched[:4]))

    if section in SCRUB_SECTIONS and rows:
        rid = list(rows)[1] if len(rows) > 1 else list(rows)[0]
        v2_before = rows[rid]["value2"]
        scrub(page, section, rid, 40)
        after = leaf_rows(table(page, section))
        check(f"{section} [measure=Value 2] scrub {rid} Value: value2 datum changes", after[rid]["value2"] != v2_before, f"{v2_before} -> {after[rid]['value2']}")
        check(f"{section} [measure=Value 2] scrub {rid} Value: Value cell still mirrors value2", after[rid]["value"] == after[rid]["value2"], f"value={after[rid]['value']!r} value2={after[rid]['value2']!r}")

    set_measure(page, section, "value")
    restored = leaf_rows(table(page, section))
    wrong = [f"{rid}: {restored.get(rid, {}).get('value')!r} != {r['value']!r}" for rid, r in before.items() if restored.get(rid, {}).get("value") != r["value"]]
    check(f"{section} [measure=Value]: Value column restores the value data", not wrong, "; ".join(wrong[:4]))


def run(page) -> None:
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)
    sections = picker_sections(page)
    check("sections with a Value 2 measure picker exist", len(sections) >= 2, str(sections))
    check("sankey sections offer the Value 2 picker", "sankey-simple" in sections, str(sections))
    for section in sections:
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
