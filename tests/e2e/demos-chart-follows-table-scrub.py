# Regression test (WIN-544): a side-table value scrub must drive the chart live.
#
#   uv run --with playwright python tests/e2e/demos-chart-follows-table-scrub.py
#
# The table cell climbed during the scrub but the chart held the old value until release.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


def set_sort(page, section: str, sort: str) -> None:
    selects = page.locator(f"#{section} .chart-config-controls select")
    for i in range(selects.count()):
        opts = selects.nth(i).evaluate("el => Array.from(el.options).map(o => o.value)")
        if "index" in opts and "value" in opts:
            selects.nth(i).select_option(sort)
            page.wait_for_timeout(600)
            return
    raise RuntimeError(f"no sort select in #{section}")


def table_value(page, section: str, node_id: str) -> float:
    return float(
        page.locator(f'#{section} v-treetable [data-value-cell="{node_id}:value"]').first.text_content()
    )


def chart_value(page, section: str, node_id: str) -> float | None:
    return page.evaluate(
        """([s, id]) => {
          const el = [...document.querySelectorAll(`#${s} *`)].find(e => e.dataCell);
          const d = el?.dataCell.value?.find(x => (x.id ?? x.label) === id);
          return d ? d.value : null;
        }""",
        [section, node_id],
    )


def bar_height(page, node_id: str) -> float | None:
    return page.evaluate(
        """id => {
          const el = document.querySelector('#bar-chart v-bar-chart');
          const label = [...el.querySelectorAll('text')].find(t => t.textContent === id);
          if (!label) return null;
          const lb = label.getBoundingClientRect();
          const cx = lb.x + lb.width / 2;
          let best = null, dist = Infinity;
          for (const r of el.querySelectorAll('rect')) {
            const b = r.getBoundingClientRect();
            if (!b.width || !b.height || b.width > 200) continue;
            const d = Math.abs(b.x + b.width / 2 - cx);
            if (d < dist) { dist = d; best = b; }
          }
          return best ? Math.round(best.height * 10) / 10 : null;
        }""",
        node_id,
    )


def read(page, section: str, node_id: str) -> dict:
    r = {"table": table_value(page, section, node_id), "chart": chart_value(page, section, node_id)}
    if section == "bar-chart":
        r["bar_px"] = bar_height(page, node_id)
    return r


def agree(r: dict) -> bool:
    return r["chart"] == r["table"]


def bar_grew(a: dict, b: dict) -> bool:
    return "bar_px" not in a or (b["bar_px"] or 0) > (a["bar_px"] or 0) + 1


def scrub(page, section: str, node_id: str, dx: int, finish: str) -> dict:
    page.locator(f"#{section}").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    c = page.locator(f'#{section} v-treetable [data-value-cell="{node_id}:value"]').first
    box = c.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    before = read(page, section, node_id)
    page.mouse.move(x, y)
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(x + dx * i / 10, y)
        page.wait_for_timeout(30)
    page.wait_for_timeout(100)
    mid = read(page, section, node_id)
    if finish == "escape":
        page.keyboard.press("Escape")
    page.mouse.up()
    page.wait_for_timeout(700)
    return {"before": before, "mid": mid, "after": read(page, section, node_id)}


def case(page, section: str, node_id: str, label: str) -> None:
    r = scrub(page, section, node_id, 80, "escape")
    check(f"{label}: table scrubs live", r["mid"]["table"] > r["before"]["table"], f"{r['before']} -> {r['mid']}")
    check(f"{label}: chart follows table mid-scrub", agree(r["mid"]), str(r["mid"]))
    check(f"{label}: bar grows mid-scrub", bar_grew(r["before"], r["mid"]), f"{r['before']} -> {r['mid']}")
    check(f"{label}: Escape reverts both", r["after"] == r["before"], f"{r['before']} vs {r['after']}")

    r = scrub(page, section, node_id, 80, "release")
    check(f"{label}: chart follows table mid-scrub (release run)", agree(r["mid"]), str(r["mid"]))
    check(
        f"{label}: release commits both",
        r["after"]["table"] > r["before"]["table"] and agree(r["after"]) and bar_grew(r["before"], r["after"]),
        f"{r['before']} -> {r['after']}",
    )


def run(page) -> None:
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)

    case(page, "bar-chart", "Feb", "bar/index")
    set_sort(page, "bar-chart", "value")
    case(page, "bar-chart", "Jan", "bar/value")
    case(page, "radar-chart", "Power", "radar/index")


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
