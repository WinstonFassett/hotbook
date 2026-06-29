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

// Test single pane with all tabs
test('1 tile → 1 group with 1 tab', () => {
  const tree = defaultDockTree(['a'])
  assert(tree?.kind === 'group', 'Should be a group')
  assert(allGroups(tree).length === 1, 'Should have 1 group')
  assert(allGroups(tree)[0]!.panels.length === 1, 'Should have 1 panel')
})

test('2 tiles → 1 group with 2 tabs', () => {
  const tree = defaultDockTree(['a', 'b'])
  assert(tree?.kind === 'group', 'Should be a group')
  const groups = allGroups(tree)
  assert(groups.length === 1, 'Should have 1 group')
  assert(groups[0]!.panels.length === 2, 'Should have 2 panels (tabs)')
})

test('5 tiles → 1 group with 5 tabs', () => {
  const tree = defaultDockTree(['a', 'b', 'c', 'd', 'e'])
  assert(tree?.kind === 'group', 'Should be a group')
  const groups = allGroups(tree)
  assert(groups.length === 1, 'Should have 1 group')
  assert(groups[0]!.panels.length === 5, 'Should have 5 panels (tabs)')
})

test('15 tiles → 1 group with 15 tabs', () => {
  const tiles = Array.from({ length: 15 }, (_, i) => String.fromCharCode(97 + i))
  const tree = defaultDockTree(tiles)
  assert(tree?.kind === 'group', 'Should be a group')
  const groups = allGroups(tree)
  assert(groups.length === 1, 'Should have 1 group')
  assert(groups[0]!.panels.length === 15, 'Should have 15 panels (tabs)')
})

// Test removePanel
test('removePanel with 2 tabs leaves 1', () => {
  const tree = defaultDockTree(['a', 'b'])
  const groups = allGroups(tree)
  const panelId = groups[0]!.panels[0]!.id
  const after = removePanel(tree, panelId)
  assert(allGroups(after).length === 1, 'Should still have 1 group')
  assert(allGroups(after)[0]!.panels.length === 1, 'Should have 1 panel left')
})

test('removePanel with 1 tab collapses to null', () => {
  const tree = defaultDockTree(['a'])
  const groups = allGroups(tree)
  const panelId = groups[0]!.panels[0]!.id
  const after = removePanel(tree, panelId)
  assert(after === null, 'Should collapse to null')
})

console.log('\nAll tests passed!')
