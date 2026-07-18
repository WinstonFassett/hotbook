// pack-geometry.ts — circle-packing layout and circle rendering.
// Uses d3-hierarchy's pack for the circle-packing algorithm.
// Rendering model: all descendants rendered nested. Drill = 2D affine
// transform (scale + translate) so the focus circle fills the canvas,
// mirroring the icicle/treemap pattern. Siblings slide off-screen via
// CSS transitions on cx/cy/r.
// Spec: wiki/specs/pack.md (pending)

import {
  hierarchy,
  pack as d3pack,
  type HierarchyCircularNode,
} from "d3-hierarchy";
import {
  Anchor,
  circle,
  derive,
  effect,
  group,
  label,
  readNow,
  Vec,
  type Cell,
  type Read,
  type Shape,
} from "bireactive";
import type { ChartConfig, PackRect, RenderNode } from "./types";
import type { ChartNode } from "./tree";
import { sortedChildren, resolveFill, labelColorFor } from "./tree";
import { motion } from "../lib/runtime-config";

/** Pack padding — driven by the shared `motion.separation` cell so the
 *  tweaks pane retunes it live. Sampled at layout time. */
function pad(): number {
  return Math.max(0, motion.separation.value * 2);
}

/** Compute circle-packing layout for the FULL tree, then (when drilling)
 *  apply a 2D affine transform so the focus circle fills the canvas.
 *
 *  Mirrors icicle's `computeLayout` affine pattern and treemap's 2D affine,
 *  adapted for circles: d3.pack runs on the FULL root (not the drill target),
 *  so every node gets a layout entry. When `drillId` is set, the focus
 *  circle is scaled up to fill the canvas and centered; siblings and
 *  off-subtree nodes scale + translate off-screen, sliding there via CSS
 *  transitions.
 *
 *  Returns Map<nodeId, PackRect> for ALL nodes (including root). The chart's
 *  `present` filter decides which nodes render; geometry positions them. */
export function computePackLayout(
  root: ChartNode,
  config: ChartConfig,
  frozenOrder: Map<string, string[]> | null | undefined,
  W: number,
  H: number,
  drillId?: string | null,
): Map<string, PackRect> {
  const map = new Map<string, PackRect>();

  if (root.children.length === 0) return map;

  // Build d3 hierarchy from the FULL root, descending through ALL levels.
  const h = hierarchy(root, (d: ChartNode) => {
    if (d.children.length === 0) return null;
    return sortedChildren(d, config, frozenOrder ?? undefined);
  }).sum((d) => {
    if (d.children.length === 0) return d.value.value;
    return 0;
  });

  // Pack into a square that fits the canvas (use min dimension for uniform circles).
  const size = Math.min(W, H);
  d3pack<ChartNode>()
    .size([size, size])
    .padding(pad())(h);

  // Extract circles for ALL nodes (including root). Offset to center.
  const offsetX = (W - size) / 2;
  const offsetY = (H - size) / 2;
  const rootNode = h as HierarchyCircularNode<ChartNode>;
  const walk = (node: HierarchyCircularNode<ChartNode>) => {
    map.set(node.data.id, {
      cx: node.x + offsetX,
      cy: node.y + offsetY,
      r: node.r,
    });
    for (const child of node.children ?? []) {
      walk(child as HierarchyCircularNode<ChartNode>);
    }
  };
  walk(rootNode);

  // D3-style drill transform: 2D affine so the focus circle fills the canvas.
  // Scale uniformly (circles must stay circular) and translate so the focus
  // circle centers at (W/2, H/2). Siblings scale up + translate off-screen,
  // sliding there via CSS transitions. Mirrors treemap's 2D affine.
  if (drillId) {
    const focus = map.get(drillId);
    if (focus && focus.r > 0) {
      // Scale so the focus circle's diameter fills the canvas's min dimension.
      const scale = Math.min(W, H) / (2 * focus.r);
      const newCx = W / 2;
      const newCy = H / 2;
      for (const [id, c] of map) {
        map.set(id, {
          cx: (c.cx - focus.cx) * scale + newCx,
          cy: (c.cy - focus.cy) * scale + newCy,
          r: c.r * scale,
        });
      }
    }
  }

  return map;
}

/** Render a single circle for a pack node. */
export function makeCircle(
  node: RenderNode,
  layout: Cell<Map<string, PackRect>>,
  chart: {
    setHover(id: string | null): void;
    setFocus(id: string | null): void;
    focusCell: Cell<string | null>;
    hoverCell: Cell<string | null>;
    _colorModeCell?: Cell<"flat" | "depth" | "mono" | undefined>;
  },
  present?: Read<boolean>,
  _defs?: SVGDefsElement,
): Shape {
  const lr = derive(() => layout.value.get(node.id) ?? { cx: 0, cy: 0, r: 0 });
  const cx = derive(() => lr.value.cx);
  const cy = derive(() => lr.value.cy);
  const r = derive(() => Math.max(0, lr.value.r));

  const fillColor = chart?._colorModeCell;
  const fill = derive(() => resolveFill(node.color, node.depth, fillColor?.value));

  const stroke = derive(() =>
    chart.focusCell.value === node.id ? "#fff"
    : chart.hoverCell.value === node.id ? "#c8cdd6"
    : node.depth === 0 ? "#444" : "#0b0d12",
  );
  const strokeWidth = derive(() => {
    const sep = motion.separation.value;
    return (chart.focusCell.value === node.id || chart.hoverCell.value === node.id)
      ? Math.max(2, sep * 2) : sep;
  });

  const disc = circle(Vec.derive(() => ({ x: cx.value, y: cy.value })), r, {
    fill,
    stroke,
    strokeWidth,
  });
  disc.el.setAttribute("data-id", node.id);
  // Root (depth 0) is the invisible container — transparent, no pointer
  // events, no cursor. It's in the layout map for the affine transform but
  // must not intercept clicks on its children.
  if (node.depth === 0) {
    disc.el.style.pointerEvents = "none";
    disc.el.style.cursor = "default";
  } else {
    disc.el.style.cursor = "grab";
    disc.el.style.pointerEvents = "all";
  }

  // Visibility gate: opacity + pointer-events.
  if (present) {
    effect(() => {
      const vis = present.value;
      disc.el.style.opacity = vis ? "" : "0";
      disc.el.style.pointerEvents = vis ? "all" : "none";
    });
  }

  // Hover + focus.
  disc.el.addEventListener("pointerenter", () => chart.setHover(node.id));
  disc.el.addEventListener("pointerleave", () => chart.setHover(null));
  disc.el.addEventListener("click", () => {
    chart.setFocus(node.id);
    (disc.el as SVGElement).focus?.();
  });

  // Label for leaf nodes with enough room.
  if (node.children.length === 0) {
    const text = derive(() => {
      if (r.value <= 14) return "";
      return `${node.label}\n${node.value.toFixed(0)}`;
    });
    const lbl = label(Vec.derive(() => ({ x: cx.value, y: cy.value })), text, {
      size: 10,
      align: Anchor.Center,
      fill: labelColorFor(node.color),
    });
    lbl.el.style.pointerEvents = "none";
    const grp = group();
    grp.add(disc, lbl);
    return grp;
  }

  return disc;
}
