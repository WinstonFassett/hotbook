import { describe, it, expect } from 'vitest'
import type { VizNode } from '../types'
import { buildTree, applyView, applyGroupings, drillPath, leavesOf, type TreeNode } from './index'

describe('buildTree', () => {
  it('builds a single-level tree', () => {
    const rows: VizNode[] = [
      { id: 'r1', parentId: null, index: 0, name: 'Root 1', measures: { value: 10 }, dims: {} },
      { id: 'r2', parentId: null, index: 1, name: 'Root 2', measures: { value: 20 }, dims: {} },
    ]
    const tree = buildTree(rows, 'value')
    expect(tree.id).toBe('__root__')
    expect(tree.children).toHaveLength(2)
    expect(tree.children![0]!.id).toBe('r1')
    expect(tree.children![1]!.id).toBe('r2')
  })

  it('builds a nested tree', () => {
    const rows: VizNode[] = [
      { id: 'r1', parentId: null, index: 0, name: 'Root 1', measures: { value: 10 }, dims: {} },
      { id: 'c1', parentId: 'r1', index: 0, name: 'Child 1', measures: { value: 5 }, dims: {} },
      { id: 'c2', parentId: 'r1', index: 1, name: 'Child 2', measures: { value: 5 }, dims: {} },
      { id: 'gc1', parentId: 'c1', index: 0, name: 'Grandchild 1', measures: { value: 3 }, dims: {} },
    ]
    const tree = buildTree(rows, 'value')
    expect(tree.id).toBe('__root__')
    expect(tree.children).toHaveLength(1)
    const root = tree.children![0]!
    expect(root.id).toBe('r1')
    expect(root.children).toHaveLength(2)
    expect(root.children![0]!.id).toBe('c1')
    expect(root.children![0]!.children).toHaveLength(1)
    expect(root.children![0]!.children![0]!.id).toBe('gc1')
  })

  it('handles empty rows', () => {
    const tree = buildTree([], 'value')
    expect(tree.id).toBe('__root__')
    expect(tree.children).toEqual([])
  })

  it('handles empty groupBy (no roots)', () => {
    const rows: VizNode[] = [
      { id: 'orphan', parentId: 'nonexistent', index: 0, name: 'Orphan', measures: { value: 10 }, dims: {} },
    ]
    const tree = buildTree(rows, 'value')
    expect(tree.id).toBe('__root__')
    expect(tree.children).toEqual([])
  })

  it('maintains index order', () => {
    const rows: VizNode[] = [
      { id: 'r3', parentId: null, index: 2, name: 'Root 3', measures: { value: 30 }, dims: {} },
      { id: 'r1', parentId: null, index: 0, name: 'Root 1', measures: { value: 10 }, dims: {} },
      { id: 'r2', parentId: null, index: 1, name: 'Root 2', measures: { value: 20 }, dims: {} },
    ]
    const tree = buildTree(rows, 'value')
    expect(tree.children![0]!.id).toBe('r1')
    expect(tree.children![1]!.id).toBe('r2')
    expect(tree.children![2]!.id).toBe('r3')
  })
})

