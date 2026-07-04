/**
 * tile-sources.ts — pure TileSource builders, no React.
 * Extracted from BrLcCharts.tsx. Called by DockView when mounting/updating panels.
 */

import type { Num, Writable } from 'bireactive'
import type { PNode, PEdge, Tile, Dataset } from './persistence'
import { makeFlatSource, makeHierSource, hierShapeKey, hierValueKey } from './viz/br/bindTile'
import type { TileSource } from './viz/br/bindTile'
import { hudStore } from './store'
import { applyGroupBy } from './persistence'
import { colorFor } from '@winstonfassett/vizform-core'
import { mountTreetable } from '@winstonfassett/vizform-vanilla-d3'

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
  MdSankeyFlow,
  MdTreeChart,
  MdGanttChartLC,
} from '@winstonfassett/vizform-charts'

// Register custom elements once
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
  ['v-br-sankey-flow',    MdSankeyFlow],
  ['v-br-tree',           MdTreeChart],
  ['v-br-gantt',          MdGanttChartLC],
] as const

for (const [tag, cls] of TAGS) {
  if (!customElements.get(tag)) customElements.define(tag, cls as CustomElementConstructor)
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function leavesOfNodes(nodes: PNode[]): PNode[] {
  return nodes.filter(n => !nodes.some(m => m.parentId === n.id))
}

function colorByGroup(nodes: PNode[]): PNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const nearestColor = (n: PNode): string => {
    let cur = n
    while (true) {
      if (cur.color) return cur.color
      if (!cur.parentId || !byId.has(cur.parentId)) return colorFor(cur.name)
      cur = byId.get(cur.parentId)!
    }
  }
  return nodes.map(n => ({ ...n, color: n.color ?? nearestColor(n) }))
}

const SERIES_START = new Date(2026, 0, 1).getTime()
const DAY_MS = 86400 * 1000

// ─── Context passed from DockView per render ──────────────────────────────────

export interface TileRenderContext {
  tile: Tile
  ds: Dataset
  measureKey: string
  drillNodeId: string | null
  onUpdate: (rowId: string, measures: PNode['measures']) => void
  onUpdateMany: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void
  onNodeReorder: (orderedIds: string[]) => void
}

// ─── Main factory — returns a TileSource for any TileKind ────────────────────

/** Build a TileSource for a tile + dataset snapshot. Returns null for kinds
 *  that cannot use the bindTile flow (gauge, sankey static, etc.) — the
 *  caller must handle those with a separate mount path. */
