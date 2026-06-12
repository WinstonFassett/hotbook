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

import { cell, type Cell, type Writable } from "@bireactive";
import { coll, type Coll } from "@bireactive/coll";

// ── nodes (the containment table) ────────────────────────────────────

export interface Row {
  id: string;
  parentId: Writable<Cell<string | null>>; // containment parent (nullable = top-level)
  index: Writable<Cell<number>>; // sibling order within the parent
  name: Writable<Cell<string>>;
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
  };
}

// ── edges (the graph table) ──────────────────────────────────────────

export interface Edge {
  id: string;
  from: Writable<Cell<string>>;
  to: Writable<Cell<string>>;
}

export function makeEdge(from: string, to: string): Edge {
  return { id: `${from}->${to}`, from: cell(from), to: cell(to) };
}

// ── seed ─────────────────────────────────────────────────────────────
// A compound graph: two top-level containers, one nested container,
// edges that cross containment.

const SEED_ROWS: Row[] = [
  // Top level containers
  makeRow("frontend", null, 0, "frontend"),
  makeRow("backend", null, 1, "backend"),

  // Inside "frontend"
  makeRow("auth", "frontend", 0, "auth"),
  makeRow("dash", "frontend", 1, "dash"),
  makeRow("web", "frontend", 2, "web"),

  // Inside "backend" — itself contains a sub-container "data"
  makeRow("services", "backend", 0, "services"),
  makeRow("data", "backend", 1, "data"),

  // Inside "services"
  makeRow("users", "services", 0, "users"),
  makeRow("orgs", "services", 1, "orgs"),
  makeRow("billing", "services", 2, "billing"),

  // Inside "data" (nested two levels deep)
  makeRow("pg", "data", 0, "pg"),
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

/** Shared by every spike. Mutate either Coll → every view re-renders. */
export const sharedRows: Coll<Row> = coll<Row>(SEED_ROWS, (r) => r.id);
export const sharedEdges: Coll<Edge> = coll<Edge>(SEED_EDGES, (e) => e.id);

// ── derive: Colls → compound-graph projection ───────────────────────

/** A containment-tree node carrying its row id, its children, and its
 *  full ancestor chain. Computed from the parentId column. */
export interface TreeNode {
  id: string;
  children: TreeNode[];
  depth: number;
}

/** Build the containment forest. Top-level nodes are roots. */
export function containmentForest(rowColl: Coll<Row>): TreeNode[] {
  const rows = rowColl.items;
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
export function leafIds(rowColl: Coll<Row>): string[] {
  const hasChild = new Set<string>();
  for (const r of rowColl.items) {
    const pid = r.parentId.value;
    if (pid != null) hasChild.add(pid);
  }
  return rowColl.items.filter((r) => !hasChild.has(r.id)).map((r) => r.id);
}

/** All container node ids (rows with at least one child). */
export function containerIds(rowColl: Coll<Row>): string[] {
  const hasChild = new Set<string>();
  for (const r of rowColl.items) {
    const pid = r.parentId.value;
    if (pid != null) hasChild.add(pid);
  }
  return [...hasChild];
}

/** All descendant ids of a given node (transitive). */
export function descendantsOf(rowColl: Coll<Row>, rootId: string): Set<string> {
  const out = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const r of rowColl.items) {
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

export function flatGraph(rowColl: Coll<Row>, edgeColl: Coll<Edge>): FlatGraph {
  const nodes = rowColl.items.map((r) => r.id);
  const ids = new Set(nodes);
  const edges: Array<[string, string]> = [];
  for (const e of edgeColl.items) {
    const f = e.from.value;
    const t = e.to.value;
    if (ids.has(f) && ids.has(t)) edges.push([f, t]);
  }
  return { nodes, edges };
}

/** rowsById helper (used by several spikes). */
export function rowsById(rowColl: Coll<Row>): Map<string, Row> {
  return new Map(rowColl.items.map((r) => [r.id, r]));
}
