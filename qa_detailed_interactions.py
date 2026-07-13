#!/usr/bin/env python3
"""
Detailed interaction testing for hotbook demos
Focus on Winston's specific concerns: gestures, sort freezing, handle stability, transitions
"""

from playwright.sync_api import sync_playwright
import json
import time
from pathlib import Path

OUTPUT_DIR = Path("dogfood-output")
SCREENSHOTS_DIR = OUTPUT_DIR / "screenshots"
DETAILED_DIR = SCREENSHOTS_DIR / "detailed"
DETAILED_DIR.mkdir(parents=True, exist_ok=True)

issues = []
test_counter = 0

def save_screenshot(page, name, subdir="detailed"):
    """Save a screenshot"""
    global test_counter
    test_counter += 1
    if subdir:
        path = SCREENSHOTS_DIR / subdir / f"{test_counter:03d}_{name}.png"
    else:
        path = SCREENSHOTS_DIR / f"{test_counter:03d}_{name}.png"
    page.screenshot(path=str(path), full_page=False)
    return str(path)

def log_issue(severity, category, title, description, url, screenshot_paths=None, console_errors=None, steps=None, expected=None, actual=None):
    """Log an issue"""
    issue = {
        'severity': severity,
        'category': category,
        'title': title,
        'description': description,
        'url': url,
        'screenshots': screenshot_paths or [],
        'console_errors': console_errors or [],
        'steps': steps or [],
        'expected': expected,
        'actual': actual
    }
    issues.append(issue)
    print(f"[{severity}] {title}")
    return issue

def test_chart_sort_during_drag(page, chart_name, url):
    """
    Test if sort order freezes during drag gestures (Winston's concern #1)
    """
    print(f"\n=== Testing sort behavior during drag on {chart_name} ===")

    console_errors = []
    page.on('console', lambda msg: console_errors.append({'type': msg.type, 'text': msg.text}) if msg.type in ['error', 'warning'] else None)

    # Find the chart section
    try:
        chart_heading = page.locator(f'h2:has-text("{chart_name}"), h3:has-text("{chart_name}")').first
        if not chart_heading.is_visible(timeout=1000):
            return

        chart_heading.scroll_into_view_if_needed()
        time.sleep(0.5)

        # Take before screenshot
        before_shot = save_screenshot(page, f"{chart_name}_sort_test_before")

        # Look for sort controls
        section = page.locator(f'section:has(h2:has-text("{chart_name}"))').first
        if not section.is_visible(timeout=500):
            section = page.locator(f'section:has(h3:has-text("{chart_name}"))').first

        # Find sort button
        sort_button = section.locator('button:has-text("sort")').first
        if sort_button.is_visible(timeout=500):
            print(f"  - Found sort button for {chart_name}")
            sort_button.click()
            time.sleep(0.3)
            after_sort_shot = save_screenshot(page, f"{chart_name}_after_sort")

            # Now try dragging
            svg = section.locator('svg').first
            if svg.is_visible():
                bbox = svg.bounding_box()
                if bbox:
                    # Start a drag
                    start_x = bbox['x'] + bbox['width'] * 0.3
                    start_y = bbox['y'] + bbox['height'] * 0.3

                    page.mouse.move(start_x, start_y)
                    page.mouse.down()

                    # Take screenshot during drag
                    during_drag_shot = save_screenshot(page, f"{chart_name}_during_drag")

                    # Move slowly
                    for i in range(5):
                        page.mouse.move(start_x + i * 10, start_y)
                        time.sleep(0.05)

                    page.mouse.up()
                    time.sleep(0.3)

                    after_drag_shot = save_screenshot(page, f"{chart_name}_after_drag")

                    # Check console for errors
                    if console_errors:
                        log_issue(
                            severity='High',
                            category='Functional',
                            title=f'{chart_name}: Console errors during drag interaction',
                            description=f'Console errors occurred while testing drag on {chart_name}',
                            url=url,
                            screenshot_paths=[before_shot, during_drag_shot, after_drag_shot],
                            console_errors=console_errors,
                            steps=[
                                f'Navigate to {chart_name}',
                                'Click sort button',
                                'Attempt drag gesture',
                                'Observe console errors'
                            ]
                        )

    except Exception as e:
        print(f"  - Error testing {chart_name}: {e}")