export function buildTileSource(ctx: TileRenderContext): TileSource | null {
  const { tile, ds, measureKey, drillNodeId, onUpdate, onUpdateMany } = ctx
  const mk = tile.measureKey ?? measureKey
  const rawNodes = colorByGroup(tile.groupBy ? applyGroupBy(ds.rows, tile.groupBy) : ds.rows)
  const sortBy = tile.sortBy ?? 'index'
  const depth = tile.depth || undefined

  const sorted = sortBy === 'value'
    ? [...rawNodes].sort((a, b) => (b.measures[mk] ?? 0) - (a.measures[mk] ?? 0))
    : rawNodes

  const sortedWithIndex = sortBy === 'value'
    ? sorted.map((n, i) => ({ ...n, index: i }))
    : rawNodes

  const drillKey = tile.id

  const { kind } = tile

  // ── Flat charts ──────────────────────────────────────────────────────────
  if (kind === 'br-lc-bar' || kind === 'br-lc-bands') {
    const orientation = tile.orientation ?? (kind === 'br-lc-bar' ? 'vertical' : 'horizontal')
    const colorMode = kind === 'br-lc-bands' ? 'palette' : (tile.colorMode ?? 'single')
    const labelMode = kind === 'br-lc-bands' ? 'inside' : (tile.labelMode ?? 'axis')
    const valueMode = kind === 'br-lc-bands' ? 'inside' : (tile.valueMode ?? 'none')
    const minBandSize = tile.minBandSize ?? 0
    const maxItems = tile.maxItems
    const leaves = leavesOfNodes(sorted)
    const ids = leaves.map(n => n.id)
    // shapeKey excludes orientation + mk — those now flow through applyData
    // (sets reactive _orientationCell + _measureKeyCell) so the chart morphs
    // instead of remounting (WIN-144 wave 2).
    const displayKey = `${colorMode}|${labelMode}|${valueMode}|${minBandSize}|${maxItems ?? 0}`
    const maxProp = orientation === 'horizontal' ? 'maxBands' : 'maxBars'
    const shapeKey = `${displayKey}|${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`
    return makeFlatSource<{ id: string; label: string; value: number }>({
      tag: 'v-br-bar', ids, measureKey: mk,
      values: leaves.map(n => n.measures[mk] ?? 0),
      shapeKey,
      build: () => leaves.map(n => ({ id: n.id, label: n.name, value: n.measures[mk] ?? 1 })),
      mountProps: (el: any) => {
        el.orientation = orientation; el.colorMode = colorMode
        el.labelMode = labelMode; el.valueMode = valueMode
        el.minBandSize = minBandSize
        if (maxItems !== undefined) el[maxProp] = maxItems
      },
      readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
      nodes: rawNodes, onUpdate,
    })
  }

  if (kind === 'br-lc-pie') {
    const leaves = leavesOfNodes(sorted)
    const ids = leaves.map(n => n.id)
    // shapeKey excludes mk — measure changes flow through applyData (sets
    // reactive measureKey cell) so the chart animates instead of remounting.
    const shapeKey = `${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`
    return makeFlatSource<{ id: string; label: string; value: Writable<Num> }>({
      tag: 'v-br-pie', ids, measureKey: mk,
      values: leaves.map(n => n.measures[mk] ?? 0),
      shapeKey,
      build: () => leaves.map(n => ({ id: n.id, label: n.name, value: n.measures[mk] ?? 1 })) as never,
      readValue: d => d.value.value, writeValue: (d, v) => { d.value.value = v }, idOf: d => d.id,
      nodes: rawNodes, onUpdate, onUpdateMany,
    })
  }

  if (kind === 'br-lc-radar') {
    const leaves = leavesOfNodes(sorted)
    const ids = leaves.map(n => n.id)
    // shapeKey excludes mk — measure changes flow through applyData (sets
    // reactive measureKey cell) so the chart animates instead of remounting.
    const shapeKey = `${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`
    return makeFlatSource<{ id: string; name: string; value: number }>({
      tag: 'v-br-radar', ids, measureKey: mk,
      values: leaves.map(n => n.measures[mk] ?? 0),
      shapeKey,
      build: () => leaves.map(n => ({ id: n.id, name: n.name, value: n.measures[mk] ?? 1 })),
      readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
      nodes: rawNodes, onUpdate,
    })
  }

  if (kind === 'br-lc-concentric-arc') {
    const leaves = leavesOfNodes(sorted)
    const ids = leaves.map(n => n.id)
    const maxItems = tile.maxItems
    const palette = ['#e05c5c', '#f0a742', '#4cba6e', '#5b8def', '#b76de0', '#44c4c4']
    // shapeKey excludes mk and maxItems — measure/ring-count changes flow through
    // applyData (sets reactive cells) so the chart animates instead of remounting.
    const shapeKey = `${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`
    return makeFlatSource<{ id: string; label: string; color: string; value: number }>({
      tag: 'v-br-concentric-arc', ids, measureKey: mk,
      values: leaves.map(n => Math.min(100, n.measures[mk] ?? 0)),
      shapeKey,
      build: () => leaves.map((n, i) => ({ id: n.id, label: n.name, color: palette[i % 6]!, value: Math.min(100, n.measures[mk] ?? 0) })),
      mountProps: (el: any) => { if (maxItems !== undefined) el.maxRings = maxItems },
      readValue: d => d.value, writeValue: (d, v) => { d.value = Math.min(100, v) }, idOf: d => d.id,
      nodes: rawNodes, onUpdate,
    })
  }

  if (kind === 'br-lc-scatter') {
    const xKey = tile.xKey ?? '_index'
    const yKey = tile.yKey ?? mk
    const leaves = leavesOfNodes(sorted)
    const ids = leaves.map(n => n.id)
    // shapeKey excludes xKey/yKey — measure/key changes flow through applyData
    // (sets reactive measureKey cell) so the chart animates instead of remounting.
    const shapeKey = `${[...ids].sort().join(',')}`
    return makeFlatSource<{ id: string; x: number; y: number }>({
      tag: 'v-br-scatter', ids, measureKey: yKey,
      values: leaves.map(n => n.measures[yKey] ?? 0),
      shapeKey,
      build: () => leaves.map((n, i) => ({ id: n.id, x: xKey === '_index' ? i : (n.measures[xKey] ?? 0), y: n.measures[yKey] ?? 0 })),
      readValue: d => d.y, writeValue: (d, v) => { d.y = v }, idOf: d => d.id,
      reindex: xKey === '_index' ? (d, k) => { (d as any).x = k } : undefined,
      nodes: rawNodes, onUpdate,
    })
  }

  if (kind === 'br-lc-line') {
    const leaves = leavesOfNodes(sorted)
    const ids = leaves.map(n => n.id)
    // shapeKey excludes mk — measure changes flow through applyData (sets
    // reactive measureKey cell) so the chart animates instead of remounting.
    const shapeKey = `${[...ids].sort().join(',')}`
    return makeFlatSource<{ id: string; date: Date; value: number }>({
      tag: 'v-br-line', ids, measureKey: mk,
      values: leaves.map(n => n.measures[mk] ?? 0),
      shapeKey,
      build: () => leaves.map((n, i) => ({ id: n.id, date: new Date(SERIES_START + i * DAY_MS), value: n.measures[mk] ?? 0 })),
      readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
      reindex: (d, k) => { d.date = new Date(SERIES_START + k * DAY_MS) },
      nodes: rawNodes, onUpdate,
    })
  }

  if (kind === 'br-lc-area') {
    const leaves = leavesOfNodes(sorted)
    const ids = leaves.map(n => n.id)
    // shapeKey excludes mk — measure changes flow through applyData (sets
    // reactive measureKey cell) so the chart animates instead of remounting.
    const shapeKey = `${[...ids].sort().join(',')}`
    return makeFlatSource<{ id: string; date: Date; value: number }>({
      tag: 'v-br-area', ids, measureKey: mk,
      values: leaves.map(n => n.measures[mk] ?? 0),
      shapeKey,
      build: () => leaves.map((n, i) => ({ id: n.id, date: new Date(SERIES_START + i * DAY_MS), value: n.measures[mk] ?? 0 })),
      readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
      reindex: (d, k) => { d.date = new Date(SERIES_START + k * DAY_MS) },
      nodes: rawNodes, onUpdate,
    })
  }

  // ── Hierarchical charts ──────────────────────────────────────────────────
  const hierTags: Record<string, string> = {
    'br-lc-pack': 'v-br-pack',
    'br-lc-treemap': 'v-br-treemap',
    'br-lc-treetable': 'v-br-treetable',
    'br-lc-icicle': 'v-br-icicle',
    'br-lc-sunburst': 'v-br-sunburst',
    'br-lc-tree': 'v-br-tree',
  }
  if (kind in hierTags) {
    const tag = hierTags[kind]!
    const orientationProp = kind === 'br-lc-icicle' ? (tile.orientation ?? 'horizontal') : undefined
    const shapeKey = hierShapeKey(tag, sortedWithIndex, mk, depth, sortBy)
    const valueKey = hierValueKey(sortedWithIndex, mk)
    // Enable numberDrag for treetable
    const enableNumberDrag = kind === 'br-lc-treetable'
      ? { selector: '[data-editable-value', pxPerUnit: 4 }
      : undefined
    const src = makeHierSource({
      tag, nodes: sortedWithIndex, measureKey: mk, depth, sortBy, shapeKey, valueKey,
      drillKey, drillNodeId, showBreadcrumb: true, onUpdate, onUpdateMany,
      enableNumberDrag,
      orientation: orientationProp,
    })
    return src
  }

  // Kinds handled via simpleMount (gauge, sankey, etc.) return null
  return null
}

