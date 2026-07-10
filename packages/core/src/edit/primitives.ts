import type { VizNode } from '../types'

/**
 * Pure data-edit primitives for VizNode hierarchies.
 * Framework/substrate-agnostic: operate on plain data + change notification callback.
 */

export type ChangeCallback = (nodes: VizNode[]) => void

export interface DatasetLike {
  nodes: VizNode[]
}

/**
 * Update a value on a node (measures or dims aware).
 * Pure function — returns new array.
 */
export function updateValue(
  dataset: DatasetLike,
  id: string,
  field: string,
  value: number | string
): VizNode[] {
  return dataset.nodes.map(node => {
    if (node.id !== id) return node

    // Determine if field is in measures or dims
    if (typeof value === 'number') {
      return {
        ...node,
        measures: {
          ...node.measures,
          [field]: value,
        },
      }
    } else {
      return {
        ...node,
        dims: {
          ...node.dims,
          [field]: value,
        },
      }
    }
  })
}

/**
 * Move a node to a new parent.
 * Pure function — returns new array.
 * Validates that the new parent exists (or is null for root).
 */
export function moveNode(
  dataset: DatasetLike,
  id: string,
  newParentId: string | null
): VizNode[] {
  // Validate new parent exists (unless null)
  if (newParentId !== null) {
    const parentExists = dataset.nodes.some(n => n.id === newParentId)
    if (!parentExists) {
      throw new Error(`Parent node ${newParentId} does not exist`)
    }
  }

  // Check for circular reference - newParentId cannot be a descendant of id
  if (newParentId !== null) {
    const wouldCreateCycle = isDescendant(dataset.nodes, id, newParentId)
    if (wouldCreateCycle) {
      throw new Error(`Moving ${id} to ${newParentId} would create a cycle`)
    }
  }

  return dataset.nodes.map(node => {
    if (node.id === id) {
      return {
        ...node,
        parentId: newParentId,
      }
    }
    return node
  })
}

/**
 * Add a new node to the dataset.
 * Pure function — returns new array.
 */
export function addNode(dataset: DatasetLike, node: VizNode): VizNode[] {
  // Validate no duplicate id
  const exists = dataset.nodes.some(n => n.id === node.id)
  if (exists) {
    throw new Error(`Node with id ${node.id} already exists`)
  }

  // Validate parent exists (if not null)
  if (node.parentId !== null) {
    const parentExists = dataset.nodes.some(n => n.id === node.parentId)
    if (!parentExists) {
      throw new Error(`Parent node ${node.parentId} does not exist`)
    }
  }

  return [...dataset.nodes, node]
}

/**
 * Remove a node from the dataset.
 * Pure function — returns new array.
 * Does NOT cascade-delete children — they become orphaned with parentId pointing to deleted node.
 * Caller must decide orphan handling (reparent, cascade delete, etc.).
 */
export function removeNode(dataset: DatasetLike, id: string): VizNode[] {
  return dataset.nodes.filter(node => node.id !== id)
}

/**
 * Helper: check if targetId is a descendant of ancestorId.
 */
function isDescendant(nodes: VizNode[], ancestorId: string, targetId: string): boolean {
  let current = nodes.find(n => n.id === targetId)
  while (current && current.parentId !== null) {
    if (current.parentId === ancestorId) {
      return true
    }
    current = nodes.find(n => n.id === current!.parentId)
  }
  return false
}

/**
 * Batch wrapper: apply multiple edit operations atomically.
 * Returns final result array.
 * Each operation receives the result of the prior operation.
 */
export function batch(
  dataset: DatasetLike,
  operations: Array<(dataset: DatasetLike) => VizNode[]>
): VizNode[] {
  let result = dataset.nodes
  for (const op of operations) {
    result = op({ nodes: result })
  }
  return result
}

/**
 * Transaction wrapper that integrates with the update-lifecycle state machine.
 * Sends 'updatePending' at the start, applies operations, sends 'updateDone' at the end.
 * Callback is invoked with the final result.
 */
export function transaction(
  dataset: DatasetLike,
  operations: Array<(dataset: DatasetLike) => VizNode[]>,
  onChange: ChangeCallback,
  machine?: { updatePending: () => void; updateDone: () => void }
): void {
  if (machine) {
    machine.updatePending()
  }

  const result = batch(dataset, operations)
  onChange(result)

  if (machine) {
    machine.updateDone()
  }
}
