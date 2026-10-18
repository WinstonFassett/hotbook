export type {
  Goal, GoalTree, // these are demo types. Not part of the core library.
  UnitKind, ViewMode, FlatMode, HierMode,
  VizConfig, HVizConfig, VizCallbacks, HVizCallbacks,
  hotbookEvent, hotbookChangeEvent, hotbookClickEvent, Cleanup,
  VizNode, PNode, PEdge, ColumnSchema, Rollup, Measurement,
  ScalingMode,
} from './types'
// colors should also perhaps go in a colors or charts package
export { PALETTE, PALETTE_8, PALETTE_20, pickColor, colorFor, getColorByStrategy } from './colors'
export type { ColorStrategy } from './colors'
export { buildTree, applyView, drillPath, leavesOf } from './data-ops'
export type { TreeNode } from './data-ops'
// umm these introduce a dependency on valibot. not loving that. maybe this goes in a charts package?
export type { ChartSchema, DataShape, UIField, FlatRow, ChartContext, MountContext } from './schemas'
export { registerChart, getChartSchema, getAllChartSchemas } from './schemas'
export {
  measureSchema,
  sortSchema,
  orientationSchema,
  depthSchema,
  xKeySchema,
  yKeySchema,
  groupBySchema,
} from './schemas'
