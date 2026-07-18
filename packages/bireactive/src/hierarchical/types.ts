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
  /** Icicle-only: depth-axis assignment. Sunburst has no orientation
   *  (depth is always radial). Not part of the DataView query key. */
  orientation?: "horizontal" | "vertical";
  canReorder?: boolean;
  /** What dragging a tile body does: nothing, resize its value, or
   *  reorder it among siblings. Default: "resize". */
  dragBehavior?: "none" | "resize" | "reorder";
  conservationMode?: "additive" | "proportional-neighbor" | "proportional-siblings";
  /** Show the root node as a tile. When false, depth counts from the
   *  root's children (depth 1 = first visible row). Default: true. */
  showRoot?: boolean;
  /** Show a drill breadcrumb above the chart when drilled in. Default: false. */
  showBreadcrumb?: boolean;
  /** How tiles are colored:
   *  - "flat" (default): each node's own color, no depth adjustment.
   *  - "depth": group hue brightened by depth (center saturated, outer washed out).
   *  - "mono": single accent color for all tiles. */
  colorMode?: "flat" | "depth" | "mono";
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

/** A node in the rendered tree. With D3-style mount-once rendering,
 *  ALL descendants are mounted; `present` gates visibility (opacity +
 *  pointer-events). Off-window nodes (depth > maxDepth) have layout
 *  rects beyond the canvas edge — they slide to/from there and fade. */
export interface RenderNode {
  id: string;
  label: string;
  color: string;
  value: number;
  depth: number;
  parentId: string | null;
  isLeaf: boolean;
  /** True when this node is within the visible depth window. Drives
   *  opacity + pointer-events. Off-window nodes stay mounted so their
   *  geometry transitions animate the slide in/out. */
  present: boolean;
  children: RenderNode[];
}

/** Layout result: each node mapped to its rect in canvas space. */
export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Radial layout result: each node mapped to its angular + radial span.
 *  Angles are in radians [0, 2π]; radii are in pixels from the center.
 *  This is the radial analog of LayoutRect — same partition walk, but
 *  the sibling axis is angular and the depth axis is radial. */
export interface RadialRect {
  /** Start angle (radians). */
  a0: number;
  /** End angle (radians). */
  a1: number;
  /** Inner radius (pixels). */
  rIn: number;
  /** Outer radius (pixels). */
  rOut: number;
}

/** Pack layout result: each node mapped to its circle in canvas space.
 *  This is the circular analog of LayoutRect. */
export interface PackRect {
  /** Center X. */
  cx: number;
  /** Center Y. */
  cy: number;
  /** Radius. */
  r: number;
}
