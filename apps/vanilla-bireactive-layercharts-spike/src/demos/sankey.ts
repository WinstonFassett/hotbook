import { Anchor, Diagram, derive, label, type Mount } from "bireactive";
import { interpolateCool, interpolateWarm, interpolateRainbow } from "d3-scale-chromatic";
import { hierarchy } from "d3-hierarchy";
import { sankeyScene, renderColorControls, type LinkDef } from "../lib/sankey";

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
  externalData?: { nodes: string[]; links: { source: string; target: string; value: number }[] }

  protected scene(s: Mount): void {
    const ext = this.externalData
    const nodeIds = ext ? ext.nodes : SIMPLE_NODES
    const linkDefs: LinkDef[] = ext ? ext.links.map(l => ({ source: l.source, target: l.target, init: l.value })) : SIMPLE_LINKS
    const nodePadding = ext ? Math.max(1, Math.min(6, Math.floor(300 / nodeIds.length))) : 6
    const W = 560, H = ext ? Math.max(340, nodeIds.length * (8 + nodePadding)) : 340;
    const view = this.view(W + 120, H + 48);
    const { focused, hovered, wheelLocked, linkValues, nodeColorProp, linkColorMode } = sankeyScene(this, s, {
      W, H, nodeIds, linkDefs, labelSize: 11, stringIds: true, nodePadding,
    });
    renderColorControls(s, view, nodeColorProp, linkColorMode);
    s(label(view.bottom.up(40), derive(() => {
      const i = focused.value ?? wheelLocked.value ?? hovered.value;
      if (i === null) return "click ribbon to focus · cmd+wheel or ↑↓ to edit · Tab to cycle";
      const lv = linkValues[i]!;
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
    const view = this.view(W + 180, H + 48);
    const { focused, hovered, wheelLocked, linkValues, nodeColorProp, linkColorMode } = sankeyScene(this, s, {
      W, H, nodeIds: COMPLEX_NODES, linkDefs: COMPLEX_LINKS,
      nodePadding: 4, interp: interpolateWarm, labelSize: 9, stringIds: false,
    });
    renderColorControls(s, view, nodeColorProp, linkColorMode);
    s(label(view.bottom.up(40), derive(() => {
      const i = focused.value ?? wheelLocked.value ?? hovered.value;
      if (i === null) return "click ribbon to focus · cmd+wheel or ↑↓ to edit · Tab to cycle";
      const lv = linkValues[i]!;
      const src = typeof lv.source === "number" ? COMPLEX_NODES[lv.source] : lv.source;
      const tgt = typeof lv.target === "number" ? COMPLEX_NODES[lv.target] : lv.target;
      return `${src} → ${tgt}: ${lv.value.value.toFixed(1)} · ↑↓ / cmd+wheel · Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));
  }
}

// ---------------------------------------------------------------------------
// Take 3: Hierarchy take — d3-hierarchy tree flattened to sankey parent→child
// ---------------------------------------------------------------------------

interface HNode { name: string; value?: number; children?: HNode[] }

const FLARE_TREE: HNode = {
  name: "flare",
  children: [
    { name: "analytics", children: [
      { name: "cluster", children: [
        { name: "AgglomerativeCluster", value: 3938 },
        { name: "CommunityStructure", value: 3812 },
        { name: "HierarchicalCluster", value: 6714 },
        { name: "MergeEdge", value: 743 },
      ]},
      { name: "graph", children: [
        { name: "BetweennessCentrality", value: 3534 },
        { name: "LinkDistance", value: 5731 },
        { name: "MaxFlowMinCut", value: 7840 },
        { name: "ShortestPaths", value: 5914 },
        { name: "SpanningTree", value: 3416 },
      ]},
      { name: "optimization", children: [
        { name: "AspectRatioBanker", value: 7074 },
      ]},
    ]},
    { name: "animate", children: [
      { name: "Easing", value: 17010 },
      { name: "FunctionSequence", value: 5842 },
      { name: "interpolate", children: [
        { name: "ArrayInterpolator", value: 1983 },
        { name: "ColorInterpolator", value: 2047 },
        { name: "DateInterpolator", value: 1375 },
        { name: "Interpolator", value: 8746 },
        { name: "MatrixInterpolator", value: 2202 },
        { name: "NumberInterpolator", value: 1382 },
        { name: "ObjectInterpolator", value: 1629 },
        { name: "StringInterpolator", value: 2397 },
        { name: "SubstringInterpolator", value: 698 },
      ]},
      { name: "ISchedulable", value: 1041 },
      { name: "Scheduler", value: 5297 },
      { name: "Sequence", value: 5575 },
      { name: "Transition", value: 9201 },
      { name: "Transitioner", value: 19975 },
      { name: "TransitionEvent", value: 1116 },
      { name: "Tween", value: 6006 },
    ]},
    { name: "data", children: [
      { name: "converters", children: [
        { name: "Converters", value: 721 },
        { name: "DelimitedTextConverter", value: 4294 },
        { name: "GraphMLConverter", value: 9800 },
        { name: "IDataConverter", value: 1314 },
        { name: "JSONConverter", value: 2220 },
      ]},
      { name: "DataField", value: 1759 },
      { name: "DataSchema", value: 2165 },
      { name: "DataSet", value: 586 },
      { name: "DataSource", value: 3331 },
      { name: "DataTable", value: 772 },
      { name: "DataUtil", value: 3322 },
    ]},
    { name: "display", children: [
      { name: "DirtySprite", value: 8833 },
      { name: "LineSprite", value: 1732 },
      { name: "RectSprite", value: 4595 },
      { name: "TextSprite", value: 1093 },
    ]},
    { name: "flex", children: [
      { name: "FlexSprite", value: 4554 },
    ]},
    { name: "physics", children: [
      { name: "DragForce", value: 1082 },
      { name: "GravityForce", value: 1336 },
      { name: "IForce", value: 319 },
      { name: "NBodyForce", value: 10498 },
      { name: "Particle", value: 2822 },
      { name: "Simulation", value: 9983 },
      { name: "Spring", value: 2213 },
      { name: "SpringForce", value: 1681 },
    ]},
  ],
};

// Convert a d3-hierarchy tree into {nodeIds, linkDefs} for sankeyScene
function hierarchyToSankey(root: HNode): { nodeIds: string[]; linkDefs: LinkDef[] } {
  const nodeIds: string[] = [];
  const seen = new Map<string, string>();
  const linkDefs: LinkDef[] = [];

  function uniqueName(name: string): string {
    if (!seen.has(name)) { seen.set(name, name); return name; }
    let i = 2;
    while (seen.has(`${name} (${i})`)) i++;
    const u = `${name} (${i})`;
    seen.set(u, u);
    return u;
  }

  function walk(node: HNode, parentId: string | null) {
    const id = uniqueName(node.name);
    nodeIds.push(id);
    if (parentId !== null) {
      // Use leaf value or sum of children (rough estimate — will reflow via sankey anyway)
      const init = node.value ?? 1000;
      linkDefs.push({ source: parentId, target: id, init });
    }
    for (const child of node.children ?? []) {
      walk(child, id);
    }
  }

  walk(root, null);
  return { nodeIds, linkDefs };
}

export class MdSankeyHierarchy extends Diagram {
  protected scene(s: Mount): void {
    const W = 680, H = 500;
    const view = this.view(W + 160, H + 48);
    const { nodeIds, linkDefs } = hierarchyToSankey(FLARE_TREE);
    const { focused, hovered, wheelLocked, linkValues, nodeColorProp, linkColorMode } = sankeyScene(this, s, {
      W, H, nodeIds, linkDefs,
      nodePadding: 3, interp: interpolateRainbow, labelSize: 8, stringIds: true,
      stepFn: (v, shift) => Math.max(1, Math.round(v * (shift ? 0.25 : 0.1))),
    });
    renderColorControls(s, view, nodeColorProp, linkColorMode);
    s(label(view.bottom.up(40), derive(() => {
      const i = focused.value ?? wheelLocked.value ?? hovered.value;
      if (i === null) return "hierarchy → sankey · click ribbon to focus · cmd+wheel or ↑↓ to edit";
      const lv = linkValues[i]!;
      return `${lv.source} → ${lv.target}: ${lv.value.value.toFixed(0)} · ↑↓ / cmd+wheel`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));
  }
}
