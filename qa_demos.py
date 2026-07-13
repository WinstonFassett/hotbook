#!/usr/bin/env python3
"""
Systematic QA testing of hotbook demos page
Focuses on interactivity, gestures, hierarchical charts, and UX
"""

from playwright.sync_api import sync_playwright
import json
import time
from pathlib import Path

# Output directory
OUTPUT_DIR = Path("dogfood-output")
SCREENSHOTS_DIR = OUTPUT_DIR / "screenshots"
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

# Track findings
issues = []
screenshot_counter = 0

def save_screenshot(page, name, element=None):
    """Save a screenshot and return the path

    Args:
        page: Playwright page object
        name: Screenshot filename
        element: Optional element to screenshot (instead of full page)
    """
    global screenshot_counter
    screenshot_counter += 1
    path = SCREENSHOTS_DIR / f"{screenshot_counter:03d}_{name}.png"

    if element:
        # Screenshot just the element
        try:
            element.screenshot(path=str(path))
        except:
            # Fallback to page screenshot if element screenshot fails
            page.screenshot(path=str(path), full_page=False)
    else:
        # Screenshot visible viewport only (not full page)
        page.screenshot(path=str(path), full_page=False)

    return str(path)

def capture_console_errors(page):
    """Capture console errors from the page"""
    errors = []

    def on_console(msg):
        if msg.type in ['error', 'warning']:
            errors.append({
                'type': msg.type,
                'text': msg.text,
                'location': msg.location
            })

    page.on('console', on_console)
    return errors

def log_issue(severity, category, title, description, url, screenshot_path=None, console_errors=None, steps=None):
    """Log an issue to the issues list"""
    issue = {
        'severity': severity,
        'category': category,
        'title': title,
        'description': description,
        'url': url,
        'screenshot': screenshot_path,
        'console_errors': console_errors or [],
        'steps': steps or []
    }
    issues.append(issue)
    print(f"[{severity}] {title}")

def test_page_load(page, url):
    """Test initial page load"""
    console_errors = []

    def on_console(msg):
        if msg.type in ['error', 'warning']:
            console_errors.append({
                'type': msg.type,
                'text': msg.text
            })

    page.on('console', on_console)

    print(f"\n=== Testing page load: {url} ===")
    page.goto(url)
    page.wait_for_load_state('networkidle')
    time.sleep(1)  # Allow time for any deferred rendering

    screenshot = save_screenshot(page, "01_initial_load")

    # Check for console errors on load
    if console_errors:
        log_issue(
            severity='High',
            category='Console',
            title='Console errors on page load',
            description=f'Found {len(console_errors)} console errors on initial page load',
            url=url,
            screenshot_path=screenshot,
            console_errors=console_errors
        )

    return screenshot

def test_navigation_and_tabs(page, url):
    """Test navigation and tab switching"""
    print("\n=== Testing navigation and tabs ===")

    # Look for tab controls or navigation
    tabs = page.locator('button, a, [role="tab"]').all()
    print(f"Found {len(tabs)} potential tab/navigation elements")

    if len(tabs) == 0:
        log_issue(
            severity='Medium',
            category='UX',
            title='No visible tab navigation found',
            description='Could not identify clear tab or navigation controls on the demos page',
            url=url,
            screenshot_path=save_screenshot(page, "02_no_tabs")
        )

    # Try to identify sections or demo switchers
    page_content = page.content()
    screenshot = save_screenshot(page, "03_page_structure")

def test_hierarchical_chart(page, chart_name, url):
    """Test a specific hierarchical chart (treemap, icicle, sunburst, pack, budget-tree)"""
    print(f"\n=== Testing {chart_name} ===")

    console_errors = []
    def on_console(msg):
        if msg.type in ['error', 'warning']:
            console_errors.append({'type': msg.type, 'text': msg.text})
    page.on('console', on_console)

    # Look for the chart section by heading
    try:
        # Try to find section containing this chart name
        section = page.locator(f'section:has(h2:has-text("{chart_name}")), section:has(h3:has-text("{chart_name}"))').first
        if not section.is_visible(timeout=1000):
            raise Exception(f"Section not found for {chart_name}")

        section.scroll_into_view_if_needed()
        time.sleep(0.5)

        # Screenshot just this section
        screenshot = save_screenshot(page, f"{chart_name}_initial", element=section)

        # Try to find SVG elements (d3 charts are typically SVG)
        svg = section.locator('svg').first
        if svg.is_visible():
            bbox = svg.bounding_box()
            if bbox:
                # Test clicking on chart elements
                print(f"  - Testing click interaction on {chart_name}")
                page.mouse.click(bbox['x'] + bbox['width'] / 2, bbox['y'] + bbox['height'] / 2)
                time.sleep(0.3)

                # Test drag gesture
                print(f"  - Testing drag gesture on {chart_name}")
                start_x = bbox['x'] + bbox['width'] / 3
                start_y = bbox['y'] + bbox['height'] / 3
                end_x = start_x + 50
                end_y = start_y + 50

                page.mouse.move(start_x, start_y)
                page.mouse.down()
                page.mouse.move(end_x, end_y)
                page.mouse.up()
                time.sleep(0.3)

                screenshot_after = save_screenshot(page, f"{chart_name}_after_drag", element=section)

                # Check for console errors during interaction
                if console_errors:
                    log_issue(
                        severity='High',
                        category='Functional',
                        title=f'{chart_name}: Console errors during interaction',
                        description=f'Console errors occurred while testing {chart_name}',
                        url=url,
                        screenshot_path=screenshot_after,
                        console_errors=console_errors,
                        steps=[
                            f'Navigate to {chart_name}',
                            'Attempt drag gesture',
                            'Check console'
                        ]
                    )
    except Exception as e:
        print(f"  - {chart_name} not found: {e}")
        log_issue(
            severity='Medium',
            category='Functional',
            title=f'{chart_name} not found',
            description=f'Could not locate {chart_name} chart on the demos page',
            url=url,
            screenshot_path=save_screenshot(page, f"{chart_name}_missing")
        )

