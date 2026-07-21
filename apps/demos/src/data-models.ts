import { num, Num, treeNode as node, type Writable, type Num as NumType } from "bireactive";
import { type BiNode, type ColumnDef } from "@hotbook/bireactive";
import type { GanttTask } from "@hotbook/bireactive";
import { sharedRows, items } from "./layout/demo-data";
import { PALETTE, getChartSchema } from "@hotbook/core";
import type { FlatRow, ChartContext, MountContext } from "@hotbook/core";

export interface DemoDataModel {
  root?: BiNode;
  setChartData(this: DemoDataModel, el: any): void;
  /** Re-feed the chart's data in the given order (charts without a live
   *  sortBy property tween on data-order changes instead). Rebuilds root. */
  setSort?(this: DemoDataModel, el: any, sort: 'index' | 'value'): void;
  /** Commit a user-driven reorder (drag-to-reorder, WIN-262). Persists as the
   *  new natural index order and re-feeds. Only wired for flat charts whose
   *  order lives in the data model (pie/bar); hierarchical / task-based
   *  models own their order elsewhere. */
  setOrder?(this: DemoDataModel, el: any, ids: string[]): void;
  sync: (el: any) => () => void;
  columns?: ColumnDef[];
}

function bi(value: number): Writable<NumType> {
  return num(value);
}

function dataRoot(children: BiNode[]): BiNode {
  const total = bi(0);
  return node(
    { id: "root", label: "Data", color: "#222", total, measures: { value: total } } as any,
    children,
  );
}

function valueLeaf(
  id: string,
  label: string,
  value: number,
  color: string,
  value2: number = value,
): BiNode {
  const v = bi(value);
  const v2 = bi(value2);
  return node({ id, label, color, total: v, measures: { value: v, value2: v2 } } as any);
}

function writeItemValue(item: any, target: number, key: string = "value"): void {
  const v = item?.[key];
  if (v && typeof v === "object" && typeof v.value === "number") {
    v.value = target;
  } else {
    item[key] = target;
  }
}

const SECOND_MEASURE_KEY = "value2";

type ValueItem = { id: string; label: string; value: number; value2: number; color: string };

function addSecondMeasure(item: { id: string; label: string; value: number; color: string }): ValueItem {
  return {
    ...item,
    value2: Math.max(0, Math.round(item.value * 0.7 + 10)),
  };
}

function buildValueRow(r: ValueItem, i: number, kind: string, measureKey: string): FlatRow {
  return {
    id: r.id,
    label: r.label,
    value: r[measureKey as keyof ValueItem] as number,
    value2: r.value2,
    color: r.color,
    index: i,
    date: kind === 'line' || kind === 'area' ? new Date(r.label) : undefined,
    measures: { value: r.value, value2: r.value2 },
  }
}

