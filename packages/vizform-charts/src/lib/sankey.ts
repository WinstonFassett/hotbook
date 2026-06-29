import {
  Anchor,
  cell,
  circle,
  derive,
  effect as biEffect,
  label,
  pathD,
  rect,
  Vec,
  type Diagram,
  type Mount,
  type Num,
  type Writable,
} from "bireactive";
import { scaleSequential } from "d3-scale";
import { interpolateCool } from "d3-scale-chromatic";
import { wheelController, dynamicWheelStep } from "./interaction";
import { dragCancelable } from "./esc-contract";
import {
  buildTopology,
  computeLayout,
  ribbonPath,
  type SankeyLayout,
  type SankeyTopology,
} from "./sankey-layout";

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export type NodeColorProp = "layer" | "depth" | "height" | "index";
export type LinkColorMode = "source" | "target" | "static";

function nodeColorScale(
  layers: number[],
  prop: NodeColorProp,
  interp: (t: number) => string,
): string[] {
  // Only "layer" and "index" are meaningful without d3's depth/height; map the
  // others onto layer so existing color chips still cycle through something.
  const vals = layers.map((l, i) => (prop === "index" ? i : l));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const scale = scaleSequential(interp).domain([lo, hi === lo ? lo + 1 : hi]);
  return vals.map((v) => scale(v));
}

// ---------------------------------------------------------------------------
// Scene builder
// ---------------------------------------------------------------------------

export interface LinkDef { source: string | number; target: string | number; init: number }

export interface SankeySceneOptions {
  W: number;
  H: number;
  nodeIds: string[];
  linkDefs: LinkDef[];
  /** Optional group id per node, aligned to nodeIds. Same-group nodes are
   *  stacked contiguously within their column; each cluster gets a labeled
   *  container rendered behind the bars. null/undefined = ungrouped. */
  groups?: (string | null)[];
  nodeWidth?: number;
  nodePadding?: number;
  /** Extra px between adjacent nodes from DIFFERENT groups in the same
   *  column. Ignored if no node has a group. Defaults to 0. */
  groupGap?: number;
  interp?: (t: number) => string;
  labelSize?: number;
  // Explicit string-id mode (true = node IDs are strings, false = numeric indices)
  stringIds?: boolean;
  // Reactive color mode cells (optional — pass pre-created cells to share across UI)
  nodeColorProp?: ReturnType<typeof cell<NodeColorProp>>;
  linkColorMode?: ReturnType<typeof cell<LinkColorMode>>;
  // Custom step size fn — defaults to 1 (shift=5). Use e.g. v => v * 0.1 for proportional.
  stepFn?: (currentVal: number, shift: boolean) => number;
  /** Called when a node BAR is double-clicked. Index is into `nodeIds`. The
   *  hierarchical sankey uses this to toggle expand/collapse. Wins over
   *  the default click behavior (which has none on nodes today). */
  onNodeClick?: (nodeIdx: number) => void;
  /** Per-node visual flag: true = render as a clickable group affordance
   *  (dashed stroke + cursor:pointer). Index aligns to `nodeIds`. */
  nodeIsGroup?: boolean[];
  /** Per-node collapsed state: true = this node is a collapsed group (shows +),
   *  false = expanded or not a group (shows - if it's a group). Index aligns to `nodeIds`. */
  nodeIsCollapsed?: boolean[];
}

const LINK_MIN = 0.5; // floor so a flow never collapses to an ungrabbable sliver

/**
 * Pick the constant px-per-unit ONCE from the initial values so the diagram opens
 * sized to ~fit H (heaviest column fills the height). After this it is held
 * constant — the diagram grows/shrinks honestly; it is the viewer's job to keep
 * it framed. This is the only place fit-to-height is consulted, and only at t=0.
 */