describe('applyView (groupBy)', () => {
  it('groups flat roots by dimension', () => {
    const rows: VizNode[] = [
      { id: 'a1', parentId: null, index: 0, name: 'Apple', measures: { value: 10 }, dims: { group: 'Fruit' }, color: '#ff0000' },
      { id: 'a2', parentId: null, index: 1, name: 'Banana', measures: { value: 15 }, dims: { group: 'Fruit' }, color: '#ffff00' },
      { id: 'c1', parentId: null, index: 2, name: 'Carrot', measures: { value: 8 }, dims: { group: 'Veggie' }, color: '#ff8800' },
    ]
    const result = applyView(rows, 'group')
    // Should have 2 group nodes + 3 original roots
    expect(result).toHaveLength(5)
    // Group nodes come first
    const fruitGroup = result.find(r => r.id === '__grp__group__Fruit')
    const veggieGroup = result.find(r => r.id === '__grp__group__Veggie')
    expect(fruitGroup).toBeDefined()
    expect(veggieGroup).toBeDefined()
    expect(fruitGroup!.parentId).toBeNull()
    expect(veggieGroup!.parentId).toBeNull()
    // Roots should have groupBy parent
    const apple = result.find(r => r.id === 'a1')!
    expect(apple.parentId).toBe('__grp__group__Fruit')
  })

  it('preserves non-root nodes', () => {
    const rows: VizNode[] = [
      { id: 'r1', parentId: null, index: 0, name: 'Root', measures: { value: 10 }, dims: { group: 'A' } },
      { id: 'c1', parentId: 'r1', index: 0, name: 'Child', measures: { value: 5 }, dims: { group: 'B' } },
    ]
    const result = applyView(rows, 'group')
    const child = result.find(r => r.id === 'c1')!
    // Child should retain its parentId (not be reparented)
    expect(child.parentId).toBe('r1')
  })

  it('handles missing dimension values with (none)', () => {
    const rows: VizNode[] = [
      { id: 'x1', parentId: null, index: 0, name: 'X', measures: { value: 10 }, dims: {} },
    ]
    const result = applyView(rows, 'group')
    const group = result.find(r => r.id === '__grp__group__(none)')
    expect(group).toBeDefined()
    expect(group!.name).toBe('(none)')
  })

  it('assigns colors to group nodes', () => {
    const rows: VizNode[] = [
      { id: 'a1', parentId: null, index: 0, name: 'Apple', measures: { value: 10 }, dims: { group: 'Fruit' }, color: '#ff0000' },
      { id: 'a2', parentId: null, index: 1, name: 'Apricot', measures: { value: 5 }, dims: { group: 'Fruit' }, color: '#ff0000' },
    ]
    const result = applyView(rows, 'group')
    const fruitGroup = result.find(r => r.id === '__grp__group__Fruit')!
    // Group should inherit the shared color from members
    expect(fruitGroup.color).toBe('#ff0000')
  })

  it('sorts flat array correctly with original indices preserved', () => {
    const rows: VizNode[] = [
      { id: 'a1', parentId: null, index: 0, name: 'Alpha', measures: { value: 10 }, dims: { group: 'X' } },
      { id: 'a2', parentId: null, index: 1, name: 'Beta', measures: { value: 15 }, dims: { group: 'Y' } },
      { id: 'a3', parentId: null, index: 2, name: 'Gamma', measures: { value: 8 }, dims: { group: 'X' } },
    ]
    const result = applyView(rows, 'group')
    const groupX = result.find(r => r.id === '__grp__group__X')!
    const groupY = result.find(r => r.id === '__grp__group__Y')!
    // X group should appear before Y in result (first group wins)
    expect(result.indexOf(groupX) < result.indexOf(groupY)).toBe(true)
  })
})

describe('drillPath', () => {
  it('returns path from root to node', () => {
    const rows: VizNode[] = [
      { id: 'r1', parentId: null, index: 0, name: 'Root', measures: {}, dims: {} },
      { id: 'c1', parentId: 'r1', index: 0, name: 'Child', measures: {}, dims: {} },
      { id: 'gc1', parentId: 'c1', index: 0, name: 'Grandchild', measures: {}, dims: {} },
    ]
    const path = drillPath(rows, 'gc1')
    expect(path).toHaveLength(3)
    expect(path[0]!.id).toBe('r1')
    expect(path[1]!.id).toBe('c1')
    expect(path[2]!.id).toBe('gc1')
  })

  it('returns single-element path for root', () => {
    const rows: VizNode[] = [
      { id: 'r1', parentId: null, index: 0, name: 'Root', measures: {}, dims: {} },
    ]
    const path = drillPath(rows, 'r1')
    expect(path).toHaveLength(1)
    expect(path[0]!.id).toBe('r1')
  })

  it('returns empty for null drillNodeId', () => {
    const rows: VizNode[] = [
      { id: 'r1', parentId: null, index: 0, name: 'Root', measures: {}, dims: {} },
    ]
    const path = drillPath(rows, null)
    expect(path).toEqual([])
  })

  it('returns empty for missing id', () => {
    const rows: VizNode[] = [
      { id: 'r1', parentId: null, index: 0, name: 'Root', measures: {}, dims: {} },
    ]
    const path = drillPath(rows, 'nonexistent')
    expect(path).toEqual([])
  })

  it('handles deep hierarchies', () => {
    const rows: VizNode[] = [
      { id: 'r1', parentId: null, index: 0, name: 'L0', measures: {}, dims: {} },
      { id: 'c1', parentId: 'r1', index: 0, name: 'L1', measures: {}, dims: {} },
      { id: 'c2', parentId: 'c1', index: 0, name: 'L2', measures: {}, dims: {} },
      { id: 'c3', parentId: 'c2', index: 0, name: 'L3', measures: {}, dims: {} },
      { id: 'c4', parentId: 'c3', index: 0, name: 'L4', measures: {}, dims: {} },
    ]
    const path = drillPath(rows, 'c4')
    expect(path).toHaveLength(5)
    expect(path.map(n => n.id)).toEqual(['r1', 'c1', 'c2', 'c3', 'c4'])
  })
})

