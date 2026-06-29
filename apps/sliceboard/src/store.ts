import { useSyncExternalStore } from 'react'
import type { PNode } from './persistence'

export interface HudState {
  hoverId: string | null
  selectionId: string | null
  /** '__root__' = top level */
  focusId: string
  /** Drill scope (cross-tile): null = render full tree from real root; non-null =
   *  re-root every hierarchical tile at this PNode id. Distinct from
   *  `tile.depth` (static "how many levels to render") and from `selectionId`
   *  (which node is highlighted). Persisted on the dashboard. */
  drillNodeId: string | null
}

const INIT: HudState = {
  hoverId: null,
  selectionId: null,
  focusId: '__root__',
  drillNodeId: null,
}

let state: HudState = INIT
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach(l => l())
}

function setState(patch: Partial<HudState>) {
  state = { ...state, ...patch }
  notify()
}

export const hudStore = {
  subscribe: (cb: () => void) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  getSnapshot: () => state,
  setHover: (id: string | null) => setState({ hoverId: id }),
  setSelection: (id: string | null) => setState({ selectionId: id }),
  setFocus: (id: string) => setState({ focusId: id }),
  setDrill: (id: string | null) => setState({ drillNodeId: id }),
  reset: () => setState(INIT),
  /** Seed drill from persisted dashboard state without resetting hover/select. */
  hydrateDrill: (id: string | null) => setState({ drillNodeId: id }),
}

export function useHudStore(): HudState {
  return useSyncExternalStore(hudStore.subscribe, hudStore.getSnapshot)
}

export function useHoverId(): string | null {
  return useSyncExternalStore(hudStore.subscribe, () => hudStore.getSnapshot().hoverId)
}

export function useSelectionId(): string | null {
  return useSyncExternalStore(hudStore.subscribe, () => hudStore.getSnapshot().selectionId)
}

export function useFocusId(): string {
  return useSyncExternalStore(hudStore.subscribe, () => hudStore.getSnapshot().focusId)
}

export function useDrillNodeId(): string | null {
  return useSyncExternalStore(hudStore.subscribe, () => hudStore.getSnapshot().drillNodeId)
}

/** Reset focus + selection + drill when dataset changes */
export function resetHudForDataset(_nodes: PNode[]) {
  hudStore.reset()
}
