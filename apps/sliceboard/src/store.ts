import { useSyncExternalStore } from 'react'
import type { PNode } from './persistence'

export interface HudState {
  hoverId: string | null
  selectionId: string | null
  /** '__root__' = top level */
  focusId: string
}

const INIT: HudState = {
  hoverId: null,
  selectionId: null,
  focusId: '__root__',
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
  reset: () => setState(INIT),
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

/** Reset focus + selection when dataset changes */
export function resetHudForDataset(_nodes: PNode[]) {
  hudStore.reset()
}