def test_value_handle_drag(page, chart_name, url):
    """
    Test value handle drags and stability (Winston's concern - handles jumping/duplicating)
    """
    print(f"\n=== Testing value handle drag on {chart_name} ===")

    console_errors = []
    page.on('console', lambda msg: console_errors.append({'type': msg.type, 'text': msg.text}) if msg.type in ['error', 'warning'] else None)

    try:
        chart_heading = page.locator(f'h2:has-text("{chart_name}"), h3:has-text("{chart_name}")').first
        if not chart_heading.is_visible(timeout=1000):
            return

        chart_heading.scroll_into_view_if_needed()
        time.sleep(0.5)

        before_shot = save_screenshot(page, f"{chart_name}_handle_test_before")

        # Try to find value input or handle
        section = page.locator(f'section:has(h2:has-text("{chart_name}")), section:has(h3:has-text("{chart_name}"))').first

        # Look for input controls
        inputs = section.locator('input[type="range"], input[type="number"]').all()
        if inputs:
            print(f"  - Found {len(inputs)} value inputs")

            # Try changing a value
            first_input = inputs[0]
            if first_input.is_visible():
                original_value = first_input.input_value()
                print(f"    • Original value: {original_value}")

                # Change value
                first_input.fill("50")
                time.sleep(0.3)

                after_change_shot = save_screenshot(page, f"{chart_name}_handle_after_change")

                if console_errors:
                    log_issue(
                        severity='Medium',
                        category='Functional',
                        title=f'{chart_name}: Console errors during value change',
                        description=f'Console errors when changing value input on {chart_name}',
                        url=url,
                        screenshot_paths=[before_shot, after_change_shot],
                        console_errors=console_errors
                    )

        # Also test direct SVG handle dragging
        svg = section.locator('svg').first
        if svg.is_visible():
            # Look for circles (common handle element)
            circles = svg.locator('circle').all()
            if circles:
                print(f"  - Found {len(circles)} circle elements (potential handles)")

                # Try to drag one
                if len(circles) > 0:
                    first_circle = circles[0]
                    bbox = first_circle.bounding_box()
                    if bbox:
                        print(f"    • Attempting to drag handle at ({bbox['x']}, {bbox['y']})")

                        page.mouse.move(bbox['x'] + bbox['width']/2, bbox['y'] + bbox['height']/2)
                        page.mouse.down()

                        during_drag_shot = save_screenshot(page, f"{chart_name}_handle_dragging")

                        # Drag slowly
                        for i in range(5):
                            page.mouse.move(bbox['x'] + bbox['width']/2 + i*5, bbox['y'] + bbox['height']/2)
                            time.sleep(0.05)

                        page.mouse.up()
                        time.sleep(0.3)

                        after_drag_shot = save_screenshot(page, f"{chart_name}_handle_after_drag")

                        # Check if handles duplicated or jumped
                        circles_after = svg.locator('circle').all()
                        if len(circles_after) != len(circles):
                            log_issue(
                                severity='High',
                                category='Visual',
                                title=f'{chart_name}: Handle count changed during drag',
                                description=f'Handle count changed from {len(circles)} to {len(circles_after)} during drag operation',
                                url=url,
                                screenshot_paths=[before_shot, during_drag_shot, after_drag_shot],
                                expected=f'{len(circles)} handles',
                                actual=f'{len(circles_after)} handles after drag'
                            )

                        if console_errors:
                            log_issue(
                                severity='High',
                                category='Functional',
                                title=f'{chart_name}: Console errors during handle drag',
                                description=f'Console errors occurred during handle drag on {chart_name}',
                                url=url,
                                screenshot_paths=[before_shot, during_drag_shot, after_drag_shot],
                                console_errors=console_errors
                            )

    except Exception as e:
        print(f"  - Error testing handles on {chart_name}: {e}")

