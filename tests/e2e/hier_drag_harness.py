"""
Hierarchical chart drag-gesture harness — reusable Playwright utilities for
testing drag interactions on icicle, sunburst, treemap, and treetable charts.

Usage:

    from hier_drag_harness import HierDragHarness

    with HierDragHarness() as h:
        h.test_handle_drag("v-icicle", "tech..finance", "tech", "finance")
        h.test_tile_drag("v-treemap", "aapl")
        h.test_cross_tile_sync("v-icicle", "v-sunburst", "tech..finance", "tech")
        h.test_number_drag("v-treetable", "aapl")
        h.report_and_exit()

Run directly to self-test:
    uv run --with playwright python tests/e2e/hier_drag_harness.py

Env: BASE_URL (default http://hotbook-demos.localhost:1355)
"""
import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://hotbook-demos.localhost:1355")


class HierDragHarness:
    """Reusable harness for hierarchical chart drag-gesture testing.

    Manages browser lifecycle, provides helpers for reading chart state,
    and exposes test methods that return (passed: bool, detail: str).
    """

    def __init__(self, section_id="hier-family"):
        self.section_id = section_id
        self.failures = []
        self.passes = []
        self._pw = None
        self.browser = None
        self.page = None

    def __enter__(self):
        self._pw = sync_playwright().start()
        self.browser = self._pw.chromium.launch(headless=True)
        self.page = self.browser.new_page(viewport={"width": 1400, "height": 900})
        self.page.goto(f"{BASE}/#{self.section_id}", wait_until="networkidle")
        self.page.wait_for_timeout(800)
        return self

    def __exit__(self, *a):
        if self.browser:
            self.browser.close()
        if self._pw:
            self._pw.stop()

    # ── state readers ─────────────────────────────────────────────────────────

    def _selector(self, chart_tag):
        return f"#{self.section_id} {chart_tag}"

    def get_value(self, chart_tag, node_id):
        """Read a node's current value from the chart's reactive tree."""
        return self.page.evaluate(
            """({sel, nodeId}) => {
              const el = document.querySelector(sel);
              if (!el) return null;
              const root = el._treeRoot?.value;
              if (!root) return null;
              const find = (n, id) => n.id === id ? n : (n.children || []).reduce((f, c) => f || find(c, id), null);
              const node = find(root, nodeId);
              return node ? node.value.value : null;
            }""",
            {"sel": self._selector(chart_tag), "nodeId": node_id},
        )

    def get_all_leaf_values(self, chart_tag):
        """Read all leaf values from a chart."""
        return self.page.evaluate(
            """(sel) => {
              const el = document.querySelector(sel);
              if (!el) return null;
              const root = el._treeRoot?.value;
              if (!root) return null;
              const leaves = [];
              const walk = (n) => {
                if (n.children.length === 0) leaves.push({id: n.id, value: n.value.value});
                else n.children.forEach(walk);
              };
              walk(root);
              return leaves;
            }""",
            self._selector(chart_tag),
        )

    def get_handle_bbox(self, chart_tag, edge_id):
        """Get center + size of a handle's rect element."""
        return self.page.evaluate(
            """({sel, edgeId}) => {
              const el = document.querySelector(sel);
              if (!el) return null;
              const handle = el.querySelector('[data-edge="' + edgeId + '"] rect');
              if (!handle) return null;
              const r = handle.getBoundingClientRect();
              return {x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height};
            }""",
            {"sel": self._selector(chart_tag), "edgeId": edge_id},
        )

    def get_tile_bbox(self, chart_tag, node_id):
        """Get center + size of a tile's mark element (rect or circle)."""
        return self.page.evaluate(
            """({sel, nodeId}) => {
              const el = document.querySelector(sel);
              if (!el) return null;
              const group = el.querySelector('[data-id="' + nodeId + '"]');
              if (!group) return null;
              const tile = group.querySelector('rect') || group.querySelector('circle');
              if (!tile) return null;
              const r = tile.getBoundingClientRect();
              return {x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height};
            }""",
            {"sel": self._selector(chart_tag), "nodeId": node_id},
        )

    def get_value_cell_bbox(self, chart_tag, node_id):
        """Get center of a treetable value cell."""
        return self.page.evaluate(
            """({sel, nodeId}) => {
              const el = document.querySelector(sel);
              if (!el) return null;
              const cell = el.querySelector('[data-value-cell^="' + nodeId + ':"]');
              if (!cell) return null;
              const r = cell.getBoundingClientRect();
              return {x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height};
            }""",
            {"sel": self._selector(chart_tag), "nodeId": node_id},
        )

    # ── drag primitives ───────────────────────────────────────────────────────

    def drag(self, x, y, dx, dy, steps=10, settle_ms=300):
        """Perform a real pointer drag from (x,y) by (dx,dy)."""
        self.page.mouse.move(x, y)
        self.page.mouse.down()
        self.page.wait_for_timeout(100)
        self.page.mouse.move(x + dx, y + dy, steps=steps)
        self.page.wait_for_timeout(200)
        self.page.mouse.up()
        self.page.wait_for_timeout(settle_ms)

    def drag_arc(self, x, y, points, settle_ms=300):
        """Perform a multi-point drag (for angular/curved drags).
        points is a list of (x, y) tuples to move through after down."""
        self.page.mouse.move(x, y)
        self.page.mouse.down()
        self.page.wait_for_timeout(100)
        for px, py in points:
            self.page.mouse.move(px, py, steps=5)
            self.page.wait_for_timeout(50)
        self.page.wait_for_timeout(200)
        self.page.mouse.up()
        self.page.wait_for_timeout(settle_ms)

    # ── test methods ──────────────────────────────────────────────────────────

    def test_handle_drag(self, chart_tag, edge_id, left_id, right_id, dx=30, dy=0):
        """Drag an edge handle and verify the two siblings redistribute."""
        label = f"{chart_tag} handle {edge_id}"
        handle = self.get_handle_bbox(chart_tag, edge_id)
        if not handle:
            self.failures.append(f"{label}: handle not found")
            return False
        if handle["h"] < 2 and handle["w"] < 2:
            self.failures.append(f"{label}: handle has 0 size (h={handle['h']}, w={handle['w']})")
            return False

        left_before = self.get_value(chart_tag, left_id)
        right_before = self.get_value(chart_tag, right_id)
        if left_before is None or right_before is None:
            self.failures.append(f"{label}: could not read initial values")
            return False

        self.drag(handle["x"], handle["y"], dx, dy)

        left_after = self.get_value(chart_tag, left_id)
        right_after = self.get_value(chart_tag, right_id)

        if left_after is None or right_after is None:
            self.failures.append(f"{label}: could not read post-drag values")
            return False

        if left_after == left_before and right_after == right_before:
            self.failures.append(f"{label}: values unchanged (left={left_before}->{left_after}, right={right_before}->{right_after})")
            return False

        # Verify conservation: left + right should be approximately conserved
        total_before = left_before + right_before
        total_after = left_after + right_after
        if abs(total_after - total_before) > 0.01:
            self.failures.append(f"{label}: conservation violated (total {total_before}->{total_after})")
            return False

        self.passes.append(f"{label}: left {left_before:.2f}->{left_after:.2f}, right {right_before:.2f}->{right_after:.2f}")
        return True

    def test_tile_drag(self, chart_tag, node_id, dx=30, dy=0):
        """Drag a tile body and verify its value changes."""
        label = f"{chart_tag} tile {node_id}"
        tile = self.get_tile_bbox(chart_tag, node_id)
        if not tile:
            self.failures.append(f"{label}: tile not found")
            return False

        before = self.get_value(chart_tag, node_id)
        if before is None:
            self.failures.append(f"{label}: could not read initial value")
            return False

        self.drag(tile["x"], tile["y"], dx, dy)

        after = self.get_value(chart_tag, node_id)
        if after is None:
            self.failures.append(f"{label}: could not read post-drag value")
            return False

        if after == before:
            self.failures.append(f"{label}: value unchanged ({before}->{after})")
            return False

        self.passes.append(f"{label}: {before:.2f}->{after:.2f}")
        return True

    def test_cross_tile_sync(self, source_tag, target_tag, edge_id, node_id, dx=30, dy=0):
        """Drag in source chart, verify target chart's value updates."""
        label = f"cross-tile {source_tag}->{target_tag} ({edge_id})"
        handle = self.get_handle_bbox(source_tag, edge_id)
        if not handle:
            self.failures.append(f"{label}: source handle not found")
            return False

        source_before = self.get_value(source_tag, node_id)
        target_before = self.get_value(target_tag, node_id)
        if source_before is None or target_before is None:
            self.failures.append(f"{label}: could not read initial values")
            return False

        # Values should start in sync
        if abs(source_before - target_before) > 0.001:
            self.failures.append(f"{label}: charts out of sync before drag (source={source_before}, target={target_before})")
            return False

        self.drag(handle["x"], handle["y"], dx, dy)

        source_after = self.get_value(source_tag, node_id)
        target_after = self.get_value(target_tag, node_id)

        if source_after is None or target_after is None:
            self.failures.append(f"{label}: could not read post-drag values")
            return False

        # After drag, both should still be in sync (kernel broadcast)
        if abs(source_after - target_after) > 0.001:
            self.failures.append(f"{label}: charts out of sync after drag (source={source_after}, target={target_after})")
            return False

        if source_after == source_before:
            self.failures.append(f"{label}: source value unchanged")
            return False

        self.passes.append(f"{label}: both {source_before:.2f}->{source_after:.2f}")
        return True

    def test_number_drag(self, chart_tag, node_id, dx=40, dy=0):
        """Drag a treetable value cell and verify value changes."""
        label = f"{chart_tag} number-drag {node_id}"
        cell = self.get_value_cell_bbox(chart_tag, node_id)
        if not cell:
            self.failures.append(f"{label}: value cell not found")
            return False

        before = self.get_value(chart_tag, node_id)
        if before is None:
            self.failures.append(f"{label}: could not read initial value")
            return False

        self.drag(cell["x"], cell["y"], dx, dy)

        after = self.get_value(chart_tag, node_id)
        if after is None:
            self.failures.append(f"{label}: could not read post-drag value")
            return False

        if after == before:
            self.failures.append(f"{label}: value unchanged ({before}->{after})")
            return False

        self.passes.append(f"{label}: {before:.2f}->{after:.2f}")
        return True

    def test_handle_visible(self, chart_tag, edge_id):
        """Verify a handle is visible (has non-zero dimensions)."""
        label = f"{chart_tag} handle-visible {edge_id}"
        handle = self.get_handle_bbox(chart_tag, edge_id)
        if not handle:
            self.failures.append(f"{label}: handle not found")
            return False
        if handle["h"] < 2 or handle["w"] < 2:
            self.failures.append(f"{label}: handle too small (w={handle['w']}, h={handle['h']})")
            return False
        self.passes.append(f"{label}: w={handle['w']:.0f}, h={handle['h']:.0f}")
        return True

    def test_tile_count(self, chart_tag, expected):
        """Verify a chart renders the expected number of tiles."""
        label = f"{chart_tag} tile-count"
        count = self.page.evaluate(
            """(sel) => document.querySelector(sel)?.querySelectorAll('[data-id]').length ?? 0""",
            self._selector(chart_tag),
        )
        if count != expected:
            self.failures.append(f"{label}: expected {expected}, got {count}")
            return False
        self.passes.append(f"{label}: {count}")
        return True

    def goto_section(self, section_id):
        """Navigate to a different demo section and wait for it to render."""
        self.section_id = section_id
        self.page.goto(f"{BASE}/#{section_id}", wait_until="networkidle")
        self.page.wait_for_timeout(800)

    # ── reporting ─────────────────────────────────────────────────────────────

    def report_and_exit(self):
        print(f"\n{'='*60}")
        print(f"PASSES: {len(self.passes)}")
        for p in self.passes:
            print(f"  ✓ {p}")
        if self.failures:
            print(f"\nFAILURES: {len(self.failures)}")
            for f in self.failures:
                print(f"  ✗ {f}")
        else:
            print("\nALL PASS")
        print(f"{'='*60}")
        return 0 if not self.failures else 1


if __name__ == "__main__":
    with HierDragHarness() as h:
        # Handle visibility (the h=0 bug)
        h.test_handle_visible("v-icicle", "tech..finance")
        h.test_handle_visible("v-sunburst", "tech..finance")

        # Tile counts
        h.test_tile_count("v-icicle", 14)
        h.test_tile_count("v-sunburst", 14)
        h.test_tile_count("v-treemap", 14)

        # Edge handle drag — redistribute between siblings
        h.test_handle_drag("v-icicle", "tech..finance", "tech", "finance", dx=30)
        h.test_handle_drag("v-sunburst", "tech..finance", "tech", "finance", dx=25, dy=10)

        # Tile body drag — change a leaf value
        h.test_tile_drag("v-treemap", "aapl", dx=30)

        # Cross-tile sync — drag in icicle, verify sunburst updates
        h.test_cross_tile_sync("v-icicle", "v-sunburst", "tech..finance", "tech", dx=30)

        # Treetable number drag
        h.test_number_drag("v-treetable", "aapl", dx=40)

        # Pack tests (separate demo section)
        h.goto_section("pack")
        h.test_tile_count("v-pack", 14)
        h.test_tile_drag("v-pack", "aapl", dx=30)

    sys.exit(h.report_and_exit())
