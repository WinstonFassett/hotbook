import { useEffect, useRef } from 'react'
import { effect as biEffect, leavesOf } from 'bireactive'
import type { Cell, Num, Writable } from 'bireactive'
import type { PNode } from '../../persistence'
import { buildBiTree } from './tree'
import type { BiNode } from './tree'
import { hudStore } from '../../store'

// Values flow through the tree as exact floats (parent resize redistributes
// proportionally, producing fractional leaf values like 60.79). We do NOT
// quantize to integers — that would destroy sub-unit sibling deltas and turn
// parent resize additive. Echo suppression therefore compares with an epsilon
// rather than rounding, and the React apply-in dep key is keyed on a stable
// rounded-to-precision string only so float noise doesn't thrash re-renders.
const EPS = 1e-6
const near = (a: number, b: number) => Math.abs(a - b) < EPS
/** Stable string key for a value, for React deps — quantized to kill float
 *  noise but fine-grained enough that real fractional edits still differ. */
const vkey = (v: number) => (Math.round(v * 1000) / 1000).toString()

// Cross-tile sync bridge exposed by BR-LC custom elements (apps/.../lib/hud-bridge.ts).
interface BrSyncBridge {
  setExternalHover(id: string | null): void
  setExternalSelect(id: string | null): void
  onHover(cb: (id: string | null) => void): () => void
  onSelect(cb: (id: string | null) => void): () => void
}
interface ElWithBrSync extends HTMLElement { brSync?: BrSyncBridge }

// Wire a mounted BR-LC element to the sliceboard hudStore in both directions:
//   • element hover/select  → hudStore  (so other tiles highlight)
//   • hudStore hover/select → element   (so this tile reflects others)
// Echo-suppressed on both sides (the element bridge guards inbound writes; here
// we skip pushing a value the element just reported). Returns a disposer.
function bindHudSync(el: ElWithBrSync): () => void {
  const bridge = el.brSync
  if (!bridge) return () => {}
  // Last value we pushed IN from the store, to avoid bouncing the element's
  // echo of it straight back to the store.
  let lastInHover: string | null = null
  let lastInSelect: string | null = null

  const offHover = bridge.onHover(id => { if (id !== lastInHover) hudStore.setHover(id) })
  const offSelect = bridge.onSelect(id => { if (id !== lastInSelect) hudStore.setSelection(id) })

  const unsub = hudStore.subscribe(() => {
    const s = hudStore.getSnapshot()
    if (s.hoverId !== lastInHover) { lastInHover = s.hoverId; bridge.setExternalHover(s.hoverId) }
    if (s.selectionId !== lastInSelect) { lastInSelect = s.selectionId; bridge.setExternalSelect(s.selectionId) }
  })
  // Seed current store state into the freshly mounted element.
  const s0 = hudStore.getSnapshot()
  lastInHover = s0.hoverId; lastInSelect = s0.selectionId
  bridge.setExternalHover(s0.hoverId)
  bridge.setExternalSelect(s0.selectionId)

  return () => { offHover(); offSelect(); unsub() }
}

// Flat-chart variant: the element's bridge keys on datum INDEX (flat datums
// have no id), so translate index ↔ PNode id through the parallel `ids[]` the
// wrapper already holds. `idsRef` is read live so it tracks data reshapes.
function bindHudSyncFlat(el: ElWithBrSync, idsRef: { current: string[] }): () => void {
  const bridge = el.brSync
  if (!bridge) return () => {}
  const idToIdx = (id: string | null): string | null => {
    if (id == null) return null
    const i = idsRef.current.indexOf(id)
    return i < 0 ? null : String(i)
  }
  const idxToId = (key: string | null): string | null => {
    if (key == null) return null
    const i = Number(key)
    return Number.isInteger(i) ? idsRef.current[i] ?? null : null
  }
  let lastInHover: string | null = null
  let lastInSelect: string | null = null

  const offHover = bridge.onHover(key => { const id = idxToId(key); if (id !== lastInHover) hudStore.setHover(id) })
  const offSelect = bridge.onSelect(key => { const id = idxToId(key); if (id !== lastInSelect) hudStore.setSelection(id) })

  const unsub = hudStore.subscribe(() => {
    const s = hudStore.getSnapshot()
    if (s.hoverId !== lastInHover) { lastInHover = s.hoverId; bridge.setExternalHover(idToIdx(s.hoverId)) }
    if (s.selectionId !== lastInSelect) { lastInSelect = s.selectionId; bridge.setExternalSelect(idToIdx(s.selectionId)) }
  })
  const s0 = hudStore.getSnapshot()
  lastInHover = s0.hoverId; lastInSelect = s0.selectionId
  bridge.setExternalHover(idToIdx(s0.hoverId))
  bridge.setExternalSelect(idToIdx(s0.selectionId))

  return () => { offHover(); offSelect(); unsub() }
}

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
import { MdSankeyFlow } from '@br-lc/demos/sankey-flow'
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
  ['v-br-sankey-flow',    MdSankeyFlow],
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
  /** True while a wheel or drag gesture is live — remount must be deferred. */
  gestureActive?: boolean
}