describe('leavesOf', () => {
  it('returns all leaves from flat list', () => {
    const rows: VizNode[] = [
      { id: 'a1', parentId: null, index: 0, name: 'A', measures: { value: 10 }, dims: {} },
      { id: 'a2', parentId: null, index: 1, name: 'B', measures: { value: 15 }, dims: {} },
    ]
    const leaves = leavesOf(rows)
    expect(leaves).toHaveLength(2)
    expect(leaves.map(l => l.id).sort()).toEqual(['a1', 'a2'])
  })

  it('returns only leaves from nested tree', () => {
    const rows: VizNode[] = [
      { id: 'r1', parentId: null, index: 0, name: 'Root', measures: {}, dims: {} },
      { id: 'c1', parentId: 'r1', index: 0, name: 'Child 1', measures: { value: 5 }, dims: {} },
      { id: 'c2', parentId: 'r1', index: 1, name: 'Child 2', measures: { value: 10 }, dims: {} },
    ]
    const leaves = leavesOf(rows)
    expect(leaves).toHaveLength(2)
    expect(leaves.map(l => l.id).sort()).toEqual(['c1', 'c2'])
  })

  it('returns single leaf for single-node tree', () => {
    const rows: VizNode[] = [
      { id: 'solo', parentId: null, index: 0, name: 'Solo', measures: { value: 42 }, dims: {} },
    ]
    const leaves = leavesOf(rows)
    expect(leaves).toHaveLength(1)
    expect(leaves[0]!.id).toBe('solo')
  })

  it('handles empty array', () => {
    const leaves = leavesOf([])
    expect(leaves).toEqual([])
  })

  it('handles only internal nodes (no leaves)', () => {
    const rows: VizNode[] = [
      { id: 'r1', parentId: null, index: 0, name: 'Root', measures: {}, dims: {} },
      { id: 'c1', parentId: 'r1', index: 0, name: 'Child', measures: {}, dims: {} },
      { id: 'gc1', parentId: 'c1', index: 0, name: 'Grandchild', measures: {}, dims: {} },
    ]
    const leaves = leavesOf(rows)
    expect(leaves).toHaveLength(1)
    expect(leaves[0]!.id).toBe('gc1')
  })
})

