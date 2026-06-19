import { useEffect, useRef } from 'react'
import { effect as biEffect, leavesOf } from 'bireactive'
import type { Cell, Writable } from 'bireactive'
import type { PNode } from '../../persistence'
import { buildBiTree } from './tree'
import type { BiNode } from './tree'

import { MdBarChartLC } from '@br-lc/demos/bar-chart'
import { MdLineChartLC } from '@br-lc/demos/line-chart'
import { MdAreaChartLC } from '@br-lc/demos/area-chart'
import { MdScatterChartLC } from '@br-lc/demos/scatter-chart'
import { MdPieChartLC } from '@br-lc/demos/pie-chart'
import { MdRadarChartLC } from '@br-lc/demos/radar-chart'
import { MdConcentricArcLC } from '@br-lc/demos/concentric-arc'
import { MdPack } from '@br-lc/demos/pack'
import { MdTreemapLC } from '@br-lc/demos/treemap'
import { MdIcicleLC } from '@br-lc/demos/icicle'
import { MdSunburstLC } from '@br-lc/demos/sunburst'
import { MdSankeySimple } from '@br-lc/demos/sankey'
import { MdTreeChart } from '@br-lc/demos/tree-chart'

// Register custom elements once
const TAGS = [
  ['v-br-bar',            MdBarChartLC],
  ['v-br-line',           MdLineChartLC],
  ['v-br-area',           MdAreaChartLC],
  ['v-br-scatter',        MdScatterChartLC],
  ['v-br-pie',            MdPieChartLC],
  ['v-br-radar',          MdRadarChartLC],
  ['v-br-concentric-arc', MdConcentricArcLC],
  ['v-br-pack',           MdPack],
  ['v-br-treemap',        MdTreemapLC],
  ['v-br-icicle',         MdIcicleLC],
  ['v-br-sunburst',       MdSunburstLC],
  ['v-br-sankey',         MdSankeySimple],
  ['v-br-tree',           MdTreeChart],
] as const

for (const [tag, cls] of TAGS) {
  if (!customElements.get(tag)) customElements.define(tag, cls as CustomElementConstructor)
}

// ─── Generic wrapper ──────────────────────────────────────────────────────────

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
    // Remove previous instance
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

// ─── Live flat-element wrapper ────────────────────────────────────────────────
//
// Like the D3 charts, the store is the single source of truth. The element is
// mounted ONCE and given a reactive data cell; on data change we mutate the
// existing cell objects in place and re-signal — no remount, so an in-flight
// wheel/drag gesture is never destroyed. Rebuild happens only when the data
// *shape* changes (different rows / count / measureKey), not on value edits.

interface ElWithDataCell<D> extends HTMLElement {
  dataCell: Writable<Cell<readonly D[]>>
  externalData?: unknown
}

interface LiveFlatSpec<D> {
  tag: string
  /** Per-datum backing PNode id, in render order. Drives shape key + edit-out. */
  ids: string[]
  /** Build the datum objects for the initial mount. */
  build: () => D[]
  /** Read the numeric measure value out of a datum (for edit-out). */
  readValue: (d: D) => number
  /** Write a datum's value (for applying store changes in place). */
  writeValue: (d: D, v: number) => void
  /** Current store values per id, in the same order as `ids`. */
  values: number[]
  /** Shape key: rebuild when this changes. */
  shapeKey: string
  /** measureKey the value maps to, for edit-out patches. */
  measureKey: string
}

