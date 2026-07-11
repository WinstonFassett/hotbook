import { effect, num, treeNode as node, leavesOf, type Writable, type Num } from "bireactive";
import { group, leaf, type BiNode, type ColumnDef } from "@hotbook/bireactive";
import type { GanttTask } from "@hotbook/bireactive";
import { sharedRows, items } from "./layout/demo-data";

export interface DemoDataModel {
  root: BiNode;
  setChartData: (el: any) => void;
  sync: (el: any) => () => void;
  columns?: ColumnDef[];
}

const PALETTE = [
  "#e08888",
  "#d4a86c",
  "#ccc060",
  "#7ec87e",
  "#60c4c0",
  "#7aaae8",
  "#b090e0",
  "#8899b4",
];

function bi(value: number): Writable<Num> {
  return num(value);
}

function valueLeaf(
  id: string,
  label: string,
  value: number,
  color: string,
): BiNode {
  const v = bi(value);
  return node({ id, label, color, total: v, measures: { value: v } } as any);
}

function multiLeaf(
  id: string,
  label: string,
  color: string,
  measures: Record<string, Writable<Num>>,
): BiNode {
  const total = measures[Object.keys(measures)[0]!] ?? bi(0);
  return node({ id, label, color, total, measures } as any);
}

function dataRoot(children: BiNode[]): BiNode {
  return node(
    { id: "root", label: "Data", color: "#222", total: bi(0), measures: {} } as any,
    children,
  );
}

function shallowEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => shallowEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => shallowEqual(a[k], b[k]));
  }
  return a === b;
}

function valueData(
  title: string,
  items: { id: string; label: string; value: number; color: string }[],
  toChart: (values: { id: string; label: string; value: number; color: string }[]) => any,
): DemoDataModel {
  const leaves = items.map((d) => valueLeaf(d.id, d.label, d.value, d.color));
  const root = dataRoot(leaves);
  const getValues = () =>
    items.map((item, i) => ({
      ...item,
      value: (leaves[i]!.value as any).measures.value.value,
    }));
  const setChartData = (el: any) => {
    el.externalData = toChart(getValues());
  };
  const sync = (el: any) => {
    const toChartData = () => toChart(getValues());
    const d1 = effect(() => {
      const next = toChartData();
      const cur = el.dataCell?.value;
      if (!cur || !Array.isArray(cur)) {
        el.externalData = next;
        return;
      }
      if (
        next.length !== cur.length ||
        next.some((n: any, i: number) => !shallowEqual(n, cur[i]))
      ) {
        el.externalData = next;
      }
    });
    const d2 = effect(() => {
      const data = el.dataCell?.value;
      if (!data) return;
      data.forEach((item: any, i: number) => {
        const leaf = leaves[i];
        if (!leaf) return;
        const cell = (leaf.value as any).measures.value;
        const val =
          item.value != null
            ? item.value
            : item.y != null
            ? item.y
            : item.value;
        if (cell.value !== val) cell.value = val;
      });
    });
    return () => {
      d1();
      d2();
    };
  };
  return {
    root,
    setChartData,
    sync,
    columns: [{ key: "value", label: "Value", width: 80 }],
  };
}

function scatterData(): DemoDataModel {
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
  const leaves = items.map((d) =>
    multiLeaf(d.id, d.label, d.color, {
      x: bi(d.x),
      y: bi(d.y),
    }),
  );
  const root = dataRoot(leaves);
  const getValues = () =>
    items.map((item, i) => {
      const m = (leaves[i]!.value as any).measures;
      return { id: item.id, x: m.x.value, y: m.y.value };
    });
  const setChartData = (el: any) => {
    el.externalData = getValues();
  };
  const sync = (el: any) => {
    const d1 = effect(() => {
      const next = getValues();
      const cur = el.dataCell?.value;
      if (!cur || !Array.isArray(cur)) {
        el.externalData = next;
        return;
      }
      if (
        next.length !== cur.length ||
        next.some((n: any, i: number) => !shallowEqual(n, cur[i]))
      ) {
        el.externalData = next;
      }
    });
    const d2 = effect(() => {
      const data = el.dataCell?.value;
      if (!data) return;
      data.forEach((item: any, i: number) => {
        const leaf = leaves[i];
        if (!leaf) return;
        const m = (leaf.value as any).measures;
        if (m.x.value !== item.x) m.x.value = item.x;
        if (m.y.value !== item.y) m.y.value = item.y;
      });
    });
    return () => {
      d1();
      d2();
    };
  };
  return {
    root,
    setChartData,
    sync,
    columns: [
      { key: "x", label: "X", width: 70 },
      { key: "y", label: "Y", width: 70 },
    ],
  };
}

