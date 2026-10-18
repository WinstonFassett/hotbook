# Regression test (WIN-540): a bar's fill belongs to its item, not its slot.
#
#   uv run --with playwright python tests/e2e/demos-bar-identity-colors.py
#
# Bars were colored by position, so sorting or drag-reordering repainted every
# bar with its new slot's color and the chart stopped matching the table dots.

import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


def set_sort(page, section: str, value: str) -> None:
    selects = page.locator(f"#{section} .chart-config-controls select")
    for i in range(selects.count()):
        opts = selects.nth(i).evaluate("el => Array.from(el.options).map(o => o.value)")
        if "index" in opts and "value" in opts:
            selects.nth(i).select_option(value)
            page.wait_for_timeout(900)
            return
    raise RuntimeError(f"no sort select in #{section}")


def table_dots(page, section: str) -> dict[str, str]:
    """label -> computed background color of the row's color dot."""
    return page.eval_on_selector_all(
        f"#{section} v-treetable [data-id]",
        """rows => Object.fromEntries(rows.map(r => {
            const dot = Array.from(r.querySelectorAll('span')).find(s => (s.getAttribute('style') || '').includes('background:'));
            const label = dot && dot.nextElementSibling ? dot.nextElementSibling.textContent.trim() : r.dataset.id;
            return [label, dot ? getComputedStyle(dot).backgroundColor : null];
        }))""",
    )


def bar_fills(page, section: str, labels: list[str]) -> dict[str, dict]:
    """label -> {fill, rect} by matching each label text to the bar whose
    extent along the category axis contains the label's center. Skips the
    plot background (var(...) fill) and the slot highlight band (#ffffff)."""
    return page.evaluate(
        """([section, labels]) => {
            const root = document.querySelector('#' + section);
            const bars = Array.from(root.querySelectorAll('rect[stroke="var(--text-color)"]'))
              .map(e => ({ e, r: e.getBoundingClientRect() }))
              .filter(b => b.r.width > 4 && b.r.height > 4 && b.r.width < 600 && b.r.x > 0 && !(b.e.getAttribute('fill') || '').startsWith('var(')
                && b.e.getAttribute('fill') !== '#ffffff');
            const horizontal = bars.length > 1 && Math.abs(bars[0].r.x - bars[1].r.x) < 2;
            const out = {};
            for (const t of root.querySelectorAll('svg text')) {
              const label = t.textContent.trim();
              if (!labels.includes(label)) continue;
              const tr = t.getBoundingClientRect();
              const cx = tr.x + tr.width / 2, cy = tr.y + tr.height / 2;
              const hit = bars.find(b => horizontal
                ? cy >= b.r.y && cy <= b.r.y + b.r.height
                : cx >= b.r.x && cx <= b.r.x + b.r.width);
              if (hit) out[label] = { fill: getComputedStyle(hit.e).fill, x: hit.r.x, y: hit.r.y, w: hit.r.width, h: hit.r.height };
            }
            return out;
        }""",
        [section, labels],
    )


def compare(page, section: str, phase: str, dots: dict[str, str], skip: str = "") -> dict[str, dict]:
    fills = bar_fills(page, section, list(dots.keys()))
    check(f"{section} [{phase}]: every label maps to a bar", len(fills) == len(dots), f"{len(fills)}/{len(dots)}")
    bad = [f"{k}: bar {v['fill']} != dot {dots[k]}" for k, v in fills.items() if k != skip and v["fill"] != dots[k]]
    check(f"{section} [{phase}]: bar fills match table dots", not bad, "; ".join(bad[:4]))
    return fills


def run(page) -> None:
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)

    for section in ("bar-chart", "bands-chart"):
        page.locator(f"#{section}").scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        dots = table_dots(page, section)
        check(f"{section}: table has color dots", len(dots) > 2 and all(dots.values()), str(len(dots)))
        compare(page, section, "sort=order", dots)
        set_sort(page, section, "value")
        compare(page, section, "sort=value", table_dots(page, section))
        set_sort(page, section, "index")

    section = "bar-chart"
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(800)
    page.locator(f"#{section}").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    dots = table_dots(page, section)
    before = compare(page, section, "pre-drag", dots)
    jan, feb = before["Jan"], before["Feb"]
    step = feb["x"] - jan["x"]
    x, y = jan["x"] + jan["w"] / 2, jan["y"] + jan["h"] * 0.75
    page.mouse.move(x, y)
    page.mouse.down()
    for i in range(1, 13):
        page.mouse.move(x + step * 2.2 * i / 12, y)
        page.wait_for_timeout(30)
    page.wait_for_timeout(500)
    # Jan is the dragged bar: hovered, then focused (white) after drop, so it
    # is excluded from the color checks below; its siblings carry the signal.
    mid = bar_fills(page, section, list(dots.keys()))
    moved = [k for k in mid if k != "Jan" and before.get(k) and abs(mid[k]["x"] - before[k]["x"]) > step / 2]
    check(f"{section}: drag reorders siblings mid-gesture", len(moved) >= 1, str(moved))
    bad = [f"{k}: {before[k]['fill']} -> {v['fill']}" for k, v in mid.items() if k != "Jan" and k in before and v["fill"] != before[k]["fill"]]
    check(f"{section}: labels keep color mid-drag", not bad, "; ".join(bad[:4]))
    page.mouse.up()
    page.wait_for_timeout(900)
    after = bar_fills(page, section, list(dots.keys()))
    order = sorted(after, key=lambda k: after[k]["x"])
    check(f"{section}: drag committed a new order", order[0] != "Jan", str(order[:4]))
    bad = [f"{k}: {before[k]['fill']} -> {v['fill']}" for k, v in after.items() if k != "Jan" and k in before and v["fill"] != before[k]["fill"]]
    check(f"{section}: labels keep color after drop", not bad, "; ".join(bad[:4]))
    compare(page, section, "post-drag", table_dots(page, section), skip="Jan")


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