function useLiveFlatElement<D>(
  spec: LiveFlatSpec<D>,
  nodes: PNode[],
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const elRef = useRef<ElWithDataCell<D> | null>(null)
  const disposeRef = useRef<(() => void) | undefined>(undefined)
  // `last[i]` = the rounded value we consider already in sync with the store for
  // datum i. The edit-out subscription emits only when a value diverges from it;
  // the apply-in effect updates it when it pushes a store change in, so a store
  // echo of the element's own edit doesn't bounce back out.
  const lastRef = useRef<number[]>(spec.values.slice())
  // Latest spec/nodes/onUpdate for the (stable) edit-out subscription to read.
  const specRef = useRef(spec); specRef.current = spec
  const nodesRef = useRef(nodes); nodesRef.current = nodes
  const onUpdateRef = useRef(onUpdate); onUpdateRef.current = onUpdate

  // Mount once per shape. Rebuild only when the shape key changes.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const el = document.createElement(spec.tag) as ElWithDataCell<D>
    el.setAttribute('no-source', '')
    el.externalData = spec.build()
    container.appendChild(el)
    elRef.current = el
    lastRef.current = specRef.current.values.slice()

    // Edit-out: when the element's own gesture changes a value, push to store.
    disposeRef.current = biEffect(() => {
      const arr = el.dataCell.value
      const s = specRef.current
      const cb = onUpdateRef.current
      const last = lastRef.current
      if (!cb) { for (let i = 0; i < arr.length; i++) last[i] = Math.round(s.readValue(arr[i]!)); return }
      const byId = new Map(nodesRef.current.map(n => [n.id, n]))
      const pending: Array<[string, PNode['measures']]> = []
      for (let i = 0; i < arr.length; i++) {
        const v = Math.round(s.readValue(arr[i]!))
        if (v !== last[i]) {
          last[i] = v
          const node = byId.get(s.ids[i]!)
          if (node) pending.push([node.id, { ...node.measures, [s.measureKey]: v }])
        }
      }
      // Defer the store write out of the bireactive flush (avoids re-entering
      // React setState mid-flush).
      if (pending.length) queueMicrotask(() => { for (const [id, m] of pending) cb(id, m) })
    })

    return () => {
      disposeRef.current?.()
      disposeRef.current = undefined
      if (container.contains(el)) container.removeChild(el)
      elRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.tag, spec.shapeKey])

  // Apply store value changes in place — mutate existing objects, re-signal.
  // Skips values already matching (the common case: echo of the element's own
  // edit). Updates lastRef so edit-out won't re-emit what we just applied.
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const arr = el.dataCell.value as D[]
    const last = lastRef.current
    let changed = false
    for (let i = 0; i < arr.length && i < spec.values.length; i++) {
      const target = spec.values[i]!
      if (Math.round(spec.readValue(arr[i]!)) !== target) {
        spec.writeValue(arr[i]!, target)
        last[i] = target
        changed = true
      }
    }
    if (changed) el.dataCell.value = [...arr]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.values.join(',')])

  return containerRef
}

// ─── Flat charts (label + value) ─────────────────────────────────────────────

interface FlatProps {
  nodes: PNode[]
  measureKey: string
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void
}

function leavesOfNodes(nodes: PNode[]): PNode[] {
  return nodes.filter(n => !nodes.some(m => m.parentId === n.id))
}

