/**
 * DockView.ts — bireactive dock layout as a vanilla HTMLElement custom element.
 *
 * Extends HTMLElement directly (not Diagram) because the layout is HTML
 * flexbox, not SVG. Uses bireactive primitives for reactive state, same
 * pattern as every chart's Diagram subclass.
 *
 * External API:
 *   el.externalDock  = DockNode | null   — set before append
 *   el.externalTiles = TileRecord[]      — set before append
 *   el.addEventListener('dockchange', e => ...)  — fires on tree mutation
 *   el.addEventListener('tilechange', e => ...)  — fires on tile config change
 */

import { cell, effect as biEffect } from 'bireactive'
import type { Cell, Writable } from 'bireactive'
import type {
  DockNode, DockGroup, DockSplit, DockEdge,
} from './dock'
import {
  allGroups, findPanel, findMaximizedGroup,
  setSizes, setActive, movePanel, dropOnEdge, dropGroupOnEdge, mergeGroups,
  toggleMaximize, splitGroupRight, splitGroupDown,
  reconcile, defaultDockTree, removePanel,
} from './dock'
import type { Tile, Dataset } from './persistence'
import { schemaFor } from './tile-config-schemas'
import { bindTile } from './viz/br/bindTile'
import type { TileController, TileSource } from './viz/br/bindTile'
import { hudStore } from './store'
import { buildTileSource, buildSimpleMount, simpleTag, simpleDataKey } from './tile-sources'
import type { TileRenderContext } from './tile-sources'
import { drillPath } from './persistence'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TileRecord {
  tile: Tile
  ds: Dataset
  measureKey: string
  label: string
  onUpdate: (rowId: string, measures: Tile['measureKey'] extends string ? Record<string, number> : never) => void
  onUpdateMany: (updates: Array<{ id: string; measures: Record<string, number> }>) => void
  onNodeReorder: (orderedIds: string[]) => void
  onRemove: () => void
  onMeasureChange: (key: string) => void
  onXKeyChange: (key: string) => void
  onYKeyChange: (key: string) => void
  onDepthChange: (depth: number) => void
  onSortChange: (sortBy: 'index' | 'value') => void
  onOrientationChange: (orientation: 'vertical' | 'horizontal') => void
  onGroupByChange: (key: string | undefined) => void
}

type DropTarget =
  | { kind: 'edge'; groupId: string; edge: DockEdge }
  | { kind: 'tab'; groupId: string; index: number }

interface DragState {
  kind: 'panel' | 'group'
  panelId?: string
  sourceGroupId?: string
  tileId?: string
  x: number
  y: number
  label: string
  over: DropTarget | null
}

// ─── Panel controller per live panel ─────────────────────────────────────────

interface PanelCtrl {
  container: HTMLElement
  tileCtrl: TileController | null
  simpleEl: HTMLElement | null
  simpleDataKey: string
  tileId: string
  /** Cached .dv-panel wrap so re-parenting doesn't disconnect the chart element. */
  wrap: HTMLElement | null
  dispose: () => void
}

// ─── DockView custom element ──────────────────────────────────────────────────

export class DockView extends HTMLElement {
  private _dockCell: Writable<Cell<DockNode | null>> | null = null
  private _tilesCell: Writable<Cell<TileRecord[]>> | null = null
  private _disposeAll: (() => void) | null = null
  private _panelCtrls = new Map<string, PanelCtrl>()
  private _dragState: DragState | null = null
  private _dragGhost: HTMLElement | null = null
  private _dragCleanup: (() => void) | null = null
  private _awaitingKChord = false
  private _unsubHud: (() => void) | null = null
  private _ro: ResizeObserver | null = null
  /** ID of the group that keyboard shortcuts should target. Updated on pointerdown.
   *  Separate from each group's activeId (tab selection) so clicking a group body
   *  doesn't alter the visible tab of any other group. */
  private _focusedGroupId: string | null = null

  // Set these before appending to DOM
  externalDock: DockNode | null = null
  externalTiles: TileRecord[] = []

  connectedCallback() {
    this.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;position:relative'

    const dockCell = cell<DockNode | null>(this.externalDock)
    const tilesCell = cell<TileRecord[]>(this.externalTiles)
    this._dockCell = dockCell as Writable<Cell<DockNode | null>>
    this._tilesCell = tilesCell as Writable<Cell<TileRecord[]>>

    const root = document.createElement('div')
    root.className = 'dv-root'
    root.style.cssText = 'flex:1;min-height:0;position:relative;overflow:hidden'
    this.appendChild(root)


    let lastTiles: TileRecord[] | null = null
    const stopEffect = biEffect(() => {
      const dock = dockCell.value
      const tiles = tilesCell.value
      const tilesChanged = tiles !== lastTiles
      lastTiles = tiles
      this._renderRoot(root, dock, tiles, tilesChanged)
    })

    let lastDrills: Record<string, string | null> = {}
    this._unsubHud = hudStore.subscribe(() => {
      // Re-render drill breadcrumbs on drill change — panel bodies contain them
      const dock = dockCell.value
      const tiles = tilesCell.value
      this._syncDrillBreadcrumbs(dock, tiles)
      // Only push drillNodeId to chart elements when drills actually changed.
      // Firing _syncChart on every hudStore change (hover, select) would overwrite
      // in-flight gesture edits with stale store values.
      const currentDrills = hudStore.getSnapshot().drills
      const drillsChanged = JSON.stringify(currentDrills) !== JSON.stringify(lastDrills)
      if (drillsChanged) {
        lastDrills = { ...currentDrills }
        for (const [panelId, ctrl] of this._panelCtrls) {
          if (ctrl.tileCtrl) {
            const tileRec = tiles.find(t => t.tile.id === ctrl.tileId)
            if (tileRec) this._syncChart(panelId, tileRec)
          }
        }
      }
    })

    this._ro = new ResizeObserver(() => {
      // Layout is CSS-driven; no action needed on resize
    })
    this._ro.observe(this)

    // Keyboard shortcuts scoped to this element
    this.setAttribute('tabindex', '-1')
    this.addEventListener('keydown', this._onKeyDown)

    this._disposeAll = () => {
      stopEffect()
      for (const ctrl of this._panelCtrls.values()) ctrl.dispose()
      this._panelCtrls.clear()
    }
  }

