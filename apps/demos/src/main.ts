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
  mountMotionTweaks,
} from "@hotbook/bireactive";
import { MdNestedLayered } from "@hotbook/layout";
import { dataModelFor, type DemoDataModel } from "./data-models";
import { sharedRows, sharedEdges } from "./layout/demo-data";
import { mountControls } from "./layout/controls";
import { getChartSchema } from "@hotbook/core";
import { cell, derive, effect, untracked } from "bireactive";
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
  underConstruction?: boolean;
}> = [
  // ── Tier 1: Hierarchical (the primary surface) ──────────────────────────
  { id: "hier-family", title: "Hierarchical family (shared dataset, cross-view sync)", tag: "v-icicle", ctor: MdIcicleLC, custom: mountHierFamily },
  { id: "icicle", title: "Icicle (Partition vertical)", tag: "v-icicle", ctor: MdIcicleLC },
  { id: "sunburst", title: "Sunburst (Partition polar)", tag: "v-sunburst", ctor: MdSunburstLC },
  { id: "treemap", title: "Treemap (squarified)", tag: "v-treemap", ctor: MdTreemapLC },
  { id: "pack", title: "Pack (circle packing)", tag: "v-pack", ctor: MdPack },
  // Hidden for now: demoing the treetable next to a treetable is redundant (WIN-255).
  // { id: "treetable", title: "Treetable (hierarchical, editable rows)", tag: "v-treetable", ctor: MdTreetableLC as unknown as CustomElementConstructor },

  // ── Tier 2: Cartesian family ────────────────────────────────────────────
  { id: "line-chart", title: "LineChart", tag: "v-line-chart", ctor: MdLineChartLC },
  { id: "area-chart", title: "AreaChart", tag: "v-area-chart", ctor: MdAreaChartLC },
  { id: "bar-chart", title: "BarChart (vertical)", tag: "v-bar-chart", ctor: MdBarChartLC },
  { id: "bands-chart", title: "Bands (horizontal, palette, inside labels)", tag: "v-bands-chart", ctor: MdBandsChartLC },
  { id: "scatter-chart", title: "ScatterChart", tag: "v-scatter-chart", ctor: MdScatterChartLC },

  // ── Tier 3: Novelty (radial / gauge) ────────────────────────────────────
  { id: "radar-chart", title: "RadarChart (Radial Line)", tag: "v-radar-chart", ctor: MdRadarChartLC },
  { id: "concentric-arc", title: "ConcentricArc", tag: "v-concentric-arc", ctor: MdConcentricArcLC },
  { id: "gauge", title: "Gauge (single 270° arc, draggable endpoint + center scrub)", tag: "v-gauge", ctor: MdGaugeLC },
  { id: "gauge-segmented", title: "Gauge (segmented, draggable boundaries)", tag: "v-gauge-segmented", ctor: MdGaugeSegmentedLC },

  // ── Tier 4: Under construction ──────────────────────────────────────────
  { id: "pie-chart", title: "PieChart (under construction)", tag: "v-pie-chart", ctor: MdPieChartLC, underConstruction: true },
  { id: "sankey-simple", title: "Sankey (simple, editable)", tag: "v-sankey-simple", ctor: MdSankeySimple, underConstruction: true },
  { id: "sankey-complex", title: "Sankey (UK energy)", tag: "v-sankey-complex", ctor: MdSankeyComplex, underConstruction: true },
  // Hidden: more tree than flow (WIN-265).
  // { id: "sankey-hierarchy", title: "Sankey (hierarchy → flow)", tag: "v-sankey-hierarchy", ctor: MdSankeyHierarchy },
  { id: "tree-chart", title: "Tree (node-link dendrogram)", tag: "v-tree-chart", ctor: MdTreeChart, underConstruction: true },
  { id: "budget-tree", title: "Budget Tree (drag boundary handles)", tag: "v-budget-tree", ctor: MdBudgetTree, underConstruction: true },
  { id: "gantt", title: "Gantt (drag propagates through dependencies, zero-slack enforced)", tag: "v-gantt", ctor: MdGanttEnforcedLC as unknown as CustomElementConstructor, underConstruction: true },
  { id: "nested-layered", title: "Nested-layered layout (recursive graph layout)", tag: "md-nested-layered", ctor: MdNestedLayered as unknown as CustomElementConstructor, custom: mountLayoutSection, underConstruction: true },

  // ── Tier 5: Experimental viewers ────────────────────────────────────────
  { id: "cartesian-viewer", title: "CartesianViewer (zoomable scatterplot with axes)", tag: "md-cartesian-viewer", ctor: MdCartesianViewerDemo as unknown as CustomElementConstructor, underConstruction: true },
  { id: "viewer-demo", title: "Viewer (pan/zoom/show demo)", tag: "md-viewer-demo", ctor: MdViewerDemo as unknown as CustomElementConstructor, underConstruction: true },
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
// `only` is read once at load (reload on change); `sort` is reactive below.
const config = { only: readConfig().only };

// --- Sort: reactive global default + per-chart overrides ---
// (chart-architecture.md §"Config layering": global defaults, per-chart
// overrides win. The chart is the source of truth for its own effective
// config; the global bar is a default, not a hidden override.)
//
// `globalSort` is the page-wide default, driven by the global sort button and
// the URL hash. Each chart gets its own `sortOverride` cell (null = fall back
// to global). `effectiveSort` derives per chart: override ?? global. An effect
// per chart applies the effective sort to the chart + side treetable whenever
// it changes — no applySort loop, no hashchange walker, no gesturecommit
// re-apply reading a stale global.
const globalSort = cell<'index' | 'value'>(readConfig().sort);
// Update globalSort from URL hash changes (the global button writes the hash).
let lastCfgSeg = parseHash().cfg.toString();
window.addEventListener('hashchange', () => {
  const cfgSeg = parseHash().cfg.toString();
  if (cfgSeg === lastCfgSeg) return;
  lastCfgSeg = cfgSeg;
  const next = readConfig();
  globalSort.value = next.sort;
  // `only` change requires a reload (chart set changes).
  if (JSON.stringify(next.only) !== JSON.stringify(config.only)) location.reload();
});

interface ChartSortState {
  /** Per-chart override cell (null = fall back to global default). */
  override: ReturnType<typeof cell<'index' | 'value' | null>>;
  /** Derived effective sort: override ?? globalSort. */
  effective: ReturnType<typeof derive<'index' | 'value'>>;
}
const chartSortStates = new Map<HTMLElement, ChartSortState>();

/** Get or create the per-chart sort state for an element. The per-chart
 *  selector writes to `override`; everyone else reads `effective`. */
function chartSort(el: HTMLElement): ChartSortState {
  let st = chartSortStates.get(el);
  if (!st) {
    const override = cell<'index' | 'value' | null>(null);
    const effective = derive(() => override.value ?? globalSort.value);
    st = { override, effective };
    chartSortStates.set(el, st);
  }
  return st;
}

/** Wire a chart's effective sort to its chart + side treetable. The effect
 *  fires on mount and whenever the effective sort changes (global or override).
 *  Hierarchical charts have a reactive `sortBy` → setting it re-derives layout.
 *  Flat charts (bar/pie) re-feed sorted data via the data model. The treetable
 *  follows via its own `sortBy`. */
function wireSort(
  el: HTMLElement,
  treetable: HTMLElement | null,
  model: DemoDataModel | undefined,
  kind?: string,
): void {
  const schema = kind ? getChartSchema(kind) : undefined;
  const hasSort = schema?.ui.fields.some(f => f.type === 'sort') ?? false;
  if (!hasSort) return;
  const { effective } = chartSort(el);
  effect(() => {
    const sort = effective.value;
    // untracked: setSort/apply reads el.dataCell and el.measureKey (bireactive
    // cells). Without untracked, the effect would track those cells as deps
    // and re-fire when apply writes el.externalData → infinite loop.
    untracked(() => {
      if ('sortBy' in el) {
        (el as any).sortBy = sort;
      } else if (model?.setSort) {
        model.setSort(el, sort);
        if (treetable) {
          (treetable as any).externalRoot = model.root;
          (treetable as any).refresh?.();
        }
      }
      if (treetable && 'sortBy' in treetable) (treetable as any).sortBy = sort;
      // Drag-to-reorder gate (WIN-262): only active when sort is by natural order.
      if ('canReorder' in el) (el as any).canReorder = (sort === 'index');
    });
  });
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

// All five hierarchical charts on ONE dataset (same BiNode root → shared
// Kernel dataset via the bi-adapter). Edits preview live everywhere; drill
// syncs across views via the kernel drill channel.
//
// Layout: icicle (left, full height) | pack + sunburst (center, stacked) |
// treemap (right, full height) | treetable (far right). This makes a neat
// rectangle and lets you compare visual/separation styles across all 4
// hierarchical SVG charts side by side.
function mountHierFamily(section: HTMLElement, demo: HTMLElement, el: HTMLElement): void {
  const model = dataModelFor("icicle");
  if (!model?.root) return;

  demo.style.cssText += "display:grid;grid-template-columns:1fr 1fr 1fr 240px;gap:8px;height:560px;overflow:hidden;";

  const sunburst = document.createElement("v-sunburst") as any;
  const treemap = document.createElement("v-treemap") as any;
  const pack = document.createElement("v-pack") as any;
  const table = document.createElement("v-treetable") as any;

  // Left column: icicle (el) — full height.
  el.externalRoot = model.root;
  el.showBreadcrumb = true;
  const icicleWrap = document.createElement("div");
  icicleWrap.style.cssText = "min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:6px;";
  icicleWrap.appendChild(el);
  demo.appendChild(icicleWrap);

  // Center column: pack (top) + sunburst (bottom) — stacked.
  const centerCol = document.createElement("div");
  centerCol.style.cssText = "display:flex;flex-direction:column;gap:8px;min-width:0;";
  for (const c of [pack, sunburst] as any[]) {
    c.externalRoot = model.root;
    c.showBreadcrumb = true;
    const wrap = document.createElement("div");
    wrap.style.cssText = "flex:1;min-height:0;overflow:hidden;border:1px solid var(--border);border-radius:6px;";
    wrap.appendChild(c);
    centerCol.appendChild(wrap);
  }
  demo.appendChild(centerCol);

  // Right column: treemap — full height.
  treemap.externalRoot = model.root;
  treemap.showBreadcrumb = true;
  const treemapWrap = document.createElement("div");
  treemapWrap.style.cssText = "min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:6px;";
  treemapWrap.appendChild(treemap);
  demo.appendChild(treemapWrap);

  // Far right: treetable.
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
    // Wire reactive sort (effective = per-chart override ?? global default).
    wireSort(el, treetable, nested);
  }

  mountControls(toolbar);

  section.insertBefore(toolbar, demo);
}

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
          // Per-chart override: write to the override cell. The wireSort effect
          // reacts and applies it to the chart + treetable. Global sort changes
          // can't clobber this — effectiveSort = override ?? global.
          // (chart-architecture.md §"Config layering".)
          chartSort(chartEl).override.value = newSort;
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

      case 'toggle': {
        const lbl = document.createElement('label');
        lbl.style.cssText = 'font-size:12px;color:var(--text-muted,#999);margin-left:8px;display:flex;align-items:center;gap:4px;cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.style.cssText = 'cursor:pointer;';
        // Read current value from config (hierarchical charts read these
        // from the config object, not as direct element properties).
        const cfg = (chartEl as any).config ?? {};
        cb.checked = !!cfg[field.path];
        cb.addEventListener('change', () => {
          // Update the config object and re-set it on the chart element.
          const newCfg = { ...(chartEl as any).config, [field.path]: cb.checked };
          (chartEl as any).config = newCfg;
          chartEl.dispatchEvent(new CustomEvent('chartconfigchange', { bubbles: true }));
        });
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(field.label));
        controls.appendChild(lbl);
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
  // Reactive label + onclick: the button reflects and writes the global default.
  // Per-chart overrides are not affected (effectiveSort = override ?? global).
  effect(() => { sortBtn.textContent = `sort: ${globalSort.value}`; });
  sortBtn.onclick = () => set('sort', globalSort.value === 'value' ? 'index' : 'value');
  bar.append(sortBtn);
  return bar;
}

