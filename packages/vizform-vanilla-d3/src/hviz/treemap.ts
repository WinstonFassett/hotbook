import * as d3 from 'd3-hierarchy'
import { select } from 'd3-selection'
import { interpolateObject } from 'd3-interpolate'
import 'd3-transition'
import type { VizNode, HVizCallbacks } from '../types'
import { motion } from '../viz/constants'
import { buildTree, buildColorMap, buildNameMap, measureValue } from './pnodeUtils'

type Datum = { id: string; children?: Datum[] }
type RNode = d3.HierarchyRectangularNode<Datum>

type Layout = { x: number; y: number; w: number; h: number }
type CellEl = SVGGElement & { __layout?: Layout }

const HEADER_H = 28
const GROUP_LABEL_H = 20
const CHILD_PAD = 3

export interface TreemapMounted {
  update(nodes: VizNode[], measureKey: string): void
  destroy(): void
}

export function mountTreemap(
  svgEl: SVGSVGElement,
  nodes: VizNode[],
  measureKey: string,
  callbacks: HVizCallbacks,
): TreemapMounted {
  let currentNodes = nodes
  let currentMeasureKey = measureKey
  let focusId = '__root__'

  function buildRoot(w: number, bodyH: number): RNode {
    const tree = buildTree(currentNodes, currentMeasureKey)
    const root = d3.hierarchy<Datum>(tree)
      .sum(d => (d.children ? 0 : measureValue(currentNodes, d.id, currentMeasureKey)))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

    d3.treemap<Datum>()
      .tile(d3.treemapSquarify)
      .size([w, bodyH])
      .paddingOuter(2)
      .paddingInner(1)
      .paddingTop(GROUP_LABEL_H + CHILD_PAD)
      .round(true)(root)

    return root as RNode
  }

  function layoutOf(d: RNode, focus: RNode, w: number, bodyH: number): Layout {
    const fxr = Math.max(1e-9, focus.x1 - focus.x0)
    const fyr = Math.max(1e-9, focus.y1 - focus.y0)
    const sx = w / fxr
    const sy = bodyH / fyr
    return {
      x: (d.x0 - focus.x0) * sx,
      y: HEADER_H + (d.y0 - focus.y0) * sy,
      w: Math.max(0, (d.x1 - d.x0) * sx - 1),
      h: Math.max(0, (d.y1 - d.y0) * sy - 1),
    }
  }

  function render() {
    const svg = select(svgEl)
    const w = svgEl.clientWidth || 400
    const h = svgEl.clientHeight || 300
    const bodyH = Math.max(1, h - HEADER_H)
    svg.attr('viewBox', `0 0 ${w} ${h}`)

    const colorMap = buildColorMap(currentNodes)
    const nameMap = buildNameMap(currentNodes)
    const root = buildRoot(w, bodyH)
    const focus = (root.descendants().find(d => d.data.id === focusId) ?? root) as RNode

    const focusDepth = focus.depth
    const all = (root.descendants() as RNode[]).filter(d =>
      d.data.id !== '__root__' &&
      d !== focus &&
      d.depth > focusDepth &&
      d.depth <= focusDepth + 2,
    )

    let defs = svg.select<SVGDefsElement>('defs')
    if (defs.empty()) defs = svg.append<SVGDefsElement>('defs')
    defs.selectAll('clipPath#htm-body-clip').data([null]).join(e =>
      e.append('clipPath').attr('id', 'htm-body-clip')
        .append('rect').attr('x', 0).attr('y', HEADER_H).attr('width', w).attr('height', bodyH)
        .selection(),
    )
    defs.select('clipPath#htm-body-clip rect')
      .attr('width', w).attr('height', bodyH)

    let headerG = svg.select<SVGGElement>('g.tm-header')
    if (headerG.empty()) {
      headerG = svg.append<SVGGElement>('g').attr('class', 'tm-header')
      headerG.append('rect').attr('class', 'tm-header-bg')
        .attr('x', 0).attr('y', 0).attr('height', HEADER_H)
        .attr('fill', 'oklch(0.16 0 0)')
      headerG.append('text').attr('class', 'tm-header-name')
        .attr('x', 8).attr('y', Math.round(HEADER_H * 0.65))
        .attr('font-size', 11).attr('font-weight', 500).attr('letter-spacing', '0.04em')
        .attr('fill', 'oklch(0.6 0 0)').attr('pointer-events', 'none')
      headerG.append('text').attr('class', 'tm-header-hint')
        .attr('y', Math.round(HEADER_H * 0.65))
        .attr('text-anchor', 'end').attr('font-size', 9).attr('letter-spacing', '0.08em')
        .attr('fill', 'oklch(0.45 0 0)').attr('pointer-events', 'none')
    }
    headerG.select('rect.tm-header-bg').attr('width', w)
    headerG.select('text.tm-header-hint').attr('x', w - 8)

    const path: string[] = []
    let cur: RNode | null = focus
    while (cur && cur.data.id !== '__root__') {
      path.unshift(nameMap.get(cur.data.id) ?? cur.data.id)
      cur = cur.parent as RNode | null
    }
    headerG.select('text.tm-header-name').text(path.length ? path.join(' › ') : 'ALL')
    headerG.select('text.tm-header-hint').text(focus.depth > 0 ? '↑ ZOOM OUT' : '')
    headerG.attr('cursor', focus.depth > 0 ? 'pointer' : 'default')
    headerG.on('click', () => {
      if (focus.depth > 0) {
        focusId = focus.parent?.data.id ?? '__root__'
        render()
      }
    })

    let bodyG = svg.select<SVGGElement>('g.tm-body')
    if (bodyG.empty()) {
      bodyG = svg.append<SVGGElement>('g').attr('class', 'tm-body')
        .attr('clip-path', 'url(#htm-body-clip)')
    }

    bodyG.selectAll<SVGRectElement, null>('rect.tm-bg').data([null]).join(
      e => e.append('rect').attr('class', 'tm-bg'),
    )
      .attr('x', 0).attr('y', HEADER_H).attr('width', w).attr('height', bodyH)
      .attr('fill', 'transparent')
      .on('click', () => {
        if (focus.depth > 0) {
          focusId = focus.parent?.data.id ?? '__root__'
          render()
        }
      })

    const sel = bodyG.selectAll<CellEl, RNode>('g.tm-cell').data(all, d => d.data.id)

    const entered = sel.enter().append<CellEl>('g')
      .attr('class', 'tm-cell')
      .each(function(this: CellEl, d) {
        this.__layout = layoutOf(d, focus, w, bodyH)
      })

    entered.append('rect').attr('class', 'tm-rect')
    entered.append('rect').attr('class', 'tm-group-strip')
    entered.append('text').attr('class', 'tm-name')
    entered.append('text').attr('class', 'tm-val')

    const merged = entered.merge(sel)

    merged.attr('cursor', d => d.children ? 'pointer' : 'default')
    merged.on('click', (e, d) => {
      e.stopPropagation()
      if (d.children) {
        focusId = d.data.id
        render()
      } else {
        callbacks.onLeafClick?.(d.data.id)
      }
    })

    merged.select<SVGRectElement>('rect.tm-rect')
      .attr('fill', d => colorMap.get(d.data.id) ?? '#555')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 1)

    merged.select<SVGRectElement>('rect.tm-group-strip')
      .attr('fill', d => d.children ? 'oklch(0 0 0 / 0.25)' : 'none')
      .attr('x', 0).attr('y', 0)

    merged.select<SVGTextElement>('text.tm-name')
      .attr('fill', 'oklch(0.95 0 0)')
      .attr('font-size', 11).attr('font-weight', 500)
      .attr('pointer-events', 'none')

    merged.select<SVGTextElement>('text.tm-val')
      .attr('fill', 'oklch(0.95 0 0)')
      .attr('fill-opacity', 0.6).attr('font-size', 10)
      .attr('pointer-events', 'none')

    const mv = motion('move')

    merged
      .interrupt('layout')
      .transition('layout')
      .duration(mv.duration)
      .ease(mv.ease)
      .tween('layout', function(this: CellEl, d) {
        const end = layoutOf(d, focus, w, bodyH)
        const start = this.__layout ?? end
        const interp = interpolateObject(start, end) as (t: number) => Layout
        const g = select(this)
        const rect = g.select<SVGRectElement>('rect.tm-rect')
        const strip = g.select<SVGRectElement>('rect.tm-group-strip')
        const nameText = g.select<SVGTextElement>('text.tm-name')
        const valText = g.select<SVGTextElement>('text.tm-val')
        const isGroup = !!d.children

        return (t: number) => {
          const cur = interp(t)
          this.__layout = cur
          g.attr('transform', `translate(${cur.x},${cur.y})`)
          rect.attr('width', cur.w).attr('height', cur.h)

          if (isGroup) {
            const stripH = Math.min(GROUP_LABEL_H, cur.h)
            strip.attr('width', cur.w).attr('height', stripH)
            if (cur.w >= 40 && cur.h >= 16) {
              const name = nameMap.get(d.data.id) ?? ''
              const maxChars = Math.max(1, Math.floor((cur.w - 10) / 6.5))
              nameText
                .attr('x', 5).attr('y', Math.min(14, stripH - 4))
                .text(name.length > maxChars ? name.slice(0, maxChars) + '…' : name)
            } else {
              nameText.text('')
            }
            valText.text('')
          } else {
            strip.attr('width', 0).attr('height', 0)
            if (cur.w >= 36 && cur.h >= 20) {
              const name = nameMap.get(d.data.id) ?? ''
              const maxChars = Math.max(1, Math.floor((cur.w - 10) / 6.5))
              nameText
                .attr('x', 5).attr('y', 14)
                .text(name.length > maxChars ? name.slice(0, maxChars) + '…' : name)
            } else {
              nameText.text('')
            }
            if (cur.w >= 48 && cur.h >= 32) {
              const v = d.value ?? 0
              valText.attr('x', 5).attr('y', 26).text(`${Math.round(v)}`)
            } else {
              valText.text('')
            }
          }
        }
      })

    const ex = motion('exit')
    sel.exit()
      .interrupt('layout')
      .transition('layout')
      .duration(ex.duration)
      .ease(ex.ease)
      .tween('layout', function(this: CellEl) {
        const start = this.__layout ?? { x: 0, y: HEADER_H, w: 0, h: 0 }
        const end = { x: start.x + start.w / 2, y: start.y + start.h / 2, w: 0, h: 0 }
        const interp = interpolateObject(start, end) as (t: number) => Layout
        const g = select(this)
        const rect = g.select<SVGRectElement>('rect.tm-rect')
        return (t: number) => {
          const cur = interp(t)
          this.__layout = cur
          g.attr('transform', `translate(${cur.x},${cur.y})`)
          rect.attr('width', cur.w).attr('height', cur.h)
        }
      })
      .remove()
  }

  select(svgEl).selectAll('*').remove()
  render()

  return {
    update(nodes: VizNode[], measureKey: string) {
      currentNodes = nodes
      currentMeasureKey = measureKey
      render()
    },
    destroy() {
      select(svgEl).selectAll('*').remove()
    },
  }
}
