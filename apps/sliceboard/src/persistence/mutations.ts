import type { Workspace, Dataset, Dashboard, Tile, TileKind } from './schema/v11'
import type { PNode } from '@winstonfassett/vizform-core'
import { removeTileFromDock } from '../dock'
import { applyView, drillPath } from '@winstonfassett/vizform-core'

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function updateRow(ws: Workspace, dsId: string, rowId: string, patch: Partial<PNode>): Workspace {
  return {
    ...ws,
    datasets: ws.datasets.map(ds =>
      ds.id !== dsId ? ds : {
        ...ds,
        rows: ds.rows.map(r => r.id !== rowId ? r : { ...r, ...patch }),
      }
    ),
  }
}

// Apply many row patches in a SINGLE workspace update. Parent-resize gestures
// redistribute across siblings, changing several leaves on one tick; emitting
// them as separate updateRow calls would clobber each other (each starts from
// the same stale workspace, so only the last write survives). Batching keeps
// every changed leaf in one commit.
export function updateRows(ws: Workspace, dsId: string, patches: Array<{ id: string; patch: Partial<PNode> }>): Workspace {
  if (patches.length === 0) return ws
  const byId = new Map(patches.map(p => [p.id, p.patch]))
  return {
    ...ws,
    datasets: ws.datasets.map(ds =>
      ds.id !== dsId ? ds : {
        ...ds,
        rows: ds.rows.map(r => { const p = byId.get(r.id); return p ? { ...r, ...p } : r }),
      }
    ),
  }
}

export function reorderLeaves(ws: Workspace, dsId: string, orderedLeafIds: string[]): Workspace {
  return {
    ...ws,
    datasets: ws.datasets.map(ds => {
      if (ds.id !== dsId) return ds
      const leafSet = new Set(ds.rows.filter(n => !ds.rows.some(m => m.parentId === n.id)).map(n => n.id))
      const leafPositions = ds.rows.reduce<number[]>((acc, n, i) => { if (leafSet.has(n.id)) acc.push(i); return acc }, [])
      const byId = new Map(ds.rows.map(n => [n.id, n]))
      const result = [...ds.rows]
      orderedLeafIds.forEach((id, i) => { result[leafPositions[i]!] = byId.get(id)! })
      return { ...ds, rows: result }
    }),
  }
}

export function createDataset(ws: Workspace, name: string): Workspace {
  const ds: Dataset = {
    id: genId(),
    name,
    createdAt: new Date().toISOString(),
    rows: [],
    measureDefs: [{ key: 'value', label: 'Value' }],
    dimDefs: [],
  }
  return { ...ws, datasets: [...ws.datasets, ds] }
}

export function createDashboard(ws: Workspace, name: string, datasetId: string): Workspace {
  const ds = ws.datasets.find(d => d.id === datasetId)
  const dash: Dashboard = {
    id: genId(),
    datasetId,
    name,
    createdAt: new Date().toISOString(),
    layout: [],
    tiles: [],
    measureKey: ds?.measureDefs[0]?.key ?? 'value',
  }
  return { ...ws, dashboards: [...ws.dashboards, dash] }
}

export function updateDataset(ws: Workspace, ds: Dataset): Workspace {
  return { ...ws, datasets: ws.datasets.map(d => d.id === ds.id ? ds : d) }
}

export function updateDashboard(ws: Workspace, dash: Dashboard): Workspace {
  return { ...ws, dashboards: ws.dashboards.map(d => d.id === dash.id ? dash : d) }
}

export function addTile(ws: Workspace, dashId: string, kind: TileKind): Workspace {
  const dash = ws.dashboards.find(d => d.id === dashId)
  if (!dash) return ws
  const tile: Tile = { id: genId(), kind }
  const layout = { i: tile.id, x: 0, y: Infinity, w: 6, h: 8 }
  return updateDashboard(ws, { ...dash, tiles: [...dash.tiles, tile], layout: [...dash.layout, layout] })
}

export function removeTile(ws: Workspace, dashId: string, tileId: string): Workspace {
  const dash = ws.dashboards.find(d => d.id === dashId)
  if (!dash) return ws
  return updateDashboard(ws, {
    ...dash,
    tiles: dash.tiles.filter(t => t.id !== tileId),
    layout: dash.layout.filter(l => l.i !== tileId),
    dockTree: removeTileFromDock(dash.dockTree ?? null, tileId),
  })
}

export function deleteDashboard(ws: Workspace, dashId: string): Workspace {
  const remaining = ws.dashboards.filter(d => d.id !== dashId)
  return { ...ws, dashboards: remaining, activeDashboardId: remaining[0]?.id ?? '' }
}

export function deleteDataset(ws: Workspace, dsId: string): Workspace {
  const datasets = ws.datasets.filter(d => d.id !== dsId)
  const dashboards = ws.dashboards.filter(d => d.datasetId !== dsId)
  return { ...ws, datasets, dashboards, activeDatasetId: datasets[0]?.id ?? '', activeDashboardId: dashboards[0]?.id ?? '' }
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function activeDataset(ws: Workspace): Dataset | undefined {
  return ws.datasets.find(d => d.id === ws.activeDatasetId)
}

export function activeDashboard(ws: Workspace): Dashboard | undefined {
  return ws.dashboards.find(d => d.id === ws.activeDashboardId)
}

export function dashboardsForDataset(ws: Workspace, dsId: string): Dashboard[] {
  return ws.dashboards.filter(d => d.datasetId === dsId)
}

// ─── GroupBy helper (re-exported from @winstonfassett/vizform-core) ──────────

// For backwards compatibility, re-export applyView as applyGroupBy
export function applyGroupBy(rows: PNode[], dimKey: string): PNode[] {
  return applyView(rows, dimKey)
}

// ─── Drill helpers (re-exported from @winstonfassett/vizform-core) ────────────
export { drillPath }
