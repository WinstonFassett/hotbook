/**
 * tile-sources.ts — pure TileSource builders, no React.
 * Extracted from BrLcCharts.tsx. Called by DockView when mounting/updating panels.
 * All per-chart data mapping and mount props are now owned by the chart schema.
 */

import type { Num, Writable } from 'bireactive'
import type { VizNode, Tile, Dataset } from './persistence'
import { makeFlatSource, makeHierSource, makeHierRootFlatSource, hierShapeKey, hierValueKey } from './viz/br/bindTile'
import type { TileSource } from './viz/br/bindTile'
import { hudStore } from './store'
import { applyGroupBy } from './persistence'
import { colorFor, leavesOf, getChartSchema } from '@hotbook/core'
import type { DataShape, FlatRow, ChartContext, MountContext } from '@hotbook/core'

import {
  MdBarChartLC,
  MdLineChartLC,
  MdAreaChartLC,
  MdScatterChartLC,
  MdPieChartLC,
  MdRadarChartLC,
  MdConcentricArcLC,
  MdGaugeLC,
  MdGaugeSegmentedLC,
  MdPack,
  MdTreemapLC,
  MdTreetableLC,
  MdIcicleLC,
  MdSunburstLC,
  MdSankeySimple,
  MdTreeChart,
  MdGanttChartLC,
} from '@hotbook/bireactive'

// Register custom elements once and build kind→tag mapping
const TAGS = [
  ['v-br-bar',            MdBarChartLC],
  ['v-br-line',           MdLineChartLC],
  ['v-br-area',           MdAreaChartLC],
  ['v-br-scatter',        MdScatterChartLC],
  ['v-br-pie',            MdPieChartLC],
  ['v-br-radar',          MdRadarChartLC],
  ['v-br-concentric-arc', MdConcentricArcLC],
  ['v-br-gauge',           MdGaugeLC],
  ['v-br-gauge-segmented', MdGaugeSegmentedLC],
  ['v-br-pack',           MdPack],
  ['v-br-treemap',        MdTreemapLC],
  ['v-br-treetable',      MdTreetableLC],
  ['v-br-icicle',         MdIcicleLC],
  ['v-br-sunburst',       MdSunburstLC],
  ['v-br-sankey',         MdSankeySimple],
  ['v-br-tree',           MdTreeChart],
  ['v-br-gantt',          MdGanttChartLC],
] as const

for (const [tag, cls] of TAGS) {
  if (!customElements.get(tag)) customElements.define(tag, cls as CustomElementConstructor)
}

// Map chart kind to custom element tag (derived from TAGS array)
const KIND_TO_TAG: Record<string, string> = {
  'bar': 'v-br-bar',
  'bands': 'v-br-bar',
  'line': 'v-br-line',
  'area': 'v-br-area',
  'scatter': 'v-br-scatter',
  'pie': 'v-br-pie',
  'radar': 'v-br-radar',
  'concentric-arc': 'v-br-concentric-arc',
  'gauge': 'v-br-gauge',
  'gauge-segmented': 'v-br-gauge-segmented',
  'pack': 'v-br-pack',
  'treemap': 'v-br-treemap',
  'treetable': 'v-br-treetable',
  'icicle': 'v-br-icicle',
  'sunburst': 'v-br-sunburst',
  'sankey': 'v-br-sankey',
  'tree': 'v-br-tree',
  'gantt': 'v-br-gantt',
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function leavesOfNodes(nodes: VizNode[]): VizNode[] {
  return leavesOf(nodes)
}

function rootsOfNodes(nodes: VizNode[]): VizNode[] {
  return nodes.filter(n => !n.parentId)
}

/** Sum of a measure across all descendant leaves of a root — used ONLY to
 *  order roots for sortBy:'value' display. */
function sumMeasureToRoot(nodes: VizNode[], rootId: string, measureKey: string): number {
  let sum = 0
  const queue = nodes.filter(n => n.parentId === rootId)
  while (queue.length) {
    const cur = queue.shift()!
    sum += cur.measures[measureKey] ?? 0
    for (const n of nodes) if (n.parentId === cur.id) queue.push(n)
  }
  return sum
}

function colorByGroup(nodes: VizNode[]): VizNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const nearestColor = (n: VizNode): string => {
    let cur = n
    while (true) {
      if (cur.color) return cur.color
      if (!cur.parentId || !byId.has(cur.parentId)) return colorFor(cur.name)
      cur = byId.get(cur.parentId)!
    }
  }
  return nodes.map(n => ({ ...n, color: n.color ?? nearestColor(n) }))
}

// ─── Axis binding helpers (WIN-144 tile spec gap) ─────────────────────────────

export function resolveTileBindings(tile: Tile, defaultValueBinding: string) {
  const valueBinding = tile.valueBinding ?? tile.measureKey ?? defaultValueBinding
  const xBinding = tile.xBinding ?? tile.xKey
  const yBinding = tile.yBinding ?? tile.yKey
  const orderBinding = tile.orderBinding ?? tile.sortBy ?? 'index'
  const orderDir = tile.orderDir ?? (orderBinding === 'value' ? 'desc' : 'asc')
  return { valueBinding, xBinding, yBinding, orderBinding, orderDir }
}

