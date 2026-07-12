import * as v from 'valibot'

// ─── Data Shape Types ─────────────────────────────────────────────────────────

export type DataShape = 'flat' | 'hierarchical' | 'graph'

// ─── Config Field Schemas ─────────────────────────────────────────────────────

export const measureSchema = v.string()
export const sortSchema = v.union([v.literal('index'), v.literal('value')])
export const orientationSchema = v.union([v.literal('horizontal'), v.literal('vertical')])
export const depthSchema = v.number()
export const xKeySchema = v.string()
export const yKeySchema = v.string()
export const groupBySchema = v.optional(v.string())

// ─── UI Field Descriptor ──────────────────────────────────────────────────────

export interface UIField {
  type: 'measure' | 'sort' | 'orientation' | 'depth' | 'xKey' | 'yKey' | 'groupBy'
  label: string
  path: string  // dot-path into config object (e.g., 'measureKey', 'orderBinding')
}

// ─── Runtime Data Row ─────────────────────────────────────────────────────────

/** Row passed to a chart's `toChart` transform. Keep it plain so hotbook and
 *  the demos can both build it from their own data substrates. */
export interface FlatRow {
  id: string
  label: string
  value: number
  value2?: number
  color?: string
  index?: number
  date?: Date
  // Measures available for x/y/secondary bindings (scatter, multi-measure).
  measures?: Record<string, number>
}

export interface ChartContext {
  xKey?: string
  yKey?: string
  valueBinding?: string
  orderBinding?: string
  orderDir?: 'asc' | 'desc'
  tile?: any
  rawNodes?: any
  edges?: any
}

export interface MountContext {
  tile: any
  leaves: any[]
  nodeById: Map<string, any>
  ids: string[]
  valueBinding: string
  xKey?: string
  yKey?: string
  orderBinding?: string
  orderDir?: 'asc' | 'desc'
}

// ─── Chart Schema ─────────────────────────────────────────────────────────────

export interface ChartSchema<TConfig = any> {
  kind: string
  label: string
  dataShape: DataShape
  config: v.BaseSchema<TConfig, TConfig, v.BaseIssue<unknown>>
  ui: {
    fields: UIField[]
  }
  capabilities?: {
    drillKey?: string
    showBreadcrumb?: boolean
    scrollBody?: boolean
  }
  // How DockView should mount this chart.
  mount?: 'bindTile' | 'externalData'
  // If true, a tree dataset can be rendered by aggregating each root's leaves.
  flattenHierarchical?: boolean
  // Runtime data hook: transform the data into what the chart expects.
  // For flat charts `data` is FlatRow[]; for hierarchical/external it can be any
  // value the mount strategy needs (e.g. a tree root or graph data).
  toChart?: (data: any, ctx: ChartContext) => any
  readValue?: (d: any) => number
  writeValue?: (d: any, v: number) => void
  idOf?: (d: any) => string
  reindex?: (d: any, displayIndex: number, ctx: ChartContext) => void
  mountProps?: (ctx: MountContext) => (el: any) => void
}

// ─── Schema Registry ──────────────────────────────────────────────────────────

const chartSchemas = new Map<string, ChartSchema>()

export function registerChart(schema: ChartSchema): void {
  chartSchemas.set(schema.kind, schema)
}

export function getChartSchema(kind: string): ChartSchema | undefined {
  return chartSchemas.get(kind)
}

export function getAllChartSchemas(): Map<string, ChartSchema> {
  return chartSchemas
}
