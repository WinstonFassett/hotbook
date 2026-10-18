# Regression test (WIN-552): a bar's value label must follow external value edits.
#
#   uv run --with playwright python tests/e2e/demos-bar-label-follows-value.py
#
# Scrubbing the side-table Value cell grew the bar, but the numeric label kept the old value.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


def table_value(page, section: str, node_id: str) -> float:
    return float(
        page.locator(f'#{section} v-treetable [data-value-cell="{node_id}:value"]').first.text_content()
    )


# The value label is the numeric text sharing the category label's band:
# same column (vertical) or same row (horizontal), excluding axis ticks.
def value_label(page, section: str, node_id: str) -> str | None:
    return page.evaluate(
        """([s, id]) => {
          const el = [...document.querySelectorAll(`#${s} *`)].find(e => e.dataCell);
          const texts = [...el.querySelectorAll('text')];
          const cat = texts.find(t => t.textContent === id);
          if (!cat) return null;
          const cb = cat.getBoundingClientRect();
          const vert = el.orientation === 'vertical';
          const hits = texts.filter(t => {
            if (t === cat || !/^-?\\d+$/.test(t.textContent)) return false;
            const b = t.getBoundingClientRect();
            if (!b.width) return false;
            return vert
              ? Math.abs((b.x + b.width / 2) - (cb.x + cb.width / 2)) < 12 && b.y < cb.y - 4
              : Math.abs((b.y + b.height / 2) - (cb.y + cb.height / 2)) < 8 && b.x > cb.x + cb.width;
          });
          return hits.length === 1 ? hits[0].textContent : `ambiguous:${hits.map(t => t.textContent)}`;
        }""",
        [section, node_id],
    )


def read(page, section: str, node_id: str) -> dict:
    return {"table": table_value(page, section, node_id), "label": value_label(page, section, node_id)}


def agree(r: dict) -> bool:
    return r["label"] == str(int(r["table"]))


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
    r0 = read(page, section, node_id)
    check(f"{label}: label matches table at rest", agree(r0), str(r0))

    r = scrub(page, section, node_id, 80, "release")
    check(f"{label}: table scrubs", r["mid"]["table"] > r["before"]["table"], f"{r['before']} -> {r['mid']}")
    check(f"{label}: label follows table mid-scrub", agree(r["mid"]), str(r["mid"]))
    check(f"{label}: label follows table after release", agree(r["after"]), str(r["after"]))

    r = scrub(page, section, node_id, 80, "escape")
    check(f"{label}: label follows table mid-scrub (escape run)", agree(r["mid"]), str(r["mid"]))
    check(f"{label}: Escape reverts label", r["after"] == r["before"] and agree(r["after"]), f"{r['before']} vs {r['after']}")


def run(page) -> None:
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)

    case(page, "bar-chart", "Feb", "bar")
    case(page, "bands-chart", "B", "bands")


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
