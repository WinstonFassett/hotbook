import { describe, it, expect, vi } from 'vitest'
import {
  updateValue,
  moveNode,
  addNode,
  removeNode,
  batch,
  transaction,
  type DatasetLike,
} from './primitives'
import type { VizNode } from '../types'

const createTestNode = (id: string, parentId: string | null = null): VizNode => ({
  id,
  parentId,
  index: 0,
  name: `Node ${id}`,
  measures: { value: 100 },
  dims: { category: 'test' },
})

describe('updateValue', () => {
  it('updates a measure value', () => {
    const dataset: DatasetLike = {
      nodes: [createTestNode('a'), createTestNode('b')],
    }
    const result = updateValue(dataset, 'a', 'value', 200)
    expect(result[0].measures.value).toBe(200)
    expect(result[1].measures.value).toBe(100) // Unchanged
  })

  it('updates a dim value', () => {
    const dataset: DatasetLike = {
      nodes: [createTestNode('a')],
    }
    const result = updateValue(dataset, 'a', 'category', 'updated')
    expect(result[0].dims.category).toBe('updated')
  })

  it('adds a new measure field', () => {
    const dataset: DatasetLike = {
      nodes: [createTestNode('a')],
    }
    const result = updateValue(dataset, 'a', 'newMeasure', 50)
    expect(result[0].measures.newMeasure).toBe(50)
    expect(result[0].measures.value).toBe(100) // Original preserved
  })

  it('does not mutate original array', () => {
    const dataset: DatasetLike = {
      nodes: [createTestNode('a')],
    }
    const original = dataset.nodes[0]
    const result = updateValue(dataset, 'a', 'value', 200)
    expect(original.measures.value).toBe(100) // Original unchanged
    expect(result[0]).not.toBe(original) // New object
  })
})

describe('moveNode', () => {
  it('moves a node to a new parent', () => {
    const dataset: DatasetLike = {
      nodes: [
        createTestNode('root', null),
        createTestNode('a', 'root'),
        createTestNode('b', 'root'),
      ],
    }
    const result = moveNode(dataset, 'a', 'b')
    expect(result.find(n => n.id === 'a')?.parentId).toBe('b')
  })

  it('moves a node to root (null parent)', () => {
    const dataset: DatasetLike = {
      nodes: [
        createTestNode('root', null),
        createTestNode('a', 'root'),
      ],
    }
    const result = moveNode(dataset, 'a', null)
    expect(result.find(n => n.id === 'a')?.parentId).toBeNull()
  })

  it('throws if new parent does not exist', () => {
    const dataset: DatasetLike = {
      nodes: [createTestNode('a', null)],
    }
    expect(() => moveNode(dataset, 'a', 'nonexistent')).toThrow('Parent node nonexistent does not exist')
  })

  it('throws if move would create a cycle', () => {
    const dataset: DatasetLike = {
      nodes: [
        createTestNode('a', null),
        createTestNode('b', 'a'),
        createTestNode('c', 'b'),
      ],
    }
    expect(() => moveNode(dataset, 'a', 'c')).toThrow('would create a cycle')
  })

  it('does not mutate original array', () => {
    const dataset: DatasetLike = {
      nodes: [
        createTestNode('a', null),
        createTestNode('b', 'a'),
      ],
    }
    const original = dataset.nodes[1]
    const result = moveNode(dataset, 'b', null)
    expect(original.parentId).toBe('a') // Original unchanged
    expect(result[1]).not.toBe(original)
  })
})

describe('addNode', () => {
  it('adds a new node', () => {
    const dataset: DatasetLike = {
      nodes: [createTestNode('a', null)],
    }
    const newNode = createTestNode('b', 'a')
    const result = addNode(dataset, newNode)
    expect(result).toHaveLength(2)
    expect(result[1]).toEqual(newNode)
  })

  it('throws if node id already exists', () => {
    const dataset: DatasetLike = {
      nodes: [createTestNode('a', null)],
    }
    const duplicate = createTestNode('a', null)
    expect(() => addNode(dataset, duplicate)).toThrow('already exists')
  })

  it('throws if parent does not exist', () => {
    const dataset: DatasetLike = {
      nodes: [createTestNode('a', null)],
    }
    const newNode = createTestNode('b', 'nonexistent')
    expect(() => addNode(dataset, newNode)).toThrow('Parent node nonexistent does not exist')
  })

  it('does not mutate original array', () => {
    const dataset: DatasetLike = {
      nodes: [createTestNode('a', null)],
    }
    const original = dataset.nodes
    const result = addNode(dataset, createTestNode('b', 'a'))
    expect(original).toHaveLength(1) // Original unchanged
    expect(result).not.toBe(original)
  })
})

