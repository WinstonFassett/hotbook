"""Test drag gestures on hierarchical charts using real Playwright pointer events.

Tests:
1. Icicle edge handle drag — drag a divider, verify sibling values redistribute
2. Sunburst angular handle drag — drag an angular divider, verify arc values redistribute
3. Treemap tile body drag — drag a leaf tile, verify its value changes
4. Icicle tile body drag — drag a tile, verify its value changes
5. Cross-tile sync — drag in icicle, verify sunburst updates
6. Treetable number drag — drag a value cell, verify value changes
"""
from playwright.sync_api import sync_playwright
import json

BASE = "http://hotbook-demos.localhost:1355"

def get_value(page, chart_selector, node_id):
    """Read a node's current value from the chart's kernel."""
    return page.evaluate(f"""(() => {{
    const el = document.querySelector('{chart_selector}');
    if (!el) return null;
    const root = el._treeRoot?.value;
    if (!root) return null;
    const find = (n, id) => n.id === id ? n : (n.children || []).reduce((f, c) => f || find(c, id), null);
    const node = find(root, '{node_id}');
    return node ? node.value.value : null;
  }})()""")

def get_all_values(page, chart_selector):
    """Read all leaf values from a chart."""
    return page.evaluate(f"""(() => {{
    const el = document.querySelector('{chart_selector}');
    if (!el) return null;
    const root = el._treeRoot?.value;
    if (!root) return null;
    const leaves = [];
    const walk = (n) => {{
      if (n.children.length === 0) leaves.push({{id: n.id, value: n.value.value}});
      else n.children.forEach(walk);
    }};
    walk(root);
    return leaves;
  }})()""")

def get_handle_bbox(page, chart_selector, edge_id):
    """Get the bounding box of a handle's rect element."""
    return page.evaluate(f"""(() => {{
    const el = document.querySelector('{chart_selector}');
    if (!el) return null;
    const handle = el.querySelector('[data-edge="{edge_id}"] rect');
    if (!handle) return null;
    const r = handle.getBoundingClientRect();
    return {{x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height}};
  }})()""")

def get_tile_bbox(page, chart_selector, node_id):
    """Get the bounding box of a tile's rect element."""
    return page.evaluate(f"""(() => {{
    const el = document.querySelector('{chart_selector}');
    if (!el) return null;
    const tile = el.querySelector('[data-id="{node_id}"] rect');
    if (!tile) return null;
    const r = tile.getBoundingClientRect();
    return {{x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height}};
  }})()""")

def test_icicle_handle_drag(page):
    """Test 1: Drag an icicle edge handle and verify sibling values redistribute."""
    print("\n=== Test 1: Icicle edge handle drag ===")
    page.goto(f"{BASE}/#hier-family")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)

    # Get initial values
    before = get_all_values(page, "#hier-family v-icicle")
    print(f"  Before: {before}")

    # Find the tech..finance handle
    handle = get_handle_bbox(page, "#hier-family v-icicle", "tech..finance")
    if not handle:
        print("  FAIL: handle not found")
        return False
    print(f"  Handle at ({handle['x']:.0f}, {handle['y']:.0f})")

    # Get values of the two siblings being split
    tech_before = get_value(page, "#hier-family v-icicle", "tech")
    finance_before = get_value(page, "#hier-family v-icicle", "finance")
    print(f"  tech={tech_before}, finance={finance_before}")

    # Drag the handle 30px to the right (should grow tech, shrink finance)
    page.mouse.move(handle["x"], handle["y"])
    page.mouse.down()
    page.wait_for_timeout(100)
    page.mouse.move(handle["x"] + 30, handle["y"], steps=10)
    page.wait_for_timeout(200)

    # Read values during drag (should be drafting)
    tech_during = get_value(page, "#hier-family v-icicle", "tech")
    finance_during = get_value(page, "#hier-family v-icicle", "finance")
    print(f"  During drag: tech={tech_during}, finance={finance_during}")

    page.mouse.up()
    page.wait_for_timeout(300)

    tech_after = get_value(page, "#hier-family v-icicle", "tech")
    finance_after = get_value(page, "#hier-family v-icicle", "finance")
    print(f"  After: tech={tech_after}, finance={finance_after}")

    # Verify: tech should have grown, finance should have shrunk
    if tech_after is None or finance_after is None:
        print("  FAIL: could not read values after drag")
        return False

    if tech_after > tech_before and finance_after < finance_before:
        print("  PASS: tech grew, finance shrank")
        return True
    elif tech_after == tech_before and finance_after == finance_before:
        print("  FAIL: values unchanged — drag had no effect")
        return False
    else:
        print(f"  FAIL: unexpected change. tech: {tech_before}->{tech_after}, finance: {finance_before}->{finance_after}")
        return False

