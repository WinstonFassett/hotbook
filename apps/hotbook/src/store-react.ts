import { useSyncExternalStore } from 'react'
import { hudStore } from './store'

export function useDrillNodeId(drillKey: string): string | null {
  return useSyncExternalStore(
    hudStore.subscribe,
    () => hudStore.getSnapshot().drills[drillKey] ?? null,
  )
}