interface LiveFlatSpec<D> {
  tag: string
  /** Per-datum backing PNode id, in render order. Drives edit-out + apply-in. */
  ids: string[]
  /** Build the datum objects for the initial mount. */
  build: () => D[]
  /** Read the numeric measure value out of a datum (for edit-out). */
  readValue: (d: D) => number
  /** Write a datum's value (for applying store changes in place). */
  writeValue: (d: D, v: number) => void
  /** Current store values per id, in the same order as `ids`. */
  values: number[]
  /** Shape key: rebuild when this changes (row set / names / measure — NOT sort order). */
  shapeKey: string
  /** measureKey the value maps to, for edit-out patches. */
  measureKey: string
  /** Called after element creation, before it is appended to the DOM. Use to set props that scene() reads on connect. */
  onMount?: (el: HTMLElement) => void
}

function useLiveFlatElement<D>(
  spec: LiveFlatSpec<D>,
  nodes: PNode[],
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const elRef = useRef<ElWithDataCell<D> | null>(null)
  const disposeRef = useRef<(() => void) | undefined>(undefined)
  // `last[i]` = the exact value we consider already in sync for datum at
  // build-time position i. Keyed by build-time index, not sort-time index.
  const lastRef = useRef<number[]>(spec.values.slice())
  // Build-time id order — stable across sort reorders (set at mount, cleared on unmount).
  // arr[i] in the element always corresponds to buildIds[i].
  const buildIdsRef = useRef<string[]>(spec.ids.slice())
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
    specRef.current.onMount?.(el)
    el.externalData = spec.build()
    container.appendChild(el)
    elRef.current = el
    // Snapshot the id order at build time — arr[i] always matches buildIds[i].
    buildIdsRef.current = specRef.current.ids.slice()
    lastRef.current = specRef.current.values.slice()

    // Cross-tile hover/select sync (index ↔ id via build-time order, not sort order).
    // buildIdsRef is frozen at mount so element index i always maps to buildIds[i].
    const unbindHud = bindHudSyncFlat(el as ElWithBrSync, buildIdsRef)

    // Edit-out: when the element's own gesture changes a value, push to store.
    // Uses buildIds (frozen at mount) not spec.ids (current sort order), so
    // arr[i] always maps to the correct node even after a sort reorder.
    disposeRef.current = biEffect(() => {
      const arr = el.dataCell.value
      const s = specRef.current
      const cb = onUpdateRef.current
      const last = lastRef.current
      const buildIds = buildIdsRef.current
      if (!cb) { for (let i = 0; i < arr.length; i++) last[i] = s.readValue(arr[i]!); return }
      const byId = new Map(nodesRef.current.map(n => [n.id, n]))
      const pending: Array<[string, PNode['measures']]> = []
      for (let i = 0; i < arr.length; i++) {
        const v = s.readValue(arr[i]!)
        if (!near(v, last[i]!)) {
          last[i] = v
          const node = byId.get(buildIds[i]!)
          if (node) pending.push([node.id, { ...node.measures, [s.measureKey]: v }])
        }
      }
      // Defer the store write out of the bireactive flush (avoids re-entering
      // React setState mid-flush).
      if (pending.length) queueMicrotask(() => { for (const [id, m] of pending) cb(id, m) })
    })

    return () => {
      unbindHud()
      disposeRef.current?.()
      disposeRef.current = undefined
      if (container.contains(el)) container.removeChild(el)
      elRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.tag, spec.shapeKey])

  // Apply store changes in place — update values AND reorder to match current sort.
  // Reconciles by id: builds a map from id→datum, then writes spec.ids order into
  // the element's array so the reactive band/domain derives pick up the new order.
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    if (el.gestureActive) return
    const arr = el.dataCell.value as D[]
    // Build id→datum map from the element's current array and buildIds.
    const buildIds = buildIdsRef.current
    const datumById = new Map<string, D>()
    for (let i = 0; i < arr.length; i++) datumById.set(buildIds[i]!, arr[i]!)
    // Apply new values and produce array in current spec.ids order.
    let changed = false
    const next: D[] = []
    for (let j = 0; j < spec.ids.length; j++) {
      const id = spec.ids[j]!
      const d = datumById.get(id)
      if (!d) continue
      const target = spec.values[j]!
      // Find this datum's build-time index for lastRef.
      const bi = buildIds.indexOf(id)
      if (!near(spec.readValue(d), target)) {
        spec.writeValue(d, target)
        if (bi >= 0) lastRef.current[bi] = target
        changed = true
      }
      next.push(d)
    }
    // Check if order changed.
    const reordered = next.some((d, i) => d !== arr[i])
    if (changed || reordered) {
      // Update buildIdsRef to reflect new order (edit-out and HUD use it).
      buildIdsRef.current = spec.ids.slice()
      el.dataCell.value = next
      // Rebuild lastRef in new order.
      lastRef.current = next.map(d => spec.readValue(d))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.values.join(','), spec.ids.join(',')])

  return containerRef
}