const app = document.getElementById("app");
if (app) {
  app.prepend(buildConfigBar());
  const shown = config.only
    ? experiments.filter(e => config.only!.includes(e.id))
    : experiments;

  // ── Sticky TOC sidebar ──────────────────────────────────────────────────
  // Left sidebar listing all demo sections. Click to scroll. Grouped by tier.
  const toc = document.createElement("nav");
  toc.id = "toc";
  toc.className = "toc";
  const tocList = document.createElement("ul");
  tocList.className = "toc-list";
  const TIERS = [
    { label: "Hierarchical", ids: ["hier-family", "icicle", "sunburst", "treemap", "pack"] },
    { label: "Cartesian", ids: ["line-chart", "area-chart", "bar-chart", "bands-chart", "scatter-chart"] },
    { label: "Novelty", ids: ["radar-chart", "concentric-arc", "gauge", "gauge-segmented"] },
    { label: "Under construction", ids: ["pie-chart", "sankey-simple", "sankey-complex", "tree-chart", "budget-tree", "gantt", "nested-layered"] },
    { label: "Experimental", ids: ["cartesian-viewer", "viewer-demo"] },
  ];
  for (const tier of TIERS) {
    const tierShown = tier.ids.filter(id => shown.some(e => e.id === id));
    if (tierShown.length === 0) continue;
    const tierLi = document.createElement("li");
    tierLi.className = "toc-tier";
    const tierLabel = document.createElement("div");
    tierLabel.className = "toc-tier-label";
    tierLabel.textContent = tier.label;
    tierLi.appendChild(tierLabel);
    const subUl = document.createElement("ul");
    subUl.className = "toc-sublist";
    for (const id of tierShown) {
      const e = shown.find(x => x.id === id)!;
      const li = document.createElement("li");
      li.className = "toc-item";
      const a = document.createElement("a");
      a.href = `#${id}`;
      a.textContent = e.title.replace(/\s*\(.*\)$/, "");
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      li.appendChild(a);
      subUl.appendChild(li);
    }
    tierLi.appendChild(subUl);
    tocList.appendChild(tierLi);
  }
  toc.appendChild(tocList);

  // Wrap: TOC on left, sections on right.
  const layout = document.createElement("div");
  layout.className = "toc-layout";
  const content = document.createElement("div");
  content.className = "toc-content";
  // Move existing app children (config bar already prepended) into content.
  while (app.firstChild) content.appendChild(app.firstChild);
  layout.append(toc, content);
  app.appendChild(layout);

  for (const e of shown) {
    const section = document.createElement("section");
    section.id = e.id;
    section.className = "experiment";

    const h2 = document.createElement("h2");
    h2.textContent = e.title;

    const demo = document.createElement("div");
    demo.className = "demo";

    if (e.underConstruction) {
      const placeholder = document.createElement("div");
      placeholder.style.cssText = 'display:flex;align-items:center;justify-content:center;height:200px;color:var(--text-muted,#999);font-size:14px;border:1px dashed var(--border,#333);border-radius:4px;';
      placeholder.textContent = 'Under construction';
      demo.appendChild(placeholder);
      section.appendChild(h2);
      section.appendChild(demo);
      content.appendChild(section);
      continue;
    }

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
            // Re-feed sorted data using the chart's reactive effective sort.
            // The bar chart freezes display order during gestures; after commit
            // it needs a re-feed to reconcile to the (possibly new) sorted
            // order. Reading the reactive effective sort means per-chart
            // overrides are respected. (chart-architecture.md §"Config layering".)
            dataModel.setSort(el, chartSort(el).effective.value);
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
    content.appendChild(section);

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
      // Wire reactive sort (effective = per-chart override ?? global default).
      wireSort(el, treetable, dataModel, kind);
      // Enable breadcrumb on all hierarchical charts (the base class wires it
      // but the demo config must opt in via showBreadcrumb). Without this,
      // drilling into pack/treemap/icicle/sunburst leaves the user stuck.
      if ('showBreadcrumb' in el) (el as any).showBreadcrumb = true;
    }
  }
}

// WIN-352: live design-tweaks pane. Ephemeral, unconditional in dev + preview.
mountMotionTweaks({ position: { top: 8, right: 8 } });

function dedentFn(s: string): string {
  const lines = s.split("\n");
  const indents = lines.slice(1).filter(l => l.trim().length > 0).map(l => (l.match(/^ */) ?? [""])[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l, i) => i === 0 ? l : l.slice(min)).join("\n");
}