function valueData(
  kind: string,
  items: Omit<ValueItem, "value2">[],
): DemoDataModel {
  const schema = getChartSchema(kind)
  if (!schema || !schema!.toChart || !schema!.readValue || !schema!.writeValue) {
    throw new Error(`No schema for ${kind}`)
  }
  const byIndex = items.map(addSecondMeasure);
  let applied = byIndex;
  let currentMeasureKey = "value";

  function getMeasureKey(el: any): string {
    return el.measureKey || "value";
  }

  function foldEdits(el: any, key: string) {
    const cur = el.dataCell?.value as any[] | undefined;
    if (!cur) return;
    // Match by identity, not position — the chart's data array may already be
    // reordered (drag-to-reorder calls onReorder → setOrder → foldEdits AFTER
    // the chart's onEnd has reordered data.value). Positional matching would
    // write each datum's value into the wrong item.
    const curById = new Map(cur.map((d: any) => [d.id ?? d.label, d]));
    applied.forEach((item) => {
      const curItem = curById.get(item.id);
      if (curItem != null) writeItemValue(item, schema!.readValue!(curItem), key);
    });
  }

  function apply(model: DemoDataModel, el: any, ordered: ValueItem[], orderBinding: 'index' | 'value' = 'index', orderDir: 'asc' | 'desc' = 'asc') {
    applied = ordered;
    const measureKey = getMeasureKey(el);
    currentMeasureKey = measureKey;
    const chartCtx: ChartContext = {
      valueBinding: measureKey,
      orderBinding,
      orderDir,
      tile: { title: kind },
    };
    const chartData = schema!.toChart!(ordered.map((r, i) => buildValueRow(r, i, kind, measureKey)), chartCtx);
    el.externalData = chartData;
    const data = el.dataCell;

    if (data?.value) {
      const current = data.value as any[];
      for (let i = 0; i < chartData.length && i < current.length; i++) {
        const chartItem = chartData[i];
        const dataItem = current[i];
        if (chartItem && dataItem) {
          writeItemValue(dataItem, chartItem.value, "value");
        }
      }
    }

    const isValue = measureKey === 'value';
    const isValue2 = measureKey === 'value2';

    const leaves = ordered.map((item, i) => {
      const total = Num.lens(
        data,
        (d: any[]) => (d && d[i] ? schema!.readValue!(d[i]) : 0),
        (target: number, d: any[]) => {
          const next = d.slice();
          if (next[i]) schema!.writeValue!(next[i], target);
          return next;
        },
      );
      const valueCell = Num.lens(
        data,
        (d: any[]) => {
          if (!d || !d[i]) return 0;
          return isValue ? schema!.readValue!(d[i]) : (d[i].valueOriginal ?? 0);
        },
        (target: number, d: any[]) => {
          const next = d.slice();
          if (next[i]) {
            if (isValue) {
              schema!.writeValue!(next[i], target);
            } else {
              next[i].valueOriginal = target;
            }
            item.value = target;
          }
          return next;
        },
      );
      const value2Cell = Num.lens(
        data,
        (d: any[]) => {
          if (!d || !d[i]) return 0;
          return isValue2 ? schema!.readValue!(d[i]) : (d[i].value2Original ?? 0);
        },
        (target: number, d: any[]) => {
          const next = d.slice();
          if (next[i]) {
            if (isValue2) {
              schema!.writeValue!(next[i], target);
            } else {
              next[i].value2Original = target;
            }
            item.value2 = target;
          }
          return next;
        },
      );
      return node({ id: item.id, label: item.label, color: item.color, total, measures: { value: valueCell, value2: value2Cell } } as any);
    });

    const valueSum = Num.lens(
      data,
      (d: any[]) => d.reduce((sum, _, i) => sum + (d[i]?.valueOriginal ?? 0), 0),
      (_target, d) => d,
    );
    const value2Sum = Num.lens(
      data,
      (d: any[]) => d.reduce((sum, _, i) => sum + (d[i]?.value2Original ?? 0), 0),
      (_target, d) => d,
    );
    const rootTotal = Num.lens(
      data,
      (d: any[]) => d.reduce((sum, _, i) => sum + (schema!.readValue!(d[i]) ?? 0), 0),
      (_target, d) => d,
    );
    model.root = node({ id: "root", label: "Data", color: "#222", total: rootTotal, measures: { value: valueSum, value2: value2Sum } } as any, leaves);
  }

  return {
    setChartData(el: any) {
      if (currentMeasureKey !== getMeasureKey(el)) {
        foldEdits(el, currentMeasureKey);
      }
      apply(this, el, byIndex);
    },
    setSort(el: any, sort: 'index' | 'value') {
      console.log('[DM] setSort sort=', sort, 'byIndex ids=', byIndex.map(x => x.id));
      const key = getMeasureKey(el);
      foldEdits(el, key);
      const next = sort === 'value'
        ? byIndex.slice().sort((a, b) => (b as any)[key] - (a as any)[key])
        : byIndex.slice();
      const orderDir = sort === 'value' ? 'desc' : 'asc';
      console.log('[DM] setSort applying next ids=', next.map(x => x.id));
      apply(this, el, next, sort, orderDir);
    },
    setOrder(el: any, ids: string[]) {
      console.log('[DM] setOrder ids=', ids, 'byIndex ids=', byIndex.map(x => x.id));
      const key = getMeasureKey(el);
      foldEdits(el, key);
      const byId = new Map(byIndex.map(x => [x.id, x]));
      const next = ids.map(id => byId.get(id)!).filter(Boolean);
      console.log('[DM] setOrder next.length=', next.length, 'byIndex.length=', byIndex.length, 'next ids=', next.map(x => x.id));
      if (next.length !== byIndex.length) { console.log('[DM] setOrder REJECTED — length mismatch'); return; }
      byIndex.length = 0;
      byIndex.push(...next);
      apply(this, el, byIndex.slice());
    },
    sync: () => () => {},
    columns: [
      { key: "value", label: "Value", width: 80 },
      { key: SECOND_MEASURE_KEY, label: "Value 2", width: 80 },
    ],
  };
}

