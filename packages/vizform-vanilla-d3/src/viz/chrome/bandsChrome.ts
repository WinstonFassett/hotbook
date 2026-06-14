import type { Selection } from 'd3-selection'
import type { AtomGeometry, LayoutMeta } from '../types'
import { HANDLE_HIT_W, HANDLE_VIS_H, HANDLE_VIS_W, ROW_H } from '../constants'

export interface BandsChromeBindings {
  isOrderActive: boolean
  canResize: boolean
  canReorder: boolean
}

export function renderBandsChrome(
  chromeG: Selection<SVGGElement, unknown, null, undefined>,
  atoms: AtomGeometry[],
  meta: LayoutMeta,
  b: BandsChromeBindings,
) {
  const trackX = meta.trackX ?? 0
  const rankX = meta.rankX ?? 0
  const rankW = meta.rankW ?? 0
  const topPad = meta.topPad ?? 0
  const rowStep = meta.rowStep ?? ROW_H

  // ── Rank column (skip phantoms — Unallocated has no rank) ────
  const rankRows = atoms
    .map((a, i) => ({ id: a.id, index: i, isPhantom: a.isPhantom }))
    .filter(r => !r.isPhantom)
  const ranks = chromeG.selectAll<SVGGElement, typeof rankRows[number]>('g.band-rank-wrap')
    .data(rankRows, d => d.id)
  const ranksEnter = ranks.enter().append('g')
    .attr('class', 'band-rank-wrap')
    .attr('data-id', d => d.id)
  ranksEnter.append('rect')
    .attr('class', 'band-rank-hit')
    .attr('x', rankX - 6)
    .attr('width', rankW + 12)
    .attr('height', ROW_H)
    .attr('fill', 'transparent')
  ranksEnter.append('text')
    .attr('class', 'band-rank')
    .attr('x', rankX + rankW - 2)
    .attr('y', ROW_H / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'end')
    .style('pointer-events', 'none')
    .style('fill', '#666')
    .style('font-size', '10px')
  ranks.merge(ranksEnter)
    .attr('transform', d => `translate(0, ${topPad + d.index * rowStep})`)
    .style('cursor', b.canReorder ? 'grab' : 'default')
    .select<SVGTextElement>('text.band-rank').text(d => `#${d.index + 1}`)
  ranks.exit().remove()

  // ── Bar resize handles per row (skip phantoms) ───────────────
  const handleRows = atoms
    .map((a, i) => ({
      id: a.id, index: i, width: a.rectParams?.w ?? 0, isPhantom: a.isPhantom,
    }))
    .filter(r => !r.isPhantom)
  const bandHandles = chromeG.selectAll<SVGGElement, typeof handleRows[number]>('g.band-handle')
    .data(b.canResize ? handleRows : [], d => d.id)
  const bandHandlesEnter = bandHandles.enter().append('g')
    .attr('class', 'band-handle')
    .attr('data-id', d => d.id)
    .style('cursor', 'ew-resize')
    .style('opacity', 0)
  bandHandlesEnter.append('rect')
    .attr('class', 'band-handle-hit')
    .attr('y', (ROW_H - HANDLE_HIT_W * 1.6) / 2)
    .attr('width', HANDLE_HIT_W)
    .attr('height', HANDLE_HIT_W * 1.6)
    .attr('fill', 'transparent')
  bandHandlesEnter.append('rect')
    .attr('class', 'band-handle-vis')
    .attr('y', (ROW_H - HANDLE_VIS_H) / 2)
    .attr('width', HANDLE_VIS_W)
    .attr('height', HANDLE_VIS_H)
    .attr('rx', 2)
    .attr('fill', 'oklch(0.93 0 0)')
    .style('pointer-events', 'none')
  bandHandles.merge(bandHandlesEnter)
    .attr('transform', d => `translate(0, ${topPad + d.index * rowStep})`)
  bandHandles.merge(bandHandlesEnter).select<SVGRectElement>('rect.band-handle-hit')
    .attr('x', d => trackX + d.width - HANDLE_HIT_W / 2)
  bandHandles.merge(bandHandlesEnter).select<SVGRectElement>('rect.band-handle-vis')
    .attr('x', d => trackX + d.width - HANDLE_VIS_W / 2)
  bandHandles.exit().remove()
}
