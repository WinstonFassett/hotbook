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
import { getChartSchema } from "@hotbook/core";
import "@hotbook/bireactive"; // Import to trigger schema registration
import { MdViewerDemo } from "./viewer-demo-element";
import { MdCartesianViewerDemo } from "./cartesian-viewer-demo";

class MdBandsChartLC extends MdBarChartLC {
  constructor() { super(); this.orientation = 'horizontal'; this.colorMode = 'palette'; this.labelMode = 'inside'; this.valueMode = 'inside'; }
}

class MdGanttEnforcedLC extends MdGanttChartLC {
  constructor() { super(); this.enforceDeps = true; }
}

// Map demo IDs to chart kinds for schema lookup
const demoIdToKind: Record<string, string> = {
  'line-chart': 'line',
  'area-chart': 'area',
  'bar-chart': 'bar',
  'bands-chart': 'bands',
  'scatter-chart': 'scatter',
  'pie-chart': 'pie',
  'radar-chart': 'radar',
  'concentric-arc': 'concentric-arc',
  'gauge': 'gauge',
  'gauge-segmented': 'gauge-segmented',
  'pack': 'pack',
  'treemap': 'treemap',
  'icicle': 'icicle',
  'sunburst': 'sunburst',
  'sankey-simple': 'sankey',
  'sankey-complex': 'sankey',
  'tree-chart': 'tree',
  'budget-tree': 'pack', // budget-tree uses pack schema
  'gantt': 'gantt',
}

