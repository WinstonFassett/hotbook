/**
 * flat-shapes.ts — TileSource builders for flat-array BR-LC charts.
 *
 * Each export wraps makeFlatSource with chart-specific shapeKey and build/accessor logic.
 * The host (BrLcCharts.tsx) just calls one of these and passes the result to <BrLcTile>.
 */

import type { Writable } from 'bireactive'
import type { Num } from 'bireactive'
import type { VizNode } from '../../../persistence'
import { makeFlatSource } from '../bindTile'
import type { TileSource } from '../bindTile'

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function leavesOfNodes(nodes: VizNode[]): VizNode[] {
  return nodes.filter(n => !nodes.some(m => m.parentId === n.id))
}

function leafIds(leaves: VizNode[]): string[] {
  return leaves.map(n => n.id)
}

function nameSortKey(leaves: VizNode[]): string {
  return [...leaves].sort((a, b) => a.id < b.id ? -1 : 1).map(n => n.name).join(',')
}

function sortedIds(leaves: VizNode[]): string {
  return [...leafIds(leaves)].sort().join(',')
}

// ─── Bar ──────────────────────────────────────────────────────────────────────

export interface BarSourceSpec {
  nodes: VizNode[]
  measureKey: string
  maxItems?: number
  orientation?: 'vertical' | 'horizontal'
  colorMode?: 'single' | 'palette'
  labelMode?: 'axis' | 'inside' | 'both'
  valueMode?: 'inside' | 'outside' | 'none'
  minBandSize?: number
  onUpdate?: (nodeId: string, measures: VizNode['measures']) => void
}

export function makeBarSource({
  nodes, measureKey, maxItems,
  orientation = 'vertical', colorMode = 'single', labelMode = 'axis',
  valueMode = 'none', minBandSize = 0, onUpdate,
}: BarSourceSpec): TileSource {
  const leaves = leavesOfNodes(nodes)
  const ids = leafIds(leaves)
  const displayKey = `${orientation}|${colorMode}|${labelMode}|${valueMode}|${minBandSize}|${maxItems ?? 0}`
  const maxProp = orientation === 'horizontal' ? 'maxBands' : 'maxBars'
  const shapeKey = `${displayKey}|${measureKey}|${sortedIds(leaves)}|${nameSortKey(leaves)}`
  return makeFlatSource<{ id: string; label: string; value: number }>({
    tag: 'v-br-bar', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey,
    build: () => leaves.map(n => ({ id: n.id, label: n.name, value: n.measures[measureKey] ?? 1 })),
    mountProps: (el: any) => {
      el.orientation = orientation; el.colorMode = colorMode
      el.labelMode = labelMode; el.valueMode = valueMode
      el.minBandSize = minBandSize
      if (maxItems !== undefined) el[maxProp] = maxItems
    },
    readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
    nodes, onUpdate,
  })
}

// ─── Pie ──────────────────────────────────────────────────────────────────────

export interface PieSourceSpec {
  nodes: VizNode[]
  measureKey: string
  onUpdate?: (nodeId: string, measures: VizNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: VizNode['measures'] }>) => void
}

export function makePieSource({ nodes, measureKey, onUpdate, onUpdateMany }: PieSourceSpec): TileSource {
  const leaves = leavesOfNodes(nodes)
  const ids = leafIds(leaves)
  const shapeKey = `${measureKey}|${sortedIds(leaves)}|${nameSortKey(leaves)}`
  return makeFlatSource<{ id: string; label: string; value: Writable<Num> }>({
    tag: 'v-br-pie', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey,
    build: () => leaves.map(n => ({ id: n.id, label: n.name, value: n.measures[measureKey] ?? 1 })) as never,
    readValue: d => d.value.value, writeValue: (d, v) => { d.value.value = v }, idOf: d => d.id,
    nodes, onUpdate, onUpdateMany,
  })
}

// ─── Radar ────────────────────────────────────────────────────────────────────

export interface RadarSourceSpec {
  nodes: VizNode[]
  measureKey: string
  onUpdate?: (nodeId: string, measures: VizNode['measures']) => void
}