  disconnectedCallback() {
    this._disposeAll?.()
    this._unsubHud?.()
    this._ro?.disconnect()
    this._dragCleanup?.()
    this.removeEventListener('keydown', this._onKeyDown)
  }

  /** Push a new dock tree value from outside (called by main.ts on persistence load). */
  setDock(dock: DockNode | null) {
    if (this._dockCell) {
      (this._dockCell as any).value = dock
    } else {
      this.externalDock = dock
    }
  }

  /** Push updated tile records from outside (called by main.ts on workspace change). */
  setTiles(tiles: TileRecord[]) {
    if (this._tilesCell) {
      (this._tilesCell as any).value = tiles
    } else {
      this.externalTiles = tiles
    }
  }

  // ─── Internal render ──────────────────────────────────────────────────────

  private _renderRoot(root: HTMLElement, dock: DockNode | null, tiles: TileRecord[], tilesChanged: boolean) {
    const maximized = findMaximizedGroup(dock)
    const target = maximized ?? dock

    if (!target) {
      if (root.firstElementChild?.classList.contains('dv-empty')) {
        // Already showing empty state — don't rebuild
        return
      }
      root.innerHTML = ''
      const empty = document.createElement('div')
      empty.className = 'dv-empty'
      empty.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:#555;font-size:13px'
      const label = document.createElement('span')
      label.textContent = 'No panels'
      const addBtn = document.createElement('button')
      addBtn.textContent = '+ Add tile'
      addBtn.style.cssText = 'background:#222;border:1px solid #333;color:#ccc;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px'
      addBtn.addEventListener('click', () => {
        const rect = addBtn.getBoundingClientRect()
        this.dispatchEvent(new CustomEvent('dockaddtile', {
          detail: { groupId: null, x: rect.left, y: rect.bottom },
          bubbles: true, composed: true,
        }))
      })
      empty.appendChild(label)
      empty.appendChild(addBtn)
      root.appendChild(empty)
      return
    }

    const existingEl = root.firstElementChild as HTMLElement | null
    const existingId = existingEl?.dataset.splitId ?? existingEl?.dataset.groupId

    if (!existingId || existingId !== target.id) {
      // Structural change — full rebuild
      root.innerHTML = ''
      root.appendChild(this._buildNode(target, tiles))
      return
    }

    // Same root id — patch in place (handles size and activeId changes without rebuild)
    this._patchNode(existingEl!, target, tiles, tilesChanged)
  }

  // ─── Keyed in-place patch ─────────────────────────────────────────────────
  // Only called when node.id matches existing DOM element. Avoids rebuild for
  // hot-path mutations (gutter resize → flex only, tab switch → class toggle + panel swap).

  private _patchNode(el: HTMLElement, node: DockNode, tiles: TileRecord[], tilesChanged: boolean) {
    if (node.kind === 'group') this._patchGroup(el, node, tiles, tilesChanged)
    else this._patchSplit(el, node, tiles, tilesChanged)
  }

  private _patchSplit(el: HTMLElement, split: DockSplit, tiles: TileRecord[], tilesChanged: boolean) {
    const total = split.sizes.reduce((a, b) => a + b, 0) || 1
    const cells = Array.from(el.children).filter(c => (c as HTMLElement).classList.contains('dv-cell')) as HTMLElement[]

    if (cells.length !== split.children.length) {
      // Child count changed — rebuild split
      el.parentElement!.replaceChild(this._buildNode(split, tiles), el)
      return
    }

    split.children.forEach((child, i) => {
      const cell = cells[i]!
      // Hot path for gutter drag: just update flex, no DOM rebuild
      cell.style.flex = String((split.sizes[i] ?? 1) / total)
      const childEl = cell.firstElementChild as HTMLElement | null
      const childId = childEl?.dataset.splitId ?? childEl?.dataset.groupId
      if (!childEl || childId !== child.id) {
        cell.innerHTML = ''
        cell.appendChild(this._buildNode(child, tiles))
      } else {
        this._patchNode(childEl, child, tiles, tilesChanged)
      }
    })
  }

