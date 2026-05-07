import React, { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3-hierarchy'
import { select } from 'd3-selection'
import { scaleLinear } from 'd3-scale'
import { arc as d3arc } from 'd3-shape'
import { interpolate as d3interpolate, interpolateObject } from 'd3-interpolate'
import 'd3-transition'
import type { GoalTree } from './types'

type HMode = 'h-treemap' | 'h-icicle' | 'h-radial'

interface HVizProps {
  tree: GoalTree
  mode: HMode
  onLeafClick?: (id: string) => void
}

type Datum = GoalTree
type RNode = d3.HierarchyRectangularNode<Datum>

// ─── color lookup ────────────────────────────────────────────────────────────

function buildColorMap(tree: GoalTree): Map<string, string> {
  const m = new Map<string, string>()
  function walk(n: GoalTree) {
    m.set(n.id, n.color)
    n.children?.forEach(walk)
  }
  walk(tree)
  return m
}

function buildNameMap(tree: GoalTree): Map<string, string> {
  const m = new Map<string, string>()
  function walk(n: GoalTree) {
    m.set(n.id, n.name)
    n.children?.forEach(walk)
  }
  walk(tree)
  return m
}

// ─── HIcicle ─────────────────────────────────────────────────────────────────

type CellEl = SVGGElement & { __layout?: { x: number; y: number; w: number; h: number } }

function HIcicle({ tree, onLeafClick }: { tree: GoalTree; onLeafClick?: (id: string) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  const [focusId, setFocusId] = useState<string>('__root__')
  const colorMap = buildColorMap(tree)
  const nameMap = buildNameMap(tree)

  useEffect(() => {
    if (!ref.current) return
    const svg = select(ref.current)
    const w = ref.current.clientWidth || 800
    const h = ref.current.clientHeight || 300
    svg.attr('viewBox', `0 0 ${w} ${h}`)

    const root = d3.hierarchy<Datum>(tree)
      .sum(d => (d.children ? 0 : d.value))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

    d3.partition<Datum>().size([h, w])(root)

    let focus = (root as RNode).descendants().find(d => d.data.id === focusId) as RNode | undefined
    if (!focus) focus = root as RNode
    const f = focus

    const all = (root as RNode).descendants().filter(d => d.data.id !== '__root__') as RNode[]

    const layoutOf = (d: RNode) => {
      const x = d.y0 - f.y0
      const y = ((d.x0 - f.x0) / Math.max(1, f.x1 - f.x0)) * h
      const yE = ((d.x1 - f.x0) / Math.max(1, f.x1 - f.x0)) * h
      return { x, y, w: Math.max(0, d.y1 - d.y0 - 1), h: Math.max(0, yE - y - 1) }
    }

    const sel = svg.selectAll<CellEl, RNode>('g.cell').data(all, d => d.data.id)

    const entered = sel.enter().append<SVGGElement>('g')
      .attr('class', 'cell')
      .each(function (this: CellEl, d) { this.__layout = layoutOf(d) })
    entered.append('rect')
    entered.append('text')

    const merged = entered.merge(sel)
      .attr('cursor', 'pointer')
      .on('click', (e, d) => {
        e.stopPropagation()
        if (d.data.id === focusId) {
          setFocusId(d.parent?.data.id ?? '__root__')
        } else if (d.children) {
          setFocusId(d.data.id)
        } else {
          onLeafClick?.(d.data.id)
        }
      })

    merged.select<SVGRectElement>('rect')
      .attr('fill', d => colorMap.get(d.data.id) ?? '#555')

    merged.transition('layout').duration(300)
      .tween('layout', function (this: CellEl, d) {
        const start = this.__layout ?? layoutOf(d)
        const end = layoutOf(d)
        const i = interpolateObject(start, end) as (t: number) => typeof start
        const g = select(this)
        const rect = g.select<SVGRectElement>('rect')
        return (t: number) => {
          const cur = i(t)
          this.__layout = cur
          rect.attr('x', 0).attr('y', 0).attr('width', cur.w).attr('height', cur.h)
          g.attr('transform', `translate(${cur.x},${cur.y})`)
        }
      })

    merged.select<SVGTextElement>('text')
      .attr('x', 6).attr('y', 14)
      .attr('fill', 'oklch(0.18 0.01 250)')
      .attr('font-size', 11).attr('font-weight', 500)
      .attr('pointer-events', 'none')
      .text(d => {
        const L = layoutOf(d)
        if (L.w < 36 || L.h < 16) return ''
        const name = nameMap.get(d.data.id) ?? ''
        const max = Math.max(1, Math.floor((L.w - 12) / 6))
        return name.length > max ? name.slice(0, max) + '…' : name
      })

    sel.exit().remove()

    svg.selectAll('rect.icicle-bg').data([null]).join('rect')
      .attr('class', 'icicle-bg')
      .attr('x', 0).attr('y', 0).attr('width', w).attr('height', h)
      .attr('fill', 'transparent')
      .lower()
      .on('click', () => setFocusId('__root__'))
  }, [tree, focusId])  // eslint-disable-line react-hooks/exhaustive-deps

  return <svg ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}

// ─── HSunburst ────────────────────────────────────────────────────────────────

type Arc = { x0: number; x1: number; y0: number; y1: number }
type ArcEl = SVGPathElement & { __arc?: Arc }
type TextPathEl = SVGPathElement & { __arc?: Arc }

function labelArcPath(a: Arc, ringR: number): string {
  const midR = ((a.y0 + a.y1) / 2) * ringR
  if (midR <= 0 || a.x1 - a.x0 <= 0) return ''
  const midAngle = (a.x0 + a.x1) / 2
  const flipped = midAngle > Math.PI / 2 && midAngle < (3 * Math.PI) / 2
  const start = flipped ? a.x1 : a.x0
  const end = flipped ? a.x0 : a.x1
  const x1 = midR * Math.sin(start)
  const y1 = -midR * Math.cos(start)
  const x2 = midR * Math.sin(end)
  const y2 = -midR * Math.cos(end)
  const sweep = flipped ? 0 : 1
  const large = Math.abs(end - start) > Math.PI ? 1 : 0
  return `M ${x1} ${y1} A ${midR} ${midR} 0 ${large} ${sweep} ${x2} ${y2}`
}

function cssId(id: string): string { return id.replace(/[^a-zA-Z0-9_-]/g, '_') }

function HSunburst({ tree, onLeafClick }: { tree: GoalTree; onLeafClick?: (id: string) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  const [focusId, setFocusId] = useState<string>('__root__')
  const colorMap = buildColorMap(tree)
  const nameMap = buildNameMap(tree)

  useEffect(() => {
    if (!ref.current) return
    const svg = select(ref.current)
    const w = ref.current.clientWidth || 400
    const h = ref.current.clientHeight || 300
    const size = Math.min(w, h)
    const ringR = size / 6
    svg.attr('viewBox', `${-w / 2} ${-h / 2} ${w} ${h}`)

    const root = d3.hierarchy<Datum>(tree)
      .sum(d => (d.children ? 0 : d.value))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    d3.partition<Datum>().size([2 * Math.PI, root.height + 1])(root)

    const focus = ((root.descendants().find(d => d.data.id === focusId) ?? root) as RNode)

    function disp(d: RNode): Arc {
      const denom = Math.max(1e-9, focus.x1 - focus.x0)
      return {
        x0: Math.max(0, Math.min(1, (d.x0 - focus.x0) / denom)) * 2 * Math.PI,
        x1: Math.max(0, Math.min(1, (d.x1 - focus.x0) / denom)) * 2 * Math.PI,
        y0: Math.max(0, d.y0 - focus.depth),
        y1: Math.max(0, d.y1 - focus.depth),
      }
    }

    const arcVisible = (a: Arc) => a.y1 <= 3 && a.y0 >= 1 && a.x1 > a.x0
    const labelVisible = (a: Arc) =>
      a.y1 <= 3 && a.y0 >= 1 && (a.y1 - a.y0) * (a.x1 - a.x0) > 0.03

    const arcGen = d3arc<Arc>()
      .startAngle(a => a.x0)
      .endAngle(a => a.x1)
      .padAngle(a => Math.min((a.x1 - a.x0) / 2, 0.005))
      .padRadius(ringR * 1.5)
      .innerRadius(a => a.y0 * ringR)
      .outerRadius(a => Math.max(a.y0 * ringR, a.y1 * ringR - 1))

    const all = (root.descendants() as RNode[]).filter(d => d.data.id !== '__root__')

    // slices
    const sel = svg.selectAll<ArcEl, RNode>('path.slice').data(all, d => d.data.id)
    const entered = sel.enter().append<SVGPathElement>('path')
      .attr('class', 'slice')
      .each(function (this: ArcEl, d) {
        this.__arc = { x0: 0, x1: 0, y0: disp(d).y0, y1: disp(d).y0 }
      })

    entered.merge(sel)
      .attr('fill', d => colorMap.get(d.data.id) ?? '#555')
      .attr('stroke', 'oklch(0.12 0 0)')
      .attr('stroke-width', 0.5)
      .attr('cursor', d => d.children ? 'pointer' : 'default')
      .on('click', (e, d) => {
        e.stopPropagation()
        if (d.children) setFocusId(d.data.id)
        else onLeafClick?.(d.data.id)
      })
      .transition().duration(300)
      .tween('arc', function (this: ArcEl, d) {
        const target = disp(d)
        const start = this.__arc ?? target
        const i = d3interpolate<Arc>(start, target)
        return (t: number) => {
          const cur = i(t)
          this.__arc = cur
          select(this).attr('d', arcGen(cur) ?? '')
        }
      })
      .attr('fill-opacity', d => arcVisible(disp(d)) ? (d.children ? 0.7 : 0.85) : 0)
      .attr('pointer-events', d => arcVisible(disp(d)) ? 'auto' : 'none')

    sel.exit().remove()

    // label arcs in defs
    let defs = svg.select<SVGDefsElement>('defs')
    if (defs.empty()) defs = svg.append<SVGDefsElement>('defs')

    const labelArcs = defs.selectAll<TextPathEl, RNode>('path.label-arc').data(all, d => d.data.id)
    const laEnter = labelArcs.enter().append<SVGPathElement>('path')
      .attr('class', 'label-arc')
      .attr('id', d => `hsb-larc-${cssId(d.data.id)}`)
      .each(function (this: TextPathEl, d) {
        this.__arc = { x0: 0, x1: 0, y0: disp(d).y0, y1: disp(d).y0 }
      })
    laEnter.merge(labelArcs)
      .transition().duration(300)
      .tween('label-arc', function (this: TextPathEl, d) {
        const target = disp(d)
        const start = this.__arc ?? target
        const i = d3interpolate<Arc>(start, target)
        return (t: number) => {
          const cur = i(t)
          this.__arc = cur
          select(this).attr('d', labelArcPath(cur, ringR))
        }
      })
    labelArcs.exit().remove()

    // labels
    const labels = svg.selectAll<SVGTextElement, RNode>('text.slice-label').data(all, d => d.data.id)
    const lEnter = labels.enter().append<SVGTextElement>('text')
      .attr('class', 'slice-label')
      .attr('pointer-events', 'none')
      .attr('fill', 'oklch(0.18 0.01 250)')
      .attr('font-size', 11).attr('font-weight', 500)
      .attr('fill-opacity', 0)
    lEnter.append('textPath')
      .attr('href', d => `#hsb-larc-${cssId(d.data.id)}`)
      .attr('startOffset', '50%')
      .attr('text-anchor', 'middle')

    lEnter.merge(labels)
      .select('textPath')
      .text(d => {
        const a = disp(d)
        const arcLen = (a.x1 - a.x0) * ((a.y0 + a.y1) / 2) * ringR
        const max = Math.max(2, Math.floor(arcLen / 6.5))
        const name = nameMap.get(d.data.id) ?? ''
        return name.length > max ? name.slice(0, max) + '…' : name
      })
    lEnter.merge(labels)
      .transition().duration(300)
      .attr('fill-opacity', d => labelVisible(disp(d)) ? 1 : 0)
    labels.exit().remove()

    // center disc
    const showCenter = focus.depth > 0
    svg.selectAll<SVGCircleElement, null>('circle.center').data([null]).join(
      e => e.append('circle').attr('class', 'center'),
    )
      .attr('r', showCenter ? ringR : 0)
      .attr('fill', showCenter ? (colorMap.get(focus.data.id) ?? '#555') : 'transparent')
      .attr('fill-opacity', showCenter ? 0.18 : 0)
      .attr('stroke', 'oklch(0.3 0 0)').attr('stroke-width', 0.5)
      .attr('cursor', showCenter ? 'pointer' : 'default')
      .attr('pointer-events', showCenter ? 'auto' : 'none')
      .on('click', e => {
        e.stopPropagation()
        if (focus.depth > 0) setFocusId(focus.parent?.data.id ?? '__root__')
      })

    svg.selectAll<SVGTextElement, null>('text.center-label').data([null]).join(
      e => e.append('text').attr('class', 'center-label'),
    )
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('pointer-events', 'none')
      .attr('fill', 'oklch(0.7 0 0)').attr('font-size', 11).attr('font-weight', 500)
      .text(showCenter ? (nameMap.get(focus.data.id) ?? '') : '')
  }, [tree, focusId])  // eslint-disable-line react-hooks/exhaustive-deps

  return <svg ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}

// ─── HTreemap ────────────────────────────────────────────────────────────────

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

function HTreemap({ tree, onLeafClick }: { tree: GoalTree; onLeafClick?: (id: string) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  const [focusId, setFocusId] = useState<string>('__root__')
  const colorMap = buildColorMap(tree)
  const nameMap = buildNameMap(tree)
  const stateRef = useRef<TreemapState | null>(null)

  function buildRoot(w: number, bodyH: number) {
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
  ) {
    const fxr = Math.max(1e-9, focus.x1 - focus.x0)
    const fyr = Math.max(1e-9, focus.y1 - focus.y0)
    const dW = (d: RNode) => (d.x1 - d.x0) * (w / fxr)
    const dH = (d: RNode) => (d.y1 - d.y0) * (bodyH / fyr)

    const items = (focus.children ?? []) as RNode[]
    const cell = (group as ReturnType<typeof select<SVGGElement, unknown>>)
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
      if (d.children) setFocusId(d.data.id)
      else onLeafClick?.(d.data.id)
    })

    cell.select<SVGRectElement>('rect.tm-rect')
      .attr('fill', d => colorMap.get(d.data.id) ?? '#555')
      .attr('stroke-width', 1.5)
      .attr('stroke', 'transparent')

    cell.select<SVGTextElement>('text.tm-name')
      .attr('x', 8).attr('y', 16)
      .attr('fill', 'oklch(0.18 0.01 250)')
      .attr('font-size', 12).attr('font-weight', 500)
      .attr('pointer-events', 'none')
      .text(d => {
        const cw = dW(d)
        const ch = dH(d)
        if (cw < 44 || ch < 22) return ''
        const name = nameMap.get(d.data.id) ?? ''
        const max = Math.max(2, Math.floor((cw - 16) / 6.5))
        return name.length > max ? name.slice(0, max) + '…' : name
      })

    cell.select<SVGTextElement>('text.tm-val')
      .attr('x', 8).attr('y', 30)
      .attr('fill', 'oklch(0.18 0.01 250)')
      .attr('fill-opacity', 0.6)
      .attr('font-size', 10)
      .attr('pointer-events', 'none')
      .text(d => {
        const cw = dW(d)
        const ch = dH(d)
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

  // initial build
  useEffect(() => {
    if (!ref.current) return
    const svg = select(ref.current)
    const w = ref.current.clientWidth || 400
    const h = ref.current.clientHeight || 300
    const bodyH = Math.max(1, h - HEADER_H)
    svg.attr('viewBox', `0 0 ${w} ${h}`)

    const root = buildRoot(w, bodyH)
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
      const ctx = stateRef.current
      if (ctx && ctx.focus.depth > 0) setFocusId(ctx.focus.parent?.data.id ?? '__root__')
    })

    const x = scaleLinear().rangeRound([0, w]).domain([focus.x0, focus.x1])
    const y = scaleLinear().rangeRound([HEADER_H, HEADER_H + bodyH]).domain([focus.y0, focus.y1])
    const group = body.append<SVGGElement>('g').attr('class', 'tm-view')

    const ctx: TreemapState = {
      root,
      x,
      y,
      body: body as ReturnType<typeof select<SVGGElement, unknown>>,
      header: header as ReturnType<typeof select<SVGGElement, unknown>>,
      group: group as ReturnType<typeof select<SVGGElement, unknown>>,
      focus,
      w,
      bodyH,
    }
    stateRef.current = ctx
    renderCells(ctx.group, focus, x, y, w, bodyH)
    updateHeader(ctx.header, focus, w)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree])

  // zoom on focusId change
  useEffect(() => {
    const ctx = stateRef.current
    if (!ctx || !ref.current) return
    const next = (ctx.root.descendants().find(d => d.data.id === focusId) ?? ctx.root) as RNode
    if (next === ctx.focus) return

    ctx.x.domain([next.x0, next.x1])
    ctx.y.domain([next.y0, next.y1])
    ctx.focus = next

    ctx.group.remove()
    ctx.group = ctx.body.append<SVGGElement>('g').attr('class', 'tm-view') as ReturnType<typeof select<SVGGElement, unknown>>
    renderCells(ctx.group, next, ctx.x, ctx.y, ctx.w, ctx.bodyH)
    updateHeader(ctx.header, next, ctx.w)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  return <svg ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}

// ─── HViz (switcher) ─────────────────────────────────────────────────────────

export function HViz({ tree, mode, onLeafClick }: HVizProps) {
  if (mode === 'h-icicle') return <HIcicle tree={tree} onLeafClick={onLeafClick} />
  if (mode === 'h-radial') return <HSunburst tree={tree} onLeafClick={onLeafClick} />
  return <HTreemap tree={tree} onLeafClick={onLeafClick} />
}