const experiments: Array<{
  id: string;
  title: string;
  tag: string;
  ctor: CustomElementConstructor;
  custom?: (section: HTMLElement, demo: HTMLElement, el: HTMLElement) => void;
}> = [
  { id: "viewer-demo", title: "Viewer (pan/zoom/show demo)", tag: "md-viewer-demo", ctor: MdViewerDemo as unknown as CustomElementConstructor },
  { id: "cartesian-viewer", title: "CartesianViewer (zoomable scatterplot with axes)", tag: "md-cartesian-viewer", ctor: MdCartesianViewerDemo as unknown as CustomElementConstructor },
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
  { id: "hier-family", title: "Hierarchical family (shared dataset, cross-view sync)", tag: "v-icicle", ctor: MdIcicleLC, custom: mountHierFamily },
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
function applySort(el: HTMLElement, treetable: HTMLElement | null, model: DemoDataModel | undefined, kind?: string) {
  // Only drive chart sort if the schema actually declares a sort field.
  const schema = kind ? getChartSchema(kind) : undefined;
  const hasSort = schema?.ui.fields.some(f => f.type === 'sort') ?? false;
  if (hasSort) {
    if ('sortBy' in el) {
      (el as any).sortBy = config.sort;
    } else if (model?.setSort) {
      model.setSort(el, config.sort);
      if (treetable) {
        (treetable as any).externalRoot = model.root;
        (treetable as any).refresh?.();
      }
    }
  }
  if (treetable && 'sortBy' in treetable) (treetable as any).sortBy = config.sort;
  // Drag-to-reorder gate (WIN-262): only active when sort is by natural order.
  if ('canReorder' in el) (el as any).canReorder = (config.sort === 'index');
}

function wireReorder(el: HTMLElement, treetable: HTMLElement | null, model: DemoDataModel | undefined) {
  if (!('onReorder' in el) && !('canReorder' in el)) return;
  if (!model?.setOrder) return;
  (el as any).onReorder = (ids: string[]) => {
    model.setOrder!(el, ids);
    if (treetable) {
      (treetable as any).externalRoot = model.root;
      (treetable as any).refresh?.();
    }
  };
}

// All four hierarchical charts on ONE dataset (same BiNode root → shared
// Kernel dataset via the bi-adapter). Edits preview live everywhere; drill
// syncs across views via the kernel drill channel.
function mountHierFamily(section: HTMLElement, demo: HTMLElement, el: HTMLElement): void {
  const model = dataModelFor("icicle");
  if (!model?.root) return;

  demo.style.cssText += "display:grid;grid-template-columns:1fr 1fr 1fr 240px;gap:8px;height:480px;overflow:hidden;";

  const sunburst = document.createElement("v-sunburst") as any;
  const treemap = document.createElement("v-treemap") as any;
  const table = document.createElement("v-treetable") as any;

  for (const c of [el, sunburst, treemap] as any[]) {
    c.externalRoot = model.root;
    c.showBreadcrumb = true;
    const wrap = document.createElement("div");
    wrap.style.cssText = "min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:6px;";
    wrap.appendChild(c);
    demo.appendChild(wrap);
  }
  table.externalRoot = model.root;
  if (model.columns) table.columns = model.columns;
  const tw = document.createElement("div");
  tw.style.cssText = "overflow:hidden;border:1px solid var(--border);border-radius:6px;";
  tw.appendChild(table);
  demo.appendChild(tw);
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

// Build schema-driven config UI for a demo chart
function buildChartConfigUI(demoId: string, chartEl: HTMLElement, dataModel?: DemoDataModel): HTMLElement | null {
  const kind = demoIdToKind[demoId];
  if (!kind) return null;

  const schema = getChartSchema(kind);
  if (!schema || !schema.ui.fields.length) return null;

  const controls = document.createElement('div');
  controls.className = 'chart-config-controls';
  controls.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px;border-bottom:1px solid var(--border);background:var(--bg-subtle,#1a1a1a);';

  for (const field of schema.ui.fields) {
    switch (field.type) {
      case 'depth': {
        const label = document.createElement('label');
        label.textContent = 'Depth:';
        label.style.cssText = 'font-size:12px;color:var(--text-muted,#999);';

        const sel = document.createElement('select');
        sel.style.cssText = 'padding:2px 4px;font-size:12px;';
        ;[['0', 'All'], ['1', '1L'], ['2', '2L'], ['3', '3L'], ['4', '4L'], ['5', '5L']].forEach(([v, l]) => {
          const opt = document.createElement('option');
          opt.value = v; opt.textContent = l;
          sel.appendChild(opt);
        });
        sel.value = String((chartEl as any).maxDepth ?? 0);
        sel.addEventListener('change', () => {
          (chartEl as any).maxDepth = Number(sel.value);
        });
        controls.appendChild(label);
        controls.appendChild(sel);
        break;
      }

      case 'orientation': {
        const label = document.createElement('label');
        label.textContent = 'Orient:';
        label.style.cssText = 'font-size:12px;color:var(--text-muted,#999);margin-left:8px;';

        const sel = document.createElement('select');
        sel.style.cssText = 'padding:2px 4px;font-size:12px;';
        ;[['horizontal', 'Horiz'], ['vertical', 'Vert']].forEach(([v, l]) => {
          const opt = document.createElement('option'); opt.value = v; opt.textContent = l; sel.appendChild(opt);
        });
        sel.value = (chartEl as any).orientation ?? 'horizontal';
        sel.addEventListener('change', () => {
          (chartEl as any).orientation = sel.value;
        });
        controls.appendChild(label);
        controls.appendChild(sel);
        break;
      }

      case 'measure': {
        const columns = dataModel?.columns?.filter(c => c.key !== 'index' && c.key !== '_index') ?? [];
        if (columns.length === 0) break;

        const label = document.createElement('label');
        label.textContent = `${field.label}:`;
        label.style.cssText = 'font-size:12px;color:var(--text-muted,#999);margin-left:8px;';

        const sel = document.createElement('select');
        sel.style.cssText = 'padding:2px 4px;font-size:12px;';
        columns.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.key;
          opt.textContent = c.label;
          sel.appendChild(opt);
        });
        sel.value = (chartEl as any).measureKey || columns[0].key;
        sel.addEventListener('change', () => {
          (chartEl as any).measureKey = sel.value;
          dataModel?.setChartData?.(chartEl);
          chartEl.dispatchEvent(new CustomEvent('chartconfigchange', { bubbles: true }));
        });
        controls.appendChild(label);
        controls.appendChild(sel);
        break;
      }

      case 'sort': {
        const label = document.createElement('label');
        label.textContent = 'Sort:';
        label.style.cssText = 'font-size:12px;color:var(--text-muted,#999);margin-left:8px;';

        const sel = document.createElement('select');
        sel.style.cssText = 'padding:2px 4px;font-size:12px;';
        ;[['index', 'Order'], ['value', 'Value']].forEach(([v, l]) => {
          const opt = document.createElement('option'); opt.value = v; opt.textContent = l; sel.appendChild(opt);
        });
        sel.value = (chartEl as any).sortBy ?? 'index';
        sel.addEventListener('change', () => {
          const newSort = sel.value as 'index' | 'value';
          if ('sortBy' in chartEl) {
            (chartEl as any).sortBy = newSort;
          } else if (dataModel?.setSort) {
            dataModel.setSort(chartEl, newSort);
          }
          chartEl.dispatchEvent(new CustomEvent('chartconfigchange', { bubbles: true }));
        });
        controls.appendChild(label);
        controls.appendChild(sel);
        break;
      }

      case 'xKey':
      case 'yKey': {
        const isX = field.type === 'xKey';
        const columns = dataModel?.columns ?? [];
        const label = document.createElement('label');
        label.textContent = `${field.label || (isX ? 'X' : 'Y')}:`;
        label.style.cssText = 'font-size:12px;color:var(--text-muted,#999);margin-left:8px;';

        const sel = document.createElement('select');
        sel.style.cssText = 'padding:2px 4px;font-size:12px;';
        if (isX) {
          const idxOpt = document.createElement('option');
          idxOpt.value = '_index';
          idxOpt.textContent = 'Index';
          sel.appendChild(idxOpt);
        }
        columns.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.key;
          opt.textContent = c.label;
          sel.appendChild(opt);
        });

        const prop = isX ? 'xKey' : 'yKey';
        const fallback = isX ? '_index' : (columns[1]?.key ?? columns[0]?.key);
        sel.value = (chartEl as any)[prop] ?? (chartEl as any)[field.path] ?? fallback;
        sel.addEventListener('change', () => {
          (chartEl as any)[prop] = sel.value;
          dataModel?.setChartData?.(chartEl);
          chartEl.dispatchEvent(new CustomEvent('chartconfigchange', { bubbles: true }));
        });
        controls.appendChild(label);
        controls.appendChild(sel);
        break;
      }
    }
  }

  return controls.children.length > 0 ? controls : null;
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
  const sortBtn = document.createElement('button');
  sortBtn.textContent = `sort: ${config.sort}`;
  sortBtn.onclick = () => set('sort', config.sort === 'value' ? 'index' : 'value');
  bar.append(sortBtn);
  updateSortLabel = () => { sortBtn.textContent = `sort: ${config.sort}`; };
  return bar;
}