  private _patchGroup(el: HTMLElement, group: DockGroup, tiles: TileRecord[], tilesChanged: boolean) {
    // Reconcile tab strip: rebuild if the panel list (count, ids, or order) changed.
    const strip = el.querySelector<HTMLElement>('.dv-tabstrip')
    if (strip) {
      const tabsWrap = strip.querySelector<HTMLElement>('.dv-tabs')
      const domPanelIds = tabsWrap
        ? Array.from(tabsWrap.querySelectorAll<HTMLElement>('.dv-tab')).map(t => t.dataset.panelId ?? '')
        : []
      const treePanelIds = group.panels.map(p => p.id)
      const panelsChanged = domPanelIds.length !== treePanelIds.length || domPanelIds.some((id, i) => id !== treePanelIds[i])
      if (panelsChanged) {
        // Panel list changed — rebuild entire tab strip to get correct tabs,
        // labels, close handlers, and drag listeners.
        const newStrip = this._renderTabStrip(group, tiles)
        strip.replaceWith(newStrip)
      } else {
        // Panel list unchanged — just update active class. Close is always
        // enabled (an area may go empty), so no close-button state to sync.
        tabsWrap?.querySelectorAll<HTMLElement>('.dv-tab').forEach(tab => {
          const isActive = tab.dataset.panelId === group.activeId
          tab.classList.toggle('dv-tab--active', isActive)
          // Scroll active tab into view if it's outside the visible area
          if (isActive && tabsWrap) {
            const tabRect = tab.getBoundingClientRect()
            const wrapRect = tabsWrap.getBoundingClientRect()
            if (tabRect.left < wrapRect.left || tabRect.right > wrapRect.right) {
              tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
            }
          }
        })
      }
    }

    const body = el.querySelector<HTMLElement>('.dv-body')
    if (!body) return

    const active = group.panels.find(p => p.id === group.activeId) ?? group.panels[0]
    if (!active) { body.innerHTML = ''; return }

    // Find the currently visible (non-hidden) panel to know what's shown right now.
    const existingPanelEl = Array.from(body.querySelectorAll<HTMLElement>('.dv-panel'))
      .find(p => p.style.display !== 'none')
    const existingPanelId = existingPanelEl?.dataset.panelId

    // Remove stale drop indicators
    body.querySelectorAll('.dv-drop-indicator').forEach(e => e.remove())

    if (existingPanelId !== active.id) {
      // Active panel changed — hide inactive panels (keeps chart elements connected
      // so connectedCallback/scene() don't re-run on tab switch) and show active panel.
      body.querySelectorAll<HTMLElement>('.dv-panel').forEach(p => { p.style.display = 'none' })
      // Get or create the active panel wrap.
      const existingActive = this._panelCtrls.get(active.id)
      if (existingActive?.wrap && body.contains(existingActive.wrap)) {
        // Wrap already in body (just hidden) — show it.
        existingActive.wrap.style.display = ''
        if (tilesChanged) {
          const tileRec = tiles.find(t => t.tile.id === active.tileId)
          if (tileRec) this._syncChart(active.id, tileRec)
        }
      } else {
        // First time showing this panel — create and append its wrap.
        const wrap = this._getPanelContent(active.id, active.tileId, tiles)
        if (wrap) body.appendChild(wrap)
      }
    } else if (tilesChanged) {
      // Same panel, tiles data changed — sync source data (syncFrom/applyData).
      // Skip when only dock changed (gutter drag) to avoid overwriting in-flight gesture edits.
      const tileRec = tiles.find(t => t.tile.id === active.tileId)
      if (tileRec) {
        this._syncChart(active.id, tileRec)
        // Rebuild the tile header so dropdown closures capture the latest tile
        // state. Without this, a dropdown change (e.g. measure) uses a stale
        // `dash` from the original buildTileRecords call, losing properties set
        // by other dropdowns (e.g. orientation reverting to default on measure
        // change — WIN-140).
        this._refreshPanelHeader(active.id, tileRec, tiles)
      }
    }

    // Re-apply drop indicators for current drag state
    const drag = this._dragState
    if (drag?.over && drag.over.kind === 'edge' && drag.over.groupId === group.id) {
      const ind = document.createElement('div')
      ind.className = `dv-drop-indicator dv-drop-indicator--${drag.over.edge}`
      body.appendChild(ind)
    }
    if (drag?.over && drag.over.kind === 'tab' && drag.over.groupId === group.id) {
      const ind = document.createElement('div')
      ind.className = 'dv-drop-indicator dv-drop-indicator--center'
      body.appendChild(ind)
    }
  }

  // ─── Build (first mount or structural change) ─────────────────────────────

  private _buildNode(node: DockNode, tiles: TileRecord[]): HTMLElement {
    if (node.kind === 'group') return this._buildGroup(node, tiles)
    return this._buildSplit(node, tiles)
  }

  private _buildSplit(split: DockSplit, tiles: TileRecord[]): HTMLElement {
    const el = document.createElement('div')
    el.className = `dv-branch dv-branch--${split.direction}`
    el.dataset.splitId = split.id
    el.style.cssText = `display:flex;flex-direction:${split.direction === 'row' ? 'row' : 'column'};width:100%;height:100%;`

    const total = split.sizes.reduce((a, b) => a + b, 0) || 1

    split.children.forEach((child, i) => {
      const cell = document.createElement('div')
      cell.className = 'dv-cell'
      cell.style.cssText = `flex:${(split.sizes[i] ?? 1) / total};min-width:0;min-height:0;overflow:hidden;position:relative`
      cell.appendChild(this._buildNode(child, tiles))
      el.appendChild(cell)

      if (i < split.children.length - 1) {
        const gutter = document.createElement('div')
        gutter.className = `dv-gutter dv-gutter--${split.direction}`
        gutter.setAttribute('role', 'separator')
        gutter.setAttribute('aria-orientation', split.direction === 'row' ? 'vertical' : 'horizontal')
        gutter.title = 'Drag to resize'
        gutter.addEventListener('pointerdown', (e) => this._startGutterDrag(e, split, i))
        el.appendChild(gutter)
      }
    })

    return el
  }

