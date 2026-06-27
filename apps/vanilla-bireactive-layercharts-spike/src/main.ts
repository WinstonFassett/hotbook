import { Diagram } from "bireactive";
import { MdPack } from "./demos/pack";
import { MdTreemapLC } from "./demos/treemap";
import { MdIcicleLC } from "./demos/icicle";
import { MdSunburstLC } from "./demos/sunburst";
import { MdLineChartLC } from "./demos/line-chart";
import { MdAreaChartLC } from "./demos/area-chart";
import { MdBarChartLC } from "./demos/bar-chart";
import { MdScatterChartLC } from "./demos/scatter-chart";
import { MdPieChartLC } from "./demos/pie-chart";
import { MdRadarChartLC } from "./demos/radar-chart";
import { MdConcentricArcLC } from "./demos/concentric-arc";
import { MdSankeySimple, MdSankeyComplex, MdSankeyHierarchy } from "./demos/sankey";
import { MdSankeyFlow } from "./demos/sankey-flow";
import { MdTreeChart } from "./demos/tree-chart";
import { MdBudgetTree } from "./demos/budget-tree";

class MdBandsChartLC extends MdBarChartLC {
  constructor() { super(); this.orientation = 'horizontal'; this.colorMode = 'palette'; this.labelMode = 'inside'; this.valueMode = 'inside'; }
}

const experiments: Array<{ id: string; title: string; tag: string; ctor: typeof Diagram }> = [
  { id: "line-chart", title: "LineChart", tag: "v-line-chart", ctor: MdLineChartLC },
  { id: "area-chart", title: "AreaChart", tag: "v-area-chart", ctor: MdAreaChartLC },
  { id: "bar-chart", title: "BarChart (vertical)", tag: "v-bar-chart", ctor: MdBarChartLC },
  { id: "bands-chart", title: "Bands (horizontal, palette, inside labels)", tag: "v-bands-chart", ctor: MdBandsChartLC },
  { id: "scatter-chart", title: "ScatterChart", tag: "v-scatter-chart", ctor: MdScatterChartLC },
  { id: "pie-chart", title: "PieChart", tag: "v-pie-chart", ctor: MdPieChartLC },
  { id: "radar-chart", title: "RadarChart (Radial Line)", tag: "v-radar-chart", ctor: MdRadarChartLC },
  { id: "concentric-arc", title: "ConcentricArc", tag: "v-concentric-arc", ctor: MdConcentricArcLC },
  { id: "pack", title: "Pack (circle packing)", tag: "v-pack", ctor: MdPack },
  { id: "treemap", title: "Treemap (squarified)", tag: "v-treemap", ctor: MdTreemapLC },
  { id: "icicle", title: "Icicle (Partition vertical)", tag: "v-icicle", ctor: MdIcicleLC },
  { id: "sunburst", title: "Sunburst (Partition polar)", tag: "v-sunburst", ctor: MdSunburstLC },
  { id: "sankey-simple", title: "Sankey (simple, editable)", tag: "v-sankey-simple", ctor: MdSankeySimple },
  { id: "sankey-complex", title: "Sankey (UK energy)", tag: "v-sankey-complex", ctor: MdSankeyComplex },
  { id: "sankey-hierarchy", title: "Sankey (hierarchy → flow)", tag: "v-sankey-hierarchy", ctor: MdSankeyHierarchy },
  { id: "sankey-flow", title: "Sankey (conservation flow, drag handles)", tag: "v-sankey-flow", ctor: MdSankeyFlow },
  { id: "tree-chart", title: "Tree (node-link dendrogram)", tag: "v-tree-chart", ctor: MdTreeChart },
  { id: "budget-tree", title: "Budget Tree (drag boundary handles)", tag: "v-budget-tree", ctor: MdBudgetTree },
];

for (const e of experiments) {
  if (!customElements.get(e.tag)) customElements.define(e.tag, e.ctor as any);
}

