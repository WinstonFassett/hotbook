import type { Patch } from './patch'

export interface Source<T> {
  getValue(): T
  onPatch(fn: (patch: Patch<T>) => void): () => void
  applyPatch(patch: Patch<T>): void
}

export function plainSource<T>(initial: T): Source<T> {
  let value = initial
  const listeners = new Set<(patch: Patch<T>) => void>()

  return {
    getValue() {
      return value
    },

    onPatch(fn: (patch: Patch<T>) => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },

    applyPatch(patch: Patch<T>) {
      // Only handle full-value replacement (range: '')
      if (patch.range === '') {
        value = patch.content as T
        listeners.forEach((fn) => fn(patch))
      }
      // Deep JSON Patch application comes with adapter tickets
    },
  }
}