function scatterData(): DemoDataModel {
  const schema = getChartSchema('scatter')
  if (!schema || !schema!.toChart) {
    throw new Error('No schema for scatter')
  }
  const items = Array.from({ length: 20 }, (_, i) => {
    const x = Math.round(i * 5 + 2);
    const y = Math.round(20 + i * 4 + (i % 5) * 3);
    return {
      id: String(i),
      label: `P${i}`,
      x,
      y,
      color: PALETTE[i % PALETTE.length]!,
    };
  });
  return {
    setChartData(el: any) {
      const xKey = el.xKey ?? el.xBinding ?? '_index';
      const yKey = el.yKey ?? el.yBinding ?? 'y';
      const rows: FlatRow[] = items.map((r, i) => ({
        id: r.id,
        label: r.label,
        value: r.y,
        value2: r.x,
        color: r.color,
        index: i,
        measures: { x: r.x, y: r.y },
      }));
      const chartCtx: ChartContext = { xKey, yKey, valueBinding: yKey };
      el.externalData = schema!.toChart!(rows, chartCtx);
      const data = el.dataCell;
      const leaves = items.map((item, i) => {
        const xCell = Num.lens(
          data,
          (d: any[]) => (d && d[i] ? d[i].x : 0),
          (target: number, d: any[]) => {
            const next = d.slice();
            if (next[i]) next[i].x = target;
            return next;
          },
        );
        const yCell = Num.lens(
          data,
          (d: any[]) => (d && d[i] ? d[i].y : 0),
          (target: number, d: any[]) => {
            const next = d.slice();
            if (next[i]) next[i].y = target;
            return next;
          },
        );
        return node({ id: item.id, label: item.label, color: item.color, total: yCell, measures: { x: xCell, y: yCell } } as any);
      });
      const rootTotal = num(0);
      this.root = node({ id: "root", label: "Data", color: "#222", total: rootTotal, measures: { x: rootTotal, y: rootTotal } } as any, leaves);
    },
    sync: () => () => {},
    columns: [
      { key: "x", label: "X", width: 70 },
      { key: "y", label: "Y", width: 70 },
    ],
  };
}

function gaugeData(kind: 'gauge' | 'gauge-segmented'): DemoDataModel {
  const schema = getChartSchema(kind)
  if (!schema || !schema!.toChart) {
    throw new Error(`No schema for ${kind}`)
  }
  const value = 65;
  const min = 0;
  const max = 100;
  const rows: FlatRow[] = [{ id: 'value', label: 'Score', value, color: PALETTE[3]!, index: 0, measures: { value } }];
  const chartCtx: ChartContext = { valueBinding: 'value', tile: { title: 'Score' } };
  return {
    setChartData(el: any) {
      el.externalData = schema!.toChart!(rows, chartCtx);
      const valueCell = el.valueCell as Writable<NumType>;
      const minCell = num(el.externalData.min ?? min);
      const maxCell = num(el.externalData.max ?? max);
      const segCell = el.externalData.segments != null ? num(el.externalData.segments) : undefined;
      const leaves = [
        node({ id: "value", label: "Value", color: PALETTE[3]!, total: valueCell, measures: { value: valueCell } } as any),
        node({ id: "min", label: "Min", color: "#888", total: minCell, measures: { value: minCell } } as any),
        node({ id: "max", label: "Max", color: "#888", total: maxCell, measures: { value: maxCell } } as any),
        ...(segCell ? [node({ id: "segments", label: "Segments", color: PALETTE[4]!, total: segCell, measures: { value: segCell } } as any)] : []),
      ];
      const rootTotal = num(value);
      this.root = node({ id: "root", label: "Data", color: "#222", total: rootTotal, measures: { value: rootTotal } } as any, leaves);
    },
    sync: () => () => {},
    columns: [{ key: "value", label: "Value", width: 80 }],
  };
}

