import { useState, useCallback, useEffect, useRef } from 'react'
import { GridLayout, useContainerWidth } from 'react-grid-layout'
import type { LayoutItem } from 'react-grid-layout'
import { Viz, HTreetable, pickColor } from '@winstonfassett/vizform-react-d3'
import type { Goal } from '@winstonfassett/vizform-react-d3'
import { leavesOf } from '@winstonfassett/vizform-vanilla-d3'
import { Treemap } from './viz/Treemap'
import { Icicle } from './viz/Icicle'
import { Sunburst } from './viz/Sunburst'
import {
  BrLcBar, BrLcLine, BrLcArea, BrLcScatter, BrLcPie, BrLcRadar, BrLcConcentricArc,
  BrLcPack, BrLcTreemap, BrLcIcicle, BrLcSunburst, BrLcSankey, BrLcTree,
} from './viz/br/BrLcCharts'
import {
  SvelteLcSunburst, SvelteLcIcicle, SvelteLcPack, SvelteLcTreemap, SvelteTreemapDemo,
} from './viz/br/SvelteLcCharts'
import {
  initWorkspace, saveWorkspace,
  createDataset, createDashboard, updateDataset, updateDashboard,
  addTile, removeTile, deleteDashboard, deleteDataset,
  activeDataset, activeDashboard, dashboardsForDataset,
  updateRow, updateRows, reorderLeaves, applyGroupBy,
} from './persistence'
import type { Workspace, Dataset, Dashboard, Tile, TileKind, PNode } from './persistence'
import { hudStore, resetHudForDataset, useHudStore } from './store'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './App.css'

// Group-coherent coloring, shared by every hierarchy chart (first-gen + BR-LC)
// so the whole board reads the same way: each top-level group gets one vibrant
// PALETTE hue and all its descendants inherit it. Datasets often carry scattered
// per-node colors (a group rose, its child violet) which looked incoherent and
// differed chart-to-chart; this overwrites them with the grouped look the flat
// Viz already had. `nodeColor`/`pnodeColor` resolve a node by walking up to the
// nearest colored ancestor, so coloring every node directly here is sufficient.
function colorByGroup(nodes: PNode[]): PNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const rootOf = (n: PNode): PNode => {
    let cur = n
    while (cur.parentId && byId.has(cur.parentId)) cur = byId.get(cur.parentId)!
    return cur
  }
  // Stable hue per top-level group, by document order of the roots.
  const hueByRoot = new Map<string, string>()
  let gi = 0
  for (const n of nodes) {
    if (!n.parentId || !byId.has(n.parentId)) {
      if (!hueByRoot.has(n.id)) hueByRoot.set(n.id, pickColor(gi++))
    }
  }
  return nodes.map(n => ({ ...n, color: hueByRoot.get(rootOf(n).id) ?? n.color }))
}

