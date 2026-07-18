// hierarchy.ts — icicle-specific windowing + rectilinear geometry.
// Geometry-neutral tree ops (buildTree, findNode, snapshot/restore, sortedChildren,
// buildEdges, etc.) live in tree.ts and are re-exported here so existing
// `from "./hierarchy"` imports keep working. Radial geometry lives in
// radial-geometry.ts. No gesture policy here; that lives in gestures.ts.

import type { ChartConfig, LayoutRect, RenderNode } from "./types";
import { motion } from "../lib/runtime-config";
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
import {
  type ChartNode,
  type Edge,
  findNode,
  sortedChildren,
  treeDepth,
} from "./tree";

// Re-export geometry-neutral tree ops so existing consumers are unaffected.
export {
  type ChartNode,
  type Edge,
  buildTree,
  findNode,
  treeDepth,
  leafValues,
  snapshotValues,
  restoreValues,
  applyDraft,
  sortedChildren,
  buildEdges,
  resolveFill,
} from "./tree";

/** Walk the FULL tree — every descendant, not just the depth window.
 *  D3-style: all nodes mount once; `present` gates visibility. Off-window
 *  nodes (depth > maxDepth) get layout rects beyond the canvas edge and
 *  slide to/from there via CSS transitions + opacity fade.
 *
 *  Drill: when `drillId` is set, the focus node becomes the root of the
 *  visible window. `present` = node is in the focus's subtree AND relative
 *  depth ≤ maxDepth. Ancestors and off-subtree nodes stay mounted but are
 *  not present — they slide off-canvas via the layout transform. */
export function buildAllDescendants(
  root: ChartNode,
  config: ChartConfig,
  frozenOrder?: Map<string, string[]> | null,
  drillId?: string | null,
): RenderNode[] {
  const maxDepth = Math.min(config.depth ?? 100, treeDepth(root));
  const showRoot = config.showRoot !== false; // default true
  const result: RenderNode[] = [];

  // Logical root = drill focus (if drilling) or tree root.
  // visDepthStart = logical root's tree depth + (showRoot ? 0 : 1).
  // When showRoot=false, the logical root is hidden and its children
  // are the first visible row.
  let focusSubtreeIds: Set<string> | null = null;
  let logicalRootDepth = 0;
  if (drillId) {
    const focus = findNode(root, drillId);
    if (focus) {
      focusSubtreeIds = new Set<string>();
      function collect(n: ChartNode) {
        focusSubtreeIds!.add(n.id);
        for (const c of n.children) collect(c);
      }
      collect(focus);
      function findDepth(n: ChartNode, d: number): number {
        if (n.id === drillId) return d;
        for (const c of n.children) {
          const r = findDepth(c, d + 1);
          if (r >= 0) return r;
        }
        return -1;
      }
      logicalRootDepth = findDepth(root, 0);
    }
  }
  const visDepthStart = logicalRootDepth + (showRoot ? 0 : 1);
  // Last visible tree depth: `config.depth` levels below the logical root,
  // clamped to the deepest node that actually exists.
  const windowEnd = Math.min(logicalRootDepth + maxDepth, treeDepth(root));

  function build(n: ChartNode, depth: number, parentId: string | null): RenderNode {
    const children: RenderNode[] = [];
    const isLeaf = n.children.length === 0;
    // present: in the logical root's subtree (if drilling) AND within
    // the visible depth window [visDepthStart, logicalRootDepth + maxDepth].
    const present = focusSubtreeIds
      ? focusSubtreeIds.has(n.id) && depth >= visDepthStart && depth <= windowEnd
      : depth >= visDepthStart && depth <= windowEnd;
    const rn: RenderNode = {
      id: n.id,
      label: n.label,
      color: n.color,
      value: n.value.value,
      depth,
      parentId,
      isLeaf,
      present,
      children,
    };
    result.push(rn);
    for (const c of sortedChildren(n, config, frozenOrder)) {
      children.push(build(c, depth + 1, n.id));
    }
    return rn;
  }

  build(root, 0, null);
  return result;
}

