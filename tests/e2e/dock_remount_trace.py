"""Trace dock tree root ID across a wheel edit."""
import time
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

        # Get dock tree root ID before
        before = page.evaluate("""(() => {
            const dv = document.querySelector('sb-dock-view');
            const root = dv.firstElementChild;
            const dock = dv._dockCell?.value;
            return {
                rootId: root?.dataset.splitId ?? root?.dataset.groupId,
                rootTag: root?.tagName,
                dockId: dock?.id,
                dockKind: dock?.kind,
            };
        })()""")
        print("Before:", before)

        # Do a wheel edit on scatter
        sc = page.evaluate("""(() => {
            const sc = document.querySelector('v-br-scatter');
            const svg = sc?.shadowRoot?.querySelector('svg');
            const c = svg?.querySelectorAll('circle')[0];
            if (!c) return null;
            const r = c.getBoundingClientRect();
            return { x: r.left + r.width/2, y: r.top + r.height/2 };
        })()""")
        if sc:
            page.mouse.move(sc['x'], sc['y'])
            time.sleep(0.2)
            page.keyboard.down('Control')
            time.sleep(0.05)
            page.mouse.wheel(0, -5)
            time.sleep(0.1)
            page.keyboard.up('Control')
            time.sleep(1)

        after = page.evaluate("""(() => {
            const dv = document.querySelector('sb-dock-view');
            const root = dv.firstElementChild;
            const dock = dv._dockCell?.value;
            return {
                rootId: root?.dataset.splitId ?? root?.dataset.groupId,
                rootTag: root?.tagName,
                dockId: dock?.id,
                dockKind: dock?.kind,
            };
        })()""")
        print("After:", after)
        print(f"Root changed: {before['rootId'] != after['rootId']}")
        print(f"Dock changed: {before['dockId'] != after['dockId']}")

        print(f"\nErrors: {len(errors)}")
        for e in errors[:3]:
            print(f"  {e[:150]}")

        browser.close()

if __name__ == "__main__":
    main()
