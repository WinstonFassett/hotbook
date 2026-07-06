/**
 * PageStackView.ts — vertical scroll surface of stacked DockView roots.
 *
 * One `<sb-dock-view>` per Page, wrapped in a fixed-height container. Pages
 * are separated by a thicker `.sb-page-gutter` element whose vertical drag
 * resizes the page above single-sided: growing the page above shrinks nothing
 * below — the page below keeps its own heightPx and the whole surface simply
 * scrolls further (per Q5 in WIN-84 Stage 2).
 *
 * External API (see PageStackCallbacks and PageEntry): main.ts hands in the
 * page list plus per-page dock tree + tile records, and receives dockchange /
 * dockaddtile / pageresize callbacks tagged with the owning dashboardId /
 * pageId so it can route each mutation back to the right dashboard.
 */

import { DockView, type TileRecord } from './DockView'
import type { DockNode } from './dock'
import { MIN_PAGE_HEIGHT_PX } from './persistence'

export interface PageEntry {
  pageId: string
  dashboardId: string
  heightPx: number
  dock: DockNode | null
  tiles: TileRecord[]
}

export interface PageStackCallbacks {
  onDockChange(dashboardId: string, dock: DockNode): void
  onDockAddTile(dashboardId: string, groupId: string, x: number, y: number): void
  onPageResize(pageId: string, heightPx: number): void
}

interface PageSlot {
  wrap: HTMLElement
  dockView: DockView
  dashboardId: string
  heightPx: number
  onDockChange: (e: Event) => void
  onDockAddTile: (e: Event) => void
}

export class PageStackView extends HTMLElement {
  private _slots = new Map<string, PageSlot>()
  private _gutters = new Map<string, HTMLElement>() // keyed by the pageId ABOVE the gutter
  private _callbacks: PageStackCallbacks | null = null
  private _scrollRoot: HTMLElement | null = null

  setCallbacks(cb: PageStackCallbacks) {
    this._callbacks = cb
  }

  connectedCallback() {
    this.style.cssText = 'display:block;flex:1;min-height:0;width:100%;position:relative'
    const scroll = document.createElement('div')
    scroll.className = 'sb-page-stack'
    scroll.style.cssText = 'width:100%;height:100%;overflow-y:auto;overflow-x:hidden'
    this.appendChild(scroll)
    this._scrollRoot = scroll
  }

  disconnectedCallback() {
    for (const slot of this._slots.values()) {
      slot.dockView.removeEventListener('dockchange', slot.onDockChange)
      slot.dockView.removeEventListener('dockaddtile', slot.onDockAddTile)
    }
    this._slots.clear()
    this._gutters.clear()
  }

  setPages(pages: PageEntry[]) {
    const root = this._scrollRoot
    if (!root) return

    const keepIds = new Set(pages.map(p => p.pageId))
    for (const [pid, slot] of Array.from(this._slots)) {
      if (!keepIds.has(pid)) {
        slot.dockView.removeEventListener('dockchange', slot.onDockChange)
        slot.dockView.removeEventListener('dockaddtile', slot.onDockAddTile)
        slot.wrap.remove()
        this._slots.delete(pid)
      }
    }
    for (const [pid, gutter] of Array.from(this._gutters)) {
      // Gutter above page X is keyed by the pageId just above it in the last
      // render. If that page is gone or is now the last page, drop the gutter.
      const idx = pages.findIndex(p => p.pageId === pid)
      if (idx === -1 || idx === pages.length - 1) {
        gutter.remove()
        this._gutters.delete(pid)
      }
    }

    let cursor: Node | null = root.firstChild
    pages.forEach((page, i) => {
      const slot = this._ensureSlot(page)
      slot.dashboardId = page.dashboardId

      if (slot.heightPx !== page.heightPx) {
        slot.heightPx = page.heightPx
        slot.wrap.style.height = `${page.heightPx}px`
      }

      slot.dockView.setDock(page.dock)
      slot.dockView.setTiles(page.tiles)

      if (cursor !== slot.wrap) {
        root.insertBefore(slot.wrap, cursor)
      }
      cursor = slot.wrap.nextSibling

      if (i < pages.length - 1) {
        const gutter = this._ensureGutter(page.pageId, slot)
        if (cursor !== gutter) {
          root.insertBefore(gutter, cursor)
        }
        cursor = gutter.nextSibling
      }
    })
  }

