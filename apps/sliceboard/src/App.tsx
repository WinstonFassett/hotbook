import { useState, useCallback, useEffect, useRef } from 'react'
import { GridLayout, useContainerWidth } from 'react-grid-layout'
import type { LayoutItem } from 'react-grid-layout'
import { Viz, HTreetable } from '@winstonfassett/vizform-react-d3'
import { colorFor } from '@winstonfassett/vizform-core'
import type { Goal } from '@winstonfassett/vizform-react-d3'
import { leavesOf } from '@winstonfassett/vizform-vanilla-d3'
import { Treemap } from './viz/Treemap'
import { Icicle } from './viz/Icicle'
import { Sunburst } from './viz/Sunburst'
import {
  BrLcBar, BrLcLine, BrLcArea, BrLcScatter, BrLcPie, BrLcRadar, BrLcConcentricArc,
  BrLcGauge, BrLcGaugeSegmented,
  BrLcPack, BrLcTreemap, BrLcIcicle, BrLcSunburst, BrLcSankey, BrLcSankeyFlow, BrLcTree,
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
  drillPath,
} from './persistence'
import type { Workspace, Dataset, Dashboard, Tile, TileKind, PNode } from './persistence'
import { schemaFor } from './tile-config-schemas'
import { hudStore, resetHudForDataset, useHudStore, useDrillNodeId } from './store'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './App.css'

// Pre-color nodes by root-ancestor identity so gen-0 Viz components (which don't
// walk ancestors internally) get the right hue. colorFor is sort-stable: same
// root name → same color regardless of position.
function colorByGroup(nodes: PNode[]): PNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  // Walk up to the nearest ancestor that has an explicit color (not the synthetic
  // groupBy virtual root, which has no color and would collapse all children to one hue).
  const nearestColor = (n: PNode): string => {
    let cur = n
    while (true) {
      if (cur.color) return cur.color
      if (!cur.parentId || !byId.has(cur.parentId)) return colorFor(cur.name)
      cur = byId.get(cur.parentId)!
    }
  }
  return nodes.map(n => ({ ...n, color: n.color ?? nearestColor(n) }))
}

// Canon picker — retired gen-0/Svelte kinds excluded
const TILE_KINDS: TileKind[] = [
  'treetable',
  'br-lc-bar', 'br-lc-line', 'br-lc-area', 'br-lc-scatter', 'br-lc-pie',
  'br-lc-radar', 'br-lc-concentric-arc', 'br-lc-gauge', 'br-lc-gauge-segmented',
  'br-lc-pack', 'br-lc-treemap', 'br-lc-icicle', 'br-lc-sunburst', 'br-lc-sankey', 'br-lc-sankey-flow', 'br-lc-tree',
]
const TILE_LABELS: Record<TileKind, string> = {
  'treetable':            'Table',
  'br-lc-bar':            'Bar',
  'br-lc-bands':          'Bands',
  'br-lc-line':           'Line',
  'br-lc-area':           'Area',
  'br-lc-scatter':        'Scatter',
  'br-lc-pie':            'Pie',
  'br-lc-radar':          'Radar',
  'br-lc-concentric-arc': 'Concentric Arc',
  'br-lc-gauge':          'Gauge',
  'br-lc-gauge-segmented':'Gauge (segmented)',
  'br-lc-pack':           'Pack',
  'br-lc-treemap':        'Treemap',
  'br-lc-icicle':         'Icicle',
  'br-lc-sunburst':       'Sunburst',
  'br-lc-sankey':         'Sankey',
  'br-lc-sankey-flow':    'Sankey Flow',
  'br-lc-tree':           'Tree',
  // retired — still rendered if encountered in stored dashboards
  'h-treemap':            'H-Treemap (retired)',
  'h-icicle':             'Icicle (retired)',
  'h-radial':             'Sunburst (retired)',
  'treemap':              'Treemap (retired)',
  'radial':               'Radial (retired)',
  'bands':                'Bands (retired)',
  'svelte-br-lc-sunburst':'Sunburst (Svelte, retired)',
  'svelte-br-lc-icicle':  'Icicle (Svelte, retired)',
  'svelte-br-lc-pack':    'Pack (Svelte, retired)',
  'svelte-br-lc-treemap': 'Treemap (Svelte, retired)',
  'svelte-treemap-demo':  'Treemap demo (Svelte, retired)',
}

// ─── Tile content ─────────────────────────────────────────────────────────────

