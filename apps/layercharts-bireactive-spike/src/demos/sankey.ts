import {
  Anchor,
  Diagram,
  cell,
  derive,
  label,
  pathD,
  rect,
  Vec,
  type Mount,
} from "bireactive";
import {
  sankey as d3sankey,
  sankeyJustify,
  sankeyLinkHorizontal,
  type SankeyGraph,
} from "d3-sankey";
import { scaleSequential } from "d3-scale";
import { interpolateCool, interpolateWarm } from "d3-scale-chromatic";
import { installGestureRelease } from "../lib/interaction";

const linkPath = sankeyLinkHorizontal();

function nodeColorScale(nodes: any[], prop: string, interp: (t: number) => string) {
  const vals = nodes.map((n) => n[prop] as number);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const scale = scaleSequential(interp).domain([lo, hi === lo ? lo + 1 : hi]);
  return nodes.map((n) => scale(n[prop] as number));
}

// ---------------------------------------------------------------------------
// Shared scene builder — both takes use this
// ---------------------------------------------------------------------------

interface LinkDef { source: string | number; target: string | number; init: number }

function sankeyScene(
  host: Diagram,
  s: Mount,
  opts: {
    W: number; H: number;
    nodeIds: string[];
    linkDefs: LinkDef[];
    nodeWidth?: number;
    nodePadding?: number;
    interp?: (t: number) => string;
    labelSize?: number;
  }
) {
  const { W, H, nodeIds, linkDefs, nodeWidth = 10, nodePadding = 6, interp = interpolateCool, labelSize = 10 } = opts;

  // Detect whether links use string names or numeric indices
  const useStringIds = typeof linkDefs[0]?.source === "string";

  host.tabIndex = 0;
  host.style.outline = "none";

  const linkValues = linkDefs.map((l) => ({ ...l, value: cell(l.init) }));

  const engine = d3sankey<{},{ source: string | number; target: string | number }>()
    .nodeId(useStringIds ? ((_d: any, i: number) => nodeIds[i]!) : ((_d: any, i: number) => i))
    .nodeAlign(sankeyJustify)
    .nodeWidth(nodeWidth)
    .nodePadding(nodePadding)
    .extent([[0, 0], [W, H]]);

  const layout = derive(() => engine(({
    nodes: nodeIds.map(() => ({})),
    links: linkValues.map((l) => ({ source: l.source, target: l.target, value: Math.max(0.01, l.value.value) })),
  }) as SankeyGraph<{},{}>));

  const nodeColors = derive(() => {
    const nodes = layout.value.nodes as any[];
    return nodeColorScale(nodes, "layer", interp);
  });

  const hovered = cell<number | null>(null);
  const focused = cell<number | null>(null);
  const wheelLocked = { current: null as number | null };

  installGestureRelease(() => { wheelLocked.current = null; });

  host.addEventListener("wheel", ((e: WheelEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (wheelLocked.current === null) wheelLocked.current = hovered.value ?? focused.value;
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

    const d = derive(() => linkPath(layout.value.links[idx] as any) ?? "");
    const sw = derive(() => (layout.value.links[idx] as any).width ?? 1);
    const stroke = derive(() => focused.value === idx ? "#fff" : nodeColors.value[srcIdx] ?? "#6ab0f5");
    const opacity = derive(() => {
      const h = hovered.value, f = focused.value;
      if (h === null && f === null) return 0.15;
      return (h ?? f) === idx ? 0.55 : 0.04;
    });

    const ribbon = s(pathD(d, { stroke, strokeWidth: sw, opacity, cap: "butt" }));
    ribbon.el.style.cursor = "pointer";
    ribbon.el.addEventListener("pointerenter", (e) => {
      hovered.value = idx;
      const lk = layout.value.links[idx] as any;
      tooltipText.value = `${nodeIds[lk.source.index]} → ${nodeIds[lk.target.index]}: ${lk.value.toFixed(1)}`;
      tooltipAt.value = toSVG(e as PointerEvent); tooltipVis.value = true;
    });
    ribbon.el.addEventListener("pointermove", (e) => { tooltipAt.value = toSVG(e as PointerEvent); });
    ribbon.el.addEventListener("pointerleave", () => { if (hovered.value === idx) { hovered.value = null; tooltipVis.value = false; } });
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

  return { focused, linkValues, layout };
}

// ---------------------------------------------------------------------------
// Take 1: Simple editable graph
// ---------------------------------------------------------------------------

const SIMPLE_NODES = ["A1","A2","A3","B1","B2","B3","B4","C1","C2","C3","D1","D2"];
const SIMPLE_LINKS: LinkDef[] = [
  {source:"A1",target:"B1",init:27},{source:"A1",target:"B2",init:9},
  {source:"A2",target:"B2",init:5},{source:"A2",target:"B3",init:11},
  {source:"A3",target:"B2",init:12},{source:"A3",target:"B4",init:7},
  {source:"B1",target:"C1",init:13},{source:"B1",target:"C2",init:10},
  {source:"B4",target:"C2",init:5},{source:"B4",target:"C3",init:2},
  {source:"B1",target:"D1",init:4},{source:"C3",target:"D1",init:1},
  {source:"C3",target:"D2",init:1},
];

export class MdSankeySimple extends Diagram {
  protected scene(s: Mount): void {
    const W = 560, H = 340;
    const view = this.view(W + 120, H + 24);
    const { focused, linkValues } = sankeyScene(this, s, {
      W, H, nodeIds: SIMPLE_NODES, linkDefs: SIMPLE_LINKS, labelSize: 11,
    });
    s(label(view.bottom.up(10), derive(() => {
      const f = focused.value;
      if (f === null) return "click ribbon to focus · cmd+wheel or ↑↓ to edit · Tab to cycle";
      const lv = linkValues[f]!;
      return `${lv.source}→${lv.target}: ${lv.value.value.toFixed(1)} · ↑↓ / cmd+wheel · Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));
  }
}

// ---------------------------------------------------------------------------
// Take 2: Complex UK energy — same DM, more data
// ---------------------------------------------------------------------------

const COMPLEX_NODES = [
  "Agricultural 'waste'","Bio-conversion","Liquid","Losses","Solid","Gas",
  "Biofuel imports","Biomass imports","Coal imports","Coal","Coal reserves",
  "District heating","Industry","Heating and cooling - commercial",
  "Heating and cooling - homes","Electricity grid","Over generation / exports",
  "H2 conversion","Road transport","Agriculture","Rail transport",
  "Lighting & appliances - commercial","Lighting & appliances - homes",
  "Gas imports","Ngas","Gas reserves","Thermal generation","Geothermal",
  "H2","Hydro","International shipping","Domestic aviation",
  "International aviation","National navigation","Marine algae","Nuclear",
  "Oil imports","Oil","Oil reserves","Other waste","Pumped heat","Solar PV",
  "Solar Thermal","Solar","Tidal","UK land based bioenergy","Wave","Wind",
];
const COMPLEX_LINKS: LinkDef[] = [
  {source:0,target:1,init:124.729},{source:1,target:2,init:0.597},
  {source:1,target:3,init:26.862},{source:1,target:4,init:280.322},{source:1,target:5,init:81.144},
  {source:6,target:2,init:35},{source:7,target:4,init:35},
  {source:8,target:9,init:11.606},{source:10,target:9,init:63.965},{source:9,target:4,init:75.571},
  {source:11,target:12,init:10.639},{source:11,target:13,init:22.505},{source:11,target:14,init:46.184},
  {source:15,target:16,init:104.453},{source:15,target:14,init:113.726},{source:15,target:17,init:27.14},
  {source:15,target:12,init:342.165},{source:15,target:18,init:37.797},{source:15,target:19,init:4.412},
  {source:15,target:13,init:40.858},{source:15,target:3,init:56.691},{source:15,target:20,init:7.863},
  {source:15,target:21,init:90.008},{source:15,target:22,init:93.494},
  {source:23,target:24,init:40.719},{source:25,target:24,init:82.233},
  {source:5,target:13,init:0.129},{source:5,target:3,init:1.401},{source:5,target:26,init:151.891},
  {source:5,target:19,init:2.096},{source:5,target:12,init:48.58},
  {source:24,target:26,init:267.84},{source:26,target:27,init:9.452},{source:26,target:15,init:182.01},
  {source:26,target:3,init:19.885},{source:26,target:12,init:289.366},
  {source:27,target:15,init:7.013},{source:28,target:17,init:20.897},{source:29,target:15,init:6.995},
  {source:2,target:12,init:121.066},{source:2,target:30,init:128.69},{source:2,target:18,init:135.835},
  {source:2,target:31,init:14.458},{source:2,target:32,init:206.267},{source:2,target:19,init:3.64},
  {source:2,target:33,init:33.218},{source:34,target:1,init:4.375},{source:24,target:5,init:122.952},
  {source:35,target:15,init:70.672},{source:35,target:26,init:59.901},
  {source:36,target:37,init:137.469},{source:38,target:37,init:504.287},
  {source:37,target:2,init:710.584},{source:37,target:3,init:19.229},
  {source:40,target:14,init:56.691},{source:40,target:13,init:11.606},{source:40,target:12,init:7.863},
  {source:41,target:15,init:19.885},{source:42,target:11,init:46.184},
  {source:43,target:42,init:10.639},{source:43,target:41,init:22.505},
  {source:44,target:15,init:2.096},{source:45,target:1,init:46.839},
  {source:46,target:15,init:2.096},{source:47,target:15,init:79.329},
];

export class MdSankeyComplex extends Diagram {
  protected scene(s: Mount): void {
    const W = 800, H = 560;
    const view = this.view(W + 180, H + 24);
    const { focused, linkValues } = sankeyScene(this, s, {
      W, H, nodeIds: COMPLEX_NODES, linkDefs: COMPLEX_LINKS,
      nodePadding: 4, interp: interpolateWarm, labelSize: 9,
    });
    s(label(view.bottom.up(10), derive(() => {
      const f = focused.value;
      if (f === null) return "click ribbon to focus · cmd+wheel or ↑↓ to edit · Tab to cycle";
      const lv = linkValues[f]!;
      const src = typeof lv.source === "number" ? COMPLEX_NODES[lv.source] : lv.source;
      const tgt = typeof lv.target === "number" ? COMPLEX_NODES[lv.target] : lv.target;
      return `${src} → ${tgt}: ${lv.value.value.toFixed(1)} · ↑↓ / cmd+wheel · Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));
  }
}
