import {
  MdPack,
  MdTreemapLC,
  MdIcicleLC,
  MdSunburstLC,
  MdLineChartLC,
  MdAreaChartLC,
  MdBarChartLC,
  MdScatterChartLC,
  MdPieChartLC,
  MdRadarChartLC,
  MdConcentricArcLC,
  MdGaugeLC,
  MdGaugeSegmentedLC,
  MdSankeySimple,
  MdSankeyComplex,
  MdSankeyHierarchy,
  MdTreeChart,
  MdBudgetTree,
  MdTreetableLC,
  MdGanttChartLC,
} from "@hotbook/bireactive";
import { MdNestedLayered } from "@hotbook/layout";
import { dataModelFor, type DemoDataModel } from "./data-models";
import { sharedRows, sharedEdges } from "./layout/demo-data";
import { mountControls } from "./layout/controls";

class MdBandsChartLC extends MdBarChartLC {
  constructor() { super(); this.orientation = 'horizontal'; this.colorMode = 'palette'; this.labelMode = 'inside'; this.valueMode = 'inside'; }
}

class MdGanttEnforcedLC extends MdGanttChartLC {
  constructor() { super(); this.enforceDeps = true; }
}

const experiments: Array<{
  id: string;
  title: string;
  tag: string;
  ctor: CustomElementConstructor;
  custom?: (section: HTMLElement, demo: HTMLElement, el: HTMLElement) => void;
}> = [
  { id: "line-chart", title: "LineChart", tag: "v-line-chart", ctor: MdLineChartLC },
  { id: "area-chart", title: "AreaChart", tag: "v-area-chart", ctor: MdAreaChartLC },
  { id: "bar-chart", title: "BarChart (vertical)", tag: "v-bar-chart", ctor: MdBarChartLC },
  { id: "bands-chart", title: "Bands (horizontal, palette, inside labels)", tag: "v-bands-chart", ctor: MdBandsChartLC },
  { id: "scatter-chart", title: "ScatterChart", tag: "v-scatter-chart", ctor: MdScatterChartLC },
  { id: "pie-chart", title: "PieChart", tag: "v-pie-chart", ctor: MdPieChartLC },
  { id: "radar-chart", title: "RadarChart (Radial Line)", tag: "v-radar-chart", ctor: MdRadarChartLC },
  { id: "concentric-arc", title: "ConcentricArc", tag: "v-concentric-arc", ctor: MdConcentricArcLC },
  { id: "gauge", title: "Gauge (single 270° arc, draggable endpoint + center scrub)", tag: "v-gauge", ctor: MdGaugeLC },
  { id: "gauge-segmented", title: "Gauge (segmented, draggable boundaries)", tag: "v-gauge-segmented", ctor: MdGaugeSegmentedLC },
  { id: "pack", title: "Pack (circle packing)", tag: "v-pack", ctor: MdPack },
  { id: "treemap", title: "Treemap (squarified)", tag: "v-treemap", ctor: MdTreemapLC },
  { id: "icicle", title: "Icicle (Partition vertical)", tag: "v-icicle", ctor: MdIcicleLC },
  { id: "sunburst", title: "Sunburst (Partition polar)", tag: "v-sunburst", ctor: MdSunburstLC },
  { id: "sankey-simple", title: "Sankey (simple, editable)", tag: "v-sankey-simple", ctor: MdSankeySimple },
  { id: "sankey-complex", title: "Sankey (UK energy)", tag: "v-sankey-complex", ctor: MdSankeyComplex },
  // Hidden: more tree than flow (WIN-265).
  // { id: "sankey-hierarchy", title: "Sankey (hierarchy → flow)", tag: "v-sankey-hierarchy", ctor: MdSankeyHierarchy },
  { id: "tree-chart", title: "Tree (node-link dendrogram)", tag: "v-tree-chart", ctor: MdTreeChart },
  { id: "budget-tree", title: "Budget Tree (drag boundary handles)", tag: "v-budget-tree", ctor: MdBudgetTree },
  // Hidden for now: demoing the treetable next to a treetable is redundant (WIN-255).
  // { id: "treetable", title: "Treetable (hierarchical, editable rows)", tag: "v-treetable", ctor: MdTreetableLC as unknown as CustomElementConstructor },
  { id: "gantt", title: "Gantt (drag propagates through dependencies, zero-slack enforced)", tag: "v-gantt", ctor: MdGanttEnforcedLC as unknown as CustomElementConstructor },
  { id: "nested-layered", title: "Nested-layered layout (recursive graph layout)", tag: "md-nested-layered", ctor: MdNestedLayered as unknown as CustomElementConstructor, custom: mountLayoutSection },
];