const TILE_KINDS: TileKind[] = [
  'treetable', 'h-treemap', 'h-icicle', 'h-radial', 'treemap', 'radial', 'bands',
  'br-lc-bar', 'br-lc-line', 'br-lc-area', 'br-lc-scatter', 'br-lc-pie',
  'br-lc-radar', 'br-lc-concentric-arc',
  'br-lc-pack', 'br-lc-treemap', 'br-lc-icicle', 'br-lc-sunburst', 'br-lc-sankey', 'br-lc-tree',
  'svelte-br-lc-sunburst', 'svelte-br-lc-icicle', 'svelte-br-lc-pack', 'svelte-br-lc-treemap', 'svelte-treemap-demo',
]
const TILE_LABELS: Record<TileKind, string> = {
  'treetable':           'Table (D3)',
  'h-treemap':           'H-Treemap (D3)',
  'h-icicle':            'Icicle (D3)',
  'h-radial':            'Sunburst (D3)',
  'treemap':             'Treemap (D3)',
  'radial':              'Radial (D3)',
  'bands':               'Bands (D3)',
  'br-lc-bar':           'Bar (BR-LC)',
  'br-lc-line':          'Line (BR-LC)',
  'br-lc-area':          'Area (BR-LC)',
  'br-lc-scatter':       'Scatter (BR-LC)',
  'br-lc-pie':           'Pie (BR-LC)',
  'br-lc-radar':         'Radar (BR-LC)',
  'br-lc-concentric-arc':'ConcentricArc (BR-LC)',
  'br-lc-pack':          'Pack (BR-LC)',
  'br-lc-treemap':       'Treemap (BR-LC)',
  'br-lc-icicle':        'Icicle (BR-LC)',
  'br-lc-sunburst':      'Sunburst (BR-LC)',
  'br-lc-sankey':        'Sankey (BR-LC)',
  'br-lc-tree':          'Tree (BR-LC)',
  'svelte-br-lc-sunburst':'Sunburst (Svelte BR-LC)',
  'svelte-br-lc-icicle': 'Icicle (Svelte BR-LC)',
  'svelte-br-lc-pack':   'Pack (Svelte BR-LC)',
  'svelte-br-lc-treemap':'Treemap (Svelte BR-LC)',
  'svelte-treemap-demo': 'Treemap (Svelte demo)',
}

// ─── Tile content ─────────────────────────────────────────────────────────────

