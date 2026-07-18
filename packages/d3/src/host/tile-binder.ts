/**
 * tile-binder.ts — framework-agnostic binding layer between a reactive store
 * and BR-LC custom elements.
 *
 * Extracted from apps/hotbook/src/viz/br/bindTile.ts.
 * No React imports. No hotbook-specific imports.
 *
 * The host (e.g. hotbook's BrLcTile.tsx) calls:
 *   bindTile(container, source, bindHud)
 * where `bindHud` is a host-supplied function that wires the element's
 * hover/select/drill to whatever HUD store the host uses.
 */

import { effect as biEffect, leavesOf, walkTree } from 'bireactive'
import type { Cell, Num, Writable } from 'bireactive'
import type { VizNode } from '@hotbook/core'
import { numberDrag } from '@hotbook/bireactive'
import { buildBiTree } from './biTree'
import type { BiNode } from './biTree'

// ─── Epsilon + helpers ────────────────────────────────────────────────────────

const EPS = 1e-6
export const near = (a: number, b: number) => Math.abs(a - b) < EPS

/** Stable string key for a value — quantized to kill float noise but fine-grained
 *  enough that real fractional edits still differ. */
export const vkey = (v: number) => (Math.round(v * 1000) / 1000).toString()

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
 * host calls on every render (update) and on unmount (dispose).
 *
 * @param bindHud  Host-supplied function that wires the element to its HUD
 *                 store (hover/select/drill). Returns a disposer. This is the
 *                 only host-specific seam: hotbook passes its `bindHudSync`;
 *                 other hosts supply their own or pass `() => () => {}`.
 */
