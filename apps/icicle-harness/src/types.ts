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

/** Canonical config. Query fields (datasetId, measure, depth) key the
 *  DataView. Render fields (sort, orientation, conservationMode, canReorder)
 *  are chart-applied and do not affect the DataView key. */
export interface ChartConfig {
  datasetId: string;
  measure: string;
  sort: "index" | "value";
  depth?: number;
  orientation: "horizontal" | "vertical";
  canReorder?: boolean;
  conservationMode?: "additive" | "proportional-neighbor" | "proportional-siblings";
}

/** A draft event produced by a control surface. */
export interface DraftEvent {
  /** Which node is being edited. */
  nodeId: string;
  /** The proposed new value. */
  value: number;
  /** Which control surface produced this draft. */
  source: "divider-handle" | "wheel" | "keyboard" | "table-cell" | "reorder" | "tile-body";
  /** What kind of edit: value change or reorder. */
  intent: "edit" | "reorder";
  /** For two-sibling reapportion (boundary knob): the neighbor node that
   *  absorbs the complementary delta so the pair's sum is preserved. */
  secondaryNodeId?: string;
  /** The proposed new value of the secondary node (reapportion). */
  secondaryValue?: number;
  /** For reorder: the new sibling order within the parent. */
  reorderOrder?: string[];
  /** For reorder: the parent node id. */
  parentId?: string;
  /** Snapshot of sibling order to freeze during gesture (when sort !== 'index'). */
  frozenOrder?: Map<string, string[]>;
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
