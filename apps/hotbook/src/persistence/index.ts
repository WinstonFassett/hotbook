// Re-export the full public surface so existing imports keep working
export type {
  LayoutItem,
  MeasureDef,
  DimDef,
  Dataset,
  TileKind,
  Tile,
  Dashboard,
  Workspace,
} from './schema/v11'

export type { VizNode, PNode, PEdge } from './schema/v11'

export {
  initWorkspace,
  saveWorkspace,
  newId,
} from './storage'

export {
  updateRow,
  updateRows,
  reorderLeaves,
  createDataset,
  createDashboard,
  updateDataset,
  updateDashboard,
  addTile,
  removeTile,
  deleteDashboard,
  deleteDataset,
  activeDataset,
  activeDashboard,
  dashboardsForDataset,
  drillPath,
} from './mutations'
