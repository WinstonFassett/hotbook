/**
 * Chart schema registry — each chart declares its config shape, UI pickers,
 * data mapping, and mount strategy.
 */

import * as v from 'valibot'
import {
  registerChart,
  type ChartSchema,
  type FlatRow,
  type MountContext,
  type VizNode,
  type PEdge,
  measureSchema,
  sortSchema,
  orientationSchema,
  depthSchema,
  xKeySchema,
  yKeySchema,
} from '@hotbook/core'
import { LINK_MIN } from './lib/sankey'

// ─── Config Schemas ───────────────────────────────────────────────────────────

const flatConfigSchema = v.object({
  valueBinding: v.optional(measureSchema),
  orderBinding: v.optional(sortSchema),
  orderDir: v.optional(v.union([v.literal('asc'), v.literal('desc')])),
})

const flatWithOrientationConfigSchema = v.object({
  valueBinding: v.optional(measureSchema),
  orderBinding: v.optional(sortSchema),
  orderDir: v.optional(v.union([v.literal('asc'), v.literal('desc')])),
  orientation: v.optional(orientationSchema),
})

const scatterConfigSchema = v.object({
  xBinding: v.optional(xKeySchema),
  yBinding: v.optional(yKeySchema),
})

const hierConfigSchema = v.object({
  valueBinding: v.optional(measureSchema),
  orderBinding: v.optional(sortSchema),
  orderDir: v.optional(v.union([v.literal('asc'), v.literal('desc')])),
  depth: v.optional(depthSchema),
})

const hierWithOrientationConfigSchema = v.object({
  valueBinding: v.optional(measureSchema),
  orderBinding: v.optional(sortSchema),
  orderDir: v.optional(v.union([v.literal('asc'), v.literal('desc')])),
  depth: v.optional(depthSchema),
  orientation: v.optional(orientationSchema),
})

const graphConfigSchema = v.object({
  valueBinding: v.optional(measureSchema),
  orderBinding: v.optional(sortSchema),
  orderDir: v.optional(v.union([v.literal('asc'), v.literal('desc')])),
})

const simpleConfigSchema = v.object({
  valueBinding: v.optional(measureSchema),
})

// ─── Common data helpers ──────────────────────────────────────────────────────

const palette = ['#e05c5c', '#f0a742', '#4cba6e', '#5b8def', '#b76de0', '#44c4c4']

const SERIES_START = new Date(2026, 0, 1).getTime()
const DAY_MS = 86400 * 1000

function buildSankeyData(edges: PEdge[], rawNodes: VizNode[], valueBinding: string): { nodes: string[]; links: { source: string; target: string; value: number }[] } {
  if (edges && edges.length > 0) {
    const nodes = [...new Set(edges.flatMap(e => [e.source, e.target]))]
    const links = edges.map(e => ({ source: e.source, target: e.target, value: e.value }))
    return { nodes, links }
  }

  const nodes = rawNodes.map(n => n.id)
  const byId = new Map(rawNodes.map(n => [n.id, n]))
  const children = new Map<string, VizNode[]>()
  for (const n of rawNodes) {
    if (n.parentId) {
      const arr = children.get(n.parentId) ?? []
      arr.push(n)
      children.set(n.parentId, arr)
    }
  }
  const memo = new Map<string, number>()
  function getNodeValue(id: string): number {
    if (memo.has(id)) return memo.get(id)!
    const n = byId.get(id)
    if (!n) { memo.set(id, 0); return 0 }
    const own = n.measures[valueBinding] ?? 0
    let childSum = 0
    for (const child of children.get(id) ?? []) {
      childSum += getNodeValue(child.id)
    }
    const v = Math.max(LINK_MIN, own + childSum)
    memo.set(id, v)
    return v
  }
  const links = rawNodes
    .filter(n => n.parentId)
    .map(n => ({ source: n.parentId!, target: n.id, value: getNodeValue(n.id) }))
  return { nodes, links }
}

