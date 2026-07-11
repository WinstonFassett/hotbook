/**
 * @hotbook/layout — graph/network layout engine.
 *
 * Exports the nested-layered backend and supporting utilities.
 */

// Main component
export { MdNestedLayered } from "./lib/spike5-nested-layered";

// Data registry (consumer must call setLayoutData before mounting)
export { setLayoutData } from "./lib/data-registry";

// Data model
export {
  makeRow,
  makeEdge,
  parentIdOf,
  indexOf,
  containmentForest,
  leafIds,
  containerIds,
  descendantsOf,
  flatGraph,
  rowsById,
  items,
  type Row,
  type Edge,
  type TreeNode,
  type FlatGraph,
} from "./lib/data";

// Settings
export {
  edgeStyle,
  direction,
  type EdgeStyle,
  type Direction,
} from "./lib/diagram-settings";

// Selection
export {
  sharedSelection,
  select,
  clearSelection,
  type Selection,
} from "./lib/selection";

// Layout utilities
export { layeredTight } from "./lib/layered-tight";
export { measure, type Measured } from "./lib/measure";

// Rendering utilities
export {
  FONT_PX,
  renderEdgeStyled,
  renderHull,
  renderNode,
} from "./lib/render";
