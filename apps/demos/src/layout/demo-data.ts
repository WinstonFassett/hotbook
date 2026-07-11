// Demo-specific data fixtures for the layout spike.
// The generic data model lives in @hotbook/layout.

import { arr, type Arr } from "bireactive";
import { makeRow, makeEdge, type Row, type Edge } from "@hotbook/layout";

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

const findCell = <T>(a: Arr<T>, v: T): import("bireactive").Cell<T> | undefined =>
  a.cells.find((c) => c.value === v);

export const insertRow = (row: Row): void => { sharedRows.insert(row); };
export const insertEdge = (edge: Edge): void => { sharedEdges.insert(edge); };
export const removeRow = (row: Row): void => { const c = findCell(sharedRows, row); if (c) sharedRows.remove(c); };
export const removeEdge = (edge: Edge): void => { const c = findCell(sharedEdges, edge); if (c) sharedEdges.remove(c); };