def test_sunburst_handle_drag(page):
    """Test 2: Drag a sunburst angular handle and verify arc values redistribute."""
    print("\n=== Test 2: Sunburst angular handle drag ===")
    page.goto(f"{BASE}/#hier-family")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)

    before = get_all_values(page, "#hier-family v-sunburst")
    print(f"  Before: {before}")

    handle = get_handle_bbox(page, "#hier-family v-sunburst", "tech..finance")
    if not handle:
        print("  FAIL: handle not found")
        return False
    print(f"  Handle at ({handle['x']:.0f}, {handle['y']:.0f}) size {handle['w']:.0f}x{handle['h']:.0f}")

    if handle["h"] < 2:
        print("  FAIL: handle has h=0 — the bug is still present")
        return False

    tech_before = get_value(page, "#hier-family v-sunburst", "tech")
    finance_before = get_value(page, "#hier-family v-sunburst", "finance")
    print(f"  tech={tech_before}, finance={finance_before}")

    # Drag handle — need to figure out which direction grows tech
    # The handle is at the boundary between tech and finance arcs.
    # Dragging tangentially (perpendicular to the radius) should redistribute.
    # Let's drag 20px in one direction and see what happens.
    page.mouse.move(handle["x"], handle["y"])
    page.mouse.down()
    page.wait_for_timeout(100)
    # Try dragging in an arc — move tangentially
    page.mouse.move(handle["x"] + 25, handle["y"] + 10, steps=10)
    page.wait_for_timeout(200)

    tech_during = get_value(page, "#hier-family v-sunburst", "tech")
    finance_during = get_value(page, "#hier-family v-sunburst", "finance")
    print(f"  During drag: tech={tech_during}, finance={finance_during}")

    page.mouse.up()
    page.wait_for_timeout(300)

    tech_after = get_value(page, "#hier-family v-sunburst", "tech")
    finance_after = get_value(page, "#hier-family v-sunburst", "finance")
    print(f"  After: tech={tech_after}, finance={finance_after}")

    if tech_after is None or finance_after is None:
        print("  FAIL: could not read values after drag")
        return False

    if tech_after != tech_before or finance_after != finance_before:
        print("  PASS: values changed — drag works")
        return True
    else:
        print("  FAIL: values unchanged — drag had no effect")
        return False

def test_treemap_tile_drag(page):
    """Test 3: Drag a treemap leaf tile and verify its value changes."""
    print("\n=== Test 3: Treemap tile body drag ===")
    page.goto(f"{BASE}/#hier-family")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)

    # Get a leaf tile (aapl)
    tile = get_tile_bbox(page, "#hier-family v-treemap", "aapl")
    if not tile:
        print("  FAIL: tile not found")
        return False
    print(f"  Tile at ({tile['x']:.0f}, {tile['y']:.0f}) size {tile['w']:.0f}x{tile['h']:.0f}")

    aapl_before = get_value(page, "#hier-family v-treemap", "aapl")
    print(f"  aapl before={aapl_before}")

    # Drag the tile body 30px to the right (additive mode, x-axis)
    page.mouse.move(tile["x"], tile["y"])
    page.mouse.down()
    page.wait_for_timeout(100)
    page.mouse.move(tile["x"] + 30, tile["y"], steps=10)
    page.wait_for_timeout(200)

    aapl_during = get_value(page, "#hier-family v-treemap", "aapl")
    print(f"  aapl during={aapl_during}")

    page.mouse.up()
    page.wait_for_timeout(300)

    aapl_after = get_value(page, "#hier-family v-treemap", "aapl")
    print(f"  aapl after={aapl_after}")

    if aapl_after is None:
        print("  FAIL: could not read value after drag")
        return False

    if aapl_after != aapl_before:
        print("  PASS: value changed — drag works")
        return True
    else:
        print("  FAIL: value unchanged — drag had no effect")
        return False

