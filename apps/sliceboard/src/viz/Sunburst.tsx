import { useEffect } from 'react'
import * as d3 from 'd3'
import type { PNode } from '../persistence'
import { nodeColor, motion, buildVizTree, useDimensions, useAltScroll } from './util'

type Datum = { id: string; children?: Datum[] }
type Node = d3.HierarchyRectangularNode<Datum>
type Arc = { x0: number; x1: number; y0: number; y1: number }
type ArcEl = SVGPathElement & { __arc?: Arc }
type TextPathEl = SVGPathElement & { __arc?: Arc }

interface Props {
  nodes: PNode[]
  measureKey: string
  hoverId: string | null
  selectionId: string | null
  focusId: string
  depth?: number
  sortBy?: 'index' | 'value'
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  onFocus: (id: string) => void
  onUpdate?: (nodeId: string, measures: PNode['measures']) => void
}

function labelArcPath(a: Arc, ringR: number): string {
  const midR = ((a.y0 + a.y1) / 2) * ringR
  if (midR <= 0 || a.x1 - a.x0 <= 0) return ''
  const midAngle = (a.x0 + a.x1) / 2
  const flipped = midAngle > Math.PI / 2 && midAngle < (3 * Math.PI) / 2
  const start = flipped ? a.x1 : a.x0
  const end = flipped ? a.x0 : a.x1
  const x1 = midR * Math.sin(start), y1 = -midR * Math.cos(start)
  const x2 = midR * Math.sin(end),   y2 = -midR * Math.cos(end)
  const sweep = flipped ? 0 : 1
  const large = Math.abs(end - start) > Math.PI ? 1 : 0
  return `M ${x1} ${y1} A ${midR} ${midR} 0 ${large} ${sweep} ${x2} ${y2}`
}