function TileContent({ tile, ds, measureKey, onNodeUpdate, onNodesUpdate, onNodeReorder }: { tile: Tile; ds: Dataset; measureKey: string; onNodeUpdate: (rowId: string, measures: PNode['measures']) => void; onNodesUpdate: (updates: Array<{ id: string; measures: PNode['measures'] }>) => void; onNodeReorder: (orderedIds: string[]) => void }) {
  const mk = tile.measureKey ?? measureKey
  const hud = useHudStore()
  const { hoverId, selectionId, focusId } = hud
  const onHover = (id: string | null) => hudStore.setHover(id)
  const onSelect = (id: string) => hudStore.setSelection(id)
  const onFocus = (id: string) => hudStore.setFocus(id)

  const depth = tile.depth || undefined // 0/undefined = all levels (chart shows full tree)
  const sortBy = tile.sortBy ?? 'index'
  const schema = schemaFor(tile.kind)
  const drillKey = tile.id
  // drill-v2 (internal zoom): br-lc hier charts receive the FULL tree and zoom
  // internally via their own drillNodeId (wired in BrLcCharts.tsx). Pruning to a
  // subtree here would change hierShapeKey and remount the element on drill —
  // resetting the viewport and snapping instead of tweening. Legacy D3 hier
  // charts are retired, so nothing else depends on the old prune path.
  const sourceRows = ds.rows
  const rawNodes = colorByGroup(tile.groupBy ? applyGroupBy(sourceRows, tile.groupBy) : sourceRows)
  const nodes = sortBy === 'value'
    ? [...rawNodes]
        .sort((a, b) => (b.measures[mk] ?? 0) - (a.measures[mk] ?? 0))
        .map((n, i) => ({ ...n, index: i }))
    : rawNodes
  // Line/area/scatter use array position for x-axis — sorting is the reorder,
  // but index remapping scrambles their x-axis. Sort without remapping.
  const sortedNodes = sortBy === 'value'
    ? [...rawNodes].sort((a, b) => (b.measures[mk] ?? 0) - (a.measures[mk] ?? 0))
    : rawNodes

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
    return <HTreetable nodes={nodes} measureKey={mk} onUpdate={onNodeUpdate} />
  }

  // ── BR-LC flat charts ────────────────────────────────────────────────────
  // All BR-LC flat charts get the same value-ordered nodes (natural order when
  // sortBy='index'). The chart draws the order it's handed; it owns no sort.
  if (tile.kind === 'br-lc-bar')            return <BrLcBar nodes={sortedNodes} measureKey={mk} maxItems={tile.maxItems} orientation={tile.orientation} colorMode={tile.colorMode} labelMode={tile.labelMode} valueMode={tile.valueMode} minBandSize={tile.minBandSize} onUpdate={onNodeUpdate} />
  if (tile.kind === 'br-lc-bands')          return <BrLcBar nodes={sortedNodes} measureKey={mk} maxItems={tile.maxItems} orientation="horizontal" colorMode="palette" labelMode="inside" valueMode="inside" onUpdate={onNodeUpdate} />
  if (tile.kind === 'br-lc-line')           return <BrLcLine nodes={sortedNodes} measureKey={mk} onUpdate={onNodeUpdate} />
  if (tile.kind === 'br-lc-area')           return <BrLcArea nodes={sortedNodes} measureKey={mk} onUpdate={onNodeUpdate} />
  if (tile.kind === 'br-lc-scatter')        return <BrLcScatter nodes={sortedNodes} xKey={tile.xKey ?? '_index'} yKey={tile.yKey ?? mk} onUpdate={onNodeUpdate} />
  if (tile.kind === 'br-lc-pie')            return <BrLcPie nodes={sortedNodes} measureKey={mk} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />
  if (tile.kind === 'br-lc-radar')          return <BrLcRadar nodes={sortedNodes} measureKey={mk} onUpdate={onNodeUpdate} />
  if (tile.kind === 'br-lc-concentric-arc') return <BrLcConcentricArc nodes={sortedNodes} measureKey={mk} onUpdate={onNodeUpdate} />
  if (tile.kind === 'br-lc-gauge')          return <BrLcGauge nodes={sortedNodes} measureKey={mk} label={tile.title ?? mk} />
  if (tile.kind === 'br-lc-gauge-segmented')return <BrLcGaugeSegmented nodes={sortedNodes} measureKey={mk} label={tile.title ?? mk} />

  // ── BR-LC hierarchical charts ────────────────────────────────────────────
  if (tile.kind === 'br-lc-pack')           return <BrLcPack nodes={nodes} measureKey={mk} depth={depth} sortBy={sortBy} drillKey={drillKey} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />
  if (tile.kind === 'br-lc-treemap')        return <BrLcTreemap nodes={nodes} measureKey={mk} depth={depth} sortBy={sortBy} drillKey={drillKey} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />
  if (tile.kind === 'br-lc-icicle')         return <BrLcIcicle nodes={nodes} measureKey={mk} depth={depth} sortBy={sortBy} drillKey={drillKey} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />
  if (tile.kind === 'br-lc-sunburst')       return <BrLcSunburst nodes={nodes} measureKey={mk} depth={depth} sortBy={sortBy} drillKey={drillKey} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />
  if (tile.kind === 'br-lc-sankey')         return <BrLcSankey edges={ds.edges ?? []} />
  if (tile.kind === 'br-lc-sankey-flow')    return <BrLcSankeyFlow />
  if (tile.kind === 'br-lc-tree')           return <BrLcTree nodes={nodes} measureKey={mk} sortBy={sortBy} onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />

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
      id: n.id, name: n.name, color: n.color ?? colorFor(n.name),
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
        hoverId={hoverId} selectionId={selectionId}
        onHover={onHover} onSelect={onSelect}
        onUpdate={(id, patch) => { if (patch.measurements) onNodeUpdate(id, patch.measurements as PNode['measures']) }}
        onReorder={onNodeReorder}
      />
    </div>
  )
}

