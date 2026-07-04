"""Playwright test: wheel controller pinch + Esc behavior."""
import time
from playwright.sync_api import sync_playwright

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto('http://localhost:5199/unit-test.html')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(500)

        # Run tests
        page.evaluate("window.__runTests()")

        # Wait for async tests to complete (sleep 250ms in test)
        page.wait_for_timeout(2000)

        # Get output text
        output = page.inner_text('#output')
        print(output)

        # Get pass/fail count
        results = page.evaluate("window.__getResults()")
        passed = sum(results)
        total = len(results)

        browser.close()

        if passed < total:
            print(f"\n{total - passed} TESTS FAILED")
            exit(1)
        else:
            print(f"\nALL {total} TESTS PASSED")
            exit(0)

if __name__ == "__main__":
    main()