export function BrLcBar({ nodes, measureKey, onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const ref = useLiveFlatElement<{ label: string; value: number }>({
    tag: 'v-br-bar', ids, measureKey,
    values: leaves.map(n => Math.round(n.measures[measureKey] ?? 0)),
    shapeKey: `${measureKey}|${ids.join(',')}|${leaves.map(n => n.name).join(',')}`,
    build: () => leaves.map(n => ({ label: n.name, value: n.measures[measureKey] ?? 1 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v },
  }, nodes, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcPie({ nodes, measureKey, onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const ref = useLiveFlatElement<{ label: string; value: number }>({
    tag: 'v-br-pie', ids, measureKey,
    values: leaves.map(n => Math.round(n.measures[measureKey] ?? 0)),
    shapeKey: `${measureKey}|${ids.join(',')}|${leaves.map(n => n.name).join(',')}`,
    build: () => leaves.map(n => ({ label: n.name, value: n.measures[measureKey] ?? 1 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v },
  }, nodes, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcRadar({ nodes, measureKey, onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const ref = useLiveFlatElement<{ name: string; value: number }>({
    tag: 'v-br-radar', ids, measureKey,
    values: leaves.map(n => Math.round(n.measures[measureKey] ?? 0)),
    shapeKey: `${measureKey}|${ids.join(',')}|${leaves.map(n => n.name).join(',')}`,
    build: () => leaves.map(n => ({ name: n.name, value: n.measures[measureKey] ?? 1 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v },
  }, nodes, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcConcentricArc({ nodes, measureKey, onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const palette = ['#e05c5c', '#f0a742', '#4cba6e', '#5b8def', '#b76de0', '#44c4c4']
  const ref = useLiveFlatElement<{ label: string; color: string; value: number }>({
    tag: 'v-br-concentric-arc', ids, measureKey,
    values: leaves.map(n => Math.min(100, Math.round(n.measures[measureKey] ?? 0))),
    shapeKey: `${measureKey}|${ids.join(',')}|${leaves.map(n => n.name).join(',')}`,
    build: () => leaves.map((n, i) => ({ label: n.name, color: palette[i % 6]!, value: Math.min(100, Math.round(n.measures[measureKey] ?? 0)) })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = Math.min(100, v) },
  }, nodes, onUpdate)
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
  const ref = useLiveFlatElement<{ x: number; y: number }>({
    tag: 'v-br-scatter', ids, measureKey: yKey,
    values: leaves.map(n => Math.round(n.measures[yKey] ?? 0)),
    shapeKey: `${xKey}|${yKey}|${ids.join(',')}`,
    build: () => leaves.map((n, i) => ({ x: xKey === '_index' ? i : (n.measures[xKey] ?? 0), y: n.measures[yKey] ?? 0 })),
    readValue: d => d.y, writeValue: (d, v) => { d.y = v },
  }, nodes, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Time-series (index as x, measure as y) ───────────────────────────────────

const SERIES_START = new Date(2026, 0, 1).getTime()
const DAY_MS = 86400 * 1000

export function BrLcLine({ nodes, measureKey, onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const ref = useLiveFlatElement<{ date: Date; value: number }>({
    tag: 'v-br-line', ids, measureKey,
    values: leaves.map(n => Math.round(n.measures[measureKey] ?? 0)),
    shapeKey: `${measureKey}|${ids.join(',')}`,
    build: () => leaves.map((n, i) => ({ date: new Date(SERIES_START + i * DAY_MS), value: n.measures[measureKey] ?? 0 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v },
  }, nodes, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcArea({ nodes, measureKey, onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const ref = useLiveFlatElement<{ date: Date; value: number }>({
    tag: 'v-br-area', ids, measureKey,
    values: leaves.map(n => Math.round(n.measures[measureKey] ?? 0)),
    shapeKey: `${measureKey}|${ids.join(',')}`,
    build: () => leaves.map((n, i) => ({ date: new Date(SERIES_START + i * DAY_MS), value: n.measures[measureKey] ?? 0 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v },
  }, nodes, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Live hierarchical-element wrapper ────────────────────────────────────────
//
// Same single-source-of-truth model as the flat charts, but the data is a live
// BiNode tree (its `total` cells are reactive). Mount once; on external value
// change write into the leaf `total` cells in place (the tree reflows, no
// remount); edit-out subscribes to the leaf cells and pushes to the store.

interface ElWithRoot extends HTMLElement {
  externalRoot?: BiNode
}

function useLiveHierElement(
  tag: string,
  nodes: PNode[],
  measureKey: string,
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const elRef = useRef<ElWithRoot | null>(null)
  const rootRef = useRef<BiNode | null>(null)
  const leavesRef = useRef<BiNode[]>([])
  const disposeRef = useRef<(() => void) | undefined>(undefined)
  // last[id] = rounded value considered in sync with the store, to suppress echo.
  const lastRef = useRef<Map<string, number>>(new Map())
  const nodesRef = useRef(nodes); nodesRef.current = nodes
  const onUpdateRef = useRef(onUpdate); onUpdateRef.current = onUpdate

  // Shape: rebuild only when the tree structure (ids/parents) or measureKey changes.
  const shapeKey = `${measureKey}|${nodes.map(n => `${n.id}:${n.parentId ?? ''}`).join(',')}`
  // Per-leaf store values, applied in place on change.
  const valueKey = nodes.map(n => `${n.id}:${Math.round(n.measures[measureKey] ?? 0)}`).join(',')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const root = buildBiTree(nodes, measureKey)
    rootRef.current = root
    if (!root) return
    const leaves = leavesOf(root) as BiNode[]
    leavesRef.current = leaves
    lastRef.current = new Map(leaves.map(l => [l.value.id, Math.round(l.value.total.value)]))

    const el = document.createElement(tag) as ElWithRoot
    el.setAttribute('no-source', '')
    el.externalRoot = root
    container.appendChild(el)
    elRef.current = el

    // Edit-out: leaf total changes (gesture redistribution) → store.
    disposeRef.current = biEffect(() => {
      const last = lastRef.current
      const cb = onUpdateRef.current
      const pending: Array<[string, PNode['measures']]> = []
      const byId = new Map(nodesRef.current.map(n => [n.id, n]))
      for (const leaf of leaves) {
        const v = Math.round(leaf.value.total.value)
        if (v !== last.get(leaf.value.id)) {
          last.set(leaf.value.id, v)
          const node = byId.get(leaf.value.id)
          if (cb && node) pending.push([node.id, { ...node.measures, [measureKey]: v }])
        }
      }
      if (cb && pending.length) queueMicrotask(() => { for (const [id, m] of pending) cb(id, m) })
    })

    return () => {
      disposeRef.current?.()
      disposeRef.current = undefined
      if (container.contains(el)) container.removeChild(el)
      elRef.current = null
      rootRef.current = null
      leavesRef.current = []
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, shapeKey])

  // Apply external store changes into the live leaf cells, in place. Skips
  // values already matching (echo of the element's own edit) and updates last.
  useEffect(() => {
    if (!rootRef.current) return
    const byId = new Map(nodes.map(n => [n.id, n]))
    const last = lastRef.current
    for (const leaf of leavesRef.current) {
      const node = byId.get(leaf.value.id)
      if (!node) continue
      const target = Math.round(node.measures[measureKey] ?? 0)
      if (Math.round(leaf.value.total.value) !== target) {
        leaf.value.total.value = target
        last.set(leaf.value.id, target)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueKey])

  return containerRef
}

// ─── Hierarchical charts (BiNode) ─────────────────────────────────────────────

interface HierProps {
  nodes: PNode[]
  measureKey: string
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void
}

export function BrLcPack({ nodes, measureKey, onUpdate }: HierProps) {
  const ref = useLiveHierElement('v-br-pack', nodes, measureKey, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcTreemap({ nodes, measureKey, onUpdate }: HierProps) {
  const ref = useLiveHierElement('v-br-treemap', nodes, measureKey, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcIcicle({ nodes, measureKey, onUpdate }: HierProps) {
  const ref = useLiveHierElement('v-br-icicle', nodes, measureKey, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcSunburst({ nodes, measureKey, onUpdate }: HierProps) {
  const ref = useLiveHierElement('v-br-sunburst', nodes, measureKey, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcTree({ nodes, measureKey, onUpdate }: HierProps) {
  const ref = useLiveHierElement('v-br-tree', nodes, measureKey, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Sankey (hierarchy edges) ──────────────────────────────────────────────────

export function BrLcSankey({ nodes, measureKey }: FlatProps) {
  const nameById = new Map(nodes.map(n => [n.id, n.name]))
  const nodeNames = [...new Set(nodes.map(n => n.name))]
  const nodeNameSet = new Set(nodeNames)
  const links = nodes
    .filter(n => n.parentId !== null && nameById.has(n.parentId))
    .map(n => ({
      source: nameById.get(n.parentId!)!,
      target: n.name,
      value: n.measures[measureKey] ?? 0,
    }))
    .filter(l => nodeNameSet.has(l.source) && nodeNameSet.has(l.target))
  const data = { nodes: nodeNames, links }
  const ref = useBrElement<MdSankeySimple>('v-br-sankey', el => { el.externalData = data }, [JSON.stringify(data)])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}
