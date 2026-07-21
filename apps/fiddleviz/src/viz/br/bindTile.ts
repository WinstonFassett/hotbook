/**
 * bindTile.ts — fiddleviz facade over the shared TileBinder module.
 *
 * This file now only owns:
 *   - bindHudSync: wires a BR-LC element to fiddleviz's hudStore
 *   - bindTile: wraps the shared bindTile with fiddleviz's bindHudSync
 *
 * All generic binding logic (TileSource, makeFlatSource, makeHierSource,
 * makeHierRootFlatSource, hierShapeKey, hierValueKey, etc.) lives in:
 *   packages/fiddleviz-d3/src/host/tile-binder.ts
 */

import {
  bindTile as _bindTile,
  near,
  vkey,
  makeFlatSource,
  makeHierSource,
  makeHierRootFlatSource,
  hierShapeKey,
  hierValueKey,
} from '@fiddleviz/d3'
import type {
  TileSource,
  TileController,
  FlatSpec,
  HierSpec,
  HierRootFlatSpec,
} from '@fiddleviz/d3'
import { hudStore } from '../../store'

export type { TileSource, TileController, FlatSpec, HierSpec, HierRootFlatSpec }
export { near, vkey, makeFlatSource, makeHierSource, makeHierRootFlatSource, hierShapeKey, hierValueKey }

// ─── HUD sync ────────────────────────────────────────────────────────────────

interface BrSyncBridge {
  setExternalHover(id: string | null): void
  setExternalSelect(id: string | null): void
  onHover(cb: (id: string | null) => void): () => void
  onSelect(cb: (id: string | null) => void): () => void
  onDrill?(cb: (drillKey: string, id: string | null) => void): () => void
}
interface ElWithBrSync extends HTMLElement { brSync?: BrSyncBridge }

/**
 * Wire a mounted BR-LC element to the fiddleviz hudStore in both directions.
 * Echo-suppressed: we skip pushing a value the element just reported.
 * Returns a disposer.
 */
export function bindHudSync(el: ElWithBrSync): () => void {
  const bridge = el.brSync
  if (!bridge) {
    // Element is not yet connected to the document (connectedCallback hasn't run),
    // so scene() hasn't set brSync yet. Retry with exponential backoff.
    let disposed = false
    let inner: (() => void) | null = null
    let retryCount = 0
    const maxRetries = 10

    const tryBind = () => {
      if (disposed) return
      const currentBridge = el.brSync
      if (currentBridge) {
        inner = bindHudSync(el)
      } else if (retryCount < maxRetries) {
        retryCount++
        const delay = Math.min(100, Math.pow(2, retryCount))
        setTimeout(tryBind, delay)
      } else {
        console.warn('bindHudSync: brSync not set after max retries', el)
      }
    }

    Promise.resolve().then(tryBind)
    return () => { disposed = true; inner?.() }
  }
  let lastInHover: string | null = null
  let lastInSelect: string | null = null
  let lastInDrill: string | null = null

  const offHover = bridge.onHover(id => { if (id !== lastInHover) hudStore.setHover(id) })
  const offSelect = bridge.onSelect(id => { if (id !== lastInSelect) hudStore.setSelection(id) })
  const offDrill = bridge.onDrill ? bridge.onDrill((drillKey, id) => {
    const resolved = id === '' ? null : id
    lastInDrill = resolved
    hudStore.setDrill(drillKey, resolved)
  }) : () => {}

  const unsub = hudStore.subscribe(() => {
    const s = hudStore.getSnapshot()
    if (s.hoverId !== lastInHover) { lastInHover = s.hoverId; bridge.setExternalHover(s.hoverId) }
    if (s.selectionId !== lastInSelect) { lastInSelect = s.selectionId; bridge.setExternalSelect(s.selectionId) }
    // Sync drill directly — bypasses React round-trip that was losing tiles on pop-out.
    const drillKey = (el as any).drillKey
    if (drillKey && (bridge as any).setExternalDrill) {
      const drillId = s.drills[drillKey] ?? null
      if (drillId !== lastInDrill) { lastInDrill = drillId; (bridge as any).setExternalDrill(drillId) }
    }
  })
  // Seed current store state into the freshly mounted element.
  const s0 = hudStore.getSnapshot()
  lastInHover = s0.hoverId; lastInSelect = s0.selectionId
  bridge.setExternalHover(s0.hoverId)
  bridge.setExternalSelect(s0.selectionId)
  const drillKey0 = (el as any).drillKey
  if (drillKey0 && (bridge as any).setExternalDrill) {
    lastInDrill = s0.drills[drillKey0] ?? null
    ;(bridge as any).setExternalDrill(lastInDrill)
  }

  return () => { offHover(); offSelect(); offDrill(); unsub() }
}

// ─── bindTile (fiddleviz entry point) ───────────────────────────────────────

/**
 * FiddleViz-specific wrapper: passes bindHudSync as the HUD binding function.
 * This is the only symbol BrLcTile.tsx needs to call directly.
 */
export function bindTile(container: HTMLElement, source: TileSource): TileController {
  return _bindTile(container, source, bindHudSync)
}