export function computeLayout(
  root: ChartNode,
  config: ChartConfig,
  frozenOrder: Map<string, string[]> | null | undefined,
  W: number,
  H: number,
  drillId?: string | null,
): Map<string, LayoutRect> {
  const maxDepth = Math.min(config.depth ?? 100, treeDepth(root));
  const showRoot = config.showRoot !== false; // default true
  const isHoriz = config.orientation === "horizontal";
  const valueSpan = isHoriz ? H : W;
  const map = new Map<string, LayoutRect>();

  // Logical root = drill focus (if drilling) or tree root.
  let logicalRootDepth = 0;
  if (drillId) {
    function findDepth(n: ChartNode, d: number): number {
      if (n.id === drillId) return d;
      for (const c of n.children) {
        const r = findDepth(c, d + 1);
        if (r >= 0) return r;
      }
      return -1;
    }
    logicalRootDepth = findDepth(root, 0);
  }
  const visDepthStart = logicalRootDepth + (showRoot ? 0 : 1);
  // Number of visible depth bands = size of the visible depth window
  // [visDepthStart, windowEnd], where windowEnd is `config.depth` levels
  // below the logical root, clamped to the deepest node that exists. With
  // showRoot=false and no drill this equals maxDepth (the harness case);
  // with showRoot=true the root row occupies an extra band.
  const windowEnd = Math.min(logicalRootDepth + maxDepth, treeDepth(root));
  const numBands = Math.max(1, windowEnd - visDepthStart + 1);
  const band = isHoriz ? W / numBands : H / numBands;

  function setRect(id: string, v0: number, v1: number, d: number) {
    // Depth position relative to visDepthStart (first visible row = 0).
    const depthPos = (d - visDepthStart) * band;
    const size = v1 - v0;
    if (isHoriz) {
      map.set(id, { x: depthPos, y: v0, width: band, height: size });
    } else {
      map.set(id, { x: v0, y: depthPos, width: size, height: band });
    }
  }

  function partition(n: ChartNode, v0: number, v1: number, d: number) {
    setRect(n.id, v0, v1, d);
    const children = sortedChildren(n, config, frozenOrder);
    const totalValue = children.reduce((s, c) => s + c.value.value, 0);
    const span = v1 - v0;
    let cur = v0;
    for (const c of children) {
      const w = totalValue > 0 ? (c.value.value / totalValue) * span : 0;
      partition(c, cur, cur + w, d + 1);
      cur += w;
    }
  }

  partition(root, 0, valueSpan, 0);

  // D3-style drill transform: scale the value axis so the focus node's
  // span fills the canvas. Depth positions are already correct (relative
  // to the logical root via visDepthStart). Off-subtree nodes get pushed
  // off-canvas by the value scaling — they slide there via CSS transitions.
  if (drillId) {
    const focusRect = map.get(drillId);
    if (focusRect) {
      const focusV0 = isHoriz ? focusRect.y : focusRect.x;
      const focusSpan = isHoriz ? focusRect.height : focusRect.width;
      const scale = focusSpan > 0 ? valueSpan / focusSpan : 1;

      for (const [id, r] of map) {
        if (isHoriz) {
          const newV0 = (r.y - focusV0) * scale;
          const newSize = r.height * scale;
          map.set(id, { x: r.x, y: newV0, width: r.width, height: newSize });
        } else {
          const newV0 = (r.x - focusV0) * scale;
          const newSize = r.width * scale;
          map.set(id, { x: newV0, y: r.y, width: newSize, height: r.height });
        }
      }
    }
  }

  return map;
}