// ─── Simple one-shot element mount (gauge, sankey) ───────────────────────────

/** Returns a setup function for simple elements that don't use the bindTile
 *  flow. DockView calls this when buildTileSource returns null. */
export function buildSimpleMount(ctx: TileRenderContext): ((el: HTMLElement) => void) | null {
  const { tile, ds, measureKey } = ctx
  const mk = tile.measureKey ?? measureKey
  const rawNodes = colorByGroup(tile.groupBy ? applyGroupBy(ds.rows, tile.groupBy) : ds.rows)
  const leaves = rawNodes.filter(n => !rawNodes.some(m => m.parentId === n.id))
  const { kind } = tile

  if (kind === 'treetable') {
    const mk = tile.measureKey ?? measureKey
    const nodes = colorByGroup(tile.groupBy ? applyGroupBy(ds.rows, tile.groupBy) : ds.rows)
    return (el: HTMLElement) => {
      el.style.cssText = 'width:100%;height:100%;overflow:auto'
      mountTreetable(el, nodes, mk)
    }
  }

  if (kind === 'br-lc-gantt') {
    // br-lc-gantt expects GanttTask[] with start/end dates
    // For now, construct a simple timeline from the data rows
    const tasks = leaves.map((n, i) => ({
      id: n.id,
      label: n.name,
      start: new Date(SERIES_START + i * 7 * DAY_MS),
      end: new Date(SERIES_START + (i * 7 + Math.max(1, Math.round((n.measures[mk] ?? 0) / 10))) * DAY_MS),
      color: n.color,
    }))
    return (el: any) => {
      el.externalData = tasks
    }
  }

  if (kind === 'br-lc-gauge') {
    const value = leaves.reduce((a, b) => a + (b.measures[mk] ?? 0), 0)
    const text = tile.title ?? mk
    const data = { value, min: 0, max: 100, label: text }
    return (el: any) => { el.externalData = data }
  }

  if (kind === 'br-lc-gauge-segmented') {
    const value = leaves.reduce((a, b) => a + (b.measures[mk] ?? 0), 0)
    const text = tile.title ?? mk
    const data = { value, min: 0, max: 100, label: text, segments: 24 }
    return (el: any) => { el.externalData = data }
  }

  if (kind === 'br-lc-sankey') {
    const edges = ds.edges ?? []
    const nodeNames = [...new Set(edges.flatMap(e => [e.source, e.target]))]
    const links = edges.map(e => ({ source: e.source, target: e.target, value: e.value }))
    const data = { nodes: nodeNames, links }
    return (el: any) => { el.externalData = data }
  }

  if (kind === 'br-lc-sankey-flow') {
    return (_el: HTMLElement) => {}
  }

  return null
}