function ganttData(): DemoDataModel {
  const schema = getChartSchema('gantt')
  if (!schema || !schema!.toChart) {
    throw new Error('No schema for gantt')
  }
  const DAY = 86400 * 1000;
  const start = new Date(2026, 0, 1).getTime();
  const dayOf = (date: Date) => (date.getTime() - start) / DAY;
  const dateOf = (day: number) => new Date(start + day * DAY);
  const tasks: GanttTask[] = [
    { id: "t1", label: "Discovery", start: new Date(start + 0 * DAY), end: new Date(start + 7 * DAY) },
    { id: "t2", label: "Design", start: new Date(start + 5 * DAY), end: new Date(start + 14 * DAY), deps: ["t1"] },
    { id: "t3", label: "Build core", start: new Date(start + 12 * DAY), end: new Date(start + 28 * DAY), deps: ["t2"] },
    { id: "t4", label: "QA", start: new Date(start + 25 * DAY), end: new Date(start + 34 * DAY), deps: ["t3"] },
    { id: "t5", label: "Launch", start: new Date(start + 33 * DAY), end: new Date(start + 36 * DAY), deps: ["t3", "t4"] },
  ];

  const rows = tasks.map((t, i) => ({
    ...t,
    value: dayOf(t.end) - dayOf(t.start),
    color: undefined,
    index: i,
    measures: {},
  }));

  return {
    setChartData(el: any) {
      const chartCtx: ChartContext = { valueBinding: 'value' };
      el.externalData = schema!.toChart!(rows, chartCtx);
      const data = el.dataCell;
      const leaves = tasks.map((t, i) => {
        const startCell = Num.lens(
          data,
          (d: any[]) => (d && d[i] ? dayOf(d[i].start) : 0),
          (target: number, d: any[]) => {
            const next = d.slice();
            if (next[i]) next[i].start = dateOf(target);
            return next;
          },
        );
        const endCell = Num.lens(
          data,
          (d: any[]) => (d && d[i] ? dayOf(d[i].end) : 0),
          (target: number, d: any[]) => {
            const next = d.slice();
            if (next[i]) next[i].end = dateOf(target);
            return next;
          },
        );
        return node({ id: t.id, label: t.label, color: PALETTE[i % PALETTE.length]!, total: endCell, measures: { start: startCell, end: endCell } } as any);
      });
      const rootTotal = Num.lens(
        data,
        (d: any[]) => d.reduce((sum: number, t: any) => sum + (dayOf(t.end) - dayOf(t.start)), 0),
        (_target, d) => d,
      );
      this.root = node({ id: "root", label: "Data", color: "#222", total: rootTotal, measures: { start: rootTotal, end: rootTotal } } as any, leaves);
    },
    sync: () => () => {},
    columns: [
      { key: "start", label: "Start", width: 70 },
      { key: "end", label: "End", width: 70 },
    ],
  };
}

