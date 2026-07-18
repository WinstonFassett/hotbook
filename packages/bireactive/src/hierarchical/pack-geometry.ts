// pack-geometry.ts — circle-packing layout and circle rendering.
// Uses d3-hierarchy's pack for the circle-packing algorithm.
// Rendering model: all descendants of the focus node (drilled subtree).
// Drill = re-run pack on the focused subtree, sized to the full canvas.
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
import { findNode, sortedChildren, resolveFill } from "./tree";

const PAD = 2;

/** Compute circle-packing layout for the focus subtree.
 *  Returns Map<nodeId, PackRect> for all descendants of the focus node
 *  (excluding the focus node itself — it is the invisible container). */
export function computePackLayout(
  root: ChartNode,
  config: ChartConfig,
  frozenOrder: Map<string, string[]> | null | undefined,
  W: number,
  H: number,
  drillId?: string | null,
): Map<string, PackRect> {
  const map = new Map<string, PackRect>();

  // Determine effective root: drill target if drilling, else tree root.
  let effectiveRoot = root;
  if (drillId) {
    const found = findNode(root, drillId);
    if (found) effectiveRoot = found;
  }

  if (effectiveRoot.children.length === 0) return map;

  // Build d3 hierarchy from the effective root, descending through ALL levels.
  const h = hierarchy(effectiveRoot, (d: ChartNode) => {
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
    .padding(PAD)(h);

  // Extract circles for ALL nodes EXCEPT the effective root.
  // Offset by (W - size) / 2 to center horizontally if canvas is wider than tall.
  const offsetX = (W - size) / 2;
  const offsetY = (H - size) / 2;
  const rootNode = h as HierarchyCircularNode<ChartNode>;
  const walk = (node: HierarchyCircularNode<ChartNode>) => {
    if (node.data.id !== effectiveRoot.id) {
      map.set(node.data.id, {
        cx: node.x + offsetX,
        cy: node.y + offsetY,
        r: node.r,
      });
    }
    for (const child of node.children ?? []) {
      walk(child as HierarchyCircularNode<ChartNode>);
    }
  };
  walk(rootNode);
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
  const strokeWidth = derive(() =>
    (chart.focusCell.value === node.id || chart.hoverCell.value === node.id) ? 2 : 1,
  );

  const disc = circle(Vec.derive(() => ({ x: cx.value, y: cy.value })), r, {
    fill,
    stroke,
    strokeWidth,
  });
  disc.el.style.cursor = "grab";
  disc.el.setAttribute("data-id", node.id);
  disc.el.style.pointerEvents = "all";

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
      fill: "rgba(255,255,255,0.85)",
    });
    lbl.el.style.pointerEvents = "none";
    const grp = group();
    grp.add(disc, lbl);
    return grp;
  }

  return disc;
}