def test_wheel_gesture(page, chart_name, url):
    """
    Test wheel/scroll gestures and sort behavior (Winston's concern)
    """
    print(f"\n=== Testing wheel gesture on {chart_name} ===")

    console_errors = []
    page.on('console', lambda msg: console_errors.append({'type': msg.type, 'text': msg.text}) if msg.type in ['error', 'warning'] else None)

    try:
        chart_heading = page.locator(f'h2:has-text("{chart_name}"), h3:has-text("{chart_name}")').first
        if not chart_heading.is_visible(timeout=1000):
            return

        chart_heading.scroll_into_view_if_needed()
        time.sleep(0.5)

        before_shot = save_screenshot(page, f"{chart_name}_wheel_before")

        section = page.locator(f'section:has(h2:has-text("{chart_name}")), section:has(h3:has-text("{chart_name}"))').first
        svg = section.locator('svg').first

        if svg.is_visible():
            bbox = svg.bounding_box()
            if bbox:
                center_x = bbox['x'] + bbox['width'] / 2
                center_y = bbox['y'] + bbox['height'] / 2

                # Simulate wheel event
                page.mouse.move(center_x, center_y)
                page.mouse.wheel(0, 100)  # Scroll down
                time.sleep(0.3)

                after_wheel_shot = save_screenshot(page, f"{chart_name}_after_wheel")

                if console_errors:
                    log_issue(
                        severity='Medium',
                        category='Functional',
                        title=f'{chart_name}: Console errors during wheel gesture',
                        description=f'Console errors occurred during wheel/scroll gesture on {chart_name}',
                        url=url,
                        screenshot_paths=[before_shot, after_wheel_shot],
                        console_errors=console_errors
                    )

    except Exception as e:
        print(f"  - Error testing wheel on {chart_name}: {e}")

def test_toolbar_controls(page, url):
    """
    Test toolbar layouts and config controls (Winston's concern)
    """
    print(f"\n=== Testing toolbar and config controls ===")

    # Look for all control sections
    sections = page.locator('section').all()
    print(f"  - Found {len(sections)} sections")

    control_issues = []

    for i, section in enumerate(sections[:10]):  # Test first 10
        try:
            # Check for buttons within section
            buttons = section.locator('button').all()
            if buttons:
                # Try clicking each button
                for j, button in enumerate(buttons[:3]):  # First 3 buttons per section
                    if button.is_visible():
                        try:
                            text = button.text_content() or f"button_{j}"
                            before = save_screenshot(page, f"section_{i}_button_{j}_before")
                            button.click()
                            time.sleep(0.2)
                            after = save_screenshot(page, f"section_{i}_button_{j}_after")
                            print(f"    • Section {i}, clicked button: {text}")
                        except Exception as e:
                            control_issues.append(f"Section {i}, button {j}: {str(e)}")
        except Exception as e:
            print(f"  - Error testing section {i}: {e}")

    if control_issues:
        log_issue(
            severity='Medium',
            category='UX',
            title='Control interaction issues',
            description=f'Found {len(control_issues)} control interaction issues',
            url=url,
            steps=['Click various toolbar buttons', 'Observe errors']
        )

def test_transitions_and_animations(page, chart_name, url):
    """
    Test enter/exit/drill transitions (Winston's concern)
    """
    print(f"\n=== Testing transitions on {chart_name} ===")

    console_errors = []
    page.on('console', lambda msg: console_errors.append({'type': msg.type, 'text': msg.text}) if msg.type in ['error', 'warning'] else None)

    try:
        chart_heading = page.locator(f'h2:has-text("{chart_name}"), h3:has-text("{chart_name}")').first
        if not chart_heading.is_visible(timeout=1000):
            return

        chart_heading.scroll_into_view_if_needed()
        time.sleep(0.5)

        before_shot = save_screenshot(page, f"{chart_name}_transition_before")

        section = page.locator(f'section:has(h2:has-text("{chart_name}")), section:has(h3:has-text("{chart_name}"))').first
        svg = section.locator('svg').first

        if svg.is_visible():
            # Try clicking to drill down (hierarchical charts support this)
            bbox = svg.bounding_box()
            if bbox:
                # Click in chart
                page.mouse.click(bbox['x'] + bbox['width'] * 0.4, bbox['y'] + bbox['height'] * 0.4)
                time.sleep(0.5)

                during_transition = save_screenshot(page, f"{chart_name}_during_transition")

                time.sleep(0.5)
                after_transition = save_screenshot(page, f"{chart_name}_after_transition")

                if console_errors:
                    log_issue(
                        severity='Medium',
                        category='Visual',
                        title=f'{chart_name}: Console errors during transition',
                        description=f'Console errors during drill/transition animation on {chart_name}',
                        url=url,
                        screenshot_paths=[before_shot, during_transition, after_transition],
                        console_errors=console_errors
                    )

    except Exception as e:
        print(f"  - Error testing transitions on {chart_name}: {e}")