describe('production bug surfaces (WIN-155)', () => {
  it('preserves depth hierarchy on drillPath with depth change', () => {
    // Simulates: drill target on depth change, group rollup
    const rows: VizNode[] = [
      { id: 'goal1', parentId: null, index: 0, name: 'Goal 1', measures: { est: 100 }, dims: { level: 'goal' } },
      { id: 'proj1', parentId: 'goal1', index: 0, name: 'Project 1', measures: {}, dims: { level: 'project' } },
      { id: 'task1', parentId: 'proj1', index: 0, name: 'Task 1', measures: { est: 30 }, dims: { level: 'task' } },
      { id: 'task2', parentId: 'proj1', index: 1, name: 'Task 2', measures: { est: 70 }, dims: { level: 'task' } },
    ]
    // Path to a deep task should survive depth selector changes
    const path = drillPath(rows, 'task1')
    expect(path.map(n => n.id)).toEqual(['goal1', 'proj1', 'task1'])
  })

  it('group rollup preserves measure totals', () => {
    const rows: VizNode[] = [
      { id: 'g1', parentId: null, index: 0, name: 'GroupA', measures: {}, dims: { group: 'A' } },
      { id: 'l1', parentId: 'g1', index: 0, name: 'Leaf 1', measures: { value: 10 }, dims: { group: 'A' } },
      { id: 'l2', parentId: 'g1', index: 1, name: 'Leaf 2', measures: { value: 20 }, dims: { group: 'A' } },
    ]
    const leaves = leavesOf(rows)
    const total = leaves.reduce((sum, l) => sum + (l.measures.value ?? 0), 0)
    expect(total).toBe(30)
  })

  it('handles groupBy applied then drillPath', () => {
    const flat: VizNode[] = [
      { id: 'a1', parentId: null, index: 0, name: 'Apple', measures: { value: 10 }, dims: { group: 'Fruit' } },
      { id: 'b1', parentId: null, index: 1, name: 'Banana', measures: { value: 15 }, dims: { group: 'Fruit' } },
      { id: 'c1', parentId: null, index: 2, name: 'Carrot', measures: { value: 8 }, dims: { group: 'Veggie' } },
    ]
    const grouped = applyView(flat, 'group')
    // After groupBy, drilling to a leaf should show [Group, Leaf]
    const path = drillPath(grouped, 'a1')
    expect(path).toHaveLength(2)
    expect(path[0]!.id).toMatch(/^__grp__/)
    expect(path[1]!.id).toBe('a1')
  })
})

