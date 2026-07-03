/**
 * BrLcCharts.tsx — thin chart wrappers.
 *
 * Each BrLc* component builds a TileSource and delegates to <BrLcTile>.
 * No hooks, no echo suppression, no freeze logic — all of that lives in
 * bindTile.ts. React's role here is just "build the source object and render."
 *
 * useBrElement is kept for the Sankey variants that don't need live editing.
 */

import { useEffect, useRef } from 'react'
import type { Num, Writable } from 'bireactive'
import type { PNode, PEdge } from '../../persistence'
import { makeFlatSource, makeHierSource, hierShapeKey, hierValueKey } from './bindTile'
import { BrLcTile } from './BrLcTile'
import { useDrillNodeId } from '../../store'

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
  MdSankeyGrouped,
  MdSankeyHier,
  MdSankeyHierBireactive,
  MdTreeChart,
  numberDrag,
  MdGanttChartLC,
  type GanttTask,
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
  ['v-br-sankey-grouped', MdSankeyGrouped],
  ['v-br-sankey-hier',    MdSankeyHier],
  ['v-br-sankey-hier-bireactive', MdSankeyHierBireactive],
  ['v-br-tree',           MdTreeChart],
  ['v-br-gantt',          MdGanttChartLC],
] as const

for (const [tag, cls] of TAGS) {
  if (!customElements.get(tag)) customElements.define(tag, cls as CustomElementConstructor)
}

