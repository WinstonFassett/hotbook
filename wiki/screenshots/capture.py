"""
Retake all 6 viz-mode screenshots from the live fiddleviz deploy.

Usage:
    python3 docs/screenshots/capture.py

Requirements:
    pip install playwright
    python3 -m playwright install chromium
"""

from playwright.sync_api import sync_playwright
from pathlib import Path

OUT = Path(__file__).parent

FLAT_MODES = [
    ('treemap', 'treemap'),
    ('radial',  'radial'),
    ('bands',   'bands'),
]
HIER_MODES = [
    ('h-treemap', 'tree'),
    ('h-icicle',  'icicle'),
    ('h-radial',  'sunburst'),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 720})
    page.goto('https://fiddleviz-build.netlify.app')
    page.wait_for_load_state('networkidle')

    for _ in range(4):
        page.get_by_text('+ Add row').click()
        page.wait_for_timeout(150)
    page.wait_for_timeout(400)

    # Flat modes — no grouping
    for filename, btn_label in FLAT_MODES:
        page.get_by_role('button', name=btn_label, exact=True).click()
        page.wait_for_timeout(600)
        page.screenshot(path=OUT / f'{filename}.png')
        print(f'saved {filename}.png')

    # Hierarchical modes — enable grouping first
    page.get_by_label('group by').check()
    page.wait_for_timeout(300)

    for filename, btn_label in HIER_MODES:
        page.get_by_role('button', name=btn_label, exact=True).click()
        page.wait_for_timeout(600)
        page.screenshot(path=OUT / f'{filename}.png')
        print(f'saved {filename}.png')

    browser.close()
