// Shared renderer for every spike. The four tabs differ ONLY in their
// layout algorithm; node/edge/hull rendering is the same code.
//
//   renderNode(s, posCell, opts)   → rect Shape (label-sized, draggable)
//   renderEdge(s, fromShape, toShape) → arrow connecting borders
//   renderHull(s, hullBox, depth, label) → nested-container chrome
//
// Whole-rect drag (no Handle dot) — the spike passes a dragging cell so
// its layout can read it and pause re-layout while drag is active.

import {
  arrow,
  Box,
  type Cell,
  derive,
  drag,
  effect,
  label as labelShape,
  type Mount,
  pathD,
  rect,
  type Shape,
  Vec,
  type Writable,
} from "@bireactive";
import { edgeStyle, type EdgeStyle } from "./diagram-settings";

// Heuristic glyph width (SVG can't measure synchronously). 0.6 of the
// font size matches bireactive's own `tokens.charWidth`. Good enough
// for ASCII labels; if it underestimates, the label still renders, just
// might overflow — preferable to async measurement during layout.
const CHAR_W = 0.62;
export const FONT_PX = 11.5;
const PAD_X = 14;
const NODE_H = 28;

export interface NodeSize {
  w: number;
  h: number;
}

/** Measured size from a label string. Layouts call this BEFORE laying out
 *  so they know each node's footprint. */
export function nodeSize(name: string): NodeSize {
  const minW = 56;
  const textW = Math.ceil(name.length * FONT_PX * CHAR_W);
  return { w: Math.max(minW, textW + 2 * PAD_X), h: NODE_H };
}

/** Hull padding that matches renderHull's chrome. `top` is generous so
 *  the chip header doesn't overlap the topmost member rect; the other
 *  three sides shrink slightly with depth so nested panels nest tightly
 *  instead of inflating with every level. */
export function hullPad(depth: number): { top: number; bottom: number; left: number; right: number } {
  const sides = Math.max(8, 14 - depth * 3);
  // Chip is drawn INSIDE the footprint's top region. The hull's top
  // padding must reserve space for the chip so leaves don't slide
  // under it. CHIP_HEIGHT_TOTAL = chip rect + a few px breathing room
  // below it.
  return { top: CHIP_HEIGHT_TOTAL, bottom: sides, left: sides, right: sides };
}

/** Vertical space the chip header consumes inside a GROUP's footprint.
 *  GROUP chrome and renderHull MUST agree on this value. */
export const CHIP_HEIGHT_TOTAL = 22;

export interface NodeRenderOpts {
  label: string;
  draggable?: boolean;
  dragging?: Writable<Cell<boolean>>;
  /** Visual variant. Default 'leaf'. Container = lighter, label-on-fill. */
  variant?: "leaf" | "container";
}

/** Render a single node: a rect sized to the label, with the label
 *  centered. Returns the rect Shape so callers can wire edges to it via
 *  `renderEdge(s, fromShape, toShape)`. */
export function renderNode(
  s: Mount,
  posCell: Writable<Vec>,
  opts: NodeRenderOpts,
): { shape: Shape; size: NodeSize; dispose: () => void } {
  const sz = nodeSize(opts.label);
  const r = rect(posCell, sz.w, sz.h, {
    fill: "var(--accent)",
    stroke: "var(--text-color)",
    thin: true,
    corner: 6,
    opacity: 0.92,
  });
  s(r);
  const lbl = s(labelShape(posCell, opts.label, { size: FONT_PX, bold: true, fill: "white" }));
  // Labels render on top — disable pointer events so clicks fall
  // through to the rect underneath.
  const lblEl = (lbl as unknown as { el?: SVGElement }).el;
  if (lblEl) lblEl.style.pointerEvents = "none";
  let dispose = (): void => {};
  if (opts.draggable) {
    dispose = drag(r, posCell, opts.dragging);
  }
  return { shape: r, size: sz, dispose };
}

/** Render an edge between two node shapes. `connect`/`arrow` use
 *  `shape.boundary(toward)` to anchor edges on the border, not the
 *  centre — proper cleanliness regardless of node size. */
export function renderEdge(s: Mount, from: Shape, to: Shape): Shape {
  return s(arrow(from, to, { thin: true, opacity: 0.7 }));
}

/** Render an edge using the current diagram-level edge style (straight /
 *  curved / elbow). The style cell is reactive — the path's `d` re-derives
 *  when the user toggles styles, and (importantly) when node positions
 *  change via the spring layer.
 *
 *  - straight: existing arrow().
 *  - curved: cubic bezier with control points pulled along the dominant
 *    axis. Symmetric, smooth, no inflection.
 *  - elbow: two-segment polyline with a rounded corner (quadratic curve
 *    at the bend). Direction picks the axis with more travel. */
