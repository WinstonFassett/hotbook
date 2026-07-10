import type { Workspace } from './v11'

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
 * Apply all available migrations in sequence.
 * Currently only v10→v11, but structure supports future versions.
 */
export function migrate(ws: Workspace): Workspace {
  // Assume input is v10 or earlier; migrate to v11
  let current = migrateV10toV11(ws)
  return current
}