function gaugeData(segments?: number): DemoDataModel {
  const leaves = [
    valueLeaf("value", "Value", 65, PALETTE[3]!),
    valueLeaf("min", "Min", 0, "#888"),
    valueLeaf("max", "Max", 100, "#888"),
    ...(segments != null ? [valueLeaf("segments", "Segments", segments, PALETTE[4]!)] : []),
  ];
  const root = dataRoot(leaves);

  const valCell = () => (leaves[0]!.value as any).measures.value;
  const minCell = () => (leaves[1]!.value as any).measures.value;
  const maxCell = () => (leaves[2]!.value as any).measures.value;
  const segCell = () => (segments != null ? (leaves[3]!.value as any).measures.value : undefined);

  const getData = () => ({
    value: valCell().value,
    min: minCell().value,
    max: maxCell().value,
    color: PALETTE[3]!,
    label: "Score",
    ...(segments != null ? { segments: segCell().value } : {}),
  });

  const setChartData = (el: any) => {
    el.externalData = getData();
  };

  const sync = (el: any) => {
    const d1 = effect(() => {
      const next = getData();
      const cur = el.externalData;
      if (!shallowEqual(next, cur)) {
        el.externalData = next;
      }
    });

    const d2 = effect(() => {
      const cur = el.externalData;
      if (!cur) return;
      if (valCell().value !== cur.value) valCell().value = cur.value;
      if (minCell().value !== cur.min) minCell().value = cur.min;
      if (maxCell().value !== cur.max) maxCell().value = cur.max;
      const seg = segCell();
      if (seg && seg.value !== cur.segments) seg.value = cur.segments;
    });

    return () => {
      d1();
      d2();
    };
  };

  return {
    root,
    setChartData,
    sync,
    columns: [{ key: "value", label: "Value", width: 80 }],
  };
}

