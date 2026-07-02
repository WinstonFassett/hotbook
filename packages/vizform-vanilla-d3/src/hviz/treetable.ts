import type { PNode } from '../types'
import { nodeColor, rollupMeasurement, childrenOf } from './pnodeUtils'

export interface TreetableOptions {
  /** Enable smooth transitions for expand/collapse and value changes. Default: true */
  enableTransitions?: boolean
}

export interface TreetableMounted {
  update(nodes: PNode[], measureKey: string): void
  destroy(): void
  /**
   * Returns the live root element, so a higher-level adapter can query
   * `[data-leaf-value="<id>"]` cells and attach number-drag (or any other
   * cell-level behavior) without re-traversing the data.
   */
  getRoot(): HTMLElement
  /**
   * Subscribe to render events. Fired after every render(); listener receives
   * the set of leaf node ids that currently have visible value cells. Used by
   * the React wrapper to re-attach number-drag on each update.
   */
  onRender(listener: (leafIds: string[]) => void): () => void
  /**
   * Update transition settings at runtime
   */
  setTransitionsEnabled(enabled: boolean): void
}

interface VisibleRow {
  node: PNode
  depth: number
  hasKids: boolean
}

/** Check if user prefers reduced motion */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Compose CSS transition string for treetable animations */
function buildTransition(enabled: boolean): string {
  if (!enabled || prefersReducedMotion()) return 'none'
  // Smooth transitions for opacity and transform (expand/collapse)
  // Duration: ~250ms matches vizform settle timing
  return 'opacity 250ms cubic-bezier(0.4, 0.0, 0.2, 1), transform 250ms cubic-bezier(0.4, 0.0, 0.2, 1), background 80ms'
}

/** Compose CSS transition for value cells */
function buildValueTransition(enabled: boolean): string {
  if (!enabled || prefersReducedMotion()) return 'none'
  return 'color 250ms cubic-bezier(0.4, 0.0, 0.2, 1)'
}

function fmtNum(v: number): string {
  if (v === 0) return ''
  if (v < 10) return v.toFixed(1)
  return Math.round(v).toString()
}

