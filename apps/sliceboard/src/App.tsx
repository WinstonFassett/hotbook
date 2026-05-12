import { useState, useCallback, useEffect, useRef } from 'react'
import { GridLayout, useContainerWidth } from 'react-grid-layout'
import type { LayoutItem } from 'react-grid-layout'
import { Viz, HTreetable, pickColor } from '@winstonfassett/vizform-react'
import type { Goal } from '@winstonfassett/vizform-react'
import { leavesOf } from '@winstonfassett/vizform-core'
import { Treemap } from './viz/Treemap'
import { Icicle } from './viz/Icicle'
import { Sunburst } from './viz/Sunburst'
import {
  initWorkspace, saveWorkspace,
  createDataset, createDashboard, updateDataset, updateDashboard,
  addTile, removeTile, deleteDashboard, deleteDataset,
  activeDataset, activeDashboard, dashboardsForDataset, measurementsFromColumns,
  updateNode,
} from './persistence'
import type { Workspace, Dataset, Dashboard, Tile, TileKind, PNode } from './persistence'
import { hudStore, resetHudForDataset, useHudStore } from './store'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './App.css'

const TILE_KINDS: TileKind[] = ['treetable', 'h-treemap', 'h-icicle', 'h-radial', 'treemap', 'radial', 'bands']
const TILE_LABELS: Record<TileKind, string> = {
  'treetable': 'Table',
  'h-treemap': 'H-Treemap',
  'h-icicle': 'Icicle',
  'h-radial': 'Sunburst',
  'treemap': 'Treemap',
  'radial': 'Radial',
  'bands': 'Bands',
}

// ─── Tile content ─────────────────────────────────────────────────────────────

function TileContent({ tile, ds, measureKey, onNodeUpdate }: { tile: Tile; ds: Dataset; measureKey: string; onNodeUpdate: (nodeId: string, measurements: PNode['measurements']) => void }) {
  const mk = tile.measureKey ?? measureKey
  const hud = useHudStore()
  const { hoverId, selectionId, focusId } = hud
  const onHover = (id: string | null) => hudStore.setHover(id)
  const onSelect = (id: string) => hudStore.setSelection(id)
  const onFocus = (id: string) => hudStore.setFocus(id)

  const depth = tile.depth ?? 2
  if (tile.kind === 'h-treemap') {
    return <Treemap nodes={ds.nodes} measureKey={mk} depth={depth} hoverId={hoverId} selectionId={selectionId} focusId={focusId} onHover={onHover} onSelect={onSelect} onFocus={onFocus} onUpdate={onNodeUpdate} />
  }
  if (tile.kind === 'h-icicle') {
    return <Icicle nodes={ds.nodes} measureKey={mk} depth={depth} hoverId={hoverId} selectionId={selectionId} focusId={focusId} onHover={onHover} onSelect={onSelect} onFocus={onFocus} onUpdate={onNodeUpdate} />
  }
  if (tile.kind === 'h-radial') {
    return <Sunburst nodes={ds.nodes} measureKey={mk} depth={depth} hoverId={hoverId} selectionId={selectionId} focusId={focusId} onHover={onHover} onSelect={onSelect} onFocus={onFocus} onUpdate={onNodeUpdate} />
  }
  if (tile.kind === 'treetable') {
    return <HTreetable nodes={ds.nodes} measureKey={mk} />
  }

  const goals: Goal[] = leavesOf(ds.nodes).map((n, idx) => ({
    id: n.id, name: n.name, color: n.color ?? pickColor(idx),
    measurements: { ...n.measurements, _index: idx },
    archived: false, tags: n.tags, urgent: false, important: false,
    createdAt: n.createdAt, updatedAt: n.updatedAt,
  }))
  // Bands rows are fixed height — give the container a natural minimum so the tile body can scroll
  const bandsMinH = tile.kind === 'bands' ? 28 + goals.filter(g => !g.archived).length * 46 : undefined
  return (
    <div style={{ width: '100%', height: bandsMinH ?? '100%', minHeight: bandsMinH }}>
      <Viz
        goals={goals} mode={tile.kind as 'treemap' | 'radial' | 'bands'}
        activeUnit={mk} unitKind="size" sortUnit={mk} sortUnitKind="size"
        frame={undefined} onUpdate={() => {}}
      />
    </div>
  )
}

// ─── Tile wrapper ─────────────────────────────────────────────────────────────

const HIER_KINDS = new Set<TileKind>(['h-treemap', 'h-icicle', 'h-radial'])

function TileCard({
  tile, ds, measureKey, onRemove, onMeasureChange, onDepthChange, onNodeUpdate, availableMeasures,
}: {
  tile: Tile
  ds: Dataset
  measureKey: string
  onRemove: () => void
  onMeasureChange: (key: string) => void
  onDepthChange: (depth: number) => void
  onNodeUpdate: (nodeId: string, measurements: PNode['measurements']) => void
  availableMeasures: { key: string; label: string }[]
}) {
  const isHier = HIER_KINDS.has(tile.kind)
  const depth = tile.depth ?? 2
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
          {availableMeasures.length > 1 && (
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
          <button className="tile-close-btn" onClick={onRemove}>×</button>
        </div>
      </div>
      <div className={`tile-body${tile.kind === 'bands' ? ' tile-body--scroll' : ''}`}>
        <TileContent tile={tile} ds={ds} measureKey={measureKey} onNodeUpdate={onNodeUpdate} />
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
  const measures = ds ? measurementsFromColumns(ds.columns) : []

  const switchDataset = useCallback((id: string) => {
    const next = { ...ws, activeDatasetId: id }
    const dashes = dashboardsForDataset(next, id)
    const activeDash = dashes[0]?.id ?? ''
    const updated = { ...next, activeDashboardId: activeDash }
    commit(updated)
    const newDs = updated.datasets.find(d => d.id === id)
    if (newDs) resetHudForDataset(newDs.nodes)
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

  const handleNodeUpdate = useCallback((nodeId: string, measurements: PNode['measurements']) => {
    if (!ds) return
    commit(updateNode(ws, ds.id, nodeId, { measurements }))
  }, [ws, ds])

  const handleTileDepth = useCallback((tileId: string, depth: number) => {
    if (!dash) return
    const next: Dashboard = {
      ...dash,
      tiles: dash.tiles.map(t => t.id === tileId ? { ...t, depth } : t),
    }
    commit(updateDashboard(ws, next))
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
            onTileDepth={handleTileDepth}
            onNodeUpdate={handleNodeUpdate}
          />
        ) : null}
      </div>
    </div>
  )
}

function TileGrid({ dash, ds, measures, onLayoutChange, onRemoveTile, onTileMeasure, onTileDepth, onNodeUpdate }: {
  dash: Dashboard
  ds: Dataset
  measures: { key: string; label: string }[]
  onLayoutChange: (layout: readonly LayoutItem[]) => void
  onRemoveTile: (id: string) => void
  onTileMeasure: (tileId: string, key: string) => void
  onTileDepth: (tileId: string, depth: number) => void
  onNodeUpdate: (nodeId: string, measurements: PNode['measurements']) => void
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
                onDepthChange={d => onTileDepth(tile.id, d)}
                onNodeUpdate={onNodeUpdate}
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
