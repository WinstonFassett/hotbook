// Dockview-class layout renderer. Phase A of WIN-57.
//
// Renders a DockNode tree:
//   - DockSplit  → flex row/col with draggable gutters between children.
//   - DockGroup  → tab strip + active panel body.
// Plus drag-and-drop with five drop zones per group (left/right/up/down
// edges split, center adds to tab list). See docs/dockview-spec.md.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { DockNode, DockGroup, DockSplit, DockEdge } from './dock'

export interface RenderPanelArgs {
  tileId: string
  groupId: string
  panelId: string
  isActive: boolean
}

export interface DragState {
  panelId: string
  tileId: string
  /** Cursor position in viewport coords (pageX/Y). */
  x: number
  y: number
  /** Tile label / tab title to render in the floating ghost. */
  label: string
  /** Where, if anywhere, the cursor is currently hovering — used to render
   *  the live drop indicator. */
  over: DropTarget | null
}

export type DropTarget =
  | { kind: 'edge'; groupId: string; edge: DockEdge }
  | { kind: 'tab'; groupId: string; index: number }

export interface DropEvent {
  panelId: string
  target: DropTarget
}

export function DockView({
  node,
  renderPanel,
  panelLabel,
  onResize,
  onActivate,
  onClosePanel,
  onAddPanel,
  onUnsplit,
  onDrop,
}: {
  node: DockNode
  renderPanel: (args: RenderPanelArgs) => ReactNode
  panelLabel: (tileId: string) => string
  onResize: (splitId: string, sizes: number[]) => void
  onActivate: (groupId: string, panelId: string) => void
  onClosePanel: (groupId: string, panelId: string) => void
  onAddPanel: (groupId: string) => void
  onUnsplit: (splitId: string) => void
  onDrop: (ev: DropEvent) => void
}) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // The drag state is held both in React state (for rendering the ghost +
  // overlay indicators) and a ref (for stable access from window listeners
  // that must NOT be torn down on every pointermove).
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop

  const beginDrag = useCallback((s: Omit<DragState, 'over'>) => {
    const initial: DragState = { ...s, over: null }
    setDrag(initial)
    dragRef.current = initial

    const onMove = (ev: PointerEvent) => {
      const over = hitTest(rootRef.current, ev.clientX, ev.clientY)
      const next = { ...(dragRef.current ?? initial), x: ev.clientX, y: ev.clientY, over }
      dragRef.current = next
      setDrag(next)
    }
    const onUp = (ev: PointerEvent) => {
      const over = hitTest(rootRef.current, ev.clientX, ev.clientY)
      const cur = dragRef.current
      cleanup()
      if (cur && over) onDropRef.current({ panelId: cur.panelId, target: over })
      setDrag(null)
      dragRef.current = null
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      cleanup()
      setDrag(null)
      dragRef.current = null
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
  }, [])

  const ctx = {
    renderPanel, panelLabel, onResize, onActivate, onClosePanel, onAddPanel, onUnsplit,
    drag, beginDrag,
  }

  return (
    <div ref={rootRef} className="dv-root">
      <DockNodeView node={node} ctx={ctx} />
      {drag && createPortal(<DragGhost drag={drag} />, document.body)}
    </div>
  )
}

interface RenderCtx {
  renderPanel: (args: RenderPanelArgs) => ReactNode
  panelLabel: (tileId: string) => string
  onResize: (splitId: string, sizes: number[]) => void
  onActivate: (groupId: string, panelId: string) => void
  onClosePanel: (groupId: string, panelId: string) => void
  onAddPanel: (groupId: string) => void
  onUnsplit: (splitId: string) => void
  drag: DragState | null
  beginDrag: (s: Omit<DragState, 'over'>) => void
}

function DockNodeView({ node, ctx }: { node: DockNode; ctx: RenderCtx }) {
  if (node.kind === 'group') return <GroupView group={node} ctx={ctx} />
  return <SplitBranchView branch={node} ctx={ctx} />
}