const app = document.getElementById("app");
const mounted: Array<{ el: HTMLElement; treetable: HTMLElement | null; model?: DemoDataModel; kind?: string }> = [];
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
      el.addEventListener('gesturecommit', (ev: Event) => {
        const detail = (ev as CustomEvent).detail;
        // Only re-apply on commit (not cancel), matching tile-binder's contract.
        if (!detail || typeof detail.canceled !== 'boolean' || detail.canceled) return;
        const kind = demoIdToKind[e.id];
        const schema = kind ? getChartSchema(kind) : undefined;
        const hasSort = schema?.ui.fields.some(f => f.type === 'sort') ?? false;
        queueMicrotask(() => {
          if (!(el as any).gestureActive && hasSort && dataModel.setSort) {
            dataModel.setSort(el, config.sort);
            el.dispatchEvent(new CustomEvent('chartconfigchange', { bubbles: true }));
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
      let treetable: HTMLElement | null = null;

      // Keep the side treetable in sync when the config UI changes data/sort.
      if (dataModel) {
        el.addEventListener('chartconfigchange', () => {
          if (treetable) {
            (treetable as any).externalRoot = dataModel.root;
            (treetable as any).refresh?.();
          }
        });
      }

      // Build schema-driven config UI
      const configUI = buildChartConfigUI(e.id, el, dataModel);
      if (configUI) {
        demo.style.flexDirection = 'column';
        demo.appendChild(configUI);
      }

      const chartAndTableWrap = document.createElement('div');
      chartAndTableWrap.style.cssText = 'display:flex;flex:1;min-height:0;overflow:hidden;';

      const stage = document.createElement('div');
      stage.style.cssText = 'flex:1;min-width:0;height:100%;overflow:hidden;';
      stage.appendChild(el);

      const tableWrap = document.createElement('div');
      tableWrap.style.cssText = 'width:240px;min-width:240px;height:100%;overflow:hidden;border-left:1px solid var(--border);';

      treetable = document.createElement('v-treetable') as any;
      treetable.style.cssText = 'width:100%;height:100%;';
      if (dataModel) {
        treetable.externalRoot = dataModel.root;
        if (dataModel.columns) treetable.columns = dataModel.columns;
        dataModel.sync(el);
      }
      tableWrap.appendChild(treetable);

      chartAndTableWrap.appendChild(stage);
      chartAndTableWrap.appendChild(tableWrap);

      demo.style.display = 'flex';
      demo.style.overflow = 'hidden';
      demo.appendChild(chartAndTableWrap);

      const kind = demoIdToKind[e.id];
      wireReorder(el, treetable, dataModel);
      applySort(el, treetable, dataModel, kind);
      mounted.push({ el, treetable, model: dataModel, kind });
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
  for (const { el, treetable, model, kind } of mounted) applySort(el, treetable, model, kind);
});

function dedentFn(s: string): string {
  const lines = s.split("\n");
  const indents = lines.slice(1).filter(l => l.trim().length > 0).map(l => (l.match(/^ */) ?? [""])[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l, i) => i === 0 ? l : l.slice(min)).join("\n");
}
