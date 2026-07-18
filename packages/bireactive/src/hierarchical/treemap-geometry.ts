// treemap-geometry.ts — zoomable treemap layout and tile rendering.
// Uses d3-hierarchy's treemap/treemapSquarify for the squarify algorithm.
// Rendering model: full-tree layout + 2D affine drill transform (mirrors
// icicle's pattern). Drill = zoom (2D scale interpolation), not relayout.
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
import { sortedChildren, resolveFill, labelColorFor } from "./tree";
import { motion } from "../lib/runtime-config";
import { TRANSITION_DURATION } from "../lib/transitions";

const PAD_TOP = 16; // Fixed-pixel group header space

/** Treemap padding (inner + outer) — driven by the shared `motion.separation`
 *  cell so the tweaks pane retunes it live. Sampled at layout time.
 *  paddingInner creates a gap of exactly `sep` between siblings. */
function padInner(): number {
  return Math.max(0, motion.separation.value);
}

/** Leaf-sum of a subtree. Group value cells normally hold the sum already,
 *  but during drafts leaf writes can make them stale — recompute from leaves. */
function subtreeValue(n: ChartNode): number {
  if (n.children.length === 0) return n.value.value;
  let s = 0;
  for (const c of n.children) s += subtreeValue(c);
  return s;
}

