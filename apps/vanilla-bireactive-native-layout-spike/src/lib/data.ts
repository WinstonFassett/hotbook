// Generic compound-graph model. Tabular source of truth, two tables.
//
// Row { id, parentId, index, name }
//   parentId is the CONTAINMENT tree — arbitrarily nestable. A row with
//   children is a container (compound node / group / subgraph). A row
//   with no children is a leaf. parentId === null means top level.
//   index orders siblings within a parent.
//
// Edge { from, to }
//   The graph layer. Cross containment freely — a deeply nested node
//   can have an edge to a top-level node, etc. Multiple incoming /
//   outgoing edges per node are fine; cycles are allowed (layout will
//   break them or render as recurrent).
//
// Both columns are independent. Drag a node from one container to
// another → write parentId. Add a transition → insert an Edge row.
// Adapters for specific domains (state machines, flow charts, org
// charts) live on top of this generic model.

import { arr, Arr, cell, type Cell, type Writable } from "@bireactive";

// ── nodes (the containment table) ────────────────────────────────────

export interface Row {
  id: string;
  parentId: Writable<Cell<string | null>>; // containment parent (nullable = top-level)
  index: Writable<Cell<number>>; // sibling order within the parent
  name: Writable<Cell<string>>;
  /** Per-group layout direction. null = inherit from parent (or diagram
   *  default at the root). Only meaningful when the row is a container. */
  direction: Writable<Cell<"TB" | "LR" | null>>;
}

export const parentIdOf = (r: Row) => r.parentId;
export const indexOf = (r: Row) => r.index;

export function makeRow(
  id: string,
  parentId: string | null,
  index: number,
  name = id,
): Row {
  return {
    id,
    parentId: cell<string | null>(parentId),
    index: cell(index),
    name: cell(name),
    direction: cell<"TB" | "LR" | null>(null),
  };
}

// ── edges (the graph table) ──────────────────────────────────────────

export interface Edge {
  id: string;
  from: Writable<Cell<string>>;
  to: Writable<Cell<string>>;
  label: Writable<Cell<string>>;
}

export function makeEdge(from: string, to: string, label = ""): Edge {
  return {
    id: `${from}->${to}`,
    from: cell(from),
    to: cell(to),
    label: cell(label),
  };
}

// ── seed ─────────────────────────────────────────────────────────────
// A compound graph: two top-level containers, one nested container,
// edges that cross containment.

const SEED_ROWS: Row[] = [
  makeRow("frontend", null, 0, "frontend"),
  makeRow("backend", "billing", 1, "backend"),
  makeRow("auth", "web", 0, "auth"),
  makeRow("dash", "web", 1, "dash"),
  makeRow("web", null, 2, "web"),
  makeRow("services", "orgs", 0, "services"),
  makeRow("data", "users", 1, "data"),
  makeRow("users", "orgs", 0, "users"),
  makeRow("orgs", "auth", 1, "orgs"),
  makeRow("billing", "dash", 2, "billing"),
  makeRow("pg", null, 0, "pg"),
  makeRow("redis", "data", 1, "redis"),
];

const SEED_EDGES: Edge[] = [
  // Within frontend
  makeEdge("auth", "web"),
  makeEdge("dash", "web"),
  // Frontend → services (crosses containment)
  makeEdge("auth", "users"),
  makeEdge("dash", "orgs"),
  makeEdge("web", "billing"),
  // Services → data (crosses nested containment)
  makeEdge("users", "pg"),
  makeEdge("orgs", "pg"),
  makeEdge("billing", "pg"),
  makeEdge("web", "redis"),
];

/** Shared by every spike. Mutate either Arr → every view re-renders. */
export const sharedRows: Arr<Row> = arr<Row>(SEED_ROWS);
export const sharedEdges: Arr<Edge> = arr<Edge>(SEED_EDGES);

export const items = <T>(a: Arr<T>): readonly T[] => a.cells.map((c) => c.value);

const findCell = <T>(a: Arr<T>, v: T): import("@bireactive").Cell<T> | undefined =>
  a.cells.find((c) => c.value === v);

export const insertRow = (row: Row): void => { sharedRows.insert(row); };
export const insertEdge = (edge: Edge): void => { sharedEdges.insert(edge); };
export const removeRow = (row: Row): void => { const c = findCell(sharedRows, row); if (c) sharedRows.remove(c); };
export const removeEdge = (edge: Edge): void => { const c = findCell(sharedEdges, edge); if (c) sharedEdges.remove(c); };

// ── derive: Arr → compound-graph projection ──────────────────────────

/** A containment-tree node carrying its row id, its children, and its
 *  full ancestor chain. Computed from the parentId column. */
export interface TreeNode {
  id: string;
  children: TreeNode[];
  depth: number;
}

/** Build the containment forest. Top-level nodes are roots. */
export function containmentForest(rowColl: Arr<Row>): TreeNode[] {
  const rows = items(rowColl);
  const byParent = new Map<string | null, Row[]>();
  for (const r of rows) {
    const pid = r.parentId.value;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(r);
  }
  // Sort each parent's children by index.
  for (const arr of byParent.values()) arr.sort((a, b) => a.index.value - b.index.value);

  function build(pid: string | null, depth: number): TreeNode[] {
    const kids = byParent.get(pid) ?? [];
    return kids.map((r) => ({
      id: r.id,
      depth,
      children: build(r.id, depth + 1),
    }));
  }
  return build(null, 0);
}

/** All leaf node ids (rows with no children). For layouts that only
 *  position leaves; containers are derived as hulls around them. */
export function leafIds(rowColl: Arr<Row>): string[] {
  const rows = items(rowColl);
  const hasChild = new Set<string>();
  for (const r of rows) {
    const pid = r.parentId.value;
    if (pid != null) hasChild.add(pid);
  }
  return rows.filter((r) => !hasChild.has(r.id)).map((r) => r.id);
}

/** All container node ids (rows with at least one child). */
export function containerIds(rowColl: Arr<Row>): string[] {
  const hasChild = new Set<string>();
  for (const r of items(rowColl)) {
    const pid = r.parentId.value;
    if (pid != null) hasChild.add(pid);
  }
  return [...hasChild];
}

/** All descendant ids of a given node (transitive). */
export function descendantsOf(rowColl: Arr<Row>, rootId: string): Set<string> {
  const rows = items(rowColl);
  const out = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const r of rows) {
      if (r.parentId.value === id && !out.has(r.id)) {
        out.add(r.id);
        queue.push(r.id);
      }
    }
  }
  return out;
}

/** Flat DAG view: nodes + edges, with edges resolved against the live
 *  Edge table. Cross-containment edges are preserved as-is. */
export interface FlatGraph {
  nodes: string[];
  edges: Array<[string, string]>;
}

export function flatGraph(rowColl: Arr<Row>, edgeColl: Arr<Edge>): FlatGraph {
  const nodes = items(rowColl).map((r) => r.id);
  const ids = new Set(nodes);
  const edges: Array<[string, string]> = [];
  for (const e of items(edgeColl)) {
    const f = e.from.value;
    const t = e.to.value;
    if (ids.has(f) && ids.has(t)) edges.push([f, t]);
  }
  return { nodes, edges };
}

/** rowsById helper (used by several spikes). */
export function rowsById(rowColl: Arr<Row>): Map<string, Row> {
  return new Map(items(rowColl).map((r) => [r.id, r]));
}
