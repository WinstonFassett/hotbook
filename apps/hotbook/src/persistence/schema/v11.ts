import type { VizNode, PNode, PEdge, ScalingMode } from '@hotbook/core'

export type { VizNode, PNode, PEdge }

// Minimal shape of the legacy grid layout items — kept for persistence compatibility
// with stored dashboards. The dock model replaces the grid in the new shell.
export interface LayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  maxW?: number
  minH?: number
  maxH?: number
  static?: boolean
}

// ─── Schema defs ──────────────────────────────────────────────────────────────

export interface MeasureDef {
  key: string
  label: string
  unit?: string
}

export interface DimDef {
  key: string
  label: string
  values?: string[]
}

// ─── Dataset ──────────────────────────────────────────────────────────────────

export interface Dataset {
  id: string
  name: string
  createdAt: string
  shape: 'flat' | 'tree' | 'graph'
  nodes: VizNode[]
  edges?: PEdge[]
  measureDefs: MeasureDef[]
  dimDefs: DimDef[]
}

// ─── Dashboard tile ───────────────────────────────────────────────────────────

// Gen-0 and Svelte variants are retired from the picker but kept as string literals
// so old persisted dashboards don't crash if encountered.
export type RetiredTileKind =
  | 'treemap' | 'radial' | 'bands'           // gen-0 flat morph trio
  | 'h-treemap' | 'h-icicle' | 'h-radial'   // gen-0 hier D3
  | 'treetable'                              // replaced by br-lc-treetable
  | 'svelte-br-lc-sunburst' | 'svelte-br-lc-icicle' | 'svelte-br-lc-pack' | 'svelte-br-lc-treemap' | 'svelte-treemap-demo'

export type TileKind =
  // bireactive LC-port charts (canon)
  | 'br-lc-bar'
  | 'br-lc-bands'
  | 'br-lc-line'
  | 'br-lc-area'
  | 'br-lc-scatter'
  | 'br-lc-pie'
  | 'br-lc-radar'
  | 'br-lc-concentric-arc'
  | 'br-lc-gauge'
  | 'br-lc-gauge-segmented'
  | 'br-lc-pack'
  | 'br-lc-treemap'
  | 'br-lc-treetable'
  | 'br-lc-icicle'
  | 'br-lc-sunburst'
  | 'br-lc-sankey'
  | 'br-lc-tree'
  | 'br-lc-gantt'
  | RetiredTileKind

export interface Tile {
  id: string
  kind: TileKind
  title?: string
  /** Which measure drives the value axis. Replaces `measureKey`. */
  valueBinding?: string
  /** Which measure determines slot order for slot charts. Replaces `sortBy`. */
  orderBinding?: string
  /** Direction for orderBinding. Defaults to 'desc' for 'value', 'asc' otherwise. */
  orderDir?: 'asc' | 'desc'
  /** Scatter / cartesian x-axis measure. Replaces `xKey`. */
  xBinding?: string
  /** Scatter / cartesian y-axis measure. Replaces `yKey`. */
  yBinding?: string
  /** @deprecated use `valueBinding` */
  measureKey?: string
  /** @deprecated use `orderBinding` */
  sortBy?: 'index' | 'value'
  /** @deprecated use `xBinding` */
  xKey?: string
  /** @deprecated use `yBinding` */
  yKey?: string
  groupBy?: string
  depth?: number
  orientation?: 'vertical' | 'horizontal'
  colorMode?: 'single' | 'palette'
  labelMode?: 'axis' | 'inside' | 'both'
  valueMode?: 'inside' | 'outside' | 'none'
  minBandSize?: number
  maxItems?: number
  scalingMode?: ScalingMode
  cascadeEnabled?: boolean
  fixedTotal?: number | null
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface Dashboard {
  id: string
  datasetId: string
  name: string
  createdAt: string
  layout: LayoutItem[]
  tiles: Tile[]
  measureKey: string
  /** Persisted drill scope map: drillKey → drillNodeId. Tiles with same drillKey
   *  share drill context. Each chart drills internally via scale remap. */
  drills?: Record<string, string | null>
  /** Legacy single drill scope - migrated to drills['default'] on load. */
  drillNodeId?: string | null
  /** Persisted dock tree. If absent, synthesized from tiles. */
  dockTree?: import('../../dock').DockNode | null
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export interface Workspace {
  datasets: Dataset[]
  dashboards: Dashboard[]
  activeDatasetId: string
  activeDashboardId: string
}