// ─── Tile wrapper ─────────────────────────────────────────────────────────────

// Kinds where depth selector is wired
const HIER_KINDS = new Set<TileKind>(['h-treemap', 'h-icicle', 'h-radial', 'br-lc-pack', 'br-lc-treemap', 'br-lc-icicle', 'br-lc-sunburst'])
// Kinds where Order/Value sort selector is shown
const VIZ_KINDS = new Set<TileKind>(['h-treemap', 'h-icicle', 'h-radial', 'treemap', 'radial', 'bands', 'br-lc-bar', 'br-lc-bands', 'br-lc-line', 'br-lc-area', 'br-lc-scatter', 'br-lc-pie', 'br-lc-radar', 'br-lc-concentric-arc', 'br-lc-gauge', 'br-lc-gauge-segmented', 'br-lc-pack', 'br-lc-treemap', 'br-lc-icicle', 'br-lc-sunburst', 'br-lc-sankey', 'br-lc-tree'])
// Kinds that accept groupBy to add hierarchy to flat data
const GROUPBY_KINDS = new Set<TileKind>(['br-lc-bar', 'br-lc-line', 'br-lc-area', 'br-lc-pie', 'br-lc-radar', 'br-lc-concentric-arc', 'br-lc-pack', 'br-lc-treemap', 'br-lc-icicle', 'br-lc-sunburst', 'br-lc-sankey', 'br-lc-tree'])
// Kinds whose diagram can honestly exceed the tile (it announces its own bounds);
// the tile body scrolls the overflow instead of clipping it. The data-driven
// sankey grows tall with many links — scroll lets you reach all of it.
const SCROLL_KINDS = new Set<TileKind>(['bands', 'br-lc-sankey'])

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
  const schema = schemaFor(tile.kind)
  const pickers = schema.pickers
  const showGroupBy = pickers.groupBy && ds.dimDefs.length > 0
  const depth = tile.depth ?? 0 // 0 = "All" (show full tree)
  const sortBy = tile.sortBy ?? 'index'
  return (
    <div className="tile-card">
      <div className="tile-header">
        <span className="tile-title">{tile.title ?? TILE_LABELS[tile.kind]}</span>
        <div className="tile-header-actions">
          {pickers.depth && (
            <select
              className="tile-measure-select"
              value={depth}
              onChange={e => onDepthChange(Number(e.target.value))}
              title="Levels to show"
            >
              <option value={0}>All</option>
              {[1, 2, 3, 4, 5].map(n => (
                <option key={n} value={n}>{n}L</option>
              ))}
            </select>
          )}
          {pickers.sort && (
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
          {pickers.xKey && pickers.yKey ? (
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
          ) : pickers.measure && availableMeasures.length > 1 && (
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
          {showGroupBy && (
            <select
              className="tile-measure-select"
              key={`${tile.id}-${tile.groupBy ?? ''}`}
              defaultValue={tile.groupBy ?? ''}
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
      <div
        className={`tile-body${schema.scrollBody ? ' tile-body--scroll' : ''}${schema.drillKey ? ' tile-body--drill' : ''}`}
      >
        {schema.drillKey && <DrillBreadcrumb ds={ds} drillKey={tile.id} />}
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

// ─── Drill breadcrumb ─────────────────────────────────────────────────────────

/**
 * Renders the current drill path as clickable crumbs ahead of the dashboard:
 *   Root › Goal › Project   [↑ up]
 * Clicking any crumb (incl. "Root") drills directly to that level. The "↑ up"
 * button drills out one level. Hidden entirely when no drill is active.
 *
 * Cross-tile sync is implicit: this component talks to the same hudStore every
 * hierarchical tile reads from, so the whole dashboard updates atomically.
 */
function DrillBreadcrumb({ ds, drillKey = 'default' }: { ds: Dataset; drillKey?: string }) {
  const drillNodeId = useDrillNodeId(drillKey)
  const path = drillNodeId ? drillPath(ds.rows, drillNodeId) : []
  const stale = drillNodeId != null && path.length === 0
  useEffect(() => {
    if (stale) hudStore.setDrill(drillKey, null)
  }, [stale, drillKey])
  if (!drillNodeId || path.length === 0) return null
  const parent = path.length >= 2 ? path[path.length - 2]! : null
  return (
    <div className="sb-drill-bar" role="navigation" aria-label="Drill path">
      <button
        type="button"
        className="sb-drill-crumb"
        onClick={() => hudStore.setDrill(drillKey, null)}
      >
        Root
      </button>
      {path.map((n, i) => {
        const isCurrent = i === path.length - 1
        return (
          <span key={n.id} className="sb-drill-seg">
            <span className="sb-drill-sep">›</span>
            <button
              type="button"
              className={`sb-drill-crumb${isCurrent ? ' sb-drill-crumb--current' : ''}`}
              onClick={() => hudStore.setDrill(drillKey, isCurrent ? null : n.id)}
              aria-current={isCurrent ? 'location' : undefined}
              title={isCurrent ? 'Click to drill out fully' : `Drill to ${n.name}`}
            >
              {n.name}
            </button>
          </span>
        )
      })}
      <button
        type="button"
        className="sb-btn sb-drill-up"
        onClick={() => hudStore.setDrill(drillKey, parent ? parent.id : null)}
        title="Drill out one level (Esc)"
      >
        ↑ Up
      </button>
    </div>
  )
}

// ─── Main app ─────────────────────────────────────────────────────────────────

export function App() {
  const [ws, setWs] = useState<Workspace>(() => initWorkspace())

  // Unified idle Esc contract (bubble phase — a chart's own capture-phase Esc
  // for drag-revert runs first and stops propagation). Priority order:
  //   1. Drag active → chart cancels (handled in capture phase, never reaches here)
  //   2. Focused chart is drilled → drill out that chart only (no cascade)
  //   3. Selection active → clear selection
  //   4. Else → fall through (browser default)
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = hudStore.getSnapshot()
      // Only drill out the FOCUSED chart — not the first one found.
      // Charts have tabIndex=0 and a drillKey property; document.activeElement
      // is the chart the user is interacting with.
      const ae = document.activeElement as any
      const focusedDrillKey = ae?.drillKey
      if (focusedDrillKey && s.drills[focusedDrillKey] != null) {
        const drillNodeId = s.drills[focusedDrillKey]!
        const dsNow = activeDataset(ws)
        if (!dsNow) return
        const path = drillPath(dsNow.rows, drillNodeId)
        const parent = path.length >= 2 ? path[path.length - 2]! : null
        e.preventDefault()
        hudStore.setDrill(focusedDrillKey, parent ? parent.id : null)
        return
      }
      if (s.selectionId != null) {
        e.preventDefault()
        hudStore.setSelection(null)
        return
      }
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [ws])

  function commit(next: Workspace) {
    setWs(next)
    saveWorkspace(next)
  }

  const dash = activeDashboard(ws)
  const ds = dash ? ws.datasets.find(d => d.id === dash.datasetId) : activeDataset(ws)
  const measures = ds ? ds.measureDefs : []

  // Drill is two-sourced: hudStore for live cross-tile reactivity, Dashboard
  // for persistence. Migrate legacy drillNodeId to drills['default'] on load.
  const liveDrills = useHudStore().drills
  const persistedDrills = dash?.drills ?? (dash?.drillNodeId != null ? { default: dash.drillNodeId } : {})
  useEffect(() => {
    const current = hudStore.getSnapshot().drills
    if (JSON.stringify(current) !== JSON.stringify(persistedDrills)) {
      hudStore.hydrateDrills(persistedDrills)
    }
  }, [dash?.id, persistedDrills])
  useEffect(() => {
    if (!dash) return
    if (JSON.stringify(dash.drills ?? {}) === JSON.stringify(liveDrills)) return
    commit(updateDashboard(ws, { ...dash, drills: liveDrills, drillNodeId: undefined }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveDrills])

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