/**
 * Compute squarified treemap layout for the FULL tree, then (when drilling)
 * apply a D3-style 2D affine transform so the focus node fills the canvas.
 *
 * Mirrors icicle's `computeLayout` (hierarchy.ts) affine pattern, extended
 * to 2D: d3.treemap is run on the FULL root (not the drill target), so
 * every node — including the drill target, its siblings, and off-subtree
 * nodes — gets a layout entry. When `drillId` is set, the focus rect is
 * scaled up to fill [0,W]×[0,H] and every other rect is transformed by the
 * same 2D affine, sliding siblings off-canvas via CSS transitions.
 *
 * Uses d3.treemapSquarify — we do not originate the squarify algorithm.
 *
 * Returns Map<nodeId, LayoutRect> for ALL nodes (including root). The
 * chart's `present` filter (`_deriveWindow` / `buildAllDescendants`)
 * decides which nodes render; geometry just positions them.
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

  // No children → empty layout.
  if (root.children.length === 0) return map;

  // Build d3 hierarchy from the FULL root, descending through ALL levels.
  // d3.treemap with paddingTop creates nested group headers; paddingInner
  // creates gaps between siblings. This is the classic nested treemap —
  // groups contain their children, recursively.
  const h = hierarchy(root, (d: ChartNode) => {
    if (d.children.length === 0) return null;
    return sortedChildren(d, config, frozenOrder ?? undefined);
  }).sum((d) => {
    // Leaves carry their value; groups sum from children (d3 does this
    // automatically via .sum() — return 0 for non-leaves).
    if (d.children.length === 0) return d.value.value;
    return 0;
  });

  const pad = padInner();
  treemap<ChartNode>()
    .tile(treemapSquarify)
    .size([Math.max(1, W), Math.max(1, H)])
    .paddingInner(pad)
    .paddingOuter(pad) // gap between parent edge and children — matches
    // sibling separation so nested blocks don't go flush against their
    // container. Without this, children touch all 4 walls of their parent,
    // which looks wrong compared to the clean gaps between siblings.
    .paddingTop(PAD_TOP)
    .round(false)(h); // don't round — rounding halves sub-pixel padding

  // Extract rects for ALL nodes (including root). The chart's `present`
  // filter gates visibility; geometry positions everything so off-subtree
  // nodes can slide off-canvas via the affine transform + CSS transitions.
  const rootNode = h as HierarchyRectangularNode<ChartNode>;
  const walk = (node: HierarchyRectangularNode<ChartNode>) => {
    map.set(node.data.id, {
      x: node.x0,
      y: node.y0,
      width: node.x1 - node.x0,
      height: node.y1 - node.y0,
    });
    for (const child of node.children ?? []) {
      walk(child as HierarchyRectangularNode<ChartNode>);
    }
  };
  walk(rootNode);

  // D3-style drill transform: 2D affine so the focus node's rect fills the
  // canvas. Siblings and off-subtree nodes scale up + translate off-screen
  // (preserving relative layout), sliding there via CSS transitions. This
  // mirrors icicle's 1D value-axis affine, extended to both x and y.
  if (drillId) {
    const focusRect = map.get(drillId);
    if (focusRect && focusRect.width > 0 && focusRect.height > 0) {
      const scaleX = W / focusRect.width;
      const scaleY = H / focusRect.height;
      const fx = focusRect.x;
      const fy = focusRect.y;
      for (const [id, r] of map) {
        map.set(id, {
          x: (r.x - fx) * scaleX,
          y: (r.y - fy) * scaleY,
          width: r.width * scaleX,
          height: r.height * scaleY,
        });
      }

      // Re-apply fixed-pixel paddingTop. d3's paddingTop (PAD_TOP=16) was
      // applied at every level BEFORE the affine, so it got scaled by scaleY.
      // For small focus tiles (large scaleY), the header gap becomes huge
      // (e.g. 16 * 5 = 80px). Collapse it back to 16px screen-space by
      // shifting each group's children up by the reclaimed space and growing
      // their heights to fill it. Only the focus subtree is visible, so only
      // fix nodes within it.
      const reclaim = PAD_TOP * (scaleY - 1);
      if (reclaim > 0) {
        const findFocus = (node: HierarchyRectangularNode<ChartNode>): HierarchyRectangularNode<ChartNode> | null => {
          if (node.data.id === drillId) return node;
          for (const child of node.children ?? []) {
            const found = findFocus(child as HierarchyRectangularNode<ChartNode>);
            if (found) return found;
          }
          return null;
        };
        const fixPadding = (node: HierarchyRectangularNode<ChartNode>) => {
          const children = node.children;
          if (!children || children.length === 0) return;
          for (const child of children) {
            const cr = map.get(child.data.id);
            if (cr) {
              map.set(child.data.id, {
                x: cr.x,
                y: cr.y - reclaim,
                width: cr.width,
                height: cr.height + reclaim,
              });
            }
            fixPadding(child as HierarchyRectangularNode<ChartNode>);
          }
        };
        const focusD3Node = findFocus(rootNode);
        if (focusD3Node) fixPadding(focusD3Node);
      }
    }
  }

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
  defs?: SVGDefsElement,
  instanceId?: string,
  valueMap?: Cell<Map<string, number>>,
): Shape {
  // No drawn inset — d3.treemap's paddingInner/paddingOuter already
  // creates the gaps in the layout. Drawing the rect at the full layout
  // cell means the gap between siblings = exactly paddingInner = sep.
  // (The previous hardcoded pad=1 inset was compounding with d3's
  // padding, making internal separators 2-4× too wide.)
  const liveRect = derive(() => {
    return layout.value.get(node.id) ?? { x: 0, y: 0, width: 0, height: 0 };
  });

  const rx = derive(() => liveRect.value.x);
  const ry = derive(() => liveRect.value.y);
  const rw = derive(() => Math.max(0, liveRect.value.width));
  const rh = derive(() => Math.max(0, liveRect.value.height));

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
  // Tile rect transitions are handled by the transitionOnUpdated behavior's
  // injected <style> (x/y/width/height on rect elements). No inline
  // transition here — the behavior's CSS is the single source of truth.

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

  // Treemap labels: top-left for both leaves and groups (Budget tree
  // pattern). Same-row format: name (bold) + value (regular) after it.
  // SVG <text> doesn't render \n, so two separate <text> elements.
  // Value hides first when the tile is too narrow; name hides next.
  const labelFill = labelColorFor(node.color);
  const nameText = derive(() => {
    const w0 = rw.value, h0 = rh.value;
    if (w0 <= 28 || h0 <= 16) return "";
    return node.label;
  });
  const valueText = derive(() => {
    const w0 = rw.value, h0 = rh.value;
    if (w0 <= 60 || h0 <= 16) return ""; // value needs more width
    // Read from the reactive valueMap so labels update on drag resize.
    // Falls back to the stale RenderNode.value if no map provided.
    const v = valueMap ? valueMap.value.get(node.id) : node.value;
    return (v ?? node.value).toFixed(0);
  });

  const nameLbl = label(Vec.derive(() => ({ x: 0, y: 0 })), nameText, {
    size: 11,
    align: Anchor.TopLeft,
    fill: labelFill,
    bold: true,
  });
  nameLbl.el.style.pointerEvents = "none";
  // Value label offset to the right of the name (approximate name width).
  const valueOffset = derive(() => {
    const txt = nameText.value;
    return txt ? txt.length * 6.5 + 6 : 0;
  });
  const valueLbl = label(
    Vec.derive(() => ({ x: valueOffset.value, y: 0 })),
    valueText,
    {
      size: 11,
      align: Anchor.TopLeft,
      fill: labelFill,
      bold: false,
    },
  );
  valueLbl.el.style.pointerEvents = "none";

  // Wrapper <g> carries both labels via CSS transform.
  const labelWrap = document.createElementNS("http://www.w3.org/2000/svg", "g");
  labelWrap.appendChild(nameLbl.el);
  labelWrap.appendChild(valueLbl.el);
  // Label group transform transition — timed by drillMs. The behavior's
  // CSS handles x/y on <text>, but the group transform is separate (CSS
  // transform property, not SVG attribute), so it needs its own inline
  // transition. Reads drillMs so it stays in sync with the behavior.
  effect(() => {
    labelWrap.style.transition = `transform ${TRANSITION_DURATION.drill}ms ease-out`;
  });

  // Per-tile clipPath — clips the label to the tile's rect dimensions so
  // long labels don't overflow small tiles. Applied to the outer <g> (no
  // CSS transform) so clipPath coordinates are in SVG user space directly.
  let clipId: string | null = null;
  let clipRect: SVGRectElement | null = null;
  if (defs) {
    clipId = `${instanceId ?? "c"}-tile-clip-${node.id}`;
    const clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
    clipPath.setAttribute("id", clipId);
    clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
  }

  // Position the label. Top-left for both leaves and groups now.
  const labelDispose = effect(() => {
    const r = layout.value.get(node.id) ?? { x: 0, y: 0, width: 0, height: 0 };
    labelWrap.style.transform = `translate(${r.x + 4}px, ${r.y + 4}px)`;
    // Update clip rect to match tile dimensions (reactive — tiles move on drill).
    if (clipRect) {
      clipRect.setAttribute("x", String(r.x));
      clipRect.setAttribute("y", String(r.y));
      clipRect.setAttribute("width", String(Math.max(0, r.width)));
      clipRect.setAttribute("height", String(Math.max(0, r.height)));
    }
  });

  const g = group({}, tile);
  g.el.appendChild(labelWrap);
  if (clipId) g.el.style.clipPath = `url(#${clipId})`;
  // Don't use track() — it may not exist on group. Keep the disposer alive
  // by pushing it to the group's disposers if available, or just let it run.
  if ((g as any).disposers) (g as any).disposers.push(labelDispose);

  // Visibility gate: off-window tiles fade out and can't capture clicks.
  // Opacity transitions so peers fade (not vanish) during drill/depth changes.
  if (visible) {
    effect(() => {
      const ms = TRANSITION_DURATION.drill;
      labelWrap.style.transition = `transform ${ms}ms ease-out, opacity ${ms}ms ease-out`;
    });
    const visDispose = effect(() => {
      void layout.value; // force subscription
      const vis = visible.value;
      tile.el.style.opacity = vis ? "" : "0";
      tile.el.style.pointerEvents = vis ? "auto" : "none";
      labelWrap.style.opacity = vis ? "" : "0";
    });
    (g as any).track?.(visDispose);
  }

  return g;
}
