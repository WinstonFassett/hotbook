// tree.ts — geometry-neutral reactive tree operations.
// Pure tree structure + value ops + sibling ordering + edge enumeration.
// No layout, no geometry, no rendering. Shared by icicle, sunburst, and any
// other Hierarchical chart. The icicle-specific windowing (buildAllDescendants)
// and rectilinear geometry (computeLayout/makeTile/makeHandle) live in
// hierarchy.ts; radial geometry lives in radial-geometry.ts.

import type { ChartConfig, DataNode, DraftEvent, RenderNode } from "./types";
import { num, total, type Num, type Writable } from "bireactive";
import { hsl } from "d3-color";

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
  /** Wraparound edge: the seam at 0°/2π between the last and first child
   *  of a full-circle parent. Sunburst-only; requires rotation-counter-
   *  rotation drag mechanics. See wiki/2026-07-18-sunburst-wraparound-divider.md */
  wraparound?: boolean;
}

const HUES = [240, 120, 40, 200, 160, 80, 0, 300];

function colorFor(depth: number, explicit?: string): string {
  if (explicit) return explicit;
  return `oklch(0.6 0.12 ${HUES[depth % HUES.length]})`;
}

const WASH_PER_LEVEL = 0.22;

/** Resolve a tile's fill color based on the chart's colorMode config.
 *  - "flat" (default): node.color as-is.
 *  - "depth": node.color brightened by depth (center saturated, outer washed out).
 *  - "mono": a single neutral accent for all tiles. */
export function resolveFill(
  baseColor: string,
  depth: number,
  colorMode?: "flat" | "depth" | "mono",
): string {
  if (depth === 0) return "#222";
  if (colorMode === "mono") return "oklch(0.55 0.08 240)";
  if (colorMode === "depth") {
    return hsl(baseColor).brighter(Math.max(0, depth - 1) * WASH_PER_LEVEL).toString();
  }
  return baseColor;
}

/** Pick light or dark label color based on background luminance.
 *  Dark backgrounds (like the #222 root) get light text; light backgrounds
 *  (the oklch palette) get dark text. Uses d3-color's displayable luminance. */
export function labelColorFor(bgColor: string): string {
  const c = hsl(bgColor);
  // hsl luminance approximation: use lightness L. Dark (L < 0.5) → light text.
  // The root (#222) has L ≈ 0.13 → light text. Palette colors have L ≈ 0.6-0.8 → dark text.
  return c.l < 0.5 ? "#e8e8ec" : "#1a1d24";
}

/** Darken a color by reducing its HSL lightness. Used for divider handles
 *  so they read as a darker shade of the parent's color rather than a
 *  washed-out white overlay. */
export function darkenColor(bgColor: string, amount = 0.18): string {
  const c = hsl(bgColor);
  c.l = Math.max(0, c.l - amount);
  return c.formatHsl();
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
    // Wraparound edge: seam between last and first child. Only meaningful
    // on full-circle parents (sunburst innermost). Handle visibility is
    // gated by angular span in the chart — invisible on non-full-circle parents.
    if (children.length >= 2) {
      const last = children[children.length - 1];
      const first = children[0];
      edges.push({
        id: `${last.id}..${first.id}#wrap`,
        leftId: last.id,
        rightId: first.id,
        parentId: node.id,
        depth: node.depth + 1,
        index: children.length - 1,
        wraparound: true,
      });
    }
  }
  return edges;
}