// ─── Flat Charts (measure + sort) ─────────────────────────────────────────────

const pieSchema: ChartSchema = {
  kind: 'pie',
  label: 'Pie Chart',
  dataShape: 'flat',
  config: flatConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
    ],
  },
  toChart: (rows) => rows.map((r: FlatRow) => ({ id: r.id, label: r.label, value: r.value, valueOriginal: r.measures?.value ?? r.value, value2Original: r.measures?.value2 ?? r.value2 })),
  readValue: (d) => d.value.value,
  writeValue: (d, v) => { d.value.value = v },
  idOf: (d) => d.id,
}

const lineSchema: ChartSchema = {
  kind: 'line',
  label: 'Line Chart',
  dataShape: 'flat',
  config: flatConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
    ],
  },
  toChart: (rows) => rows.map((r: FlatRow) => ({ id: r.id, date: r.date ?? new Date(r.label), value: r.value, valueOriginal: r.measures?.value ?? r.value, value2Original: r.measures?.value2 ?? r.value2 })),
  readValue: (d) => d.value,
  writeValue: (d, v) => { d.value = v },
  idOf: (d) => d.id,
}

const areaSchema: ChartSchema = {
  kind: 'area',
  label: 'Area Chart',
  dataShape: 'flat',
  config: flatConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
    ],
  },
  toChart: (rows) => rows.map((r: FlatRow) => ({ id: r.id, date: r.date ?? new Date(r.label), value: r.value, valueOriginal: r.measures?.value ?? r.value, value2Original: r.measures?.value2 ?? r.value2 })),
  readValue: (d) => d.value,
  writeValue: (d, v) => { d.value = v },
  idOf: (d) => d.id,
}

const radarSchema: ChartSchema = {
  kind: 'radar',
  label: 'Radar Chart',
  dataShape: 'flat',
  config: flatConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
    ],
  },
  flattenHierarchical: true,
  toChart: (rows) => rows.map((r: FlatRow) => ({ id: r.id, name: r.label, value: r.value, valueOriginal: r.measures?.value ?? r.value, value2Original: r.measures?.value2 ?? r.value2 })),
  readValue: (d) => d.value,
  writeValue: (d, v) => { d.value = v },
  idOf: (d) => d.id,
}

const concentricArcSchema: ChartSchema = {
  kind: 'concentric-arc',
  label: 'Concentric Arc',
  dataShape: 'flat',
  config: flatConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
    ],
  },
  toChart: (rows) => rows.map((r: FlatRow, i: number) => ({ id: r.id, label: r.label, color: r.color ?? palette[i % 6]!, value: Math.min(100, r.value), valueOriginal: r.measures?.value ?? r.value, value2Original: r.measures?.value2 ?? r.value2 })),
  readValue: (d) => d.value,
  writeValue: (d, v) => { d.value = Math.min(100, v) },
  idOf: (d) => d.id,
  mountProps: (ctx) => (el) => {
    if (ctx.tile.maxItems != null) el.maxRings = ctx.tile.maxItems
  },
}

// ─── Flat Charts with Orientation ─────────────────────────────────────────────

function barMountProps(defaults: { orientation: 'horizontal' | 'vertical'; colorMode: string; labelMode: string; valueMode: string }) {
  return (ctx: MountContext) => (el: any) => {
    const orientation = ctx.tile.orientation ?? defaults.orientation
    el.orientation = orientation
    el.colorMode = ctx.tile.colorMode ?? defaults.colorMode
    el.labelMode = ctx.tile.labelMode ?? defaults.labelMode
    el.valueMode = ctx.tile.valueMode ?? defaults.valueMode
    el.minBandSize = ctx.tile.minBandSize ?? 0
    if (ctx.tile.maxItems != null) {
      const prop = orientation === 'horizontal' ? 'maxBands' : 'maxBars'
      el[prop] = ctx.tile.maxItems
    }
  }
}

