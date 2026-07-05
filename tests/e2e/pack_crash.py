"""Quick test: does pack crash on this commit?"""
import time, sys
from playwright.sync_api import sync_playwright

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.goto('http://localhost:5198/')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(3000)

        # Try dragging a scatter circle
        circles = page.locator('v-br-scatter >>> svg circle')
        count = circles.count()
        print(f"Scatter circles: {count}")
        if count > 0:
            box = circles.nth(0).bounding_box()
            cx, cy = box['x'] + box['width']/2, box['y'] + box['height']/2
            page.mouse.move(cx, cy)
            page.mouse.down()
            page.mouse.move(cx, cy + 80, steps=10)
            time.sleep(0.5)
            page.mouse.up()
            time.sleep(1)

        pack_ok = page.evaluate("""(() => {
            const pack = document.querySelector('v-br-pack');
            if (!pack) return 'no pack';
            const svg = pack.shadowRoot?.querySelector('svg');
            return svg ? `ok, ${svg.querySelectorAll('circle').length} circles` : 'no svg';
        })()""")
        print(f"Pack: {pack_ok}")
        print(f"Errors: {len(errors)}")
        for e in errors[:5]:
            print(f"  {e[:120]}")
        browser.close()
        sys.exit(1 if errors else 0)

if __name__ == "__main__":
    main()