// The treetable demo section is hidden, but the side-by-side data tables still need the tag.
if (!customElements.get("v-treetable")) {
  customElements.define("v-treetable", MdTreetableLC as unknown as CustomElementConstructor);
}

for (const e of experiments) {
  if (!customElements.get(e.tag)) {
    try {
      customElements.define(e.tag, e.ctor as any);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotSupportedError') {
        const WrapperClass = class extends (e.ctor as any) {};
        customElements.define(e.tag, WrapperClass as any);
      } else {
        throw err;
      }
    }
  }
}

// --- Repro config: drive charts into the states that only break in hotbook ---
const CFG_PREFIX = 'cfg:';
function parseHash(): { cfg: URLSearchParams; anchor: string } {
  const raw = location.hash.replace(/^#/, '');
  const [a, b] = raw.split('|');
  const cfgSeg = a.startsWith(CFG_PREFIX) ? a.slice(CFG_PREFIX.length) : '';
  const anchor = a.startsWith(CFG_PREFIX) ? (b ?? '') : a;
  return { cfg: new URLSearchParams(cfgSeg.replace(/;/g, '&')), anchor };
}
interface ReproConfig { sort: 'index' | 'value'; only: string[] | null; }
function readConfig(): ReproConfig {
  const { cfg } = parseHash();
  const onlyRaw = cfg.get('only');
  return {
    sort: cfg.get('sort') === 'value' ? 'value' : 'index',
    only: onlyRaw ? onlyRaw.split(',').map(s => s.trim()).filter(Boolean) : null,
  };
}
let config = readConfig();

// Live sort: hierarchical charts expose a reactive sortBy and animate the
// toggle themselves; flat charts tween on data-order changes, so their demo
// data model re-feeds sorted data (setSort). Treetables re-sort via sortBy.
function applySort(el: HTMLElement, treetable: HTMLElement | null, model: DemoDataModel | undefined) {
  if ('sortBy' in el) {
    (el as any).sortBy = config.sort;
  } else if (model?.setSort) {
    model.setSort(el, config.sort);
    if (treetable) {
      (treetable as any).externalRoot = model.root;
      (treetable as any).refresh?.();
    }
  }
  if (treetable && 'sortBy' in treetable) (treetable as any).sortBy = config.sort;
}

function mountLayoutSection(section: HTMLElement, demo: HTMLElement, el: HTMLElement): void {
  const md = el as any;
  md.rows = sharedRows;
  md.edges = sharedEdges;

  demo.style.height = 'auto';
  demo.style.minHeight = '440px';
  demo.style.display = 'flex';
  demo.style.gap = '16px';
  demo.style.alignItems = 'flex-start';

  const toolbar = document.createElement('div');
  const stage = document.createElement('div');
  stage.style.cssText = 'flex:1;min-width:0;padding:16px;border:1px solid var(--border);border-radius:6px;';

  const dataWrap = document.createElement('div');
  dataWrap.style.cssText = 'width:260px;min-width:260px;height:420px;overflow:hidden;border:1px solid var(--border);border-radius:6px;';

  stage.appendChild(el);
  demo.appendChild(stage);
  demo.appendChild(dataWrap);

  const nested = dataModelFor('nested-layered');
  if (nested) {
    const treetable = document.createElement('v-treetable') as any;
    treetable.style.cssText = 'width:100%;height:100%;';
    treetable.externalRoot = nested.root;
    if (nested.columns) treetable.columns = nested.columns;
    dataWrap.appendChild(treetable);
    // Track this treetable so it gets sort updates.
    applySort(el, treetable, nested);
    mounted.push({ el, treetable, model: nested });
  }

  mountControls(toolbar);

  section.insertBefore(toolbar, demo);
}

let updateSortLabel: () => void = () => {};

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
  const sortBtn = document.createElement('button');
  sortBtn.textContent = `sort: ${config.sort}`;
  sortBtn.onclick = () => set('sort', config.sort === 'value' ? 'index' : 'value');
  bar.append(sortBtn);
  updateSortLabel = () => { sortBtn.textContent = `sort: ${config.sort}`; };
  return bar;
}