const barSchema: ChartSchema = {
  kind: 'bar',
  label: 'Bar Chart',
  dataShape: 'flat',
  config: flatWithOrientationConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
      { type: 'orientation', label: 'Orientation', path: 'orientation' },
    ],
  },
  toChart: (rows) => rows.map((r: FlatRow) => ({ id: r.id, label: r.label, value: r.value, valueOriginal: r.measures?.value ?? r.value, value2Original: r.measures?.value2 ?? r.value2 })),
  readValue: (d) => d.value,
  writeValue: (d, v) => { d.value = v },
  idOf: (d) => d.id,
  mountProps: barMountProps({ orientation: 'vertical', colorMode: 'palette', labelMode: 'axis', valueMode: 'none' }),
}

const bandsSchema: ChartSchema = {
  kind: 'bands',
  label: 'Bands Chart',
  dataShape: 'flat',
  config: flatWithOrientationConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
      { type: 'orientation', label: 'Orientation', path: 'orientation' },
    ],
  },
  toChart: (rows) => rows.map((r: FlatRow) => ({ id: r.id, label: r.label, value: r.value, valueOriginal: r.measures?.value ?? r.value, value2Original: r.measures?.value2 ?? r.value2 })),
  readValue: (d) => d.value,
  writeValue: (d, v) => { d.value = v },
  idOf: (d) => d.id,
  mountProps: barMountProps({ orientation: 'horizontal', colorMode: 'palette', labelMode: 'inside', valueMode: 'inside' }),
}

// ─── Scatter (xKey + yKey) ────────────────────────────────────────────────────

const scatterSchema: ChartSchema = {
  kind: 'scatter',
  label: 'Scatter Plot',
  dataShape: 'flat',
  config: scatterConfigSchema,
  ui: {
    fields: [
      { type: 'xKey', label: 'X Axis', path: 'xBinding' },
      { type: 'yKey', label: 'Y Axis', path: 'yBinding' },
    ],
  },
  toChart: (rows, ctx) => rows.map((r: FlatRow, i: number) => {
    const xKey = ctx.xKey ?? '_index'
    const yKey = ctx.yKey ?? 'y'
    const x = xKey === '_index' ? (r.index ?? i) : (r.measures?.[xKey] ?? 0)
    const y = yKey === '_index' ? (r.index ?? i) : (r.measures?.[yKey] ?? 0)
    return { id: r.id, x, y }
  }),
  readValue: (d) => d.y,
  writeValue: (d, v) => { d.y = v },
  idOf: (d) => d.id,
  reindex: (d, i, ctx) => {
    if (ctx.xKey === '_index') d.x = i
  },
  mountProps: (ctx) => (el) => {
    const xKey = ctx.xKey ?? '_index'
    el.xKey = xKey
    const arr = el.dataCell?.peek() as { id: string; x: number; y: number }[] | undefined
    if (arr) {
      for (let i = 0; i < arr.length; i++) {
        const d = arr[i]
        const node = ctx.nodeById.get(d.id)
        if (node) {
          d.x = xKey === '_index' ? i : (node.measures[ctx.yKey ?? 'y'] ?? 0)
        }
      }
    }
  },
}

// ─── Hierarchical Charts ──────────────────────────────────────────────────────

/** mountProps shared by all hierarchical charts. Wires the new config fields
 *  (colorMode, dragBehavior, conservationMode) from the tile config through to
 *  the chart element's bi-adapter setters, so the config UI / hotbook tile
 *  config drives the chart. Fields absent on the tile are left at the chart's
 *  default (no override). */
function hierMountProps(ctx: MountContext): (el: any) => void {
  return (el) => {
    const t = ctx.tile as {
      colorMode?: 'flat' | 'depth' | 'mono'
      dragBehavior?: 'none' | 'resize' | 'reorder'
      conservationMode?: 'additive' | 'proportional-neighbor' | 'proportional-siblings'
      exitFade?: boolean
    }
    if (t.colorMode != null) el.colorMode = t.colorMode
    if (t.dragBehavior != null) el.dragBehavior = t.dragBehavior
    if (t.conservationMode != null) el.conservationMode = t.conservationMode
    if (t.exitFade != null) el.exitFade = t.exitFade
  }
}