function cssId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function Sunburst({ nodes, measureKey, hoverId, selectionId, focusId, depth = 2, sortBy = 'index', onHover, onSelect, onFocus, onUpdate }: Props) {
  const [ref, w, h] = useDimensions()
  const move = motion('move')
  useAltScroll(ref, nodes, measureKey, 'path.slice', 'data-id', onUpdate ?? (() => {}))

  useEffect(() => {
    if (!ref.current || w === 0 || h === 0) return
    const svg = d3.select(ref.current)
    const size = Math.min(w, h)
    const ringR = size / 6
    svg.attr('viewBox', `${-w / 2} ${-h / 2} ${w} ${h}`)

    const tree = buildVizTree(nodes)
    if (!tree) { svg.selectAll('*').remove(); return }

    const root = d3.hierarchy<Datum>(tree)
      .sum(d => nodes.find(n => n.id === d.id)?.measures[measureKey] ?? 0)
      .sort(sortBy === 'value'
        ? (a, b) => (b.value ?? 0) - (a.value ?? 0)
        : (a, b) => (nodes.find(n => n.id === a.data.id)?.index ?? 0) - (nodes.find(n => n.id === b.data.id)?.index ?? 0))
    d3.partition<Datum>().size([2 * Math.PI, root.height + 1])(root)

    const focus = (root.descendants().find(d => d.data.id === focusId) ?? root) as Node
    const f = focus

    function disp(d: Node): Arc {
      const denom = Math.max(1e-9, f.x1 - f.x0)
      return {
        x0: Math.max(0, Math.min(1, (d.x0 - f.x0) / denom)) * 2 * Math.PI,
        x1: Math.max(0, Math.min(1, (d.x1 - f.x0) / denom)) * 2 * Math.PI,
        y0: Math.max(0, d.y0 - f.depth),
        y1: Math.max(0, d.y1 - f.depth),
      }
    }

    const arcVisible = (a: Arc) => a.y1 <= depth + 1 && a.y0 >= 1 && a.x1 > a.x0
    const labelVisible = (a: Arc) => a.y1 <= depth + 1 && a.y0 >= 1 && (a.y1 - a.y0) * (a.x1 - a.x0) > 0.03

    const arcGen = d3.arc<Arc>()
      .startAngle(a => a.x0).endAngle(a => a.x1)
      .padAngle(a => Math.min((a.x1 - a.x0) / 2, 0.005))
      .padRadius(ringR * 1.5)
      .innerRadius(a => a.y0 * ringR)
      .outerRadius(a => Math.max(a.y0 * ringR, a.y1 * ringR - 1))

    const all = (root.descendants() as Node[]).filter(d => d.data.id !== '__root__')

    const sel = svg.selectAll<ArcEl, Node>('path.slice').data(all, d => d.data.id)
    const entered = sel.enter().append<SVGPathElement>('path').attr('class', 'slice')
      .each(function(this: ArcEl, d) { this.__arc = { x0: 0, x1: 0, y0: disp(d).y0, y1: disp(d).y0 } })

    const merged = entered.merge(sel)
      .attr('fill', d => nodeColor(nodes, d.data.id))
      .attr('data-id', d => d.data.id)
      .attr('stroke', d => selectionId === d.data.id ? 'var(--pv-ink)' : hoverId === d.data.id ? 'var(--pv-ink-muted)' : 'var(--pv-bg)')
      .attr('stroke-width', d => selectionId === d.data.id || hoverId === d.data.id ? 1.5 : 0.5)
      .attr('cursor', d => d.children ? 'pointer' : 'default')
      .on('pointerenter', (_e, d) => onHover(d.data.id))
      .on('pointerleave', () => onHover(null))
      .on('click', (e, d) => { e.stopPropagation(); onSelect(d.data.id); if (d.children) onFocus(d.data.id) })

    merged.transition().duration(move.duration).ease(move.ease)
      .tween('arc', function(this: ArcEl, d) {
        const target = disp(d)
        const start = this.__arc ?? target
        const interp = d3.interpolate<Arc>(start, target)
        return (t: number) => { const cur = interp(t); this.__arc = cur; d3.select(this).attr('d', arcGen(cur) ?? '') }
      })
      .attr('fill-opacity', d => { const t = disp(d); if (!arcVisible(t)) return 0; return (hoverId === d.data.id || selectionId === d.data.id) ? 1 : d.children ? 0.7 : 0.85 })
      .attr('pointer-events', d => arcVisible(disp(d)) ? 'auto' : 'none')
    sel.exit().remove()

    let defs = svg.select<SVGDefsElement>('defs')
    if (defs.empty()) defs = svg.append<SVGDefsElement>('defs')

    const labelArcs = defs.selectAll<TextPathEl, Node>('path.label-arc').data(all, d => d.data.id)
    const laEnter = labelArcs.enter().append<SVGPathElement>('path').attr('class', 'label-arc')
      .attr('id', d => `sb-larc-${cssId(d.data.id)}`)
      .each(function(this: TextPathEl, d) { this.__arc = { x0: 0, x1: 0, y0: disp(d).y0, y1: disp(d).y0 } })
    laEnter.merge(labelArcs).transition().duration(move.duration).ease(move.ease)
      .tween('label-arc', function(this: TextPathEl, d) {
        const target = disp(d); const start = this.__arc ?? target
        const interp = d3.interpolate<Arc>(start, target)
        return (t: number) => { const cur = interp(t); this.__arc = cur; d3.select(this).attr('d', labelArcPath(cur, ringR)) }
      })
    labelArcs.exit().remove()

    const labels = svg.selectAll<SVGTextElement, Node>('text.slice-label').data(all, d => d.data.id)
    const lEnter = labels.enter().append<SVGTextElement>('text').attr('class', 'slice-label')
      .attr('pointer-events', 'none').attr('fill', 'oklch(0.18 0.01 250)')
      .attr('font-size', 11).attr('font-weight', 500).attr('fill-opacity', 0)
    lEnter.append('textPath').attr('href', d => `#sb-larc-${cssId(d.data.id)}`).attr('startOffset', '50%').attr('text-anchor', 'middle')
    lEnter.merge(labels).select('textPath').text(d => {
      const a = disp(d)
      const arcLen = (a.x1 - a.x0) * ((a.y0 + a.y1) / 2) * ringR
      const max = Math.max(2, Math.floor(arcLen / 6.5))
      const name = nodes.find(n => n.id === d.data.id)?.name ?? ''
      return name.length > max ? name.slice(0, max) + '…' : name
    })
    lEnter.merge(labels).transition().duration(move.duration).ease(move.ease)
      .attr('fill-opacity', d => labelVisible(disp(d)) ? 1 : 0)
    labels.exit().remove()

    const showCenter = f.depth > 0
    svg.selectAll<SVGCircleElement, null>('circle.center').data([null]).join(e => e.append('circle').attr('class', 'center'))
      .attr('r', showCenter ? ringR : 0).attr('fill', showCenter ? nodeColor(nodes, f.data.id) : 'transparent')
      .attr('fill-opacity', showCenter ? 0.18 : 0).attr('stroke', 'var(--pv-border-quiet)').attr('stroke-width', 0.5)
      .attr('cursor', showCenter ? 'pointer' : 'default').attr('pointer-events', showCenter ? 'auto' : 'none')
      .on('click', e => { e.stopPropagation(); if (f.depth > 0) onFocus(f.parent?.data.id ?? '__root__') })

    svg.selectAll<SVGTextElement, null>('text.center-label').data([null]).join(e => e.append('text').attr('class', 'center-label'))
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle').attr('pointer-events', 'none')
      .attr('fill', 'var(--pv-ink-muted)').attr('font-size', 11).attr('font-weight', 500)
      .text(showCenter ? (nodes.find(n => n.id === f.data.id)?.name ?? '') : '')

    svg.selectAll<SVGTextElement, null>('text.center-hint').data([null]).join(e => e.append('text').attr('class', 'center-hint'))
      .attr('y', 14).attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('pointer-events', 'none').attr('fill', 'var(--pv-ink-dim)').attr('font-size', 8).attr('letter-spacing', '0.1em')
      .text(showCenter ? 'CLICK TO ZOOM OUT' : '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, measureKey, hoverId, selectionId, focusId, depth, sortBy, w, h])

  return <svg ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}
