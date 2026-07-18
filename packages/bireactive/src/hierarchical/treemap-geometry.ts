// treemap-geometry.ts — squarified treemap layout and tile rendering.
// Geometry-specific for nested-rect treemaps. Layout uses d3-hierarchy's
// treemap/treemapSquarify with fixed-pixel padding for group headers.
// Tile rendering follows hierarchy.ts makeTile but with treemap-specific
// label placement: leaves centered, groups pinned to top-left.

import {
  hierarchy,
  treemap,
  treemapSquarify,
  type HierarchyRectangularNode,
} from "d3-hierarchy";
import {
  Anchor,
  derive,
  effect,
  group,
  label,
  readNow,
  rect,
  Vec,
  type Cell,
  type Read,
  type Shape,
} from "bireactive";
import type { ChartConfig, LayoutRect, RenderNode } from "./types";
import type { ChartNode } from "./tree";
import { findNode, sortedChildren, treeDepth } from "./tree";

const PAD_OUTER = 4;
const PAD_INNER = 2;
const PAD_TOP = 16; // Fixed-pixel group header space

/** Leaf-sum of a subtree. Group value cells normally hold the sum already,
 *  but during drafts leaf writes can make them stale — recompute from leaves. */
function subtreeValue(n: ChartNode): number {
  if (n.children.length === 0) return n.value.value;
  let s = 0;
  for (const c of n.children) s += subtreeValue(c);
  return s;
}

/**
 * Compute squarified treemap layout.
 *
 * When drilling (drillId set), re-roots the layout at the focus node so the
 * focus subtree fills the canvas. This keeps group headers at fixed pixel
 * sizes (deep drill doesn't scale them). The layout is computed once from the
 * effective root; drill transitions are handled by the chart (per-tile screen
 * geometry tweens, not affine viewport scaling).
 *
 * Returns Map<nodeId, LayoutRect> for all nodes reachable from the effective root.
 */
export function computeTreemapLayout(
  root: ChartNode,
  config: ChartConfig,
  frozenOrder: Map<string, string[]> | null | undefined,
  W: number,
  H: number,
  drillId?: string | null,
): Map<string, LayoutRect> {
  const map = new Map<string, LayoutRect>();

  // Determine effective root: focus node if drilling, else tree root.
  // This re-roots the squarify layout so the focus subtree fills the canvas.
  let effectiveRoot = root;
  let effectiveRootDepth = 0;
  if (drillId) {
    const focus = findNode(root, drillId);
    if (focus) {
      effectiveRoot = focus;
      let cur = focus.parent;
      while (cur) { effectiveRootDepth++; cur = cur.parent; }
    }
  }

  // Depth window: `config.depth` levels below the effective root, clamped to
  // the deepest node that exists (same convention as hierarchy.ts). Nodes
  // beyond the window are not laid out — they inherit their capped
  // ancestor's rect below, so they fade in place on depth changes.
  const maxDepth = Math.min(config.depth ?? 100, treeDepth(root));
  const windowEnd = Math.min(effectiveRootDepth + maxDepth, treeDepth(root));
  const layoutLevels = Math.max(1, windowEnd - effectiveRootDepth);

  // Build d3 hierarchy from effective root, truncating descent at the depth
  // window and ordering children per config.sort / frozenOrder. Truncated
  // groups act as leaves and carry their subtree total (their reactive value
  // cell — groups hold the sum).
  const relDepth = new Map<ChartNode, number>();
  relDepth.set(effectiveRoot, 0);
  const h = hierarchy(effectiveRoot, (d) => {
    const depth = relDepth.get(d) ?? 0;
    if (depth >= layoutLevels || d.children.length === 0) return null;
    const kids = sortedChildren(d, config, frozenOrder ?? undefined);
    for (const k of kids) relDepth.set(k, depth + 1);
    return kids;
  }).sum((d) => {
    const depth = relDepth.get(d) ?? 0;
    if (d.children.length === 0 || depth >= layoutLevels) return subtreeValue(d);
    return 0;
  });

  // Compute squarify layout with fixed-pixel padding for group headers.
  treemap<ChartNode>()
    .tile(treemapSquarify)
    .size([W, H])
    .paddingOuter(PAD_OUTER)
    .paddingInner(PAD_INNER)
    .paddingTop(PAD_TOP)
    .round(true)(h);

  // Extract rects into the map, walking the hierarchy.
  const processNode = (node: HierarchyRectangularNode<ChartNode>) => {
    const id = node.data.id;
    map.set(id, {
      x: node.x0,
      y: node.y0,
      width: node.x1 - node.x0,
      height: node.y1 - node.y0,
    });
    for (const child of node.children ?? []) {
      processNode(child as HierarchyRectangularNode<ChartNode>);
    }
  };

  processNode(h as HierarchyRectangularNode<ChartNode>);

  // Nodes beyond the depth window inherit their deepest laid-out ancestor's
  // rect, so depth changes fade them in place instead of leaving them at 0,0.
  const inherit = (n: ChartNode, ancestorRect: LayoutRect | undefined) => {
    const own = map.get(n.id) ?? ancestorRect;
    if (!map.has(n.id) && own) map.set(n.id, own);
    for (const c of n.children) inherit(c, own);
  };
  inherit(effectiveRoot, undefined);

  return map;
}