// ─── Flat charts (label + value) ─────────────────────────────────────────────

interface FlatProps {
  nodes: PNode[]
  measureKey: string
  sortBy?: 'index' | 'value'
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void
}

function leavesOfNodes(nodes: PNode[]): PNode[] {
  return nodes.filter(n => !nodes.some(m => m.parentId === n.id))
}

function useElProp(containerRef: ReturnType<typeof useRef<HTMLDivElement | null>>, prop: string, value: unknown) {
  // Run after every render — ensures prop is current even after a shapeKey-triggered remount.
  useEffect(() => {
    const el = containerRef.current?.firstElementChild as any
    if (el) el[prop] = value
  })
}

interface BarProps extends FlatProps {
  orientation?: 'vertical' | 'horizontal'
  colorMode?: 'single' | 'palette'
  labelMode?: 'axis' | 'inside' | 'both'
  valueMode?: 'inside' | 'outside' | 'none'
  minBandSize?: number
}

export function BrLcBar({ nodes, measureKey, sortBy = 'index', orientation = 'vertical', colorMode = 'single', labelMode = 'axis', valueMode = 'none', minBandSize = 0, onUpdate }: BarProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  // orientation + display options in shapeKey so changing any forces a remount (re-runs scene()).
  const displayKey = `${orientation}|${colorMode}|${labelMode}|${valueMode}|${minBandSize}`
  const ref = useLiveFlatElement<{ label: string; value: number }>({
    tag: 'v-br-bar', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey: `${displayKey}|${measureKey}|${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`,
    build: () => leaves.map(n => ({ label: n.name, value: n.measures[measureKey] ?? 1 })),
    onMount: (el: any) => { el.orientation = orientation; el.sortBy = sortBy; el.colorMode = colorMode; el.labelMode = labelMode; el.valueMode = valueMode; el.minBandSize = minBandSize },
    readValue: d => d.value, writeValue: (d, v) => { d.value = v },
  }, nodes, onUpdate)
  useElProp(ref, 'sortBy', sortBy)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcPie({ nodes, measureKey, sortBy = 'index', onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  // MdPieChartLC backs each slice's value with a Num CELL (so the boundary
  // knob can use the canonical Vec.lens([a,b],...) pattern). build() passes
  // plain numbers (externalData's setter wraps them in num()); read/write go
  // through the live datum, whose .value IS the cell — hence d.value.value.
  const ref = useLiveFlatElement<{ label: string; value: Writable<Num> }>({
    tag: 'v-br-pie', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey: `${measureKey}|${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`,
    build: () => leaves.map(n => ({ label: n.name, value: n.measures[measureKey] ?? 1 })) as never,
    readValue: d => d.value.value, writeValue: (d, v) => { d.value.value = v },
  }, nodes, onUpdate)
  useElProp(ref, 'sortBy', sortBy)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcRadar({ nodes, measureKey, sortBy = 'index', onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const ref = useLiveFlatElement<{ name: string; value: number }>({
    tag: 'v-br-radar', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey: `${measureKey}|${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`,
    build: () => leaves.map(n => ({ name: n.name, value: n.measures[measureKey] ?? 1 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v },
  }, nodes, onUpdate)
  useElProp(ref, 'sortBy', sortBy)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcConcentricArc({ nodes, measureKey, sortBy = 'index', onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const palette = ['#e05c5c', '#f0a742', '#4cba6e', '#5b8def', '#b76de0', '#44c4c4']
  const ref = useLiveFlatElement<{ label: string; color: string; value: number }>({
    tag: 'v-br-concentric-arc', ids, measureKey,
    values: leaves.map(n => Math.min(100, n.measures[measureKey] ?? 0)),
    shapeKey: `${measureKey}|${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`,
    build: () => leaves.map((n, i) => ({ label: n.name, color: palette[i % 6]!, value: Math.min(100, n.measures[measureKey] ?? 0) })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = Math.min(100, v) },
  }, nodes, onUpdate)
  useElProp(ref, 'sortBy', sortBy)
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
    values: leaves.map(n => n.measures[yKey] ?? 0),
    shapeKey: `${xKey}|${yKey}|${[...ids].sort().join(',')}`,
    build: () => leaves.map((n, i) => ({ x: xKey === '_index' ? i : (n.measures[xKey] ?? 0), y: n.measures[yKey] ?? 0 })),
    readValue: d => d.y, writeValue: (d, v) => { d.y = v },
  }, nodes, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Time-series (index as x, measure as y) ───────────────────────────────────

const SERIES_START = new Date(2026, 0, 1).getTime()
const DAY_MS = 86400 * 1000

export function BrLcLine({ nodes, measureKey, sortBy = 'index', onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const ref = useLiveFlatElement<{ date: Date; value: number }>({
    tag: 'v-br-line', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey: `${measureKey}|${[...ids].sort().join(',')}`,
    build: () => leaves.map((n, i) => ({ date: new Date(SERIES_START + i * DAY_MS), value: n.measures[measureKey] ?? 0 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v },
  }, nodes, onUpdate)
  useElProp(ref, 'sortBy', sortBy)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcArea({ nodes, measureKey, sortBy = 'index', onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const ref = useLiveFlatElement<{ date: Date; value: number }>({
    tag: 'v-br-area', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey: `${measureKey}|${[...ids].sort().join(',')}`,
    build: () => leaves.map((n, i) => ({ date: new Date(SERIES_START + i * DAY_MS), value: n.measures[measureKey] ?? 0 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v },
  }, nodes, onUpdate)
  useElProp(ref, 'sortBy', sortBy)
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
  maxDepth?: number
}

export function useLiveHierElement(
  tag: string,
  nodes: PNode[],
  measureKey: string,
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void,
  onUpdateMany?: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void,
  depth?: number,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const elRef = useRef<ElWithRoot | null>(null)
  const rootRef = useRef<BiNode | null>(null)
  const leavesRef = useRef<BiNode[]>([])
  const disposeRef = useRef<(() => void) | undefined>(undefined)
  // last[id] = exact value considered in sync with the store, to suppress echo.
  const lastRef = useRef<Map<string, number>>(new Map())
  const nodesRef = useRef(nodes); nodesRef.current = nodes
  const onUpdateRef = useRef(onUpdate); onUpdateRef.current = onUpdate
  const onUpdateManyRef = useRef(onUpdateMany); onUpdateManyRef.current = onUpdateMany

  // Shape: rebuild when tree structure, measureKey, or depth changes.
  const shapeKey = `${measureKey}|${depth ?? 'all'}|${nodes.map(n => `${n.id}:${n.parentId ?? ''}`).join(',')}`
  // Per-leaf store values, applied in place on change. Keyed on the exact
  // (precision-stable) value so fractional edits still trigger apply-in.
  const valueKey = nodes.map(n => `${n.id}:${vkey(n.measures[measureKey] ?? 0)}`).join(',')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const root = buildBiTree(nodes, measureKey)
    rootRef.current = root
    if (!root) return
    const leaves = leavesOf(root) as BiNode[]
    leavesRef.current = leaves
    lastRef.current = new Map(leaves.map(l => [l.value.id, l.value.total.value]))

    const el = document.createElement(tag) as ElWithRoot
    el.setAttribute('no-source', '')
    el.externalRoot = root
    if (depth !== undefined) el.maxDepth = depth
    container.appendChild(el)
    elRef.current = el

    // Cross-tile hover/select sync: appending connected the element, so its
    // scene() ran and installed `brSync`. Bind it to the hudStore both ways.
    const unbindHud = bindHudSync(el as ElWithBrSync)

    // Edit-out: leaf total changes (gesture redistribution) → store.
    //
    // Group resizes flow through a Num.lens that rescales children
    // *proportionally* — producing fractional leaf values (e.g. 31 → 30.65).
    // We push those exact floats to the store. Crucially we do NOT quantize the
    // live leaf cells: rounding them mid-flush would erase any sub-unit sibling
    // delta (a +1 parent resize redistributes ~0.5 to each of two siblings),
    // making parent resize additive instead of conservative. The tree is the
    // source of truth during a gesture and carries fractional values, exactly
    // like the standalone layercharts demo.
    disposeRef.current = biEffect(() => {
      const last = lastRef.current
      const cb = onUpdateRef.current
      const cbMany = onUpdateManyRef.current
      const pending: Array<{ id: string; measures: PNode['measures'] }> = []
      const byId = new Map(nodesRef.current.map(n => [n.id, n]))
      for (const leaf of leaves) {
        const v = leaf.value.total.value
        const prev = last.get(leaf.value.id)
        if (prev === undefined || !near(v, prev)) {
          last.set(leaf.value.id, v)
          const node = byId.get(leaf.value.id)
          if (node && (cb || cbMany)) pending.push({ id: node.id, measures: { ...node.measures, [measureKey]: v } })
        }
      }
      // Parent resize redistributes across siblings → several leaves change on
      // one tick. Emit them as ONE batch so they don't clobber each other
      // through React's stale-workspace closure (separate updateRow calls each
      // start from the same snapshot, so only the last would survive). Defer out
      // of the bireactive flush to avoid re-entering React setState mid-flush.
      if (pending.length) queueMicrotask(() => {
        if (cbMany) cbMany(pending)
        else if (cb) for (const p of pending) cb(p.id, p.measures)
      })
    })

    return () => {
      unbindHud()
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
      const target = node.measures[measureKey] ?? 0
      if (!near(leaf.value.total.value, target)) {
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
  depth?: number
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void
}

export function BrLcPack({ nodes, measureKey, depth, onUpdate, onUpdateMany }: HierProps) {
  const ref = useLiveHierElement('v-br-pack', nodes, measureKey, onUpdate, onUpdateMany, depth)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcTreemap({ nodes, measureKey, depth, onUpdate, onUpdateMany }: HierProps) {
  const ref = useLiveHierElement('v-br-treemap', nodes, measureKey, onUpdate, onUpdateMany, depth)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcIcicle({ nodes, measureKey, depth, onUpdate, onUpdateMany }: HierProps) {
  const ref = useLiveHierElement('v-br-icicle', nodes, measureKey, onUpdate, onUpdateMany, depth)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcSunburst({ nodes, measureKey, depth, onUpdate, onUpdateMany }: HierProps) {
  const ref = useLiveHierElement('v-br-sunburst', nodes, measureKey, onUpdate, onUpdateMany, depth)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcTree({ nodes, measureKey, onUpdate, onUpdateMany }: HierProps) {
  const ref = useLiveHierElement('v-br-tree', nodes, measureKey, onUpdate, onUpdateMany)
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

// ─── Sankey (conservation flow) ─────────────────────────────────────────────────
// Self-contained conservation demo — takes no node data; just mount the element.
export function BrLcSankeyFlow() {
  const ref = useBrElement<MdSankeyFlow>('v-br-sankey-flow', () => {}, [])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}