function sankeyData(
  nodes: string[],
  links: { source: string; target: string; value: number }[],
): DemoDataModel {
  const schema = getChartSchema('sankey')
  if (!schema || !schema!.toChart || !schema.mountProps) {
    throw new Error('No schema for sankey')
  }
  const groups = new Map<string, BiNode>();
  const layerMap = new Map<string, number>();
  links.forEach((l) => {
    if (!layerMap.has(l.source)) layerMap.set(l.source, 0);
    if (layerMap.get(l.target) == null) {
      layerMap.set(l.target, (layerMap.get(l.source) ?? 0) + 1);
    } else {
      layerMap.set(l.target, Math.max(layerMap.get(l.target)!, layerMap.get(l.source)! + 1));
    }
  });

  const layers = new Map<number, string[]>();
  nodes.forEach((n) => {
    const layer = layerMap.get(n) ?? 0;
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer)!.push(n);
  });

  const leaves: BiNode[] = [];
  const layerNodes = Array.from(layers.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([layer, nodeIds]) => {
      const children = nodeIds
        .map((nodeId) => {
          const outLinks = links.filter((l) => l.source === nodeId);
          if (outLinks.length === 0) {
            const leaf = valueLeaf(nodeId, nodeId, 0, PALETTE[layer % PALETTE.length]!);
            leaves.push(leaf);
            return leaf;
          }
          const linkLeaves = outLinks.map((l) => {
            const value2 = Math.max(0, Math.round(l.value * 0.7 + 10));
            const leaf = valueLeaf(
              `${l.source}-${l.target}`,
              `${l.source} → ${l.target}`,
              l.value,
              PALETTE[layer % PALETTE.length]!,
              value2,
            );
            leaves.push(leaf);
            return leaf;
          });
          const g = node(
            { id: nodeId, label: nodeId, color: PALETTE[layer % PALETTE.length]!, total: bi(0), measures: {} } as any,
            linkLeaves,
          );
          groups.set(nodeId, g);
          return g;
        });
      return node(
        { id: `layer-${layer}`, label: `Layer ${layer + 1}`, color: "#222", total: bi(0), measures: {} } as any,
        children,
      );
    });

  const root = dataRoot(layerNodes);

  let selectedKey = 'value';
  const getLinks = () =>
    leaves
      .map((leaf) => {
        const label = leaf.value.label;
        const parts = label.split(" → ");
        if (parts.length !== 2) return null;
        return {
          source: parts[0]!,
          target: parts[1]!,
          value: (leaf.value as any).measures[selectedKey]?.value ?? 0,
        };
      })
      .filter(Boolean) as { source: string; target: string; value: number }[];

  const mountCtx: MountContext = {
    tile: {},
    leaves: [],
    nodeById: new Map(),
    ids: [],
    valueBinding: 'value',
    orderBinding: 'index',
    orderDir: 'asc',
  }
  const mountProps = schema.mountProps(mountCtx)

  return {
    root,
    setChartData(this: DemoDataModel, el: any) {
      selectedKey = el.measureKey || 'value';
      const chartCtx: ChartContext = {
        valueBinding: selectedKey,
        orderBinding: 'index',
        orderDir: 'asc',
        rawNodes: [],
        edges: getLinks(),
      };
      el.externalData = schema!.toChart!([], chartCtx);
      mountProps(el);
    },
    sync: () => () => {},
    columns: [
      { key: "value", label: "Value", width: 80 },
      { key: "value2", label: "Value 2", width: 80 },
    ],
  };
}

function value2For(value: number): number {
  return Math.max(0, Math.round(value * 0.7 + 10));
}

interface HierSpec {
  id: string;
  label: string;
  color: string;
  value?: number;
  children?: HierSpec[];
}

function buildHierNode(spec: HierSpec, selectedKey: string): { node: BiNode; value: number; value2: number } {
  if (spec.children && spec.children.length > 0) {
    const built = spec.children.map(c => buildHierNode(c, selectedKey));
    const childNodes = built.map(b => b.node);
    const value = built.reduce((sum, b) => sum + b.value, 0);
    const value2 = built.reduce((sum, b) => sum + b.value2, 0);
    const valueCell = Num.lens(
      childNodes.map(c => c.value.measures!.value),
      (vs: readonly number[]) => vs.reduce((a, b) => a + b, 0),
      (target, vs) => {
        const arr = vs as readonly number[];
        const cur = arr.reduce((a, b) => a + b, 0);
        if (cur === 0) return arr.map(() => target / arr.length) as never;
        const scale = target / cur;
        return arr.map(v => v * scale) as never;
      },
    );
    const value2Cell = Num.lens(
      childNodes.map(c => c.value.measures!.value2),
      (vs: readonly number[]) => vs.reduce((a, b) => a + b, 0),
      (target, vs) => {
        const arr = vs as readonly number[];
        const cur = arr.reduce((a, b) => a + b, 0);
        if (cur === 0) return arr.map(() => target / arr.length) as never;
        const scale = target / cur;
        return arr.map(v => v * scale) as never;
      },
    );
    const total = selectedKey === 'value2' ? value2Cell : valueCell;
    const treeNode = node({ id: spec.id, label: spec.label, color: spec.color, total, measures: { value: valueCell, value2: value2Cell } } as any, childNodes);
    return { node: treeNode, value, value2 };
  }
  const value = spec.value ?? 0;
  const value2 = value2For(value);
  const valueCell = num(value);
  const value2Cell = value2For(value) !== value ? num(value2For(value)) : num(value);
  const total = selectedKey === 'value2' ? value2Cell : valueCell;
  const treeNode = node({ id: spec.id, label: spec.label, color: spec.color, total, measures: { value: valueCell, value2: value2Cell } } as any);
  return { node: treeNode, value, value2 };
}

