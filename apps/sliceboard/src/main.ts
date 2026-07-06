/**
 * main.ts — vanilla TS entry point. No React.
 *
 * Creates a <sb-dock-view> custom element, wires workspace persistence,
 * and syncs the hudStore drill state with dashboard persistence.
 */

import './index.css'
import {
  initWorkspace, saveWorkspace,
  createDataset, createDashboard, updateDashboard,
  addTile, removeTile, deleteDashboard, deleteDataset,
  activeDataset, activeDashboard, dashboardsForDataset,
  updateRow, updateRows, reorderLeaves,
  drillPath,
} from './persistence'
import type { Workspace, Dataset, Dashboard, Tile, TileKind } from './persistence'
import { hudStore, resetHudForDataset } from './store'
import type { TileRecord } from './DockView'
import './DockView'
import { defaultDockTree, reconcile, addTileToDock, type DockNode } from './dock'
import { readLayoutFromURL, parseLayout, serializeLayout, writeLayoutToURL } from './url-layout'

// ─── Tile metadata ─────────────────────────────────────────────────────────────

const TILE_KINDS: TileKind[] = [
  'treetable',
  'br-lc-bar', 'br-lc-line', 'br-lc-area', 'br-lc-scatter', 'br-lc-pie',
  'br-lc-radar', 'br-lc-concentric-arc', 'br-lc-gauge', 'br-lc-gauge-segmented',
  'br-lc-pack', 'br-lc-treemap', 'br-lc-treetable', 'br-lc-icicle', 'br-lc-sunburst', 'br-lc-sankey', 'br-lc-sankey-flow', 'br-lc-tree', 'br-lc-gantt',
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
  'br-lc-treetable':      'Treetable',
  'br-lc-icicle':         'Icicle',
  'br-lc-sunburst':       'Sunburst',
  'br-lc-sankey':         'Sankey',
  'br-lc-sankey-flow':    'Sankey Flow',
  'br-lc-tree':           'Tree',
  'br-lc-gantt':          'Gantt',
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

function tileLabel(tile: Tile): string {
  return tile.title ?? TILE_LABELS[tile.kind] ?? tile.kind
}

// ─── App state ────────────────────────────────────────────────────────────────

// Check for reset URL param
if (new URLSearchParams(window.location.search).get('reset') === '1') {
  localStorage.clear()
  console.log('[main] Workspace reset via ?reset=1')
  // Remove the param from the URL to avoid repeated resets
  const url = new URL(window.location.href)
  url.searchParams.delete('reset')
  window.history.replaceState({}, '', url.toString())
}

let ws: Workspace = initWorkspace()
const dockView = document.createElement('sb-dock-view') as DockView

let drillPersistDebounce: ReturnType<typeof setTimeout> | null = null
let lastHydratedDashId = ''

function commit(next: Workspace) {
  ws = next
  saveWorkspace(next)
  render()
}

// ─── Drill sync ────────────────────────────────────────────────────────────────

// Store → Dashboard: debounced 16ms to batch rapid drill changes
hudStore.subscribe(() => {
  if (drillPersistDebounce) clearTimeout(drillPersistDebounce)
  drillPersistDebounce = setTimeout(() => {
    const dash = activeDashboard(ws)
    if (!dash) return
    const liveDrills = hudStore.getSnapshot().drills
    if (JSON.stringify(dash.drills ?? {}) !== JSON.stringify(liveDrills)) {
      ws = updateDashboard(ws, { ...dash, drills: liveDrills })
      saveWorkspace(ws)
    }
  }, 16)
})

// ─── TileRecord builders ──────────────────────────────────────────────────────

function buildTileRecords(dash: Dashboard, ds: Dataset): TileRecord[] {
  // Helper: update one tile's properties in the CURRENT dashboard (read from
  // ws at call time, not the captured dash). The captured dash goes stale when
  // a drill debounce writes drills to ws after buildTileRecords ran — using the
  // stale dash in `{ ...dash, tiles: ... }` would overwrite those drills.
  const updateTile = (tileId: string, patch: Partial<Tile>) => {
    const curDash = ws.dashboards.find(d => d.id === dash.id)
    if (!curDash) return ws
    return updateDashboard(ws, { ...curDash, tiles: curDash.tiles.map(t => t.id === tileId ? { ...t, ...patch } : t) })
  }

  return dash.tiles.map(tile => ({
    tile,
    ds,
    measureKey: dash.measureKey,
    label: tileLabel(tile),
    onUpdate: (rowId: string, measures: any) => {
      commit(updateRow(ws, ds.id, rowId, { measures }))
    },
    onUpdateMany: (updates: Array<{ id: string; measures: any }>) => {
      commit(updateRows(ws, ds.id, updates.map(u => ({ id: u.id, patch: { measures: u.measures } }))))
    },
    onNodeReorder: (orderedIds: string[]) => {
      commit(reorderLeaves(ws, ds.id, orderedIds))
    },
    onRemove: () => {
      commit(removeTile(ws, dash.id, tile.id))
    },
    onMeasureChange: (key: string) => {
      commit(updateTile(tile.id, { measureKey: key }))
    },
    onXKeyChange: (key: string) => {
      commit(updateTile(tile.id, { xKey: key }))
    },
    onYKeyChange: (key: string) => {
      commit(updateTile(tile.id, { yKey: key }))
    },
    onDepthChange: (depth: number) => {
      commit(updateTile(tile.id, { depth }))
    },
    onSortChange: (sortBy: 'index' | 'value') => {
      commit(updateTile(tile.id, { sortBy }))
    },
    onOrientationChange: (orientation: 'vertical' | 'horizontal') => {
      commit(updateTile(tile.id, { orientation }))
    },
    onGroupByChange: (groupBy: string | undefined) => {
      commit(updateTile(tile.id, { groupBy }))
    },
  }))
}

// ─── Dock tree per dashboard ──────────────────────────────────────────────────

let lastDashId = ''
let lastTileIds: string[] = []
let cachedDefaultTree: DockNode | null = null
let cachedDefaultTileIds: string[] = []
let urlLayoutApplied = false // Track if we've applied URL layout once

function getDockTree(dash: Dashboard) {
  const tileIds = dash.tiles.map(t => t.id)

  // First check for URL layout on initial load (once per session)
  if (!urlLayoutApplied) {
    const urlLayout = readLayoutFromURL()
    if (urlLayout) {
      urlLayoutApplied = true
      // First pass: parse with existing tiles to find what's missing
      const { dock: partialDock, missingKinds } = parseLayout(urlLayout, dash.tiles)

      if (missingKinds.length > 0) {
        // Add missing tiles to the dashboard
        let updatedWs = ws
        for (const kind of missingKinds) {
          if (TILE_KINDS.includes(kind)) {
            updatedWs = addTile(updatedWs, dash.id, kind)
          }
        }
        ws = updatedWs
        saveWorkspace(ws)

        // Second pass: parse again with all tiles present
        const updatedDash = updatedWs.dashboards.find(d => d.id === dash.id)!
        const { dock } = parseLayout(urlLayout, updatedDash.tiles)
        if (dock) {
          ws = updateDashboard(ws, { ...updatedDash, dockTree: dock })
          saveWorkspace(ws)
          cachedDefaultTree = dock
          cachedDefaultTileIds = updatedDash.tiles.map(t => t.id)
          lastDashId = dash.id
          lastTileIds = updatedDash.tiles.map(t => t.id)
          return dock
        }
      } else if (partialDock) {
        // All tiles exist, just update the dock tree
        ws = updateDashboard(ws, { ...dash, dockTree: partialDock })
        saveWorkspace(ws)
        cachedDefaultTree = partialDock
        cachedDefaultTileIds = [...tileIds]
        lastDashId = dash.id
        lastTileIds = tileIds
        return partialDock
      }
    }
  }

  // Only reconcile when tiles change — not on every render.
  // Reconciling on every render prunes empty groups created by splitGroupRight/Down.
  const tilesChanged = dash.id !== lastDashId || JSON.stringify(tileIds) !== JSON.stringify(lastTileIds)
  if (tilesChanged) {
    lastDashId = dash.id
    lastTileIds = tileIds
    if (dash.dockTree) return reconcile(dash.dockTree, tileIds)
    // Cache the default tree so we don't generate new random IDs on every
    // render — that would remount every chart on each store update.
    if (JSON.stringify(tileIds) !== JSON.stringify(cachedDefaultTileIds)) {
      cachedDefaultTree = defaultDockTree(tileIds)
      cachedDefaultTileIds = [...tileIds]
    }
    return cachedDefaultTree
  }
  if (dash.dockTree) return dash.dockTree
  // Same default tree as last time — don't regenerate.
  if (cachedDefaultTree && JSON.stringify(tileIds) === JSON.stringify(cachedDefaultTileIds)) {
    return cachedDefaultTree
  }
  cachedDefaultTree = defaultDockTree(tileIds)
  cachedDefaultTileIds = [...tileIds]
  return cachedDefaultTree
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const dash = activeDashboard(ws)
  const ds = dash ? ws.datasets.find(d => d.id === dash.datasetId) : activeDataset(ws)

  // Sync drill: hydrate store from persisted dashboard state ON DASH SWITCH ONLY.
  // Running this on every render clobbers live drill state: the hudStore subscriber
  // that persists drills to dash.drills is debounced 16ms, so a synchronous commit
  // (e.g. onDepthChange) triggers render() before the debounce fires — dash.drills
  // is stale, hydrateDrills wipes the just-set drill, and the chart snaps to root.
  const dashId = dash?.id ?? ''
  if (dashId !== lastHydratedDashId) {
    lastHydratedDashId = dashId
    const persistedDrills = dash?.drills ?? (dash?.drillNodeId ? { default: dash.drillNodeId } : {})
    const currentDrills = hudStore.getSnapshot().drills
    if (JSON.stringify(currentDrills) !== JSON.stringify(persistedDrills)) {
      hudStore.hydrateDrills(persistedDrills)
    }
  }

  // Dock tree
  const dock = dash ? getDockTree(dash) : null
  if (typeof dockView.setDock === 'function') {
    dockView.setDock(dock)
  } else {
    dockView.externalDock = dock
  }

  // Tile records
  const tiles = dash && ds ? buildTileRecords(dash, ds) : []
  if (typeof dockView.setTiles === 'function') {
    dockView.setTiles(tiles)
  } else {
    dockView.externalTiles = tiles
  }

  renderTopbar(ws)
}

// ─── Topbar ───────────────────────────────────────────────────────────────────

function renderTopbar(ws: Workspace) {
  const topbar = document.getElementById('sb-topbar')
  if (!topbar) return

  const dash = activeDashboard(ws)
  const dashes = dashboardsForDataset(ws, ws.activeDatasetId)
  const ds = ws.datasets.find(d => d.id === ws.activeDatasetId)

  topbar.innerHTML = ''

  const wordmark = document.createElement('span')
  wordmark.className = 'sb-wordmark'
  wordmark.textContent = 'sliceboard'
  topbar.appendChild(wordmark)

  const sep1 = document.createElement('span')
  sep1.className = 'sb-topbar-sep'
  sep1.textContent = '·'
  topbar.appendChild(sep1)

  // Dataset picker
  topbar.appendChild(buildDropdown(
    ds?.name ?? '—',
    ws.datasets.map(d => ({ id: d.id, label: d.name, active: d.id === ws.activeDatasetId })),
    (id) => switchDataset(id),
    () => newDataset(),
    ws.datasets.length > 1 ? () => deleteDs(ws.activeDatasetId) : undefined,
    'dataset',
  ))

  const sep2 = document.createElement('span')
  sep2.className = 'sb-topbar-sep'
  sep2.textContent = '/'
  topbar.appendChild(sep2)

  // Dashboard picker
  topbar.appendChild(buildDropdown(
    dash?.name ?? '—',
    dashes.map(d => ({ id: d.id, label: d.name, active: d.id === ws.activeDashboardId })),
    (id) => switchDashboard(id),
    () => newDashboard(),
    dashes.length > 1 ? () => deleteDash(ws.activeDashboardId) : undefined,
    'dashboard',
  ))

  // Spacer to push reset button to the right
  const spacer = document.createElement('div')
  spacer.style.flex = '1'
  topbar.appendChild(spacer)

  // Reset workspace button
  const resetBtn = document.createElement('button')
  resetBtn.className = 'sb-btn sb-reset-btn'
  resetBtn.textContent = 'Reset'
  resetBtn.title = 'Clear workspace and reload seed data'
  resetBtn.addEventListener('click', () => {
    if (confirm('Reset workspace to seed data? This will clear all changes.')) {
      localStorage.clear()
      window.location.reload()
    }
  })
  topbar.appendChild(resetBtn)
}

function buildDropdown(
  currentLabel: string,
  items: Array<{ id: string; label: string; active: boolean }>,
  onSelect: (id: string) => void,
  onCreate: () => void,
  onDelete: (() => void) | undefined,
  kind: string,
): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'sb-menu-wrap'

  const trigger = document.createElement('button')
  trigger.className = 'sb-btn sb-menu-trigger'
  const trigLabel = document.createElement('span')
  trigLabel.className = 'sb-menu-trigger-label'
  trigLabel.textContent = currentLabel
  const caret = document.createElement('span')
  caret.className = 'sb-menu-caret'
  caret.textContent = '▾'
  trigger.appendChild(trigLabel)
  trigger.appendChild(caret)

  let dropdown: HTMLElement | null = null

  const open = () => {
    if (dropdown) return
    dropdown = document.createElement('div')
    dropdown.className = 'sb-menu-dropdown'

    const boards = document.createElement('div')
    boards.className = 'sb-menu-boards'
    items.forEach(item => {
      const btn = document.createElement('button')
      btn.className = `sb-menu-board-btn${item.active ? ' active' : ''}`
      btn.textContent = item.label
      btn.addEventListener('click', () => { close(); onSelect(item.id) })
      boards.appendChild(btn)
    })
    dropdown.appendChild(boards)

    const actions = document.createElement('div')
    actions.className = 'sb-menu-actions'

    const newBtn = document.createElement('button')
    newBtn.className = 'sb-menu-action-btn'
    newBtn.textContent = `New ${kind}`
    newBtn.addEventListener('click', () => { close(); onCreate() })
    actions.appendChild(newBtn)

    if (onDelete) {
      const delBtn = document.createElement('button')
      delBtn.className = 'sb-menu-action-btn danger'
      delBtn.textContent = `Delete ${kind}`
      delBtn.addEventListener('click', () => { close(); onDelete() })
      actions.appendChild(delBtn)
    }

    dropdown.appendChild(actions)
    wrap.appendChild(dropdown)

    const handler = (e: MouseEvent) => {
      if (!wrap.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', handler)
    ;(dropdown as any)._handler = handler
  }

  const close = () => {
    if (dropdown) {
      document.removeEventListener('mousedown', (dropdown as any)._handler)
      dropdown.remove()
      dropdown = null
    }
  }

  trigger.addEventListener('click', () => dropdown ? close() : open())
  wrap.appendChild(trigger)
  return wrap
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function switchDataset(id: string) {
  const next = { ...ws, activeDatasetId: id }
  const dashes = dashboardsForDataset(next, id)
  const updated = { ...next, activeDashboardId: dashes[0]?.id ?? '' }
  const newDs = updated.datasets.find(d => d.id === id)
  if (newDs) resetHudForDataset(newDs.rows)
  commit(updated)
}

function newDataset() {
  const name = prompt('Dataset name:')
  if (!name) return
  let next = createDataset(ws, name)
  next = { ...next, activeDatasetId: next.datasets[next.datasets.length - 1]!.id }
  next = createDashboard(next, 'Overview', next.activeDatasetId)
  next = { ...next, activeDashboardId: next.dashboards[next.dashboards.length - 1]!.id }
  commit(next)
}

function deleteDs(id: string) {
  if (!confirm('Delete this dataset and all its dashboards?')) return
  commit(deleteDataset(ws, id))
}

function switchDashboard(id: string) {
  commit({ ...ws, activeDashboardId: id })
}

function newDashboard() {
  const name = prompt('Dashboard name:')
  if (!name) return
  let next = createDashboard(ws, name, ws.activeDatasetId)
  next = { ...next, activeDashboardId: next.dashboards[next.dashboards.length - 1]!.id }
  commit(next)
}

function deleteDash(id: string) {
  if (!confirm('Delete this dashboard?')) return
  commit(deleteDashboard(ws, id))
}

// ─── Esc handler ─────────────────────────────────────────────────────────────

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  const s = hudStore.getSnapshot()
  const ae = document.activeElement as any
  const focusedDrillKey = ae?.drillKey
  if (focusedDrillKey && s.drills[focusedDrillKey] != null) {
    const drillNodeId = s.drills[focusedDrillKey]!
    const dash = activeDashboard(ws)
    const ds = dash ? ws.datasets.find(d => d.id === dash.datasetId) : undefined
    if (!ds) return
    const path = drillPath(ds.rows, drillNodeId)
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
})

// ─── dockchange handler ───────────────────────────────────────────────────────

dockView.addEventListener('dockchange', (e: Event) => {
  const detail = (e as CustomEvent).detail
  const dash = activeDashboard(ws)
  if (!dash) return
  ws = updateDashboard(ws, { ...dash, dockTree: detail })
  commit(ws)
  // Sync layout to URL (debounced to avoid excessive history writes)
  syncLayoutToURL(detail)
})

let layoutSyncDebounce: ReturnType<typeof setTimeout> | null = null
function syncLayoutToURL(dock: DockNode | null) {
  if (layoutSyncDebounce) clearTimeout(layoutSyncDebounce)
  layoutSyncDebounce = setTimeout(() => {
    const dash = activeDashboard(ws)
    if (!dash) return
    const layoutStr = serializeLayout(dock, dash.tiles)
    writeLayoutToURL(layoutStr)
  }, 300)
}

// ─── dockaddtile handler ──────────────────────────────────────────────────────

dockView.addEventListener('dockaddtile', (e: Event) => {
  const { groupId, x, y } = (e as CustomEvent).detail
  showTilePicker(x, y, (kind) => {
    const dash = activeDashboard(ws)
    if (!dash) return
    const next = addTile(ws, dash.id, kind)
    const newTile = next.dashboards.find(d => d.id === dash.id)!.tiles.at(-1)!
    const currentTree = getDockTree(dash)
    const newTree = addTileToDock(currentTree, newTile.id, groupId)
    const updatedDash = next.dashboards.find(d => d.id === dash.id)!
    ws = updateDashboard(next, { ...updatedDash, dockTree: newTree })
    commit(ws)
  })
})

function showTilePicker(x: number, y: number, onPick: (kind: TileKind) => void) {
  // Remove any existing picker
  document.querySelectorAll('.sb-tile-picker').forEach(el => el.remove())

  const menu = document.createElement('div')
  menu.className = 'sb-tile-picker'
  menu.style.cssText = `position:fixed;z-index:9999;background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,0.4);display:flex;flex-direction:column;gap:2px;min-width:140px;visibility:hidden`

  TILE_KINDS.forEach(k => {
    const item = document.createElement('button')
    item.textContent = TILE_LABELS[k]
    item.style.cssText = 'background:none;border:none;color:#ccc;padding:6px 12px;text-align:left;cursor:pointer;border-radius:4px;font-size:12px'
    item.addEventListener('mouseenter', () => { item.style.background = '#2a2a2a' })
    item.addEventListener('mouseleave', () => { item.style.background = 'none' })
    item.addEventListener('click', () => {
      menu.remove()
      document.removeEventListener('mousedown', outsideHandler)
      onPick(k)
    })
    menu.appendChild(item)
  })

  // Append hidden to measure dimensions
  document.body.appendChild(menu)
  const menuRect = menu.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = 8  // spacing from viewport edge

  // Calculate horizontal position — anchor left by default, flip to right edge if needed
  let left = x
  let right = 'auto'
  if (left + menuRect.width > vw - gap) {
    // Not enough space on the right — align right edge to anchor or viewport edge
    const spaceOnLeft = x
    if (spaceOnLeft >= menuRect.width) {
      // Flip to open leftward from anchor
      left = x - menuRect.width
    } else {
      // Insufficient space on either side — pin to right viewport edge
      left = vw - menuRect.width - gap
    }
  }
  // Keep within left edge
  if (left < gap) left = gap

  // Calculate vertical position — anchor top by default, flip upward if needed
  let top = y
  if (top + menuRect.height > vh - gap) {
    // Not enough space below — try opening above the anchor
    const spaceAbove = y - menuRect.height - gap
    if (spaceAbove >= gap) {
      top = y - menuRect.height
    } else {
      // Insufficient space above or below — pin to bottom
      top = vh - menuRect.height - gap
    }
  }
  // Keep within top edge
  if (top < gap) top = gap

  // Apply final position and make visible
  menu.style.left = `${left}px`
  menu.style.top = `${top}px`
  menu.style.visibility = 'visible'

  const outsideHandler = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove()
      document.removeEventListener('mousedown', outsideHandler)
    }
  }
  setTimeout(() => document.addEventListener('mousedown', outsideHandler), 0)
}

// ─── Mount ────────────────────────────────────────────────────────────────────

function mount() {
  const app = document.getElementById('app')
  if (!app) throw new Error('No #app element')

  // Build shell structure
  app.innerHTML = `
    <div class="sb-root">
      <div id="sb-topbar" class="sb-topbar"></div>
      <div id="sb-body" class="sb-grid-wrap" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>
    </div>
  `

  const body = document.getElementById('sb-body')!
  dockView.style.cssText = 'flex:1;min-height:0;width:100%'
  body.appendChild(dockView)

  render()
}

function isDemosHash(): boolean {
  return window.location.hash.startsWith('#/demos')
}

function route() {
  if (isDemosHash()) {
    import('./demos/demos-main').then((m) => m.mountDemos())
  } else {
    mount()
  }
}

route()

window.addEventListener('hashchange', () => {
  // Demos and sliceboard are two separate surfaces; reload to switch cleanly.
  window.location.reload()
})
