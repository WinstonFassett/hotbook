import { arc } from 'd3-shape'
import type { Selection } from 'd3-selection'
import type { ArcParams, AtomGeometry, LayoutMeta } from '../types'
import { MIN_NUMBER_ANGLE, PAD_ANGLE } from '../constants'

const numberArcGen = (R: number) => arc<unknown, ArcParams>().innerRadius(R).outerRadius(R)

export function renderRadialChrome(
  chromeG: Selection<SVGGElement, unknown, null, undefined>,
  atoms: AtomGeometry[],
  meta: LayoutMeta,
) {
  const cx = meta.cx ?? meta.width / 2
  const cy = meta.cy ?? meta.height / 2
  const outerR = meta.outerR ?? Math.min(meta.width, meta.height) / 2 * 0.5

  const numR = (Math.min(meta.width, meta.height) / 2 * 0.86) * 0.78
  const labelArc = numberArcGen(numR)

  // Group root with translate to center
  let root = chromeG.select<SVGGElement>('g.radial-root')
  if (root.empty()) {
    root = chromeG.append('g').attr('class', 'radial-root')
  }
  root.attr('transform', `translate(${cx},${cy})`)

  // ── Slice numbers (skip phantoms — Unallocated has no rank) ──
  const indexed = atoms
    .map((a, i) => ({ atom: a, index: i }))
    .filter(d => !d.atom.isPhantom)
  const numbers = root.selectAll<SVGTextElement, typeof indexed[number]>('text.arc-number')
    .data(indexed, d => d.atom.id)

  const numbersEnter = numbers.enter()
    .append('text')
    .attr('class', 'arc-number')
    .attr('data-id', d => d.atom.id)
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .style('pointer-events', 'none')
    .style('fill', '#aaa')
    .style('font-size', '10px')

  numbers.merge(numbersEnter)
    .text(d => `#${d.index + 1}`)
    .attr('transform', d => {
      if (!d.atom.arcParams) return 'translate(0,0)'
      const [x, y] = labelArc.centroid({
        ...d.atom.arcParams,
        innerRadius: numR,
        outerRadius: numR,
      } as unknown as ArcParams)
      return `translate(${x},${y})`
    })
    .style('opacity', d => {
      const ap = d.atom.arcParams
      if (!ap) return 0
      return (ap.endAngle - ap.startAngle) < MIN_NUMBER_ANGLE ? 0 : 1
    })

  numbers.exit().remove()

  // ── Center label ──
  let center = root.select<SVGGElement>('g.arc-center')
  if (center.empty()) {
    center = root.append('g').attr('class', 'arc-center')
    center.append('text').attr('class', 'center-total').attr('text-anchor', 'middle').attr('dy', '-0.25em').style('fill', '#e8e8e8').style('font-size', '18px')
    center.append('text').attr('class', 'center-unit').attr('text-anchor', 'middle').attr('dy', '1.2em').style('fill', '#888').style('font-size', '11px')
  }
  // ── Resize handles (skip phantoms — Unallocated isn't user-editable) ──
  const handles = root.selectAll<SVGCircleElement, AtomGeometry>('circle.resize-handle')
    .data(atoms.filter(a => !a.isPhantom), d => d.id)

  const handleEndX = (a: AtomGeometry) => {
    if (!a.arcParams) return 0
    return outerR * Math.sin(a.arcParams.endAngle - PAD_ANGLE / 2)
  }
  const handleEndY = (a: AtomGeometry) => {
    if (!a.arcParams) return 0
    return -outerR * Math.cos(a.arcParams.endAngle - PAD_ANGLE / 2)
  }

  const handlesEnter = handles.enter()
    .append('circle')
    .attr('class', 'resize-handle')
    .attr('data-id', d => d.id)
    .attr('r', 7)
    .style('opacity', 0)
    .style('cursor', 'ew-resize')

  handles.merge(handlesEnter)
    .attr('cx', handleEndX)
    .attr('cy', handleEndY)
    .attr('fill', d => d.fill)
    .attr('stroke', 'oklch(0.9 0 0)')
    .attr('stroke-width', '1.5')

  handles.exit().remove()

  // Bring numbers above arcs/handles for legibility
  root.selectAll('text.arc-number').raise()

  // Helper: set center text
  const setCenter = (top: string, bottom: string, dragMode: boolean) => {
    center.select('text.center-total').classed('drag-mode', dragMode).text(top)
    center.select('text.center-unit').classed('drag-mode', dragMode).text(bottom)
  }
  // Hidden marker so external code can re-find this group's API
  // (we just expose via attached function later)
  return { setCenter, root }
}

export interface RadialChromeApi {
  setCenter: (top: string, bottom: string, dragMode: boolean) => void
  root: Selection<SVGGElement, unknown, null, undefined>
}