function hierarchicalData(kind: string): DemoDataModel {
  const schema = getChartSchema(kind);
  const spec: HierSpec = {
    id: "portfolio",
    label: "Portfolio",
    color: "#222",
    children: [
      { id: "health", label: "Health", color: "#e25c5c", children: [
        { id: "health-devices", label: "Devices", color: "#ec8a8a", children: [
          { id: "abt", label: "ABT", value: 4, color: "#ec8a8a" },
          { id: "medtronic", label: "MDT", value: 5, color: "#ec8a8a" },
        ]},
        { id: "health-pharma", label: "Pharma", color: "#ec8a8a", children: [
          { id: "pfe", label: "PFE", value: 6, color: "#ec8a8a" },
          { id: "jnj", label: "JNJ", value: 9, color: "#ec8a8a" },
        ]},
      ]},
      { id: "energy", label: "Energy", color: "#f5a623", children: [
        { id: "energy-gas", label: "Gas", color: "#f7be5a", children: [
          { id: "cop", label: "COP", value: 5, color: "#f7be5a" },
          { id: "shel", label: "SHEL", value: 8, color: "#f7be5a" },
        ]},
        { id: "energy-oil", label: "Oil", color: "#f7be5a", children: [
          { id: "cvx", label: "CVX", value: 7, color: "#f7be5a" },
          { id: "xom", label: "XOM", value: 10, color: "#f7be5a" },
        ]},
      ]},
      { id: "finance", label: "Finance", color: "#7ed321", children: [
        { id: "finance-insure", label: "Insurance", color: "#9ed44a", children: [
          { id: "aig", label: "AIG", value: 6, color: "#a6df5e" },
          { id: "brk", label: "BRK", value: 14, color: "#a6df5e" },
        ]},
        { id: "finance-banks", label: "Banks", color: "#9ed44a", children: [
          { id: "bac", label: "BAC", value: 9, color: "#a6df5e" },
          { id: "jpm", label: "JPM", value: 18, color: "#a6df5e" },
        ]},
      ]},
      { id: "tech", label: "Tech", color: "#5b8def", children: [
        { id: "tech-chips", label: "Chips", color: "#7ba3f0", children: [
          { id: "amd", label: "AMD", value: 12, color: "#86acf5" },
          { id: "nvda", label: "NVDA", value: 22, color: "#86acf5" },
        ]},
        { id: "tech-software", label: "Software", color: "#7ba3f0", children: [
          { id: "msft", label: "MSFT", value: 28, color: "#86acf5" },
          { id: "aapl", label: "AAPL", value: 35, color: "#86acf5" },
        ]},
      ]},
    ],
  };

  function buildRoot(selectedKey: string): BiNode {
    return buildHierNode(spec, selectedKey).node;
  }

  const root = buildRoot('value');

  return {
    root,
    setChartData(this: DemoDataModel, el: any) {
      const measureKey = el.measureKey || 'value';
      this.root = buildRoot(measureKey);
      el.externalRoot = schema?.toChart ? schema!.toChart(this.root, { valueBinding: measureKey }) : this.root;
    },
    sync: () => () => {},
    columns: [
      { key: "value", label: "Value", width: 80 },
    ],
  };
}

