"""Debug: click bar rect in shadow DOM to select it, then wheel."""
import time
from playwright.sync_api import sync_playwright

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto('http://localhost:5199')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)

        # Find bar rects in shadow DOM
        rects = page.locator('v-br-bar >>> svg rect')
        count = rects.count()
        print(f"Found {count} rects")

        # rect[2] is bar[1] (B=30) based on bounding boxes
        # Click it to select
        bar1 = rects.nth(2)
        box = bar1.bounding_box()
        print(f"Clicking bar[1] at {box}")
        bar1.click()
        time.sleep(0.3)

        # Now try synthetic pinch wheel
        result = page.evaluate("window.__test.pinchWheel(-3)")
        vals = page.evaluate("window.__test.getValues()")
        print(f"After click + 1 wheel (prevented={result}): {vals}")

        # Try real mouse wheel with Control held
        page.keyboard.down('Control')
        time.sleep(0.1)
        # Move mouse over the bar first
        page.mouse.move(box['x'] + box['width']/2, box['y'] + box['height']/2)
        time.sleep(0.1)
        page.mouse.wheel(0, -5)
        time.sleep(0.1)
        vals = page.evaluate("window.__test.getValues()")
        print(f"After real ctrl+wheel: {vals}")
        page.keyboard.up('Control')

        # Try clicking on the host element directly at bar coordinates
        chart_rect = page.evaluate("window.__test.getChartRect()")
        # Bar[1] center in host coords: x=205+37=242, y=361+75=436
        cx = chart_rect['x'] + 242
        cy = chart_rect['y'] + 200  # middle of chart
        print(f"Clicking host at ({cx}, {cy})")
        page.mouse.click(cx, cy)
        time.sleep(0.2)
        vals = page.evaluate("window.__test.getValues()")
        print(f"After host click: {vals}")

        # Now wheel
        page.keyboard.down('Control')
        page.mouse.wheel(0, -5)
        time.sleep(0.1)
        vals = page.evaluate("window.__test.getValues()")
        print(f"After host click + ctrl+wheel: {vals}")
        page.keyboard.up('Control')

        browser.close()

if __name__ == "__main__":
    main()
