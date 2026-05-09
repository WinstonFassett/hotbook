import * as d3 from 'd3-hierarchy'
import { select } from 'd3-selection'
import { scaleLinear } from 'd3-scale'
import 'd3-transition'
import type { GoalTree, HVizCallbacks } from '../types'

type Datum = GoalTree
type RNode = d3.HierarchyRectangularNode<Datum>

const HEADER_H = 28

interface TreemapState {
  root: RNode
  x: ReturnType<typeof scaleLinear>
  y: ReturnType<typeof scaleLinear>
  body: ReturnType<typeof select<SVGGElement, unknown>>
  header: ReturnType<typeof select<SVGGElement, unknown>>
  group: ReturnType<typeof select<SVGGElement, unknown>>
  focus: RNode
  w: number
  bodyH: number
}

function buildColorMap(tree: GoalTree): Map<string, string> {
  const m = new Map<string, string>()
  function walk(n: GoalTree) { m.set(n.id, n.color); n.children?.forEach(walk) }
  walk(tree)
  return m
}

function buildNameMap(tree: GoalTree): Map<string, string> {
  const m = new Map<string, string>()
  function walk(n: GoalTree) { m.set(n.id, n.name); n.children?.forEach(walk) }
  walk(tree)
  return m
}

export interface TreemapMounted {
  update(tree: GoalTree): void
  destroy(): void
}

