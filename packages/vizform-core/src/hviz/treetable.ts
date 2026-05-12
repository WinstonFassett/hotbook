import type { PNode } from '../types'
import { nodeColor, rollupMeasurement, childrenOf } from './pnodeUtils'

export interface TreetableMounted {
  update(nodes: PNode[], measureKey: string): void
  destroy(): void
}

interface VisibleRow {
  node: PNode
  depth: number
  hasKids: boolean
}

const STATUS_COLORS: Record<string, string> = {
  todo: 'oklch(0.5 0 0)',
  doing: 'oklch(0.6 0.18 250)',
  review: 'oklch(0.65 0.18 60)',
  done: 'oklch(0.6 0.18 145)',
  blocked: 'oklch(0.55 0.2 25)',
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
): TreetableMounted {
  let currentNodes = nodes
  let currentMeasureKey = measureKey
  const collapsed = new Set<string>()

  const root = document.createElement('div')
  root.className = 'htt-root'
  root.style.cssText = 'width:100%;height:100%;overflow-y:auto;font-size:12px;font-family:inherit;'

  const head = document.createElement('div')
  head.className = 'htt-head'
  head.style.cssText = 'display:flex;align-items:center;padding:4px 8px;border-bottom:1px solid oklch(0.25 0 0);position:sticky;top:0;background:oklch(0.14 0 0);z-index:1;'
  head.innerHTML = `
    <div style="flex:1;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;">Name</div>
    <div style="width:52px;text-align:center;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;">Status</div>
    <div style="width:52px;text-align:right;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;">Value</div>
  `
  root.appendChild(head)

  const body = document.createElement('div')
  body.className = 'htt-body'
  root.appendChild(body)
  containerEl.appendChild(root)

  function render() {
    const visible = computeVisible(currentNodes, collapsed)

    // Keyed update: map existing rows by node id
    const existing = new Map<string, HTMLElement>()
    for (const el of Array.from(body.children) as HTMLElement[]) {
      const id = el.dataset.id
      if (id) existing.set(id, el)
    }

    const fragment = document.createDocumentFragment()
    for (const { node, depth, hasKids } of visible) {
      let row = existing.get(node.id)
      existing.delete(node.id)

      if (!row) {
        row = document.createElement('div')
        row.dataset.id = node.id
        row.style.cssText = 'display:flex;align-items:center;padding:3px 8px;cursor:default;transition:background 80ms;'
        row.addEventListener('mouseenter', () => { row!.style.background = 'oklch(0.22 0 0)' })
        row.addEventListener('mouseleave', () => { row!.style.background = '' })
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
          <span style="font-size:10px;color:oklch(0.4 0 0);flex-shrink:0;">${node.type}</span>
        </div>
        <div style="width:52px;text-align:center;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${STATUS_COLORS[node.status] ?? 'oklch(0.4 0 0)'};" title="${node.status}"></span>
        </div>
        <div style="width:52px;text-align:right;color:oklch(0.7 0 0);font-variant-numeric:tabular-nums;">${fmtNum(value)}</div>
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

      fragment.appendChild(row)
    }

    // Remove stale rows
    for (const el of existing.values()) el.remove()

    body.appendChild(fragment)
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
  }
}