const app = document.getElementById("app");
const mounted: Array<{ el: HTMLElement; treetable: HTMLElement | null; model?: DemoDataModel }> = [];
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
    const el = document.createElement(e.tag) as HTMLElement;
    el.setAttribute("no-source", "");

    const dataModel = dataModelFor(e.id);
    if (dataModel) {
      dataModel.setChartData(el);
      // Listen for gesturecommit to re-trigger reorder after gesture ends (WIN-269).
      // Flat charts (bar/pie/radar) freeze their display order during gestures via
      // the gestureActive flag. When a value changes during the gesture and the
      // gesture ends, the chart's internal state has the new value but the frozen
      // display order hasn't reconciled to match the (possibly sorted) store order.
      // Re-applying the current sort triggers the reorder animation, matching the
      // tile-binder behavior that hotbook uses.
      el.addEventListener('gesturecommit', (e: Event) => {
        const detail = (e as CustomEvent).detail;
        // Only re-apply on commit (not cancel), matching tile-binder's contract.
        if (!detail || typeof detail.canceled !== 'boolean' || detail.canceled) return;
        queueMicrotask(() => {
          if (!(el as any).gestureActive && dataModel.setSort) {
            dataModel.setSort(el, config.sort);
          }
        });
      });
    }

    const srcDetails = document.createElement("details");
    srcDetails.className = "diagram-source-panel";
    const srcSummary = document.createElement("summary");
    srcSummary.textContent = "source";
    const srcCode = document.createElement("md-syntax") as any;
    srcCode.setAttribute("lang", "ts");
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

    if (e.custom) {
      e.custom(section, demo, el);
    } else {
      const stage = document.createElement('div');
      stage.style.cssText = 'flex:1;min-width:0;height:100%;overflow:hidden;';
      stage.appendChild(el);

      const tableWrap = document.createElement('div');
      tableWrap.style.cssText = 'width:240px;min-width:240px;height:100%;overflow:hidden;border-left:1px solid var(--border);';

      const treetable = document.createElement('v-treetable') as any;
      treetable.style.cssText = 'width:100%;height:100%;';
      if (dataModel) {
        treetable.externalRoot = dataModel.root;
        if (dataModel.columns) treetable.columns = dataModel.columns;
        dataModel.sync(el);
      }
      tableWrap.appendChild(treetable);

      demo.style.display = 'flex';
      demo.style.overflow = 'hidden';
      demo.appendChild(stage);
      demo.appendChild(tableWrap);

      applySort(el, treetable, dataModel);
      mounted.push({ el, treetable, model: dataModel });
    }
  }
}

let lastCfgSeg = parseHash().cfg.toString();
window.addEventListener('hashchange', () => {
  const cfgSeg = parseHash().cfg.toString();
  if (cfgSeg === lastCfgSeg) return;
  lastCfgSeg = cfgSeg;
  const next = readConfig();
  const needsReload = JSON.stringify(next.only) !== JSON.stringify(config.only);
  config = next;
  if (needsReload) { location.reload(); return; }
  updateSortLabel();
  for (const { el, treetable, model } of mounted) applySort(el, treetable, model);
});

function dedentFn(s: string): string {
  const lines = s.split("\n");
  const indents = lines.slice(1).filter(l => l.trim().length > 0).map(l => (l.match(/^ */) ?? [""])[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l, i) => i === 0 ? l : l.slice(min)).join("\n");
}
