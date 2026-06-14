import {
  Anchor,
  cell,
  derive,
  label,
  pathD,
  rect,
  Vec,
  type Diagram,
  type Mount,
} from "bireactive";
import {
  sankey as d3sankey,
  sankeyJustify,
  sankeyLinkHorizontal,
  type SankeyGraph,
} from "d3-sankey";
import { scaleSequential } from "d3-scale";
import { interpolateCool } from "d3-scale-chromatic";
import { installGestureRelease } from "./interaction";

export const linkPath = sankeyLinkHorizontal();

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export type NodeColorProp = "layer" | "depth" | "height" | "index";
export type LinkColorMode = "source" | "target" | "static";

function nodeColorScale(nodes: any[], prop: NodeColorProp, interp: (t: number) => string) {
  const vals = nodes.map((n, i) => prop === "index" ? i : (n[prop] as number));
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
}

export function sankeyScene(
  host: Diagram,
  s: Mount,
  opts: SankeySceneOptions,
) {
  const {
    W, H, nodeIds, linkDefs,
    nodeWidth = 10, nodePadding = 6,
    interp = interpolateCool, labelSize = 10,
  } = opts;

  const stringIds = opts.stringIds ?? (typeof linkDefs[0]?.source === "string");
  const nodeColorProp = opts.nodeColorProp ?? cell<NodeColorProp>("layer");
  const linkColorMode = opts.linkColorMode ?? cell<LinkColorMode>("source");

  host.tabIndex = 0;
  host.style.outline = "none";

  const linkValues = linkDefs.map((l) => ({ ...l, value: cell(l.init) }));

  const engine = d3sankey<{}, { source: string | number; target: string | number }>()
    .nodeId(stringIds ? ((_d: any, i: number) => nodeIds[i]!) : ((_d: any, i: number) => i))
    .nodeAlign(sankeyJustify)
    .nodeWidth(nodeWidth)
    .nodePadding(nodePadding)
    .extent([[0, 0], [W, H]]);

  const layout = derive(() => engine({
    nodes: nodeIds.map(() => ({})),
    links: linkValues.map((l) => ({ source: l.source, target: l.target, value: Math.max(0.01, l.value.value) })),
  }) as SankeyGraph<{}, {}>);

  const nodeColors = derive(() =>
    nodeColorScale(layout.value.nodes as any[], nodeColorProp.value, interp)
  );

  const hovered = cell<number | null>(null);
  const focused = cell<number | null>(null);
  const wheelLocked = { current: null as number | null };
  const ribbonEls = new Map<Element, number>();

  installGestureRelease(() => { wheelLocked.current = null; hovered.value = null; tooltipVis.value = false; });

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
    if (!(e.metaKey || e.ctrlKey)) return;
    if (wheelLocked.current === null) {
      wheelLocked.current = hovered.value ?? focused.value ?? hitTestRibbon(e.clientX, e.clientY);
    }
    const idx = wheelLocked.current;
    if (idx === null) return;
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    const v = linkValues[idx]!.value;
    v.value = Math.max(0.01, v.value + (e.deltaY < 0 ? +step : -step));
  }) as EventListener, { passive: false });

  host.addEventListener("keydown", ((e: KeyboardEvent) => {
    if (e.key === "Tab") {
      const cur = focused.value;
      focused.value = e.shiftKey
        ? ((cur ?? 0) - 1 + linkValues.length) % linkValues.length
        : ((cur ?? -1) + 1) % linkValues.length;
      e.preventDefault(); return;
    }
    const idx = focused.value;
    if (idx === null) return;
    const step = e.shiftKey ? 5 : 1;
    const v = linkValues[idx]!.value;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { v.value = Math.max(0.01, v.value + step); e.preventDefault(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { v.value = Math.max(0.01, v.value - step); e.preventDefault(); }
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

  // Links
  for (let i = 0; i < linkDefs.length; i++) {
    const idx = i;
    const srcIdx = typeof linkDefs[i]!.source === "number"
      ? linkDefs[i]!.source as number
      : nodeIds.indexOf(linkDefs[i]!.source as string);
    const tgtIdx = typeof linkDefs[i]!.target === "number"
      ? linkDefs[i]!.target as number
      : nodeIds.indexOf(linkDefs[i]!.target as string);

    const d = derive(() => linkPath(layout.value.links[idx] as any) ?? "");
    const sw = derive(() => (layout.value.links[idx] as any).width ?? 1);
    const stroke = derive(() => {
      if (focused.value === idx) return "#fff";
      const mode = linkColorMode.value;
      const colorIdx = mode === "target" ? tgtIdx : mode === "static" ? 0 : srcIdx;
      return nodeColors.value[colorIdx] ?? "#6ab0f5";
    });
    const opacity = derive(() => {
      const h = hovered.value, f = focused.value;
      if (h === null && f === null) return 0.15;
      return (h ?? f) === idx ? 0.55 : 0.04;
    });

    const ribbon = s(pathD(d, { stroke, strokeWidth: sw, opacity, cap: "butt" }));
    ribbonEls.set(ribbon.el, idx);
    if (ribbon.el.firstElementChild) ribbonEls.set(ribbon.el.firstElementChild, idx);
    ribbon.el.style.cursor = "pointer";
    ribbon.el.addEventListener("pointerenter", (e) => {
      if (wheelLocked.current !== null) return;
      hovered.value = idx;
      const lk = layout.value.links[idx] as any;
      const srcName = nodeIds[(lk.source as any).index ?? lk.source] ?? String(lk.source);
      const tgtName = nodeIds[(lk.target as any).index ?? lk.target] ?? String(lk.target);
      tooltipText.value = `${srcName} → ${tgtName}: ${lk.value.toFixed(1)}`;
      tooltipAt.value = toSVG(e as PointerEvent); tooltipVis.value = true;
    });
    ribbon.el.addEventListener("pointermove", (e) => { if (wheelLocked.current === null) tooltipAt.value = toSVG(e as PointerEvent); });
    ribbon.el.addEventListener("pointerleave", () => { if (wheelLocked.current !== null) return; if (hovered.value === idx) { hovered.value = null; tooltipVis.value = false; } });
    ribbon.el.addEventListener("click", () => { focused.value = focused.value === idx ? null : idx; });
  }

  // Nodes
  for (let i = 0; i < nodeIds.length; i++) {
    const name = nodeIds[i]!;
    const n = derive(() => layout.value.nodes[i] as any);
    const x0 = derive(() => n.value.x0 ?? 0);
    const y0 = derive(() => n.value.y0 ?? 0);
    const x1 = derive(() => n.value.x1 ?? 0);
    const y1 = derive(() => n.value.y1 ?? 0);
    const nw = derive(() => x1.value - x0.value);
    const nh = derive(() => y1.value - y0.value);
    const fill = derive(() => nodeColors.value[i] ?? "#6ab0f5");
    const isSink = derive(() => (n.value.height ?? 0) === 0);

    const tile = s(rect(x0, y0, nw, nh, { fill }));
    tile.el.addEventListener("pointerenter", (e) => {
      tooltipText.value = `${name}: ${(n.value.value ?? 0).toFixed(1)}`;
      tooltipAt.value = toSVG(e as PointerEvent); tooltipVis.value = true;
    });
    tile.el.addEventListener("pointermove", (e) => { tooltipAt.value = toSVG(e as PointerEvent); });
    tile.el.addEventListener("pointerleave", () => { tooltipVis.value = false; });

    const lx = derive(() => isSink.value ? x0.value - 4 : x1.value + 4);
    const ly = derive(() => y0.value + nh.value / 2);
    s(label(Vec.derive(() => ({ x: lx.value, y: ly.value })), name, {
      size: labelSize,
      align: derive(() => isSink.value ? Anchor.Right : Anchor.Left),
      fill: "#cdd5e0",
    }));
  }

  // Tooltip overlay
  const tlbl = s(label(
    Vec.derive(() => ({ x: tooltipAt.value.x + 10, y: tooltipAt.value.y - 10 })),
    tooltipText,
    { size: 11, fill: "#fff", align: Anchor.Left, opacity: derive(() => tooltipVis.value ? 1 : 0) },
  ));
  tlbl.el.style.pointerEvents = "none";

  return { focused, linkValues, layout, nodeColorProp, linkColorMode };
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
