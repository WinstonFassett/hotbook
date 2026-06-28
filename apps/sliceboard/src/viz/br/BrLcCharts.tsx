import { useEffect, useRef, useState } from 'react'
import { effect as biEffect, leavesOf } from 'bireactive'
import type { Cell, Num, Writable } from 'bireactive'
import type { PNode, PEdge } from '../../persistence'
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

import {
  MdBarChartLC,
  MdLineChartLC,
  MdAreaChartLC,
  MdScatterChartLC,
  MdPieChartLC,
  MdRadarChartLC,
  MdConcentricArcLC,
  MdPack,
  MdTreemapLC,
  MdIcicleLC,
  MdSunburstLC,
  MdSankeySimple,
  MdSankeyFlow,
  MdTreeChart,
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
  /** Stable identity of a datum (its PNode id). Bridge + reorder key on this. */
  idOf: (d: D) => string
  /** Optional: reassign a datum's positional x when it moves to displayIndex.
   *  line/area/scatter(_index) use this so sort reorders the x-axis; categorical
   *  charts (bar/pie/radar/arc) leave it undefined (x is slot-positional). */
  reindex?: (d: D, displayIndex: number) => void
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
  onUpdateMany?: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const elRef = useRef<ElWithDataCell<D> | null>(null)
  const disposeRef = useRef<(() => void) | undefined>(undefined)
  // Bumped when the element fires `gesturecommit` (gesture just ended). The last
  // value change happens DURING the frozen gesture, so without this nudge the
  // apply-in effect never re-runs after the freeze lifts and the commit re-sort
  // would never happen.
  const [commitTick, setCommitTick] = useState(0)
  // id → last value considered already in sync (echo suppression). Keyed by the
  // datum's stable id, so it survives any reorder.
  const lastRef = useRef<Map<string, number>>(new Map())
  // Latest spec/nodes/onUpdate for the (stable) edit-out subscription to read.
  const specRef = useRef(spec); specRef.current = spec
  const nodesRef = useRef(nodes); nodesRef.current = nodes
  const onUpdateRef = useRef(onUpdate); onUpdateRef.current = onUpdate
  const onUpdateManyRef = useRef(onUpdateMany); onUpdateManyRef.current = onUpdateMany
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
    const s0 = specRef.current
    lastRef.current = new Map((el.dataCell.value as D[]).map(d => [s0.idOf(d), s0.readValue(d)]))

    // Cross-tile hover/select sync. The element now emits a datum's stable id
    // directly (not an array index), so the plain id-keyed bridge wires straight
    // through to the store — no index↔id translation, no frozen build order.
    const unbindHud = bindHudSync(el as ElWithBrSync)

    // Gesture-commit nudge: the element fires this when a drag/wheel ends, so the
    // apply-in effect re-runs with gestureActive=false → the single commit re-sort.
    const onCommit = () => setCommitTick(t => t + 1)
    el.addEventListener('gesturecommit', onCommit)

    // Edit-out: the element's own gesture changed a value → push to store, keyed
    // by the datum's stable id (correct regardless of display order).
    disposeRef.current = biEffect(() => {
      const arr = el.dataCell.value as D[]
      const s = specRef.current
      const cb = onUpdateRef.current
      const cbMany = onUpdateManyRef.current
      const last = lastRef.current
      if (!cb && !cbMany) { for (const d of arr) last.set(s.idOf(d), s.readValue(d)); return }
      const byId = new Map(nodesRef.current.map(n => [n.id, n]))
      const pending: Array<{ id: string; measures: PNode['measures'] }> = []
      for (const d of arr) {
        const id = s.idOf(d)
        const v = s.readValue(d)
        if (!near(v, last.get(id) ?? NaN)) {
          last.set(id, v)
          const node = byId.get(id)
          if (node) pending.push({ id, measures: { ...node.measures, [s.measureKey]: v } })
        }
      }
      // Defer out of the bireactive flush. When multiple datums change in one
      // flush (e.g. pie divider drag edits two adjacent slices atomically),
      // emit as ONE batch via cbMany so they don't clobber each other through
      // React's stale-snapshot closure (separate cb calls each start from the
      // same snapshot, so only the last would survive).
      if (pending.length) queueMicrotask(() => {
        if (cbMany) { cbMany(pending) }
        else if (cb) { for (const p of pending) cb(p.id, p.measures) }
      })
    })

    return () => {
      unbindHud()
      el.removeEventListener('gesturecommit', onCommit)
      disposeRef.current?.()
      disposeRef.current = undefined
      if (container.contains(el)) container.removeChild(el)
      elRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.tag, spec.shapeKey])

  // Apply store changes. SORT LIVES HERE (sliceboard), not in the chart.
  //
  // Sliceboard hands the element its data in the desired DISPLAY order (spec.ids,
  // value-sorted upstream when the tile sorts by value). This effect rebuilds the
  // element's array into that order, reusing the SAME datum objects so the
  // element's hover/selection refs survive the reorder. The chart just draws the
  // array order it's given — it owns no sort.
  //
  // FREEZE (interaction-principles Rule 7): while a gesture is live we do NOT
  // reorder — we only write values in place, holding the order the user grabbed.
  // The freeze releases on gesture end; the next apply-in reorders once — the
  // single deliberate commit re-sort.
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const s = spec
    const arr = el.dataCell.value as D[]
    const valueById = new Map<string, number>()
    for (let j = 0; j < s.ids.length; j++) valueById.set(s.ids[j]!, s.values[j]!)

    if (el.gestureActive) {
      // Frozen: values update live, order held.
      let touched = false
      for (const d of arr) {
        const id = s.idOf(d); const target = valueById.get(id)
        if (target !== undefined && !near(s.readValue(d), target)) {
          s.writeValue(d, target); lastRef.current.set(id, target); touched = true
        }
      }
      if (touched) el.dataCell.value = [...arr]
      return
    }

    // Idle/commit: rebuild in display order (same datum objects), write values,
    // reassign positional x where the chart needs it.
    const datumById = new Map<string, D>(arr.map(d => [s.idOf(d), d]))
    const newArr: D[] = []
    let orderChanged = false
    let touched = false
    for (let k = 0; k < s.ids.length; k++) {
      const id = s.ids[k]!
      const d = datumById.get(id)
      if (!d) continue
      const target = valueById.get(id)
      if (target !== undefined && !near(s.readValue(d), target)) { s.writeValue(d, target); touched = true }
      lastRef.current.set(id, s.readValue(d))
      s.reindex?.(d, k)
      if (arr[k] !== d) orderChanged = true
      newArr.push(d)
    }
    if (orderChanged || touched || newArr.length !== arr.length) el.dataCell.value = newArr
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.values.join(','), spec.ids.join(','), commitTick])

  return containerRef
}