export function bindTile(
  container: HTMLElement,
  source: TileSource,
  bindHud: (el: HTMLElement) => () => void,
): TileController {
  // currentSourceRef is used by the gesturecommit handler so it always calls
  // the latest applyData even after same-shapeKey updates.
  const currentSourceRef = { current: source }
  let el: ElWithGesture | null = null
  let lastRef = new Map<string, number>()
  let unbindHud: () => void = () => {}
  let unbindEditOut: () => void = () => {}
  let onCommit: ((e: Event) => void) | null = null

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

    // HUD sync — defer to next microtask to ensure scene() has run and brSync is set
    Promise.resolve().then(() => {
      if (el === newEl) {  // Only bind if element hasn't been dismounted
        unbindHud = bindHud(newEl)
      }
    })

    // Edit-out subscription — uses src's internal refs (updated via syncFrom on same-shapeKey update)
    unbindEditOut = src.bindEditOut(newEl, lastRef)

    // gesturecommit: charts dispatch this on gesture end (release or Esc-cancel).
    //
    // Why we need a trailing re-apply here at all:
    // The final value write of a gesture happens *during* the gesture, while
    // el.gestureActive is still true. bindEditOut pushes it to the store, which
    // round-trips back through update()→applyData — but that applyData runs with
    // gestureActive:true and takes the FROZEN branch (order held, per Rule 7). When
    // the gesture ends, onEnd() flips gestureActive→false and fires this event, but
    // it writes NO new value — so nothing re-triggers applyData, and the frozen
    // display order is never reconciled against the (already-correct) sorted store
    // state. Result: a same-chart edit that should reorder leaves the mark in place.
    // (Cross-tile edits never hit this because the receiving tile's gestureActive is
    // always false, so its applyData always takes the commit/reorder branch.)
    //
    // We must NOT call applyData synchronously in this handler — for an Esc-cancel,
    // the restore's value writes push to the store via bindEditOut's own
    // queueMicrotask, so a synchronous read would see stale pre-restore values and
    // clobber the restore. Deferring past that microtask lets specRef/lastRef settle
    // to the committed store values first; applyData({ gestureActive:false }) then
    // reindexes in fresh sort order off the settled state.
    onCommit = (e: Event) => {
      // Opt-in: only charts that send an explicit { canceled } detail participate in
      // the trailing re-apply. Charts that dispatch bare gesturecommit (no detail)
      // keep their exact prior behavior — no trailing re-apply — so this change's
      // blast radius is limited to the charts that adopted the detail contract
      // (currently bar/bands). Extend a chart into this path by having its onEnd
      // dispatch `new CustomEvent('gesturecommit', { detail: { canceled } })`.
      const detail = (e as CustomEvent).detail
      if (!detail || typeof detail.canceled !== 'boolean') return
      // On Esc-cancel the chart already restored the live cells and bindEditOut is
      // pushing those restored values to the store; re-applying here would read the
      // still-stale (pre-restore) specRef and clobber the revert. Let the store
      // round-trip own the cancel path. Only reconcile order on a real commit.
      if (detail.canceled) return
      queueMicrotask(() => {
        if (el === newEl && !newEl.gestureActive) {
          currentSourceRef.current.applyData(newEl, { gestureActive: false, lastRef })
        }
      })
    }
    newEl.addEventListener('gesturecommit', onCommit)

    // Initial data push (element is connected, dataCell is live)
    src.applyData(newEl, { gestureActive: false, lastRef })
  }

  function dismount() {
    if (!el) return
    unbindHud()
    unbindEditOut()
    if (onCommit) { el.removeEventListener('gesturecommit', onCommit); onCommit = null }
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
        // pick up latest callbacks/data (React re-creates callbacks each render),
        // then push data through the MOUNTED source — NOT nextSource. nextSource
        // was never mounted, so its mount-time state (hier leavesRef) is empty;
        // applyData on it would no-op and external edits would never reach the
        // live tree. Flat keeps data on el.dataCell so it survived either way;
        // hier did not. Keep currentSourceRef on the mounted source so the
        // gesturecommit handler also applies to the populated tree.
        const mounted = currentSourceRef.current
        mounted.syncFrom?.(nextSource)
        if (el) {
          // Freeze only the chart being actively edited (per-element flag set by
          // the chart's own gesture handlers). Other charts must update live —
          // that's the bidirectional viz promise. The global controller check
          // (0ffe125) froze ALL charts during ANY gesture, breaking cross-chart
          // sync: edits on one visible chart never reached the chart next to it
          // until the gesture ended and a tab switch forced a remount.
          mounted.applyData(el, { gestureActive: !!el.gestureActive, lastRef })
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
  measureKey?: string
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
  nodes: VizNode[]
  onUpdate?: (nodeId: string, measures: VizNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: VizNode['measures'] }>) => void
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

    mountProps(el: HTMLElement) {
      // Set initial externalData before append so scene() reads it on connect.
      const typedEl = el as ElWithDataCell<D>
      typedEl.externalData = specRef.current.build()
      specRef.current.mountProps?.(el)
    },

    initialLast(el: HTMLElement): Map<string, number> {
      const typedEl = el as ElWithDataCell<D>
      const s = specRef.current
      const arr = typedEl.dataCell?.peek() as D[] ?? []
      return new Map(arr.map(d => [s.idOf(d), s.readValue(d)]))
    },

    applyData(el: HTMLElement, { gestureActive, lastRef }) {
      const typedEl = el as ElWithDataCell<D>
      if (!typedEl.dataCell) return
      const s = specRef.current
      // Sync measureKey and re-apply settings (orientation, maxRings, etc.)
      // BEFORE data writes — charts with a reactive measureKey cell read it
      // untracked in their gate to classify the change as structural (animate)
      // vs value edit (snap). Same pattern as hier charts (WIN-143).
      ;(typedEl as any).measureKey = s.measureKey
      s.mountProps?.(el)
      // Use peek() to avoid registering dataCell as a bireactive dependency of
      // whatever effect called applyData. If we used .value here, the DockView
      // biEffect (which calls _syncChart → applyData) would re-fire on every
      // dataCell write, overwriting in-flight gesture edits with stale store values.
      const arr = typedEl.dataCell.peek() as D[]
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
        const pending: Array<{ id: string; measures: VizNode['measures'] }> = []
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
  drillNodeId?: string | null
  drillKey?: string
  showBreadcrumb?: boolean
  sortBy?: 'index' | 'value'
  orientation?: 'horizontal' | 'vertical'
  measureKey?: string
}

export interface HierSpec {
  tag: string
  nodes: VizNode[]
  measureKey: string
  depth?: number
  sortBy?: 'index' | 'value'
  orientation?: 'horizontal' | 'vertical'
  shapeKey: string
  valueKey: string
  drillNodeId?: string | null
  drillKey?: string
  showBreadcrumb?: boolean
  onUpdate?: (nodeId: string, measures: VizNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: VizNode['measures'] }>) => void
  enableNumberDrag?: {
    selector: string  // CSS selector prefix for editable elements, e.g., '[data-editable-value'
    pxPerUnit?: number
  }
  /** Optional prop-applier called on mount and on applyData, for wiring
   *  schema-driven config fields (colorMode, dragBehavior, conservationMode)
   *  to the chart element's setters. */
  mountProps?: (el: HTMLElement) => void
}