export function makeRadarSource({ nodes, measureKey, onUpdate }: RadarSourceSpec): TileSource {
  const leaves = leavesOfNodes(nodes)
  const ids = leafIds(leaves)
  const shapeKey = `${measureKey}|${sortedIds(leaves)}|${nameSortKey(leaves)}`
  return makeFlatSource<{ id: string; name: string; value: number }>({
    tag: 'v-br-radar', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey,
    build: () => leaves.map(n => ({ id: n.id, name: n.name, value: n.measures[measureKey] ?? 1 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
    nodes, onUpdate,
  })
}

// ─── ConcentricArc ────────────────────────────────────────────────────────────

export interface ConcentricArcSourceSpec {
  nodes: VizNode[]
  measureKey: string
  maxItems?: number
  onUpdate?: (nodeId: string, measures: VizNode['measures']) => void
}

const CONCENTRIC_PALETTE = ['#e05c5c', '#f0a742', '#4cba6e', '#5b8def', '#b76de0', '#44c4c4']

export function makeConcentricArcSource({ nodes, measureKey, maxItems, onUpdate }: ConcentricArcSourceSpec): TileSource {
  const leaves = leavesOfNodes(nodes)
  const ids = leafIds(leaves)
  const shapeKey = `${measureKey}|${maxItems ?? ''}|${sortedIds(leaves)}|${nameSortKey(leaves)}`
  return makeFlatSource<{ id: string; label: string; color: string; value: number }>({
    tag: 'v-br-concentric-arc', ids, measureKey,
    values: leaves.map(n => Math.min(100, n.measures[measureKey] ?? 0)),
    shapeKey,
    build: () => leaves.map((n, i) => ({ id: n.id, label: n.name, color: CONCENTRIC_PALETTE[i % 6]!, value: Math.min(100, n.measures[measureKey] ?? 0) })),
    mountProps: (el: any) => { if (maxItems !== undefined) el.maxRings = maxItems },
    readValue: d => d.value, writeValue: (d, v) => { d.value = Math.min(100, v) }, idOf: d => d.id,
    nodes, onUpdate,
  })
}

// ─── Scatter ──────────────────────────────────────────────────────────────────

export interface ScatterSourceSpec {
  nodes: VizNode[]
  xKey: string
  yKey: string
  onUpdate?: (nodeId: string, measures: VizNode['measures']) => void
}

export function makeScatterSource({ nodes, xKey, yKey, onUpdate }: ScatterSourceSpec): TileSource {
  const leaves = leavesOfNodes(nodes)
  const ids = leafIds(leaves)
  const shapeKey = `${xKey}|${yKey}|${sortedIds(leaves)}`
  return makeFlatSource<{ id: string; x: number; y: number }>({
    tag: 'v-br-scatter', ids, measureKey: yKey,
    values: leaves.map(n => n.measures[yKey] ?? 0),
    shapeKey,
    build: () => leaves.map((n, i) => ({ id: n.id, x: xKey === '_index' ? i : (n.measures[xKey] ?? 0), y: n.measures[yKey] ?? 0 })),
    readValue: d => d.y, writeValue: (d, v) => { d.y = v }, idOf: d => d.id,
    reindex: xKey === '_index' ? (d, k) => { d.x = k } : undefined,
    nodes, onUpdate,
  })
}

// ─── Time-series (Line + Area) ────────────────────────────────────────────────

const SERIES_START = new Date(2026, 0, 1).getTime()
const DAY_MS = 86400 * 1000

export interface TimeSeriesSourceSpec {
  nodes: VizNode[]
  measureKey: string
  tag: 'v-br-line' | 'v-br-area'
  onUpdate?: (nodeId: string, measures: VizNode['measures']) => void
}

export function makeTimeSeriesSource({ nodes, measureKey, tag, onUpdate }: TimeSeriesSourceSpec): TileSource {
  const leaves = leavesOfNodes(nodes)
  const ids = leafIds(leaves)
  const shapeKey = `${measureKey}|${sortedIds(leaves)}`
  return makeFlatSource<{ id: string; date: Date; value: number }>({
    tag, ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey,
    build: () => leaves.map((n, i) => ({ id: n.id, date: new Date(SERIES_START + i * DAY_MS), value: n.measures[measureKey] ?? 0 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
    reindex: (d, k) => { d.date = new Date(SERIES_START + k * DAY_MS) },
    nodes, onUpdate,
  })
}