describe('removeNode', () => {
  it('removes a node', () => {
    const dataset: DatasetLike = {
      nodes: [
        createTestNode('a', null),
        createTestNode('b', 'a'),
      ],
    }
    const result = removeNode(dataset, 'b')
    expect(result).toHaveLength(1)
    expect(result.find(n => n.id === 'b')).toBeUndefined()
  })

  it('does not cascade delete children', () => {
    const dataset: DatasetLike = {
      nodes: [
        createTestNode('a', null),
        createTestNode('b', 'a'),
        createTestNode('c', 'b'),
      ],
    }
    const result = removeNode(dataset, 'b')
    expect(result).toHaveLength(2)
    expect(result.find(n => n.id === 'c')).toBeDefined()
    expect(result.find(n => n.id === 'c')?.parentId).toBe('b') // Orphaned
  })

  it('does not mutate original array', () => {
    const dataset: DatasetLike = {
      nodes: [createTestNode('a', null)],
    }
    const original = dataset.nodes
    const result = removeNode(dataset, 'a')
    expect(original).toHaveLength(1) // Original unchanged
    expect(result).not.toBe(original)
  })
})

describe('batch', () => {
  it('applies multiple operations in sequence', () => {
    const dataset: DatasetLike = {
      nodes: [
        createTestNode('a', null),
        createTestNode('b', 'a'),
      ],
    }
    const result = batch(dataset, [
      ds => updateValue(ds, 'a', 'value', 200),
      ds => updateValue(ds, 'b', 'value', 300),
      ds => addNode(ds, createTestNode('c', 'a')),
    ])
    expect(result).toHaveLength(3)
    expect(result.find(n => n.id === 'a')?.measures.value).toBe(200)
    expect(result.find(n => n.id === 'b')?.measures.value).toBe(300)
    expect(result.find(n => n.id === 'c')).toBeDefined()
  })

  it('passes result of each operation to the next', () => {
    const dataset: DatasetLike = {
      nodes: [createTestNode('a', null)],
    }
    const result = batch(dataset, [
      ds => addNode(ds, createTestNode('b', 'a')),
      ds => {
        // This operation sees the result of the previous one
        expect(ds.nodes).toHaveLength(2)
        return moveNode(ds, 'b', null)
      },
    ])
    expect(result.find(n => n.id === 'b')?.parentId).toBeNull()
  })
})

describe('transaction', () => {
  it('applies operations and calls onChange', () => {
    const dataset: DatasetLike = {
      nodes: [createTestNode('a', null)],
    }
    const onChange = vi.fn()
    transaction(
      dataset,
      [ds => updateValue(ds, 'a', 'value', 200)],
      onChange
    )
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0][0].find((n: VizNode) => n.id === 'a')?.measures.value).toBe(200)
  })

  it('sends state machine events when machine is provided', () => {
    const dataset: DatasetLike = {
      nodes: [createTestNode('a', null)],
    }
    const onChange = vi.fn()
    const machine = { updatePending: vi.fn(), updateDone: vi.fn() }
    transaction(
      dataset,
      [ds => updateValue(ds, 'a', 'value', 200)],
      onChange,
      machine
    )
    expect(machine.updatePending).toHaveBeenCalledOnce()
    expect(machine.updateDone).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('works without machine', () => {
    const dataset: DatasetLike = {
      nodes: [createTestNode('a', null)],
    }
    const onChange = vi.fn()
    expect(() =>
      transaction(
        dataset,
        [ds => updateValue(ds, 'a', 'value', 200)],
        onChange
      )
    ).not.toThrow()
    expect(onChange).toHaveBeenCalledOnce()
  })
})
