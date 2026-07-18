// treemap-geometry.ts — zoomable treemap layout and tile rendering.
// Uses d3-hierarchy's treemap/treemapSquarify for the squarify algorithm.
// Rendering model: one level at a time (focus.children tile the canvas).
// Drill = zoom (scale interpolation), not nested-box relayout.
// Spec: wiki/specs/treemap.md

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
import type { LayoutRect, RenderNode } from "./types";
import type { ChartNode } from "./tree";
import { findNode, sortedChildren, resolveFill } from "./tree";

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
 * Compute squarified treemap layout for ONE level: the immediate children
 * of the focus node. The focus node itself is NOT in the returned map —
 * it is the invisible container. Only focus.children are laid out.
 *
 * Uses d3.treemapSquarify — we do not originate the squarify algorithm.
 *
 * Returns Map<nodeId, LayoutRect> for the focus node's children only.
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

  // Determine effective root: drill target if drilling, else tree root.
  // The effective root is the CONTAINER — it is NOT rendered as a tile.
  // Its descendants are laid out nested inside it.
  let effectiveRoot = root;
  if (drillId) {
    const found = findNode(root, drillId);
    if (found) effectiveRoot = found;
  }

  // No children → empty layout.
  if (effectiveRoot.children.length === 0) return map;

  // Build d3 hierarchy from the effective root, descending through ALL
  // levels. d3.treemap with paddingTop creates nested group headers;
  // paddingInner creates gaps between siblings. This is the classic
  // nested treemap — groups contain their children, recursively.
  const h = hierarchy(effectiveRoot, (d: ChartNode) => {
    if (d.children.length === 0) return null;
    return sortedChildren(d, config, frozenOrder ?? undefined);
  }).sum((d) => {
    // Leaves carry their value; groups sum from children (d3 does this
    // automatically via .sum() — return 0 for non-leaves).
    if (d.children.length === 0) return d.value.value;
    return 0;
  });

  treemap<ChartNode>()
    .tile(treemapSquarify)
    .size([Math.max(1, W), Math.max(1, H)])
    .paddingInner(PAD_INNER)
    .paddingOuter(0)
    .paddingTop(PAD_TOP)
    .round(true)(h);

  // Extract rects for ALL nodes EXCEPT the effective root (which is the
  // invisible container). The root's children and all their descendants
  // are rendered as nested tiles.
  const rootNode = h as HierarchyRectangularNode<ChartNode>;
  const walk = (node: HierarchyRectangularNode<ChartNode>) => {
    if (node.data.id !== effectiveRoot.id) {
      map.set(node.data.id, {
        x: node.x0,
        y: node.y0,
        width: node.x1 - node.x0,
        height: node.y1 - node.y0,
      });
    }
    for (const child of node.children ?? []) {
      walk(child as HierarchyRectangularNode<ChartNode>);
    }
  };
  walk(rootNode);

  return map;
}

/**
 * Create a treemap tile (rect + label).
 *
 * One-level tiles: leaf tiles are editable, group tiles are click-to-drill.
 * Labels: leaves centered (label + value), groups top-left (label only).
 * Labels are hidden when the tile is too small.
 */
export function makeTreemapTile(
  node: RenderNode,
  layout: Cell<Map<string, LayoutRect>>,
  chart?: {
    setHover(id: string | null): void;
    setFocus(id: string | null): void;
    drill: (id: string | null) => void;
    focusCell: Cell<string | null>;
    hoverCell: Cell<string | null>;
    _colorModeCell?: Cell<"flat" | "depth" | "mono" | undefined>;
  },
  present?: Read<boolean>,
  _defs?: SVGDefsElement,
): Shape {
  const pad = 1;

  const liveRect = derive(() => {
    return layout.value.get(node.id) ?? { x: 0, y: 0, width: 0, height: 0 };
  });

  const rx = derive(() => liveRect.value.x + pad);
  const ry = derive(() => liveRect.value.y + pad);
  const rw = derive(() => Math.max(0, liveRect.value.width - pad * 2));
  const rh = derive(() => Math.max(0, liveRect.value.height - pad * 2));

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

  const fillColor = chart?._colorModeCell;
  const fill = derive(() => resolveFill(node.color, node.depth, fillColor?.value));
  const tile = rect(rx, ry, rw, rh, { fill, stroke, strokeWidth });
  tile.el.setAttribute("data-id", node.id);

  // Group tiles: cursor pointer + click to drill in.
  // Leaf tiles: cursor grab (drag to resize) — set on the tile element,
  // NOT on the host, so dead areas (gaps, SVG background) keep default cursor.
  // This matches icicle's pattern: cursor on tiles/handles, not host.
  if (chart) {
    if (!node.isLeaf) {
      tile.el.style.cursor = "pointer";
    } else {
      tile.el.style.cursor = "grab";
    }
    tile.el.addEventListener("pointerenter", () => chart.setHover(node.id));
    tile.el.addEventListener("pointerleave", () => chart.setHover(null));
    tile.el.addEventListener("click", (e) => {
      e.stopPropagation();
      chart.setFocus(node.id);
      (tile.el as SVGRectElement).focus?.();
      // Group tiles drill on click (spec §3).
      if (!node.isLeaf) {
        chart.drill(node.id);
      }
    });
  }

  // Treemap labels: center for leaves, top-left for groups.
  // Size-gated (hidden when tile too small).
  const labelText = derive(() => {
    const w0 = rw.value, h0 = rh.value;
    if (w0 <= 28 || h0 <= 16) return "";
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

  // Wrapper <g> carries the label via CSS transform.
  const labelWrap = document.createElementNS("http://www.w3.org/2000/svg", "g");
  labelWrap.appendChild(lbl.el);
  labelWrap.style.transition = "transform 300ms ease-out";

  // Position the label. This effect reads from derive cells that are created
  // inside forEach's untracked context. To ensure it re-runs when the layout
  // changes, we read the layout cell directly here (the effect closure
  // captures the layout cell reference, which IS reactive).
  const labelDispose = effect(() => {
    // Read layout directly to subscribe to layout changes.
    const r = layout.value.get(node.id) ?? { x: 0, y: 0, width: 0, height: 0 };
    const px = r.x + pad;
    const py = r.y + pad;
    const pw = Math.max(0, r.width - pad * 2);
    const ph = Math.max(0, r.height - pad * 2);
    if (node.isLeaf) {
      labelWrap.style.transform = `translate(${px + pw / 2}px, ${py + ph / 2}px)`;
    } else {
      labelWrap.style.transform = `translate(${px + 4}px, ${py + 4}px)`;
    }
  });

  const g = group({}, tile);
  g.el.appendChild(labelWrap);
  // Don't use track() — it may not exist on group. Keep the disposer alive
  // by pushing it to the group's disposers if available, or just let it run.
  if ((g as any).disposers) (g as any).disposers.push(labelDispose);

  // Pointer-events gate: off-window tiles can't capture clicks.
  if (visible) {
    const visDispose = effect(() => {
      void layout.value; // force subscription
      tile.el.style.pointerEvents = visible.value ? "auto" : "none";
    });
    (g as any).track?.(visDispose);
  }

  return g;
}