function computeVisible(nodes: PNode[], collapsed: Set<string>): VisibleRow[] {
  const out: VisibleRow[] = []

  function walk(parentId: string | null, depth: number) {
    const kids = childrenOf(nodes, parentId)
    for (const n of kids) {
      const hasKids = childrenOf(nodes, n.id).length > 0
      out.push({ node: n, depth, hasKids })
      if (hasKids && !collapsed.has(n.id)) walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export function mountTreetable(
  containerEl: HTMLElement,
  nodes: PNode[],
  measureKey: string,
  options: TreetableOptions = {},
): TreetableMounted {
  let currentNodes = nodes
  let currentMeasureKey = measureKey
  const collapsed = new Set<string>()
  let transitionsEnabled = options.enableTransitions ?? true

  const root = document.createElement('div')
  root.className = 'htt-root'
  root.style.cssText = 'width:100%;height:100%;overflow-y:auto;font-size:12px;font-family:inherit;'

  const head = document.createElement('div')
  head.className = 'htt-head'
  head.style.cssText = 'display:flex;align-items:center;padding:4px 8px;border-bottom:1px solid oklch(0.25 0 0);position:sticky;top:0;background:oklch(0.14 0 0);z-index:1;'
  head.innerHTML = `
    <div style="flex:1;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;">Name</div>
    <div style="width:52px;text-align:right;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;">Value</div>
  `
  root.appendChild(head)

  const body = document.createElement('div')
  body.className = 'htt-body'
  root.appendChild(body)
  containerEl.appendChild(root)

  const renderListeners = new Set<(leafIds: string[]) => void>()

  function render() {
    const visible = computeVisible(currentNodes, collapsed)
    const leafIds: string[] = []

    // Keyed update: map existing rows by node id
    const existing = new Map<string, HTMLElement>()
    for (const el of Array.from(body.children) as HTMLElement[]) {
      const id = el.dataset.id
      if (id) existing.set(id, el)
    }

    const fragment = document.createDocumentFragment()
    const newRows: HTMLElement[] = []

    for (const { node, depth, hasKids } of visible) {
      let row = existing.get(node.id)
      const isNewRow = !row
      existing.delete(node.id)

      if (!row) {
        row = document.createElement('div')
        row.dataset.id = node.id
        const baseTransition = buildTransition(transitionsEnabled)
        row.style.cssText = `display:flex;align-items:center;padding:3px 8px;cursor:default;transition:${baseTransition};`
        row.addEventListener('mouseenter', () => { row!.style.background = 'oklch(0.22 0 0)' })
        row.addEventListener('mouseleave', () => { row!.style.background = '' })

        // Start with collapsed state for enter animation
        if (transitionsEnabled && !prefersReducedMotion()) {
          row.style.opacity = '0'
          row.style.transform = 'translateX(-8px)'
        }
      }

      const color = nodeColor(currentNodes, node.id)
      const value = rollupMeasurement(currentNodes, node.id, currentMeasureKey, 'sum')
      const isCollapsed = collapsed.has(node.id)

      row.innerHTML = `
        <div style="flex:1;display:flex;align-items:center;gap:4px;padding-left:${depth * 14}px;min-width:0;">
          ${hasKids
            ? `<button data-twist="${node.id}" style="all:unset;cursor:pointer;width:14px;text-align:center;color:oklch(0.5 0 0);font-size:10px;flex-shrink:0;">${isCollapsed ? '▸' : '▾'}</button>`
            : `<span style="width:14px;flex-shrink:0;"></span>`
          }
          <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:oklch(0.88 0 0);">${node.name}</span>
          ${Object.entries(node.dims ?? {}).map(([, v]) => `<span style="font-size:10px;color:oklch(0.4 0 0);flex-shrink:0;">${v}</span>`).join('')}
        </div>
        <div data-value-cell="${node.id}" ${!hasKids ? `data-leaf-value="${node.id}"` : ''} style="width:52px;text-align:right;color:oklch(0.7 0 0);font-variant-numeric:tabular-nums;transition:${buildValueTransition(transitionsEnabled)};${!hasKids ? 'cursor:ew-resize;touch-action:none;' : ''}">${fmtNum(value)}</div>
      `

      if (hasKids) {
        const btn = row.querySelector<HTMLElement>(`[data-twist="${node.id}"]`)
        btn?.addEventListener('click', (e) => {
          e.stopPropagation()
          if (collapsed.has(node.id)) collapsed.delete(node.id)
          else collapsed.add(node.id)
          render()
        })
      }

      if (!hasKids) leafIds.push(node.id)

      if (isNewRow) {
        newRows.push(row)
      }

      fragment.appendChild(row)
    }

    // Animate out stale rows before removing
    if (transitionsEnabled && !prefersReducedMotion() && existing.size > 0) {
      for (const el of existing.values()) {
        el.style.opacity = '0'
        el.style.transform = 'translateX(-8px)'
      }
      // Wait for exit animation to complete before removing
      setTimeout(() => {
        for (const el of existing.values()) {
          if (el.parentNode) el.remove()
        }
      }, 250)
    } else {
      // Immediate removal if transitions disabled
      for (const el of existing.values()) el.remove()
    }

    body.appendChild(fragment)

    // Trigger enter animations for new rows
    if (transitionsEnabled && !prefersReducedMotion() && newRows.length > 0) {
      // Force reflow to ensure the initial state is applied
      newRows.forEach(row => row.offsetHeight)

      // Use requestAnimationFrame to ensure the transition runs
      requestAnimationFrame(() => {
        newRows.forEach(row => {
          row.style.opacity = '1'
          row.style.transform = 'translateX(0)'
        })
      })
    }

    for (const l of renderListeners) l(leafIds)
  }

  render()

  return {
    update(nodes: PNode[], measureKey: string) {
      currentNodes = nodes
      currentMeasureKey = measureKey
      render()
    },
    destroy() {
      containerEl.removeChild(root)
    },
    getRoot() {
      return root
    },
    onRender(listener) {
      renderListeners.add(listener)
      return () => { renderListeners.delete(listener) }
    },
    setTransitionsEnabled(enabled: boolean) {
      transitionsEnabled = enabled
      // Update transition styles on existing rows
      const rows = Array.from(body.children) as HTMLElement[]
      const baseTransition = buildTransition(enabled)
      for (const row of rows) {
        row.style.transition = baseTransition
        const valueCell = row.querySelector('[data-value-cell]') as HTMLElement | null
        if (valueCell) {
          valueCell.style.transition = buildValueTransition(enabled)
        }
      }
    },
  }
}
