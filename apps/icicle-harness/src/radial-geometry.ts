// radial-geometry.ts — sunburst-specific radial geometry.
// Mirrors hierarchy.ts (icicle) structure but with per-arc num() cells
// (spec §5: CSS can't transition path `d`, so arcs own cells that the
// settle behavior tweens/snaps). makeArc creates the cells, an effect
// writes layout targets to them, annularSector reads from them.
// makeAngularHandle reads from the same cells so handles stay in sync.
//
// Label transform follows the d3 zoomable-sunburst pattern:
// rotate(midAngle - 90) translate(midRadius, 0) rotate(flip)
// with text-anchor: middle, dy: 0.35em, and flip = midAngle < 180 ? 0 : 180.

import {
  Anchor,
  annularSector,
  derive,
  effect,
  group,
  label,
  num,
  rect,
  readNow,
  Vec,
  type Cell,
  type Num,
  type Read,
  type Shape,
  type Writable,
} from "bireactive";
import type { ChartConfig, RadialRect, RenderNode } from "./types";
import {
  type ChartNode,
  type Edge,
  findNode,
  sortedChildren,
  treeDepth,
} from "./tree";

const TWO_PI = Math.PI * 2;

/** Per-arc writable cells. Created in makeArc, registered in a Map so
 *  makeAngularHandle can read from the same cells. annularSector reads
 *  from these cells; the effect writes layout targets to them. */
export interface ArcCells {
  la0: Writable<Num>;
  la1: Writable<Num>;
  lrIn: Writable<Num>;
  lrOut: Writable<Num>;
}

/** Map of per-arc cells by node id. Shared between makeArc (writer)
 *  and makeAngularHandle (reader). Created in the chart's forEach. */
export type ArcCellsMap = Map<string, ArcCells>;

/**
 * Compute the radial layout: a d3-hierarchy-style partition walk that
 * assigns each node an angular span [a0, a1] (sibling axis) and a radial
 * span [rIn, rOut] (depth axis). The root spans [0, 2π]; each level's
 * children subdivide their parent's angular span proportionally by value.
 *
 * Drill: when `drillId` is set, the focus node's angular span is scaled to
 * fill [0, 2π] and its radial span starts at 0 — the radial analog of the
 * icicle's affine layout transform. d3-style angle clamping
 * (Math.max(0, Math.min(1, ...))) collapses off-subtree nodes to zero-width.
 */
export function computeRadialLayout(
  root: ChartNode,
  config: ChartConfig,
  frozenOrder: Map<string, string[]> | null | undefined,
  W: number,
  H: number,
  drillId?: string | null,
): Map<string, RadialRect> {
  const maxDepth = Math.min(config.depth ?? 100, treeDepth(root));
  const showRoot = config.showRoot !== false;
  const map = new Map<string, RadialRect>();

  const Rfull = Math.max(0, Math.min(W, H) / 2 - 4);

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
  const numBands = maxDepth;
  const band = numBands > 0 ? Rfull / numBands : Rfull;

  function setArc(id: string, a0: number, a1: number, d: number) {
    const depthPos = (d - visDepthStart) * band;
    map.set(id, { a0, a1, rIn: depthPos, rOut: depthPos + band });
  }

  function partition(n: ChartNode, a0: number, a1: number, d: number) {
    setArc(n.id, a0, a1, d);
    const children = sortedChildren(n, config, frozenOrder);
    const totalValue = children.reduce((s, c) => s + c.value.value, 0);
    const span = a1 - a0;
    let cur = a0;
    for (const c of children) {
      const w = totalValue > 0 ? (c.value.value / totalValue) * span : 0;
      partition(c, cur, cur + w, d + 1);
      cur += w;
    }
  }

  partition(root, 0, TWO_PI, 0);

  // D3-style drill transform: scale the angular domain so the focus node's
  // angular span fills [0, 2π], shift radial so focus inner radius → 0.
  // Clamp angles to [0, 2π] (d3 pattern) — off-subtree nodes collapse to
  // zero-width slivers rather than producing degenerate arc paths.
  if (drillId) {
    const focusArc = map.get(drillId);
    if (focusArc) {
      const focusA0 = focusArc.a0;
      const focusSpan = focusArc.a1 - focusArc.a0;
      const angleScale = focusSpan > 0 ? TWO_PI / focusSpan : 1;
      const focusRIn = focusArc.rIn;

      for (const [id, r] of map) {
        const rawA0 = (r.a0 - focusA0) * angleScale;
        const rawA1 = (r.a1 - focusA0) * angleScale;
        // d3-style clamp: Math.max(0, Math.min(1, ...)) * 2π
        const clampedA0 = Math.max(0, Math.min(1, rawA0 / TWO_PI)) * TWO_PI;
        const clampedA1 = Math.max(0, Math.min(1, rawA1 / TWO_PI)) * TWO_PI;
        map.set(id, {
          a0: clampedA0,
          a1: clampedA1,
          rIn: Math.max(0, r.rIn - focusRIn),
          rOut: Math.max(0, r.rOut - focusRIn),
        });
      }
    }
  }

  return map;
}

