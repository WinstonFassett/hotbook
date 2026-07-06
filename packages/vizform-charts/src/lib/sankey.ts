import {
  Anchor,
  batch,
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
import { wheelController, dynamicWheelStep, realModifierDown } from "./interaction";
import { dragCancelable } from "./esc-contract";
import {
  buildTopology,
  computeLayout,
  ribbonPath,
  type SankeyLayout,
  type SankeyTopology,
} from "./sankey-layout";

// ---------------------------------------------------------------------------
// Conservation propagation — the "form fill"
// ---------------------------------------------------------------------------
// When a link value changes, in≠out at the affected nodes. This restores
// conservation by propagating the delta through the graph: scale the
// unbalanced side to match the changed side, then cascade to neighbors.
// Structure is fixed (layered DAG), so backward propagation terminates at
// sources and forward propagation terminates at sinks.

/**
 * Restore in=out at every node after a value change.
 * @param topology  fixed graph structure
 * @param values    mutable array of link values (modified in place)
 * @param startNode the node whose balance was disrupted
 * @param direction "backward" = outgoing changed (scale incoming → cascade to
 *                  predecessors); "forward" = incoming changed (scale outgoing
 *                  → cascade to successors)
 */
function propagateConservation(
  topology: SankeyTopology,
  values: number[],
  startNode: number,
  direction: "backward" | "forward",
): void {
  const queue: { node: number; dir: "backward" | "forward" }[] =
    [{ node: startNode, dir: direction }];

  while (queue.length > 0) {
    const { node: n, dir } = queue.shift()!;

    if (dir === "backward") {
      // This node's OUTGOING changed. Scale INCOMING to match.
      const inLinks = topology.inc[n]!;
      if (inLinks.length === 0) continue; // source — boundary, nothing to scale
      const outSum = topology.out[n]!.reduce((a, li) => a + values[li]!, 0);
      const inSum = inLinks.reduce((a, li) => a + values[li]!, 0);
      if (inSum < 1e-9) continue;
      const k = outSum / inSum;
      for (const li of inLinks) {
        values[li] = Math.max(LINK_MIN, values[li]! * k);
      }
      // Predecessors' outgoing changed → propagate backward from them
      for (const li of inLinks) {
        queue.push({ node: topology.src[li]!, dir: "backward" });
      }
    } else {
      // This node's INCOMING changed. Scale OUTGOING to match.
      const outLinks = topology.out[n]!;
      if (outLinks.length === 0) continue; // sink — boundary, nothing to scale
      const inSum = topology.inc[n]!.reduce((a, li) => a + values[li]!, 0);
      const outSum = outLinks.reduce((a, li) => a + values[li]!, 0);
      if (outSum < 1e-9) continue;
      const k = inSum / outSum;
      for (const li of outLinks) {
        values[li] = Math.max(LINK_MIN, values[li]! * k);
      }
      // Successors' incoming changed → propagate forward from them
      for (const li of outLinks) {
        queue.push({ node: topology.tgt[li]!, dir: "forward" });
      }
    }
  }
}

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
  nodeWidth?: number;
  nodePadding?: number;
  interp?: (t: number) => string;
  labelSize?: number;
  // Explicit string-id mode (true = node IDs are strings, false = numeric indices)
  stringIds?: boolean;
  // Reactive color mode cells (optional — pass pre-created cells to share across UI)
  nodeColorProp?: ReturnType<typeof cell<NodeColorProp>>;
  linkColorMode?: ReturnType<typeof cell<LinkColorMode>>;
  // Custom step size fn — defaults to 1 (shift=5). Use e.g. v => v * 0.1 for proportional.
  stepFn?: (currentVal: number, shift: boolean) => number;
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

export function sankeyScene(
  host: Diagram,
  s: Mount,
  opts: SankeySceneOptions,
) {
  const {
    W, H, nodeIds, linkDefs,
    nodeWidth = 12, nodePadding = 6,
    interp = interpolateCool, labelSize = 10,
  } = opts;
  const stepFn = opts.stepFn ?? ((v: number, shift: boolean) => dynamicWheelStep(v, shift));

  const nodeColorProp = opts.nodeColorProp ?? cell<NodeColorProp>("layer");
  const linkColorMode = opts.linkColorMode ?? cell<LinkColorMode>("source");

  host.tabIndex = -1; // Container not directly focusable, ribbons are
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
  const topology: SankeyTopology = buildTopology(nodeIds.length, src, tgt);

  // Choose the ruler ONCE from the initial values so the diagram opens sized to
  // fit ~H, then hold it constant. Every later pixel↔value conversion (drag,
  // wheel, grip placement) uses THIS same pxPerUnit, so all manipulation is at
  // the scale the geometry was drawn at.
  const pxPerUnit = initialPxPerUnit(topology, linkValues.map((l) => l.value.value), H, nodePadding);
  const dims = { W, pxPerUnit, nodeWidth, nodePadding };

  const layout = derive<SankeyLayout>(() =>
    computeLayout(topology, linkValues.map((l) => l.value.value), dims)
  );
  // NOTE: fitHostToBounds was removed — it reactively overrode the fixed viewBox
  // set by view(), causing captions (color controls, help text) to move and scale
  // with the diagram during edits. The fixed viewBox from view() is correct.

  const nodeColors = derive(() =>
    nodeColorScale(topology.layer, nodeColorProp.value, interp)
  );

  const hovered = cell<number | null>(null);
  const focused = cell<number | null>(null);
  // Reactive mirror of the active wheel target so the demo label can show the
  // link being edited mid-gesture (the gesture object itself is plain).
  const wheelLocked = cell<number | null>(null);
  const ribbonEls = new Map<Element, number>();
  const ribbonElements: SVGPathElement[] = []; // Track elements by index for focus management
  const groupNodeEls = new Map<Element, number>(); // Track group node elements (bar and grip) to node indices

  // Wheel edits a link by index. Snapshot/restore ALL link values because
  // conservation propagation changes cells beyond the directly-edited one.
  const wheelConfig = {
    snapshot: (_idx: number) => linkValues.map((lv) => lv.value.value),
    restore: (_idx: number, snap: number[]) => {
      batch(() => { linkValues.forEach((lv, i) => { lv.value.value = snap[i]!; }); });
    },
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

  const hitTestGroupNode = (clientX: number, clientY: number): number | null => {
    const shadow = (host as any).shadowRoot as ShadowRoot | null;
    const el = shadow ? shadow.elementFromPoint(clientX, clientY) : document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const direct = groupNodeEls.get(el);
    if (direct !== undefined) return direct;
    const parent = groupNodeEls.get(el.parentElement as Element);
    return parent !== undefined ? parent : null;
  };

  // Wheel config for group nodes — stateful like lane grips
  const groupWheelConfig = {
    snapshot: (nodeIdx: number) => linkValues.map((lv) => lv.value.value),
    restore: (nodeIdx: number, snap: number[]) => {
      batch(() => { linkValues.forEach((lv, i) => { lv.value.value = snap[i]!; }); });
    },
    onEnd: () => { wheelLocked.value = null; tooltipVis.value = false; tooltipNodeIdx.value = null; },
  };

  host.addEventListener("wheel", ((e: WheelEvent) => {
    if (!e.ctrlKey) return;
    
    // First try to hit a group node (takes precedence over ribbons)
    const groupNodeIdx = hitTestGroupNode(e.clientX, e.clientY);
    if (groupNodeIdx !== null) {
      // Use wheelController for gesture locking so the gesture persists even if grip moves
      const idx = wheelController.begin(
        groupNodeIdx,
        groupWheelConfig,
        { pinch: !realModifierDown() },
      );
      if (idx === null) return;
      wheelLocked.value = idx;
      e.preventDefault();
      
      const groupLinks = topology.out[idx]!.length === 0 ? topology.inc[idx]! : topology.out[idx]!;
      if (groupLinks.length === 0) return;
      
      const allVals = linkValues.map((lv) => lv.value.value);
      const startTot = groupLinks.reduce((a, li) => a + allVals[li]!, 0);
      if (startTot <= 0) return;
      
      const step = stepFn(startTot, e.shiftKey);
      const wantTot = Math.max(LINK_MIN * groupLinks.length, startTot + (e.deltaY < 0 ? +step : -step));
      const k = wantTot / startTot;
      
      // Scale all group links proportionally
      for (const li of groupLinks) {
        allVals[li] = Math.max(LINK_MIN, allVals[li]! * k);
      }
      
      // Propagate conservation from the edited node
      const isSink = topology.out[idx]!.length === 0;
      if (!isSink) {
        propagateConservation(topology, allVals, idx, "backward");
        for (const li of topology.out[idx]!) {
          propagateConservation(topology, allVals, topology.tgt[li]!, "forward");
        }
      } else {
        propagateConservation(topology, allVals, idx, "forward");
        for (const li of topology.inc[idx]!) {
          propagateConservation(topology, allVals, topology.src[li]!, "backward");
        }
      }
      
      batch(() => {
        linkValues.forEach((lv, i) => { lv.value.value = allVals[i]!; });
      });
      
      // Update tooltip
      const name = nodeIds[idx]!;
      const ins = topology.inc[idx]!;
      const outs = topology.out[idx]!;
      const inSum = ins.reduce((a, li) => a + linkValues[li]!.value.value, 0);
      const outSum = outs.reduce((a, li) => a + linkValues[li]!.value.value, 0);
      const parts = [`${name}: ${Math.max(inSum, outSum).toFixed(1)}`];
      if (ins.length > 0) parts.push(`in: ${inSum.toFixed(1)}`);
      if (outs.length > 0) parts.push(`out: ${outSum.toFixed(1)}`);
      tooltipText.value = parts.join(" · ");
      tooltipNodeIdx.value = idx;
      tooltipVis.value = true;
      return;
    }
    
    // Fall back to ribbon wheel handling
    const idx = wheelController.begin(
      hovered.value ?? focused.value ?? hitTestRibbon(e.clientX, e.clientY),
      wheelConfig,
      { pinch: !realModifierDown() },
    );
    if (idx === null) return;
    wheelLocked.value = idx;
    e.preventDefault();
    const v = linkValues[idx]!.value;
    const step = stepFn(v.value, e.shiftKey);
    v.value = Math.max(LINK_MIN, v.value + (e.deltaY < 0 ? +step : -step));
    // Propagate conservation: the edited link disrupted in=out at its source
    // (outgoing changed → propagate backward) and target (incoming changed →
    // propagate forward).
    const allVals = linkValues.map((lv) => lv.value.value);
    propagateConservation(topology, allVals, topology.src[idx]!, "backward");
    propagateConservation(topology, allVals, topology.tgt[idx]!, "forward");
    batch(() => {
      linkValues.forEach((lv, i) => { lv.value.value = allVals[i]!; });
    });
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
    const idx = focused.value;
    if (e.key === "Tab") {
      // Tab cycles through ribbons
      e.preventDefault();
      const nextIdx = idx === null
        ? 0
        : e.shiftKey
          ? (idx <= 0 ? linkDefs.length : idx) - 1
          : (idx + 1) % linkDefs.length;
      focused.value = nextIdx;
      ribbonElements[nextIdx]?.focus();
      return;
    }
    if (idx === null) return;
    const v = linkValues[idx]!.value;
    const step = stepFn(v.value, e.shiftKey);
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      v.value = Math.max(LINK_MIN, v.value + step);
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      v.value = Math.max(LINK_MIN, v.value - step);
      e.preventDefault();
    }
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
  const tooltipAt = cell({ x: 0, y: 0 });
  const tooltipVis = cell(false);
  // When set, the tooltip text reactively tracks this link's live value (during drag).
  const tooltipLinkIdx = cell<number | null>(null);
  // When set, the tooltip text reactively tracks this node's live in/out (during drag).
  const tooltipNodeIdx = cell<number | null>(null);

  // Link tooltip text: "src → tgt: value"
  const linkTooltip = (li: number) => {
    const b = layout.value.links[li]!;
    const sn = nodeIds[b.src] ?? String(b.src);
    const tn = nodeIds[b.tgt] ?? String(b.tgt);
    return `${sn} → ${tn}: ${b.value.toFixed(1)}`;
  };

  // Reactive tooltip text — updates live during drag when tooltipLinkIdx/tooltipNodeIdx is set.
  const tooltipText = derive(() => {
    if (tooltipLinkIdx.value !== null) return linkTooltip(tooltipLinkIdx.value);
    if (tooltipNodeIdx.value !== null) {
      const n = tooltipNodeIdx.value;
      const name = nodeIds[n]!;
      const ins = topology.inc[n]!;
      const outs = topology.out[n]!;
      const inSum = ins.reduce((a, li) => a + linkValues[li]!.value.value, 0);
      const outSum = outs.reduce((a, li) => a + linkValues[li]!.value.value, 0);
      const parts = [`${name}: ${Math.max(inSum, outSum).toFixed(1)}`];
      if (ins.length > 0) parts.push(`in: ${inSum.toFixed(1)}`);
      if (outs.length > 0) parts.push(`out: ${outSum.toFixed(1)}`);
      return parts.join(" · ");
    }
    return "";
  });

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
    ribbonElements[idx] = ribbon.el; // Store for focus management
    ribbonEls.set(ribbon.el, idx);
    if (ribbon.el.firstElementChild) ribbonEls.set(ribbon.el.firstElementChild, idx);
    ribbon.el.style.cursor = "pointer";
    // Make each ribbon individually focusable
    ribbon.el.setAttribute('tabindex', '0');
    ribbon.el.setAttribute('data-focusable', 'ribbon');
    biEffect(() => {
      const b = layout.value.links[idx]!;
      const sn = nodeIds[b.src] ?? String(b.src);
      const tn = nodeIds[b.tgt] ?? String(b.tgt);
      ribbon.el.setAttribute('aria-label', `${sn} to ${tn}: ${b.value.toFixed(1)}`);
    });
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
    ribbon.el.addEventListener("click", () => { focused.value = focused.value === idx ? null : idx; });
    ribbon.el.addEventListener("focus", () => { focused.value = idx; });
    ribbon.el.addEventListener("blur", () => { if (focused.value === idx) focused.value = null; });
  }

  // ── Node bars + GROUP grip ─────────────────────────────────────────────────
  // Dragging a node's bar scales every outgoing link from that node
  // proportionally (a node with no outgoing links scales its incoming instead).
  // Conservation propagation then adjusts all other links to maintain in=out
  // at every node — the "form fill." ALL link cells are lens sources so
  // dragCancelable snapshots/restores the entire value array on Esc.
  //
  // The group grip sits on the OPPOSITE face from the lane grips:
  //   non-sink: lane grips on right face (outgoing), group grip on LEFT face
  //   sink:     lane grips on left face (incoming),  group grip on RIGHT face
  // Horizontal separation. Drawn BEFORE lane grips so lane grips win hit-test.
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
    // Show bar tooltip: sets tooltipNodeIdx so the text reactively tracks live values.
    const showBarTooltip = (e: PointerEvent) => {
      tooltipLinkIdx.value = null;
      tooltipNodeIdx.value = n;
      tooltipAt.value = toSVG(e); tooltipVis.value = true;
    };
    const tile = s(rect(x0, y0, nw, nh, {
      fill,
      stroke: derive(() => nodeActive.value ? "#fff" : "none"),
      strokeWidth: 1.5,
    }));
    tile.el.addEventListener("pointerenter", (e) => { nodeActive.value = true; showBarTooltip(e as PointerEvent); });
    tile.el.addEventListener("pointermove", (e) => { tooltipAt.value = toSVG(e as PointerEvent); });
    tile.el.addEventListener("pointerleave", () => { nodeActive.value = false; tooltipVis.value = false; tooltipNodeIdx.value = null; });
    
    // Register bar tile for wheel hit-testing (allow wheel on the bar itself, not just grip)
    groupNodeEls.set(tile.el, n);
    if (tile.el.firstElementChild) groupNodeEls.set(tile.el.firstElementChild, n);

    const groupLinks = isSink ? topology.inc[n]! : topology.out[n]!;
    if (groupLinks.length > 0) {
      const allCells = linkValues.map((lv) => lv.value as unknown as Writable<Num>);
      // Group grip at the bar's BOTTOM edge, CENTERED on the bar horizontally.
      // Lane grips are on both sides of the bar (outbound right, inbound left),
      // so the group grip sits at the center to stay clear of both.
      // Position is a PURE FUNCTION of the layout — no freezing. When values
      // change during drag, the layout recomputes and the grip moves with the bar.
      const gripPos = () => {
        const b = layout.value.nodes[n]!;
        return { x: (b.x0 + b.x1) / 2, y: b.y1 };
      };
      let startY = 0, startTot = 0, startVals: number[] = [];
      const lens = Vec.lens(
        allCells,
        () => gripPos(),
        (target, _vals: readonly number[]) => {
          if (startTot <= 0) return _vals.slice();
          const wantTot = Math.max(LINK_MIN, startTot + (target.y - startY) / pxPerUnit);
          const k = wantTot / startTot;
          // Build new values from gesture-START values (no compounding).
          const newVals = startVals.slice();
          for (const li of groupLinks) {
            newVals[li] = Math.max(LINK_MIN, startVals[li]! * k);
          }
          // Propagate conservation in both directions from the edited node.
          if (!isSink) {
            propagateConservation(topology, newVals, n, "backward");
            for (const li of topology.out[n]!) {
              propagateConservation(topology, newVals, topology.tgt[li]!, "forward");
            }
          } else {
            propagateConservation(topology, newVals, n, "forward");
            for (const li of topology.inc[n]!) {
              propagateConservation(topology, newVals, topology.src[li]!, "backward");
            }
          }
          return newVals;
        },
      );
      const gripVis = Vec.derive(gripPos);
      const gripX = derive(() => gripVis.value.x - 7);
      const gripY = derive(() => gripVis.value.y - 2);
      const grip = s(rect(gripX, gripY, 14, 4, {
        fill: "#0b0d12",
        stroke: derive(() => nodeActive.value ? "#fff" : fill.value),
        strokeWidth: 1.5,
        opacity: derive(() => nodeActive.value ? 1 : 0.5),
        corner: 2,
      }));
      grip.el.style.cursor = "ns-resize";
      grip.el.style.transition = "opacity 0.12s";
      grip.el.addEventListener("pointerenter", (e) => { nodeActive.value = true; showBarTooltip(e as PointerEvent); });
      grip.el.addEventListener("pointermove", (e) => { tooltipAt.value = toSVG(e as PointerEvent); });
      grip.el.addEventListener("pointerleave", () => { nodeActive.value = false; tooltipVis.value = false; tooltipNodeIdx.value = null; });
      
      // Register group grip for wheel hit-testing (allow wheel on the grip handle)
      groupNodeEls.set(grip.el, n);
      if (grip.el.firstElementChild) groupNodeEls.set(grip.el.firstElementChild, n);
      dragCancelable(grip, lens, allCells, {
        onStart: () => {
          nodeActive.value = true;
          tooltipNodeIdx.value = n; tooltipVis.value = true;
          const p = gripPos();
          startY = p.y;
          startVals = allCells.map((c) => c.value);
          startTot = groupLinks.reduce((a, li) => a + startVals[li]!, 0);
        },
        onEnd: () => { nodeActive.value = false; },
      });
    }

    const lx = derive(() => isSink ? x0.value - 4 : x0.value + nw.value + 4);
    const ly = derive(() => y0.value + nh.value / 2);
    s(label(Vec.derive(() => ({ x: lx.value, y: ly.value })), name, {
      size: labelSize,
      align: isSink ? Anchor.Right : Anchor.Left,
      fill: "#cdd5e0",
    }));
  }

  // ── Single grip per ribbon ─────────────────────────────────────────────────
  // A grip at each ribbon's source-side face. It redistributes between this link
  // and its NEXT sibling out of the same node (the boundary between them), so the
  // node's outgoing total stays fixed. But the TARGETS' incoming changed, so
  // conservation propagation runs forward from each affected target.
  // For a node's last/only outgoing link the grip resizes it absolutely, and
  // propagation runs backward from the source AND forward from the target.
  // Drawn AFTER group grips so lane grips win any residual hit-test overlap.
  for (let n = 0; n < nodeIds.length; n++) {
    const outs = topology.out[n]!;
    for (let k = 0; k < outs.length; k++) {
      const li = outs[k]!;
      const sibling = k + 1 < outs.length ? outs[k + 1]! : -1;
      const active = cell(false);

      // Position: bottom edge of link `li` on the source face = boundary with sibling.
      // Offset OFF the rectangle by 12px so the grip has room as a touch target.
      const boundaryPos = () => {
        const b = layout.value.links[li]!;
        return { x: b.sx + 12, y: b.sy + b.width / 2 };
      };
      const gripVis = Vec.derive(boundaryPos);

      const allCells = linkValues.map((lv) => lv.value as unknown as Writable<Num>);
      let startAllVals: number[] = [];

      let lens: Writable<Vec>;
      if (sibling >= 0) {
        // Boundary drag: move value between a and b, sum fixed at the source node.
        // Target nodes' incoming changed → propagate forward from each target.
        lens = Vec.lens(
          allCells,
          () => boundaryPos(),
          (target, _vals: readonly number[]) => {
            const ba = layout.peek().links[li]!;
            const top = ba.sy - ba.width / 2;
            const sum = startAllVals[li]! + startAllVals[sibling]!;
            const newA = Math.max(LINK_MIN, Math.min(sum - LINK_MIN, (target.y - top) / pxPerUnit));
            const newVals = startAllVals.slice();
            newVals[li] = newA;
            newVals[sibling] = sum - newA;
            propagateConservation(topology, newVals, topology.tgt[li]!, "forward");
            propagateConservation(topology, newVals, topology.tgt[sibling]!, "forward");
            return newVals;
          },
        );
      } else {
        // Last/only outgoing link: absolute resize. Source outgoing changed →
        // propagate backward. Target incoming changed → propagate forward.
        lens = Vec.lens(
          allCells,
          () => boundaryPos(),
          (target, _vals: readonly number[]) => {
            const ba = layout.peek().links[li]!;
            const top = ba.sy - ba.width / 2;
            const newVals = startAllVals.slice();
            newVals[li] = Math.max(LINK_MIN, (target.y - top) / pxPerUnit);
            propagateConservation(topology, newVals, topology.src[li]!, "backward");
            propagateConservation(topology, newVals, topology.tgt[li]!, "forward");
            return newVals;
          },
        );
      }

      const grip = s(circle(gripVis, derive(() => active.value ? 6 : 4), {
        fill: "#0b0d12",
        stroke: derive(() => active.value ? "#fff" : (nodeColors.value[n] ?? "#6ab0f5")),
        strokeWidth: 2,
        opacity: derive(() => (active.value || hovered.value === li || focused.value === li) ? 1 : 0.5),
      }));
      grip.el.style.cursor = "ns-resize";
      grip.el.style.transition = "opacity 0.12s, r 0.12s";
      grip.el.addEventListener("pointerenter", (e) => {
        active.value = true; hovered.value = li;
        tooltipNodeIdx.value = null; tooltipLinkIdx.value = li;
        tooltipAt.value = toSVG(e as PointerEvent); tooltipVis.value = true;
      });
      grip.el.addEventListener("pointermove", (e) => { tooltipAt.value = toSVG(e as PointerEvent); });
      grip.el.addEventListener("pointerleave", () => { active.value = false; if (hovered.value === li) hovered.value = null; tooltipVis.value = false; tooltipLinkIdx.value = null; });
      dragCancelable(grip, lens, allCells, {
        onStart: () => { active.value = true; focused.value = li; tooltipLinkIdx.value = li; tooltipVis.value = true; startAllVals = allCells.map((c) => c.value); },
        onEnd: () => { active.value = false; },
      });
    }
  }

  // ── Inbound lane grips (target-side face) ──────────────────────────────────
  // Mirror of the outbound lane grips, but on the TARGET face of each ribbon.
  // Redistributes between this link and its sibling coming INTO the same target
  // node, so the node's incoming total stays fixed. The SOURCES' outgoing
  // changed, so conservation propagation runs backward from each affected source.
  for (let n = 0; n < nodeIds.length; n++) {
    const incs = topology.inc[n]!;
    for (let k = 0; k < incs.length; k++) {
      const li = incs[k]!;
      const sibling = k + 1 < incs.length ? incs[k + 1]! : -1;
      const active = cell(false);

      // Position: bottom edge of link `li` on the target face = boundary with sibling.
      // Offset OFF the rectangle by 12px to the LEFT so the grip has room as a touch target.
      const boundaryPos = () => {
        const b = layout.value.links[li]!;
        return { x: b.tx - 12, y: b.ty + b.width / 2 };
      };
      const gripVis = Vec.derive(boundaryPos);

      const allCells = linkValues.map((lv) => lv.value as unknown as Writable<Num>);
      let startAllVals: number[] = [];

      let lens: Writable<Vec>;
      if (sibling >= 0) {
        // Boundary drag: move value between a and b, sum fixed at the target node.
        // Source nodes' outgoing changed → propagate backward from each source.
        lens = Vec.lens(
          allCells,
          () => boundaryPos(),
          (target, _vals: readonly number[]) => {
            const ba = layout.peek().links[li]!;
            const top = ba.ty - ba.width / 2;
            const sum = startAllVals[li]! + startAllVals[sibling]!;
            const newA = Math.max(LINK_MIN, Math.min(sum - LINK_MIN, (target.y - top) / pxPerUnit));
            const newVals = startAllVals.slice();
            newVals[li] = newA;
            newVals[sibling] = sum - newA;
            propagateConservation(topology, newVals, topology.src[li]!, "backward");
            propagateConservation(topology, newVals, topology.src[sibling]!, "backward");
            return newVals;
          },
        );
      } else {
        // Last/only incoming link: absolute resize. Target incoming changed →
        // propagate forward. Source outgoing changed → propagate backward.
        lens = Vec.lens(
          allCells,
          () => boundaryPos(),
          (target, _vals: readonly number[]) => {
            const ba = layout.peek().links[li]!;
            const top = ba.ty - ba.width / 2;
            const newVals = startAllVals.slice();
            newVals[li] = Math.max(LINK_MIN, (target.y - top) / pxPerUnit);
            propagateConservation(topology, newVals, topology.tgt[li]!, "forward");
            propagateConservation(topology, newVals, topology.src[li]!, "backward");
            return newVals;
          },
        );
      }

      const grip = s(circle(gripVis, derive(() => active.value ? 6 : 4), {
        fill: "#0b0d12",
        stroke: derive(() => active.value ? "#fff" : (nodeColors.value[n] ?? "#6ab0f5")),
        strokeWidth: 2,
        opacity: derive(() => (active.value || hovered.value === li || focused.value === li) ? 1 : 0.5),
      }));
      grip.el.style.cursor = "ns-resize";
      grip.el.style.transition = "opacity 0.12s, r 0.12s";
      grip.el.addEventListener("pointerenter", (e) => {
        active.value = true; hovered.value = li;
        tooltipNodeIdx.value = null; tooltipLinkIdx.value = li;
        tooltipAt.value = toSVG(e as PointerEvent); tooltipVis.value = true;
      });
      grip.el.addEventListener("pointermove", (e) => { tooltipAt.value = toSVG(e as PointerEvent); });
      grip.el.addEventListener("pointerleave", () => { active.value = false; if (hovered.value === li) hovered.value = null; tooltipVis.value = false; tooltipLinkIdx.value = null; });
      dragCancelable(grip, lens, allCells, {
        onStart: () => { active.value = true; focused.value = li; tooltipLinkIdx.value = li; tooltipVis.value = true; startAllVals = allCells.map((c) => c.value); },
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
  host: Diagram,
  nodeColorProp: ReturnType<typeof cell<NodeColorProp>>,
  linkColorMode: ReturnType<typeof cell<LinkColorMode>>,
) {
  const NODE_PROPS: NodeColorProp[] = ["layer", "depth", "height", "index"];
  const LINK_MODES: LinkColorMode[] = ["source", "target", "static"];

  const root = host.shadowRoot ?? (host as any).shadow;
  if (!root) return;

  const container = document.createElement("div");
  container.style.cssText = "text-align:center; font-size:9px; color:#9aa0a8; padding:4px 0; cursor:pointer; user-select:none; line-height:1.6;";

  const ncSpan = document.createElement("div");
  const lcSpan = document.createElement("div");
  container.appendChild(ncSpan);
  container.appendChild(lcSpan);

  biEffect(() => {
    ncSpan.textContent = `node: ${NODE_PROPS.map(p => p === nodeColorProp.value ? `[${p}]` : p).join("  ")}`;
  });
  biEffect(() => {
    lcSpan.textContent = `link: ${LINK_MODES.map(m => m === linkColorMode.value ? `[${m}]` : m).join("  ")}`;
  });

  ncSpan.addEventListener("click", () => {
    const cur = NODE_PROPS.indexOf(nodeColorProp.value);
    nodeColorProp.value = NODE_PROPS[(cur + 1) % NODE_PROPS.length]!;
  });
  lcSpan.addEventListener("click", () => {
    const cur = LINK_MODES.indexOf(linkColorMode.value);
    linkColorMode.value = LINK_MODES[(cur + 1) % LINK_MODES.length]!;
  });

  root.appendChild(container);
}