function sortNodes(nodes: VizNode[], orderBinding: string, valueBinding: string, orderDir: 'asc' | 'desc'): VizNode[] {
  const sorted = [...nodes]
  if (orderBinding === 'index' || orderBinding === '_index') {
    sorted.sort((a, b) => a.index - b.index)
  } else {
    const key = orderBinding === 'value' || orderBinding === '_value' ? valueBinding : orderBinding
    sorted.sort((a, b) => (a.measures[key] ?? 0) - (b.measures[key] ?? 0))
  }
  if (orderDir === 'desc') sorted.reverse()
  return sorted
}

const SERIES_START = new Date(2026, 0, 1).getTime()
const DAY_MS = 86400 * 1000

// ─── Context passed from DockView per render ──────────────────────────────────

export interface TileRenderContext {
  tile: Tile
  ds: Dataset
  measureKey: string
  drillNodeId: string | null
  onUpdate: (rowId: string, measures: VizNode['measures']) => void
  onUpdateMany: (updates: Array<{ id: string; measures: VizNode['measures'] }>) => void
  onNodeReorder: (orderedIds: string[]) => void
}

// ─── Build a FlatRow from a VizNode leaf ──────────────────────────────────────

function buildFlatRow(n: VizNode, i: number, primaryValue: string, kind: string): FlatRow {
  return {
    id: n.id,
    label: n.name,
    value: n.measures[primaryValue] ?? 0,
    value2: n.measures.value2 ?? 0,
    color: n.color,
    index: i,
    date: kind === 'line' || kind === 'area' ? new Date(SERIES_START + i * DAY_MS) : undefined,
    measures: n.measures,
  }
}

// ─── Main factory — returns a TileSource for any TileKind ─────────────────────

export function buildTileSource(ctx: TileRenderContext): TileSource | null {
  const { tile, ds, measureKey, drillNodeId, onUpdate, onUpdateMany } = ctx
  const { valueBinding, xBinding, yBinding, orderBinding, orderDir } = resolveTileBindings(tile, measureKey)
  const rawNodes = colorByGroup(tile.groupBy ? applyGroupBy(ds.nodes, tile.groupBy) : ds.nodes)
  const sorted = sortNodes(rawNodes, orderBinding, valueBinding, orderDir)
  const sortedWithIndex = sorted.map((n, i) => ({ ...n, index: i }))
  const depth = tile.depth || undefined
  const drillKey = tile.id
  const { kind } = tile

  const schema = getChartSchema(kind)
  if (!schema) return null

  // ── Flat charts ──────────────────────────────────────────────────────────
  if (schema.dataShape === 'flat') {
    // Radar can render root-level totals from a tree dataset.
    if (schema.flattenHierarchical && ds.shape === 'tree') {
      const roots = rootsOfNodes(rawNodes)
      const sortKey = orderBinding === 'value' || orderBinding === '_value' ? valueBinding : orderBinding
      let displayRoots: VizNode[]
      if (sortKey === 'index' || sortKey === '_index') {
        displayRoots = roots
      } else {
        const sortedRoots = [...roots].sort((a, b) => sumMeasureToRoot(rawNodes, a.id, sortKey) - sumMeasureToRoot(rawNodes, b.id, sortKey))
        displayRoots = orderDir === 'desc' ? sortedRoots.reverse() : sortedRoots
      }
      const ids = displayRoots.map(n => n.id)
      const shapeKey = `v-br-radar|${[...ids].sort().join(',')}|${[...roots].sort((a, b) => a.id < b.id ? -1 : 1).map(n => n.name).join(',')}`
      return makeHierRootFlatSource({
        tag: KIND_TO_TAG[kind] ?? 'v-br-radar',
        nodes: rawNodes, measureKey: valueBinding, shapeKey, ids,
        onUpdate, onUpdateMany,
      })
    }

    const leaves = leavesOfNodes(sorted)
    const xKey = kind === 'scatter' ? (xBinding ?? '_index') : undefined
    const yKey = kind === 'scatter' ? (yBinding ?? valueBinding) : valueBinding
    const primaryValue = kind === 'scatter' ? yKey : valueBinding
    const rows: FlatRow[] = leaves.map((n, i) => buildFlatRow(n, i, primaryValue, kind))
    const ids = rows.map(r => r.id)
    const values = rows.map(r => r.value)

    const chartCtx: ChartContext = {
      valueBinding,
      orderBinding,
      orderDir,
      xKey,
      yKey,
      tile,
    }
    const nodeById = new Map(leaves.map(n => [n.id, n] as const))
    const mountCtx: MountContext = {
      tile,
      leaves,
      nodeById,
      ids,
      valueBinding,
      xKey,
      yKey,
      orderBinding,
      orderDir,
    }

    if (!schema.toChart || !schema.readValue || !schema.writeValue || !schema.idOf) {
      return null
    }

    const shapeKey = `${kind}|${[...ids].sort().join(',')}|${[...rows].sort((a, b) => a.id < b.id ? -1 : 1).map(r => r.label).join(',')}`
    return makeFlatSource({
      tag: KIND_TO_TAG[kind] ?? 'v-br-' + kind,
      ids,
      measureKey: primaryValue,
      values,
      shapeKey,
      build: () => schema.toChart!(rows, chartCtx),
      readValue: schema.readValue,
      writeValue: schema.writeValue,
      idOf: schema.idOf,
      reindex: schema.reindex ? (d, i) => schema.reindex!(d, i, chartCtx) : undefined,
      mountProps: schema.mountProps ? (el) => schema.mountProps!(mountCtx)(el) : undefined,
      nodes: rawNodes,
      onUpdate,
      onUpdateMany,
    })
  }

  // ── Hierarchical charts ──────────────────────────────────────────────────
  if (schema.dataShape === 'hierarchical') {
    const tag = KIND_TO_TAG[kind]
    if (!tag) return null

    const orientationField = schema.ui.fields.find(f => f.type === 'orientation')
    const orientationProp = orientationField
      ? (tile.orientation ?? 'horizontal')
      : undefined
    const sortKey = orderBinding === 'value' || orderBinding === '_value' ? valueBinding : orderBinding
    const hierSortBy: 'index' | 'value' = sortKey === valueBinding && orderDir === 'desc' ? 'value' : 'index'
    const shapeKey = hierShapeKey(tag, sortedWithIndex, valueBinding, depth)
    const valueKey = hierValueKey(sortedWithIndex, valueBinding)
    const enableNumberDrag = tag === 'v-br-treetable'
      ? { selector: '[data-editable-value', pxPerUnit: 4 }
      : undefined

    // Build a mountCtx so schema.mountProps can read tile config fields.
    const leaves = leavesOfNodes(sorted)
    const nodeById = new Map(leaves.map(n => [n.id, n] as const))
    const mountCtx: MountContext = {
      tile,
      leaves,
      nodeById,
      ids: leaves.map(n => n.id),
      valueBinding,
      orderBinding,
      orderDir,
    }
    const schemaMountProps = schema.mountProps ? (el: HTMLElement) => schema.mountProps!(mountCtx)(el) : undefined

    return makeHierSource({
      tag, nodes: sortedWithIndex, measureKey: valueBinding, depth, sortBy: hierSortBy, shapeKey, valueKey,
      drillKey, drillNodeId, showBreadcrumb: true, onUpdate, onUpdateMany,
      enableNumberDrag,
      orientation: orientationProp,
      mountProps: schemaMountProps,
    })
  }

  // Kinds that mount via externalData (schema.mount === 'externalData') return null
  return null
}

