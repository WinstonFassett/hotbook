// radial-geometry.ts — sunburst-specific radial geometry.
// Mirrors hierarchy.ts (icicle) structure but with per-arc num() cells
// (spec §5: CSS can't transition path `d`, so arcs own cells that the
// settle behavior tweens/snaps). makeArc creates the cells, an effect
// writes layout targets to them, annularSector reads from them.
// makeAngularHandle reads from the same cells so handles stay in sync.
//
// Label transform: rotate(midAngle) translate(midRadius, 0) rotate(flip)
// with text-anchor: middle, dy: 0.35em, and flip = midAngle in (90°, 270°) ? 180 : 0.
// annularSector uses standard math angles (0 = right, clockwise in SVG), so
// the label rotation matches directly — no -90 offset (that's the d3 convention
// where 0 = top, which doesn't apply here).

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
  untracked,
  Vec,
  type Cell,
  type Num,
  type Read,
  type Shape,
  type Writable,
} from "bireactive";
import type { ChartConfig, RadialRect, RenderNode } from "./types";
import type { Gesture } from "./gesture";
import { TRANSITION_DURATION } from "../lib/transitions";
import { motion } from "../lib/runtime-config";
import {
  type ChartNode,
  type Edge,
  findNode,
  sortedChildren,
  treeDepth,
  resolveFill,
  labelColorFor,
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
  // Visible window = [visDepthStart, windowEnd] (same convention as
  // hierarchy.ts): `config.depth` levels below the logical root, clamped to
  // the deepest node that exists. showRoot=true adds the root band.
  const windowEnd = Math.min(logicalRootDepth + maxDepth, treeDepth(root));
  const numBands = Math.max(1, windowEnd - visDepthStart + 1);
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
  // D3 zoomable sunburst pattern: ALWAYS render the full tree from the true
  // root. The layout transform (computeRadialLayout) collapses off-subtree
  // nodes to zero angular width on drill — they stay mounted at zero width
  // and animate back to full width on drill-out. No DOM removal/re-mount.
  const maxDepth = Math.min(config.depth ?? 100, treeDepth(root));
  const showRoot = config.showRoot !== false;
  const result: RenderNode[] = [];

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

  build(root, 0, null);
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
    _colorModeCell?: Cell<"flat" | "depth" | "mono" | undefined>;
  },
  present?: Read<boolean>,
  defs?: SVGDefsElement,
): Shape {
  // Per-arc cells — annularSector reads from these. The chart-level
  // settleArcCells effect writes layout targets to them (spec §5).
  // Seed at the target layout value so arcs appear at correct size on mount.
  // (Seeding at zero for expand-from-zero on drill-out doesn't work — the
  // settle effect fires before forEach mounts new arcs, so the tween never
  // picks them up. The collapse-to-zero on drill-in still works because
  // exiting arcs are already mounted and their cells are in arcCellsMap.)
  const seed = layout.value.get(node.id) ?? { a0: 0, a1: 0, rIn: 0, rOut: 0 };
  const cells: ArcCells = {
    la0: num(seed.a0),
    la1: num(seed.a1),
    lrIn: num(seed.rIn),
    lrOut: num(seed.rOut),
  };
  arcCellsMap.set(node.id, cells);

  const visible = present ? derive(() => readNow(present)) : null;
  // Cells are settle-driver targets only while this arc is mounted.
  // Disposal happens after the exit-delay window, so exiting arcs keep
  // their cells and animate to zero width via the settle tween (D3 zoomable
  // sunburst "collapse" metaphor — non-focus arcs are swallowed by the
  // expanding focus, not faded out in place).
  const cellCleanup = () => { arcCellsMap.delete(node.id); };

  // No exit freeze — arcs follow the layout cells all the way to zero width.
  // The layout already computes zero angular width for off-subtree nodes
  // (angular clamping in computeRadialLayout). The settle tween animates
  // the cells to those zero-width values, so exiting arcs collapse smoothly
  // instead of freezing and fading.
  const a0Effective = derive(() => cells.la0.value);
  const a1Effective = derive(() => cells.la1.value);
  const rInEffective = derive(() => cells.lrIn.value);
  const rOutEffective = derive(() => cells.lrOut.value);

  // Production sunburst look (matches main): every arc gets a thin
  // near-black stroke as the separator. Focus/hover bumps to 2px with
  // white/light-gray. The stroke IS the divider — no separate handle
  // rects needed for the clean rendering. Stroke width is driven by the
  // shared `motion.separation` cell so the tweaks pane retunes it live.
  // Innermost arc (full circle): no stroke — it's a solid disc, not a
  // slice, so a separator border is meaningless.
  const stroke = derive(() => {
    const span = a1Effective.value - a0Effective.value;
    if (span >= 2 * Math.PI - 0.01) return "none";
    if (!chart) return "#0b0d12";
    if (chart.focusCell.value === node.id) return "#fff";
    if (chart.hoverCell.value === node.id) return "#c8cdd6";
    return "#0b0d12";
  });
  const strokeWidth = derive(() => {
    const span = a1Effective.value - a0Effective.value;
    if (span >= 2 * Math.PI - 0.01) return 0;
    const sep = motion.separation.value;
    if (!chart) return sep;
    if (chart.focusCell.value === node.id || chart.hoverCell.value === node.id) return Math.max(2, sep * 2);
    return sep;
  });

  const arc = annularSector(center, rOutEffective, rInEffective, a0Effective, a1Effective, {
    fill: node.color,
    stroke,
    strokeWidth,
  });
  arc.el.style.cursor = "grab";
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
  // Innermost arc (full circle, span ≈ 2π): label renders at center, no rotation.
  const LABEL_MIN_SPAN = 0.08; // radians ~4.6°
  const LABEL_MIN_RADIAL = 18; // pixels
  const FULL_CIRCLE_SPAN = 2 * Math.PI - 0.01; // tolerance for float comparison
  const labelText = derive(() => {
    const span = a1Effective.value - a0Effective.value;
    const radial = rOutEffective.value - rInEffective.value;
    // Full-circle arc: always show label (it's the center disc).
    const isFullCircle = span >= FULL_CIRCLE_SPAN;
    if (!isFullCircle && (span < LABEL_MIN_SPAN || radial < LABEL_MIN_RADIAL)) return "";
    return node.label;
  });
  const lbl = label(
    Vec.derive(() => ({ x: 0, y: 0 })),
    labelText,
    { size: 11, align: Anchor.Center, fill: labelColorFor(node.color) },
  );
  lbl.el.setAttribute("dy", "0.35em");
  lbl.el.style.pointerEvents = "none";

  // Wrapper <g> carries the d3-style transform.
  const labelWrap = document.createElementNS("http://www.w3.org/2000/svg", "g");
  labelWrap.appendChild(lbl.el);
  labelWrap.setAttribute("data-label-wrap", "");

  const labelDispose = effect(() => {
    const span = a1Effective.value - a0Effective.value;
    const isFullCircle = span >= FULL_CIRCLE_SPAN;
    const cx = center.x.value;
    const cy = center.y.value;
    if (isFullCircle) {
      // Innermost disc: label at center, no rotation.
      labelWrap.setAttribute("transform", `translate(${cx},${cy})`);
      return;
    }
    const midA = (a0Effective.value + a1Effective.value) / 2;
    const midR = (rInEffective.value + rOutEffective.value) / 2;
    const midDeg = (midA * 180) / Math.PI;
    // annularSector uses standard math angles (cos/sin, 0 = right, clockwise
    // in SVG). The label transform must match: rotate(midDeg) places the label
    // at the arc's mid-angle. No -90 offset (that's the d3 convention where
    // 0 = top, but our arcs use 0 = right).
    // Flip labels on the left half (90°–270°) so they're not upside down.
    const flip = midDeg > 90 && midDeg < 270 ? 180 : 0;
    labelWrap.setAttribute(
      "transform",
      `translate(${cx},${cy}) rotate(${midDeg}) translate(${midR},0) rotate(${flip})`,
    );
  });

  const g = group({}, arc);
  g.el.appendChild(labelWrap);
  (g as any).track?.(labelDispose);
  (g as any).track?.(cellCleanup);

  // Visibility gate: pointer-events only. No opacity fade on exit — arcs
  // collapse to zero angular width (D3 zoomable sunburst metaphor), which
  // makes them visually disappear without needing opacity. The settle tween
  // animates the cells to zero width; withExitDelay keeps the arc mounted
  // during the collapse, then evicts.
  if (visible) {
    const visDispose = effect(() => {
      const vis = visible.value;
      arc.el.style.opacity = vis ? "" : "0";
      arc.el.style.pointerEvents = vis ? "auto" : "none";
    });
    (g as any).track?.(visDispose);
  }

  // Opacity transition so arcs fade (not vanish) on depth/drill changes.
  effect(() => {
    arc.el.style.transition = `opacity ${TRANSITION_DURATION.drill}ms ease-out`;
  });

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
  layout?: Cell<Map<string, RadialRect>>,
): Shape {
  // Read geometry from arcCellsMap (the ANIMATED cells) so handles stay in
  // sync with arcs during the settle tween. The cells are reactive (num()),
  // so derive() tracks them. If the arc isn't mounted yet (no cell entry),
  // fall back to the layout target so the handle has a sane initial position.
  const leftCells = () => arcCellsMap.get(edge.leftId);
  const boundaryAngle = derive(() => {
    const c = leftCells();
    if (c) return c.la1.value;
    return layout?.value.get(edge.leftId)?.a1 ?? 0;
  });
  const rIn = derive(() => {
    const c = leftCells();
    if (c) return Math.max(0, c.lrIn.value);
    return Math.max(0, layout?.value.get(edge.leftId)?.rIn ?? 0);
  });
  const rOut = derive(() => {
    const c = leftCells();
    if (c) return Math.max(0, c.lrOut.value);
    return Math.max(0, layout?.value.get(edge.leftId)?.rOut ?? 0);
  });
  const radialSpan = derive(() => rOut.value - rIn.value);

  // Handle is a thin rect centered at origin. Wrapper <g> carries the
  // position+rotate transform (bireactive's Shape.el has its own transform).
  const handle = rect(
    derive(() => -HANDLE_THICKNESS / 2),
    derive(() => -radialSpan.value / 2),
    derive(() => HANDLE_THICKNESS),
    derive(() => radialSpan.value),
    { fill: "rgba(0,0,0,0.15)", stroke: "none" },
  );
  handle.el.style.pointerEvents = "all";
  (handle as any)._edge = edge;

  const wrapG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  wrapG.appendChild(handle.el);
  wrapG.setAttribute("data-edge", edge.id);
  wrapG.style.cursor = "grab";

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
      handle.el.style.opacity = vis ? "" : "0";
    });
    (handle as any).track?.(visDispose);
  }

  (handle as any).track?.(transformDispose);

  const g = group({});
  g.el.appendChild(wrapG);
  (g as any)._edge = edge;
  return g;
}