function TileContent({ tile, ds, measureKey, onNodeUpdate, onNodesUpdate, onNodeReorder }: { tile: Tile; ds: Dataset; measureKey: string; onNodeUpdate: (rowId: string, measures: PNode['measures']) => void; onNodesUpdate: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void; onNodeReorder: (orderedIds: string[]) => void }) {
  const mk = tile.measureKey ?? measureKey
  const hud = useHudStore()
  const { hoverId, selectionId, focusId } = hud
  const onHover = (id: string | null) => hudStore.setHover(id)
  const onSelect = (id: string) => hudStore.setSelection(id)
  const onFocus = (id: string) => hudStore.setFocus(id)

  const depth = tile.depth ?? 2
  const sortBy = tile.sortBy ?? 'index'
  const nodes = colorByGroup(tile.groupBy ? applyGroupBy(ds.rows, tile.groupBy) : ds.rows)

  if (tile.kind === 'h-treemap') {
    return <Treemap nodes={nodes} measureKey={mk} depth={depth} sortBy={sortBy} hoverId={hoverId} selectionId={selectionId} focusId={focusId} onHover={onHover} onSelect={onSelect} onFocus={onFocus} onUpdate={onNodeUpdate} />
  }
  if (tile.kind === 'h-icicle') {
    return <Icicle nodes={nodes} measureKey={mk} depth={depth} sortBy={sortBy} hoverId={hoverId} selectionId={selectionId} focusId={focusId} onHover={onHover} onSelect={onSelect} onFocus={onFocus} onUpdate={onNodeUpdate} />
  }
  if (tile.kind === 'h-radial') {
    return <Sunburst nodes={nodes} measureKey={mk} depth={depth} sortBy={sortBy} hoverId={hoverId} selectionId={selectionId} focusId={focusId} onHover={onHover} onSelect={onSelect} onFocus={onFocus} onUpdate={onNodeUpdate} />
  }
  if (tile.kind === 'treetable') {
    return <HTreetable nodes={nodes} measureKey={mk} />
  }

  // ── BR-LC flat charts ────────────────────────────────────────────────────
  if (tile.kind === 'br-lc-bar')            return <BrLcBar nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} />
  if (tile.kind === 'br-lc-line')           return <BrLcLine nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} />
  if (tile.kind === 'br-lc-area')           return <BrLcArea nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} />
  if (tile.kind === 'br-lc-scatter')        return <BrLcScatter nodes={nodes} xKey={tile.xKey ?? '_index'} yKey={tile.yKey ?? mk} onUpdate={onNodeUpdate} />
  if (tile.kind === 'br-lc-pie')            return <BrLcPie nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} />
  if (tile.kind === 'br-lc-radar')          return <BrLcRadar nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} />
  if (tile.kind === 'br-lc-concentric-arc') return <BrLcConcentricArc nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} />

  // ── BR-LC hierarchical charts ────────────────────────────────────────────
  if (tile.kind === 'br-lc-pack')           return <BrLcPack nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />
  if (tile.kind === 'br-lc-treemap')        return <BrLcTreemap nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />
  if (tile.kind === 'br-lc-icicle')         return <BrLcIcicle nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />
  if (tile.kind === 'br-lc-sunburst')       return <BrLcSunburst nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />
  if (tile.kind === 'br-lc-sankey')         return <BrLcSankey nodes={nodes} measureKey={mk} />
  if (tile.kind === 'br-lc-tree')           return <BrLcTree nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />

  // ── Svelte LayerChart charts (real Svelte+LayerChart, live data + sync) ────
  if (tile.kind === 'svelte-br-lc-sunburst') return <SvelteLcSunburst nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />
  if (tile.kind === 'svelte-br-lc-icicle')   return <SvelteLcIcicle nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />
  if (tile.kind === 'svelte-br-lc-pack')     return <SvelteLcPack nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />
  if (tile.kind === 'svelte-br-lc-treemap')  return <SvelteLcTreemap nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />
  if (tile.kind === 'svelte-treemap-demo')   return <SvelteTreemapDemo />

  // Flat Viz uses the same group-coherent colors as every other chart: `nodes`
  // is already colored by `colorByGroup` (each leaf carries its group's hue), so
  // just read `n.color` — no separate per-tile recolor that would diverge.
  const goals: Goal[] = leavesOf(nodes).map((n, idx) => {
    return {
      id: n.id, name: n.name, color: n.color ?? pickColor(idx),
      measurements: { ...n.measures, _index: idx },
      archived: false, tags: [], urgent: false, important: false,
      createdAt: '', updatedAt: '',
    }
  })
  // Bands rows are fixed height — give the container a natural minimum so the tile body can scroll
  const bandsMinH = tile.kind === 'bands' ? 28 + goals.filter(g => !g.archived).length * 46 : undefined
  return (
    <div style={{ width: '100%', height: bandsMinH ?? '100%', minHeight: bandsMinH }}>
      <Viz
        goals={goals} mode={tile.kind as 'treemap' | 'radial' | 'bands'}
        activeUnit={mk} unitKind="size"
        sortUnit={sortBy === 'index' ? '_index' : mk}
        sortUnitKind={sortBy === 'index' ? 'order' : 'size'}
        frame={undefined}
        onUpdate={(id, patch) => { if (patch.measurements) onNodeUpdate(id, patch.measurements as PNode['measures']) }}
        onReorder={onNodeReorder}
      />
    </div>
  )
}

// ─── Tile wrapper ─────────────────────────────────────────────────────────────

const HIER_KINDS = new Set<TileKind>(['h-treemap', 'h-icicle', 'h-radial', 'br-lc-pack', 'br-lc-treemap', 'br-lc-icicle', 'br-lc-sunburst', 'br-lc-tree', 'svelte-br-lc-sunburst', 'svelte-br-lc-icicle', 'svelte-br-lc-pack', 'svelte-br-lc-treemap'])
const VIZ_KINDS = new Set<TileKind>(['h-treemap', 'h-icicle', 'h-radial', 'treemap', 'radial', 'bands', 'br-lc-bar', 'br-lc-line', 'br-lc-area', 'br-lc-scatter', 'br-lc-pie', 'br-lc-radar', 'br-lc-concentric-arc', 'br-lc-pack', 'br-lc-treemap', 'br-lc-icicle', 'br-lc-sunburst', 'br-lc-sankey', 'br-lc-tree', 'svelte-br-lc-sunburst', 'svelte-br-lc-icicle', 'svelte-br-lc-pack', 'svelte-br-lc-treemap', 'svelte-treemap-demo'])