export function makeTile(
  node: RenderNode,
  layout: Cell<Map<string, LayoutRect>>,
  chart?: {
    setHover(id: string | null): void;
    setFocus(id: string | null): void;
    focusCell: Cell<string | null>;
    hoverCell: Cell<string | null>;
    _colorModeCell?: Cell<"flat" | "depth" | "mono" | undefined>;
  },
  present?: Read<boolean>,
  isHoriz?: Read<boolean>,
  defs?: SVGDefsElement,
  instanceId?: string,
): Shape {
  const pad = 2;

  // D3-style: every node always has a layout rect (computeLayout walks
  // the full tree). Off-window nodes have rects beyond the canvas edge.
  // No frozen/parent-rect fallback — the layout IS the source of truth.
  // Visibility is gated by `present` (opacity + pointer-events), not by
  // mount/unmount. CSS transitions animate the geometry + opacity.
  const liveRect = derive(() => {
    return layout.value.get(node.id) ?? { x: 0, y: 0, width: 0, height: 0 };
  });

  const rx = derive(() => liveRect.value.x + pad);
  const ry = derive(() => liveRect.value.y + pad);
  const rw = derive(() => Math.max(0, liveRect.value.width - pad * 2));
  const rh = derive(() => Math.max(0, liveRect.value.height - pad * 2));

  // Present gates visibility: in-window → opacity 1 + pointer-events auto;
  // off-window → opacity 0 + pointer-events none. The opacity transition
  // is inline (suppressed by gesture-active * { transition: none !important }).
  const visible = present ? derive(() => readNow(present)) : null;

  // Stroke reflects focus/selection and hover state — reads bireactive cells
  // so the derive re-runs automatically when focus/hover changes.
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
  tile.el.style.cursor = "grab";
  tile.el.setAttribute("data-id", node.id);

  // Wire focus/selection and hover if chart is provided.
  // dblclick for drill is handled at the host level (see icicle-chart.ts),
  // not per-tile — setPointerCapture in tileBodyDrag can prevent dblclick
  // from reaching individual tile elements.
  if (chart) {
    tile.el.addEventListener("pointerenter", () => chart.setHover(node.id));
    tile.el.addEventListener("pointerleave", () => chart.setHover(null));
    tile.el.addEventListener("click", () => {
      chart.setFocus(node.id);
      (tile.el as SVGRectElement).focus?.();
    });
  }

  // Label: positioned via CSS transform on a wrapper <g> (not SVG x/y
  // attributes) because CSS transitions animate transforms but NOT SVG
  // x/y on <text> elements. Size-gated (hidden when tile too small).
  //
  // Orientation-aware (reactive — updates when orientation changes):
  //   - Horizontal: top-left anchor, horizontal text.
  //   - Vertical: top-left anchor + rotate -90° around top-left, then
  //     translate to center of tile. Reads bottom-to-top.
  // Uses Anchor.TopLeft for both so the anchor doesn't need to change.
  const LABEL_PAD = 3;
  const labelText = derive(() => {
    const w0 = rw.value, h0 = rh.value;
    const h = isHoriz ? readNow(isHoriz) : true;
    if (h) {
      if (w0 <= 28 || h0 <= 16) return "";
    } else {
      if (w0 <= 16 || h0 <= 28) return "";
    }
    return node.label;
  });
  const lbl = label(
    Vec.derive(() => ({ x: 0, y: 0 })),
    labelText,
    { size: 10, align: Anchor.TopLeft, fill: "#1a1d24" },
  );
  lbl.el.style.pointerEvents = "none";

  // Wrapper <g> carries the label via CSS transform (translate + rotate).
  // Rotation applied here, not on the Shape, so it's a clean CSS transform.
  // Clipped to the tile rect so labels don't overflow.
  const labelWrap = document.createElementNS("http://www.w3.org/2000/svg", "g");
  labelWrap.appendChild(lbl.el);
  // Live-timed via motion.baseMs (WIN-352). 3× baseMs = settle role duration.
  effect(() => {
    labelWrap.style.transition = `transform ${motion.baseMs.value * 3}ms ease-out`;
  });

  // Per-tile clipPath — clips the label to the tile's rect dimensions.
  // Applied to the outer <g> (no CSS transform) so clipPath coordinates
  // are in SVG user space directly.
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
  const labelDispose = effect(() => {
    const h = isHoriz ? readNow(isHoriz) : true;
    if (h) {
      labelWrap.style.transform = `translate(${rx.value + LABEL_PAD}px, ${ry.value + LABEL_PAD}px)`;
    } else {
      labelWrap.style.transform = `translate(${rx.value + LABEL_PAD}px, ${ry.value + rh.value - LABEL_PAD}px) rotate(-90deg)`;
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

  // Pointer-events gate: off-window nodes can't capture clicks. No opacity
  // fade — off-window tiles slide off-canvas (clipped by the SVG viewport)
  // and slide back in. The geometry transition (rect x/y/w/h) handles the
  // visual; the SVG viewport's overflow:hidden does the clipping.
  if (visible) {
    const visDispose = effect(() => {
      tile.el.style.pointerEvents = visible.value ? "auto" : "none";
    });
    (g as any).track?.(visDispose);
  }

  return g;
}

const HANDLE_W = 6;

export function makeHandle(
  edge: Edge,
  layout: Cell<Map<string, LayoutRect>>,
  configCell: Cell<ChartConfig | null>,
  present?: Read<boolean>,
): Shape {
  const isHoriz = derive(() => configCell.value?.orientation === "horizontal");

  const hx = derive(() => {
    const lr = layout.value.get(edge.leftId);
    if (!lr) return 0;
    return isHoriz.value ? lr.x : lr.x + lr.width - HANDLE_W / 2;
  });

  const hy = derive(() => {
    const lr = layout.value.get(edge.leftId);
    if (!lr) return 0;
    return isHoriz.value ? lr.y + lr.height - HANDLE_W / 2 : lr.y;
  });

  const hw = derive(() => {
    if (isHoriz.value) return layout.value.get(edge.leftId)?.width ?? 0;
    return HANDLE_W;
  });

  const hh = derive(() => {
    if (isHoriz.value) return HANDLE_W;
    return layout.value.get(edge.leftId)?.height ?? 0;
  });

  const handle = rect(hx, hy, hw, hh, { fill: "rgba(255,255,255,0.15)", stroke: "none" });
  handle.el.setAttribute("data-edge", edge.id);
  handle.effect(() => {
    handle.el.style.cursor = isHoriz.value ? "row-resize" : "col-resize";
  });
  handle.el.style.pointerEvents = "all";
  (handle as any)._edge = edge;

  // Pointer-events gate: handle can't capture clicks when either sibling
  // is off-window. No opacity fade — same physical metaphor as tiles.
  if (present) {
    const visDispose = effect(() => {
      const vis = readNow(present);
      handle.el.style.pointerEvents = vis ? "all" : "none";
    });
    (handle as any).track?.(visDispose);
  }

  return handle;
}