function initialPxPerUnit(
  topology: SankeyTopology,
  values: number[],
  H: number,
  nodePadding: number,
): number {
  const inSum: number[] = new Array(topology.nodeCount).fill(0);
  const outSum: number[] = new Array(topology.nodeCount).fill(0);
  for (let i = 0; i < topology.src.length; i++) {
    const v = Math.max(0, values[i]!);
    outSum[topology.src[i]!]! += v;
    inSum[topology.tgt[i]!]! += v;
  }
  let ppu = Infinity;
  for (const col of topology.columns) {
    if (col.length === 0) continue;
    const tot = col.reduce((a, n) => a + Math.max(inSum[n]!, outSum[n]!), 0);
    const avail = H - nodePadding * (col.length - 1);
    if (tot > 0) ppu = Math.min(ppu, avail / tot);
  }
  return isFinite(ppu) && ppu > 0 ? ppu : 1;
}

/**
 * Viewer side of the decoupling: reactively frame the diagram's announced bounds
 * into the host SVG via the viewBox. As the figure grows/shrinks (editing flows)
 * the viewBox tracks its bounds — a pure transform, never a geometry recompute.
 * `preserveAspectRatio` keeps it centered and uniformly scaled. The SVG's CSS box
 * is whatever the host/tile gives it (auto-height in the spike, a fixed resizable
 * tile in sliceboard); the viewBox maps data-space → that box either way.
 */
function fitHostToBounds(host: Diagram, layout: { value: { bounds: { x: number; y: number; w: number; h: number } } }): void {
  const svg = (host as any).svg as SVGSVGElement;
  const PAD = 8;
  biEffect(() => {
    const b = layout.value.bounds;
    const x = b.x - PAD, y = b.y - PAD, w = b.w + PAD * 2, h = b.h + PAD * 2;
    svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  });
}

