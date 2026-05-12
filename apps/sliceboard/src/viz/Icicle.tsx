import { useEffect } from 'react'
import * as d3 from 'd3'
import type { PNode } from '../persistence'
import { nodeColor, motion, explodePulse, buildVizTree, useDimensions } from './util'

type Node = d3.HierarchyRectangularNode<{ id: string }>
type CellEl = SVGGElement & { __layout?: CellLayout }
type CellLayout = { x: number; y: number; w: number; h: number }

interface Props {
  nodes: PNode[]
  measureKey: string
  hoverId: string | null
  selectionId: string | null
  focusId: string
  depth?: number
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  onFocus: (id: string) => void
}

export function Icicle({ nodes, measureKey, hoverId, selectionId, focusId, depth = 2, onHover, onSelect, onFocus }: Props) {
  const [ref, w, h] = useDimensions()
  const move = motion('move')

  useEffect(() => {
    if (!ref.current || w === 0 || h === 0) return
    const svg = d3.select(ref.current)
    svg.attr('viewBox', `0 0 ${w} ${h}`)

    const tree = buildVizTree(nodes)
    if (!tree) { svg.selectAll('*').remove(); return }

    const root = d3.hierarchy(tree)
      .sum(d => nodes.find(n => n.id === d.id)?.measurements[measureKey] ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

    d3.partition<{ id: string }>().size([h, w])(root as d3.HierarchyNode<{ id: string }>)

    let focus = (root as Node).descendants().find(d => d.data.id === focusId) as Node | undefined
    if (!focus) focus = root as Node
    const f = focus

    const maxDepth = f.depth + depth
    const all = (root as Node).descendants().filter(d => d.data.id !== '__root__' && d.depth <= maxDepth) as Node[]

    const layoutOf = (d: Node): CellLayout => {
      const x = d.y0 - f.y0
      const y = ((d.x0 - f.x0) / Math.max(1, f.x1 - f.x0)) * h
      const yE = ((d.x1 - f.x0) / Math.max(1, f.x1 - f.x0)) * h
      return { x, y, w: Math.max(0, d.y1 - d.y0 - 1), h: Math.max(0, yE - y - 1) }
    }

    const sel = svg.selectAll<CellEl, Node>('g.cell').data(all, d => d.data.id)
    const enter = sel.enter().append<SVGGElement>('g').attr('class', 'cell')
      .each(function(this: CellEl, d) { this.__layout = layoutOf(d) })
    enter.append('rect')
    enter.append('text')

    const merged = enter.merge(sel)
      .attr('cursor', 'pointer')
      .on('pointerenter', (_e, d) => onHover(d.data.id))
      .on('pointerleave', () => onHover(null))
      .on('click', (e, d) => {
        e.stopPropagation()
        onSelect(d.data.id)
        if (d.data.id === focusId) onFocus(d.parent?.data.id ?? '__root__')
        else if (d.children) onFocus(d.data.id)
      })

    merged.select<SVGRectElement>('rect').attr('fill', d => nodeColor(nodes, d.data.id))

    const explodeMin = move.explodeMin
    merged.transition('layout').duration(move.duration).ease(move.ease)
      .tween('layout', function(this: CellEl, d) {
        const start = this.__layout ?? layoutOf(d)
        const end = layoutOf(d)
        const interp = d3.interpolateObject(start, end) as (t: number) => CellLayout
        const g = d3.select(this)
        const rect = g.select<SVGRectElement>('rect')
        return (t: number) => {
          const cur = interp(t)
          this.__layout = cur
          rect.attr('x', 0).attr('y', 0).attr('width', cur.w).attr('height', cur.h)
          const s = 1 - explodePulse(t) * (1 - explodeMin)
          const ox = cur.x + cur.w * 0.5 * (1 - s)
          const oy = cur.y + cur.h * 0.5 * (1 - s)
          g.attr('transform', s === 1 ? `translate(${cur.x},${cur.y})` : `translate(${ox},${oy}) scale(${s})`)
        }
      })

    merged.select<SVGTextElement>('text')
      .attr('x', 6).attr('y', 14)
      .attr('fill', 'oklch(0.18 0.01 250)').attr('font-size', 11).attr('font-weight', 500)
      .attr('pointer-events', 'none')
      .text(d => {
        const L = layoutOf(d)
        if (L.w < 36 || L.h < 16) return ''
        const name = nodes.find(n => n.id === d.data.id)?.name ?? ''
        const max = Math.max(1, Math.floor((L.w - 12) / 6))
        return name.length > max ? name.slice(0, max) + '…' : name
      })

    sel.exit().remove()

    svg.selectAll('rect.icicle-bg').data([null]).join('rect')
      .attr('class', 'icicle-bg').attr('x', 0).attr('y', 0).attr('width', w).attr('height', h)
      .attr('fill', 'transparent').lower().on('click', () => onFocus('__root__'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, measureKey, focusId, depth, w, h])

  useEffect(() => {
    if (!ref.current) return
    d3.select(ref.current).selectAll<SVGGElement, Node>('g.cell').each(function(d) {
      const isHover = hoverId === d.data.id
      const isSel = selectionId === d.data.id
      d3.select(this).select<SVGRectElement>('rect')
        .attr('opacity', isHover || isSel ? 1 : 0.78)
        .attr('stroke', isSel ? 'var(--pv-ink)' : isHover ? 'var(--pv-ink-muted)' : 'transparent')
        .attr('stroke-width', 1.5)
    })
  }, [hoverId, selectionId])

  return <svg ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}