// ─── Generic wrapper (kept for Sankey which uses simple one-shot data) ────────

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
    if (elRef.current) {
      container.removeChild(elRef.current)
      elRef.current = null
    }
    const el = document.createElement(tag) as T
    el.setAttribute('no-source', '')
    setup(el)
    container.appendChild(el)
    elRef.current = el
    return () => {
      if (container.contains(el)) container.removeChild(el)
      elRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return containerRef
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function leavesOfNodes(nodes: PNode[]): PNode[] {
  return nodes.filter(n => !nodes.some(m => m.parentId === n.id))
}

// ─── Flat chart props ─────────────────────────────────────────────────────────

interface FlatProps {
  nodes: PNode[]
  measureKey: string
  maxItems?: number
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void
}

// ─── Bar ──────────────────────────────────────────────────────────────────────

interface BarProps extends FlatProps {
  orientation?: 'vertical' | 'horizontal'
  colorMode?: 'single' | 'palette'
  labelMode?: 'axis' | 'inside' | 'both'
  valueMode?: 'inside' | 'outside' | 'none'
  minBandSize?: number
}

export function BrLcBar({
  nodes, measureKey, maxItems,
  orientation = 'vertical', colorMode = 'single', labelMode = 'axis',
  valueMode = 'none', minBandSize = 0, onUpdate,
}: BarProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const displayKey = `${orientation}|${colorMode}|${labelMode}|${valueMode}|${minBandSize}|${maxItems ?? 0}`
  const maxProp = orientation === 'horizontal' ? 'maxBands' : 'maxBars'
  const shapeKey = `${displayKey}|${measureKey}|${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`
  const source = makeFlatSource<{ id: string; label: string; value: number }>({
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
  return <BrLcTile source={source} />
}

// ─── Pie ──────────────────────────────────────────────────────────────────────

export function BrLcPie({ nodes, measureKey, onUpdate, onUpdateMany }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const shapeKey = `${measureKey}|${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`
  const source = makeFlatSource<{ id: string; label: string; value: Writable<Num> }>({
    tag: 'v-br-pie', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey,
    build: () => leaves.map(n => ({ id: n.id, label: n.name, value: n.measures[measureKey] ?? 1 })) as never,
    readValue: d => d.value.value, writeValue: (d, v) => { d.value.value = v }, idOf: d => d.id,
    nodes, onUpdate, onUpdateMany,
  })
  return <BrLcTile source={source} />
}

// ─── Radar ────────────────────────────────────────────────────────────────────

export function BrLcRadar({ nodes, measureKey, onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const shapeKey = `${measureKey}|${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`
  const source = makeFlatSource<{ id: string; name: string; value: number }>({
    tag: 'v-br-radar', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey,
    build: () => leaves.map(n => ({ id: n.id, name: n.name, value: n.measures[measureKey] ?? 1 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
    nodes, onUpdate,
  })
  return <BrLcTile source={source} />
}

// ─── ConcentricArc ───────────────────────────────────────────────────────────

export function BrLcConcentricArc({ nodes, measureKey, maxItems, onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const palette = ['#e05c5c', '#f0a742', '#4cba6e', '#5b8def', '#b76de0', '#44c4c4']
  const shapeKey = `${measureKey}|${maxItems ?? ''}|${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`
  const source = makeFlatSource<{ id: string; label: string; color: string; value: number }>({
    tag: 'v-br-concentric-arc', ids, measureKey,
    values: leaves.map(n => Math.min(100, n.measures[measureKey] ?? 0)),
    shapeKey,
    build: () => leaves.map((n, i) => ({ id: n.id, label: n.name, color: palette[i % 6]!, value: Math.min(100, n.measures[measureKey] ?? 0) })),
    mountProps: (el: any) => { if (maxItems !== undefined) el.maxRings = maxItems },
    readValue: d => d.value, writeValue: (d, v) => { d.value = Math.min(100, v) }, idOf: d => d.id,
    nodes, onUpdate,
  })
  return <BrLcTile source={source} />
}

// ─── Gauge — single value (uses sum of leaves on a measure key) ──────────────

interface GaugeProps {
  nodes: PNode[]
  measureKey: string
  min?: number
  max?: number
  label?: string
  color?: string
}

export function BrLcGauge({ nodes, measureKey, min = 0, max = 100, label, color }: GaugeProps) {
  // Sum all leaf values for the measure. The gauge is a single-value tile, so
  // we collapse the dataset into one scalar; sum mirrors how the other
  // single-readout charts surface a whole dataset.
  const leaves = leavesOfNodes(nodes)
  const value = leaves.reduce((a, b) => a + (b.measures[measureKey] ?? 0), 0)
  const text = label ?? measureKey
  const data = { value, min, max, color, label: text }
  const ref = useBrElement<MdGaugeLC>(
    'v-br-gauge',
    (el) => { el.externalData = data },
    [value, min, max, color, text],
  )
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Gauge — segmented (same single value, rendered as N discrete cells) ──

export function BrLcGaugeSegmented({ nodes, measureKey, min = 0, max = 100, label, color, segments = 24 }: GaugeProps & { segments?: number }) {
  const leaves = leavesOfNodes(nodes)
  const value = leaves.reduce((a, b) => a + (b.measures[measureKey] ?? 0), 0)
  const text = label ?? measureKey
  const data = { value, min, max, color, label: text, segments }
  const ref = useBrElement<MdGaugeSegmentedLC>(
    'v-br-gauge-segmented',
    (el) => { el.externalData = data },
    [value, min, max, color, text, segments],
  )
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Scatter (two measures) ───────────────────────────────────────────────────

interface ScatterProps {
  nodes: PNode[]
  xKey: string
  yKey: string
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void
}

export function BrLcScatter({ nodes, xKey, yKey, onUpdate }: ScatterProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const shapeKey = `${xKey}|${yKey}|${[...ids].sort().join(',')}`
  const source = makeFlatSource<{ id: string; x: number; y: number }>({
    tag: 'v-br-scatter', ids, measureKey: yKey,
    values: leaves.map(n => n.measures[yKey] ?? 0),
    shapeKey,
    build: () => leaves.map((n, i) => ({ id: n.id, x: xKey === '_index' ? i : (n.measures[xKey] ?? 0), y: n.measures[yKey] ?? 0 })),
    readValue: d => d.y, writeValue: (d, v) => { d.y = v }, idOf: d => d.id,
    reindex: xKey === '_index' ? (d, k) => { d.x = k } : undefined,
    nodes, onUpdate,
  })
  return <BrLcTile source={source} />
}

// ─── Time-series ──────────────────────────────────────────────────────────────

const SERIES_START = new Date(2026, 0, 1).getTime()
const DAY_MS = 86400 * 1000

export function BrLcLine({ nodes, measureKey, onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const shapeKey = `${measureKey}|${[...ids].sort().join(',')}`
  const source = makeFlatSource<{ id: string; date: Date; value: number }>({
    tag: 'v-br-line', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey,
    build: () => leaves.map((n, i) => ({ id: n.id, date: new Date(SERIES_START + i * DAY_MS), value: n.measures[measureKey] ?? 0 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
    reindex: (d, k) => { d.date = new Date(SERIES_START + k * DAY_MS) },
    nodes, onUpdate,
  })
  return <BrLcTile source={source} />
}

export function BrLcArea({ nodes, measureKey, onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const shapeKey = `${measureKey}|${[...ids].sort().join(',')}`
  const source = makeFlatSource<{ id: string; date: Date; value: number }>({
    tag: 'v-br-area', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey,
    build: () => leaves.map((n, i) => ({ id: n.id, date: new Date(SERIES_START + i * DAY_MS), value: n.measures[measureKey] ?? 0 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
    reindex: (d, k) => { d.date = new Date(SERIES_START + k * DAY_MS) },
    nodes, onUpdate,
  })
  return <BrLcTile source={source} />
}

// ─── Hierarchical charts (BiNode) ─────────────────────────────────────────────

interface HierProps {
  nodes: PNode[]
  measureKey: string
  depth?: number
  sortBy?: 'index' | 'value'
  orientation?: 'horizontal' | 'vertical'
  drillKey?: string
  drillNodeId?: string | null
  showBreadcrumb?: boolean
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void
}

function makeHier(tag: string, { nodes, measureKey, depth, sortBy, orientation, drillKey = 'default', drillNodeId, showBreadcrumb = true, onUpdate, onUpdateMany }: HierProps) {
  const shapeKey = hierShapeKey(tag, nodes, measureKey, depth)
  const valueKey = hierValueKey(nodes, measureKey)
  return makeHierSource({
    tag, nodes, measureKey, depth, sortBy, orientation, shapeKey, valueKey, drillKey, drillNodeId, showBreadcrumb, onUpdate, onUpdateMany,
  })
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
  const { nodes, measureKey, onUpdate } = props
  const drillNodeId = useDrillNodeId(props.drillKey ?? 'default')
  const source = makeHier('v-br-treetable', { ...props, drillNodeId })

  // Extend source to add numberDrag to ALL value cells (parents and leaves)
  const originalMountProps = source.mountProps
  const extendedSource = {
    ...source,
    mountProps(el: HTMLElement) {
      originalMountProps?.(el)

      // numberDrag integration - attach to ALL nodes for sum-redistribute editing
      const disposers: Array<() => void> = []
      const typedEl = el as any // MdTreetableLC

      const unsubRender = typedEl.onRender?.((allNodeIds: string[]) => {
        // Clean up previous drag handlers
        for (const d of disposers.splice(0)) d()

        const root = typedEl.getRoot?.()
        if (!root) return

        // Get the externalRoot (BiNode tree)
        const biRoot = typedEl.externalRoot
        if (!biRoot) return

        // Build a map of ALL BiNodes by id (including parents)
        const allNodes: any[] = []
        const walk = (node: any) => {
          allNodes.push(node)
          for (const child of node.children as any[]) walk(child)
        }
        walk(biRoot)
        const nodeMap = new Map(allNodes.map(n => [n.value.id, n]))

        // Attach numberDrag to ALL visible value cells
        for (const id of allNodeIds) {
          const cell = root.querySelector<HTMLElement>(`[data-editable-value="${id}"]`)
          if (!cell) continue

          const biNode = nodeMap.get(id)
          if (!biNode) continue

          const get = () => biNode.value.total.value
          const set = (v: number) => {
            // Write to the BiNode - lens will handle redistribution for parents
            biNode.value.total.value = v
            const pnode = nodes.find(n => n.id === id)
            if (pnode && onUpdate) {
              onUpdate(id, { ...pnode.measures, [measureKey]: v })
            }
          }

          disposers.push(numberDrag(cell, { get, set, pxPerUnit: 4 }))
        }
      })

      // Store cleanup function
      const originalDispose = (el as any).__dispose
      ;(el as any).__dispose = () => {
        unsubRender?.()
        for (const d of disposers) d()
        originalDispose?.()
      }
    }
  }

  return <BrLcTile source={extendedSource} />
}

// ─── Sankey (flat edge-list) ────────────────────────────────────────────────────

interface SankeyProps {
  edges: PEdge[]
}

export function BrLcSankey({ edges }: SankeyProps) {
  const nodeNames = [...new Set(edges.flatMap(e => [e.source, e.target]))]
  const links = edges.map(e => ({ source: e.source, target: e.target, value: e.value }))
  const data = { nodes: nodeNames, links }
  const ref = useBrElement<MdSankeySimple>('v-br-sankey', el => { el.externalData = data }, [JSON.stringify(data)])
  if (edges.length === 0) return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 12 }}>No edge data — dataset needs a flat edge list</div>
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Gantt ──────────────────────────────────────────────────────────────────

interface GanttProps {
  nodes: PNode[]
  /** Measure keys carrying day-offsets from `epoch`. */
  startKey?: string
  endKey?: string
  /** Day-offset epoch (default 2026-01-01). */
  epoch?: Date
  /** Finish-to-start dependency edges (successorId ← predecessorId). */
  deps?: Array<{ from: string; to: string }>
  /** Push/pull dependents so each successor.start == max(pred.end). */
  enforceDeps?: boolean
}

export function BrLcGantt({
  nodes,
  startKey = 'start',
  endKey = 'end',
  epoch = new Date(2026, 0, 1),
  deps = [],
  enforceDeps = false,
}: GanttProps) {
  const epochMs = epoch.getTime()
  const depsByTo = new Map<string, string[]>()
  for (const e of deps) {
    const arr = depsByTo.get(e.to) ?? []
    arr.push(e.from)
    depsByTo.set(e.to, arr)
  }
  const tasks: GanttTask[] = nodes.map(n => ({
    id: n.id,
    label: n.name,
    start: new Date(epochMs + (n.measures[startKey] ?? 0) * 86400000),
    end:   new Date(epochMs + (n.measures[endKey]   ?? 1) * 86400000),
    color: n.color,
    deps: depsByTo.get(n.id),
  }))
  const key = JSON.stringify([enforceDeps, tasks.map(t => [t.id, t.label, +t.start, +t.end, t.color, t.deps ?? []])])
  const ref = useBrElement<MdGanttChartLC>(
    'v-br-gantt',
    (el) => { el.enforceDeps = enforceDeps; el.externalData = tasks },
    [key],
  )
  return <div ref={ref} style={{ width: '100%', height: '100%', overflow: 'auto' }} />
}

// ─── Sankey (conservation flow) ─────────────────────────────────────────────────
export function BrLcSankeyFlow() {
  const ref = useBrElement<MdSankeyFlow>('v-br-sankey-flow', () => {}, [])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Sankey (grouped nodes, WIN-56 spike) ───────────────────────────────────────
export function BrLcSankeyGrouped() {
  const ref = useBrElement<MdSankeyGrouped>('v-br-sankey-grouped', () => {}, [])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Sankey (hierarchical, expand/collapse, WIN-56) ────────────────────────────
export function BrLcSankeyHier() {
  const ref = useBrElement<MdSankeyHier>('v-br-sankey-hier', () => {}, [])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Sankey (hierarchical, BIREACTIVE variant with structural conservation) ─────
export function BrLcSankeyHierBireactive() {
  const ref = useBrElement<MdSankeyHierBireactive>('v-br-sankey-hier-bireactive', () => {}, [])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}