def append_to_report(new_issues):
    """Append new findings to the existing report"""
    report_path = OUTPUT_DIR / "report.md"

    if not report_path.exists():
        # Create new report
        with open(report_path, 'w') as f:
            f.write("# Hotbook Demos - Detailed Interaction QA Report\n\n")

    # Append new issues
    with open(report_path, 'a') as f:
        f.write(f"\n## Detailed Interaction Testing ({time.strftime('%Y-%m-%d %H:%M:%S')})\n\n")
        f.write(f"**New issues found**: {len(new_issues)}\n\n")

        for i, issue in enumerate(new_issues, 1):
            f.write(f"### Issue: {issue['title']}\n\n")
            f.write(f"**Severity**: {issue['severity']}  \n")
            f.write(f"**Category**: {issue['category']}  \n")
            f.write(f"**URL**: `{issue['url']}`\n\n")
            f.write(f"**Description**: {issue['description']}\n\n")

            if issue['expected']:
                f.write(f"**Expected**: {issue['expected']}  \n")
            if issue['actual']:
                f.write(f"**Actual**: {issue['actual']}\n\n")

            if issue['steps']:
                f.write("**Steps to Reproduce**:\n")
                for step in issue['steps']:
                    f.write(f"1. {step}\n")
                f.write("\n")

            if issue['screenshots']:
                f.write("**Screenshots**:\n")
                for screenshot in issue['screenshots']:
                    f.write(f"- `{screenshot}`\n")
                    f.write(f"  ![Screenshot]({screenshot})\n")
                f.write("\n")

            if issue['console_errors']:
                f.write("**Console Errors**:\n```\n")
                for error in issue['console_errors'][:10]:
                    f.write(f"[{error['type']}] {error['text']}\n")
                f.write("```\n\n")

            f.write("---\n\n")

def main():
    url = "http://127.0.0.1:4816/demos/"

    # Charts to test based on Winston's priorities
    hierarchical_charts = ['treemap', 'icicle', 'sunburst', 'pack']

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        try:
            page.goto(url)
            page.wait_for_load_state('networkidle')
            time.sleep(1)

            print("=" * 60)
            print("DETAILED INTERACTION TESTING")
            print("=" * 60)

            # Test each hierarchical chart for all concerns
            for chart in hierarchical_charts:
                test_chart_sort_during_drag(page, chart, url)
                test_value_handle_drag(page, chart, url)
                test_wheel_gesture(page, chart, url)
                test_transitions_and_animations(page, chart, url)

            # Test toolbar/controls
            page.goto(url)  # Reset to top
            page.wait_for_load_state('networkidle')
            test_toolbar_controls(page, url)

        except Exception as e:
            print(f"Error during detailed testing: {e}")
            log_issue(
                severity='Critical',
                category='Functional',
                title='Detailed test execution error',
                description=f'Testing failed: {str(e)}',
                url=url
            )

        finally:
            browser.close()

    # Append findings to report
    append_to_report(issues)

    print(f"\n{'='*60}")
    print(f"Detailed Testing Complete!")
    print(f"New issues found: {len(issues)}")
    print(f"Screenshots: {DETAILED_DIR}")
    print(f"Report updated: {OUTPUT_DIR / 'report.md'}")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    main()
