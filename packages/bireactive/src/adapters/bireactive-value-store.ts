import {
  Num,
  num,
  treeNode,
  type TreeNode,
  type Writable,
  effect,
} from 'bireactive'
import type { ValueStore, Patch, QuerySource, VizNode } from '@hotbook/core'

// Internal bireactive node value shape.
interface BiNodeValue {
  id: string
  parentId: string | null
  index: number
  name: string
  color?: string
  // Each measure is a writable bireactive cell
  measures: Record<string, Writable<Num>>
  dims: Record<string, string>
}

export type BiNode = TreeNode<BiNodeValue>

/**
 * BireactiveValueStore adapter (whiteboard §3).
 *
 * Bridges Patch ↔ bireactive cells/lenses:
 * - `updatePending` patches: apply locally in bireactive cells (optimistic preview)
 * - `updateNow` patches: forward upstream to the QuerySource's base Source
 * - `rejected` patches: roll back the local cell state
 *
 * Uses bireactive treeNode / num / Num.lens primitives, mirroring lib/tree.ts patterns.
 */
export function bireactiveValueStore<T extends VizNode[] = VizNode[]>(
  querySource: QuerySource<T>,
): ValueStore<T> {
  // Internal bireactive tree. Null until first getValue() call.
  let biTree: BiNode | null = null
  // Flat index of VizNode.id → BiNode for fast lookup.
  const nodeIndex = new Map<string, BiNode>()
  // Subscribers to value changes.
  const listeners = new Set<(value: T) => void>()
  // Pending patch transaction IDs (for rollback tracking).
  const pendingTransactions = new Map<string, Map<string, number>>()

  // Build/rebuild the bireactive tree from VizNode[].
  function buildBiTree(nodes: T): BiNode {
    nodeIndex.clear()

    // Group nodes by parentId for hierarchy construction
    const childrenMap = new Map<string | null, VizNode[]>()
    for (const node of nodes) {
      const parent = node.parentId
      if (!childrenMap.has(parent)) {
        childrenMap.set(parent, [])
      }
      childrenMap.get(parent)!.push(node)
    }

    // Recursive builder
    function buildNode(vizNode: VizNode): BiNode {
      const measures: Record<string, Writable<Num>> = {}
      for (const [key, val] of Object.entries(vizNode.measures)) {
        measures[key] = num(val)
      }

      const children = childrenMap.get(vizNode.id) || []
      const biChildren = children.map(buildNode)

      // If this node has children, create conservation lenses for each measure
      if (biChildren.length > 0) {
        for (const [key] of Object.entries(vizNode.measures)) {
          const childCells = biChildren
            .map((c) => c.value.measures[key])
            .filter(Boolean)

          if (childCells.length > 0) {
            measures[key] = Num.lens(
              childCells,
              (vs: readonly number[]) => vs.reduce((a, b) => a + b, 0),
              (target, vs) => {
                const arr = vs as readonly number[]
                const cur = arr.reduce((a, b) => a + b, 0)
                if (cur === 0) return arr.map(() => target / arr.length) as never
                const scale = target / cur
                return arr.map((v) => v * scale) as never
              },
            )
          }
        }
      }

      const biNode = treeNode<BiNodeValue>(
        {
          id: vizNode.id,
          parentId: vizNode.parentId,
          index: vizNode.index,
          name: vizNode.name,
          color: vizNode.color,
          measures,
          dims: vizNode.dims,
        },
        biChildren,
      )

      nodeIndex.set(vizNode.id, biNode)
      return biNode
    }

    // Find root nodes (parentId === null)
    const roots = childrenMap.get(null) || []
    if (roots.length === 0) {
      throw new Error('bireactiveValueStore: no root nodes found')
    }
    if (roots.length > 1) {
      // Multiple roots: wrap in a synthetic root
      const syntheticRoot: VizNode = {
        id: '__root__',
        parentId: null,
        index: 0,
        name: 'Root',
        measures: {},
        dims: {},
      }
      const biChildren = roots.map(buildNode)
      const biNode = treeNode<BiNodeValue>(
        {
          id: '__root__',
          parentId: null,
          index: 0,
          name: 'Root',
          measures: {},
          dims: {},
        },
        biChildren,
      )
      nodeIndex.set('__root__', biNode)
      return biNode
    }

    return buildNode(roots[0])
  }

  // Serialize the bireactive tree back to VizNode[].
  function serializeBiTree(root: BiNode): T {
    const out: VizNode[] = []
    const walk = (node: BiNode) => {
      const measures: Record<string, number> = {}
      for (const [key, cell] of Object.entries(node.value.measures)) {
        measures[key] = cell.value
      }

      out.push({
        id: node.value.id,
        parentId: node.value.parentId,
        index: node.value.index,
        name: node.value.name,
        color: node.value.color,
        measures,
        dims: node.value.dims,
      })

      for (const child of node.children as BiNode[]) {
        walk(child)
      }
    }
    walk(root)
    // Filter out synthetic root if present
    return out.filter((n) => n.id !== '__root__') as T
  }

  // Notify all subscribers with the current serialized value.
  function notifyListeners() {
    if (!biTree) return
    const value = serializeBiTree(biTree)
    listeners.forEach((fn) => fn(value))
  }

  // Subscribe to upstream patches from the QuerySource.
  querySource.onPatch((patch) => {
    // Full-value patch from upstream: rebuild the tree
    if (patch.range === '' && patch.context.phase === 'updateNow') {
      biTree = buildBiTree(patch.content as T)
      notifyListeners()
    } else if (patch.context.phase === 'rejected') {
      // Roll back pending transaction
      const txId = patch.context.transactionId
      if (txId && pendingTransactions.has(txId)) {
        const snapshot = pendingTransactions.get(txId)!
        for (const [nodeId, measureKey] of snapshot.entries()) {
          const biNode = nodeIndex.get(nodeId)
          if (biNode && typeof measureKey === 'string') {
            const [key, oldValue] = measureKey.split(':')
            biNode.value.measures[key].value = Number(oldValue)
          }
        }
        pendingTransactions.delete(txId)
        notifyListeners()
      }
    }
  })

  return {
    get value(): T {
      if (!biTree) {
        biTree = buildBiTree(querySource.getValue())
      }
      return serializeBiTree(biTree)
    },

    getValue(): T {
      if (!biTree) {
        biTree = buildBiTree(querySource.getValue())
      }
      return serializeBiTree(biTree)
    },

    applyPatch(patch: Patch<T>): void {
      if (!biTree) {
        biTree = buildBiTree(querySource.getValue())
      }

      const { unit, range, content, context } = patch

      // Full-value replacement
      if (range === '' && unit === 'nodes') {
        if (context.phase === 'updateNow') {
          // Forward to upstream source
          querySource.applyPatch(patch)
        } else if (context.phase === 'updatePending') {
          // Rebuild locally (preview)
          biTree = buildBiTree(content as T)
          notifyListeners()
        }
        return
      }

      // Range patch: 'nodeId/measureKey' format
      if (unit === 'nodes' && range.includes('/')) {
        const [nodeId, measureKey] = range.split('/')
        const biNode = nodeIndex.get(nodeId)

        if (!biNode || !biNode.value.measures[measureKey]) {
          console.warn(
            `bireactiveValueStore: node ${nodeId} or measure ${measureKey} not found`,
          )
          return
        }

        const cell = biNode.value.measures[measureKey]
        const newValue = content as number

        if (context.phase === 'updatePending') {
          // Apply locally (optimistic)
          const txId = context.transactionId || ''
          if (txId && !pendingTransactions.has(txId)) {
            pendingTransactions.set(txId, new Map())
          }
          if (txId) {
            const snapshot = pendingTransactions.get(txId)!
            snapshot.set(nodeId, `${measureKey}:${cell.value}` as any)
          }
          cell.value = newValue
          notifyListeners()
        } else if (context.phase === 'updateNow') {
          // Apply locally and forward upstream
          cell.value = newValue
          querySource.applyPatch(patch)
          notifyListeners()
        }
      }
    },

    subscribe(fn: (value: T) => void): () => void {
      listeners.add(fn)

      // Also set up a bireactive effect to auto-notify on cell changes
      const dispose = effect(() => {
        if (biTree) {
          // Walk the tree and read all measure cells to subscribe
          const walk = (node: BiNode) => {
            for (const cell of Object.values(node.value.measures)) {
              void cell.value // read to subscribe
            }
            for (const child of node.children as BiNode[]) {
              walk(child)
            }
          }
          walk(biTree)
          // Trigger notification
          fn(serializeBiTree(biTree))
        }
      })

      return () => {
        listeners.delete(fn)
        dispose()
      }
    },
  }
}
