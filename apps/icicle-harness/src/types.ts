// types.ts — core data types for the icicle harness.
// No bireactive here. These are the domain model.

/** A hierarchical data node. The Dataset is a tree of these. */
export interface DataNode {
  id: string;
  label: string;
  color?: string;
  /** The node's value. For leaves, this is the raw value. For groups,
   *  this is the sum of children (computed by the Kernel on update). */
  value: number;
  children: DataNode[];
}

/** A registered dataset. */
export interface Dataset {
  id: string;
  dataShape: "hierarchical" | "flat" | "graph";
  root: DataNode;
}

/** Canonical config that keys a DataView. Two charts with the same
 *  canonical config share a DataView. */
export interface ChartConfig {
  datasetId: string;
  measure: string;
  sort: "index" | "value";
  depth?: number;
  orientation: "horizontal" | "vertical";
}

/** A draft event produced by a control surface. */
export interface DraftEvent {
  /** Which node is being edited. */
  nodeId: string;
  /** The proposed new value. */
  value: number;
  /** Which control surface produced this draft. */
  source: "boundary-knob" | "wheel" | "keyboard" | "table-cell" | "reorder";
  /** What kind of edit: value change or reorder. */
  intent: "edit" | "reorder";
  /** For reorder: the new sibling order within the parent. */
  reorderOrder?: string[];
  /** For reorder: the parent node id. */
  parentId?: string;
}

/** Editor states. */
export type EditorStateKey = "Idle" | "Drafting";

/** Editor transition event. */
export interface EditorTransition {
  from: EditorStateKey;
  to: EditorStateKey;
  type: "draft" | "commit" | "cancel" | "updated";
  draft?: DraftEvent;
}

/** A node in the rendered window (what the chart actually displays). */
export interface RenderNode {
  id: string;
  label: string;
  color: string;
  value: number;
  depth: number;
  parentId: string | null;
  isLeaf: boolean;
  children: RenderNode[];
}

/** Layout result: each node mapped to its rect in canvas space. */
export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