function TileCard({
  tile, ds, measureKey, onRemove, onMeasureChange, onXKeyChange, onYKeyChange, onDepthChange, onSortChange, onGroupByChange, onNodeUpdate, onNodesUpdate, onNodeReorder, availableMeasures,
}: {
  tile: Tile
  ds: Dataset
  measureKey: string
  onRemove: () => void
  onMeasureChange: (key: string) => void
  onXKeyChange: (key: string) => void
  onYKeyChange: (key: string) => void
  onDepthChange: (depth: number) => void
  onSortChange: (sortBy: 'index' | 'value') => void
  onGroupByChange: (key: string | undefined) => void
  onNodeUpdate: (rowId: string, measures: PNode['measures']) => void
  onNodesUpdate: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void
  onNodeReorder: (orderedIds: string[]) => void
  availableMeasures: { key: string; label: string }[]
}) {
  const isHier = HIER_KINDS.has(tile.kind)
  const isViz = VIZ_KINDS.has(tile.kind)
  const depth = tile.depth ?? 2
  const sortBy = tile.sortBy ?? 'index'
  return (
    <div className="tile-card">
      <div className="tile-header">
        <span className="tile-title">{tile.title ?? TILE_LABELS[tile.kind]}</span>
        <div className="tile-header-actions">
          {isHier && (
            <select
              className="tile-measure-select"
              value={depth}
              onChange={e => onDepthChange(Number(e.target.value))}
              title="Levels to show"
            >
              {[1, 2, 3, 4, 5].map(n => (
                <option key={n} value={n}>{n}L</option>
              ))}
            </select>
          )}
          {isViz && (
            <select
              className="tile-measure-select"
              value={sortBy}
              onChange={e => onSortChange(e.target.value as 'index' | 'value')}
              title="Sort order"
            >
              <option value="index">Order</option>
              <option value="value">Value</option>
            </select>
          )}
          {tile.kind === 'br-lc-scatter' ? (
            <>
              <label className="tile-axis-label">X:</label>
              <select
                className="tile-measure-select"
                value={tile.xKey ?? '_index'}
                onChange={e => onXKeyChange(e.target.value)}
              >
                <option value="_index">Index</option>
                {availableMeasures.map(m => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
              <label className="tile-axis-label">Y:</label>
              <select
                className="tile-measure-select"
                value={tile.yKey ?? measureKey}
                onChange={e => onYKeyChange(e.target.value)}
              >
                {availableMeasures.map(m => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </>
          ) : availableMeasures.length > 1 && (
            <select
              className="tile-measure-select"
              value={tile.measureKey ?? measureKey}
              onChange={e => onMeasureChange(e.target.value)}
            >
              {availableMeasures.map(m => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          )}
          {ds.dimDefs.length > 0 && (
            <select
              className="tile-measure-select"
              value={tile.groupBy ?? ''}
              onChange={e => onGroupByChange(e.target.value || undefined)}
              title="Group by"
            >
              <option value="">No group</option>
              {ds.dimDefs.map(d => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
          )}
          <button className="tile-close-btn" onClick={onRemove}>×</button>
        </div>
      </div>
      <div className={`tile-body${tile.kind === 'bands' ? ' tile-body--scroll' : ''}`}>
        <TileContent tile={tile} ds={ds} measureKey={measureKey} onNodeUpdate={onNodeUpdate} onNodesUpdate={onNodesUpdate} onNodeReorder={onNodeReorder} />
      </div>
    </div>
  )
}

// ─── Add tile menu ────────────────────────────────────────────────────────────

function AddTileMenu({ onAdd }: { onAdd: (kind: TileKind) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} className="sb-menu-wrap">
      <button className="sb-btn" onClick={() => setOpen(o => !o)}>+ Tile</button>
      {open && (
        <div className="sb-menu-dropdown">
          {TILE_KINDS.map(k => (
            <button
              key={k}
              className="sb-menu-board-btn"
              onClick={() => { onAdd(k); setOpen(false) }}
            >
              {TILE_LABELS[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Dataset picker ───────────────────────────────────────────────────────────

function DatasetPicker({
  ws, onSwitch, onNew, onDelete,
}: {
  ws: Workspace
  onSwitch: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = ws.datasets.find(d => d.id === ws.activeDatasetId)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} className="sb-menu-wrap">
      <button className="sb-btn sb-menu-trigger" onClick={() => setOpen(o => !o)}>
        <span className="sb-menu-trigger-label">{current?.name ?? '—'}</span>
        <span className="sb-menu-caret">▾</span>
      </button>
      {open && (
        <div className="sb-menu-dropdown">
          <div className="sb-menu-boards">
            {ws.datasets.map(d => (
              <button
                key={d.id}
                className={`sb-menu-board-btn${d.id === ws.activeDatasetId ? ' active' : ''}`}
                onClick={() => { onSwitch(d.id); setOpen(false) }}
              >
                {d.name}
              </button>
            ))}
          </div>
          <div className="sb-menu-actions">
            <button className="sb-menu-action-btn" onClick={() => { onNew(); setOpen(false) }}>New dataset</button>
            {ws.datasets.length > 1 && (
              <button
                className="sb-menu-action-btn danger"
                onClick={() => { onDelete(ws.activeDatasetId); setOpen(false) }}
              >
                Delete dataset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Dashboard picker ─────────────────────────────────────────────────────────

function DashboardPicker({
  ws, onSwitch, onNew, onDelete,
}: {
  ws: Workspace
  onSwitch: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const dashes = dashboardsForDataset(ws, ws.activeDatasetId)
  const current = ws.dashboards.find(d => d.id === ws.activeDashboardId)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} className="sb-menu-wrap">
      <button className="sb-btn sb-menu-trigger" onClick={() => setOpen(o => !o)}>
        <span className="sb-menu-trigger-label">{current?.name ?? '—'}</span>
        <span className="sb-menu-caret">▾</span>
      </button>
      {open && (
        <div className="sb-menu-dropdown">
          <div className="sb-menu-boards">
            {dashes.map(d => (
              <button
                key={d.id}
                className={`sb-menu-board-btn${d.id === ws.activeDashboardId ? ' active' : ''}`}
                onClick={() => { onSwitch(d.id); setOpen(false) }}
              >
                {d.name}
              </button>
            ))}
          </div>
          <div className="sb-menu-actions">
            <button className="sb-menu-action-btn" onClick={() => { onNew(); setOpen(false) }}>New dashboard</button>
            {dashes.length > 1 && (
              <button
                className="sb-menu-action-btn danger"
                onClick={() => { onDelete(ws.activeDashboardId); setOpen(false) }}
              >
                Delete dashboard
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main app ─────────────────────────────────────────────────────────────────

export function App() {
  const [ws, setWs] = useState<Workspace>(() => initWorkspace())

  function commit(next: Workspace) {
    setWs(next)
    saveWorkspace(next)
  }

  const ds = activeDataset(ws)
  const dash = activeDashboard(ws)
  const measures = ds ? ds.measureDefs : []

  const switchDataset = useCallback((id: string) => {
    const next = { ...ws, activeDatasetId: id }
    const dashes = dashboardsForDataset(next, id)
    const activeDash = dashes[0]?.id ?? ''
    const updated = { ...next, activeDashboardId: activeDash }
    commit(updated)
    const newDs = updated.datasets.find(d => d.id === id)
    if (newDs) resetHudForDataset(newDs.rows)
  }, [ws])

  const newDataset = useCallback(() => {
    const name = prompt('Dataset name:')
    if (!name) return
    let next = createDataset(ws, name)
    next = { ...next, activeDatasetId: next.datasets[next.datasets.length - 1]!.id }
    next = createDashboard(next, 'Overview', next.activeDatasetId)
    next = { ...next, activeDashboardId: next.dashboards[next.dashboards.length - 1]!.id }
    commit(next)
  }, [ws])

  const deleteDs = useCallback((id: string) => {
    if (!confirm('Delete this dataset and all its dashboards?')) return
    commit(deleteDataset(ws, id))
  }, [ws])

  const switchDashboard = useCallback((id: string) => {
    commit({ ...ws, activeDashboardId: id })
  }, [ws])

  const newDashboard = useCallback(() => {
    const name = prompt('Dashboard name:')
    if (!name) return
    let next = createDashboard(ws, name, ws.activeDatasetId)
    next = { ...next, activeDashboardId: next.dashboards[next.dashboards.length - 1]!.id }
    commit(next)
  }, [ws])

  const deleteDash = useCallback((id: string) => {
    if (!confirm('Delete this dashboard?')) return
    commit(deleteDashboard(ws, id))
  }, [ws])

  const handleAddTile = useCallback((kind: TileKind) => {
    if (!dash) return
    commit(addTile(ws, dash.id, kind))
  }, [ws, dash])

  const handleRemoveTile = useCallback((tileId: string) => {
    if (!dash) return
    commit(removeTile(ws, dash.id, tileId))
  }, [ws, dash])

  const handleLayoutChange = useCallback((layout: readonly LayoutItem[]) => {
    if (!dash) return
    const next: Dashboard = { ...dash, layout: layout as LayoutItem[] }
    commit(updateDashboard(ws, next))
  }, [ws, dash])

  const handleTileMeasure = useCallback((tileId: string, key: string) => {
    if (!dash) return
    const next: Dashboard = {
      ...dash,
      tiles: dash.tiles.map(t => t.id === tileId ? { ...t, measureKey: key } : t),
    }
    commit(updateDashboard(ws, next))
  }, [ws, dash])

  const handleTileXKey = useCallback((tileId: string, key: string) => {
    if (!dash) return
    commit(updateDashboard(ws, { ...dash, tiles: dash.tiles.map(t => t.id === tileId ? { ...t, xKey: key } : t) }))
  }, [ws, dash])

  const handleTileYKey = useCallback((tileId: string, key: string) => {
    if (!dash) return
    commit(updateDashboard(ws, { ...dash, tiles: dash.tiles.map(t => t.id === tileId ? { ...t, yKey: key } : t) }))
  }, [ws, dash])

  const handleNodeUpdate = useCallback((rowId: string, measures: PNode['measures']) => {
    if (!ds) return
    commit(updateRow(ws, ds.id, rowId, { measures }))
  }, [ws, ds])

  // Batch variant: a single gesture tick may change several leaves at once
  // (parent resize redistributes across siblings). Commit them together so they
  // don't clobber each other through the stale-workspace closure.
  const handleNodesUpdate = useCallback((updates: Array<{ id: string; measures: PNode['measures'] }>) => {
    if (!ds) return
    commit(updateRows(ws, ds.id, updates.map(u => ({ id: u.id, patch: { measures: u.measures } }))))
  }, [ws, ds])

  const handleNodeReorder = useCallback((orderedIds: string[]) => {
    if (!ds) return
    commit(reorderLeaves(ws, ds.id, orderedIds))
  }, [ws, ds])

  const handleTileDepth = useCallback((tileId: string, depth: number) => {
    if (!dash) return
    const next: Dashboard = {
      ...dash,
      tiles: dash.tiles.map(t => t.id === tileId ? { ...t, depth } : t),
    }
    commit(updateDashboard(ws, next))
  }, [ws, dash])

  const handleTileSort = useCallback((tileId: string, sortBy: 'index' | 'value') => {
    if (!dash) return
    commit(updateDashboard(ws, { ...dash, tiles: dash.tiles.map(t => t.id === tileId ? { ...t, sortBy } : t) }))
  }, [ws, dash])

  const handleTileGroupBy = useCallback((tileId: string, groupBy: string | undefined) => {
    if (!dash) return
    commit(updateDashboard(ws, { ...dash, tiles: dash.tiles.map(t => t.id === tileId ? { ...t, groupBy } : t) }))
  }, [ws, dash])

  return (
    <div className="sb-root">
      <div className="sb-topbar">
        <span className="sb-wordmark">sliceboard</span>
        <span className="sb-topbar-sep">·</span>
        <DatasetPicker
          ws={ws}
          onSwitch={switchDataset}
          onNew={newDataset}
          onDelete={deleteDs}
        />
        <span className="sb-topbar-sep">/</span>
        <DashboardPicker
          ws={ws}
          onSwitch={switchDashboard}
          onNew={newDashboard}
          onDelete={deleteDash}
        />
        <div className="sb-topbar-right">
          <AddTileMenu onAdd={handleAddTile} />
        </div>
      </div>

      <div className="sb-grid-wrap">
        {ds && dash ? (
          <TileGrid
            dash={dash}
            ds={ds}
            measures={measures}
            onLayoutChange={handleLayoutChange}
            onRemoveTile={handleRemoveTile}
            onTileMeasure={handleTileMeasure}
            onTileXKey={handleTileXKey}
            onTileYKey={handleTileYKey}
            onTileDepth={handleTileDepth}
            onTileSort={handleTileSort}
            onTileGroupBy={handleTileGroupBy}
            onNodeUpdate={handleNodeUpdate}
            onNodesUpdate={handleNodesUpdate}
            onNodeReorder={handleNodeReorder}
          />
        ) : null}
      </div>
    </div>
  )
}

function TileGrid({ dash, ds, measures, onLayoutChange, onRemoveTile, onTileMeasure, onTileXKey, onTileYKey, onTileDepth, onTileSort, onTileGroupBy, onNodeUpdate, onNodesUpdate, onNodeReorder }: {
  dash: Dashboard
  ds: Dataset
  measures: { key: string; label: string }[]
  onLayoutChange: (layout: readonly LayoutItem[]) => void
  onRemoveTile: (id: string) => void
  onTileMeasure: (tileId: string, key: string) => void
  onTileXKey: (tileId: string, key: string) => void
  onTileYKey: (tileId: string, key: string) => void
  onTileDepth: (tileId: string, depth: number) => void
  onTileSort: (tileId: string, sortBy: 'index' | 'value') => void
  onTileGroupBy: (tileId: string, key: string | undefined) => void
  onNodeUpdate: (rowId: string, measures: PNode['measures']) => void
  onNodesUpdate: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void
  onNodeReorder: (orderedIds: string[]) => void
}) {
  const { width, containerRef, mounted } = useContainerWidth()
  return (
    <div ref={containerRef as unknown as React.RefCallback<HTMLDivElement>} className="sb-grid-inner">
      {mounted && (
        <GridLayout
          width={width}
          layout={dash.layout}
          gridConfig={{ cols: 12, rowHeight: 60, margin: [12, 12] }}
          dragConfig={{ handle: '.tile-header' }}
          autoSize
          onLayoutChange={onLayoutChange}
        >
          {dash.tiles.map(tile => (
            <div key={tile.id} className="tile-wrap">
              <TileCard
                tile={tile}
                ds={ds}
                measureKey={dash.measureKey}
                availableMeasures={measures}
                onRemove={() => onRemoveTile(tile.id)}
                onMeasureChange={key => onTileMeasure(tile.id, key)}
                onXKeyChange={key => onTileXKey(tile.id, key)}
                onYKeyChange={key => onTileYKey(tile.id, key)}
                onDepthChange={d => onTileDepth(tile.id, d)}
                onSortChange={s => onTileSort(tile.id, s)}
                onGroupByChange={k => onTileGroupBy(tile.id, k)}
                onNodeUpdate={onNodeUpdate}
                onNodesUpdate={onNodesUpdate}
                onNodeReorder={onNodeReorder}
              />
            </div>
          ))}
        </GridLayout>
      )}
      {dash.tiles.length === 0 && (
        <div className="sb-grid-empty">No tiles — click "+ Tile" to add one</div>
      )}
    </div>
  )
}
