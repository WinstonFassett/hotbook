#!/usr/bin/env python3
"""
Test WIN-257 fix: verify that icicle divider drag and treemap wheel edit
don't freeze when sort:value is active.
"""

from playwright.sync_api import sync_playwright
import time

def test_gesture_freezing():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the demos page
        base_url = 'https://deploy-preview-126--hotbook-build.netlify.app'
        print(f"Navigating to {base_url}...")
        page.goto(base_url)
        page.wait_for_load_state('networkidle')

        # Take a screenshot to see what's available
        page.screenshot(path='/tmp/demos_home.png', full_page=True)
        print("Screenshot saved to /tmp/demos_home.png")

        # Try to find links to demos or charts
        links = page.locator('a').all()
        print(f"\nFound {len(links)} links on the page:")
        for i, link in enumerate(links[:20]):  # Show first 20
            try:
                text = link.inner_text()
                href = link.get_attribute('href')
                if text or href:
                    print(f"  {i}: {text} -> {href}")
            except:
                pass

        # Look for the demos page or icicle/treemap
        demos_link = page.locator('a:has-text("demos")').first
        if demos_link.count() > 0:
            print("\nFound demos link, clicking...")
            demos_link.click()
            page.wait_for_load_state('networkidle')
            page.screenshot(path='/tmp/demos_page.png', full_page=True)
            print("Demos page screenshot saved to /tmp/demos_page.png")

        # Look for chart elements
        print("\nLooking for chart elements...")

        # Check for custom elements that might be charts
        icicle_elements = page.locator('[is="v-br-icicle"], md-icicle-lc, [class*="icicle"]').all()
        treemap_elements = page.locator('[is="v-br-treemap"], md-treemap-lc, [class*="treemap"]').all()

        print(f"Found {len(icicle_elements)} icicle elements")
        print(f"Found {len(treemap_elements)} treemap elements")

        # Check page content for clues
        content = page.content()
        if 'icicle' in content.lower():
            print("Page contains 'icicle' text")
        if 'treemap' in content.lower():
            print("Page contains 'treemap' text")
        if 'sort' in content.lower():
            print("Page contains 'sort' text")

        # Try to find any controls or settings
        buttons = page.locator('button').all()
        print(f"\nFound {len(buttons)} buttons:")
        for i, btn in enumerate(buttons[:10]):
            try:
                text = btn.inner_text()
                if text:
                    print(f"  {i}: {text}")
            except:
                pass

        # Check for sort controls
        sort_controls = page.locator('select, [role="combobox"], [name*="sort"]').all()
        print(f"\nFound {len(sort_controls)} sort-related controls")

        browser.close()
        print("\n✓ Reconnaissance complete")

if __name__ == '__main__':
    test_gesture_freezing()
