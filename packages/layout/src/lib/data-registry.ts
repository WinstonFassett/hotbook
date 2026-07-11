// Data registry for MdNestedLayered.
// The demo (or any consumer) must call setLayoutData() before mounting the component.

import type { Arr } from "bireactive";
import type { Row, Edge } from "./data";

let _rows: Arr<Row> | null = null;
let _edges: Arr<Edge> | null = null;

export function setLayoutData(rows: Arr<Row>, edges: Arr<Edge>): void {
  _rows = rows;
  _edges = edges;
}

export function getLayoutRows(): Arr<Row> {
  if (!_rows) throw new Error("Layout data not set. Call setLayoutData() before mounting MdNestedLayered.");
  return _rows;
}

export function getLayoutEdges(): Arr<Edge> {
  if (!_edges) throw new Error("Layout data not set. Call setLayoutData() before mounting MdNestedLayered.");
  return _edges;
}
