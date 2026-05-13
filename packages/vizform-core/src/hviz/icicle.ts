import * as d3 from 'd3-hierarchy'
import { select } from 'd3-selection'
import { interpolateObject } from 'd3-interpolate'
import 'd3-transition'
import type { PNode, HVizCallbacks } from '../types'
import { motion } from '../viz/constants'
import { buildTree, buildColorMap, buildNameMap, measureValue } from './pnodeUtils'

const DRILL = motion('enter')
const DRILL_EXIT = motion('exit')

type Datum = { id: string; children?: Datum[] }
type RNode = d3.HierarchyRectangularNode<Datum>
type CellEl = SVGGElement & { __layout?: { x: number; y: number; w: number; h: number } }

export interface IcicleMounted {
  update(nodes: PNode[], measureKey: string): void
  destroy(): void
}

export function mountIcicle(
  svgEl: SVGSVGElement,
  nodes: PNode[],
  measureKey: string,
  callbacks: HVizCallbacks,
): IcicleMounted {
  let currentNodes = nodes
  let currentMeasureKey = measureKey
  let focusId = '__root__'

  function render() {
    const svg = select(svgEl)
    const w = svgEl.clientWidth || 800
    const h = svgEl.clientHeight || 300
    svg.attr('viewBox', `0 0 ${w} ${h}`)

    const colorMap = buildColorMap(currentNodes)
    const nameMap = buildNameMap(currentNodes)

    const tree = buildTree(currentNodes, currentMeasureKey)
    const root = d3.hierarchy<Datum>(tree)
      .sum(d => (d.children ? 0 : measureValue(currentNodes, d.id, currentMeasureKey)))
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
      .each(function(this: CellEl, d) { this.__layout = layoutOf(d) })
    entered.append('rect')
    entered.append('text')

    const merged = entered.merge(sel)
      .attr('cursor', 'pointer')
      .on('click', (e, d) => {
        e.stopPropagation()
        if (d.data.id === focusId) {
          focusId = d.parent?.data.id ?? '__root__'
        } else if (d.children) {
          focusId = d.data.id
        } else {
          callbacks.onLeafClick?.(d.data.id)
          return
        }
        render()
      })

    merged.select<SVGRectElement>('rect')
      .attr('fill', d => colorMap.get(d.data.id) ?? '#555')

    merged.interrupt('layout').transition('layout').duration(DRILL.duration).ease(DRILL.ease)
      .tween('layout', function(this: CellEl, d) {
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

    sel.exit<CellEl>()
      .interrupt('layout')
      .transition('layout').duration(DRILL_EXIT.duration).ease(DRILL_EXIT.ease)
      .style('opacity', 0)
      .remove()

    svg.selectAll('rect.icicle-bg').data([null]).join('rect')
      .attr('class', 'icicle-bg')
      .attr('x', 0).attr('y', 0).attr('width', w).attr('height', h)
      .attr('fill', 'transparent')
      .lower()
      .on('click', () => { focusId = '__root__'; render() })
  }

  render()

  return {
    update(nodes: PNode[], measureKey: string) {
      currentNodes = nodes
      currentMeasureKey = measureKey
      render()
    },
    destroy() {
      select(svgEl).selectAll('*').remove()
    },
  }
}
