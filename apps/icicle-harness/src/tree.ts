// tree.ts — geometry-neutral reactive tree operations.
// Pure tree structure + value ops + sibling ordering + edge enumeration.
// No layout, no geometry, no rendering. Shared by icicle, sunburst, and any
// other Hierarchical chart. The icicle-specific windowing (buildAllDescendants)
// and rectilinear geometry (computeLayout/makeTile/makeHandle) live in
// hierarchy.ts; radial geometry lives in radial-geometry.ts.

import type { ChartConfig, DataNode, DraftEvent, RenderNode } from "./types";
import { num, total, type Num, type Writable } from "bireactive";

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

/** Enumerate edges between ALL adjacent sibling pairs in a rendered tree.
 *  Geometry-neutral: just sibling pairs. The icicle renders these as
 *  rectilinear boundary knobs; the sunburst renders them as tangent angular
 *  knobs. Handle visibility is gated by the caller via membership. */
export function buildEdges(allNodes: RenderNode[]): Edge[] {
  const edges: Edge[] = [];
  for (const node of allNodes) {
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