export function dataModelFor(id: string): DemoDataModel | undefined {
  switch (id) {
    case "line-chart":
    case "area-chart":
      return valueData(
        id === 'line-chart' ? 'line' : 'area',
        Array.from({ length: 30 }, (_, i) => {
          const start = new Date(2026, 0, 1).getTime();
          const day = 86400 * 1000;
          const v = 100 + i * 1.5 + ((i % 7) - 3) * 2;
          return {
            id: String(i),
            label: new Date(start + i * day).toISOString().slice(0, 10),
            value: Math.max(50, Math.round(v)),
            color: PALETTE[i % PALETTE.length]!,
          };
        }),
      );

    case "bar-chart":
      return valueData(
        "bar",
        [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ].map((m, i) => ({
          id: m,
          label: m,
          value: 30 + ((i * 7) % 50) + (i % 3) * 10,
          color: PALETTE[i % PALETTE.length]!,
        })),
      );

    case "bands-chart":
      return valueData(
        "bands",
        ["A", "B", "C", "D", "E", "F", "G", "H"].map((m, i) => ({
          id: m,
          label: m,
          value: 20 + ((i * 11) % 70),
          color: PALETTE[i % PALETTE.length]!,
        })),
      );

    case "radar-chart":
      return valueData(
        "radar",
        ["Speed", "Power", "Agility", "Defense", "Stamina", "Technique"].map(
          (m, i) => ({
            id: m,
            label: m,
            value: 40 + (i * 15) % 50,
            color: PALETTE[i % PALETTE.length]!,
          }),
        ),
      );

    case "concentric-arc":
      return valueData(
        "concentric-arc",
        [
          "Speed",
          "Power",
          "Stamina",
          "Focus",
          "Agility",
          "Endure",
          "Reflex",
          "Vision",
        ].map((m, i) => ({
          id: m,
          label: m,
          value: 25 + (i * 12) % 65,
          color: PALETTE[i % PALETTE.length]!,
        })),
      );

    case "scatter-chart":
      return scatterData();

    case "gauge":
      return gaugeData('gauge');

    case "gauge-segmented":
      return gaugeData('gauge-segmented');

    case "gantt":
      return ganttData();

    case "pack":
    case "treemap":
    case "icicle":
    case "sunburst":
    case "pie-chart":
    case "tree-chart":
    case "budget-tree":
    case "treetable": {
      const hierKind = id === 'budget-tree' ? 'pack' : id === 'tree-chart' ? 'tree' : id === 'pie-chart' ? 'sunburst' : id;
      return hierarchicalData(hierKind);
    }

    case "sankey-simple":
      return sankeyData(
        ["A1", "A2", "A3", "B1", "B2", "B3", "B4", "C1", "C2", "C3", "D1", "D2"],
        [
          { source: "A1", target: "B1", value: 27 },
          { source: "A1", target: "B2", value: 9 },
          { source: "A2", target: "B2", value: 5 },
          { source: "A2", target: "B3", value: 11 },
          { source: "A3", target: "B2", value: 12 },
          { source: "A3", target: "B4", value: 7 },
          { source: "B1", target: "C1", value: 13 },
          { source: "B1", target: "C2", value: 10 },
          { source: "B4", target: "C2", value: 5 },
          { source: "B4", target: "C3", value: 2 },
          { source: "B1", target: "D1", value: 4 },
          { source: "C3", target: "D1", value: 1 },
          { source: "C3", target: "D2", value: 1 },
        ],
      );

    case "sankey-complex":
      return sankeyData(
        [
          "Agricultural 'waste'",
          "Bio-conversion",
          "Liquid",
          "Losses",
          "Solid",
          "Gas",
          "Biofuel imports",
          "Biomass imports",
          "Coal imports",
          "Coal",
          "Coal reserves",
          "District heating",
          "Industry",
          "Heating and cooling - commercial",
          "Heating and cooling - homes",
          "Electricity grid",
          "Over generation / exports",
          "H2 conversion",
          "Road transport",
          "Agriculture",
          "Rail transport",
          "Lighting & appliances - commercial",
          "Lighting & appliances - homes",
          "Gas imports",
          "Ngas",
          "Gas reserves",
          "Thermal generation",
          "Geothermal",
          "H2",
          "Hydro",
          "International shipping",
          "Domestic aviation",
          "International aviation",
          "National navigation",
          "Marine algae",
          "Nuclear",
          "Oil imports",
          "Oil",
          "Oil reserves",
          "Other waste",
          "Pumped heat",
          "Solar PV",
          "Solar Thermal",
          "Solar",
          "Tidal",
          "UK land based bioenergy",
          "Wave",
          "Wind",
        ],
        [
          { source: "Agricultural 'waste'", target: "Bio-conversion", value: 124.729 },
          { source: "Bio-conversion", target: "Liquid", value: 0.597 },
          { source: "Bio-conversion", target: "Losses", value: 26.862 },
          { source: "Bio-conversion", target: "Solid", value: 280.322 },
          { source: "Bio-conversion", target: "Gas", value: 81.144 },
          { source: "Biomass imports", target: "Bio-conversion", value: 10 },
          { source: "Biofuel imports", target: "Bio-conversion", value: 10 },
          { source: "Coal", target: "Coal reserves", value: 10 },
          { source: "Coal", target: "Thermal generation", value: 10 },
          { source: "Coal imports", target: "Coal", value: 10 },
          { source: "District heating", target: "Industry", value: 10 },
          { source: "Electricity grid", target: "Over generation / exports", value: 10 },
          { source: "Electricity grid", target: "H2 conversion", value: 10 },
          { source: "Electricity grid", target: "Road transport", value: 10 },
          { source: "Electricity grid", target: "Agriculture", value: 10 },
          { source: "Electricity grid", target: "Rail transport", value: 10 },
          { source: "Electricity grid", target: "Lighting & appliances - commercial", value: 10 },
          { source: "Electricity grid", target: "Lighting & appliances - homes", value: 10 },
          { source: "Gas", target: "Gas imports", value: 10 },
          { source: "Gas", target: "Gas reserves", value: 10 },
          { source: "Gas", target: "Thermal generation", value: 10 },
          { source: "Geothermal", target: "Electricity grid", value: 10 },
          { source: "H2", target: "Road transport", value: 10 },
          { source: "H2", target: "Liquid", value: 10 },
          { source: "Hydro", target: "Electricity grid", value: 10 },
          { source: "Marine algae", target: "Bio-conversion", value: 10 },
          { source: "Ngas", target: "Gas", value: 10 },
          { source: "Ngas", target: "Gas reserves", value: 10 },
          { source: "Nuclear", target: "Electricity grid", value: 10 },
          { source: "Oil", target: "Oil reserves", value: 10 },
          { source: "Oil", target: "Road transport", value: 10 },
          { source: "Oil imports", target: "Oil", value: 10 },
          { source: "Other waste", target: "Bio-conversion", value: 10 },
          { source: "Pumped heat", target: "Heating and cooling - homes", value: 10 },
          { source: "Pumped heat", target: "Heating and cooling - commercial", value: 10 },
          { source: "Solar PV", target: "Electricity grid", value: 10 },
          { source: "Solar Thermal", target: "Heating and cooling - homes", value: 10 },
          { source: "Solar Thermal", target: "Heating and cooling - commercial", value: 10 },
          { source: "Solar", target: "Solar Thermal", value: 10 },
          { source: "Solar", target: "Solar PV", value: 10 },
          { source: "Tidal", target: "Electricity grid", value: 10 },
          { source: "UK land based bioenergy", target: "Bio-conversion", value: 10 },
          { source: "Wave", target: "Electricity grid", value: 10 },
          { source: "Wind", target: "Electricity grid", value: 10 },
        ],
      );

    case "sankey-hierarchy":
      return sankeyData(
        ["Root", "A", "B", "C", "D", "A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2"],
        [
          { source: "Root", target: "A", value: 40 },
          { source: "Root", target: "B", value: 30 },
          { source: "Root", target: "C", value: 20 },
          { source: "Root", target: "D", value: 10 },
          { source: "A", target: "A1", value: 25 },
          { source: "A", target: "A2", value: 15 },
          { source: "B", target: "B1", value: 18 },
          { source: "B", target: "B2", value: 12 },
          { source: "C", target: "C1", value: 12 },
          { source: "C", target: "C2", value: 8 },
          { source: "D", target: "D1", value: 6 },
          { source: "D", target: "D2", value: 4 },
        ],
      );

    case "nested-layered": {
      const rows = items(sharedRows);
      const build = (parentId: string | null): BiNode[] => {
        const children = rows
          .filter((r) => r.parentId.value === parentId)
          .sort((a, b) => a.index.value - b.index.value);
        return children.map((r) => {
          const kids = build(r.id);
          // Share the row's live index cell so treetable edits flow straight
          // into sharedRows (and the diagram, which reads the same cells).
          const v = r.index as unknown as Writable<NumType>;
          return node(
            { id: r.id, label: r.name.value, color: PALETTE[rows.indexOf(r) % PALETTE.length]!, total: v, measures: { index: v } } as any,
            kids,
          );
        });
      };
      const root = dataRoot(build(null));
      return {
        root,
        setChartData: () => {},
        sync: () => () => {},
        columns: [{ key: "index", label: "Index", width: 70 }],
      };
    }

    default:
      return undefined;
  }
}
