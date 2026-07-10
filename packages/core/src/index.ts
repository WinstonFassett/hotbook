export type {
  Goal, GoalTree, UnitKind, ViewMode, FlatMode, HierMode,
  VizConfig, HVizConfig, VizCallbacks, HVizCallbacks,
  VizFormEvent, VizFormChangeEvent, VizFormClickEvent, Cleanup,
  VizNode, PNode, PEdge, ColumnSchema, Rollup, Measurement,
  VizConfigSchema, ScalingMode,
} from './types'
export { PALETTE, pickColor, colorFor } from './colors'
export { buildTree, applyView, drillPath, leavesOf } from './data-ops'
export type { TreeNode } from './data-ops'

// State machine
export {
  createUpdateLifecycleMachine,
  createIdleTrigger,
  type UpdateLifecycleState,
  type UpdateLifecycleEvent,
  type UpdateLifecycleMachine,
} from './state'

// Edit primitives
export {
  updateValue,
  moveNode,
  addNode,
  removeNode,
  batch,
  transaction,
  type ChangeCallback,
  type DatasetLike,
} from './edit'