export function renderEdgeStyled(s: Mount, from: Shape, to: Shape): Shape {
  const ARROW_MARKER = "url(#bireactive-arrow)";
  const ARROW_W = 10;
  const ARROW_GAP = 4;

  // Reactive boundary points and the d-string for curved / elbow paths.
  const d = derive(() => {
    const style: EdgeStyle = edgeStyle.value;
    if (style === "straight") return ""; // unused — straight uses arrow()

    const aBase = from.boundary(to.center).value;
    const bBase = to.boundary(from.center).value;
    const dx = bBase.x - aBase.x;
    const dy = bBase.y - aBase.y;
    const len = Math.hypot(dx, dy) || 1;
    // Pull start point a hair off the source and shorten the end so the
    // arrow marker sits nicely on the target border (mirrors arrow()).
    const ux = dx / len;
    const uy = dy / len;
    const aP = { x: aBase.x + ux * ARROW_GAP, y: aBase.y + uy * ARROW_GAP };
    const bP = {
      x: bBase.x - ux * (ARROW_GAP + ARROW_W),
      y: bBase.y - uy * (ARROW_GAP + ARROW_W),
    };

    if (style === "curved") {
      // Cubic with control points offset along dominant axis. Strength
      // ~40% of axis distance produces a gentle S-less curve.
      const horiz = Math.abs(dx) >= Math.abs(dy);
      const k = 0.45;
      const c1 = horiz
        ? { x: aP.x + (bP.x - aP.x) * k, y: aP.y }
        : { x: aP.x, y: aP.y + (bP.y - aP.y) * k };
      const c2 = horiz
        ? { x: bP.x - (bP.x - aP.x) * k, y: bP.y }
        : { x: bP.x, y: bP.y - (bP.y - aP.y) * k };
      return `M ${aP.x} ${aP.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${bP.x} ${bP.y}`;
    }

    // elbow: leave along dominant axis, turn, finish along the other.
    // Round the corner with a quadratic curve segment of radius R.
    const horizFirst = Math.abs(dx) >= Math.abs(dy);
    const elbow = horizFirst
      ? { x: bP.x, y: aP.y }
      : { x: aP.x, y: bP.y };
    const R = Math.min(14, Math.abs(dx) / 2, Math.abs(dy) / 2);
    // Approach + depart points around the elbow corner.
    const ap = horizFirst
      ? { x: elbow.x - Math.sign(dx) * R, y: elbow.y }
      : { x: elbow.x, y: elbow.y - Math.sign(dy) * R };
    const dp = horizFirst
      ? { x: elbow.x, y: elbow.y + Math.sign(dy) * R }
      : { x: elbow.x + Math.sign(dx) * R, y: elbow.y };
    return `M ${aP.x} ${aP.y} L ${ap.x} ${ap.y} Q ${elbow.x} ${elbow.y} ${dp.x} ${dp.y} L ${bP.x} ${bP.y}`;
  });

  // We render BOTH arrow() (for straight, with its analytic gap math)
  // and a pathD (for curved / elbow). Visibility flips by edgeStyle.
  const arrowShape = arrow(from, to, { thin: true, opacity: 0.7 });
  const p = pathD(d, { thin: true, stroke: "var(--text-color)", opacity: 0.7 });
  (p as unknown as { el: SVGElement }).el.setAttribute("marker-end", ARROW_MARKER);
  s(arrowShape);
  s(p);
  const arrowEl = (arrowShape as unknown as { el: SVGElement }).el;
  const pEl = (p as unknown as { el: SVGElement }).el;
  effect(() => {
    const straight = edgeStyle.value === "straight";
    arrowEl.style.display = straight ? "" : "none";
    pEl.style.display = straight ? "none" : "";
  });
  return p;
}

/** Render a container "hull" as a filled tinted panel with a chip-style
 *  header label inset at the top-left.
 *
 *  Panel = solid rounded rect, no dash, depth-shaded fill. Each nesting
 *  level layers a slightly more opaque tint on top of its parent so
 *  containment reads at a glance.
 *
 *  Chip header = small rounded rect *inside* the panel's top-left,
 *  sized to the label with horizontal padding. Because the chip lives
 *  inside its own panel (not above the top edge), nested-container
 *  labels never stack on the parent's chip — the parent's chrome
 *  separates them. */
export function renderHull(
  s: Mount,
  hullBox: Box,
  depth: number,
  label: string,
): Shape[] {
  const FILL_OPACITY = [0.05, 0.09, 0.13, 0.17];
  const CHIP_OPACITY = [0.22, 0.32, 0.42, 0.52];
  const fillOp = FILL_OPACITY[Math.min(depth, FILL_OPACITY.length - 1)]!;
  const chipOp = CHIP_OPACITY[Math.min(depth, CHIP_OPACITY.length - 1)]!;
  const cornerR = Math.max(6, 12 - depth * 2);

  // Panel
  const panel = s(
    rect(hullBox, {
      fill: "var(--accent)",
      opacity: fillOp,
      stroke: "var(--accent)",
      strokeWidth: 1,
      strokeOpacity: 0.18,
      corner: cornerR,
    }),
  );

  // Chip background sized to the label. Heuristic glyph width matches
  // nodeSize() above so this stays in sync with how rects are sized.
  const CHIP_PAD_X = 7;
  const CHIP_PAD_Y = 3;
  const CHIP_FONT = 10.5;
  const CHIP_H = CHIP_FONT + CHIP_PAD_Y * 2;
  const chipTextW = Math.ceil(label.length * CHIP_FONT * CHAR_W);
  const chipW = chipTextW + CHIP_PAD_X * 2;

  const INSET_X = 8;
  const INSET_Y = 6;

  const chipBox = Box.derive(() => {
    const b = hullBox.value;
    return { x: b.x + INSET_X, y: b.y + INSET_Y, w: chipW, h: CHIP_H };
  });

  const chip = s(
    rect(chipBox, {
      fill: "var(--accent)",
      opacity: chipOp,
      stroke: "var(--accent)",
      strokeWidth: 0,
      corner: 4,
    }),
  );

  // Label centred vertically inside the chip, left-aligned with chip padding.
  const labelPos = Vec.derive(() => {
    const b = hullBox.value;
    return {
      x: b.x + INSET_X + CHIP_PAD_X + chipTextW / 2,
      y: b.y + INSET_Y + CHIP_H / 2,
    };
  });

  const chipLbl = s(
    labelShape(labelPos, label, {
      size: CHIP_FONT,
      bold: true,
      fill: "var(--text-color)",
      opacity: 0.92,
    }),
  );
  const chipLblEl = (chipLbl as unknown as { el?: SVGElement }).el;
  if (chipLblEl) chipLblEl.style.pointerEvents = "none";

  return [panel, chip];
}