export function makeHierSource(spec: HierSpec): TileSource {
  const nodesRef = { current: spec.nodes }
  const onUpdateRef = { current: spec.onUpdate }
  const onUpdateManyRef = { current: spec.onUpdateMany }
  const leavesRef = { current: [] as BiNode[] }
  const measureKeyRef = { current: spec.measureKey }
  const drillKeyRef = { current: spec.drillKey }
  const drillNodeIdRef = { current: spec.drillNodeId as string | null | undefined }
  const showBreadcrumbRef = { current: spec.showBreadcrumb }
  const sortByRef = { current: spec.sortBy ?? 'index' }
  const orientationRef = { current: spec.orientation }
  const enableNumberDragRef = { current: spec.enableNumberDrag }
  const depthRef = { current: spec.depth }
  const mountPropsRef = { current: spec.mountProps }

  const source: TileSource = {
    tag: spec.tag,
    shapeKey: spec.shapeKey,

    mountProps(el: HTMLElement) {
      const root = buildBiTree(nodesRef.current, measureKeyRef.current)
      if (!root) return
      const leaves = leavesOf(root) as BiNode[]
      leavesRef.current = leaves
      const typedEl = el as ElWithRoot
      typedEl.externalRoot = root
      if (spec.depth !== undefined) typedEl.maxDepth = spec.depth
      if (spec.drillNodeId !== undefined) typedEl.drillNodeId = spec.drillNodeId
      if (spec.drillKey !== undefined) typedEl.drillKey = spec.drillKey
      if (spec.showBreadcrumb !== undefined) typedEl.showBreadcrumb = spec.showBreadcrumb
      typedEl.sortBy = sortByRef.current
      delete (typedEl as any).orientation;
      if (orientationRef.current !== undefined) typedEl.orientation = orientationRef.current
      // Schema-driven config fields (colorMode, dragBehavior, conservationMode).
      mountPropsRef.current?.(el)

      // Attach numberDrag if configured (for treetable and similar)
      if (enableNumberDragRef.current && typeof (typedEl as any).onRender === 'function') {
        const disposers: Array<() => void> = []
        const { selector, pxPerUnit = 4 } = enableNumberDragRef.current

        const unsubRender = (typedEl as any).onRender((allNodeIds: string[]) => {
          // Clean up previous drag handlers
          for (const d of disposers.splice(0)) d()

          const rootEl = (typedEl as any).getRoot?.() as HTMLElement | undefined
          if (!rootEl) return

          // Build a map of ALL BiNodes by id (including parents)
          const allNodes: BiNode[] = []
          walkTree(root, (n) => allNodes.push(n as BiNode))
          const nodeMap = new Map(allNodes.map(n => [n.value.id, n]))

          // Attach numberDrag to ALL visible value cells
          for (const id of allNodeIds) {
            const cell = rootEl.querySelector<HTMLElement>(`${selector}="${id}"]`)
            if (!cell) continue

            const biNode = nodeMap.get(id)
            if (!biNode) continue

            const get = () => biNode.value.total.value
            const set = (v: number) => {
              // Write to the BiNode - lens will handle redistribution for parents
              biNode.value.total.value = v
              const pnode = nodesRef.current.find(n => n.id === id)
              if (pnode && onUpdateRef.current) {
                onUpdateRef.current(id, { ...pnode.measures, [measureKeyRef.current]: v })
              }
            }

            disposers.push(numberDrag(cell, { get, set, pxPerUnit }))
          }
        })

        // Store cleanup function
        const originalDispose = (typedEl as any).__dispose
        ;(typedEl as any).__dispose = () => {
          unsubRender?.()
          for (const d of disposers) d()
          originalDispose?.()
        }
      }
    },

    initialLast(_el: HTMLElement): Map<string, number> {
      return new Map(leavesRef.current.map(l => [l.value.id, l.value.total.peek()]))
    },

    applyData(el: HTMLElement, { gestureActive, lastRef }) {
      // Apply external store changes into the live leaf cells, in place.
      // Skip during active gestures — wheel/drag are editing the live cells right
      // now; overwriting them from the store would snap values back.
      if (gestureActive) return
      const typedEl = el as ElWithRoot
      // Sync measureKey and orientation BEFORE leaf value writes — the chart's
      // two-lane gate reads these cells (untracked) to decide animate-vs-snap.
      // The layout effect fires when leaf cells are written (tracked via ltarget);
      // by that point these must already be updated so the gate classifies the
      // change as structural (animate), not value edit (snap).
      typedEl.measureKey = measureKeyRef.current
      delete (typedEl as any).orientation;
      if (orientationRef.current !== undefined) typedEl.orientation = orientationRef.current
      // Use peek() to avoid registering Num cells as deps of whichever bireactive
      // effect called applyData — DockView's biEffect calls this via _syncChart, and
      // accidentally tracking Num cells would make DockView re-render on every value
      // change, causing overwrite loops.
      const byId = new Map(nodesRef.current.map(n => [n.id, n]))
      for (const leaf of leavesRef.current) {
        const node = byId.get(leaf.value.id)
        if (!node) continue
        const target = node.measures[measureKeyRef.current] ?? 0
        if (!near(leaf.value.total.peek(), target)) {
          leaf.value.total.value = target
          lastRef.set(leaf.value.id, target)
        }
      }
      if (drillKeyRef.current !== undefined) typedEl.drillKey = drillKeyRef.current
      if (showBreadcrumbRef.current !== undefined) typedEl.showBreadcrumb = showBreadcrumbRef.current
      // Sync sortBy reactively — the chart's setter writes a reactive cell so
      // the layout re-derives and tweens to the new order (no remount).
      // Guard: only write if changed, so a measureKey-only swap doesn't re-fire
      // the layout effect (sortBy is tracked) and overwrite the gate's measureSwapped.
      if (typedEl.sortBy !== sortByRef.current) typedEl.sortBy = sortByRef.current
      // WIN-155: sync depth reactively so the levels dropdown drives per-mark
      // enter/exit fades instead of a full remount (see hierShapeKey).
      if (typedEl.maxDepth !== depthRef.current) typedEl.maxDepth = depthRef.current
      // Push drillNodeId so Esc/breadcrumb drill changes reach the chart element.
      if (drillNodeIdRef.current !== undefined && typedEl.drillNodeId !== drillNodeIdRef.current) {
        typedEl.drillNodeId = drillNodeIdRef.current
      }
      // Re-apply schema-driven config fields (colorMode, dragBehavior,
      // conservationMode) so config-UI changes propagate without a remount.
      mountPropsRef.current?.(el)
    },

    bindEditOut(_el: HTMLElement, lastRef: Map<string, number>): () => void {
      const dispose = biEffect(() => {
        const last = lastRef
        const cb = onUpdateRef.current
        const cbMany = onUpdateManyRef.current
        const pending: Array<{ id: string; measures: VizNode['measures'] }> = []
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
      drillKeyRef.current = nextSpec.drillKey
      drillNodeIdRef.current = nextSpec.drillNodeId
      showBreadcrumbRef.current = nextSpec.showBreadcrumb
      sortByRef.current = nextSpec.sortBy ?? 'index'
      orientationRef.current = nextSpec.orientation
      depthRef.current = nextSpec.depth
      mountPropsRef.current = nextSpec.mountProps
    },
  }

  ;(source as any)._spec = spec

  return source
}

// ─── makeHierRootFlatSource ────────────────────────────────────────────────────
//
// For flat-array charts (radar) that want to render/edit GROUP totals from a
// hierarchical dataset instead of leaves. Builds a live BiNode tree once (same
// buildBiTree used by treemap/pack/icicle) so a root's `total` is a real
// Num.lens over its descendants: writing it redistributes proportionally down
// the tree, reading it sums back up — no manual aggregate-then-writeback loop.
//
// Mirrors makeHierSource's echo-suppression pattern (near() + lastRef) but
// walks ALL leaf descendants (not just direct children) since radar edits a
// root that may sit several levels above its leaves.

interface FlatDatum { id: string; name: string; value: number }

export interface HierRootFlatSpec {
  tag: string
  nodes: VizNode[]
  measureKey: string
  shapeKey: string
  /** Desired display order of root ids — e.g. sorted by aggregate value.
   *  Radar renders by slot/index, so this drives which spoke gets which root
   *  (order change = structural, per the chart's two-lane gate). */
  ids: string[]
  mountProps?: (el: HTMLElement) => void
  onUpdate?: (nodeId: string, measures: VizNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: VizNode['measures'] }>) => void
}

export function makeHierRootFlatSource(spec: HierRootFlatSpec): TileSource {
  const nodesRef = { current: spec.nodes }
  const onUpdateRef = { current: spec.onUpdate }
  const onUpdateManyRef = { current: spec.onUpdateMany }
  const measureKeyRef = { current: spec.measureKey }
  const idsRef = { current: spec.ids }
  const rootsRef = { current: [] as BiNode[] }
  // All leaf descendants per root, precomputed once per tree build — write-out
  // walks these to emit the full set of leaves the lens redistributed into.
  const leavesByRootRef = { current: new Map<string, BiNode[]>() }

  const source: TileSource = {
    tag: spec.tag,
    shapeKey: spec.shapeKey,

    mountProps(el: HTMLElement) {
      const root = buildBiTree(nodesRef.current, measureKeyRef.current)
      const roots: BiNode[] = root ? (root.value.id === '__root__' ? [...root.children] as BiNode[] : [root]) : []
      rootsRef.current = roots
      leavesByRootRef.current = new Map(roots.map(r => [r.value.id, leavesOf(r) as BiNode[]]))
      const typedEl = el as ElWithDataCell<FlatDatum>
      typedEl.measureKey = measureKeyRef.current
      const byId = new Map(roots.map(r => [r.value.id, r]))
      typedEl.externalData = idsRef.current
        .map(id => byId.get(id))
        .filter((r): r is BiNode => !!r)
        .map(r => ({ id: r.value.id, name: r.value.label, value: r.value.total.peek() }))
      spec.mountProps?.(el)
    },

    initialLast(_el: HTMLElement): Map<string, number> {
      // Seed BOTH root ids (applyData's echo check against store measures) and
      // leaf ids (bindEditOut's per-leaf change detection) — disjoint keyspaces
      // sharing one map, since a root is never also a leaf under itself.
      const last = new Map<string, number>()
      for (const r of rootsRef.current) {
        last.set(r.value.id, r.value.total.peek())
        for (const leaf of leavesByRootRef.current.get(r.value.id) ?? []) {
          last.set(leaf.value.id, leaf.value.total.peek())
        }
      }
      return last
    },

    applyData(el: HTMLElement, { gestureActive, lastRef }) {
      // Apply external store changes into the live LEAF cells (same as
      // makeHierSource) — group/root VizNodes never carry the aggregate measure
      // themselves (only leaves do), so the only correct source of truth for
      // "did the store change externally" is each leaf's own measure. Writing
      // leaves lets the lens recompute root totals naturally; comparing/writing
      // root totals directly against node.measures[mk] would compare against
      // 0 (roots have no own measure) and clobber the lens-derived value.
      if (gestureActive) return
      const typedEl = el as ElWithDataCell<FlatDatum>
      // Sync measureKey BEFORE data writes — the chart's two-lane gate reads
      // this cell (untracked) to classify a measure swap as structural (tween)
      // vs a value edit (snap). Same requirement as makeFlatSource/makeHierSource.
      typedEl.measureKey = measureKeyRef.current
      const byId = new Map(nodesRef.current.map(n => [n.id, n]))
      for (const [, leaves] of leavesByRootRef.current) {
        for (const leaf of leaves) {
          const node = byId.get(leaf.value.id)
          if (!node) continue
          const target = node.measures[measureKeyRef.current] ?? 0
          if (!near(leaf.value.total.peek(), target)) {
            leaf.value.total.value = target
            lastRef.set(leaf.value.id, target)
          }
        }
      }
      // Rebuild in display order (same datum objects, per makeFlatSource's
      // idle/commit branch) so a sort change moves values between slots —
      // radar's orderHash (derived from data.value's id sequence) picks this
      // up and the chart's gate tweens the reorder instead of snapping.
      if (!typedEl.dataCell) return
      const rootById = new Map(rootsRef.current.map(r => [r.value.id, r]))
      const arr = typedEl.dataCell.peek() as FlatDatum[]
      const datumById = new Map(arr.map(d => [d.id, d]))
      let touched = false
      let orderChanged = false
      const newArr: FlatDatum[] = []
      for (let k = 0; k < idsRef.current.length; k++) {
        const id = idsRef.current[k]!
        const r = rootById.get(id)
        const d = datumById.get(id)
        if (!r || !d) continue
        const v = r.value.total.peek()
        if (!near(d.value, v)) { touched = true; lastRef.set(id, v) }
        if (arr[k] !== d) orderChanged = true
        newArr.push(near(d.value, v) ? d : { ...d, value: v })
      }
      if (touched || orderChanged || newArr.length !== arr.length) typedEl.dataCell.value = newArr
    },

    bindEditOut(el: HTMLElement, lastRef: Map<string, number>): () => void {
      const typedEl = el as ElWithDataCell<FlatDatum>
      const dispose = biEffect(() => {
        const arr = typedEl.dataCell?.value as FlatDatum[]
        if (!arr) return
        const cb = onUpdateRef.current
        const cbMany = onUpdateManyRef.current
        const byId = new Map(nodesRef.current.map(n => [n.id, n]))
        const pending: Array<{ id: string; measures: VizNode['measures'] }> = []
        for (const d of arr) {
          const r = rootsRef.current.find(x => x.value.id === d.id)
          if (!r) continue
          // Reading d.value (written by the chart's mutateDatum) and comparing
          // to the lens's own total picks up the edit; write it into the lensed
          // cell so Num.lens redistributes to descendants.
          if (!near(d.value, r.value.total.peek())) {
            r.value.total.value = d.value
          }
          // Walk every leaf under this root — the lens just redistributed the
          // edit across all of them — and emit any whose value actually moved.
          const leaves = leavesByRootRef.current.get(r.value.id) ?? []
          for (const leaf of leaves) {
            const v = leaf.value.total.value
            const prev = lastRef.get(leaf.value.id)
            if (prev === undefined || !near(v, prev)) {
              lastRef.set(leaf.value.id, v)
              const node = byId.get(leaf.value.id)
              if (node && (cb || cbMany)) pending.push({ id: node.id, measures: { ...node.measures, [measureKeyRef.current]: v } })
            }
          }
        }
        if (pending.length) queueMicrotask(() => {
          if (cbMany) cbMany(pending)
          else if (cb) for (const p of pending) cb(p.id, p.measures)
        })
      })
      return dispose
    },

    syncFrom(next: TileSource) {
      const nextSpec = (next as any)._spec as HierRootFlatSpec | undefined
      if (!nextSpec) return
      nodesRef.current = nextSpec.nodes
      onUpdateRef.current = nextSpec.onUpdate
      onUpdateManyRef.current = nextSpec.onUpdateMany
      measureKeyRef.current = nextSpec.measureKey
      idsRef.current = nextSpec.ids
    },
  }

  ;(source as any)._spec = spec

  return source
}

// ─── Hier value key helper (exported for use in component wrappers) ───────────

export function hierValueKey(nodes: VizNode[], measureKey: string): string {
  return nodes.map(n => `${n.id}:${vkey(n.measures[measureKey] ?? 0)}`).sort().join(',')
}

export function hierShapeKey(tag: string, nodes: VizNode[], _measureKey: string, _depth?: number): string {
  // NOTE: sortBy, measureKey, and depth are intentionally excluded — those
  // changes flow through the same-shape syncFrom/applyData path so the chart
  // can animate reorder/value-swap/level enter+exit instead of remounting
  // and snapping. WIN-155: depth needs to be reactive so raising/lowering
  // the levels dropdown triggers per-mark enter/exit fades.
  return `${tag}|${nodes.map(n => `${n.id}:${n.parentId ?? ''}`).sort().join(',')}`
}