/**
 * Build the sunburst rendered set: ALL descendants of the logical root
 * (drill focus or tree root). Sunburst discards ancestors of the focus
 * node — off-angle siblings produce degenerate arcs (sunburst.md §2).
 */
export function buildAllDescendantsRadial(
  root: ChartNode,
  config: ChartConfig,
  frozenOrder?: Map<string, string[]> | null,
  drillId?: string | null,
): RenderNode[] {
  const maxDepth = Math.min(config.depth ?? 100, treeDepth(root));
  const showRoot = config.showRoot !== false;
  const result: RenderNode[] = [];

  let logicalRoot: ChartNode = root;
  let logicalRootDepth = 0;
  if (drillId) {
    const focus = findNode(root, drillId);
    if (focus) {
      logicalRoot = focus;
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
  const maxVisibleDepth = logicalRootDepth + maxDepth;

  function build(n: ChartNode, depth: number, parentId: string | null): RenderNode {
    const children: RenderNode[] = [];
    const isLeaf = n.children.length === 0;
    const present = depth >= visDepthStart && depth <= maxVisibleDepth;
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

  build(logicalRoot, logicalRootDepth, null);
  return result;
}

const ARC_PAD = 0.004; // radians — small angular gap between adjacent arcs

/**
 * Render an annular sector (arc) for a sunburst node.
 * Creates per-arc num() cells (spec §5) and registers them in arcCellsMap.
 * The chart's settle effect (settleArcCells) writes layout targets to them.
 * annularSector reads from the cells. Label uses d3-style transform.
 */
export function makeArc(
  node: RenderNode,
  layout: Cell<Map<string, RadialRect>>,
  center: Vec,
  arcCellsMap: ArcCellsMap,
  chart?: {
    setHover(id: string | null): void;
    setFocus(id: string | null): void;
    focusCell: Cell<string | null>;
    hoverCell: Cell<string | null>;
  },
  present?: Read<boolean>,
  defs?: SVGDefsElement,
): Shape {
  // Per-arc cells — annularSector reads from these. The chart-level
  // settleArcCells effect writes layout targets to them (spec §5).
  const seed = layout.value.get(node.id) ?? { a0: 0, a1: 0, rIn: 0, rOut: 0 };
  const cells: ArcCells = {
    la0: num(seed.a0),
    la1: num(seed.a1),
    lrIn: num(seed.rIn),
    lrOut: num(seed.rOut),
  };
  arcCellsMap.set(node.id, cells);

  const visible = present ? derive(() => readNow(present)) : null;

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

  const arc = annularSector(center, cells.lrOut, cells.lrIn, cells.la0, cells.la1, {
    fill: node.color,
    stroke,
    strokeWidth,
  });
  arc.el.style.cursor = "pointer";
  arc.el.setAttribute("data-id", node.id);

  if (chart) {
    arc.el.addEventListener("pointerenter", () => chart.setHover(node.id));
    arc.el.addEventListener("pointerleave", () => chart.setHover(null));
    arc.el.addEventListener("click", () => {
      chart.setFocus(node.id);
      (arc.el as SVGElement).focus?.();
    });
  }

  // Label: d3 zoomable-sunburst transform pattern.
  // rotate(midAngle - 90) translate(midRadius, 0) rotate(flip)
  // with text-anchor: middle, dy: 0.35em.
  // flip = midAngleDeg < 180 ? 0 : 180 — right half upright, left half flipped.
  const LABEL_MIN_SPAN = 0.08; // radians ~4.6°
  const LABEL_MIN_RADIAL = 18; // pixels
  const labelText = derive(() => {
    const span = cells.la1.value - cells.la0.value;
    const radial = cells.lrOut.value - cells.lrIn.value;
    if (span < LABEL_MIN_SPAN || radial < LABEL_MIN_RADIAL) return "";
    return node.label;
  });
  const lbl = label(
    Vec.derive(() => ({ x: 0, y: 0 })),
    labelText,
    { size: 10, align: Anchor.Center, fill: "#fff" },
  );
  lbl.el.setAttribute("dy", "0.35em");
  lbl.el.style.pointerEvents = "none";

  // Wrapper <g> carries the d3-style transform.
  const labelWrap = document.createElementNS("http://www.w3.org/2000/svg", "g");
  labelWrap.appendChild(lbl.el);

  const labelDispose = effect(() => {
    const midA = (cells.la0.value + cells.la1.value) / 2;
    const midR = (cells.lrIn.value + cells.lrOut.value) / 2;
    const midDeg = (midA * 180) / Math.PI;
    const cx = center.x.value;
    const cy = center.y.value;
    // d3 pattern: translate to center, rotate to radial, translate to midR, flip
    const flip = midDeg < 180 ? 0 : 180;
    labelWrap.style.transform =
      `translate(${cx}px, ${cy}px) rotate(${midDeg - 90}deg) translate(${midR}px, 0px) rotate(${flip}deg)`;
  });

  const g = group({}, arc);
  g.el.appendChild(labelWrap);
  (g as any).track?.(labelDispose);

  // Visibility gate: opacity + pointer-events. The transitionOnUpdated
  // behavior injects CSS that transitions opacity on path elements for
  // enter/exit fade. The gesture-active class suppresses it during draft.
  if (visible) {
    const visDispose = effect(() => {
      const vis = visible.value;
      arc.el.style.pointerEvents = vis ? "auto" : "none";
      arc.el.style.opacity = vis ? "1" : "0";
    });
    (g as any).track?.(visDispose);
  }

  return g;
}

const HANDLE_THICKNESS = 6; // pixels — radial thickness of the angular handle

/**
 * Render the tangent boundary knob between two adjacent sibling arcs.
 * Reads from the per-arc cells (same source as the arcs) so handles
 * stay in sync during settle. Mirrors makeHandle structure.
 */
export function makeAngularHandle(
  edge: Edge,
  arcCellsMap: ArcCellsMap,
  center: Vec,
  present?: Read<boolean>,
): Shape {
  // Read from per-arc cells — same source as the arcs.
  const leftCells = derive(() => arcCellsMap.get(edge.leftId));
  const rightCells = derive(() => arcCellsMap.get(edge.rightId));

  const boundaryAngle = derive(() => leftCells.value?.la1.value ?? 0);
  const rIn = derive(() => Math.max(0, leftCells.value?.lrIn.value ?? 0));
  const rOut = derive(() => Math.max(0, leftCells.value?.lrOut.value ?? 0));
  const radialSpan = derive(() => rOut.value - rIn.value);

  // Handle is a thin rect centered at origin. Wrapper <g> carries the
  // position+rotate transform (bireactive's Shape.el has its own transform).
  const handle = rect(
    derive(() => -HANDLE_THICKNESS / 2),
    derive(() => -radialSpan.value / 2),
    derive(() => HANDLE_THICKNESS),
    derive(() => radialSpan.value),
    { fill: "rgba(255,255,255,0.08)", stroke: "none" },
  );
  handle.el.style.pointerEvents = "all";
  (handle as any)._edge = edge;

  const wrapG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  wrapG.appendChild(handle.el);
  wrapG.setAttribute("data-edge", edge.id);
  wrapG.style.cursor = "move";

  const transformDispose = effect(() => {
    const ang = boundaryAngle.value;
    const midR = (rIn.value + rOut.value) / 2;
    const x = center.x.value + midR * Math.cos(ang);
    const y = center.y.value + midR * Math.sin(ang);
    const deg = (ang * 180) / Math.PI + 90; // +90° so rect is tangent to arc
    wrapG.style.transform = `translate(${x}px, ${y}px) rotate(${deg}deg)`;
  });

  if (present) {
    const visDispose = effect(() => {
      const vis = readNow(present);
      handle.el.style.pointerEvents = vis ? "all" : "none";
    });
    (handle as any).track?.(visDispose);
  }

  (handle as any).track?.(transformDispose);

  const g = group({});
  g.el.appendChild(wrapG);
  (g as any)._edge = edge;
  return g;
}

/**
 * Chart-level settle effect: watches the layout cell and writes targets
 * to all per-arc cells. Created OUTSIDE forEach's untracked context so
 * the effect properly subscribes to the layout cell. Snap mode for now
 * (no tween). The spec §5 two-lane snap/tween split will be wired here.
 */
export function settleArcCells(
  layout: Cell<Map<string, RadialRect>>,
  arcCellsMap: ArcCellsMap,
): () => void {
  return effect(() => {
    const map = layout.value;
    let count = 0;
    for (const [id, cells] of arcCellsMap) {
      const target = map.get(id);
      if (!target) continue;
      cells.la0.value = target.a0;
      cells.la1.value = target.a1;
      cells.lrIn.value = target.rIn;
      cells.lrOut.value = target.rOut;
      count++;
    }
  });
}