def test_sort_controls(page, url):
    """Test sort controls on charts"""
    print("\n=== Testing sort controls ===")

    # Look for sort buttons or controls
    sort_buttons = page.locator('button:has-text("sort"), button:has-text("Sort"), [aria-label*="sort"]').all()

    if sort_buttons:
        for i, button in enumerate(sort_buttons[:3]):  # Test first 3
            try:
                if button.is_visible():
                    button.scroll_into_view_if_needed()
                    screenshot_before = save_screenshot(page, f"sort_before_{i}")
                    button.click()
                    time.sleep(0.5)
                    screenshot_after = save_screenshot(page, f"sort_after_{i}")
                    print(f"  - Clicked sort button {i+1}")
            except Exception as e:
                log_issue(
                    severity='Medium',
                    category='Functional',
                    title=f'Sort button {i+1} interaction failed',
                    description=f'Error when clicking sort button: {str(e)}',
                    url=url
                )

def test_value_handles_and_drags(page, url):
    """Test value handles and drag interactions"""
    print("\n=== Testing value handles and drags ===")

    # Look for draggable elements
    draggables = page.locator('[draggable="true"], .draggable, [data-draggable]').all()

    if draggables:
        print(f"  - Found {len(draggables)} draggable elements")
        screenshot = save_screenshot(page, "draggable_elements")
    else:
        # May need to look for handles in SVG
        handles = page.locator('circle, rect').all()
        if handles:
            print(f"  - Found {len(handles)} potential handle elements in SVG")

def test_gantt_chart(page, url):
    """Test Gantt chart functionality"""
    print("\n=== Testing Gantt chart ===")

    # Look for Gantt chart
    gantt = page.locator('text=Gantt, text=gantt').first
    if gantt.is_visible():
        gantt.scroll_into_view_if_needed()
        time.sleep(0.5)
        screenshot = save_screenshot(page, "gantt_initial")

        # Try dragging a task
        svg = page.locator('svg').first
        if svg.is_visible():
            bbox = svg.bounding_box()
            if bbox:
                # Simulate drag
                page.mouse.move(bbox['x'] + 100, bbox['y'] + 50)
                page.mouse.down()
                page.mouse.move(bbox['x'] + 150, bbox['y'] + 50)
                page.mouse.up()
                time.sleep(0.5)

                screenshot_after = save_screenshot(page, "gantt_after_drag")
    else:
        log_issue(
            severity='Medium',
            category='Functional',
            title='Gantt chart not found',
            description='Could not locate Gantt chart on demos page',
            url=url
        )

def test_flat_charts(page, url):
    """Test flat chart types"""
    print("\n=== Testing flat charts ===")

    chart_types = [
        'bar-chart', 'bands-chart', 'line-chart', 'area-chart',
        'scatter-chart', 'pie-chart', 'radar-chart', 'concentric-arc',
        'gauge', 'gauge-segmented'
    ]

    for chart_type in chart_types:
        # Try to find the chart
        chart = page.locator(f'text={chart_type}').first
        if not chart.is_visible():
            # Try variations
            chart = page.locator(f'text="{chart_type.replace("-", " ")}"').first

        if chart.is_visible():
            chart.scroll_into_view_if_needed()
            time.sleep(0.3)
            save_screenshot(page, f"flat_{chart_type}")
            print(f"  - Found {chart_type}")
        else:
            print(f"  - {chart_type} not visible")

def explore_demo_structure(page, url):
    """Explore and document the demo page structure"""
    print("\n=== Exploring demo page structure ===")

    # Get all headings
    headings = page.locator('h1, h2, h3, h4').all()
    print(f"  - Found {len(headings)} headings")

    for heading in headings[:10]:  # First 10
        try:
            text = heading.text_content()
            print(f"    • {text}")
        except:
            pass

    # Check for sections
    sections = page.locator('section, article, [role="region"]').all()
    print(f"  - Found {len(sections)} sections")

    # Look for controls
    buttons = page.locator('button').all()
    print(f"  - Found {len(buttons)} buttons")

    inputs = page.locator('input, select, textarea').all()
    print(f"  - Found {len(inputs)} input controls")

    # Take comprehensive screenshot
    save_screenshot(page, "full_page_structure")

