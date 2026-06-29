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

// Test 1-2 tiles
test('1 tile → 1 group', () => {
  const tree = defaultDockTree(['a'])
  assert(tree?.kind === 'group', 'Should be a group')
  assert(allGroups(tree).length === 1, 'Should have 1 group')
})

test('2 tiles → 2 groups in row (2×1)', () => {
  const tree = defaultDockTree(['a', 'b'])
  assert(tree?.kind === 'split', 'Should be a split')
  assert(tree.direction === 'row', 'Should be a row')
  const groups = allGroups(tree)
  assert(groups.length === 2, 'Should have 2 groups')
  assert(groups[0]!.panels.length === 1, 'First group should have 1 panel')
  assert(groups[1]!.panels.length === 1, 'Second group should have 1 panel')
})

// Test 3-4 tiles
test('3 tiles → 2 groups (2×1) with tabs', () => {
  const tree = defaultDockTree(['a', 'b', 'c'])
  assert(tree?.kind === 'split', 'Should be a split')
  assert(tree.direction === 'row', 'Should be a row')
  const groups = allGroups(tree)
  assert(groups.length === 2, 'Should have 2 groups')
  assert(groups[0]!.panels.length === 2, 'First group should have 2 panels')
  assert(groups[1]!.panels.length === 1, 'Second group should have 1 panel')
})

test('4 tiles → 2 groups (2×1) with tabs', () => {
  const tree = defaultDockTree(['a', 'b', 'c', 'd'])
  assert(tree?.kind === 'split', 'Should be a split')
  assert(tree.direction === 'row', 'Should be a row')
  const groups = allGroups(tree)
  assert(groups.length === 2, 'Should have 2 groups')
  assert(groups[0]!.panels.length === 2, 'First group should have 2 panels')
  assert(groups[1]!.panels.length === 2, 'Second group should have 2 panels')
})

// Test 5+ tiles
test('5 tiles → 2×2 grid (4 groups)', () => {
  const tree = defaultDockTree(['a', 'b', 'c', 'd', 'e'])
  assert(tree?.kind === 'split', 'Should be a split')
  assert(tree.direction === 'col', 'Root should be col')
  const groups = allGroups(tree)
  assert(groups.length === 4, 'Should have 4 groups')
  assert(groups[0]!.panels.length === 2, 'Top-left should have 2 panels (a + e)')
  assert(groups[1]!.panels.length === 1, 'Top-right should have 1 panel')
  assert(groups[2]!.panels.length === 1, 'Bottom-left should have 1 panel')
  assert(groups[3]!.panels.length === 1, 'Bottom-right should have 1 panel')
})

test('8 tiles → 2×2 grid with overflow in first group', () => {
  const tree = defaultDockTree(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  const groups = allGroups(tree)
  assert(groups.length === 4, 'Should have 4 groups')
  assert(groups[0]!.panels.length === 5, 'Top-left should have 5 panels (a,e,f,g,h)')
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
  assert(allGroups(after).length === 1, 'Should have 1 group left')
})

console.log('\nAll tests passed!')