// --- Repro config: drive charts into the states that only break in sliceboard ---
// Static SPA, no server/router — so config rides the URL HASH (client-only, no reload).
// The hash is ALSO used for section anchors (#concentric-arc etc.), so config lives
// under a reserved `cfg:` segment and bare anchors are left untouched for scroll-nav:
//   #cfg:sort=value;width=320           config only
//   #concentric-arc                     plain anchor, ignored by config
//   #cfg:width=320|concentric-arc       config + anchor coexist ( '|' separates )
//   sort=value   sortBy='value' on every chart that has a sortBy prop
//   width=320    constrain each demo box width (trips narrow-tile bugs, e.g. Bug 2)
//   only=a,b     render only these experiment ids
const CFG_PREFIX = 'cfg:';
function parseHash(): { cfg: URLSearchParams; anchor: string } {
  const raw = location.hash.replace(/^#/, '');
  // Split config segment from a trailing bare anchor on '|'.
  const [a, b] = raw.split('|');
  const cfgSeg = a.startsWith(CFG_PREFIX) ? a.slice(CFG_PREFIX.length) : '';
  const anchor = a.startsWith(CFG_PREFIX) ? (b ?? '') : a;
  // Hash uses ';' between config keys so '&' isn't needed and anchors stay readable.
  return { cfg: new URLSearchParams(cfgSeg.replace(/;/g, '&')), anchor };
}
interface ReproConfig { sort: 'index' | 'value'; width: number | null; only: string[] | null; }
function readConfig(): ReproConfig {
  const { cfg } = parseHash();
  const widthRaw = cfg.get('width');
  const onlyRaw = cfg.get('only');
  return {
    sort: cfg.get('sort') === 'value' ? 'value' : 'index',
    width: widthRaw != null && widthRaw !== '' ? Number(widthRaw) : null,
    only: onlyRaw ? onlyRaw.split(',').map(s => s.trim()).filter(Boolean) : null,
  };
}
let config = readConfig();

function applyConfig(el: InstanceType<typeof Diagram>, demo: HTMLElement) {
  // Only set sortBy on charts that declare it (index/value charts).
  if ('sortBy' in el) (el as any).sortBy = config.sort;
  if (config.width != null) {
    demo.style.width = config.width + 'px';
    demo.style.maxWidth = config.width + 'px';
  } else {
    demo.style.width = '';
    demo.style.maxWidth = '';
  }
}

function buildConfigBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'repro-config-bar';
  const set = (k: string, v: string | null) => {
    const { cfg, anchor } = parseHash();
    if (v == null || v === '') cfg.delete(k); else cfg.set(k, v);
    const cfgStr = cfg.toString().replace(/&/g, ';');
    const parts = [];
    if (cfgStr) parts.push(CFG_PREFIX + cfgStr);
    location.hash = anchor ? `${parts[0] ?? ''}|${anchor}` : (parts[0] ?? '');
  };
  // sort toggle
  const sortBtn = document.createElement('button');
  sortBtn.textContent = `sort: ${config.sort}`;
  sortBtn.onclick = () => set('sort', config.sort === 'value' ? 'index' : 'value');
  // width presets
  const widthLabel = document.createElement('span');
  widthLabel.textContent = `width: ${config.width ?? 'full'}`;
  const mkW = (w: string, label: string) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => set('width', w);
    return b;
  };
  bar.append(sortBtn, widthLabel, mkW('', 'full'), mkW('640', '640'), mkW('420', '420'), mkW('320', '320'), mkW('240', '240'));
  return bar;
}

const app = document.getElementById("app");
// Track mounted elements so a live hash change re-applies config without reload.
const mounted: Array<{ el: InstanceType<typeof Diagram>; demo: HTMLElement }> = [];
if (app) {
  app.prepend(buildConfigBar());
  const shown = config.only
    ? experiments.filter(e => config.only!.includes(e.id))
    : experiments;
  for (const e of shown) {
    const section = document.createElement("section");
    section.id = e.id;
    section.className = "experiment";

    const h2 = document.createElement("h2");
    h2.textContent = e.title;

    const demo = document.createElement("div");
    demo.className = "demo";
    const el = document.createElement(e.tag) as InstanceType<typeof Diagram>;
    el.setAttribute("no-source", "");
    demo.appendChild(el);
    applyConfig(el, demo);
    mounted.push({ el, demo });

    // Source expander rendered outside the demo box
    const srcDetails = document.createElement("details");
    srcDetails.className = "diagram-source-panel";
    const srcSummary = document.createElement("summary");
    srcSummary.textContent = "source";
    const srcCode = document.createElement("md-syntax") as any;
    srcCode.setAttribute("lang", "ts");
    // scene() source is available after upgrade; grab it lazily on first open
    srcDetails.addEventListener("toggle", () => {
      if (srcDetails.open && !srcCode.textContent) {
        const proto = Object.getPrototypeOf(el);
        const sceneFn = proto?.scene ?? (el as any).scene;
        srcCode.textContent = sceneFn ? dedentFn(sceneFn.toString()) : "(source unavailable)";
        (srcCode as any).update?.();
      }
    }, { once: false });
    srcDetails.append(srcSummary, srcCode);

    section.append(h2, demo, srcDetails);
    app.appendChild(section);
  }
}

// Live hash changes: width re-applies in place; sort/only change construction → reload.
// Bare anchor jumps (#concentric-arc) carry no cfg: segment — let the browser scroll,
// don't reparse/reload (readConfig would return defaults and wipe state otherwise).
let lastCfgSeg = parseHash().cfg.toString();
window.addEventListener('hashchange', () => {
  const cfgSeg = parseHash().cfg.toString();
  if (cfgSeg === lastCfgSeg) return; // anchor-only change → ignore
  lastCfgSeg = cfgSeg;
  const next = readConfig();
  const needsReload = next.sort !== config.sort
    || JSON.stringify(next.only) !== JSON.stringify(config.only);
  config = next;
  if (needsReload) { location.reload(); return; }
  for (const { el, demo } of mounted) applyConfig(el, demo);
});

function dedentFn(s: string): string {
  const lines = s.split("\n");
  const indents = lines.slice(1).filter(l => l.trim().length > 0).map(l => (l.match(/^ */) ?? [""])[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l, i) => i === 0 ? l : l.slice(min)).join("\n");
}
