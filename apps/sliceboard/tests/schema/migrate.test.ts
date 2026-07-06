import { describe, it, expect } from 'vitest'
import { migrate } from '../../src/persistence/schema/migrate'
import type { Workspace, Dashboard } from '../../src/persistence/schema/v11'

/**
 * Fixture: v11 workspace (current format)
 * Should round-trip unchanged after migration.
 */
const FIXTURE_V11: Workspace = {
  datasets: [
    {
      id: 'ds-1',
      name: 'Sample Dataset',
      createdAt: '2026-05-13T12:00:00.000Z',
      shape: 'flat',
      rows: [
        { id: 'r1', parentId: null, index: 1, name: 'Item A', measures: { value: 10 }, dims: { group: 'Alpha' } },
        { id: 'r2', parentId: null, index: 2, name: 'Item B', measures: { value: 20 }, dims: { group: 'Beta' } },
      ],
      measureDefs: [{ key: 'value', label: 'Value' }],
      dimDefs: [{ key: 'group', label: 'Group', values: ['Alpha', 'Beta'] }],
    },
  ],
  dashboards: [
    {
      id: 'dash-1',
      datasetId: 'ds-1',
      name: 'Test Dashboard',
      createdAt: '2026-05-13T12:00:00.000Z',
      layout: [{ i: 'tile-1', x: 0, y: 0, w: 6, h: 8 }],
      tiles: [{ id: 'tile-1', kind: 'br-lc-bar', title: 'Bar Chart' }],
      measureKey: 'value',
      drills: { default: 'r1' },
    },
  ],
  activeDatasetId: 'ds-1',
  activeDashboardId: 'dash-1',
}

/**
 * Fixture: v10 workspace (legacy format with drillNodeId)
 * Should migrate to v11 format with drills['default'].
 */
const FIXTURE_V10: Workspace = {
  datasets: [
    {
      id: 'ds-2',
      name: 'Legacy Dataset',
      createdAt: '2026-05-01T12:00:00.000Z',
      shape: 'tree',
      rows: [
        { id: 'root', parentId: null, index: 1, name: 'Root', measures: {}, dims: {} },
        { id: 'child', parentId: 'root', index: 1, name: 'Child', measures: { budget: 100 }, dims: { team: 'Design' } },
      ],
      measureDefs: [{ key: 'budget', label: 'Budget', unit: 'k' }],
      dimDefs: [{ key: 'team', label: 'Team' }],
    },
  ],
  dashboards: [
    {
      id: 'dash-2',
      datasetId: 'ds-2',
      name: 'Legacy Dashboard',
      createdAt: '2026-05-01T12:00:00.000Z',
      layout: [{ i: 'tile-2', x: 0, y: 0, w: 12, h: 8 }],
      tiles: [{ id: 'tile-2', kind: 'br-lc-treemap', title: 'Treemap' }],
      measureKey: 'budget',
      drillNodeId: 'child',  // v10 format: single drill scope
    } as any, // Type override for v10 fixture
  ],
  activeDatasetId: 'ds-2',
  activeDashboardId: 'dash-2',
}

describe('persistence schema migration', () => {
  it('should round-trip v11 workspace unchanged', () => {
    const migrated = migrate(FIXTURE_V11)
    expect(migrated).toEqual(FIXTURE_V11)
  })

  it('should migrate v10 drillNodeId to v11 drills[default]', () => {
    const migrated = migrate(FIXTURE_V10)

    // Check that drills object was created with default key
    const dash = migrated.dashboards[0]
    expect(dash.drills).toEqual({ default: 'child' })

    // Check that drillNodeId was removed
    expect((dash as any).drillNodeId).toBeUndefined()

    // Check that other fields remain unchanged
    expect(dash.id).toBe('dash-2')
    expect(dash.datasetId).toBe('ds-2')
    expect(dash.tiles).toEqual(FIXTURE_V10.dashboards[0]!.tiles)
  })

  it('should preserve v11 workspace structure when migrating', () => {
    const migrated = migrate(FIXTURE_V11)

    // Verify datasets are unchanged
    expect(migrated.datasets).toEqual(FIXTURE_V11.datasets)

    // Verify dashboard fields are preserved
    const origDash = FIXTURE_V11.dashboards[0]!
    const migratedDash = migrated.dashboards[0]!
    expect(migratedDash.name).toBe(origDash.name)
    expect(migratedDash.layout).toEqual(origDash.layout)
    expect(migratedDash.tiles).toEqual(origDash.tiles)
    expect(migratedDash.drills).toEqual(origDash.drills)
  })

  it('should handle v10 workspace with multiple dashboards', () => {
    const multiDashV10: Workspace = {
      ...FIXTURE_V10,
      dashboards: [
        {
          ...FIXTURE_V10.dashboards[0],
          id: 'dash-a',
          drillNodeId: 'child',
        } as any,
        {
          ...FIXTURE_V10.dashboards[0],
          id: 'dash-b',
          drillNodeId: 'root',
        } as any,
      ],
    }

    const migrated = migrate(multiDashV10)

    expect(migrated.dashboards[0]!.drills).toEqual({ default: 'child' })
    expect(migrated.dashboards[1]!.drills).toEqual({ default: 'root' })
    expect((migrated.dashboards[0] as any).drillNodeId).toBeUndefined()
    expect((migrated.dashboards[1] as any).drillNodeId).toBeUndefined()
  })

  it('should not overwrite existing drills if present alongside drillNodeId', () => {
    const mixedDash: any = {
      id: 'dash-mixed',
      datasetId: 'ds-1',
      name: 'Mixed Dashboard',
      createdAt: '2026-05-13T12:00:00.000Z',
      layout: [],
      tiles: [],
      measureKey: 'value',
      drills: { default: 'r1', 'other': 'r2' },
      drillNodeId: 'r3', // This should be removed but drills should stay
    }

    const ws: Workspace = {
      datasets: [],
      dashboards: [mixedDash],
      activeDatasetId: 'ds-1',
      activeDashboardId: 'dash-mixed',
    }

    const migrated = migrate(ws)
    const migratedDash = migrated.dashboards[0]!

    // Existing drills should be preserved
    expect(migratedDash.drills).toEqual({ default: 'r1', 'other': 'r2' })
    expect((migratedDash as any).drillNodeId).toBeUndefined()
  })
})
