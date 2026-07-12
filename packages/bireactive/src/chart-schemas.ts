/**
 * Chart schema registry — each chart declares its config shape and UI pickers.
 * Import this file to populate the schema registry.
 */

import * as v from 'valibot'
import {
  registerChart,
  type ChartSchema,
  measureSchema,
  sortSchema,
  orientationSchema,
  depthSchema,
  xKeySchema,
  yKeySchema,
} from '@hotbook/core'

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
  orderBinding: v.optional(sortSchema),
  orderDir: v.optional(v.union([v.literal('asc'), v.literal('desc')])),
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
}

const lineSchema: ChartSchema = {
  kind: 'line',
  label: 'Line Chart',
  dataShape: 'flat',
  config: flatConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
    ],
  },
}

const areaSchema: ChartSchema = {
  kind: 'area',
  label: 'Area Chart',
  dataShape: 'flat',
  config: flatConfigSchema,
  ui: {
    fields: [
      { type: 'measure', label: 'Measure', path: 'valueBinding' },
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
    ],
  },
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
}

// ─── Flat Charts with Orientation ─────────────────────────────────────────────

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
}

// ─── Scatter (xKey + yKey) ────────────────────────────────────────────────────

const scatterSchema: ChartSchema = {
  kind: 'scatter',
  label: 'Scatter Plot',
  dataShape: 'flat',
  config: scatterConfigSchema,
  ui: {
    fields: [
      { type: 'sort', label: 'Sort', path: 'orderBinding' },
      { type: 'xKey', label: 'X Axis', path: 'xBinding' },
      { type: 'yKey', label: 'Y Axis', path: 'yBinding' },
    ],
  },
}

// ─── Hierarchical Charts ──────────────────────────────────────────────────────

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
    ],
  },
  capabilities: {
    drillKey: 'default',
    showBreadcrumb: true,
  },
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
    ],
  },
  capabilities: {
    drillKey: 'default',
    showBreadcrumb: true,
  },
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
    ],
  },
  capabilities: {
    drillKey: 'default',
    showBreadcrumb: true,
  },
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
    ],
  },
  capabilities: {
    drillKey: 'default',
    showBreadcrumb: true,
  },
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
      { type: 'orientation', label: 'Orientation', path: 'orientation' },
    ],
  },
  capabilities: {
    drillKey: 'default',
    showBreadcrumb: true,
  },
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
      { type: 'orientation', label: 'Orientation', path: 'orientation' },
    ],
  },
  capabilities: {
    drillKey: 'default',
    showBreadcrumb: true,
  },
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
}

// Auto-register on import
registerAllChartSchemas()
