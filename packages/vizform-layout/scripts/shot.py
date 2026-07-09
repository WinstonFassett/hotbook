"""Screenshot every spike tab in dark mode. Uses click(), not hash-nav,
so the SPA actually re-mounts between tabs."""
from playwright.sync_api import sync_playwright

TABS = [
    ("spike1", "btn-spike1"),
    ("spike3", "btn-spike3"),
    ("spike4", "btn-spike4"),
    ("spike2", "btn-spike2"),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(color_scheme="dark", viewport={"width": 1100, "height": 900})
    page = ctx.new_page()
    msgs = []
    page.on("pageerror", lambda e: msgs.append(("pageerror", str(e))))
    page.on("console", lambda m: msgs.append((m.type, m.text)) if m.type in ("error", "warning") else None)

    page.goto("http://localhost:5601/")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(400)

    for sid, btn_id in TABS:
        page.click(f"#{btn_id}")
        page.wait_for_timeout(1200)
        page.screenshot(path=f"/tmp/{sid}.png", full_page=True)
        print(f"--- {sid} ---")
        for kind, txt in msgs:
            print(f"  {kind}: {txt[:240]}")
        msgs.clear()
    browser.close()
