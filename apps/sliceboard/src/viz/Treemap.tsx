import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import type { PNode } from '../persistence'
import { nodeColor, motion, buildVizTree } from './util'
import type { MotionSpec } from './util'

const HEADER_H = 30

type Datum = { id: string; children?: Datum[] }
type RNode = d3.HierarchyRectangularNode<Datum>

interface ChartState {
  root: RNode
  x: d3.ScaleLinear<number, number>
  y: d3.ScaleLinear<number, number>
  body: d3.Selection<SVGGElement, unknown, null, undefined>
  header: d3.Selection<SVGGElement, unknown, null, undefined>
  group: d3.Selection<SVGGElement, unknown, null, undefined>
  focus: RNode
  w: number
  h: number
  bodyH: number
}

interface Props {
  nodes: PNode[]
  measureKey: string
  hoverId: string | null
  selectionId: string | null
  focusId: string
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  onFocus: (id: string) => void
}

export function Treemap({ nodes, measureKey, hoverId, selectionId, focusId, onHover, onSelect, onFocus }: Props) {
  const ref = useRef<SVGSVGElement>(null)
  const stateRef = useRef<ChartState | null>(null)
  const move = motion('move')

  useEffect(() => {
    if (!ref.current) return
    const svg = d3.select(ref.current)
    const w = ref.current.clientWidth || 400
    const h = ref.current.clientHeight || 300
    const bodyH = Math.max(1, h - HEADER_H)
    svg.attr('viewBox', `0 0 ${w} ${h}`)

    const tree = buildVizTree(nodes)
    if (!tree) { svg.selectAll('*').remove(); stateRef.current = null; return }

    const rootH = d3.hierarchy<Datum>(tree)
      .sum(d => nodes.find(n => n.id === d.id)?.measurements[measureKey] ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    d3.treemap<Datum>().tile(d3.treemapSquarify).size([w, bodyH]).paddingInner(2).round(true)(rootH)
    const root = rootH as unknown as RNode

    const focus = (root.descendants().find(d => d.data.id === focusId) ?? root) as RNode

    svg.selectAll('*').remove()
    const defs = svg.append('defs')
    defs.append('clipPath').attr('id', 'tm-body-clip')
      .append('rect').attr('x', 0).attr('y', HEADER_H).attr('width', w).attr('height', bodyH)

    const header = svg.append<SVGGElement>('g').attr('class', 'tm-header')
    const body = svg.append<SVGGElement>('g').attr('class', 'tm-body').attr('clip-path', 'url(#tm-body-clip)')

    header.append('rect').attr('class', 'tm-header-bg')
      .attr('x', 0).attr('y', 0).attr('width', w).attr('height', HEADER_H)
      .attr('fill', 'var(--pv-surface)').attr('fill-opacity', 1)
    header.append('text').attr('class', 'tm-header-name')
      .attr('x', 8).attr('y', Math.round(HEADER_H * 0.55))
      .attr('font-size', 11).attr('font-weight', 500).attr('letter-spacing', '0.04em')
      .attr('fill', 'var(--pv-ink-muted)').attr('pointer-events', 'none')
    header.append('text').attr('class', 'tm-header-hint')
      .attr('x', w - 8).attr('y', Math.round(HEADER_H * 0.55))
      .attr('text-anchor', 'end').attr('font-size', 9).attr('letter-spacing', '0.08em')
      .attr('fill', 'var(--pv-ink-dim)').attr('pointer-events', 'none')

    const x = d3.scaleLinear().rangeRound([0, w]).domain([focus.x0, focus.x1])
    const y = d3.scaleLinear().rangeRound([HEADER_H, HEADER_H + bodyH]).domain([focus.y0, focus.y1])
    const group = body.append<SVGGElement>('g').attr('class', 'tm-view')

    const ctx: ChartState = { root, x, y, body, header, group, focus, w, h, bodyH }
    stateRef.current = ctx

    renderView(ctx, focus, nodes, measureKey, onHover, onSelect, onFocus)
    position(ctx, group, focus)
    updateHeader(ctx, focus, nodes)

    header.attr('cursor', focus.depth > 0 ? 'pointer' : 'default')
      .on('click', () => {
        const c = stateRef.current
        if (c && c.focus.depth > 0) onFocus(c.focus.parent?.data.id ?? '__root__')
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, measureKey])

  useEffect(() => {
    const ctx = stateRef.current
    if (!ctx) return
    const next = (ctx.root.descendants().find(d => d.data.id === focusId) ?? ctx.root) as RNode
    if (next === ctx.focus) return
    zoomTo(ctx, next, nodes, measureKey, move, onHover, onSelect, onFocus)
    updateHeader(ctx, next, nodes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  useEffect(() => {
    if (!ref.current) return
    d3.select(ref.current).selectAll<SVGGElement, RNode>('g.tm-view > g.tm-cell').each(function(d) {
      const isHover = hoverId === d.data.id
      const isSel = selectionId === d.data.id
      d3.select(this).select<SVGRectElement>('rect.tm-rect')
        .attr('stroke', isSel ? 'var(--pv-ink)' : isHover ? 'var(--pv-ink-muted)' : 'transparent')
    })
  }, [hoverId, selectionId, focusId, nodes])

  return <svg ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}

function renderView(
  ctx: ChartState, focus: RNode, nodes: PNode[], measureKey: string,
  onHover: (id: string | null) => void, onSelect: (id: string) => void, onFocus: (id: string) => void,
) {
  const items: RNode[] = (focus.children ?? []) as RNode[]
  const fxr = Math.max(1e-9, focus.x1 - focus.x0)
  const fyr = Math.max(1e-9, focus.y1 - focus.y0)
  const dw = (d: RNode) => (d.x1 - d.x0) * (ctx.w / fxr)
  const dh = (d: RNode) => (d.y1 - d.y0) * (ctx.bodyH / fyr)

  const cell = ctx.group.selectAll<SVGGElement, RNode>('g.tm-cell')
    .data(items, d => d.data.id)
    .join(enter => {
      const g = enter.append('g').attr('class', 'tm-cell')
      g.append('rect').attr('class', 'tm-rect')
      g.append('text').attr('class', 'tm-name')
      g.append('text').attr('class', 'tm-val')
      return g
    })
    .attr('cursor', d => d.children ? 'pointer' : 'default')

  cell.on('pointerenter', (_e, d) => onHover(d.data.id))
    .on('pointerleave', () => onHover(null))
    .on('click', (e, d) => {
      e.stopPropagation()
      onSelect(d.data.id)
      if (d.children) onFocus(d.data.id)
    })

  cell.select<SVGRectElement>('rect.tm-rect')
    .attr('fill', d => nodeColor(nodes, d.data.id))
    .attr('fill-opacity', 1).attr('stroke-width', 1.5).attr('stroke', 'transparent')

  cell.select<SVGTextElement>('text.tm-name')
    .attr('x', 8).attr('y', 16).attr('fill', 'oklch(0.18 0.01 250)')
    .attr('font-size', 12).attr('font-weight', 500).attr('pointer-events', 'none')
    .text(d => labelFor(d, nodes, dw(d), dh(d)))

  cell.select<SVGTextElement>('text.tm-val')
    .attr('x', 8).attr('y', 30).attr('fill', 'oklch(0.18 0.01 250)')
    .attr('fill-opacity', 0.6).attr('font-size', 10).attr('pointer-events', 'none')
    .text(d => valueFor(d, nodes, measureKey, dw(d), dh(d)))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function position(ctx: ChartState, sel: d3.Selection<SVGGElement, any, any, any>, _focus: RNode) {
  const { x, y } = ctx
  sel.selectAll<SVGGElement, RNode>('g.tm-cell')
    .attr('transform', d => `translate(${x(d.x0)},${y(d.y0)})`)
    .select<SVGRectElement>('rect.tm-rect')
    .attr('width', d => Math.max(0, x(d.x1) - x(d.x0)))
    .attr('height', d => Math.max(0, y(d.y1) - y(d.y0)))
}

function updateHeader(ctx: ChartState, focus: RNode, nodes: PNode[]) {
  ctx.header.attr('cursor', focus.depth > 0 ? 'pointer' : 'default')
  ctx.header.select('text.tm-header-name').text(headerLabel(focus, nodes))
  ctx.header.select('text.tm-header-hint').text(focus.depth > 0 ? '↑ ZOOM OUT' : '').attr('x', ctx.w - 8)
}

function zoomTo(
  ctx: ChartState, target: RNode, nodes: PNode[], measureKey: string, move: MotionSpec,
  onHover: (id: string | null) => void, onSelect: (id: string) => void, onFocus: (id: string) => void,
) {
  const dir = isDescendant(target, ctx.focus) ? 'in' : 'out'
  const group0 = ctx.group.attr('pointer-events', 'none')
  const group1 = ctx.body.append<SVGGElement>('g').attr('class', 'tm-view')
  if (dir === 'out') group1.lower()
  ctx.group = group1
  renderView(ctx, target, nodes, measureKey, onHover, onSelect, onFocus)
  position(ctx, group1, target)

  ctx.x.domain([target.x0, target.x1])
  ctx.y.domain([target.y0, target.y1])
  ctx.focus = target

  const t = d3.transition().duration(move.duration).ease(move.ease)
  const frozenFocus = ctx.focus
  position(ctx, group0, dir === 'in' ? target : frozenFocus)
  group0.transition(t).remove().attrTween('opacity', () => (t2: number) => String(1 - t2))
  position(ctx, group1, target)
  group1.attr('opacity', 0).transition(t).attrTween('opacity', () => (t2: number) => String(t2))
}

function isDescendant(d: RNode, ancestor: RNode): boolean {
  let cur: RNode | null = d
  while (cur) { if (cur === ancestor) return true; cur = cur.parent as RNode | null }
  return false
}

function headerLabel(focus: RNode, nodes: PNode[]): string {
  if (focus.depth === 0) return 'ALL'
  const path: string[] = []
  let cur: RNode | null = focus
  while (cur && cur.data.id !== '__root__') {
    path.unshift(nodes.find(n => n.id === cur!.data.id)?.name ?? cur!.data.id)
    cur = cur.parent as RNode | null
  }
  return path.join('  ›  ')
}

function labelFor(d: RNode, nodes: PNode[], cw: number, ch: number): string {
  if (cw < 44 || ch < 22) return ''
  const name = nodes.find(n => n.id === d.data.id)?.name ?? ''
  const max = Math.max(2, Math.floor((cw - 16) / 6.5))
  return name.length > max ? name.slice(0, max) + '…' : name
}

function valueFor(d: RNode, nodes: PNode[], measureKey: string, cw: number, ch: number): string {
  if (cw < 56 || ch < 36) return ''
  const n = nodes.find(n => n.id === d.data.id)
  const v = n?.measurements[measureKey] ?? d.value ?? 0
  return `${Math.round(v)}${d.children ? ` · ${d.children.length}` : ''}`
}