function ganttData(): DemoDataModel {
  const DAY = 86400 * 1000;
  const start = new Date(2026, 0, 1).getTime();
  const tasks: GanttTask[] = [
    { id: "t1", label: "Discovery", start: new Date(start + 0 * DAY), end: new Date(start + 7 * DAY) },
    { id: "t2", label: "Design", start: new Date(start + 5 * DAY), end: new Date(start + 14 * DAY), deps: ["t1"] },
    { id: "t3", label: "Build core", start: new Date(start + 12 * DAY), end: new Date(start + 28 * DAY), deps: ["t2"] },
    { id: "t4", label: "QA", start: new Date(start + 25 * DAY), end: new Date(start + 34 * DAY), deps: ["t3"] },
    { id: "t5", label: "Launch", start: new Date(start + 33 * DAY), end: new Date(start + 36 * DAY), deps: ["t3", "t4"] },
  ];

  const leaves = tasks.map((t) =>
    multiLeaf(t.id, t.label, t.color ?? PALETTE[tasks.indexOf(t) % PALETTE.length]!, {
      start: bi((t.start.getTime() - start) / DAY),
      end: bi((t.end.getTime() - start) / DAY),
    }),
  );
  const root = dataRoot(leaves);

  const getTasks = () =>
    tasks.map((t, i) => {
      const m = (leaves[i]!.value as any).measures;
      return {
        ...t,
        start: new Date(start + m.start.value * DAY),
        end: new Date(start + m.end.value * DAY),
      };
    });

  const setChartData = (el: any) => {
    el.externalData = getTasks();
  };

  const sync = (el: any) => {
    const d1 = effect(() => {
      const next = getTasks();
      const cur = el.dataCell?.value;
      if (!cur || !Array.isArray(cur)) {
        el.externalData = next;
        return;
      }
      if (
        next.length !== cur.length ||
        next.some(
          (n: any, i: number) =>
            n.start.getTime() !== cur[i].start.getTime() ||
            n.end.getTime() !== cur[i].end.getTime() ||
            n.label !== cur[i].label,
        )
      ) {
        el.externalData = next;
      }
    });

    const d2 = effect(() => {
      const data = el.dataCell?.value;
      if (!data) return;
      data.forEach((item: any, i: number) => {
        const leaf = leaves[i];
        if (!leaf) return;
        const m = (leaf.value as any).measures;
        const startDay = (item.start.getTime() - start) / DAY;
        const endDay = (item.end.getTime() - start) / DAY;
        if (m.start.value !== startDay) m.start.value = startDay;
        if (m.end.value !== endDay) m.end.value = endDay;
      });
    });

    return () => {
      d1();
      d2();
    };
  };

  return {
    root,
    setChartData,
    sync,
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
            const leaf = valueLeaf(
              `${l.source}-${l.target}`,
              `${l.source} → ${l.target}`,
              l.value,
              PALETTE[layer % PALETTE.length]!,
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

  const getLinks = () =>
    leaves
      .map((leaf) => {
        const label = leaf.value.label;
        const parts = label.split(" → ");
        if (parts.length !== 2) return null;
        return {
          source: parts[0]!,
          target: parts[1]!,
          value: (leaf.value as any).measures.value.value,
        };
      })
      .filter(Boolean) as { source: string; target: string; value: number }[];

  const setChartData = (el: any) => {
    el.externalData = { nodes, links: getLinks() };
  };

  const sync = (el: any) => {
    // Sankey scene reads externalData once at mount; treetable edits cannot
    // drive the already-rendered scene. The chart itself supports live editing.
    return () => {};
  };

  return {
    root,
    setChartData,
    sync,
    columns: [{ key: "value", label: "Value", width: 80 }],
  };
}

function hierarchicalData(): DemoDataModel {
  const root = group("portfolio", "Portfolio", "#222", [
    group("tech", "Tech", "#5b8def", [
      leaf("aapl", "AAPL", 35, "#86acf5"),
      leaf("msft", "MSFT", 28, "#86acf5"),
      leaf("nvda", "NVDA", 22, "#86acf5"),
    ]),
    group("finance", "Finance", "#7ed321", [
      leaf("jpm", "JPM", 18, "#a6df5e"),
      leaf("brk", "BRK", 14, "#a6df5e"),
    ]),
    group("energy", "Energy", "#f5a623", [
      leaf("xom", "XOM", 10, "#f7be5a"),
      leaf("shel", "SHEL", 8, "#f7be5a"),
    ]),
    group("health", "Health", "#e25c5c", [
      leaf("jnj", "JNJ", 9, "#ec8a8a"),
      leaf("pfe", "PFE", 6, "#ec8a8a"),
    ]),
  ]);

  return {
    root,
    setChartData: (el: any) => {
      el.externalRoot = root;
    },
    sync: () => () => {},
  };
}

// Deterministic data factories keyed by the experiment id used in main.ts.

export function dataModelFor(id: string): DemoDataModel | undefined {
  switch (id) {
    case "line-chart":
    case "area-chart":
      return valueData(
        "line",
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
        (rows) =>
          rows.map((r) => ({
            id: r.id,
            date: new Date(r.label),
            value: r.value,
          })),
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
        (rows) => rows.map((r) => ({ label: r.label, value: r.value })),
      );

    case "bands-chart":
      return valueData(
        "bands",
        [
          "A",
          "B",
          "C",
          "D",
          "E",
          "F",
          "G",
          "H",
        ].map((m, i) => ({
          id: m,
          label: m,
          value: 20 + ((i * 11) % 70),
          color: PALETTE[i % PALETTE.length]!,
        })),
        (rows) => rows.map((r) => ({ label: r.label, value: r.value })),
      );

    case "pie-chart":
      return valueData(
        "pie",
        ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"].map((m, i) => ({
          id: m,
          label: m,
          value: 15 + (i * 12) % 75,
          color: PALETTE[i % PALETTE.length]!,
        })),
        (rows) => rows.map((r) => ({ id: r.id, label: r.label, value: r.value })),
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
        (rows) => rows.map((r) => ({ name: r.label, value: r.value })),
      );

    case "concentric-arc":
      return valueData(
        "concentric",
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
        (rows) =>
          rows.map((r) => ({ label: r.label, value: r.value, color: r.color })),
      );

    case "scatter-chart":
      return scatterData();

    case "gauge":
      return gaugeData();

    case "gauge-segmented":
      return gaugeData(24);

    case "gantt":
      return ganttData();

    case "pack":
    case "treemap":
    case "icicle":
    case "sunburst":
    case "tree-chart":
    case "budget-tree":
    case "treetable":
      return hierarchicalData();

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
      const rowById = new Map(rows.map((r) => [r.id, r]));
      const build = (parentId: string | null): BiNode[] => {
        const children = rows
          .filter((r) => r.parentId.value === parentId)
          .sort((a, b) => a.index.value - b.index.value);
        return children.map((r) => {
          const kids = build(r.id);
          const v = bi(r.index.value);
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