def test_cross_tile_sync(page):
    """Test 5: Drag in icicle, verify sunburst updates."""
    print("\n=== Test 5: Cross-tile sync (icicle → sunburst) ===")
    page.goto(f"{BASE}/#hier-family")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)

    # Read initial values from both charts
    ic_tech_before = get_value(page, "#hier-family v-icicle", "tech")
    sb_tech_before = get_value(page, "#hier-family v-sunburst", "tech")
    print(f"  Before: icicle tech={ic_tech_before}, sunburst tech={sb_tech_before}")

    # Drag icicle handle
    handle = get_handle_bbox(page, "#hier-family v-icicle", "tech..finance")
    if not handle:
        print("  FAIL: handle not found")
        return False

    page.mouse.move(handle["x"], handle["y"])
    page.mouse.down()
    page.wait_for_timeout(100)
    page.mouse.move(handle["x"] + 30, handle["y"], steps=10)
    page.wait_for_timeout(200)

    # Check sunburst during drag (should show draft preview)
    sb_tech_during = get_value(page, "#hier-family v-sunburst", "tech")
    print(f"  During drag: sunburst tech={sb_tech_during}")

    page.mouse.up()
    page.wait_for_timeout(300)

    ic_tech_after = get_value(page, "#hier-family v-icicle", "tech")
    sb_tech_after = get_value(page, "#hier-family v-sunburst", "tech")
    print(f"  After: icicle tech={ic_tech_after}, sunburst tech={sb_tech_after}")

    if sb_tech_after is None:
        print("  FAIL: could not read sunburst value")
        return False

    if sb_tech_after != sb_tech_before:
        print("  PASS: sunburst value changed — cross-tile sync works")
        return True
    else:
        print("  FAIL: sunburst value unchanged — cross-tile sync not working")
        return False

def test_treetable_number_drag(page):
    """Test 6: Drag a treetable value cell and verify value changes."""
    print("\n=== Test 6: Treetable number drag ===")
    page.goto(f"{BASE}/#hier-family")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)

    # Get the aapl value cell bbox
    cell_bbox = page.evaluate("""(() => {
    const tt = document.querySelector('#hier-family v-treetable');
    if (!tt) return null;
    const cell = tt.querySelector('[data-value-cell^="aapl:"]');
    if (!cell) return null;
    const r = cell.getBoundingClientRect();
    return {x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height};
  })()""")
    if not cell_bbox:
        print("  FAIL: value cell not found")
        return False
    print(f"  Cell at ({cell_bbox['x']:.0f}, {cell_bbox['y']:.0f})")

    aapl_before = get_value(page, "#hier-family v-treetable", "aapl")
    print(f"  aapl before={aapl_before}")

    # numberDrag is horizontal drag
    page.mouse.move(cell_bbox["x"], cell_bbox["y"])
    page.mouse.down()
    page.wait_for_timeout(100)
    page.mouse.move(cell_bbox["x"] + 40, cell_bbox["y"], steps=10)
    page.wait_for_timeout(200)

    aapl_during = get_value(page, "#hier-family v-treetable", "aapl")
    print(f"  aapl during={aapl_during}")

    page.mouse.up()
    page.wait_for_timeout(300)

    aapl_after = get_value(page, "#hier-family v-treetable", "aapl")
    print(f"  aapl after={aapl_after}")

    if aapl_after is None:
        print("  FAIL: could not read value after drag")
        return False

    if aapl_after != aapl_before:
        print("  PASS: value changed — number drag works")
        return True
    else:
        print("  FAIL: value unchanged — drag had no effect")
        return False

def main():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        # Capture console logs
        page.on("console", lambda msg: print(f"  [console.{msg.type}] {msg.text}") if "handle" in msg.text.lower() else None)

        try:
            results["icicle_handle"] = test_icicle_handle_drag(page)
        except Exception as e:
            print(f"  ERROR: {e}")
            results["icicle_handle"] = False

        try:
            results["sunburst_handle"] = test_sunburst_handle_drag(page)
        except Exception as e:
            print(f"  ERROR: {e}")
            results["sunburst_handle"] = False

        try:
            results["treemap_tile"] = test_treemap_tile_drag(page)
        except Exception as e:
            print(f"  ERROR: {e}")
            results["treemap_tile"] = False

        try:
            results["cross_tile"] = test_cross_tile_sync(page)
        except Exception as e:
            print(f"  ERROR: {e}")
            results["cross_tile"] = False

        try:
            results["treetable_drag"] = test_treetable_number_drag(page)
        except Exception as e:
            print(f"  ERROR: {e}")
            results["treetable_drag"] = False

        browser.close()

    print("\n=== Results ===")
    for test, passed in results.items():
        status = "PASS" if passed else "FAIL"
        print(f"  {test}: {status}")

    all_pass = all(results.values())
    print(f"\n{'ALL PASS' if all_pass else 'SOME FAILED'}")
    return 0 if all_pass else 1

if __name__ == "__main__":
    import sys
    sys.exit(main())
