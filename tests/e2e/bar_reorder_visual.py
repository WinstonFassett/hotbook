"""Verify bar reorder: visual positions + value preservation.

After reorder, DOM order may differ from visual order because
raiseAndElevate() moves the dragged element to the end of the DOM.
The bars use cur = findIndex(d.id) for positioning, so visual order
should match data order even if DOM order doesn't.
"""
from playwright.sync_api import sync_playwright

URL = "http://hotbook-demos.localhost:1355"

def read_bars_visual(page):
    """Read bars sorted by visual x-position (left to right)."""
    bar = page.locator("v-bar-chart").first
    els = bar.locator("[data-id][data-focusable='bar']").all()
    result = []
    for el in els:
        did = el.get_attribute("data-id")
        label = el.get_attribute("aria-label") or ""
        # Get the rect's x attribute (SVG coordinate = visual position)
        rect = el.locator("rect").first
        x = float(rect.get_attribute("x") or "0")
        result.append({"id": did, "label": label, "x": x})
    # Sort by x position (left to right)
    result.sort(key=lambda b: b["x"])
    return result

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    page.goto(URL, wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(2000)

    initial = read_bars_visual(page)
    print(f"Initial (visual order):")
    for b in initial[:6]:
        print(f"  {b['id']}: x={b['x']:.0f}  {b['label']}")

    # Drag Mar (index 2) to Jan (index 0) position
    bar = page.locator("v-bar-chart").first
    bars = bar.locator("[data-id][data-focusable='bar']").all()
    third_rect = bars[2].locator("rect").first
    first_rect = bars[0].locator("rect").first

    bars[2].scroll_into_view_if_needed()
    page.wait_for_timeout(500)

    third_box = third_rect.bounding_box()
    first_box = first_rect.bounding_box()
    sx = third_box["x"] + third_box["width"] / 2
    sy = third_box["y"] + third_box["height"] / 2
    tx = first_box["x"] + first_box["width"] / 2
    ty = first_box["y"] + first_box["height"] / 2

    print(f"\nDragging Mar from ({sx:.0f},{sy:.0f}) to Jan position ({tx:.0f},{ty:.0f})")

    page.mouse.move(sx, sy)
    page.mouse.down()
    page.wait_for_timeout(200)
    for i in range(1, 21):
        page.mouse.move(sx + (tx - sx) * i / 20, sy + (ty - sy) * i / 20)
        page.wait_for_timeout(40)
    page.wait_for_timeout(300)
    page.mouse.up()
    page.wait_for_timeout(3000)

    after = read_bars_visual(page)
    print(f"\nAfter reorder (visual order):")
    for b in after[:6]:
        print(f"  {b['id']}: x={b['x']:.0f}  {b['label']}")

    # Verify: Mar should be first visually
    passed = True
    if after[0]["id"] != "Mar":
        print(f"\nFAIL: first visual bar is '{after[0]['id']}', expected 'Mar'")
        passed = False
    else:
        print(f"\nPASS: Mar is first visually")

    # Verify: values preserved (no corruption)
    init_map = {b["id"]: b["label"] for b in initial}
    for b in after:
        orig = init_map.get(b["id"])
        if orig != b["label"]:
            print(f"FAIL: VALUE CORRUPTION — {b['id']}: was '{orig}', now '{b['label']}'")
            passed = False

    if passed:
        print("PASS: reorder correct + values preserved")

    browser.close()