  private _buildGroup(group: DockGroup, tiles: TileRecord[]): HTMLElement {
    const el = document.createElement('div')
    el.className = 'dv-group'
    el.dataset.groupId = group.id
    el.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden'

    // Clicking anywhere inside a group (body, tab strip, chart) makes it the
    // keyboard-focused group so shortcuts (Ctrl+\, Ctrl+W, etc.) target it.
    // Use capture so it fires before any child handler (e.g. drag initiators).
    // We only track focus here — we do NOT change the group's activeId (tab
    // selection) on a body click, to avoid inadvertently switching visible tabs.
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      const dock = this._dockCell?.value ?? null
      if (!dock) return
      const liveGroup = allGroups(dock).find(g => g.id === group.id)
      if (!liveGroup) return
      // Mark this group as the keyboard-focus target.
      this._focusedGroupId = liveGroup.id
    }, { capture: true })

    const strip = this._renderTabStrip(group, tiles)
    el.appendChild(strip)

    const body = document.createElement('div')
    body.className = 'dv-body'
    body.dataset.groupId = group.id
    body.dataset.dropzone = 'edges'
    body.style.cssText = 'flex:1;min-height:0;position:relative;overflow:hidden'

    const active = group.panels.find(p => p.id === group.activeId) ?? group.panels[0]
    if (active) {
      const panelWrap = this._getPanelContent(active.id, active.tileId, tiles)
      if (panelWrap) body.appendChild(panelWrap)
    }

    const drag = this._dragState
    if (drag?.over && drag.over.kind === 'edge' && drag.over.groupId === group.id) {
      const ind = document.createElement('div')
      ind.className = `dv-drop-indicator dv-drop-indicator--${drag.over.edge}`
      body.appendChild(ind)
    }
    if (drag?.over && drag.over.kind === 'tab' && drag.over.groupId === group.id) {
      const ind = document.createElement('div')
      ind.className = 'dv-drop-indicator dv-drop-indicator--center'
      body.appendChild(ind)
    }

    el.appendChild(body)
    return el
  }

  private _renderTabStrip(group: DockGroup, tiles: TileRecord[]): HTMLElement {
    const strip = document.createElement('div')
    strip.className = 'dv-tabstrip'
    strip.addEventListener('pointerdown', (e) => this._startGroupDrag(e, group))

    const tabsWrap = document.createElement('div')
    tabsWrap.className = 'dv-tabs'
    tabsWrap.dataset.groupId = group.id
    tabsWrap.dataset.dropzone = 'tabs'

    // Horizontal wheel scroll on tab strip
    tabsWrap.addEventListener('wheel', (e: WheelEvent) => {
      if (e.deltaY === 0 || tabsWrap.scrollWidth <= tabsWrap.clientWidth) return
      e.preventDefault()
      tabsWrap.scrollLeft += e.deltaY
    }, { passive: false })

    group.panels.forEach((p, i) => {
      const tileRec = tiles.find(t => t.tile.id === p.tileId)
      const label = tileRec?.label ?? p.tileId
      const isActive = p.id === group.activeId

      const tab = document.createElement('div')
      tab.className = `dv-tab${isActive ? ' dv-tab--active' : ''}`
      tab.dataset.tabIndex = String(i)
      tab.dataset.panelId = p.id
      tab.title = label

      const labelEl = document.createElement('span')
      labelEl.className = 'dv-tab-label'
      labelEl.textContent = label
      tab.appendChild(labelEl)

      const closeBtn = document.createElement('button')
      closeBtn.className = 'dv-tab-close'
      closeBtn.title = 'Close panel'
      closeBtn.setAttribute('aria-label', 'Close panel')
      closeBtn.textContent = '×'
      // An area may go empty (VS Code-style) — closing the last panel is
      // allowed. removePanel() prunes the emptied group and the dock collapses
      // to the empty state, so no per-area "keep last view" guard is needed.
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this._closePanel(group.id, p.id)
      })
      tab.appendChild(closeBtn)

      // Middle-click to close
      tab.addEventListener('mousedown', (e) => {
        if (e.button === 1) { e.preventDefault(); this._closePanel(group.id, p.id) }
      })

      tab.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return
        if ((e.target as HTMLElement).closest('.dv-tab-close')) return
        // Alt+drag on a tab = group drag (useful when tabs fill the strip).
        // Stop propagation so the strip's pointerdown listener doesn't also
        // call _startGroupDrag and create a duplicate drag session.
        if (e.altKey) { e.stopPropagation(); this._startGroupDrag(e, group); return }
        // Don't activate on mousedown — wait to see if this becomes a drag.
        // _startTabDrag will activate on pointerup if no drag threshold was crossed.
        this._startTabDrag(e, group, p.id, p.tileId, label)
      })

      tabsWrap.appendChild(tab)
    })

    strip.appendChild(tabsWrap)

    // Actions
    const actions = document.createElement('div')
    actions.className = 'dv-tabstrip-actions'

    // + button to add a tile to this group
    const addBtn = document.createElement('button')
    addBtn.className = 'dv-tab-add'
    addBtn.title = 'Add tile'
    addBtn.setAttribute('aria-label', 'Add tile')
    addBtn.textContent = '+'
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const rect = addBtn.getBoundingClientRect()
      this.dispatchEvent(new CustomEvent('dockaddtile', {
        detail: { groupId: group.id, x: rect.left, y: rect.bottom },
        bubbles: true, composed: true,
      }))
    })
    actions.appendChild(addBtn)

    const maxBtn = document.createElement('button')
    maxBtn.className = 'dv-tab-maximize'
    maxBtn.title = group.maximized ? 'Restore' : 'Maximize'
    maxBtn.setAttribute('aria-label', group.maximized ? 'Restore' : 'Maximize')
    maxBtn.textContent = group.maximized ? '◱' : '⛶'
    maxBtn.style.minWidth = '24px'
    maxBtn.style.minHeight = '24px'
    maxBtn.style.fontSize = '16px'
    maxBtn.addEventListener('click', () => this._toggleMaximize(group.id))
    actions.appendChild(maxBtn)

    strip.appendChild(actions)
    return strip
  }

  /** Rebuild the tile header in-place so dropdown closures capture the latest
   *  tile state. Without this, dropdown event listeners hold stale `dash`
   *  references from the original buildTileRecords call, and a measure change
   *  can clobber orientation (WIN-140). */
  private _refreshPanelHeader(panelId: string, tileRec: TileRecord, tiles: TileRecord[]) {
    const ctrl = this._panelCtrls.get(panelId)
    if (!ctrl?.wrap) return
    const oldHeader = ctrl.wrap.querySelector<HTMLElement>('.tile-header')
    if (!oldHeader) return
    const newHeader = this._buildTileHeader(tileRec, tiles)
    oldHeader.replaceWith(newHeader)
  }

  private _getPanelContent(panelId: string, tileId: string, tiles: TileRecord[]): HTMLElement | null {
    const tileRec = tiles.find(t => t.tile.id === tileId)
    if (!tileRec) return null

    const schema = schemaFor(tileRec.tile.kind)
    const { tile, ds } = tileRec

    const wrap = document.createElement('div')
    wrap.className = 'dv-panel'
    wrap.dataset.panelId = panelId
    wrap.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden'

    // Tile header
    const header = this._buildTileHeader(tileRec, tiles)
    wrap.appendChild(header)

    // Drill breadcrumb (if chart supports drill)
    if (schema.drillKey) {
      const drillBar = this._buildDrillBreadcrumb(tile.id, tileRec.ds)
      if (drillBar) wrap.appendChild(drillBar)
    }

    // Chart body
    const body = document.createElement('div')
    body.className = `tile-body${schema.scrollBody ? ' tile-body--scroll' : ''}${schema.drillKey ? ' tile-body--drill' : ''}`
    body.style.cssText = 'flex:1;min-height:0;overflow:hidden;position:relative'

    this._mountChart(body, panelId, tileRec, wrap)
    wrap.appendChild(body)

    return wrap
  }

  private _buildTileHeader(tileRec: TileRecord, tiles: TileRecord[]): HTMLElement {
    const { tile, ds, measureKey } = tileRec
    const schema = schemaFor(tile.kind)
    const pickers = schema.pickers

    const header = document.createElement('div')
    header.className = 'tile-header'

    const title = document.createElement('span')
    title.className = 'tile-title'
    title.textContent = tileRec.label
    header.appendChild(title)

    const actions = document.createElement('div')
    actions.className = 'tile-header-actions'

    const availableMeasures = ds.measureDefs

    if (pickers.depth) {
      const sel = document.createElement('select')
      sel.className = 'tile-measure-select'
      sel.title = 'Levels to show'
      ;[['0', 'All'], ['1', '1L'], ['2', '2L'], ['3', '3L'], ['4', '4L'], ['5', '5L']].forEach(([v, l]) => {
        const opt = document.createElement('option')
        opt.value = v; opt.textContent = l
        sel.appendChild(opt)
      })
      sel.value = String(tile.depth ?? 0)
      sel.addEventListener('change', () => tileRec.onDepthChange(Number(sel.value)))
      actions.appendChild(sel)
    }

    if (pickers.sort) {
      const sel = document.createElement('select')
      sel.className = 'tile-measure-select'
      sel.title = 'Sort order'
      ;[['index', 'Order'], ['value', 'Value']].forEach(([v, l]) => {
        const opt = document.createElement('option'); opt.value = v; opt.textContent = l; sel.appendChild(opt)
      })
      sel.value = tile.sortBy ?? 'index'
      sel.addEventListener('change', () => tileRec.onSortChange(sel.value as 'index' | 'value'))
      actions.appendChild(sel)
    }

    if (pickers.orientation) {
      const orientation = tile.orientation ?? (tile.kind === 'br-lc-bar' ? 'vertical' : 'horizontal')
      const sel = document.createElement('select')
      sel.className = 'tile-measure-select'
      sel.title = 'Orientation'
      ;[['horizontal', 'Horizontal'], ['vertical', 'Vertical']].forEach(([v, l]) => {
        const opt = document.createElement('option'); opt.value = v; opt.textContent = l; sel.appendChild(opt)
      })
      sel.value = orientation
      sel.addEventListener('change', () => tileRec.onOrientationChange(sel.value as 'vertical' | 'horizontal'))
      actions.appendChild(sel)
    }

    if (pickers.xKey && pickers.yKey) {
      const xLabel = document.createElement('label')
      xLabel.className = 'tile-axis-label'
      xLabel.textContent = 'X:'
      actions.appendChild(xLabel)

      const xSel = document.createElement('select')
      xSel.className = 'tile-measure-select'
      const xOpt = document.createElement('option'); xOpt.value = '_index'; xOpt.textContent = 'Index'
      xSel.appendChild(xOpt)
      availableMeasures.forEach(m => {
        const o = document.createElement('option'); o.value = m.key; o.textContent = m.label; xSel.appendChild(o)
      })
      xSel.value = tile.xKey ?? '_index'
      xSel.addEventListener('change', () => tileRec.onXKeyChange(xSel.value))
      actions.appendChild(xSel)

      const yLabel = document.createElement('label')
      yLabel.className = 'tile-axis-label'
      yLabel.textContent = 'Y:'
      actions.appendChild(yLabel)

      const ySel = document.createElement('select')
      ySel.className = 'tile-measure-select'
      availableMeasures.forEach(m => {
        const o = document.createElement('option'); o.value = m.key; o.textContent = m.label; ySel.appendChild(o)
      })
      ySel.value = tile.yKey ?? measureKey
      ySel.addEventListener('change', () => tileRec.onYKeyChange(ySel.value))
      actions.appendChild(ySel)
    } else if (pickers.measure && availableMeasures.length > 1) {
      const sel = document.createElement('select')
      sel.className = 'tile-measure-select'
      availableMeasures.forEach(m => {
        const o = document.createElement('option'); o.value = m.key; o.textContent = m.label; sel.appendChild(o)
      })
      sel.value = tile.measureKey ?? measureKey
      sel.addEventListener('change', () => tileRec.onMeasureChange(sel.value))
      actions.appendChild(sel)
    }

    if (pickers.groupBy && ds.dimDefs.length > 0) {
      const sel = document.createElement('select')
      sel.className = 'tile-measure-select'
      sel.title = 'Group by'
      const noGroup = document.createElement('option')
      noGroup.value = ''; noGroup.textContent = 'No group'
      sel.appendChild(noGroup)
      ds.dimDefs.forEach(d => {
        const o = document.createElement('option'); o.value = d.key; o.textContent = d.label; sel.appendChild(o)
      })
      sel.value = tile.groupBy ?? ''
      sel.addEventListener('change', () => tileRec.onGroupByChange(sel.value || undefined))
      actions.appendChild(sel)
    }

    const closeBtn = document.createElement('button')
    closeBtn.className = 'tile-close-btn'
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', () => tileRec.onRemove())
    actions.appendChild(closeBtn)

    header.appendChild(actions)
    return header
  }

  private _buildDrillBreadcrumb(drillKey: string, ds: Dataset): HTMLElement | null {
    const drillNodeId = hudStore.getSnapshot().drills[drillKey] ?? null
    const path = drillNodeId ? drillPath(ds.rows, drillNodeId) : []
    if (!drillNodeId || path.length === 0) return null

    const bar = document.createElement('div')
    bar.className = 'sb-drill-bar'
    bar.setAttribute('role', 'navigation')
    bar.setAttribute('aria-label', 'Drill path')
    bar.dataset.drillKey = drillKey

    const rootBtn = document.createElement('button')
    rootBtn.type = 'button'
    rootBtn.className = 'sb-drill-crumb'
    rootBtn.textContent = 'Root'
    rootBtn.addEventListener('click', () => hudStore.setDrill(drillKey, null))
    bar.appendChild(rootBtn)

    const parent = path.length >= 2 ? path[path.length - 2]! : null

    path.forEach((n, i) => {
      const isCurrent = i === path.length - 1
      const seg = document.createElement('span')
      seg.className = 'sb-drill-seg'

      const sep = document.createElement('span')
      sep.className = 'sb-drill-sep'
      sep.textContent = '›'
      seg.appendChild(sep)

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `sb-drill-crumb${isCurrent ? ' sb-drill-crumb--current' : ''}`
      btn.textContent = n.name
      btn.title = isCurrent ? 'Click to drill out fully' : `Drill to ${n.name}`
      if (isCurrent) btn.setAttribute('aria-current', 'location')
      btn.addEventListener('click', () => hudStore.setDrill(drillKey, isCurrent ? null : n.id))
      seg.appendChild(btn)
      bar.appendChild(seg)
    })

    const upBtn = document.createElement('button')
    upBtn.type = 'button'
    upBtn.className = 'sb-btn sb-drill-up'
    upBtn.textContent = '↑ Up'
    upBtn.title = 'Drill out one level (Esc)'
    upBtn.addEventListener('click', () => hudStore.setDrill(drillKey, parent ? parent.id : null))
    bar.appendChild(upBtn)

    return bar
  }

  private _syncDrillBreadcrumbs(dock: DockNode | null, tiles: TileRecord[]) {
    // Re-render drill bars for all visible panels when hud changes.
    // Find all [data-drill-key] elements and rebuild them in place.
    const bars = this.querySelectorAll<HTMLElement>('[data-drill-key]')
    bars.forEach(bar => {
      const drillKey = bar.dataset.drillKey!
      const tileRec = tiles.find(t => t.tile.id === drillKey)
      if (!tileRec) return
      const newBar = this._buildDrillBreadcrumb(drillKey, tileRec.ds)
      if (newBar) {
        bar.replaceWith(newBar)
      } else {
        bar.replaceWith(document.createElement('div')) // empty placeholder
      }
    })
  }

  // ─── Chart data sync (same panel, data changed) ──────────────────────────

  private _syncChart(panelId: string, tileRec: TileRecord) {
    const existing = this._panelCtrls.get(panelId)
    if (!existing?.tileCtrl) return
    const { tile, ds, measureKey } = tileRec
    const drillNodeId = hudStore.getSnapshot().drills[tile.id] ?? null
    const ctx: TileRenderContext = { tile, ds, measureKey, drillNodeId,
      onUpdate: tileRec.onUpdate as any,
      onUpdateMany: tileRec.onUpdateMany as any,
      onNodeReorder: tileRec.onNodeReorder,
    }
    const source = buildTileSource(ctx)
    if (source) existing.tileCtrl.update(source)
  }

  // ─── Chart mounting ───────────────────────────────────────────────────────

  private _mountChart(body: HTMLElement, panelId: string, tileRec: TileRecord, wrap?: HTMLElement) {
    const { tile, ds, measureKey } = tileRec
    const drillNodeId = hudStore.getSnapshot().drills[tile.id] ?? null
    const ctx: TileRenderContext = {
      tile, ds, measureKey, drillNodeId,
      onUpdate: tileRec.onUpdate as any,
      onUpdateMany: tileRec.onUpdateMany as any,
      onNodeReorder: tileRec.onNodeReorder,
    }

    const existing = this._panelCtrls.get(panelId)
    const source = buildTileSource(ctx)

    if (source) {
      // bindTile flow
      if (!existing) {
        const container = document.createElement('div')
        container.style.cssText = 'width:100%;height:100%;flex:1;min-height:0'
        body.appendChild(container)
        const tileCtrl = bindTile(container, source)
        const ctrl: PanelCtrl = {
          container,
          tileCtrl,
          simpleEl: null,
          simpleDataKey: '',
          tileId: tile.id,
          wrap: wrap ?? null,
          dispose: () => { tileCtrl.dispose(); container.remove() },
        }
        this._panelCtrls.set(panelId, ctrl)
      } else {
        // Re-parent without moving the chart element — keep it in its container.
        // (We get here only on first show after initial mount if wrap wasn't cached.)
        body.appendChild(existing.container)
        if (wrap) existing.wrap = wrap
        existing.tileCtrl?.update(source)
      }
    } else {
      // Simple one-shot element (gauge, sankey)
      const tag = simpleTag(tile.kind)
      const setup = buildSimpleMount(ctx)
      const dk = simpleDataKey(ctx)

      if (tag && setup) {
        if (!existing || existing.simpleDataKey !== dk) {
          // Remount
          existing?.dispose()
          const el = document.createElement(tag)
          el.setAttribute('no-source', '')
          el.style.cssText = 'width:100%;height:100%;display:block'
          setup(el)
          body.appendChild(el)
          const ctrl: PanelCtrl = {
            container: body,
            tileCtrl: null,
            simpleEl: el,
            simpleDataKey: dk,
            tileId: tile.id,
            wrap: wrap ?? null,
            dispose: () => { if (body.contains(el)) body.removeChild(el) },
          }
          this._panelCtrls.set(panelId, ctrl)
        } else {
          body.appendChild(existing.simpleEl!)
        }
      } else {
        // Unsupported retired kind — show placeholder
        const ph = document.createElement('div')
        ph.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;opacity:0.4;font-size:12px'
        ph.textContent = `${tile.kind} (not yet ported)`
        body.appendChild(ph)
      }
    }
  }

  // ─── Dock mutations ───────────────────────────────────────────────────────

  private _mutateDock(next: DockNode | null) {
    if (!this._dockCell) return
    ;(this._dockCell as any).value = next
    this.dispatchEvent(new CustomEvent('dockchange', { detail: next, bubbles: true, composed: true }))
  }

  private _activatePanel(groupId: string, panelId: string) {
    const dock = this._dockCell?.value ?? null
    this._mutateDock(setActive(dock, groupId, panelId))
  }

  private _closePanel(_groupId: string, panelId: string) {
    const dock = this._dockCell?.value ?? null
    if (!dock) return
    // Remove panel from dock tree only — the tile stays in the workspace and
    // can be dragged back or re-added. tileRec.onRemove() (workspace delete)
    // is only appropriate when the user explicitly removes a tile from the topbar.
    this._mutateDock(removePanel(dock, panelId))
  }

  private _toggleMaximize(groupId: string) {
    const dock = this._dockCell?.value ?? null
    this._mutateDock(toggleMaximize(dock, groupId))
  }

  // ─── Gutter drag ─────────────────────────────────────────────────────────

  private _startGutterDrag(e: PointerEvent, split: DockSplit, gutterIndex: number) {
    e.preventDefault()
    const gutterEl = e.currentTarget as HTMLElement
    const branchEl = gutterEl.parentElement
    if (!branchEl) return
    try { gutterEl.setPointerCapture(e.pointerId) } catch { /* ok */ }
    const rect = branchEl.getBoundingClientRect()
    // Derive axis from the DOM's current flex-direction, not split.direction,
    // so the responsive CSS override (row → column at ≤640px) doesn't invert
    // the drag axis. Touch on mobile drags vertically to resize stacked panes.
    const horiz = getComputedStyle(branchEl).flexDirection === 'row'
    const totalPx = horiz ? rect.width : rect.height
    if (totalPx <= 0) return

    const startSizes = split.sizes.slice()
    const sumPair = (startSizes[gutterIndex] ?? 1) + (startSizes[gutterIndex + 1] ?? 1)
    const startCoord = horiz ? e.clientX : e.clientY
    const totalWeight = startSizes.reduce((a, b) => a + b, 0)
    const pairPx = totalPx * (sumPair / totalWeight)

    const onMove = (ev: PointerEvent) => {
      const cur = horiz ? ev.clientX : ev.clientY
      const dPx = cur - startCoord
      const minPx = 24
      const leftPx = clamp((startSizes[gutterIndex]! / sumPair) * pairPx + dPx, minPx, pairPx - minPx)
      const rightPx = pairPx - leftPx
      const next = startSizes.slice()
      next[gutterIndex] = (leftPx / pairPx) * sumPair
      next[gutterIndex + 1] = (rightPx / pairPx) * sumPair
      const dock = this._dockCell?.value ?? null
      this._mutateDock(setSizes(dock, split.id, next))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ─── Tab drag ────────────────────────────────────────────────────────────

  private _startTabDrag(e: PointerEvent, group: DockGroup, panelId: string, tileId: string, label: string) {
    // Prevent the browser from claiming the gesture for page scroll on touch
    // and keep pointermove flowing to us after the tabstrip re-renders.
    e.preventDefault()
    const tabEl = e.currentTarget as HTMLElement
    try { tabEl.setPointerCapture(e.pointerId) } catch { /* ok */ }
    const startX = e.clientX
    const startY = e.clientY
    let dragging = false

    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return
      dragging = true
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      this._beginDrag({ kind: 'panel', panelId, sourceGroupId: group.id, tileId, x: ev.clientX, y: ev.clientY, label, over: null })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      // No drag occurred — treat as a click and activate
      if (!dragging) this._activatePanel(group.id, panelId)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  private _startGroupDrag(e: PointerEvent, group: DockGroup) {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    // Allow Alt+drag from anywhere (including tabs) to initiate group drag.
    // Without Alt, only start from empty tabstrip space (not on tabs or buttons).
    if (!e.altKey && (target.closest('.dv-tab') || target.closest('button'))) return

    // Reserve the gesture for us on touch so page scroll doesn't hijack it.
    e.preventDefault()
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* ok */ }

    const startX = e.clientX
    const startY = e.clientY
    const label = `Group (${group.panels.length} panel${group.panels.length !== 1 ? 's' : ''})`

    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      this._beginDrag({ kind: 'group', sourceGroupId: group.id, x: ev.clientX, y: ev.clientY, label, over: null })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  private _beginDrag(init: DragState) {
    if (this._dragState) return   // already dragging — ignore duplicate _beginDrag
    this._dragState = init
    this._showGhost(init.x, init.y, init.label)

    const onMove = (ev: PointerEvent) => {
      const over = this._hitTest(ev.clientX, ev.clientY)
      this._dragState = { ...this._dragState!, x: ev.clientX, y: ev.clientY, over }
      this._updateGhost(ev.clientX, ev.clientY)
      // Light re-render for drop indicator (only the indicator overlay, not full rebuild)
      this._updateDropIndicators()
    }
    const onUp = (ev: PointerEvent) => {
      cleanup()
      const state = this._dragState
      this._dragState = null
      this._removeGhost()
      this._updateDropIndicators()
      if (state?.over) this._commitDrop(state)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      cleanup()
      this._dragState = null
      this._removeGhost()
      this._updateDropIndicators()
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
      this._dragCleanup = null
    }
    this._dragCleanup = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
  }

  private _showGhost(x: number, y: number, label: string) {
    if (this._dragGhost) this._dragGhost.remove()
    const ghost = document.createElement('div')
    ghost.className = 'dv-drag-ghost'
    ghost.textContent = label
    ghost.style.cssText = `position:fixed;left:${x + 12}px;top:${y + 12}px;pointer-events:none;z-index:9999`
    document.body.appendChild(ghost)
    this._dragGhost = ghost
  }

  private _updateGhost(x: number, y: number) {
    if (this._dragGhost) {
      this._dragGhost.style.left = `${x + 12}px`
      this._dragGhost.style.top = `${y + 12}px`
    }
  }

  private _removeGhost() {
    this._dragGhost?.remove()
    this._dragGhost = null
  }

  private _updateDropIndicators() {
    // Remove all existing indicators
    this.querySelectorAll('.dv-drop-indicator').forEach(el => el.remove())
    const drag = this._dragState
    if (!drag?.over) return

    if (drag.over.kind === 'edge') {
      const body = this.querySelector<HTMLElement>(`[data-group-id="${drag.over.groupId}"][data-dropzone="edges"]`)
      if (body) {
        const ind = document.createElement('div')
        ind.className = `dv-drop-indicator dv-drop-indicator--${drag.over.edge}`
        body.appendChild(ind)
      }
    } else if (drag.over.kind === 'tab') {
      const body = this.querySelector<HTMLElement>(`[data-group-id="${drag.over.groupId}"][data-dropzone="edges"]`)
      if (body) {
        const ind = document.createElement('div')
        ind.className = 'dv-drop-indicator dv-drop-indicator--center'
        body.appendChild(ind)
      }
    }
  }

  private _hitTest(clientX: number, clientY: number): DropTarget | null {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    if (!el || !this.contains(el)) return null

    const tabsEl = el.closest('[data-dropzone="tabs"]') as HTMLElement | null
    if (tabsEl) {
      const groupId = tabsEl.getAttribute('data-group-id')!
      const tabEls = Array.from(tabsEl.querySelectorAll<HTMLElement>('.dv-tab'))
      let index = tabEls.length
      for (let i = 0; i < tabEls.length; i++) {
        const r = tabEls[i]!.getBoundingClientRect()
        if (clientX < r.left + r.width / 2) { index = i; break }
      }
      return { kind: 'tab', groupId, index }
    }

    const bodyEl = el.closest('[data-dropzone="edges"]') as HTMLElement | null
    if (bodyEl) {
      const groupId = bodyEl.getAttribute('data-group-id')!
      const r = bodyEl.getBoundingClientRect()
      const xFrac = (clientX - r.left) / r.width
      const yFrac = (clientY - r.top) / r.height
      if (yFrac < 0.33) return { kind: 'edge', groupId, edge: 'up' }
      if (yFrac > 0.67) return { kind: 'edge', groupId, edge: 'down' }
      if (xFrac < 0.33) return { kind: 'edge', groupId, edge: 'left' }
      if (xFrac > 0.67) return { kind: 'edge', groupId, edge: 'right' }
      return { kind: 'tab', groupId, index: -1 }
    }

    return null
  }

  private _commitDrop(state: DragState) {
    const dock = this._dockCell?.value ?? null
    const target = state.over!

    if (state.kind === 'panel' && state.panelId) {
      if (target.kind === 'edge') {
        this._mutateDock(dropOnEdge(dock, state.panelId, target.groupId, target.edge))
      } else {
        // tab drop — center or tab strip
        const idx = target.index >= 0 ? target.index : Infinity
        this._mutateDock(movePanel(dock, state.panelId, target.groupId, idx === Infinity ? 9999 : idx))
      }
    } else if (state.kind === 'group' && state.sourceGroupId) {
      if (target.kind === 'edge') {
        this._mutateDock(dropGroupOnEdge(dock, state.sourceGroupId, target.groupId, target.edge))
      } else {
        this._mutateDock(mergeGroups(dock, state.sourceGroupId, target.groupId))
      }
    }
  }

  // ─── Keyboard shortcuts ────────────────────────────────────────────────────

  private _onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'k' && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      this._awaitingKChord = true
      return
    }
    if (this._awaitingKChord && e.ctrlKey && e.key === '\\' && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      this._awaitingKChord = false
      const dock = this._dockCell?.value ?? null
      const activeGroup = this._getKeyboardGroup(dock)
      if (activeGroup) this._mutateDock(splitGroupDown(dock, activeGroup.id))
      return
    }
    if (!this._awaitingKChord && e.ctrlKey && e.key === '\\' && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      const dock = this._dockCell?.value ?? null
      const activeGroup = this._getKeyboardGroup(dock)
      if (activeGroup) this._mutateDock(splitGroupRight(dock, activeGroup.id))
      return
    }
    if (e.ctrlKey && e.key === 'w' && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      const dock = this._dockCell?.value ?? null
      const activeGroup = this._getKeyboardGroup(dock)
      // Closing the last panel is allowed — the emptied area collapses.
      if (activeGroup && activeGroup.activeId) this._closePanel(activeGroup.id, activeGroup.activeId)
      return
    }
    if (this._awaitingKChord) this._awaitingKChord = false
  }

  /** Return the group that keyboard shortcuts should act on.
   *  Prefers the last-clicked (_focusedGroupId), falls back to the first group
   *  in tree order that has panels (so shortcuts work without any click). */
  private _getKeyboardGroup(dock: DockNode | null): DockGroup | null {
    const groups = allGroups(dock)
    if (groups.length === 0) return null
    if (this._focusedGroupId) {
      const focused = groups.find(g => g.id === this._focusedGroupId)
      if (focused) return focused
    }
    // Fallback: first group with panels
    return groups.find(g => g.panels.length > 0) ?? groups[0] ?? null
  }

  // ─── Drop overlay (root-level, not per-group) ─────────────────────────────

  private _renderDropOverlay(root: HTMLElement, target: DropTarget) {
    // Indicators are rendered inline in the group bodies; no separate root overlay needed.
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────

if (!customElements.get('sb-dock-view')) {
  customElements.define('sb-dock-view', DockView)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}
