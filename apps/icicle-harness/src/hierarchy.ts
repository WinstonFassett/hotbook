// hierarchy.ts — reactive tree, window, layout, and render helpers for the icicle chart.
// No gesture policy here; that lives in gestures.ts.

import type { ChartConfig, DataNode, DraftEvent, LayoutRect, RenderNode } from "./types";
import {
  cell,
  derive,
  forEach,
  group,
  label,
  num,
  rect,
  total,
  type Cell,
  type Num,
  type Shape,
  type Writable,
} from "bireactive";

export interface ChartNode {
  id: string;
  label: string;
  color: string;
  value: Writable<Num>;
  children: ChartNode[];
  parent: ChartNode | null;
}

export interface Edge {
  id: string;
  leftId: string;
  rightId: string;
  parentId: string;
  depth: number;
  index: number;
}

const HUES = [240, 120, 40, 200, 160, 80, 0, 300];

function colorFor(depth: number, explicit?: string): string {
  if (explicit) return explicit;
  return `oklch(0.6 0.12 ${HUES[depth % HUES.length]})`;
}

export function buildTree(root: DataNode, parent: ChartNode | null = null, depth = 0): ChartNode {
  const children = root.children.map((c) => buildTree(c, null, depth + 1));
  const value = children.length === 0 ? num(root.value) : total(children.map((c) => c.value));
  const node: ChartNode = {
    id: root.id,
    label: root.label,
    color: colorFor(depth, root.color),
    value,
    children,
    parent,
  };
  for (const c of children) c.parent = node;
  return node;
}

export function findNode(root: ChartNode, id: string): ChartNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

export function treeDepth(root: ChartNode): number {
  let max = 0;
  function walk(n: ChartNode, d: number) {
    max = Math.max(max, d);
    for (const c of n.children) walk(c, d + 1);
  }
  walk(root, 0);
  return max;
}

export function leafValues(root: ChartNode): Array<{ nodeId: string; value: number }> {
  const out: Array<{ nodeId: string; value: number }> = [];
  function walk(n: ChartNode) {
    if (n.children.length === 0) out.push({ nodeId: n.id, value: n.value.value });
    else for (const c of n.children) walk(c);
  }
  walk(root);
  return out;
}

export function snapshotValues(root: ChartNode): Map<string, number> {
  const map = new Map<string, number>();
  function walk(n: ChartNode) {
    if (n.children.length === 0) map.set(n.id, n.value.value);
    else for (const c of n.children) walk(c);
  }
  walk(root);
  return map;
}

export function restoreValues(root: ChartNode, map: Map<string, number>): void {
  function walk(n: ChartNode) {
    if (n.children.length === 0) {
      const v = map.get(n.id);
      if (v !== undefined) n.value.value = v;
    } else {
      for (const c of n.children) walk(c);
    }
  }
  walk(root);
}

export function applyDraft(root: ChartNode, draft: DraftEvent): void {
  const left = findNode(root, draft.nodeId);
  if (!left) return;
  left.value.value = draft.value;
  if (draft.secondaryNodeId) {
    const right = findNode(root, draft.secondaryNodeId);
    if (right) right.value.value = draft.secondaryValue ?? 0;
  }
}

export function sortedChildren(
  node: ChartNode,
  config: ChartConfig,
  frozenOrder?: Map<string, string[]> | null,
): ChartNode[] {
  if (frozenOrder) {
    const order = frozenOrder.get(node.id);
    if (order) {
      const byId = new Map(node.children.map((c) => [c.id, c]));
      return order.map((id) => byId.get(id)).filter((c): c is ChartNode => c !== undefined);
    }
  }
  if (config.sort === "value") {
    return node.children.slice().sort((a, b) => b.value.value - a.value.value);
  }
  return node.children;
}

export function buildWindow(
  root: ChartNode,
  config: ChartConfig,
  frozenOrder?: Map<string, string[]> | null,
): RenderNode[] {
  const maxDepth = Math.min(config.depth ?? 100, treeDepth(root));
  const result: RenderNode[] = [];

  function build(n: ChartNode, depth: number, parentId: string | null): RenderNode {
    const visibleChildren: RenderNode[] = [];
    const isLeaf = n.children.length === 0 || depth === maxDepth;
    const rn: RenderNode = {
      id: n.id,
      label: n.label,
      color: n.color,
      value: n.value.value,
      depth,
      parentId,
      isLeaf,
      children: visibleChildren,
    };
    result.push(rn);
    if (!isLeaf) {
      for (const c of sortedChildren(n, config, frozenOrder)) {
        visibleChildren.push(build(c, depth + 1, n.id));
      }
    }
    return rn;
  }

  build(root, 0, null);
  return result;
}

