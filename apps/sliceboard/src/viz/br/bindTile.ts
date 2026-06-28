/**
 * bindTile.ts — framework-agnostic binding layer between the sliceboard store
 * and BR-LC custom elements. No React imports. The React host (BrLcTile.tsx)
 * just calls bindTile() on mount and update() on every render.
 *
 * Port of the logic from useLiveFlatElement / useLiveHierElement in BrLcCharts.tsx.
 * Behavior is IDENTICAL — same echo suppression, freeze, commit re-sort, batching.
 */

import { effect as biEffect, leavesOf } from 'bireactive'
import type { Cell, Num, Writable } from 'bireactive'
import type { PNode } from '../../persistence'
import { buildBiTree } from './tree'
import type { BiNode } from './tree'
import { hudStore } from '../../store'

// ─── Epsilon + helpers ────────────────────────────────────────────────────────

const EPS = 1e-6
export const near = (a: number, b: number) => Math.abs(a - b) < EPS

/** Stable string key for a value — quantized to kill float noise but fine-grained
 *  enough that real fractional edits still differ. */
export const vkey = (v: number) => (Math.round(v * 1000) / 1000).toString()

// ─── HUD sync ────────────────────────────────────────────────────────────────

interface BrSyncBridge {
  setExternalHover(id: string | null): void
  setExternalSelect(id: string | null): void
  onHover(cb: (id: string | null) => void): () => void
  onSelect(cb: (id: string | null) => void): () => void
}
interface ElWithBrSync extends HTMLElement { brSync?: BrSyncBridge }

/**
 * Wire a mounted BR-LC element to the sliceboard hudStore in both directions.
 * Echo-suppressed: we skip pushing a value the element just reported.
 * Returns a disposer.
 */