export function sankeyScene(
  host: Diagram,
  s: Mount,
  opts: SankeySceneOptions,
) {
  const {
    W, H, nodeIds, linkDefs,
    nodeWidth = 12, nodePadding = 6,
    interp = interpolateCool, labelSize = 10,
    groups,
    groupGap = groups ? 16 : 0,
    onNodeClick,
    nodeIsGroup,
    nodeIsCollapsed,
  } = opts;
  const stepFn = opts.stepFn ?? ((v: number, shift: boolean) => dynamicWheelStep(v, shift));

  const nodeColorProp = opts.nodeColorProp ?? cell<NodeColorProp>("layer");
  const linkColorMode = opts.linkColorMode ?? cell<LinkColorMode>("source");

  host.tabIndex = 0;
  host.style.outline = "none";

  // Resolve link endpoints to node indices.
  const idToIdx = new Map<string, number>();
  nodeIds.forEach((id, i) => idToIdx.set(id, i));
  const resolve = (v: string | number) =>
    typeof v === "number" ? v : (idToIdx.get(v) ?? -1);
  const src = linkDefs.map((l) => resolve(l.source));
  const tgt = linkDefs.map((l) => resolve(l.target));

  // Writable value cell per link — THE editable roots. Geometry is a pure
  // function of these, so a grip write recomputes positions with no relayout.
  const linkValues = linkDefs.map((l, i) => ({
    source: l.source,
    target: l.target,
    value: cell(Math.max(LINK_MIN, l.init)),
    src: src[i]!,
    tgt: tgt[i]!,
  }));

  // Static topology (once). Sizing is a pure function of the value cells at a
  // CONSTANT px-per-unit ruler — no fit-to-height in the hot path, so editing a
  // flow never rescales the rest of the diagram (the d3-sankey rubberiness we
  // dropped d3 to avoid). The diagram grows/shrinks in its own space; the viewer
  // frames the announced bounds (below).
  const topology: SankeyTopology = buildTopology(nodeIds.length, src, tgt, groups);

  // Choose the ruler ONCE from the initial values so the diagram opens sized to
  // fit ~H, then hold it constant. Every later pixel↔value conversion (drag,
  // wheel, grip placement) uses THIS same pxPerUnit, so all manipulation is at
  // the scale the geometry was drawn at.
  const pxPerUnit = initialPxPerUnit(topology, linkValues.map((l) => l.value.value), H, nodePadding);
  const dims = { W, pxPerUnit, nodeWidth, nodePadding, groupGap };

  const layout = derive<SankeyLayout>(() =>
    computeLayout(topology, linkValues.map((l) => l.value.value), dims)
  );

  // Viewer policy (decoupled from geometry): frame the diagram's announced
  // bounds into the host. The diagram reports its size; the viewBox transform
  // fits it — a GPU transform, never a geometry recompute. Reactive, so as the
  // figure grows/shrinks the framing tracks it without reflowing anything.
  // (Spike demos: this auto-fits the growing figure. Sliceboard's fixed tile
  //  simply imposes its own box on the same element — same diagram, two viewers.)
  fitHostToBounds(host, layout);

  const nodeColors = derive(() =>
    nodeColorScale(topology.layer, nodeColorProp.value, interp)
  );

  const hovered = cell<number | null>(null);
  const focused = cell<number | null>(null);
  // Reactive mirror of the active wheel target so the demo label can show the
  // link being edited mid-gesture (the gesture object itself is plain).
  const wheelLocked = cell<number | null>(null);
  const ribbonEls = new Map<Element, number>();

  // Wheel edits a link by index; snapshot/restore the one link cell's value.
  const wheelConfig = {
    snapshot: (idx: number) => linkValues[idx]!.value.value,
    restore: (idx: number, v: number) => { linkValues[idx]!.value.value = v; },
    onEnd: () => { wheelLocked.value = null; hovered.value = null; tooltipVis.value = false; },
  };

  const hitTestRibbon = (clientX: number, clientY: number): number | null => {
    const shadow = (host as any).shadowRoot as ShadowRoot | null;
    const el = shadow ? shadow.elementFromPoint(clientX, clientY) : document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const direct = ribbonEls.get(el);
    if (direct !== undefined) return direct;
    const parent = ribbonEls.get(el.parentElement as Element);
    return parent !== undefined ? parent : null;
  };

  host.addEventListener("wheel", ((e: WheelEvent) => {
    if (!e.ctrlKey) return;
    const idx = wheelController.begin(
      hovered.value ?? focused.value ?? hitTestRibbon(e.clientX, e.clientY),
      wheelConfig,
    );
    if (idx === null) return;
    wheelLocked.value = idx;
    e.preventDefault();
    const v = linkValues[idx]!.value;
    const step = stepFn(v.value, e.shiftKey);
    v.value = Math.max(LINK_MIN, v.value + (e.deltaY < 0 ? +step : -step));
    const b = layout.value.links[idx]!;
    const sn = nodeIds[b.src] ?? String(b.src);
    const tn = nodeIds[b.tgt] ?? String(b.tgt);
    tooltipText.value = `${sn} → ${tn}: ${v.value.toFixed(1)}`;
  }) as EventListener, { passive: false });

  host.addEventListener("keydown", ((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // Drag-Esc is owned by each grip's gesture. Here: clear focus, else fall through.
      if (focused.value !== null) { focused.value = null; e.preventDefault(); }
      return;
    }
    if (e.key === "Tab") {
      const cur = focused.value;
      focused.value = e.shiftKey
        ? ((cur ?? 0) - 1 + linkValues.length) % linkValues.length
        : ((cur ?? -1) + 1) % linkValues.length;
      e.preventDefault(); return;
    }
    const idx = focused.value;
    if (idx === null) return;
    const v = linkValues[idx]!.value;
    const step = stepFn(v.value, e.shiftKey);
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { v.value = Math.max(LINK_MIN, v.value + step); e.preventDefault(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { v.value = Math.max(LINK_MIN, v.value - step); e.preventDefault(); }
  }) as EventListener);

  // Tooltip
  const svgEl = (host as any).svg as SVGSVGElement;
  const toSVG = (e: PointerEvent) => {
    const r = svgEl.getBoundingClientRect();
    const vb = svgEl.viewBox?.baseVal;
    const sx = vb && vb.width ? vb.width / r.width : 1;
    const sy = vb && vb.height ? vb.height / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };
  const tooltipText = cell("");
  const tooltipAt = cell({ x: 0, y: 0 });
  const tooltipVis = cell(false);

  // ── Group containers ──────────────────────────────────────────────────────
  // Drawn FIRST so they sit behind ribbons and node bars. One rounded rect
  // per contiguous (group, column) cluster, expanded slightly past the node
  // bar so the bar reads as "inside" the group. Labels float just above.
  if (groups) {
    const GROUP_PAD_X = 6, GROUP_PAD_Y = 6;
    const groupBoxesD = derive(() => layout.value.groups);
    // We can't know up-front how many group boxes will appear; re-render via
    // a derived count. Cap defensively at nodeIds.length (one box per node
    // worst case) which is the natural ceiling.
    const maxBoxes = nodeIds.length;
    for (let i = 0; i < maxBoxes; i++) {
      const idx = i;
      const has = derive(() => groupBoxesD.value[idx] !== undefined);
      const x = derive(() => {
        const b = groupBoxesD.value[idx];
        return b ? b.x0 - GROUP_PAD_X : 0;
      });
      const y = derive(() => {
        const b = groupBoxesD.value[idx];
        return b ? b.y0 - GROUP_PAD_Y : 0;
      });
      const w = derive(() => {
        const b = groupBoxesD.value[idx];
        return b ? (b.x1 - b.x0) + GROUP_PAD_X * 2 : 0;
      });
      const h = derive(() => {
        const b = groupBoxesD.value[idx];
        return b ? (b.y1 - b.y0) + GROUP_PAD_Y * 2 : 0;
      });
      const opacity = derive(() => has.value ? 1 : 0);
      s(rect(x, y, w, h, {
        fill: "rgba(120,140,180,0.06)",
        stroke: "rgba(160,180,210,0.35)",
        strokeWidth: 1,
        opacity,
      }));
      const lblX = derive(() => {
        const b = groupBoxesD.value[idx];
        return b ? (b.x0 + b.x1) / 2 : 0;
      });
      const lblY = derive(() => {
        const b = groupBoxesD.value[idx];
        return b ? b.y0 - GROUP_PAD_Y - 4 : 0;
      });
      s(label(Vec.derive(() => ({ x: lblX.value, y: lblY.value })),
        derive(() => groupBoxesD.value[idx]?.group ?? ""),
        { size: Math.max(9, labelSize - 1), align: Anchor.Center, fill: "#9aa0a8", opacity }));
    }
  }

  // ── Ribbons ──────────────────────────────────────────────────────────────
  for (let i = 0; i < linkDefs.length; i++) {
    const idx = i;
    const d = derive(() => ribbonPath(layout.value.links[idx]!));
    const stroke = derive(() => {
      if (focused.value === idx) return "#fff";
      const mode = linkColorMode.value;
      const colorIdx = mode === "target" ? tgt[idx]! : mode === "static" ? 0 : src[idx]!;
      return nodeColors.value[colorIdx] ?? "#6ab0f5";
    });
    const opacity = derive(() => {
      const h = hovered.value, f = focused.value;
      if (h === null && f === null) return 0.4;
      return (h ?? f) === idx ? 0.7 : 0.12;
    });

    const ribbon = s(pathD(d, { fill: stroke, opacity, stroke: "none" }));
    ribbonEls.set(ribbon.el, idx);
    if (ribbon.el.firstElementChild) ribbonEls.set(ribbon.el.firstElementChild, idx);
    ribbon.el.style.cursor = "pointer";
    ribbon.el.addEventListener("pointerenter", (e) => {
      if (wheelController.active) return;
      hovered.value = idx;
      const b = layout.value.links[idx]!;
      const sn = nodeIds[b.src] ?? String(b.src);
      const tn = nodeIds[b.tgt] ?? String(b.tgt);
      tooltipText.value = `${sn} → ${tn}: ${b.value.toFixed(1)}`;
      tooltipAt.value = toSVG(e as PointerEvent); tooltipVis.value = true;
    });
    ribbon.el.addEventListener("pointermove", (e) => { if (!wheelController.active) tooltipAt.value = toSVG(e as PointerEvent); });
    ribbon.el.addEventListener("pointerleave", () => { if (wheelController.active) return; if (hovered.value === idx) { hovered.value = null; tooltipVis.value = false; } });
    ribbon.el.addEventListener("click", () => { focused.value = focused.value === idx ? null : idx; host.focus(); });
  }

  // ── Node bars + GROUP grip ─────────────────────────────────────────────────
  // Dragging a node's bar scales every outgoing link from that node
  // proportionally (a node with no outgoing links scales its incoming instead).
  for (let n = 0; n < nodeIds.length; n++) {
    const name = nodeIds[n]!;
    const nb = derive(() => layout.value.nodes[n]!);
    const x0 = derive(() => nb.value.x0);
    const y0 = derive(() => nb.value.y0);
    const nw = derive(() => nb.value.x1 - nb.value.x0);
    const nh = derive(() => nb.value.y1 - nb.value.y0);
    const fill = derive(() => nodeColors.value[n] ?? "#6ab0f5");
    const isSink = topology.out[n]!.length === 0;

    const nodeActive = cell(false);
    const isGroup = !!(nodeIsGroup && nodeIsGroup[n]);
    const tile = s(rect(x0, y0, nw, nh, {
      fill,
      stroke: derive(() => nodeActive.value ? "#fff" : (isGroup ? "#a0b4d0" : "none")),
      strokeWidth: 2,
      dashed: isGroup || undefined,
    }));
    if (isGroup) {
      tile.el.style.cursor = "pointer";
      tile.el.style.pointerEvents = "auto"; // Ensure fill is clickable, not just stroke
    }
    if (onNodeClick) {
      tile.el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        onNodeClick(n);
      });
    }
    tile.el.addEventListener("pointerenter", (e) => {
      nodeActive.value = true;
      const v = layout.value.nodes[n]!.value;
      const hint = isGroup ? " · double-click to expand/collapse" : "";
      tooltipText.value = `${name}: ${v.toFixed(1)}${hint}`;
      tooltipAt.value = toSVG(e as PointerEvent); tooltipVis.value = true;
    });
    tile.el.addEventListener("pointermove", (e) => { tooltipAt.value = toSVG(e as PointerEvent); });
    tile.el.addEventListener("pointerleave", () => { nodeActive.value = false; tooltipVis.value = false; });

    // Group grip: scale ALL the node's links proportionally (outgoing if any,
    // else incoming) — the inspo `scaleHandle` move. It rides the node's BOTTOM
    // edge; dragging it down grows the node, up shrinks it. The pivot is the
    // node's TOP edge captured at gesture start (a fixed reference for the drag,
    // so the grip doesn't chase the node's own recentering — Rule 2).
    // Single (boundary) grips sit on the node's FLOW face (right for sources,
    // left for sinks). Put the GROUP grip on the OPPOSITE face so the two never
    // overlap or fight the hit-test — and at the node's vertical center, clear of
    // the stacked ribbon boundaries.
    const groupLinks = isSink ? topology.inc[n]! : topology.out[n]!;
    if (groupLinks.length > 0) {
      const sources: Writable<Num>[] = groupLinks.map((li) => linkValues[li]!.value as unknown as Writable<Num>);
      // Group grip on the node BAR (its x-center), at the bar's bottom edge so it
      // tracks the cursor as the node grows. The bar center x differs from the
      // flow-face x where single grips sit, so they don't collide; the grip is
      // also drawn after the single grips (below), winning the hit-test on the bar.
      const gripPos = () => {
        const b = layout.value.nodes[n]!;
        return { x: (b.x0 + b.x1) / 2, y: b.y1 };
      };
      // Nodes are center-stacked, so BOTH edges move when a node resizes — no edge
      // is a stable absolute reference. frozenGripPos pins the lens getter to the
      // capture position for the duration of the drag so the grip tracks the cursor
      // at 1:1 (without freezing, the bottom edge moves at half the drag rate
      // because growth splits evenly between top and bottom).
      let frozenGripPos: { x: number; y: number } | null = null;
      let startY = 0, startTot = 0, startVals: number[] = [];
      const lens = Vec.lens(
        sources,
        () => frozenGripPos ?? gripPos(),
        (target, vals: readonly number[]) => {
          if (startTot <= 0) return vals.slice();
          const wantTot = Math.max(LINK_MIN, startTot + (target.y - startY) / pxPerUnit);
          const k = wantTot / startTot;
          // Scale from the gesture-START values (not the live ones) so repeated
          // moves don't compound. startVals aligns with `sources`/`vals` order.
          return startVals.map((v) => Math.max(LINK_MIN, v * k));
        },
      );
      const gripVis = Vec.derive(() => frozenGripPos ?? gripPos());
      const grip = s(circle(gripVis, 5, {
        fill: "#0b0d12",
        stroke: derive(() => nodeActive.value ? "#fff" : fill.value),
        strokeWidth: 2,
        opacity: derive(() => nodeActive.value ? 1 : 0),
      }));
      grip.el.style.cursor = "ns-resize";
      grip.el.style.transition = "opacity 0.12s";
      grip.el.addEventListener("pointerenter", () => { nodeActive.value = true; });
      dragCancelable(grip, lens, sources, {
        onStart: () => {
          nodeActive.value = true;
          frozenGripPos = gripPos();
          startY = frozenGripPos.y;
          startVals = sources.map((c) => c.value);
          startTot = startVals.reduce((a, v) => a + v, 0);
        },
        onEnd: () => { frozenGripPos = null; nodeActive.value = false; },
      });
    }

    const lx = derive(() => isSink ? x0.value - 4 : x0.value + nw.value + 4);
    const ly = derive(() => y0.value + nh.value / 2);
    s(label(Vec.derive(() => ({ x: lx.value, y: ly.value })), name, {
      size: labelSize,
      align: isSink ? Anchor.Right : Anchor.Left,
      fill: "#cdd5e0",
    }));

    // Add expand/collapse indicator for group nodes
    if (isGroup) {
      const isCollapsed = !!(nodeIsCollapsed && nodeIsCollapsed[n]);
      const iconX = derive(() => x0.value + nw.value / 2);
      const iconY = derive(() => y0.value + nh.value / 2);
      const icon = isCollapsed ? "⊕" : "⊖";  // Using circled plus/minus for better visibility
      const iconLbl = s(label(Vec.derive(() => ({ x: iconX.value, y: iconY.value })), icon, {
        size: Math.max(16, labelSize + 6),
        align: Anchor.Center,
        fill: "#fff",
      }));
      iconLbl.el.style.fontWeight = "bold";
      iconLbl.el.style.pointerEvents = "none";  // Let clicks pass through to the rect
    }
  }

  // ── Single grip per ribbon ─────────────────────────────────────────────────
  // A grip at each ribbon's source-side face. It redistributes between this link
  // and its NEXT sibling out of the same node (the boundary between them), so the
  // node's outgoing total stays fixed — stable, no reflow (cf. the pie boundary
  // knob). For a node's last/only outgoing link the grip resizes it absolutely.
  for (let n = 0; n < nodeIds.length; n++) {
    const outs = topology.out[n]!;
    for (let k = 0; k < outs.length; k++) {
      const li = outs[k]!;
      const sibling = k + 1 < outs.length ? outs[k + 1]! : -1;
      const aCell = linkValues[li]!.value as unknown as Writable<Num>;
      const active = cell(false);

      // Position: bottom edge of link `li` on the source face = boundary with sibling.
      const boundaryPos = () => {
        const b = layout.value.links[li]!;
        return { x: b.sx, y: b.sy + b.width / 2 };
      };
      const gripVis = Vec.derive(boundaryPos);

      let lens: Writable<Vec>;
      let lensSources: Writable<Num>[];
      if (sibling >= 0) {
        const bCell = linkValues[sibling]!.value as unknown as Writable<Num>;
        lensSources = [aCell, bCell];
        // Boundary drag: move value between a and b, sum fixed (pie pattern).
        lens = Vec.lens(
          [aCell, bCell] as const,
          () => boundaryPos(),
          (target, [va, vb]: readonly [number, number]) => {
            const ba = layout.peek().links[li]!;
            const top = ba.sy - ba.width / 2;       // top of link a's source face
            const sum = va + vb;
            const newA = Math.max(LINK_MIN, Math.min(sum - LINK_MIN, (target.y - top) / pxPerUnit));
            return [newA, sum - newA];
          },
        );
      } else {
        lensSources = [aCell];
        // Last/only outgoing link: absolute resize from the boundary y.
        lens = Vec.lens(
          [aCell] as const,
          () => boundaryPos(),
          (target, [va]: readonly [number]) => {
            const ba = layout.peek().links[li]!;
            const top = ba.sy - ba.width / 2;
            void va;
            return [Math.max(LINK_MIN, (target.y - top) / pxPerUnit)];
          },
        );
      }

      const grip = s(circle(gripVis, 4, {
        fill: "#0b0d12",
        stroke: derive(() => active.value ? "#fff" : (nodeColors.value[n] ?? "#6ab0f5")),
        strokeWidth: 2,
        opacity: derive(() => (active.value || hovered.value === li || focused.value === li) ? 1 : 0),
      }));
      grip.el.style.cursor = "ns-resize";
      grip.el.style.transition = "opacity 0.12s";
      grip.el.addEventListener("pointerenter", () => { active.value = true; hovered.value = li; });
      grip.el.addEventListener("pointerleave", () => { if (!active.value && hovered.value === li) hovered.value = null; });
      dragCancelable(grip, lens, lensSources, {
        onStart: () => { active.value = true; focused.value = li; },
        onEnd: () => { active.value = false; },
      });
    }
  }

  // Tooltip overlay
  const tlbl = s(label(
    Vec.derive(() => ({ x: tooltipAt.value.x + 10, y: tooltipAt.value.y - 10 })),
    tooltipText,
    { size: 11, fill: "#fff", align: Anchor.Left, opacity: derive(() => tooltipVis.value ? 1 : 0) },
  ));
  tlbl.el.style.pointerEvents = "none";

  return { focused, hovered, wheelLocked, linkValues, layout, nodeColorProp, linkColorMode };
}

