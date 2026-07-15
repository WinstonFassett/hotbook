/**
 * BrLcCharts.tsx — thin chart wrappers.
 *
 * Each BrLc* component builds a TileSource (via sources/) and delegates to <BrLcTile>.
 * No hooks, no echo suppression, no freeze logic — all of that lives in tile-binder.ts.
 * React's role here is just "build the source object and render."
 *
 * useBrElement is kept for the Sankey/Gauge variants that don't need live editing.
 */

import { useEffect, useRef } from 'react'
import type { VizNode, PEdge } from '../../persistence'
import { BrLcTile } from './BrLcTile'
import { useDrillNodeId } from '../../store-react'
import {
  makeBarSource, makePieSource, makeRadarSource, makeConcentricArcSource,
  makeScatterSource, makeTimeSeriesSource,
} from './sources/flat-shapes'
import { makeHier, makeTreetableSource } from './sources/hier-shapes'

import {
  MdBarChartLC, MdLineChartLC, MdAreaChartLC, MdScatterChartLC, MdPieChartLC,
  MdRadarChartLC, MdConcentricArcLC, MdGaugeLC, MdGaugeSegmentedLC,
  MdPack, MdTreemapLC, MdTreetableLC, MdIcicleLC, MdSunburstLC,
  MdSankeySimple, MdSankeyFlow, MdTreeChart, MdGanttChartLC,
  type GanttTask,
} from '@fiddleviz/bireactive'

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

// ─── Generic wrapper (kept for Sankey/Gauge which use simple one-shot data) ───

function useBrElement<T extends HTMLElement>(
  tag: string,
  setup: (el: T) => void,
  deps: unknown[],
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const elRef = useRef<T | null>(null)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (elRef.current) { container.removeChild(elRef.current); elRef.current = null }
    const el = document.createElement(tag) as T
    el.setAttribute('no-source', '')
    setup(el)
    container.appendChild(el)
    elRef.current = el
    return () => { if (container.contains(el)) container.removeChild(el); elRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return containerRef
}

// ─── Flat chart props ─────────────────────────────────────────────────────────

interface FlatProps {
  nodes: VizNode[]
  measureKey: string
  maxItems?: number
  onUpdate?: (nodeId: string, measures: VizNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: VizNode['measures'] }>) => void
}

// ─── Flat live charts ─────────────────────────────────────────────────────────

interface BarProps extends FlatProps {
  orientation?: 'vertical' | 'horizontal'
  colorMode?: 'single' | 'palette'
  labelMode?: 'axis' | 'inside' | 'both'
  valueMode?: 'inside' | 'outside' | 'none'
  minBandSize?: number
}

export function BrLcBar(props: BarProps) {
  return <BrLcTile source={makeBarSource(props)} />
}

export function BrLcPie({ nodes, measureKey, onUpdate, onUpdateMany }: FlatProps) {
  return <BrLcTile source={makePieSource({ nodes, measureKey, onUpdate, onUpdateMany })} />
}

export function BrLcRadar({ nodes, measureKey, onUpdate }: FlatProps) {
  return <BrLcTile source={makeRadarSource({ nodes, measureKey, onUpdate })} />
}

export function BrLcConcentricArc({ nodes, measureKey, maxItems, onUpdate }: FlatProps) {
  return <BrLcTile source={makeConcentricArcSource({ nodes, measureKey, maxItems, onUpdate })} />
}

interface ScatterProps { nodes: VizNode[]; xKey: string; yKey: string; onUpdate?: (nodeId: string, measures: VizNode['measures']) => void }
export function BrLcScatter(props: ScatterProps) {
  return <BrLcTile source={makeScatterSource(props)} />
}

export function BrLcLine({ nodes, measureKey, onUpdate }: FlatProps) {
  return <BrLcTile source={makeTimeSeriesSource({ nodes, measureKey, tag: 'v-br-line', onUpdate })} />
}

export function BrLcArea({ nodes, measureKey, onUpdate }: FlatProps) {
  return <BrLcTile source={makeTimeSeriesSource({ nodes, measureKey, tag: 'v-br-area', onUpdate })} />
}

// ─── Gauge — single scalar (not live-editable) ───────────────────────────────

interface GaugeProps { nodes: VizNode[]; measureKey: string; min?: number; max?: number; label?: string; color?: string }