export function bindHudSync(el: ElWithBrSync): () => void {
  const bridge = el.brSync
  if (!bridge) return () => {}
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

// ─── TileSource contract ──────────────────────────────────────────────────────

export interface TileSource {
  tag: string
  /** Rebuild the element only when this changes (shape: row set / measure / display options). */
  shapeKey: string
  /** Set props that scene() reads on connect, before the element is appended. */
  mountProps?: (el: HTMLElement) => void
  /** Push current display-ordered data into the element. */
  applyData: (el: HTMLElement, opts: { gestureActive: boolean; lastRef: Map<string, number> }) => void
  /** Wire the element's own edits out to the store. Returns a disposer. */
  bindEditOut: (el: HTMLElement, lastRef: Map<string, number>) => () => void
  /** For bindHudSync */
  hudStore: typeof hudStore
  /** Compute the initial lastRef map after first build (called after el.externalData/externalRoot is set). */
  initialLast: (el: HTMLElement) => Map<string, number>
  /**
   * Called by bindTile.update() when shapeKey is unchanged — lets the mounted
   * source's internal closures pick up the latest callbacks/data from the next
   * source without a remount. Optional: sources that have no mutable internal
   * state can omit this.
   */
  syncFrom?: (next: TileSource) => void
}

// ─── bindTile controller ──────────────────────────────────────────────────────

interface ElWithGesture extends HTMLElement { gestureActive?: boolean }

export interface TileController {
  update: (nextSource: TileSource) => void
  dispose: () => void
}

/**
 * Mount a BR-LC custom element into container, wiring hud sync, edit-out,
 * gesturecommit handling, and reactive data apply. Returns a controller the
 * React host calls on every render (update) and on unmount (dispose).
 */
export function bindTile(container: HTMLElement, source: TileSource): TileController {
  // currentSourceRef is used by the gesturecommit handler so it always calls
  // the latest applyData even after same-shapeKey updates.
  const currentSourceRef = { current: source }
  let el: ElWithGesture | null = null
  let lastRef = new Map<string, number>()
  let unbindHud: () => void = () => {}
  let unbindEditOut: () => void = () => {}

  function mount(src: TileSource) {
    currentSourceRef.current = src
    const newEl = document.createElement(src.tag) as ElWithGesture
    newEl.setAttribute('no-source', '')
    src.mountProps?.(newEl)
    // mountProps sets externalData/externalRoot so scene() reads it on connectedCallback.
    container.appendChild(newEl)
    el = newEl

    // Initialize last echo map (after append so dataCell is initialized by scene())
    lastRef = src.initialLast(newEl)

    // HUD sync — element is connected so brSync is set
    unbindHud = bindHudSync(newEl as ElWithBrSync)

    // Edit-out subscription — uses src's internal refs (updated via _syncRefs on same-shapeKey update)
    unbindEditOut = src.bindEditOut(newEl, lastRef)

    // gesturecommit → re-run applyData with gestureActive:false (the single commit re-sort).
    // Reads currentSourceRef.current so it picks up the latest spec after same-shapeKey updates.
    const onCommit = () => {
      if (el) currentSourceRef.current.applyData(el, { gestureActive: false, lastRef })
    }
    newEl.addEventListener('gesturecommit', onCommit)
    ;(newEl as any)._commitHandler = onCommit

    // Initial data push (element is connected, dataCell is live)
    src.applyData(newEl, { gestureActive: false, lastRef })
  }

  function dismount() {
    if (!el) return
    el.removeEventListener('gesturecommit', (el as any)._commitHandler)
    unbindHud()
    unbindEditOut()
    if (container.contains(el)) container.removeChild(el)
    el = null
    lastRef = new Map()
  }

  // Initial mount
  mount(source)

  // Track shapeKey of the currently mounted source for rebuild detection
  let mountedShapeKey = source.shapeKey

  return {
    update(nextSource: TileSource) {
      if (nextSource.shapeKey !== mountedShapeKey) {
        // Shape changed: full dismount + remount
        dismount()
        mountedShapeKey = nextSource.shapeKey
        mount(nextSource)
      } else {
        // Same shape: sync internal refs on the MOUNTED source so its closures
        // pick up latest callbacks/data (React re-creates callbacks each render).
        // Then push data (freeze-aware). currentSourceRef.current is updated
        // so the gesturecommit handler also uses fresh data.
        currentSourceRef.current.syncFrom?.(nextSource)
        currentSourceRef.current = nextSource
        if (el) {
          nextSource.applyData(el, { gestureActive: !!el.gestureActive, lastRef })
        }
      }
    },
    dispose() {
      dismount()
    },
  }
}

// ─── makeFlatSource ───────────────────────────────────────────────────────────

interface ElWithDataCell<D> extends HTMLElement {
  dataCell: Writable<Cell<readonly D[]>>
  externalData?: unknown
  gestureActive?: boolean
}

export interface FlatSpec<D> {
  tag: string
  ids: string[]
  build: () => D[]
  readValue: (d: D) => number
  writeValue: (d: D, v: number) => void
  idOf: (d: D) => string
  reindex?: (d: D, displayIndex: number) => void
  values: number[]
  shapeKey: string
  measureKey: string
  mountProps?: (el: HTMLElement) => void
  nodes: PNode[]
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void
}

export function makeFlatSource<D>(spec: FlatSpec<D>): TileSource {
  // Mutable refs so the stable edit-out closure always reads the latest spec.
  const specRef = { current: spec }
  const nodesRef = { current: spec.nodes }
  const onUpdateRef = { current: spec.onUpdate }
  const onUpdateManyRef = { current: spec.onUpdateMany }

  const source: TileSource = {
    tag: spec.tag,
    shapeKey: spec.shapeKey,
    hudStore,

    mountProps(el: HTMLElement) {
      // Set initial externalData before append so scene() reads it on connect.
      const typedEl = el as ElWithDataCell<D>
      typedEl.externalData = specRef.current.build()
      specRef.current.mountProps?.(el)
    },

    initialLast(el: HTMLElement): Map<string, number> {
      const typedEl = el as ElWithDataCell<D>
      const s = specRef.current
      const arr = typedEl.dataCell?.value as D[] ?? []
      return new Map(arr.map(d => [s.idOf(d), s.readValue(d)]))
    },

    applyData(el: HTMLElement, { gestureActive, lastRef }) {
      const typedEl = el as ElWithDataCell<D>
      if (!typedEl.dataCell) return
      const s = specRef.current
      const arr = typedEl.dataCell.value as D[]
      const valueById = new Map<string, number>()
      for (let j = 0; j < s.ids.length; j++) valueById.set(s.ids[j]!, s.values[j]!)

      if (gestureActive) {
        // Frozen: values update live, order held.
        let touched = false
        for (const d of arr) {
          const id = s.idOf(d); const target = valueById.get(id)
          if (target !== undefined && !near(s.readValue(d), target)) {
            s.writeValue(d, target); lastRef.set(id, target); touched = true
          }
        }
        if (touched) typedEl.dataCell.value = [...arr]
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
        lastRef.set(id, s.readValue(d))
        s.reindex?.(d, k)
        if (arr[k] !== d) orderChanged = true
        newArr.push(d)
      }
      if (orderChanged || touched || newArr.length !== arr.length) typedEl.dataCell.value = newArr
    },

    bindEditOut(el: HTMLElement, lastRef: Map<string, number>): () => void {
      const typedEl = el as ElWithDataCell<D>
      const dispose = biEffect(() => {
        const arr = typedEl.dataCell?.value as D[]
        if (!arr) return
        const s = specRef.current
        const cb = onUpdateRef.current
        const cbMany = onUpdateManyRef.current
        const last = lastRef
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
        // React's stale-snapshot closure.
        if (pending.length) queueMicrotask(() => {
          if (cbMany) { cbMany(pending) }
          else if (cb) { for (const p of pending) cb(p.id, p.measures) }
        })
      })
      return dispose
    },

    syncFrom(next: TileSource) {
      // Pull the latest spec out of the incoming source object.
      // The next source was also created by makeFlatSource and carries _spec.
      const nextSpec = (next as any)._spec as FlatSpec<D> | undefined
      if (!nextSpec) return
      specRef.current = nextSpec
      nodesRef.current = nextSpec.nodes
      onUpdateRef.current = nextSpec.onUpdate
      onUpdateManyRef.current = nextSpec.onUpdateMany
    },
  }

  // Stash the raw spec on the source so syncFrom on the MOUNTED source can read
  // the latest data from the incoming source.
  ;(source as any)._spec = spec

  return source
}

// ─── makeHierSource ───────────────────────────────────────────────────────────

interface ElWithRoot extends HTMLElement {
  externalRoot?: BiNode
  maxDepth?: number
}

export interface HierSpec {
  tag: string
  nodes: PNode[]
  measureKey: string
  depth?: number
  sortBy?: 'index' | 'value'
  shapeKey: string
  valueKey: string
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void
}

export function makeHierSource(spec: HierSpec): TileSource {
  const nodesRef = { current: spec.nodes }
  const onUpdateRef = { current: spec.onUpdate }
  const onUpdateManyRef = { current: spec.onUpdateMany }
  const leavesRef = { current: [] as BiNode[] }
  const measureKeyRef = { current: spec.measureKey }

  const source: TileSource = {
    tag: spec.tag,
    shapeKey: spec.shapeKey,
    hudStore,

    mountProps(el: HTMLElement) {
      const root = buildBiTree(nodesRef.current, measureKeyRef.current)
      if (!root) return
      const leaves = leavesOf(root) as BiNode[]
      leavesRef.current = leaves
      const typedEl = el as ElWithRoot
      typedEl.externalRoot = root
      if (spec.depth !== undefined) typedEl.maxDepth = spec.depth
    },

    initialLast(_el: HTMLElement): Map<string, number> {
      return new Map(leavesRef.current.map(l => [l.value.id, l.value.total.value]))
    },

    applyData(_el: HTMLElement, { lastRef }) {
      // Apply external store changes into the live leaf cells, in place.
      const byId = new Map(nodesRef.current.map(n => [n.id, n]))
      for (const leaf of leavesRef.current) {
        const node = byId.get(leaf.value.id)
        if (!node) continue
        const target = node.measures[measureKeyRef.current] ?? 0
        if (!near(leaf.value.total.value, target)) {
          leaf.value.total.value = target
          lastRef.set(leaf.value.id, target)
        }
      }
    },

    bindEditOut(_el: HTMLElement, lastRef: Map<string, number>): () => void {
      const dispose = biEffect(() => {
        const last = lastRef
        const cb = onUpdateRef.current
        const cbMany = onUpdateManyRef.current
        const pending: Array<{ id: string; measures: PNode['measures'] }> = []
        const byId = new Map(nodesRef.current.map(n => [n.id, n]))
        for (const leaf of leavesRef.current) {
          const v = leaf.value.total.value
          const prev = last.get(leaf.value.id)
          if (prev === undefined || !near(v, prev)) {
            last.set(leaf.value.id, v)
            const node = byId.get(leaf.value.id)
            if (node && (cb || cbMany)) pending.push({ id: node.id, measures: { ...node.measures, [measureKeyRef.current]: v } })
          }
        }
        // Parent resize redistributes across siblings → several leaves change on
        // one tick. Emit as ONE batch so they don't clobber each other.
        if (pending.length) queueMicrotask(() => {
          if (cbMany) cbMany(pending)
          else if (cb) for (const p of pending) cb(p.id, p.measures)
        })
      })
      return dispose
    },

    syncFrom(next: TileSource) {
      const nextSpec = (next as any)._spec as HierSpec | undefined
      if (!nextSpec) return
      nodesRef.current = nextSpec.nodes
      onUpdateRef.current = nextSpec.onUpdate
      onUpdateManyRef.current = nextSpec.onUpdateMany
      measureKeyRef.current = nextSpec.measureKey
    },
  }

  ;(source as any)._spec = spec

  return source
}

// ─── Hier value key helper (exported for use in component wrappers) ───────────

export function hierValueKey(nodes: PNode[], measureKey: string): string {
  return nodes.map(n => `${n.id}:${vkey(n.measures[measureKey] ?? 0)}`).sort().join(',')
}

export function hierShapeKey(tag: string, nodes: PNode[], measureKey: string, depth?: number, sortBy?: string): string {
  return `${tag}|${measureKey}|${depth ?? 'all'}|${sortBy ?? 'index'}|${nodes.map(n => `${n.id}:${n.parentId ?? ''}`).sort().join(',')}`
}