/**
 * Create a treemap tile (rect + label).
 *
 * Similar to hierarchy.ts makeTile but with treemap-specific label placement:
 *   - Leaves: center text, size 11
 *   - Groups: top-left text, size 10, bold
 * Labels are hidden when the tile is too small. Per-tile clipPath clips labels
 * to tile bounds.
 */
export function makeTreemapTile(
  node: RenderNode,
  layout: Cell<Map<string, LayoutRect>>,
  chart?: {
    setHover(id: string | null): void;
    setFocus(id: string | null): void;
    focusCell: Cell<string | null>;
    hoverCell: Cell<string | null>;
  },
  present?: Read<boolean>,
  defs?: SVGDefsElement,
): Shape {
  const pad = 2;

  const liveRect = derive(() => {
    return layout.value.get(node.id) ?? { x: 0, y: 0, width: 0, height: 0 };
  });

  const rx = derive(() => liveRect.value.x + pad);
  const ry = derive(() => liveRect.value.y + pad);
  const rw = derive(() => Math.max(0, liveRect.value.width - pad * 2));
  const rh = derive(() => Math.max(0, liveRect.value.height - pad * 2));

  // Present gates visibility: in-window → opacity 1 + pointer-events auto;
  // off-window → opacity 0 + pointer-events none.
  const visible = present ? derive(() => readNow(present)) : null;

  // Stroke reflects focus/selection and hover state.
  const stroke = derive(() => {
    if (!chart) return "none";
    if (chart.focusCell.value === node.id) return "#fff";
    if (chart.hoverCell.value === node.id) return "#c8cdd6";
    return "none";
  });
  const strokeWidth = derive(() => {
    if (!chart) return 0;
    if (chart.focusCell.value === node.id || chart.hoverCell.value === node.id) return 2;
    return 0;
  });

  const tile = rect(rx, ry, rw, rh, { fill: node.color, stroke, strokeWidth });
  // Cursor inherits from the host (ew-resize in resize mode, grab via the
  // reorder chrome CSS) — no per-tile override.
  tile.el.setAttribute("data-id", node.id);

  if (chart) {
    tile.el.addEventListener("pointerenter", () => chart.setHover(node.id));
    tile.el.addEventListener("pointerleave", () => chart.setHover(null));
    tile.el.addEventListener("click", () => {
      chart.setFocus(node.id);
      (tile.el as SVGRectElement).focus?.();
    });
  }

  // Treemap labels: center for leaves, top-left for groups.
  // Size-gated (hidden when tile too small).
  const LABEL_PAD = 3;
  const labelText = derive(() => {
    const w0 = rw.value,
      h0 = rh.value;
    if (w0 <= 28 || h0 <= 16) return "";
    // Leaf: label + value; Group: label only.
    if (node.isLeaf) {
      return `${node.label}\n${node.value.toFixed(0)}`;
    }
    return node.label;
  });

  const lbl = label(Vec.derive(() => ({ x: 0, y: 0 })), labelText, {
    size: node.isLeaf ? 11 : 10,
    align: Anchor.TopLeft,
    fill: "#fff",
    bold: !node.isLeaf,
  });
  lbl.el.style.pointerEvents = "none";

  // Wrapper <g> carries the label via CSS transform. Applied here, not on
  // the Shape, so it's a clean CSS transform.
  const labelWrap = document.createElementNS("http://www.w3.org/2000/svg", "g");
  labelWrap.appendChild(lbl.el);
  labelWrap.style.transition = "transform 300ms ease-out";

  // Per-tile clipPath — clips the label to the tile's rect dimensions.
  let clipId: string | null = null;
  let clipRect: SVGRectElement | null = null;
  if (defs) {
    clipId = `tile-clip-${node.id}`;
    const clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
    clipPath.setAttribute("id", clipId);
    clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
  }

  const labelDispose = effect(() => {
    if (node.isLeaf) {
      // Center the leaf text in the tile.
      labelWrap.style.transform = `translate(${rx.value + rw.value / 2}px, ${ry.value + rh.value / 2}px)`;
    } else {
      // Group: top-left corner with padding.
      labelWrap.style.transform = `translate(${rx.value + LABEL_PAD}px, ${ry.value + LABEL_PAD}px)`;
    }
    // Update clip rect to match tile dimensions.
    if (clipRect) {
      clipRect.setAttribute("x", String(rx.value));
      clipRect.setAttribute("y", String(ry.value));
      clipRect.setAttribute("width", String(rw.value));
      clipRect.setAttribute("height", String(rh.value));
    }
  });

  const g = group({}, tile);
  g.el.appendChild(labelWrap);
  if (clipId) g.el.style.clipPath = `url(#${clipId})`;
  (g as any).track?.(labelDispose);

  // Pointer-events gate: off-window tiles can't capture clicks.
  if (visible) {
    const visDispose = effect(() => {
      tile.el.style.pointerEvents = visible.value ? "auto" : "none";
    });
    (g as any).track?.(visDispose);
  }

  return g;
}