/** Ease-out-quad easing function (matches d3.easeQuadOut). */
function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

// Settle duration is now a live cell read (WIN-352). Sampled at each anim's
// start below and stored on the per-arc anim state so an in-flight tween keeps
// its original duration but the next commit picks up the new value from the
// tweaks pane. `TRANSITION_DURATION.drill` is a getter on `motion.drillMs`
// (3× base by default = 300ms) — bumping base or drill retimes this.

/**
 * Chart-level settle driver: watches the layout cell and moves the per-arc
 * cells toward their targets. Spec §5: SNAP during draft (gesture-active),
 * TWEEN on commit/cancel/updated (~300ms ease-out). Interruptible: a new
 * layout change retargets from the arcs' current values, so an interrupted
 * settle/drill restarts cleanly from the current visual position.
 *
 * Architecture note: the reactive effect tracks ONLY the layout cell (and
 * calls the plain isDrafting getter). All reads of the per-arc cells are
 * untracked, and the animation runs in a single shared RAF loop OUTSIDE the
 * effect graph — the RAF's cell writes therefore never re-trigger the
 * effect. (The previous implementation read the cells inside the effect,
 * so every animation frame re-ran the effect and cancelled the in-flight
 * tweens — a livelock that froze drill transitions.)
 */
export function settleArcCells(
  layout: Cell<Map<string, RadialRect>>,
  arcCellsMap: ArcCellsMap,
  isDrafting: () => boolean,
): () => void {
  const anims = new Map<string, { from: RadialRect; to: RadialRect; start: number; duration: number }>();
  let raf: number | null = null;

  const writeCells = (cells: ArcCells, r: RadialRect) => {
    cells.la0.value = r.a0;
    cells.la1.value = r.a1;
    cells.lrIn.value = r.rIn;
    cells.lrOut.value = r.rOut;
  };

  const step = (now: number) => {
    raf = null;
    let live = false;
    for (const [id, a] of anims) {
      const cells = arcCellsMap.get(id);
      if (!cells) { anims.delete(id); continue; }
      const t = Math.min(1, (now - a.start) / a.duration);
      const e = easeOutQuad(t);
      writeCells(cells, {
        a0: a.from.a0 + (a.to.a0 - a.from.a0) * e,
        a1: a.from.a1 + (a.to.a1 - a.from.a1) * e,
        rIn: a.from.rIn + (a.to.rIn - a.from.rIn) * e,
        rOut: a.from.rOut + (a.to.rOut - a.from.rOut) * e,
      });
      if (t < 1) live = true;
      else anims.delete(id);
    }
    if (live) raf = requestAnimationFrame(step);
  };

  const dispose = effect(() => {
    const map = layout.value; // the ONLY tracked read
    const drafting = isDrafting();
    untracked(() => {
      const start = performance.now();
      for (const [id, cells] of arcCellsMap) {
        const target = map.get(id);
        if (!target) { anims.delete(id); continue; } // exiting arc: freeze where it is
        if (drafting) {
          anims.delete(id);
          writeCells(cells, target); // SNAP — immediate preview
          continue;
        }
        const from: RadialRect = {
          a0: cells.la0.value,
          a1: cells.la1.value,
          rIn: cells.lrIn.value,
          rOut: cells.lrOut.value,
        };
        if (
          from.a0 === target.a0 && from.a1 === target.a1 &&
          from.rIn === target.rIn && from.rOut === target.rOut
        ) {
          anims.delete(id);
          continue;
        }
        // Sample duration once per anim start so the tweaks pane retimes the
        // NEXT settle, but an in-flight tween keeps its original duration.
        anims.set(id, { from, to: target, start, duration: TRANSITION_DURATION.drill });
      }
      if (anims.size > 0 && raf === null) raf = requestAnimationFrame(step);
    });
  });

  return () => {
    if (raf !== null) cancelAnimationFrame(raf);
    anims.clear();
    dispose();
  };
}
