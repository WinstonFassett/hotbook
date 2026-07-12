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
