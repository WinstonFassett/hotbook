// Quick test for defaultDockTree changes
import { defaultDockTree, allGroups, removePanel, removeGroup } from './dock'

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    console.error(`✗ ${name}:`, e)
    process.exit(1)
  }
}

function assert(condition: boolean, message?: string) {
  if (!condition) throw new Error(message || 'Assertion failed')
}

// Test edge cases
test('1 tile → 1 group', () => {
  const tree = defaultDockTree(['a'])
  assert(tree?.kind === 'group', 'Should be a group')
  assert(allGroups(tree).length === 1, 'Should have 1 group')
})

// Test 2×2 grid distribution
test('2 tiles → 2×1 (round-robin)', () => {
  const tree = defaultDockTree(['a', 'b'])
  const groups = allGroups(tree)
  assert(groups.length === 2, 'Should have 2 groups')
  assert(groups[0]!.panels.length === 1, 'Group 0 should have 1 panel (a)')
  assert(groups[1]!.panels.length === 1, 'Group 1 should have 1 panel (b)')
})

test('3 tiles → 2×2 grid (round-robin)', () => {
  const tree = defaultDockTree(['a', 'b', 'c'])
  const groups = allGroups(tree)
  assert(groups.length === 3, 'Should have 3 groups')
  // Round-robin: a=0, b=1, c=2
  assert(groups[0]!.panels.length === 1, 'Group 0 should have 1 panel (a)')
  assert(groups[1]!.panels.length === 1, 'Group 1 should have 1 panel (b)')
  assert(groups[2]!.panels.length === 1, 'Group 2 should have 1 panel (c)')
})

test('4 tiles → 2×2 grid (round-robin)', () => {
  const tree = defaultDockTree(['a', 'b', 'c', 'd'])
  assert(tree?.kind === 'split', 'Should be a split')
  assert(tree.direction === 'col', 'Root should be col (2 rows)')
  const groups = allGroups(tree)
  assert(groups.length === 4, 'Should have 4 groups')
  // Round-robin: a=0, b=1, c=2, d=3
  assert(groups[0]!.panels.length === 1, 'Group 0 should have 1 panel (a)')
  assert(groups[1]!.panels.length === 1, 'Group 1 should have 1 panel (b)')
  assert(groups[2]!.panels.length === 1, 'Group 2 should have 1 panel (c)')
  assert(groups[3]!.panels.length === 1, 'Group 3 should have 1 panel (d)')
})

test('5 tiles → 2×2 grid (round-robin, group 0 gets 2 panels)', () => {
  const tree = defaultDockTree(['a', 'b', 'c', 'd', 'e'])
  assert(tree?.kind === 'split', 'Should be a split')
  assert(tree.direction === 'col', 'Root should be col')
  const groups = allGroups(tree)
  assert(groups.length === 4, 'Should have 4 groups')
  // Round-robin: a=0, b=1, c=2, d=3, e=0
  assert(groups[0]!.panels.length === 2, 'Group 0 should have 2 panels (a, e)')
  assert(groups[1]!.panels.length === 1, 'Group 1 should have 1 panel (b)')
  assert(groups[2]!.panels.length === 1, 'Group 2 should have 1 panel (c)')
  assert(groups[3]!.panels.length === 1, 'Group 3 should have 1 panel (d)')
})

test('8 tiles → 2×2 grid (round-robin, each group gets 2 panels)', () => {
  const tree = defaultDockTree(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  const groups = allGroups(tree)
  assert(groups.length === 4, 'Should have 4 groups')
  // Round-robin: a=0, b=1, c=2, d=3, e=0, f=1, g=2, h=3
  assert(groups[0]!.panels.length === 2, 'Group 0 should have 2 panels (a, e)')
  assert(groups[1]!.panels.length === 2, 'Group 1 should have 2 panels (b, f)')
  assert(groups[2]!.panels.length === 2, 'Group 2 should have 2 panels (c, g)')
  assert(groups[3]!.panels.length === 2, 'Group 3 should have 2 panels (d, h)')
})

// Test removePanel
test('removePanel collapses empty group', () => {
  const tree = defaultDockTree(['a', 'b'])
  const groups = allGroups(tree)
  const panelId = groups[0]!.panels[0]!.id
  const after = removePanel(tree, panelId)
  assert(allGroups(after).length === 1, 'Should collapse to 1 group')
})

// Test removeGroup
test('removeGroup removes entire group', () => {
  const tree = defaultDockTree(['a', 'b', 'c', 'd'])
  const groups = allGroups(tree)
  const after = removeGroup(tree, groups[0]!.id)
  assert(allGroups(after).length === 3, 'Should have 3 groups left')
})

console.log('\nAll tests passed!')
