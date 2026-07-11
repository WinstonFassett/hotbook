import type { Workspace, TileKind } from './schema/v11'
import { migrate } from './schema/migrate'
import { buildSeedWorkspace } from './seeds'

// ─── Storage ──────────────────────────────────────────────────────────────────

const LS_KEY = 'sb:workspace:v11'

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// Valid tile kinds that can be rendered (includes retired kinds that still work)
const VALID_TILE_KINDS = new Set<TileKind>([
  'bar', 'bands', 'line', 'area', 'scatter', 'pie',
  'radar', 'concentric-arc',
  'gauge', 'gauge-segmented',
  'pack', 'treemap', 'treetable', 'icicle', 'sunburst',
  'sankey', 'tree', 'gantt',
  'treetable', // retired but still renders via vanilla treetable
])

function migrateDatasetFieldNames(ws: Workspace): Workspace {
  ws.datasets.forEach((ds: any) => {
    if ('rows' in ds && !('nodes' in ds)) {
      ds.nodes = ds.rows
      delete ds.rows
    }
  })
  return ws
}

function load(): Workspace | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const ws = JSON.parse(raw) as Workspace
      migrateDatasetFieldNames(ws)
      // Guard: filter out tiles with unknown kinds
      ws.dashboards.forEach(dash => {
        const before = dash.tiles.length
        dash.tiles = dash.tiles.filter(tile => {
          const valid = VALID_TILE_KINDS.has(tile.kind)
          if (!valid) {
            console.warn(`[persistence] Dropped tile ${tile.id} with unknown kind: ${tile.kind}`)
          }
          return valid
        })
        if (dash.tiles.length < before) {
          console.warn(`[persistence] Dropped ${before - dash.tiles.length} invalid tiles from dashboard ${dash.id}`)
        }
      })
      return ws
    }

    // One-shot migration from v10
    const legacy = localStorage.getItem('sb:workspace:v10')
    if (!legacy) return null
    const ws = JSON.parse(legacy) as Workspace
    const migrated = migrate(ws)
    migrateDatasetFieldNames(migrated)
    migrated.dashboards.forEach(dash => {
      // Guard: filter out tiles with unknown kinds (also for migrated data)
      const before = dash.tiles.length
      dash.tiles = dash.tiles.filter(tile => {
        const valid = VALID_TILE_KINDS.has(tile.kind)
        if (!valid) {
          console.warn(`[persistence] Dropped tile ${tile.id} with unknown kind: ${tile.kind}`)
        }
        return valid
      })
      if (dash.tiles.length < before) {
        console.warn(`[persistence] Dropped ${before - dash.tiles.length} invalid tiles from dashboard ${dash.id}`)
      }
    })
    return migrated
  } catch (e) {
    console.error('[persistence] Failed to load workspace:', e)
    return null
  }
}

function save(ws: Workspace): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ws))
  } catch { /* storage unavailable */ }
}

export function initWorkspace(): Workspace {
  const stored = load()
  if (stored) return stored
  const ws = buildSeedWorkspace()
  save(ws)
  return ws
}

export function saveWorkspace(ws: Workspace): void {
  save(ws)
}

export function newId(): string {
  return genId()
}