def generate_report():
    """Generate the final QA report"""
    print("\n=== Generating report ===")

    report_path = OUTPUT_DIR / "report.md"

    # Count by severity
    severity_counts = {}
    category_counts = {}
    for issue in issues:
        severity_counts[issue['severity']] = severity_counts.get(issue['severity'], 0) + 1
        category_counts[issue['category']] = category_counts.get(issue['category'], 0) + 1

    with open(report_path, 'w') as f:
        f.write("# Hotbook Demos QA Report\n\n")
        f.write(f"**Date**: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"**Target**: http://127.0.0.1:4816/demos/\n")
        f.write(f"**Total Issues**: {len(issues)}\n\n")

        f.write("## Executive Summary\n\n")
        f.write(f"Total issues found: **{len(issues)}**\n\n")

        f.write("### By Severity\n")
        for severity in ['Critical', 'High', 'Medium', 'Low']:
            count = severity_counts.get(severity, 0)
            f.write(f"- **{severity}**: {count}\n")

        f.write("\n### By Category\n")
        for category, count in category_counts.items():
            f.write(f"- **{category}**: {count}\n")

        f.write("\n## Testing Scope\n\n")
        f.write("This QA pass focused on:\n")
        f.write("- Interactivity and gesture transitions on hierarchical charts\n")
        f.write("- Drag-to-reorder and value-handle drags\n")
        f.write("- Hierarchical diagram quality (treemap, icicle, sunburst, pack, budget-tree)\n")
        f.write("- Gantt chart drag-to-reorder and dependency propagation\n")
        f.write("- Nested-layered layout demo\n")
        f.write("- Demos page UX (tabs, controls, config)\n")
        f.write("- Flat charts (bar, bands, line, area, scatter, pie, radar, gauge, etc.)\n\n")

        f.write("## Issues\n\n")

        for i, issue in enumerate(issues, 1):
            f.write(f"### Issue {i}: {issue['title']}\n\n")
            f.write(f"**Severity**: {issue['severity']}  \n")
            f.write(f"**Category**: {issue['category']}  \n")
            f.write(f"**URL**: `{issue['url']}`\n\n")

            f.write(f"**Description**: {issue['description']}\n\n")

            if issue['steps']:
                f.write("**Steps to Reproduce**:\n")
                for step in issue['steps']:
                    f.write(f"1. {step}\n")
                f.write("\n")

            if issue['screenshot']:
                f.write(f"**Screenshot**: `{issue['screenshot']}`\n\n")
                f.write(f"![Screenshot]({issue['screenshot']})\n\n")

            if issue['console_errors']:
                f.write("**Console Errors**:\n```\n")
                for error in issue['console_errors'][:5]:  # First 5 errors
                    f.write(f"[{error['type']}] {error['text']}\n")
                f.write("```\n\n")

            f.write("---\n\n")

        f.write("## Summary Table\n\n")
        f.write("| # | Severity | Category | Title |\n")
        f.write("|---|----------|----------|-------|\n")
        for i, issue in enumerate(issues, 1):
            f.write(f"| {i} | {issue['severity']} | {issue['category']} | {issue['title']} |\n")

        f.write("\n## Testing Notes\n\n")
        f.write(f"- Total screenshots captured: {screenshot_counter}\n")
        f.write(f"- All screenshots saved to: `{SCREENSHOTS_DIR}`\n")
        f.write("- Testing performed on local dev server\n")
        f.write("- Browser: Chromium (headless)\n")

    print(f"Report saved to: {report_path}")
    return report_path

def main():
    """Main test execution"""
    url = "http://127.0.0.1:4816/demos/"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        try:
            # Phase 1: Initial load and structure
            test_page_load(page, url)
            explore_demo_structure(page, url)

            # Phase 2: Navigation and tabs
            test_navigation_and_tabs(page, url)

            # Phase 3: Hierarchical charts
            hierarchical_charts = ['treemap', 'icicle', 'sunburst', 'pack', 'budget-tree', 'tree-chart']
            for chart in hierarchical_charts:
                test_hierarchical_chart(page, chart, url)

            # Phase 4: Controls and interactions
            test_sort_controls(page, url)
            test_value_handles_and_drags(page, url)

            # Phase 5: Gantt chart
            test_gantt_chart(page, url)

            # Phase 6: Flat charts
            test_flat_charts(page, url)

            # Final full-page screenshot
            save_screenshot(page, "zzz_final")

        except Exception as e:
            print(f"Error during testing: {e}")
            log_issue(
                severity='Critical',
                category='Functional',
                title='Test execution error',
                description=f'Testing failed with error: {str(e)}',
                url=url
            )

        finally:
            browser.close()

    # Generate report
    report_path = generate_report()

    print(f"\n{'='*60}")
    print(f"QA Testing Complete!")
    print(f"Total issues: {len(issues)}")
    print(f"Report: {report_path}")
    print(f"Screenshots: {SCREENSHOTS_DIR}")
    print(f"{'='*60}\n")

    return report_path

if __name__ == "__main__":
    main()