export function BrLcGauge({ nodes, measureKey, min = 0, max = 100, label, color }: GaugeProps) {
  const leaves = nodes.filter(n => !nodes.some(m => m.parentId === n.id))
  const value = leaves.reduce((a, b) => a + (b.measures[measureKey] ?? 0), 0)
  const text = label ?? measureKey
  const ref = useBrElement<MdGaugeLC>('v-br-gauge', (el) => { el.externalData = { value, min, max, color, label: text } }, [value, min, max, color, text])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcGaugeSegmented({ nodes, measureKey, min = 0, max = 100, label, color, segments = 24 }: GaugeProps & { segments?: number }) {
  const leaves = nodes.filter(n => !nodes.some(m => m.parentId === n.id))
  const value = leaves.reduce((a, b) => a + (b.measures[measureKey] ?? 0), 0)
  const text = label ?? measureKey
  const ref = useBrElement<MdGaugeSegmentedLC>('v-br-gauge-segmented', (el) => { el.externalData = { value, min, max, color, label: text, segments } }, [value, min, max, color, text, segments])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Hierarchical live charts ─────────────────────────────────────────────────

interface HierProps {
  nodes: VizNode[]; measureKey: string; depth?: number; sortBy?: 'index' | 'value'
  orientation?: 'horizontal' | 'vertical'; drillKey?: string; drillNodeId?: string | null
  showBreadcrumb?: boolean
  onUpdate?: (nodeId: string, measures: VizNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: VizNode['measures'] }>) => void
}

export function BrLcPack(props: HierProps) {
  const drillNodeId = useDrillNodeId(props.drillKey ?? 'default')
  return <BrLcTile source={makeHier('v-br-pack', { ...props, drillNodeId })} />
}

export function BrLcTreemap(props: HierProps) {
  const drillNodeId = useDrillNodeId(props.drillKey ?? 'default')
  return <BrLcTile source={makeHier('v-br-treemap', { ...props, drillNodeId })} />
}

export function BrLcIcicle(props: HierProps) {
  const drillNodeId = useDrillNodeId(props.drillKey ?? 'default')
  return <BrLcTile source={makeHier('v-br-icicle', { ...props, drillNodeId })} />
}

export function BrLcSunburst(props: HierProps) {
  const drillNodeId = useDrillNodeId(props.drillKey ?? 'default')
  return <BrLcTile source={makeHier('v-br-sunburst', { ...props, drillNodeId })} />
}

export function BrLcTree(props: HierProps) {
  const drillNodeId = useDrillNodeId(props.drillKey ?? 'default')
  return <BrLcTile source={makeHier('v-br-tree', { ...props, drillNodeId })} />
}

export function BrLcTreetable(props: HierProps) {
  const drillNodeId = useDrillNodeId(props.drillKey ?? 'default')
  return <BrLcTile source={makeTreetableSource({ ...props, drillNodeId })} />
}

// ─── Sankey (flat edge-list) ──────────────────────────────────────────────────

interface SankeyProps { edges: PEdge[] }

export function BrLcSankey({ edges }: SankeyProps) {
  const nodeNames = [...new Set(edges.flatMap(e => [e.source, e.target]))]
  const links = edges.map(e => ({ source: e.source, target: e.target, value: e.value }))
  const data = { nodes: nodeNames, links }
  const ref = useBrElement<MdSankeySimple>('v-br-sankey', el => { el.externalData = data }, [JSON.stringify(data)])
  if (edges.length === 0) return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 12 }}>No edge data — dataset needs a flat edge list</div>
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Gantt ────────────────────────────────────────────────────────────────────

interface GanttProps {
  nodes: VizNode[]; startKey?: string; endKey?: string; epoch?: Date
  deps?: Array<{ from: string; to: string }>; enforceDeps?: boolean
}

export function BrLcGantt({ nodes, startKey = 'start', endKey = 'end', epoch = new Date(2026, 0, 1), deps = [], enforceDeps = false }: GanttProps) {
  const epochMs = epoch.getTime()
  const depsByTo = new Map<string, string[]>()
  for (const e of deps) { const arr = depsByTo.get(e.to) ?? []; arr.push(e.from); depsByTo.set(e.to, arr) }
  const tasks: GanttTask[] = nodes.map(n => ({
    id: n.id, label: n.name,
    start: new Date(epochMs + (n.measures[startKey] ?? 0) * 86400000),
    end: new Date(epochMs + (n.measures[endKey] ?? 1) * 86400000),
    color: n.color, deps: depsByTo.get(n.id),
  }))
  const key = JSON.stringify([enforceDeps, tasks.map(t => [t.id, t.label, +t.start, +t.end, t.color, t.deps ?? []])])
  const ref = useBrElement<MdGanttChartLC>('v-br-gantt', (el) => { el.enforceDeps = enforceDeps; el.externalData = tasks }, [key])
  return <div ref={ref} style={{ width: '100%', height: '100%', overflow: 'auto' }} />
}
