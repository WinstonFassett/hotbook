import type { Workspace, Tile } from './v11'

/**
 * Migrate from v10 to v11 format.
 * Main change: drillNodeId (single drill scope) → drills['default'].
 */
export function migrateV10toV11(ws: Workspace): Workspace {
  return {
    ...ws,
    dashboards: ws.dashboards.map(dash => {
      if (dash.drillNodeId != null && dash.drills == null) {
        return {
          ...dash,
          drills: { default: dash.drillNodeId },
          drillNodeId: undefined,
        }
      }
      // Ensure drillNodeId is removed even if no drills object needs creation
      const { drillNodeId, ...rest } = dash
      return rest as any // Type-safe enough since we've already checked drills
    }),
  }
}

/**
 * Migrate legacy Tile.groupBy to Tile.groupings.
 * v1 uses top-level groupings only (level: 0).
 */
function migrateTileGroupBy(tile: Tile): Tile {
  if (!tile.groupBy) return tile
  if (tile.groupings) return { ...tile, groupBy: undefined }
  return {
    ...tile,
    groupings: {
      rules: [{ level: 0, groupings: [{ field: tile.groupBy, dir: 'asc' }] }],
    },
    groupBy: undefined,
  }
}

function normalizeGroupings(ws: Workspace): Workspace {
  return {
    ...ws,
    dashboards: ws.dashboards.map(dash => ({
      ...dash,
      tiles: dash.tiles.map(migrateTileGroupBy),
    })),
  }
}

/**
 * Apply all available migrations in sequence.
 * Currently only v10→v11 + groupBy→groupings, but structure supports future versions.
 */
export function migrate(ws: Workspace): Workspace {
  let current = migrateV10toV11(ws)
  current = normalizeGroupings(current)
  return current
}