export function mountTreemap(svgEl: SVGSVGElement, initialTree: GoalTree, callbacks: HVizCallbacks): TreemapMounted {
  let currentTree = initialTree
  let focusId = '__root__'
  let state: TreemapState | null = null

  function buildRoot(tree: GoalTree, w: number, bodyH: number): RNode {
    const root = d3.hierarchy<Datum>(tree)
      .sum(d => (d.children ? 0 : d.value))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    d3.treemap<Datum>()
      .tile(d3.treemapSquarify)
      .size([w, bodyH])
      .paddingInner(2)
      .round(true)(root)
    return root as RNode
  }

  function renderCells(
    group: ReturnType<typeof select<SVGGElement, unknown>>,
    focus: RNode,
    x: ReturnType<typeof scaleLinear>,
    y: ReturnType<typeof scaleLinear>,
    w: number,
    bodyH: number,
    colorMap: Map<string, string>,
    nameMap: Map<string, string>,
  ) {
    const fxr = Math.max(1e-9, focus.x1 - focus.x0)
    const fyr = Math.max(1e-9, focus.y1 - focus.y0)
    const dW = (d: RNode) => (d.x1 - d.x0) * (w / fxr)
    const dH = (d: RNode) => (d.y1 - d.y0) * (bodyH / fyr)

    const items = (focus.children ?? []) as RNode[]
    const cell = group
      .selectAll<SVGGElement, RNode>('g.tm-cell')
      .data(items, d => d.data.id)
      .join(e => {
        const g = e.append('g').attr('class', 'tm-cell')
        g.append('rect').attr('class', 'tm-rect')
        g.append('text').attr('class', 'tm-name')
        g.append('text').attr('class', 'tm-val')
        return g
      })
      .attr('cursor', d => d.children ? 'pointer' : 'default')

    cell.on('click', (e, d) => {
      e.stopPropagation()
      if (d.children) { focusId = d.data.id; zoom() }
      else callbacks.onLeafClick?.(d.data.id)
    })

    cell.select<SVGRectElement>('rect.tm-rect')
      .attr('fill', d => colorMap.get(d.data.id) ?? '#555')
      .attr('stroke-width', 1.5).attr('stroke', 'transparent')

    cell.select<SVGTextElement>('text.tm-name')
      .attr('x', 8).attr('y', 16)
      .attr('fill', 'oklch(0.18 0.01 250)')
      .attr('font-size', 12).attr('font-weight', 500)
      .attr('pointer-events', 'none')
      .text(d => {
        const cw = dW(d); const ch = dH(d)
        if (cw < 44 || ch < 22) return ''
        const name = nameMap.get(d.data.id) ?? ''
        const max = Math.max(2, Math.floor((cw - 16) / 6.5))
        return name.length > max ? name.slice(0, max) + '…' : name
      })

    cell.select<SVGTextElement>('text.tm-val')
      .attr('x', 8).attr('y', 30)
      .attr('fill', 'oklch(0.18 0.01 250)')
      .attr('fill-opacity', 0.6).attr('font-size', 10)
      .attr('pointer-events', 'none')
      .text(d => {
        const cw = dW(d); const ch = dH(d)
        if (cw < 56 || ch < 36) return ''
        const v = d.value ?? 0
        return `${Math.round(v)}${d.children ? ` · ${d.children.length}` : ''}`
      })

    positionCells(group, x, y)
  }

  function positionCells(
    grp: ReturnType<typeof select<SVGGElement, unknown>>,
    x: ReturnType<typeof scaleLinear>,
    y: ReturnType<typeof scaleLinear>,
  ) {
    grp.selectAll<SVGGElement, RNode>('g.tm-cell')
      .attr('transform', d => `translate(${x(d.x0)},${y(d.y0)})`)
      .select<SVGRectElement>('rect.tm-rect')
      .attr('width', d => Math.max(0, (x(d.x1) as number) - (x(d.x0) as number)))
      .attr('height', d => Math.max(0, (y(d.y1) as number) - (y(d.y0) as number)))
  }

  function updateHeader(
    header: ReturnType<typeof select<SVGGElement, unknown>>,
    focus: RNode,
    w: number,
    nameMap: Map<string, string>,
  ) {
    header.attr('cursor', focus.depth > 0 ? 'pointer' : 'default')
    const path: string[] = []
    let cur: RNode | null = focus
    while (cur && cur.data.id !== '__root__') {
      path.unshift(nameMap.get(cur.data.id) ?? cur.data.id)
      cur = cur.parent as RNode | null
    }
    header.select('text.tm-header-name').text(path.length ? path.join(' › ') : 'ALL')
    header.select('text.tm-header-hint').text(focus.depth > 0 ? '↑ ZOOM OUT' : '')
    header.select('text.tm-header-hint').attr('x', w - 8)
  }

  function zoom() {
    const ctx = state
    if (!ctx) return
    const colorMap = buildColorMap(currentTree)
    const nameMap = buildNameMap(currentTree)
    const next = (ctx.root.descendants().find(d => d.data.id === focusId) ?? ctx.root) as RNode
    if (next === ctx.focus) return
    ctx.x.domain([next.x0, next.x1])
    ctx.y.domain([next.y0, next.y1])
    ctx.focus = next
    ctx.group.remove()
    ctx.group = ctx.body.append<SVGGElement>('g').attr('class', 'tm-view') as ReturnType<typeof select<SVGGElement, unknown>>
    renderCells(ctx.group, next, ctx.x, ctx.y, ctx.w, ctx.bodyH, colorMap, nameMap)
    updateHeader(ctx.header, next, ctx.w, nameMap)
  }

  function initTree(tree: GoalTree) {
    currentTree = tree
    focusId = '__root__'
    const svg = select(svgEl)
    const w = svgEl.clientWidth || 400
    const h = svgEl.clientHeight || 300
    const bodyH = Math.max(1, h - HEADER_H)
    svg.attr('viewBox', `0 0 ${w} ${h}`)

    const colorMap = buildColorMap(tree)
    const nameMap = buildNameMap(tree)
    const root = buildRoot(tree, w, bodyH)
    const focus = (root.descendants().find(d => d.data.id === focusId) ?? root) as RNode

    svg.selectAll('*').remove()
    const defs = svg.append('defs')
    defs.append('clipPath').attr('id', 'htm-body-clip')
      .append('rect').attr('x', 0).attr('y', HEADER_H).attr('width', w).attr('height', bodyH)

    const header = svg.append<SVGGElement>('g').attr('class', 'tm-header')
    const body = svg.append<SVGGElement>('g')
      .attr('class', 'tm-body')
      .attr('clip-path', 'url(#htm-body-clip)')

    header.append('rect').attr('class', 'tm-header-bg')
      .attr('x', 0).attr('y', 0).attr('width', w).attr('height', HEADER_H)
      .attr('fill', 'oklch(0.16 0 0)').attr('fill-opacity', 1)
    header.append('text').attr('class', 'tm-header-name')
      .attr('x', 8).attr('y', Math.round(HEADER_H * 0.65))
      .attr('font-size', 11).attr('font-weight', 500).attr('letter-spacing', '0.04em')
      .attr('fill', 'oklch(0.6 0 0)').attr('pointer-events', 'none')
    header.append('text').attr('class', 'tm-header-hint')
      .attr('x', w - 8).attr('y', Math.round(HEADER_H * 0.65))
      .attr('text-anchor', 'end').attr('font-size', 9).attr('letter-spacing', '0.08em')
      .attr('fill', 'oklch(0.45 0 0)').attr('pointer-events', 'none')
    header.on('click', () => {
      const ctx = state
      if (ctx && ctx.focus.depth > 0) { focusId = ctx.focus.parent?.data.id ?? '__root__'; zoom() }
    })

    const x = scaleLinear().rangeRound([0, w]).domain([focus.x0, focus.x1])
    const y = scaleLinear().rangeRound([HEADER_H, HEADER_H + bodyH]).domain([focus.y0, focus.y1])
    const group = body.append<SVGGElement>('g').attr('class', 'tm-view')

    state = {
      root, x, y,
      body: body as ReturnType<typeof select<SVGGElement, unknown>>,
      header: header as ReturnType<typeof select<SVGGElement, unknown>>,
      group: group as ReturnType<typeof select<SVGGElement, unknown>>,
      focus, w, bodyH,
    }
    renderCells(state.group, focus, x, y, w, bodyH, colorMap, nameMap)
    updateHeader(state.header, focus, w, nameMap)
  }

  initTree(initialTree)

  return {
    update(tree: GoalTree) { initTree(tree) },
    destroy() { select(svgEl).selectAll('*').remove(); state = null },
  }
}