const packSchema: ChartSchema = {
  kind: 'pack',
  label: 'Circle Pack',
  dataShape: 'hierarchical',
  config: hierConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
      { type: 'depth', label: 'Depth', path: 'depth' },
      { type: 'toggle', label: 'Breadcrumb', path: 'showBreadcrumb' },
    ],
  },
  capabilities: {
    drillKey: 'default',
    showBreadcrumb: true,
  },
  toChart: (root) => root,
  mountProps: hierMountProps,
}

const treemapSchema: ChartSchema = {
  kind: 'treemap',
  label: 'Treemap',
  dataShape: 'hierarchical',
  config: hierConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
      { type: 'depth', label: 'Depth', path: 'depth' },
      { type: 'toggle', label: 'Root', path: 'showRoot' },
      { type: 'toggle', label: 'Breadcrumb', path: 'showBreadcrumb' },
    ],
  },
  capabilities: {
    drillKey: 'default',
    showBreadcrumb: true,
  },
  toChart: (root) => root,
  mountProps: hierMountProps,
}

const treetableSchema: ChartSchema = {
  kind: 'treetable',
  label: 'Tree Table',
  dataShape: 'hierarchical',
  config: hierConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
      { type: 'depth', label: 'Depth', path: 'depth' },
      { type: 'toggle', label: 'Root', path: 'showRoot' },
      { type: 'toggle', label: 'Breadcrumb', path: 'showBreadcrumb' },
    ],
  },
  capabilities: {
    drillKey: 'default',
    showBreadcrumb: true,
  },
  toChart: (root) => root,
  mountProps: hierMountProps,
}

const sunburstSchema: ChartSchema = {
  kind: 'sunburst',
  label: 'Sunburst',
  dataShape: 'hierarchical',
  config: hierConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
      { type: 'depth', label: 'Depth', path: 'depth' },
      { type: 'toggle', label: 'Root', path: 'showRoot' },
      { type: 'toggle', label: 'Breadcrumb', path: 'showBreadcrumb' },
    ],
  },
  capabilities: {
    drillKey: 'default',
    showBreadcrumb: true,
  },
  toChart: (root) => root,
  mountProps: hierMountProps,
}

// ─── Hierarchical with Orientation ────────────────────────────────────────────

const icicleSchema: ChartSchema = {
  kind: 'icicle',
  label: 'Icicle',
  dataShape: 'hierarchical',
  config: hierWithOrientationConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
      { type: 'depth', label: 'Depth', path: 'depth' },
      { type: 'toggle', label: 'Root', path: 'showRoot' },
      { type: 'toggle', label: 'Breadcrumb', path: 'showBreadcrumb' },
      { type: 'orientation', label: 'Orientation', path: 'orientation' },
    ],
  },
  capabilities: {
    drillKey: 'default',
    showBreadcrumb: true,
  },
  toChart: (root) => root,
  mountProps: hierMountProps,
}

const treeSchema: ChartSchema = {
  kind: 'tree',
  label: 'Tree',
  dataShape: 'hierarchical',
  config: hierWithOrientationConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
      { type: 'depth', label: 'Depth', path: 'depth' },
      { type: 'toggle', label: 'Root', path: 'showRoot' },
      { type: 'toggle', label: 'Breadcrumb', path: 'showBreadcrumb' },
      { type: 'orientation', label: 'Orientation', path: 'orientation' },
    ],
  },
  capabilities: {
    drillKey: 'default',
    showBreadcrumb: true,
  },
  toChart: (root) => root,
  mountProps: hierMountProps,
}