/** The custom element tag for a simple-mount tile kind */
export function simpleTag(kind: string): string | null {
  const map: Record<string, string> = {
    'treetable': 'div',
    'br-lc-gauge': 'v-br-gauge',
    'br-lc-gauge-segmented': 'v-br-gauge-segmented',
    'br-lc-sankey': 'v-br-sankey',
    'br-lc-sankey-flow': 'v-br-sankey-flow',
    'br-lc-gantt': 'v-br-gantt',
  }
  return map[kind] ?? null
}

/** A simple data key for simple-mount tiles — used to detect when to remount */
export function simpleDataKey(ctx: TileRenderContext): string {
  const { tile, ds, measureKey } = ctx
  const mk = tile.measureKey ?? measureKey
  const rawNodes = colorByGroup(tile.groupBy ? applyGroupBy(ds.rows, tile.groupBy) : ds.rows)
  const leaves = rawNodes.filter(n => !rawNodes.some(m => m.parentId === n.id))
  const { kind } = tile
  if (kind === 'treetable') {
    return `treetable|${mk}|${ds.rows.length}`
  }
  if (kind === 'br-lc-gauge' || kind === 'br-lc-gauge-segmented') {
    return `${kind}|${mk}|${leaves.reduce((a, b) => a + (b.measures[mk] ?? 0), 0)}`
  }
  if (kind === 'br-lc-sankey') {
    return `sankey|${JSON.stringify(ds.edges ?? [])}`
  }
  if (kind === 'br-lc-gantt') {
    return `gantt|${mk}|${ds.rows.length}`
  }
  return kind
}

export { hudStore }
