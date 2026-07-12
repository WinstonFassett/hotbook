import { describe, it, expect } from 'vitest'
import { applyGroupings } from '@hotbook/core'
import { buildLifeDataset } from '../src/persistence/seeds/life-goals'
import { resolveGroupings } from '../src/tile-sources'

describe('resolveGroupings + applyGroupings integration', () => {
  it('groups life dataset top-level nodes by level', () => {
    const ds = buildLifeDataset()
    const tile = {
      id: 't',
      kind: 'pack' as const,
      title: 'Pack',
      groupings: { rules: [{ level: 0, groupings: [{ field: 'level', dir: 'asc' }] }] },
    }
    const rules = resolveGroupings(tile, 'est', 'index', ds.measureDefs)
    const grouped = applyGroupings(ds.nodes, rules)
    const roots = grouped.filter(n => n.parentId === null)
    expect(roots.length).toBe(1)
    expect(roots[0]!.name).toBe('goal')
    expect(grouped.filter(n => n.parentId === roots[0]!.id).length).toBe(5)
  })

  it('groups life dataset top-level nodes by status (missing -> none group)', () => {
    const ds = buildLifeDataset()
    const tile = {
      id: 't',
      kind: 'pack' as const,
      title: 'Pack',
      groupings: { rules: [{ level: 0, groupings: [{ field: 'status', dir: 'asc' }] }] },
    }
    const rules = resolveGroupings(tile, 'est', 'index', ds.measureDefs)
    const grouped = applyGroupings(ds.nodes, rules)
    const roots = grouped.filter(n => n.parentId === null)
    expect(roots.length).toBe(1)
    expect(roots[0]!.name).toBe('(none)')
    expect(grouped.filter(n => n.parentId === roots[0]!.id).length).toBe(5)
  })
})