// ─── Graph Charts ─────────────────────────────────────────────────────────────

const sankeySchema: ChartSchema = {
  kind: 'sankey',
  label: 'Sankey',
  dataShape: 'graph',
  config: graphConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
    ],
  },
  capabilities: {
    scrollBody: true,
  },
  mount: 'externalData',
  toChart: (_rows, ctx) => {
    const valueBinding = ctx.valueBinding ?? 'value'
    return buildSankeyData(ctx.edges ?? [], ctx.rawNodes ?? [], valueBinding)
  },
  mountProps: (ctx) => (el) => {
    const valueBinding = ctx.valueBinding ?? 'value'
    const orderBinding = ctx.orderBinding ?? 'index'
    const sortBy: 'index' | 'value' = (orderBinding === 'value' || orderBinding === '_value' || orderBinding === valueBinding) ? 'value' : 'index'
    el.sortBy = sortBy
  },
}

// ─── Simple Charts (gauges, gantt) ────────────────────────────────────────────

const gaugeSchema: ChartSchema = {
  kind: 'gauge',
  label: 'Gauge',
  dataShape: 'flat',
  config: simpleConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
    ],
  },
  mount: 'externalData',
  toChart: (rows, ctx) => {
    const value = rows.reduce((a: number, b: FlatRow) => a + (b.value ?? 0), 0)
    const label = ctx.tile?.title ?? ctx.valueBinding ?? 'value'
    return { value, min: 0, max: 100, label }
  },
}

const gaugeSegmentedSchema: ChartSchema = {
  kind: 'gauge-segmented',
  label: 'Gauge (segmented)',
  dataShape: 'flat',
  config: simpleConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
    ],
  },
  mount: 'externalData',
  toChart: (rows, ctx) => {
    const value = rows.reduce((a: number, b: FlatRow) => a + (b.value ?? 0), 0)
    const label = ctx.tile?.title ?? ctx.valueBinding ?? 'value'
    return { value, min: 0, max: 100, label, segments: 24 }
  },
}

const ganttSchema: ChartSchema = {
  kind: 'gantt',
  label: 'Gantt',
  dataShape: 'flat',
  config: simpleConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
    ],
  },
  mount: 'externalData',
  toChart: (rows, ctx) => {
    const valueBinding = ctx.valueBinding ?? 'value'
    return rows.map((n: FlatRow, i: number) => {
      const explicitStart = (n as any).start as Date | undefined
      const explicitEnd = (n as any).end as Date | undefined
      const duration = explicitStart && explicitEnd
        ? Math.max(1, Math.round((explicitEnd.getTime() - explicitStart.getTime()) / DAY_MS))
        : Math.max(1, Math.round((n.measures?.[valueBinding] ?? n.value ?? 0) / 10))
      const start = explicitStart ?? new Date(SERIES_START + i * 7 * DAY_MS)
      const end = explicitEnd ?? new Date(SERIES_START + (i * 7 + duration) * DAY_MS)
      return {
        id: n.id,
        label: n.label,
        start,
        end,
        color: n.color,
        deps: (n as any).deps as string[] | undefined,
      }
    })
  },
}

// ─── Register All Charts ──────────────────────────────────────────────────────

export function registerAllChartSchemas(): void {
  registerChart(pieSchema)
  registerChart(lineSchema)
  registerChart(areaSchema)
  registerChart(radarSchema)
  registerChart(concentricArcSchema)
  registerChart(barSchema)
  registerChart(bandsSchema)
  registerChart(scatterSchema)
  registerChart(packSchema)
  registerChart(treemapSchema)
  registerChart(treetableSchema)
  registerChart(sunburstSchema)
  registerChart(icicleSchema)
  registerChart(treeSchema)
  registerChart(sankeySchema)
  registerChart(gaugeSchema)
  registerChart(gaugeSegmentedSchema)
  registerChart(ganttSchema)
}

// Auto-register on import
registerAllChartSchemas()