function SplitBranchView({ branch, ctx }: { branch: DockSplit; ctx: RenderCtx }) {
  const ref = useRef<HTMLDivElement>(null)
  const totalWeight = branch.sizes.reduce((a, b) => a + b, 0) || 1
  const flexDir = branch.direction === 'row' ? 'row' : 'column'

  const startDrag = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (!ref.current) return
    e.preventDefault()
    const rect = ref.current.getBoundingClientRect()
    const horiz = branch.direction === 'row'
    const totalPx = horiz ? rect.width : rect.height
    if (totalPx <= 0) return
    const startSizes = branch.sizes.slice()
    const sumPair = (startSizes[index] ?? 1) + (startSizes[index + 1] ?? 1)
    const startCoord = horiz ? e.clientX : e.clientY
    const pairPx = totalPx * (sumPair / startSizes.reduce((a, b) => a + b, 0))

    const onMove = (ev: PointerEvent) => {
      const cur = horiz ? ev.clientX : ev.clientY
      const dPx = cur - startCoord
      const minPx = 24
      const leftPx = clamp((startSizes[index]! / sumPair) * pairPx + dPx, minPx, pairPx - minPx)
      const rightPx = pairPx - leftPx
      const next = startSizes.slice()
      next[index] = (leftPx / pairPx) * sumPair
      next[index + 1] = (rightPx / pairPx) * sumPair
      ctx.onResize(branch.id, next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div ref={ref} className={`dv-branch dv-branch--${branch.direction}`} style={{ flexDirection: flexDir }} data-split-id={branch.id}>
      {branch.children.flatMap((child, i) => {
        const cell = (
          <div key={child.id} className="dv-cell" style={{ flexGrow: (branch.sizes[i] ?? 1) / totalWeight, flexBasis: 0 }}>
            <DockNodeView node={child} ctx={ctx} />
          </div>
        )
        if (i === branch.children.length - 1) return [cell]
        const gutter = (
          <div
            key={`g-${child.id}`}
            className={`dv-gutter dv-gutter--${branch.direction}`}
            onPointerDown={(e) => startDrag(i, e)}
            role="separator"
            aria-orientation={branch.direction === 'row' ? 'vertical' : 'horizontal'}
            title="Drag to resize"
          />
        )
        return [cell, gutter]
      })}
    </div>
  )
}

function GroupView({ group, ctx }: { group: DockGroup; ctx: RenderCtx }) {
  const active = group.panels.find(p => p.id === group.activeId) ?? group.panels[0]
  const overlay = ctx.drag?.over
  const showEdge = overlay && overlay.kind === 'edge' && overlay.groupId === group.id ? overlay.edge : null
  const showCenter = overlay && overlay.kind === 'tab' && overlay.groupId === group.id

  return (
    <div className="dv-group" data-group-id={group.id}>
      <TabStrip group={group} ctx={ctx} />
      <div className="dv-body" data-group-id={group.id} data-dropzone="edges">
        {active && (
          <div className="dv-panel">
            {ctx.renderPanel({
              tileId: active.tileId,
              groupId: group.id,
              panelId: active.id,
              isActive: true,
            })}
          </div>
        )}
        {showEdge && <div className={`dv-drop-indicator dv-drop-indicator--${showEdge}`} />}
        {showCenter && <div className="dv-drop-indicator dv-drop-indicator--center" />}
      </div>
    </div>
  )
}

function TabStrip({ group, ctx }: { group: DockGroup; ctx: RenderCtx }) {
  const stripRef = useRef<HTMLDivElement>(null)
  // Wheel-to-scroll horizontally on the strip — many input devices only emit
  // vertical deltas, and a horizontal-only strip needs them.
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0 || el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div className="dv-tabstrip">
      <div ref={stripRef} className="dv-tabs" data-group-id={group.id} data-dropzone="tabs">
        {group.panels.map((p, i) => (
          <Tab key={p.id} group={group} panel={p} index={i} ctx={ctx} />
        ))}
      </div>
      <div className="dv-tabstrip-actions">
        <button
          className="dv-tab-add"
          onClick={() => ctx.onAddPanel(group.id)}
          title="Add panel to this group"
          aria-label="Add panel"
        >+</button>
        {/* The Unsplit affordance lives on the closest enclosing Split — we
            don't know it here. Surfaced via a header context-menu in a
            follow-up; for Phase A, drag-to-merge already covers it. */}
      </div>
    </div>
  )
}