  private _ensureSlot(page: PageEntry): PageSlot {
    let slot = this._slots.get(page.pageId)
    if (slot) return slot

    const wrap = document.createElement('div')
    wrap.className = 'sb-page'
    wrap.dataset.pageId = page.pageId
    wrap.dataset.dashboardId = page.dashboardId
    wrap.style.cssText = `position:relative;width:100%;height:${page.heightPx}px;overflow:hidden;flex-shrink:0`

    const dockView = document.createElement('sb-dock-view') as DockView
    dockView.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%'
    dockView.externalDock = page.dock
    dockView.externalTiles = page.tiles
    wrap.appendChild(dockView)

    const onDockChange = (e: Event) => {
      const cur = this._slots.get(page.pageId)
      if (!cur) return
      const detail = (e as CustomEvent).detail as DockNode
      this._callbacks?.onDockChange(cur.dashboardId, detail)
    }
    const onDockAddTile = (e: Event) => {
      const cur = this._slots.get(page.pageId)
      if (!cur) return
      const { groupId, x, y } = (e as CustomEvent).detail
      this._callbacks?.onDockAddTile(cur.dashboardId, groupId, x, y)
    }
    dockView.addEventListener('dockchange', onDockChange)
    dockView.addEventListener('dockaddtile', onDockAddTile)

    slot = {
      wrap,
      dockView,
      dashboardId: page.dashboardId,
      heightPx: page.heightPx,
      onDockChange,
      onDockAddTile,
    }
    this._slots.set(page.pageId, slot)
    return slot
  }

  private _ensureGutter(pageIdAbove: string, slotAbove: PageSlot): HTMLElement {
    let gutter = this._gutters.get(pageIdAbove)
    if (gutter) return gutter

    gutter = document.createElement('div')
    gutter.className = 'sb-page-gutter'
    gutter.dataset.pageAbove = pageIdAbove
    gutter.setAttribute('role', 'separator')
    gutter.setAttribute('aria-orientation', 'horizontal')
    gutter.title = 'Drag to resize page above'

    const handle = document.createElement('div')
    handle.className = 'sb-page-gutter-handle'
    gutter.appendChild(handle)

    this._wireGutterDrag(gutter, pageIdAbove, slotAbove)
    this._gutters.set(pageIdAbove, gutter)
    return gutter
  }

  private _wireGutterDrag(gutter: HTMLElement, pageIdAbove: string, _slotAbove: PageSlot) {
    let startY = 0
    let startHeight = 0
    let pointerId: number | null = null
    let liveSlot: PageSlot | null = null

    const onMove = (e: PointerEvent) => {
      if (pointerId == null || e.pointerId !== pointerId || !liveSlot) return
      const dy = e.clientY - startY
      const next = Math.max(MIN_PAGE_HEIGHT_PX, Math.round(startHeight + dy))
      liveSlot.heightPx = next
      liveSlot.wrap.style.height = `${next}px`
    }
    const onUp = (e: PointerEvent) => {
      if (pointerId == null || e.pointerId !== pointerId) return
      const finalHeight = liveSlot?.heightPx ?? startHeight
      try { gutter.releasePointerCapture(pointerId) } catch { /* ignore */ }
      pointerId = null
      liveSlot = null
      gutter.classList.remove('dragging')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      this._callbacks?.onPageResize(pageIdAbove, finalHeight)
    }

    gutter.addEventListener('pointerdown', (e) => {
      // Only primary button.
      if (e.button !== 0) return
      const slot = this._slots.get(pageIdAbove)
      if (!slot) return
      e.preventDefault()
      pointerId = e.pointerId
      startY = e.clientY
      startHeight = slot.heightPx
      liveSlot = slot
      gutter.classList.add('dragging')
      try { gutter.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    })
  }
}

// Ensure the underlying DockView custom element is registered before we register
// ourselves — the side-effect import at the bottom of DockView.ts handles that.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
void DockView

if (!customElements.get('sb-page-stack-view')) {
  customElements.define('sb-page-stack-view', PageStackView)
}