export function computeLayout(
  root: ChartNode,
  config: ChartConfig,
  frozenOrder: Map<string, string[]> | null | undefined,
  W: number,
  H: number,
): Map<string, LayoutRect> {
  const maxDepth = Math.min(config.depth ?? 100, treeDepth(root));
  const isHoriz = config.orientation === "horizontal";
  const band = isHoriz ? W / (maxDepth + 1) : H / (maxDepth + 1);
  const valueSpan = isHoriz ? H : W;
  const map = new Map<string, LayoutRect>();

  function setRect(id: string, v0: number, v1: number, d: number) {
    const depthPos = d * band;
    const size = v1 - v0;
    if (isHoriz) {
      map.set(id, { x: depthPos, y: v0, width: band, height: size });
    } else {
      map.set(id, { x: v0, y: depthPos, width: size, height: band });
    }
  }

  function partition(n: ChartNode, v0: number, v1: number, d: number) {
    setRect(n.id, v0, v1, d);
    if (d >= maxDepth) return;
    const children = sortedChildren(n, config, frozenOrder);
    const totalValue = children.reduce((s, c) => s + c.value.value, 0);
    const span = v1 - v0;
    let cur = v0;
    for (const c of children) {
      const w = totalValue > 0 ? (c.value.value / totalValue) * span : 0;
      partition(c, cur, cur + w, d + 1);
      cur += w;
    }
  }

  partition(root, 0, valueSpan, 0);
  return map;
}

export function buildEdges(windowNodes: RenderNode[]): Edge[] {
  const edges: Edge[] = [];
  for (const node of windowNodes) {
    const children = node.children;
    for (let i = 0; i < children.length - 1; i++) {
      const left = children[i];
      const right = children[i + 1];
      edges.push({
        id: `${left.id}..${right.id}`,
        leftId: left.id,
        rightId: right.id,
        parentId: node.id,
        depth: node.depth + 1,
        index: i,
      });
    }
  }
  return edges;
}

export function makeTile(
  node: RenderNode,
  layout: Cell<Map<string, LayoutRect>>,
  chart?: {
    setHover(id: string | null): void;
    setFocus(id: string | null): void;
    focusCell: Cell<string | null>;
    hoverCell: Cell<string | null>;
  },
): Shape {
  const pad = 2;
  const rx = derive(() => (layout.value.get(node.id)?.x ?? 0) + pad);
  const ry = derive(() => (layout.value.get(node.id)?.y ?? 0) + pad);
  const rw = derive(() => Math.max(0, (layout.value.get(node.id)?.width ?? 0) - pad * 2));
  const rh = derive(() => Math.max(0, (layout.value.get(node.id)?.height ?? 0) - pad * 2));

  // Stroke reflects focus/selection and hover state — reads bireactive cells
  // so the derive re-runs automatically when focus/hover changes.
  const stroke = derive(() => {
    if (!chart) return "none";
    if (chart.focusCell.value === node.id) return "#fff";
    if (chart.hoverCell.value === node.id) return "#c8cdd6";
    return "none";
  });
  const strokeWidth = derive(() => {
    if (!chart) return 0;
    if (chart.focusCell.value === node.id || chart.hoverCell.value === node.id) return 2;
    return 0;
  });

  const tile = rect(rx, ry, rw, rh, { fill: node.color, stroke, strokeWidth });
  tile.el.style.cursor = "pointer";
  tile.el.setAttribute("data-id", node.id);

  // Wire focus/selection and hover if chart is provided.
  if (chart) {
    tile.el.addEventListener("pointerenter", () => chart.setHover(node.id));
    tile.el.addEventListener("pointerleave", () => chart.setHover(null));
    tile.el.addEventListener("click", () => {
      chart.setFocus(node.id);
      (tile.el as SVGRectElement).focus?.();
    });
  }

  const text = label(tile.at(0, 0)!, node.label, {
    align: { x: 0, y: 0 },
    fill: "#fff",
    size: 10,
  });
  text.el.style.pointerEvents = "none";
  return group({}, tile, text);
}

const HANDLE_W = 6;

export function makeHandle(
  edge: Edge,
  layout: Cell<Map<string, LayoutRect>>,
  configCell: Cell<ChartConfig | null>,
): Shape {
  const isHoriz = derive(() => configCell.value?.orientation === "horizontal");

  const hx = derive(() => {
    const lr = layout.value.get(edge.leftId);
    if (!lr) return 0;
    return isHoriz.value ? lr.x : lr.x + lr.width - HANDLE_W / 2;
  });

  const hy = derive(() => {
    const lr = layout.value.get(edge.leftId);
    if (!lr) return 0;
    return isHoriz.value ? lr.y + lr.height - HANDLE_W / 2 : lr.y;
  });

  const hw = derive(() => {
    if (isHoriz.value) return layout.value.get(edge.leftId)?.width ?? 0;
    return HANDLE_W;
  });

  const hh = derive(() => {
    if (isHoriz.value) return HANDLE_W;
    return layout.value.get(edge.leftId)?.height ?? 0;
  });

  const handle = rect(hx, hy, hw, hh, { fill: "rgba(255,255,255,0.08)", stroke: "none" });
  handle.effect(() => {
    handle.el.style.cursor = isHoriz.value ? "row-resize" : "col-resize";
  });
  handle.el.style.pointerEvents = "all";
  (handle as any)._edge = edge;
  return handle;
}