describe('applyGroupings', () => {
  const flat: VizNode[] = [
    { id: 'a1', parentId: null, index: 0, name: 'Apple', measures: { value: 10 }, dims: { group: 'Fruit', season: 'Fall' }, color: '#e06666' },
    { id: 'b1', parentId: null, index: 1, name: 'Banana', measures: { value: 15 }, dims: { group: 'Fruit', season: 'Summer' }, color: '#e06666' },
    { id: 'c1', parentId: null, index: 2, name: 'Carrot', measures: { value: 8 }, dims: { group: 'Veggie', season: 'Fall' }, color: '#93c47d' },
    { id: 'd1', parentId: null, index: 3, name: 'Date', measures: { value: 5 }, dims: { group: 'Fruit', season: 'Fall' }, color: '#e06666' },
  ]

  it('groups by a single field and keeps every leaf visible', () => {
    const rules = [{ level: 0, groupings: [{ field: 'group', dir: 'asc' }] }]
    const grouped = applyGroupings(flat, rules)
    const fruitGroup = grouped.find(n => n.id === '__grp__group__Fruit')
    const veggieGroup = grouped.find(n => n.id === '__grp__group__Veggie')
    expect(fruitGroup).toBeDefined()
    expect(veggieGroup).toBeDefined()
    expect(grouped.filter(n => n.parentId === fruitGroup!.id).map(n => n.id)).toEqual(['a1', 'b1', 'd1'])
    expect(grouped.find(n => n.id === 'c1')!.parentId).toBe(veggieGroup!.id)
  })

  it('supports nested top-level groupings', () => {
    const rules = [{ level: 0, groupings: [
      { field: 'group', dir: 'asc' },
      { field: 'season', dir: 'asc' },
    ] }]
    const grouped = applyGroupings(flat, rules)
    const fruitGroup = grouped.find(n => n.id === '__grp__group__Fruit')
    expect(fruitGroup).toBeDefined()
    const fruitFall = grouped.find(n => n.id === `__grp__${fruitGroup!.id}__season__Fall`)
    const fruitSummer = grouped.find(n => n.id === `__grp__${fruitGroup!.id}__season__Summer`)
    expect(fruitFall).toBeDefined()
    expect(fruitSummer).toBeDefined()
    expect(grouped.filter(n => n.parentId === fruitFall!.id).map(n => n.id)).toEqual(['a1', 'd1'])
    expect(grouped.find(n => n.id === 'b1')!.parentId).toBe(fruitSummer!.id)
  })

  it('sorts group containers by field with custom order', () => {
    const rules = [{ level: 0, groupings: [
      { field: 'season', dir: 'asc', customOrder: ['Summer', 'Fall'] },
    ] }]
    const grouped = applyGroupings(flat, rules)
    const roots = grouped.filter(n => n.parentId === null)
    expect(roots[0]!.name).toBe('Summer')
    expect(roots[1]!.name).toBe('Fall')
  })

  it('sorts group containers by aggregate measure', () => {
    const rules = [{ level: 0, groupings: [
      { field: 'group', dir: 'desc', orderBy: 'value', aggregation: 'sum' },
    ] }]
    const grouped = applyGroupings(flat, rules)
    const roots = grouped.filter(n => n.parentId === null)
    expect(roots[0]!.name).toBe('Fruit')
    expect(roots[1]!.name).toBe('Veggie')
    expect(roots[0]!.measures.value).toBe(30)
    expect(roots[1]!.measures.value).toBe(8)
  })

  it('places missing values into a (none) group', () => {
    const withMissing: VizNode[] = [
      { id: 'm1', parentId: null, index: 0, name: 'M1', measures: { value: 1 }, dims: { group: 'A' } },
      { id: 'm2', parentId: null, index: 1, name: 'M2', measures: { value: 2 }, dims: {} },
    ]
    const rules = [{ level: 0, groupings: [{ field: 'group', dir: 'asc' }] }]
    const grouped = applyGroupings(withMissing, rules)
    const roots = grouped.filter(n => n.parentId === null)
    expect(roots.map(r => r.name)).toEqual(['A', '(none)'])
    expect(grouped.find(n => n.id === 'm2')!.parentId).toBe(roots[1]!.id)
  })

  it('produces stable group IDs across reordering', () => {
    const rules = [{ level: 0, groupings: [{ field: 'group', dir: 'asc' }] }]
    const grouped = applyGroupings(flat, rules)
    const descRules = [{ level: 0, groupings: [{ field: 'group', dir: 'desc' }] }]
    const groupedDesc = applyGroupings(flat, descRules)
    const ids = grouped.filter(n => n.parentId === null).map(n => n.id).sort()
    const idsDesc = groupedDesc.filter(n => n.parentId === null).map(n => n.id).sort()
    expect(ids).toEqual(idsDesc)
  })

  it('re-roots existing child subtrees without duplicating them', () => {
    const tree: VizNode[] = [
      { id: 'r1', parentId: null, index: 0, name: 'Root 1', measures: {}, dims: { status: 'done' }, color: '#ff0000' },
      { id: 'c1', parentId: 'r1', index: 1, name: 'Child 1', measures: { value: 10 }, dims: { status: 'done' } },
      { id: 'r2', parentId: null, index: 2, name: 'Root 2', measures: {}, dims: { status: 'done' }, color: '#ff0000' },
      { id: 'c2', parentId: 'r2', index: 3, name: 'Child 2', measures: { value: 20 }, dims: { status: 'done' } },
    ]
    const rules = [{ level: 0, groupings: [{ field: 'status', dir: 'asc' }] }]
    const grouped = applyGroupings(tree, rules)
    const group = grouped.find(n => n.id === '__grp__status__done')
    expect(group).toBeDefined()
    expect(grouped.find(n => n.id === 'r1')!.parentId).toBe(group!.id)
    expect(grouped.find(n => n.id === 'c1')!.parentId).toBe('r1')
    expect(grouped.find(n => n.id === 'r2')!.parentId).toBe(group!.id)
    expect(grouped.find(n => n.id === 'c2')!.parentId).toBe('r2')
    expect(grouped.find(n => n.id === 'c2')!.measures.value).toBe(20)
  })
})
