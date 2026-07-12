/**
 * tile-sources.ts — pure TileSource builders, no React.
 * Extracted from BrLcCharts.tsx. Called by DockView when mounting/updating panels.
 */

import type { Num, Writable } from 'bireactive'
import type { VizNode, PEdge, Tile, Dataset } from './persistence'
import { makeFlatSource, makeHierSource, makeHierRootFlatSource, hierShapeKey, hierValueKey } from './viz/br/bindTile'
import type { TileSource } from './viz/br/bindTile'
import { hudStore } from './store'
import { applyGroupBy } from './persistence'
import { colorFor, leavesOf } from '@hotbook/core'

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
} from '@hotbook/bireactive'

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
  ['v-br-tree',           MdTreeChart],
  ['v-br-gantt',          MdGanttChartLC],
] as const

for (const [tag, cls] of TAGS) {
  if (!customElements.get(tag)) customElements.define(tag, cls as CustomElementConstructor)
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function leavesOfNodes(nodes: VizNode[]): VizNode[] {
  return leavesOf(nodes)
}

function rootsOfNodes(nodes: VizNode[]): VizNode[] {
  return nodes.filter(n => !n.parentId)
}

/** Sum of a measure across all descendant leaves of a root — used ONLY to
 *  order roots for sortBy:'value' display. A root VizNode's own `measures` is
 *  always empty (only leaves carry measures), so sorting roots by their raw
 *  measures would compare 0 against 0. The actual redistributable values
 *  rendered/edited by the chart come from the live BiNode lens tree built
 *  inside makeHierRootFlatSource — this is a plain, disposable sum for order only. */
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

/** Resolve tile bindings, falling back to deprecated aliases. */
export function resolveTileBindings(tile: Tile, defaultValueBinding: string) {
  const valueBinding = tile.valueBinding ?? tile.measureKey ?? defaultValueBinding
  const xBinding = tile.xBinding ?? tile.xKey
  const yBinding = tile.yBinding ?? tile.yKey
  // orderBinding defaults to deprecated sortBy: 'index' | 'value'.
  // 'value' means "sort by the value binding".
  const orderBinding = tile.orderBinding ?? tile.sortBy ?? 'index'
  // Default direction: 'desc' for value-sorted, 'asc' for index or named field.
  const orderDir = tile.orderDir ?? (orderBinding === 'value' ? 'desc' : 'asc')
  return { valueBinding, xBinding, yBinding, orderBinding, orderDir }
}

/** Sort nodes by orderBinding + orderDir. orderBinding can be:
 *  - 'index' or '_index': preserve/reverse input order
 *  - 'value' or '_value': sort by valueBinding
 *  - any measure key: sort by that measure
 */
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

// ─── Main factory — returns a TileSource for any TileKind ────────────────────

/** Build a TileSource for a tile + dataset snapshot. Returns null for kinds
 *  that cannot use the bindTile flow (gauge, sankey static, etc.) — the
 *  caller must handle those with a separate mount path. */
export function buildTileSource(ctx: TileRenderContext): TileSource | null {
  const { tile, ds, measureKey, drillNodeId, onUpdate, onUpdateMany } = ctx
  const { valueBinding, xBinding, yBinding, orderBinding, orderDir } = resolveTileBindings(tile, measureKey)
  const rawNodes = colorByGroup(tile.groupBy ? applyGroupBy(ds.nodes, tile.groupBy) : ds.nodes)
  const sorted = sortNodes(rawNodes, orderBinding, valueBinding, orderDir)
  const sortedWithIndex = sorted.map((n, i) => ({ ...n, index: i }))
  const depth = tile.depth || undefined

  const drillKey = tile.id

  const { kind } = tile

  // ── Flat charts ──────────────────────────────────────────────────────────
  if (kind === 'bar' || kind === 'bands') {
    const orientation = tile.orientation ?? (kind === 'bar' ? 'vertical' : 'horizontal')
    const colorMode = kind === 'bands' ? 'palette' : (tile.colorMode ?? 'single')
    const labelMode = kind === 'bands' ? 'inside' : (tile.labelMode ?? 'axis')
    const valueMode = kind === 'bands' ? 'inside' : (tile.valueMode ?? 'none')
    const minBandSize = tile.minBandSize ?? 0
    const maxItems = tile.maxItems
    const leaves = leavesOfNodes(sorted)
    const ids = leaves.map(n => n.id)
    // shapeKey excludes orientation + valueBinding — those now flow through applyData
    // (sets reactive _orientationCell + _measureKeyCell) so the chart morphs
    // instead of remounting (WIN-144 wave 2).
    const displayKey = `${colorMode}|${labelMode}|${valueMode}|${minBandSize}|${maxItems ?? 0}`
    const maxProp = orientation === 'horizontal' ? 'maxBands' : 'maxBars'
    const shapeKey = `${displayKey}|${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`
    return makeFlatSource<{ id: string; label: string; value: number }>({
      tag: 'v-br-bar', ids, measureKey: valueBinding,
      values: leaves.map(n => n.measures[valueBinding] ?? 0),
      shapeKey,
      build: () => leaves.map(n => ({ id: n.id, label: n.name, value: n.measures[valueBinding] ?? 1 })),
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

  if (kind === 'pie') {
    const leaves = leavesOfNodes(sorted)
    const ids = leaves.map(n => n.id)
    // shapeKey excludes valueBinding — measure changes flow through applyData (sets
    // reactive measureKey cell) so the chart animates instead of remounting.
    const shapeKey = `${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`
    return makeFlatSource<{ id: string; label: string; value: Writable<Num> }>({
      tag: 'v-br-pie', ids, measureKey: valueBinding,
      values: leaves.map(n => n.measures[valueBinding] ?? 0),
      shapeKey,
      build: () => leaves.map(n => ({ id: n.id, label: n.name, value: n.measures[valueBinding] ?? 1 })) as never,
      readValue: d => d.value.value, writeValue: (d, v) => { d.value.value = v }, idOf: d => d.id,
      nodes: rawNodes, onUpdate, onUpdateMany,
    })
  }

  if (kind === 'radar') {
    // For hierarchical datasets, render/edit root-level (top-level category)
    // totals instead of dozens of task-level leaves. Backed by a live BiNode
    // tree (makeHierRootFlatSource) so a root's value is a real Num.lens over
    // its descendants — editing a spoke redistributes proportionally down the
    // tree instead of requiring a manual aggregate-then-writeback loop.
    if (ds.shape === 'tree') {
      const roots = rootsOfNodes(rawNodes)
      // Root VizNodes carry no measure of their own (only leaves do) — sort by
      // each root's aggregate leaf sum, not raw n.measures[valueBinding] (always 0).
      const sortKey = orderBinding === 'value' || orderBinding === '_value' ? valueBinding : orderBinding
      let displayRoots: VizNode[]
      if (sortKey === 'index' || sortKey === '_index') {
        displayRoots = roots
      } else {
        const sorted = [...roots].sort((a, b) => sumMeasureToRoot(rawNodes, a.id, sortKey) - sumMeasureToRoot(rawNodes, b.id, sortKey))
        displayRoots = orderDir === 'desc' ? sorted.reverse() : sorted
      }
      const ids = displayRoots.map(n => n.id)
      // shapeKey excludes valueBinding/sortBy — both flow through applyData (reactive
      // measureKey cell + reordered array) so the chart tweens instead of
      // remounting, matching makeFlatSource/makeHierSource.
      const shapeKey = `v-br-radar|${[...ids].sort().join(',')}|${[...roots].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`
      return makeHierRootFlatSource({
        tag: 'v-br-radar', nodes: rawNodes, measureKey: valueBinding, shapeKey, ids,
        onUpdate, onUpdateMany,
      })
    }

    const leaves = leavesOfNodes(sorted)
    const ids = leaves.map(n => n.id)
    // shapeKey excludes valueBinding — measure changes flow through applyData (sets
    // reactive measureKey cell) so the chart animates instead of remounting.
    const shapeKey = `${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`
    return makeFlatSource<{ id: string; name: string; value: number }>({
      tag: 'v-br-radar', ids, measureKey: valueBinding,
      values: leaves.map(n => n.measures[valueBinding] ?? 0),
      shapeKey,
      build: () => leaves.map(n => ({ id: n.id, name: n.name, value: n.measures[valueBinding] ?? 1 })),
      readValue: d => d.value, writeValue: (d, v) => { d.value = v; onUpdate(d.id, { [valueBinding]: v }) }, idOf: d => d.id,
      nodes: rawNodes, onUpdate,
    })
  }

  if (kind === 'concentric-arc') {
    const leaves = leavesOfNodes(sorted)
    const ids = leaves.map(n => n.id)
    const maxItems = tile.maxItems
    const palette = ['#e05c5c', '#f0a742', '#4cba6e', '#5b8def', '#b76de0', '#44c4c4']
    // shapeKey excludes valueBinding and maxItems — measure/ring-count changes flow through
    // applyData (sets reactive cells) so the chart animates instead of remounting.
    const shapeKey = `${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`
    return makeFlatSource<{ id: string; label: string; color: string; value: number }>({
      tag: 'v-br-concentric-arc', ids, measureKey: valueBinding,
      values: leaves.map(n => Math.min(100, n.measures[valueBinding] ?? 0)),
      shapeKey,
      build: () => leaves.map((n, i) => ({ id: n.id, label: n.name, color: palette[i % 6]!, value: Math.min(100, n.measures[valueBinding] ?? 0) })),
      mountProps: (el: any) => { if (maxItems !== undefined) el.maxRings = maxItems },
      readValue: d => d.value, writeValue: (d, v) => { d.value = Math.min(100, v) }, idOf: d => d.id,
      nodes: rawNodes, onUpdate,
    })
  }

  if (kind === 'scatter') {
    const xKey = xBinding ?? '_index'
    const yKey = yBinding ?? valueBinding
    const leaves = leavesOfNodes(sorted)
    const ids = leaves.map(n => n.id)
    // shapeKey excludes xKey/yKey — measure/key changes flow through applyData
    // (sets reactive measureKey + xKey cells) so the chart animates instead of remounting.
    const shapeKey = `${[...ids].sort().join(',')}`
    const nodeById = new Map(leaves.map(n => [n.id, n] as const))
    return makeFlatSource<{ id: string; x: number; y: number }>({
      tag: 'v-br-scatter', ids, measureKey: yKey,
      values: leaves.map(n => n.measures[yKey] ?? 0),
      shapeKey,
      build: () => leaves.map((n, i) => ({ id: n.id, x: xKey === '_index' ? i : (n.measures[xKey] ?? 0), y: n.measures[yKey] ?? 0 })),
      // Write new x values IN PLACE on existing datum objects. The tween cells
      // capture pt references at scene init; replacing the array with new
      // objects would orphan them. applyData does the same for y values.
      // DON'T trigger dataCell here — applyData's own dataCell.value = newArr
      // at the end is the single reactivity trigger. A premature trigger makes
      // the gate fire before reindex writes new x values, causing a snap.
      mountProps: (el: any) => {
        el.xKey = xKey
        const arr = el.dataCell?.peek() as { id: string; x: number; y: number }[] | undefined
        if (arr) {
          for (let i = 0; i < arr.length; i++) {
            const d = arr[i]!
            const node = nodeById.get(d.id)
            if (node) d.x = xKey === '_index' ? i : (node.measures[xKey] ?? 0)
          }
        }
      },
      readValue: d => d.y, writeValue: (d, v) => { d.y = v }, idOf: d => d.id,
      reindex: xKey === '_index' ? (d, k) => { (d as any).x = k } : undefined,
      nodes: rawNodes, onUpdate,
    })
  }

  if (kind === 'line') {
    const leaves = leavesOfNodes(sorted)
    const ids = leaves.map(n => n.id)
    // shapeKey excludes valueBinding — measure changes flow through applyData (sets
    // reactive measureKey cell) so the chart animates instead of remounting.
    const shapeKey = `${[...ids].sort().join(',')}`
    return makeFlatSource<{ id: string; date: Date; value: number }>({
      tag: 'v-br-line', ids, measureKey: valueBinding,
      values: leaves.map(n => n.measures[valueBinding] ?? 0),
      shapeKey,
      build: () => leaves.map((n, i) => ({ id: n.id, date: new Date(SERIES_START + i * DAY_MS), value: n.measures[valueBinding] ?? 0 })),
      readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
      // No reindex — dates are the x-axis and must stay stable. Sort reorders
      // the array but the line always renders left-to-right by date (tweenedData
      // sorts by date). Reindexing dates would make points jump x positions.
      nodes: rawNodes, onUpdate,
    })
  }

  if (kind === 'area') {
    const leaves = leavesOfNodes(sorted)
    const ids = leaves.map(n => n.id)
    // shapeKey excludes valueBinding — measure changes flow through applyData (sets
    // reactive measureKey cell) so the chart animates instead of remounting.
    const shapeKey = `${[...ids].sort().join(',')}`
    return makeFlatSource<{ id: string; date: Date; value: number }>({
      tag: 'v-br-area', ids, measureKey: valueBinding,
      values: leaves.map(n => n.measures[valueBinding] ?? 0),
      shapeKey,
      build: () => leaves.map((n, i) => ({ id: n.id, date: new Date(SERIES_START + i * DAY_MS), value: n.measures[valueBinding] ?? 0 })),
      readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
      // No reindex — dates are the x-axis and must stay stable (same as line).
      nodes: rawNodes, onUpdate,
    })
  }

  // ── Hierarchical charts ──────────────────────────────────────────────────
  const hierTags: Record<string, string> = {
    'pack': 'v-br-pack',
    'treemap': 'v-br-treemap',
    'treetable': 'v-br-treetable',
    'icicle': 'v-br-icicle',
    'sunburst': 'v-br-sunburst',
    'tree': 'v-br-tree',
    'treetable': 'v-br-treetable',
  }
  if (kind in hierTags) {
    const tag = hierTags[kind]!
    const orientationProp =
      kind === 'icicle' || kind === 'tree'
        ? (tile.orientation ?? 'horizontal')
        : undefined
    const sortKey = orderBinding === 'value' || orderBinding === '_value' ? valueBinding : orderBinding
    // Hierarchical elements can sort by value (desc) internally; otherwise rely on pre-sorted nodes + 'index'.
    const hierSortBy: 'index' | 'value' = sortKey === valueBinding && orderDir === 'desc' ? 'value' : 'index'
    const shapeKey = hierShapeKey(tag, sortedWithIndex, valueBinding, depth)
    const valueKey = hierValueKey(sortedWithIndex, valueBinding)
    // Enable numberDrag for treetable
    const enableNumberDrag = tag === 'v-br-treetable'
      ? { selector: '[data-editable-value', pxPerUnit: 4 }
      : undefined
    const src = makeHierSource({
      tag, nodes: sortedWithIndex, measureKey: valueBinding, depth, sortBy: hierSortBy, shapeKey, valueKey,
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
  const { valueBinding } = resolveTileBindings(tile, measureKey)
  const rawNodes = colorByGroup(tile.groupBy ? applyGroupBy(ds.nodes, tile.groupBy) : ds.nodes)
  const leaves = rawNodes.filter(n => !rawNodes.some(m => m.parentId === n.id))
  const { kind } = tile

  if (kind === 'gantt') {
    // gantt expects GanttTask[] with start/end dates
    // For now, construct a simple timeline from the data rows
    const tasks = leaves.map((n, i) => ({
      id: n.id,
      label: n.name,
      start: new Date(SERIES_START + i * 7 * DAY_MS),
      end: new Date(SERIES_START + (i * 7 + Math.max(1, Math.round((n.measures[valueBinding] ?? 0) / 10))) * DAY_MS),
      color: n.color,
    }))
    return (el: any) => {
      el.externalData = tasks
    }
  }

  if (kind === 'gauge') {
    const value = leaves.reduce((a, b) => a + (b.measures[valueBinding] ?? 0), 0)
    const text = tile.title ?? valueBinding
    const data = { value, min: 0, max: 100, label: text }
    return (el: any) => { el.externalData = data }
  }

  if (kind === 'gauge-segmented') {
    const value = leaves.reduce((a, b) => a + (b.measures[valueBinding] ?? 0), 0)
    const text = tile.title ?? valueBinding
    const data = { value, min: 0, max: 100, label: text, segments: 24 }
    return (el: any) => { el.externalData = data }
  }

  if (kind === 'sankey') {
    const edges = ds.edges ?? []
    const nodeNames = [...new Set(edges.flatMap(e => [e.source, e.target]))]
    const links = edges.map(e => ({ source: e.source, target: e.target, value: e.value }))
    const data = { nodes: nodeNames, links }
    return (el: any) => { el.externalData = data }
  }

  return null
}

/** The custom element tag for a simple-mount tile kind */
export function simpleTag(kind: string): string | null {
  const map: Record<string, string> = {
    'gauge': 'v-br-gauge',
    'gauge-segmented': 'v-br-gauge-segmented',
    'sankey': 'v-br-sankey',
    'gantt': 'v-br-gantt',
  }
  return map[kind] ?? null
}

/** A simple data key for simple-mount tiles — used to detect when to remount */
export function simpleDataKey(ctx: TileRenderContext): string {
  const { tile, ds, measureKey } = ctx
  const { valueBinding } = resolveTileBindings(tile, measureKey)
  const rawNodes = colorByGroup(tile.groupBy ? applyGroupBy(ds.nodes, tile.groupBy) : ds.nodes)
  const leaves = rawNodes.filter(n => !rawNodes.some(m => m.parentId === n.id))
  const { kind } = tile
  if (kind === 'gauge' || kind === 'gauge-segmented') {
    return `${kind}|${valueBinding}|${leaves.reduce((a, b) => a + (b.measures[valueBinding] ?? 0), 0)}`
  }
  if (kind === 'sankey') {
    return `sankey|${JSON.stringify(ds.edges ?? [])}`
  }
  if (kind === 'gantt') {
    return `gantt|${valueBinding}|${ds.nodes.length}`
  }
  return kind
}

export { hudStore }
