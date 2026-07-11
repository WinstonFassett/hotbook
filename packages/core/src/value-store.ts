import type { Patch } from './patch'

export interface ValueStore<T> {
  value: T
  getValue(): T
  applyPatch(patch: Patch<T>): void
  subscribe(fn: (value: T) => void): () => void
}

export function plainValueStore<T>(initial: T): ValueStore<T> {
  let value = initial
  const listeners = new Set<(value: T) => void>()

  return {
    get value() {
      return value
    },

    getValue() {
      return value
    },

    applyPatch(patch: Patch<T>) {
      // Only handle full-value replacement (range: '')
      if (patch.range === '') {
        value = patch.content as T
        listeners.forEach((fn) => fn(value))
      }
      // Deep JSON Patch application comes with adapter tickets
    },

    subscribe(fn: (value: T) => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}
