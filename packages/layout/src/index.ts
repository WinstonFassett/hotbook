/**
 * @hotbook/layout — graph/network layout engine.
 *
 * Exports the nested-layered chart and supporting utilities.
 */

// Main component
export { MdNestedLayered } from "./lib/nested-layered";

// Data model
export {
  makeRow,
  makeEdge,
  leafIds,
  containerIds,
  descendantsOf,
  flatGraph,
  type Row,
  type Edge,
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
  clearSelection,
  type Selection,
} from "./lib/selection";
