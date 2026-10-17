# Regression test (WIN-541): Gantt side-table Start column must show each task's start, not its end.
#
#   uv run --with playwright python tests/e2e/demos-gantt-table-columns.py
#
# The treetable treated the first visible column as the primary measure and rendered the
# node total (the end cell) in it, so Start == End on every row and scrubbing Start edited End.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


def value_cell(page, section: str, node_id: str, key: str):
    return page.locator(f'#{section} v-treetable [data-value-cell="{node_id}:{key}"]').first


def read(page, section: str, node_id: str, key: str) -> float:
    return float(value_cell(page, section, node_id, key).text_content())


def leaf_ids(page, section: str, key: str) -> list[str]:
    return page.eval_on_selector_all(
        f'#{section} v-treetable [data-value-cell$=":{key}"]',
        "els => els.map(e => e.dataset.valueCell.split(':')[0]).filter(id => id !== 'root')",
    )


def chart_tasks(page) -> dict:
    return page.evaluate(
        """() => {
          const g = document.querySelector('#gantt v-gantt');
          const t0 = new Date(2026, 0, 1).getTime();
          const out = {};
          for (const t of g.dataCell.value) out[t.id] = [(t.start - t0) / 864e5, (t.end - t0) / 864e5];
          return out;
        }"""
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


def run(page) -> None:
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)

    ids = leaf_ids(page, "gantt", "start")
    check("gantt: table has task rows", len(ids) >= 5, str(ids))
    tasks = chart_tasks(page)
    for tid in ids:
        s, e = read(page, "gantt", tid, "start"), read(page, "gantt", tid, "end")
        check(f"gantt {tid}: start != end", s != e, f"start={s} end={e}")
        check(f"gantt {tid}: start < end", s < e, f"start={s} end={e}")
        cs, ce = tasks[tid]
        check(f"gantt {tid}: start matches chart", round(s) == round(cs), f"table={s} chart={cs}")
        check(f"gantt {tid}: end matches chart", round(e) == round(ce), f"table={e} chart={ce}")

    check("gantt t1 (Discovery): start 0", read(page, "gantt", "t1", "start") == 0)
    check("gantt t1 (Discovery): end 7", read(page, "gantt", "t1", "end") == 7)

    # Start column edits the start only (the chart's left-handle semantics); end stays put.
    tid = "t3"
    s0, e0 = read(page, "gantt", tid, "start"), read(page, "gantt", tid, "end")
    scrub(page, "gantt", tid, "start", 40)
    s1, e1 = read(page, "gantt", tid, "start"), read(page, "gantt", tid, "end")
    check("gantt scrub start: start increases", s1 > s0, f"{s0} -> {s1}")
    check("gantt scrub start: end unchanged", e1 == e0, f"{e0} -> {e1}")
    cs, ce = chart_tasks(page)[tid]
    check("gantt scrub start: chart start follows", round(cs) == round(s1), f"chart={cs} table={s1}")
    check("gantt scrub start: chart end unchanged", round(ce) == round(e0), f"chart={ce}")

    # Primary-measure editing on the bar table must keep working.
    before = read(page, "bar-chart", "Feb", "value")
    scrub(page, "bar-chart", "Feb", "value", 40)
    after = read(page, "bar-chart", "Feb", "value")
    check("bar: Feb value scrubs up", after > before, f"{before} -> {after}")


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