// ─── Flat charts (label + value) ─────────────────────────────────────────────

interface FlatProps {
  nodes: PNode[]
  measureKey: string
  maxItems?: number
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void
}

function leavesOfNodes(nodes: PNode[]): PNode[] {
  return nodes.filter(n => !nodes.some(m => m.parentId === n.id))
}

interface BarProps extends FlatProps {
  orientation?: 'vertical' | 'horizontal'
  colorMode?: 'single' | 'palette'
  labelMode?: 'axis' | 'inside' | 'both'
  valueMode?: 'inside' | 'outside' | 'none'
  minBandSize?: number
}

export function BrLcBar({ nodes, measureKey, maxItems, orientation = 'vertical', colorMode = 'single', labelMode = 'axis', valueMode = 'none', minBandSize = 0, onUpdate }: BarProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  // orientation + display options in shapeKey so changing any forces a remount (re-runs scene()).
  const displayKey = `${orientation}|${colorMode}|${labelMode}|${valueMode}|${minBandSize}|${maxItems ?? 0}`
  const maxProp = orientation === 'horizontal' ? 'maxBands' : 'maxBars'
  const ref = useLiveFlatElement<{ id: string; label: string; value: number }>({
    tag: 'v-br-bar', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey: `${displayKey}|${measureKey}|${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`,
    build: () => leaves.map(n => ({ id: n.id, label: n.name, value: n.measures[measureKey] ?? 1 })),
    onMount: (el: any) => { el.orientation = orientation; el.colorMode = colorMode; el.labelMode = labelMode; el.valueMode = valueMode; el.minBandSize = minBandSize; if (maxItems !== undefined) el[maxProp] = maxItems },
    readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
  }, nodes, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcPie({ nodes, measureKey, onUpdate, onUpdateMany }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  // MdPieChartLC backs each slice's value with a Num CELL (so the boundary
  // knob can use the canonical Vec.lens([a,b],...) pattern). build() passes
  // plain numbers (externalData's setter wraps them in num()); read/write go
  // through the live datum, whose .value IS the cell — hence d.value.value.
  const ref = useLiveFlatElement<{ id: string; label: string; value: Writable<Num> }>({
    tag: 'v-br-pie', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey: `${measureKey}|${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`,
    build: () => leaves.map(n => ({ id: n.id, label: n.name, value: n.measures[measureKey] ?? 1 })) as never,
    readValue: d => d.value.value, writeValue: (d, v) => { d.value.value = v }, idOf: d => d.id,
  }, nodes, onUpdate, onUpdateMany)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcRadar({ nodes, measureKey, onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const ref = useLiveFlatElement<{ id: string; name: string; value: number }>({
    tag: 'v-br-radar', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey: `${measureKey}|${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`,
    build: () => leaves.map(n => ({ id: n.id, name: n.name, value: n.measures[measureKey] ?? 1 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
  }, nodes, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcConcentricArc({ nodes, measureKey, maxItems, onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const palette = ['#e05c5c', '#f0a742', '#4cba6e', '#5b8def', '#b76de0', '#44c4c4']
  const ref = useLiveFlatElement<{ id: string; label: string; color: string; value: number }>({
    tag: 'v-br-concentric-arc', ids, measureKey,
    values: leaves.map(n => Math.min(100, n.measures[measureKey] ?? 0)),
    shapeKey: `${measureKey}|${maxItems ?? ''}|${[...ids].sort().join(',')}|${[...leaves].sort((a,b)=>a.id<b.id?-1:1).map(n=>n.name).join(',')}`,
    build: () => leaves.map((n, i) => ({ id: n.id, label: n.name, color: palette[i % 6]!, value: Math.min(100, n.measures[measureKey] ?? 0) })),
    onMount: (el: any) => { if (maxItems !== undefined) el.maxRings = maxItems },
    readValue: d => d.value, writeValue: (d, v) => { d.value = Math.min(100, v) }, idOf: d => d.id,
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
  const ref = useLiveFlatElement<{ id: string; x: number; y: number }>({
    tag: 'v-br-scatter', ids, measureKey: yKey,
    values: leaves.map(n => n.measures[yKey] ?? 0),
    shapeKey: `${xKey}|${yKey}|${[...ids].sort().join(',')}`,
    build: () => leaves.map((n, i) => ({ id: n.id, x: xKey === '_index' ? i : (n.measures[xKey] ?? 0), y: n.measures[yKey] ?? 0 })),
    readValue: d => d.y, writeValue: (d, v) => { d.y = v }, idOf: d => d.id,
    // Only synthetic-index scatter reorders its x; a real measure x stays put.
    reindex: xKey === '_index' ? (d, k) => { d.x = k } : undefined,
  }, nodes, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Time-series (index as x, measure as y) ───────────────────────────────────

const SERIES_START = new Date(2026, 0, 1).getTime()
const DAY_MS = 86400 * 1000

export function BrLcLine({ nodes, measureKey, onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const ref = useLiveFlatElement<{ id: string; date: Date; value: number }>({
    tag: 'v-br-line', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey: `${measureKey}|${[...ids].sort().join(',')}`,
    build: () => leaves.map((n, i) => ({ id: n.id, date: new Date(SERIES_START + i * DAY_MS), value: n.measures[measureKey] ?? 0 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
    // x is positional: when sort reorders the series, the date follows the slot.
    reindex: (d, k) => { d.date = new Date(SERIES_START + k * DAY_MS) },
  }, nodes, onUpdate)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcArea({ nodes, measureKey, onUpdate }: FlatProps) {
  const leaves = leavesOfNodes(nodes)
  const ids = leaves.map(n => n.id)
  const ref = useLiveFlatElement<{ id: string; date: Date; value: number }>({
    tag: 'v-br-area', ids, measureKey,
    values: leaves.map(n => n.measures[measureKey] ?? 0),
    shapeKey: `${measureKey}|${[...ids].sort().join(',')}`,
    build: () => leaves.map((n, i) => ({ id: n.id, date: new Date(SERIES_START + i * DAY_MS), value: n.measures[measureKey] ?? 0 })),
    readValue: d => d.value, writeValue: (d, v) => { d.value = v }, idOf: d => d.id,
    reindex: (d, k) => { d.date = new Date(SERIES_START + k * DAY_MS) },
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
  maxDepth?: number
}

export function useLiveHierElement(
  tag: string,
  nodes: PNode[],
  measureKey: string,
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void,
  onUpdateMany?: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void,
  depth?: number,
  sortBy?: 'index' | 'value',
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

  // Shape: rebuild when tree STRUCTURE, measureKey, depth, or sort MODE changes.
  // Structure is built from parentId (order-independent), so the id:parent pairs
  // are sorted — a value-sort that reorders `nodes` mid-edit must NOT flip the key
  // (that remounts and drops the in-flight gesture). But the sort MODE belongs in
  // the key: buildBiTree orders children by n.index, which App reassigns on a sort
  // toggle, so toggling must rebuild (else the new order needs a page reload).
  const shapeKey = `${measureKey}|${depth ?? 'all'}|${sortBy ?? 'index'}|${nodes.map(n => `${n.id}:${n.parentId ?? ''}`).sort().join(',')}`
  // Per-leaf store values, applied in place on change. Keyed on the exact
  // (precision-stable) value so fractional edits still trigger apply-in. Sorted
  // by id so reorder alone doesn't churn it (only real value changes do).
  const valueKey = nodes.map(n => `${n.id}:${vkey(n.measures[measureKey] ?? 0)}`).sort().join(',')

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
  sortBy?: 'index' | 'value'
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void
}

export function BrLcPack({ nodes, measureKey, depth, sortBy, onUpdate, onUpdateMany }: HierProps) {
  const ref = useLiveHierElement('v-br-pack', nodes, measureKey, onUpdate, onUpdateMany, depth, sortBy)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcTreemap({ nodes, measureKey, depth, sortBy, onUpdate, onUpdateMany }: HierProps) {
  const ref = useLiveHierElement('v-br-treemap', nodes, measureKey, onUpdate, onUpdateMany, depth, sortBy)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcIcicle({ nodes, measureKey, depth, sortBy, onUpdate, onUpdateMany }: HierProps) {
  const ref = useLiveHierElement('v-br-icicle', nodes, measureKey, onUpdate, onUpdateMany, depth, sortBy)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcSunburst({ nodes, measureKey, depth, sortBy, onUpdate, onUpdateMany }: HierProps) {
  const ref = useLiveHierElement('v-br-sunburst', nodes, measureKey, onUpdate, onUpdateMany, depth, sortBy)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcTree({ nodes, measureKey, sortBy, onUpdate, onUpdateMany }: HierProps) {
  const ref = useLiveHierElement('v-br-tree', nodes, measureKey, onUpdate, onUpdateMany, undefined, sortBy)
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
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

// ─── Sankey (conservation flow) ─────────────────────────────────────────────────
// Self-contained conservation demo — takes no node data; just mount the element.
export function BrLcSankeyFlow() {
  const ref = useBrElement<MdSankeyFlow>('v-br-sankey-flow', () => {}, [])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}