function Tab({
  group, panel, index, ctx,
}: {
  group: DockGroup
  panel: DockGroup['panels'][number]
  index: number
  ctx: RenderCtx
}) {
  const isActive = panel.id === group.activeId
  const onPointerDown = (e: React.PointerEvent) => {
    // Left button only. Don't start a drag from the close button.
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.dv-tab-close')) return
    ctx.onActivate(group.id, panel.id)
    // Only the active tab becomes draggable mid-press — pick a small move
    // threshold to disambiguate from click-to-activate.
    const startX = e.clientX
    const startY = e.clientY
    const label = ctx.panelLabel(panel.tileId)
    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      ctx.beginDrag({ panelId: panel.id, tileId: panel.tileId, x: ev.clientX, y: ev.clientY, label })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault()
      ctx.onClosePanel(group.id, panel.id)
    }
  }
  return (
    <div
      className={`dv-tab${isActive ? ' dv-tab--active' : ''}`}
      data-tab-index={index}
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
      title={ctx.panelLabel(panel.tileId)}
    >
      <span className="dv-tab-label">{ctx.panelLabel(panel.tileId)}</span>
      <button
        className="dv-tab-close"
        onClick={(e) => { e.stopPropagation(); ctx.onClosePanel(group.id, panel.id) }}
        title="Close panel"
        aria-label="Close panel"
      >×</button>
    </div>
  )
}

/** The floating drag ghost — VS Code-style label tile that tracks the cursor.
 *  Rendered into document.body so split/group overflow rules don't clip it. */
function DragGhost({ drag }: { drag: DragState }) {
  return (
    <div
      className="dv-drag-ghost"
      style={{ left: drag.x + 12, top: drag.y + 12 }}
    >
      {drag.label}
    </div>
  )
}

// ─── Hit testing ──────────────────────────────────────────────────────────────

/** Compute the current drop target given the live cursor position. Reads from
 *  the DOM: groups carry data-group-id; tab strips carry data-dropzone=tabs;
 *  bodies carry data-dropzone=edges.
 *
 *  Returns:
 *    { kind: 'tab', groupId, index }    when hovering on a tab strip
 *    { kind: 'edge', groupId, edge }    when hovering on a group body — edge
 *                                       comes from the 25%/50%/25% rule
 *    null                               otherwise
 */
function hitTest(root: HTMLElement | null, clientX: number, clientY: number): DropTarget | null {
  if (!root) return null
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
  if (!el || !root.contains(el)) return null

  // Tabs strip — find the tab at the cursor, or "end of strip"
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

  // Group body — use the 25/50/25 split. Top/bottom win over left/right at
  // corners, matching VS Code.
  const bodyEl = el.closest('[data-dropzone="edges"]') as HTMLElement | null
  if (bodyEl) {
    const groupId = bodyEl.getAttribute('data-group-id')!
    const r = bodyEl.getBoundingClientRect()
    const xFrac = (clientX - r.left) / r.width
    const yFrac = (clientY - r.top) / r.height
    const inTopBand = yFrac < 0.25
    const inBottomBand = yFrac > 0.75
    const inLeftBand = xFrac < 0.25
    const inRightBand = xFrac > 0.75
    if (inTopBand) return { kind: 'edge', groupId, edge: 'up' }
    if (inBottomBand) return { kind: 'edge', groupId, edge: 'down' }
    if (inLeftBand) return { kind: 'edge', groupId, edge: 'left' }
    if (inRightBand) return { kind: 'edge', groupId, edge: 'right' }
    return { kind: 'tab', groupId, index: -1 } // center → append as last tab
  }

  return null
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}