// ─── Simple one-shot element mount (gauge, gantt, sankey) ─────────────────────

function buildSimpleCtx(ctx: TileRenderContext) {
  const { tile, ds, measureKey } = ctx
  const { valueBinding, orderBinding, orderDir, xBinding, yBinding } = resolveTileBindings(tile, measureKey)
  const rawNodes = colorByGroup(tile.groupBy ? applyGroupBy(ds.nodes, tile.groupBy) : ds.nodes)
  const leaves = leavesOfNodes(rawNodes)
  const rows: FlatRow[] = leaves.map((n, i) => buildFlatRow(n, i, valueBinding, tile.kind))
  const chartCtx: ChartContext = {
    valueBinding,
    orderBinding,
    orderDir,
    xKey: xBinding,
    yKey: yBinding,
    tile,
    rawNodes,
    edges: ds.edges ?? [],
  }
  const nodeById = new Map(leaves.map(n => [n.id, n] as const))
  const mountCtx: MountContext = {
    tile,
    leaves,
    nodeById,
    ids: rows.map(r => r.id),
    valueBinding,
    xKey: xBinding,
    yKey: yBinding,
    orderBinding,
    orderDir,
  }
  return { rawNodes, leaves, rows, chartCtx, mountCtx, valueBinding }
}

export function buildSimpleMount(ctx: TileRenderContext): ((el: HTMLElement) => void) | null {
  const schema = getChartSchema(ctx.tile.kind)
  if (!schema || schema.mount !== 'externalData' || !schema.toChart) return null
  const { rows, chartCtx, mountCtx } = buildSimpleCtx(ctx)
  const data = schema.toChart(rows, chartCtx)
  const mountProps = schema.mountProps ? schema.mountProps(mountCtx) : undefined
  return (el: any) => {
    el.externalData = data
    mountProps?.(el)
  }
}

/** The custom element tag for a simple-mount tile kind */
export function simpleTag(kind: string): string | null {
  const schema = getChartSchema(kind)
  if (schema?.mount === 'externalData') {
    return KIND_TO_TAG[kind] ?? null
  }
  return null
}

/** A simple data key for simple-mount tiles — used to detect when to remount */
export function simpleDataKey(ctx: TileRenderContext): string {
  const schema = getChartSchema(ctx.tile.kind)
  if (!schema || schema.mount !== 'externalData' || !schema.toChart) return ctx.tile.kind
  const { rows, chartCtx } = buildSimpleCtx(ctx)
  const data = schema.toChart(rows, chartCtx)
  return `${ctx.tile.kind}|${JSON.stringify(data)}`
}

export { hudStore }
