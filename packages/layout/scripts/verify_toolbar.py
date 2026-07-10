"""Verify the shared toolbar mutates data and every tab re-renders."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(color_scheme="dark", viewport={"width": 1100, "height": 900})
    page = ctx.new_page()
    msgs = []
    page.on("pageerror", lambda e: msgs.append(("pageerror", str(e))))
    page.on("console", lambda m: msgs.append((m.type, m.text)) if m.type in ("error","warning") else None)

    page.goto("http://localhost:5601/")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(400)

    # Toolbar should be visible regardless of tab
    btn = page.locator('button[data-act="add-node"]').first
    assert btn.is_visible(), "toolbar missing on initial load"

    # Read initial status
    status = page.locator('.shared-controls .status').inner_text()
    print(f"initial: {status}")

    # Click each action and verify status changes
    for act in ["add-node", "add-container", "add-edge", "reparent",
                "rm-container", "rm-edge", "rm-node"]:
        page.click(f'button[data-act="{act}"]')
        page.wait_for_timeout(300)
        s = page.locator('.shared-controls .status').inner_text()
        print(f"after {act}: {s}")

    # Switch to each tab and confirm the toolbar still works
    for sid in ("spike3","spike4","spike2"):
        page.click(f"#btn-{sid}")
        page.wait_for_timeout(800)
        before = page.locator('.shared-controls .status').inner_text()
        page.click('button[data-act="add-node"]')
        page.wait_for_timeout(500)
        after = page.locator('.shared-controls .status').inner_text()
        ok = before != after
        print(f"{sid} reactive: {before!r} -> {after!r}  {'OK' if ok else 'BROKEN'}")
        page.screenshot(path=f"/tmp/{sid}_after_mutate.png", full_page=True)

    print("\n--- console ---")
    for kind, txt in msgs:
        print(f"  {kind}: {txt[:200]}")

    browser.close()
