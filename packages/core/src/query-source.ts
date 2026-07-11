import type { Source } from './source'
import type { Patch, PatchContext } from './patch'
import type { Query, Filter, Sort } from './query'
import type { VizNode } from './types'

// A QuerySource is a Source derived from a base Source + Query.
// It applies filter/sort/levelBy transformations and forwards updateNow patches upstream.
export interface QuerySource<T = VizNode[]> extends Source<T> {
  baseSourceId: string
  query: Query
}

// Minimal plainQuerySource implementation.
// Query engine supports filter + sort + optional levelBy grouping.
// Aggregation is out of scope.
export function plainQuerySource<T extends VizNode[]>(
  base: Source<T>,
  query: Query,
): QuerySource<T> {
  const listeners = new Set<(patch: Patch<T>) => void>()
  let cachedValue: T | null = null

  function applyQuery(nodes: T): T {
    let result = [...nodes] as T

    // Apply filters
    if (query.filters && query.filters.length > 0) {
      result = result.filter((node) => {
        return query.filters!.every((filter) => matchesFilter(node, filter))
      }) as T
    }

    // Apply sorts
    if (query.sorts && query.sorts.length > 0) {
      result.sort((a, b) => {
        for (const sort of query.sorts!) {
          const cmp = compareNodes(a, b, sort)
          if (cmp !== 0) return cmp
        }
        return 0
      })
    }

    // levelBy grouping: out of scope for minimal implementation
    // (whiteboard §7 shows the shape but says "minimal implementation")

    return result
  }

  function matchesFilter(node: VizNode, filter: Filter): boolean {
    const value = getFieldValue(node, filter.field)
    switch (filter.op) {
      case 'eq':
        return value === filter.value
      case 'neq':
        return value !== filter.value
      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(value)
      case 'gt':
        return typeof value === 'number' && value > (filter.value as number)
      case 'lt':
        return typeof value === 'number' && value < (filter.value as number)
      case 'contains':
        return (
          typeof value === 'string' &&
          typeof filter.value === 'string' &&
          value.includes(filter.value)
        )
      default:
        return false
    }
  }

  function compareNodes(a: VizNode, b: VizNode, sort: Sort): number {
    const aVal = getFieldValue(a, sort.field)
    const bVal = getFieldValue(b, sort.field)

    if (aVal === bVal) return 0
    if (aVal == null) return 1
    if (bVal == null) return -1

    const cmp = aVal < bVal ? -1 : 1
    return sort.dir === 'desc' ? -cmp : cmp
  }

  function getFieldValue(node: VizNode, field: string): unknown {
    if (field === '_index') return node.index
    if (field === '_value') return node.value
    if (field in (node.measures || {})) return node.measures![field]
    if (field in (node.dims || {})) return node.dims![field]
    return (node as any)[field]
  }

  // Subscribe to base source patches
  const unsubscribe = base.onPatch((patch) => {
    cachedValue = null // invalidate cache
    // Re-apply query and forward as a new patch
    const queryResult = applyQuery(base.getValue())
    const derivedPatch: Patch<T> = {
      unit: patch.unit,
      range: '',
      content: queryResult,
      context: patch.context,
    }
    listeners.forEach((fn) => fn(derivedPatch))
  })

  return {
    baseSourceId: query.sourceId || '',
    query,

    getValue() {
      if (cachedValue === null) {
        cachedValue = applyQuery(base.getValue())
      }
      return cachedValue
    },

    onPatch(fn: (patch: Patch<T>) => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },

    applyPatch(patch: Patch<T>) {
      // Forward updateNow patches upstream to the base Source.
      // Pending patches stay local (not forwarded).
      if (patch.context.phase === 'updateNow') {
        base.applyPatch(patch)
      }
    },
  }
}
