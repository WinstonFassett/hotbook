import type { Goal } from '../types'
import type { AtomGeometry, LayoutOpts, LayoutResult } from './types'
import { phantomGoal, UNALLOCATED_ID } from './types'
import { rectPath } from './pathPrimitives'
import {
  DEFAULT_SIZE, LEFT_PAD, RANK_W, RIGHT_PAD, ROW_H, ROW_STEP, TOP_PAD, TRACK_GAP,
} from './constants'

export function layoutBands(
  goals: Goal[],
  w: number,
  h: number,
  opts: LayoutOpts,
): LayoutResult {
  const active = goals.filter(g => !g.archived)
  const isOrderActive = opts.unitKind === 'order'

  const allocated = active.reduce(
    (s, g) => s + Math.max(0, g.measurements[opts.activeUnit] ?? DEFAULT_SIZE), 0,
  )
  const unallocated = !isOrderActive && opts.frame != null
    ? Math.max(0, opts.frame - allocated) : 0
  const dataset: Goal[] = unallocated > 0
    ? [...active, phantomGoal(unallocated, opts.activeUnit)] : active

  const sorted = [...dataset].sort((a, b) => {
    if (a.id === UNALLOCATED_ID && b.id !== UNALLOCATED_ID) return 1
    if (a.id !== UNALLOCATED_ID && b.id === UNALLOCATED_ID) return -1
    const av = a.measurements[opts.sortUnit] ?? 0
    const bv = b.measurements[opts.sortUnit] ?? 0
    return opts.sortUnitKind === 'order' ? av - bv : bv - av
  })

  const rankX = LEFT_PAD
  const trackX = rankX + RANK_W + TRACK_GAP
  const trackW = Math.max(40, w - trackX - RIGHT_PAD)

  const valueOf = (g: Goal) => Math.max(0, g.measurements[opts.activeUnit] ?? DEFAULT_SIZE)
  // Scale bars so the largest BAR fills the track. Unallocated is a real bar
  // and counts toward the domain — if it's the longest, it sets the scale.
  const dataMax = Math.max(1, ...active.map(valueOf), unallocated)

  const atoms: AtomGeometry[] = sorted.map((g, i) => {
    const isPhantom = g.id === UNALLOCATED_ID
    const v = valueOf(g)
    const wRaw = isOrderActive ? trackW : (v / dataMax) * trackW
    const width = Math.max(2, Math.min(trackW, wRaw))
    const rectParams = { x: 0, y: 0, w: width, h: ROW_H - 8, rx: 4 }
    // Labels sit INSIDE the bar (dark on color, like treemap/radial).
    // Name at left padding, value at right padding. Hide both when the
    // bar is narrower than they can comfortably fit.
    const labelOpacity = width >= 70 ? 1 : 0
    return {
      id: g.id,
      fill: g.color,
      shapeTransform: `translate(${trackX}, ${TOP_PAD + i * ROW_STEP + 4})`,
      d: rectPath(rectParams),
      nameTransform: `translate(10, ${(ROW_H - 8) / 2})`,
      valueTransform: `translate(${width - 10}, ${(ROW_H - 8) / 2})`,
      nameText: g.name,
      valueText: isOrderActive ? '' : `${Math.round(v)}`,
      textAnchor: 'start',
      labelOpacity,
      rectParams,
      isPhantom,
    }
  })

  return {
    atoms,
    meta: {
      mode: 'bands', width: w, height: h, total: allocated,
      trackX, trackW, rowStep: ROW_STEP,
      rankX, rankW: RANK_W, rowH: ROW_H, topPad: TOP_PAD,
    },
  }
}
