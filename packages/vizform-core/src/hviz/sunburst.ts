import * as d3 from 'd3-hierarchy'
import { select } from 'd3-selection'
import { arc as d3arc } from 'd3-shape'
import { interpolate as d3interpolate } from 'd3-interpolate'
import 'd3-transition'
import type { GoalTree, HVizCallbacks } from '../types'
import { motion } from '../viz/constants'

const DRILL = motion('enter')
const DRILL_EXIT = motion('exit')

type Datum = GoalTree
type RNode = d3.HierarchyRectangularNode<Datum>
type Arc = { x0: number; x1: number; y0: number; y1: number }
type ArcEl = SVGPathElement & { __arc?: Arc }
type TextPathEl = SVGPathElement & { __arc?: Arc }

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

function labelArcPath(a: Arc, ringR: number): string {
  const midR = ((a.y0 + a.y1) / 2) * ringR
  if (midR <= 0 || a.x1 - a.x0 <= 0) return ''
  const midAngle = (a.x0 + a.x1) / 2
  const flipped = midAngle > Math.PI / 2 && midAngle < (3 * Math.PI) / 2
  const start = flipped ? a.x1 : a.x0
  const end = flipped ? a.x0 : a.x1
  const x1 = midR * Math.sin(start); const y1 = -midR * Math.cos(start)
  const x2 = midR * Math.sin(end); const y2 = -midR * Math.cos(end)
  const sweep = flipped ? 0 : 1
  const large = Math.abs(end - start) > Math.PI ? 1 : 0
  return `M ${x1} ${y1} A ${midR} ${midR} 0 ${large} ${sweep} ${x2} ${y2}`
}

function cssId(id: string): string { return id.replace(/[^a-zA-Z0-9_-]/g, '_') }

export interface SunburstMounted {
  update(tree: GoalTree): void
  destroy(): void
}

export function mountSunburst(svgEl: SVGSVGElement, initialTree: GoalTree, callbacks: HVizCallbacks): SunburstMounted {
  let currentTree = initialTree
  let focusId = '__root__'

  function render() {
    const tree = currentTree
    const svg = select(svgEl)
    const w = svgEl.clientWidth || 400
    const h = svgEl.clientHeight || 300
    const size = Math.min(w, h)
    const ringR = size / 6
    svg.attr('viewBox', `${-w / 2} ${-h / 2} ${w} ${h}`)

    const colorMap = buildColorMap(tree)
    const nameMap = buildNameMap(tree)

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
    const labelVisible = (a: Arc) => a.y1 <= 3 && a.y0 >= 1 && (a.y1 - a.y0) * (a.x1 - a.x0) > 0.03

    const arcGen = d3arc<Arc>()
      .startAngle(a => a.x0).endAngle(a => a.x1)
      .padAngle(a => Math.min((a.x1 - a.x0) / 2, 0.005))
      .padRadius(ringR * 1.5)
      .innerRadius(a => a.y0 * ringR)
      .outerRadius(a => Math.max(a.y0 * ringR, a.y1 * ringR - 1))

    const all = (root.descendants() as RNode[]).filter(d => d.data.id !== '__root__')

    const sel = svg.selectAll<ArcEl, RNode>('path.slice').data(all, d => d.data.id)
    const entered = sel.enter().append<SVGPathElement>('path')
      .attr('class', 'slice')
      .each(function(this: ArcEl, d) { this.__arc = { x0: 0, x1: 0, y0: disp(d).y0, y1: disp(d).y0 } })

    entered.merge(sel)
      .attr('fill', d => colorMap.get(d.data.id) ?? '#555')
      .attr('stroke', 'oklch(0.12 0 0)').attr('stroke-width', 0.5)
      .attr('cursor', d => d.children ? 'pointer' : 'default')
      .on('click', (e, d) => {
        e.stopPropagation()
        if (d.children) { focusId = d.data.id; render() }
        else callbacks.onLeafClick?.(d.data.id)
      })
      .interrupt('arc')
      .transition('arc').duration(DRILL.duration).ease(DRILL.ease)
      .tween('arc', function(this: ArcEl, d) {
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

    sel.exit<ArcEl>()
      .interrupt('arc')
      .transition('arc').duration(DRILL_EXIT.duration).ease(DRILL_EXIT.ease)
      .attr('fill-opacity', 0)
      .remove()

    let defs = svg.select<SVGDefsElement>('defs')
    if (defs.empty()) defs = svg.append<SVGDefsElement>('defs')

    const labelArcs = defs.selectAll<TextPathEl, RNode>('path.label-arc').data(all, d => d.data.id)
    const laEnter = labelArcs.enter().append<SVGPathElement>('path')
      .attr('class', 'label-arc')
      .attr('id', d => `hsb-larc-${cssId(d.data.id)}`)
      .each(function(this: TextPathEl, d) { this.__arc = { x0: 0, x1: 0, y0: disp(d).y0, y1: disp(d).y0 } })
    laEnter.merge(labelArcs)
      .interrupt('label-arc')
      .transition('label-arc').duration(DRILL.duration).ease(DRILL.ease)
      .tween('label-arc', function(this: TextPathEl, d) {
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

    const labels = svg.selectAll<SVGTextElement, RNode>('text.slice-label').data(all, d => d.data.id)
    const lEnter = labels.enter().append<SVGTextElement>('text')
      .attr('class', 'slice-label')
      .attr('pointer-events', 'none')
      .attr('fill', 'oklch(0.18 0.01 250)')
      .attr('font-size', 11).attr('font-weight', 500)
      .attr('fill-opacity', 0)
    lEnter.append('textPath')
      .attr('href', d => `#hsb-larc-${cssId(d.data.id)}`)
      .attr('startOffset', '50%').attr('text-anchor', 'middle')

    lEnter.merge(labels).select('textPath')
      .text(d => {
        const a = disp(d)
        const arcLen = (a.x1 - a.x0) * ((a.y0 + a.y1) / 2) * ringR
        const max = Math.max(2, Math.floor(arcLen / 6.5))
        const name = nameMap.get(d.data.id) ?? ''
        return name.length > max ? name.slice(0, max) + '…' : name
      })
    lEnter.merge(labels)
      .interrupt('label-fade')
      .transition('label-fade').duration(DRILL.duration).ease(DRILL.ease)
      .attr('fill-opacity', d => labelVisible(disp(d)) ? 1 : 0)
    labels.exit<SVGTextElement>()
      .interrupt('label-fade')
      .transition('label-fade').duration(DRILL_EXIT.duration).ease(DRILL_EXIT.ease)
      .attr('fill-opacity', 0)
      .remove()

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
        if (focus.depth > 0) { focusId = focus.parent?.data.id ?? '__root__'; render() }
      })

    svg.selectAll<SVGTextElement, null>('text.center-label').data([null]).join(
      e => e.append('text').attr('class', 'center-label'),
    )
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('pointer-events', 'none')
      .attr('fill', 'oklch(0.7 0 0)').attr('font-size', 11).attr('font-weight', 500)
      .text(showCenter ? (nameMap.get(focus.data.id) ?? '') : '')
  }

  render()

  return {
    update(tree: GoalTree) { currentTree = tree; render() },
    destroy() { select(svgEl).selectAll('*').remove() },
  }
}