// ---------------------------------------------------------------------------
// Color mode controls — renders clickable chips below the diagram
// ---------------------------------------------------------------------------

export function renderColorControls(
  s: Mount,
  view: { bottom: { up: (n: number) => any } },
  nodeColorProp: ReturnType<typeof cell<NodeColorProp>>,
  linkColorMode: ReturnType<typeof cell<LinkColorMode>>,
) {
  const NODE_PROPS: NodeColorProp[] = ["layer", "depth", "height", "index"];
  const LINK_MODES: LinkColorMode[] = ["source", "target", "static"];

  const ncText = derive(() => `node: ${NODE_PROPS.map(p => p === nodeColorProp.value ? `[${p}]` : p).join("  ")}`);
  const lcText = derive(() => `link: ${LINK_MODES.map(m => m === linkColorMode.value ? `[${m}]` : m).join("  ")}`);

  const ncLbl = s(label(view.bottom.up(28), ncText, { size: 9, align: Anchor.Center, fill: "#9aa0a8" }));
  const lcLbl = s(label(view.bottom.up(14), lcText, { size: 9, align: Anchor.Center, fill: "#9aa0a8" }));

  ncLbl.el.style.cursor = "pointer";
  lcLbl.el.style.cursor = "pointer";

  ncLbl.el.addEventListener("click", () => {
    const cur = NODE_PROPS.indexOf(nodeColorProp.value);
    nodeColorProp.value = NODE_PROPS[(cur + 1) % NODE_PROPS.length]!;
  });
  lcLbl.el.addEventListener("click", () => {
    const cur = LINK_MODES.indexOf(linkColorMode.value);
    linkColorMode.value = LINK_MODES[(cur + 1) % LINK_MODES.length]!;
  });
}
