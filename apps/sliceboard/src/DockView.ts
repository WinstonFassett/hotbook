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
  reconcile, defaultDockTree,
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

    const stopEffect = biEffect(() => {
      const dock = dockCell.value
      const tiles = tilesCell.value
      this._renderRoot(root, dock, tiles)
    })

    this._unsubHud = hudStore.subscribe(() => {
      // Re-render drill breadcrumbs on drill change — panel bodies contain them
      const dock = dockCell.value
      const tiles = tilesCell.value
      this._syncDrillBreadcrumbs(dock, tiles)
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

  private _renderRoot(root: HTMLElement, dock: DockNode | null, tiles: TileRecord[]) {
    const maximized = findMaximizedGroup(dock)
    // Clear and re-render
    // We manage DOM ourselves to avoid full teardown on every cell update.
    // Instead use keyed reconciliation: groups/splits by their node.id.
    this._reconcileRoot(root, dock, tiles, maximized)
  }

  private _reconcileRoot(
    container: HTMLElement,
    dock: DockNode | null,
    tiles: TileRecord[],
    maximized: DockGroup | null,
  ) {
    // Remove any drop overlay ghost first
    const existingOverlay = container.querySelector('.dv-drop-overlay')
    if (existingOverlay) existingOverlay.remove()

    if (!dock) {
      container.innerHTML = '<div class="dv-empty">No panels — click "+ Tile" to add one</div>'
      return
    }

    if (maximized) {
      container.innerHTML = ''
      const groupEl = this._renderGroup(maximized, tiles)
      container.appendChild(groupEl)
      return
    }

    container.innerHTML = ''
    const nodeEl = this._renderNode(dock, tiles)
    container.appendChild(nodeEl)

    // Render drag overlay if active
    if (this._dragState?.over) {
      this._renderDropOverlay(container, this._dragState.over)
    }
  }

  private _renderNode(node: DockNode, tiles: TileRecord[]): HTMLElement {
    if (node.kind === 'group') return this._renderGroup(node, tiles)
    return this._renderSplit(node, tiles)
  }

  private _renderSplit(split: DockSplit, tiles: TileRecord[]): HTMLElement {
    const el = document.createElement('div')
    el.className = `dv-branch dv-branch--${split.direction}`
    el.dataset.splitId = split.id
    el.style.cssText = `display:flex;flex-direction:${split.direction === 'row' ? 'row' : 'column'};width:100%;height:100%;`

    const total = split.sizes.reduce((a, b) => a + b, 0) || 1

    split.children.forEach((child, i) => {
      const cell = document.createElement('div')
      cell.className = 'dv-cell'
      cell.style.cssText = `flex:${(split.sizes[i] ?? 1) / total};min-width:0;min-height:0;overflow:hidden;position:relative`
      cell.appendChild(this._renderNode(child, tiles))
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

  private _renderGroup(group: DockGroup, tiles: TileRecord[]): HTMLElement {
    const el = document.createElement('div')
    el.className = 'dv-group'
    el.dataset.groupId = group.id
    el.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden'

    // Tab strip
    const strip = this._renderTabStrip(group, tiles)
    el.appendChild(strip)

    // Panel body
    const body = document.createElement('div')
    body.className = 'dv-body'
    body.dataset.groupId = group.id
    body.dataset.dropzone = 'edges'
    body.style.cssText = 'flex:1;min-height:0;position:relative;overflow:hidden'

    const active = group.panels.find(p => p.id === group.activeId) ?? group.panels[0]
    if (active) {
      const panelWrap = this._getPanelContent(active.panelId ?? active.id, active.tileId, tiles)
      if (panelWrap) body.appendChild(panelWrap)
    }

    // Drop indicator overlay
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
        this._activatePanel(group.id, p.id)
        this._startTabDrag(e, group, p.id, p.tileId, label)
      })

      tabsWrap.appendChild(tab)
    })

    strip.appendChild(tabsWrap)

    // Actions
    const actions = document.createElement('div')
    actions.className = 'dv-tabstrip-actions'

    const maxBtn = document.createElement('button')
    maxBtn.className = 'dv-tab-maximize'
    maxBtn.title = group.maximized ? 'Restore' : 'Maximize'
    maxBtn.setAttribute('aria-label', group.maximized ? 'Restore' : 'Maximize')
    maxBtn.textContent = group.maximized ? '❐' : '□'
    maxBtn.addEventListener('click', () => this._toggleMaximize(group.id))
    actions.appendChild(maxBtn)

    strip.appendChild(actions)
    return strip
  }

  private _getPanelContent(panelId: string, tileId: string, tiles: TileRecord[]): HTMLElement | null {
    const tileRec = tiles.find(t => t.tile.id === tileId)
    if (!tileRec) return null

    const wrap = document.createElement('div')
    wrap.className = 'dv-panel'
    wrap.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden'

    const schema = schemaFor(tileRec.tile.kind)
    const { tile, ds, measureKey } = tileRec

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

    this._mountChart(body, panelId, tileRec)
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

  // ─── Chart mounting ───────────────────────────────────────────────────────

  private _mountChart(body: HTMLElement, panelId: string, tileRec: TileRecord) {
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
          dispose: () => { tileCtrl.dispose(); container.remove() },
        }
        this._panelCtrls.set(panelId, ctrl)
      } else {
        body.appendChild(existing.container)
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
        ph.textContent = `${tile.kind} (unsupported)`
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

  private _closePanel(groupId: string, panelId: string) {
    const dock = this._dockCell?.value ?? null
    // Remove from dock tree
    const found = dock ? findPanel(dock, panelId) : null
    if (!found) return
    // Close via tileRec.onRemove for the tile, then reconcile dock
    // For now: remove panel from dock only — tile removal goes through topbar
    // (same as before — the × in tile header calls onRemove which fires through
    // the workspace update path). Closing from the tab strip removes JUST the
    // panel from this group; the tile still exists and can be dragged back.
    // TODO: call tileRec.onRemove() if the tile is the last panel referencing it
    const tiles = this._tilesCell?.value ?? []
    const tileRec = tiles.find(t => t.tile.id === found.panel.tileId)
    tileRec?.onRemove()
  }

  private _toggleMaximize(groupId: string) {
    const dock = this._dockCell?.value ?? null
    this._mutateDock(toggleMaximize(dock, groupId))
  }

  // ─── Gutter drag ─────────────────────────────────────────────────────────

  private _startGutterDrag(e: PointerEvent, split: DockSplit, gutterIndex: number) {
    e.preventDefault()
    const branchEl = (e.currentTarget as HTMLElement).parentElement
    if (!branchEl) return
    const rect = branchEl.getBoundingClientRect()
    const horiz = split.direction === 'row'
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
    const startX = e.clientX
    const startY = e.clientY

    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      this._beginDrag({ kind: 'panel', panelId, sourceGroupId: group.id, tileId, x: ev.clientX, y: ev.clientY, label, over: null })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  private _startGroupDrag(e: PointerEvent, group: DockGroup) {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.dv-tab') || target.closest('button')) return

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
      if (yFrac < 0.25) return { kind: 'edge', groupId, edge: 'up' }
      if (yFrac > 0.75) return { kind: 'edge', groupId, edge: 'down' }
      if (xFrac < 0.25) return { kind: 'edge', groupId, edge: 'left' }
      if (xFrac > 0.75) return { kind: 'edge', groupId, edge: 'right' }
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
      const activeGroup = allGroups(dock).find(g => g.activeId)
      if (activeGroup) this._mutateDock(splitGroupDown(dock, activeGroup.id))
      return
    }
    if (!this._awaitingKChord && e.ctrlKey && e.key === '\\' && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      const dock = this._dockCell?.value ?? null
      const activeGroup = allGroups(dock).find(g => g.activeId)
      if (activeGroup) this._mutateDock(splitGroupRight(dock, activeGroup.id))
      return
    }
    if (e.ctrlKey && e.key === 'w' && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      const dock = this._dockCell?.value ?? null
      const activeGroup = allGroups(dock).find(g => g.activeId)
      if (activeGroup && activeGroup.activeId) this._closePanel(activeGroup.id, activeGroup.activeId)
      return
    }
    if (this._awaitingKChord) this._awaitingKChord = false
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
