import { arc as d3arc, pie as d3pie } from 'd3-shape'
import type { Goal } from '../types'
import type { AtomGeometry, ArcParams, LayoutOpts, LayoutResult } from './types'
import { phantomGoal, UNALLOCATED_ID } from './types'
import { arcPath } from './pathPrimitives'
import { DEFAULT_SIZE, MIN_ARC_ANGLE, PAD_ANGLE } from './constants'

export function layoutRadial(
  goals: Goal[],
  w: number,
  h: number,
  opts: LayoutOpts,
): LayoutResult {
  const active = goals.filter(g => !g.archived)
  const isOrder = opts.unitKind === 'order'

  const radius = Math.min(w, h) / 2 * 0.86
  const outerR = radius * 0.84
  const innerR = radius * 0.36
  const cx = w / 2
  const cy = h / 2

  const allocated = active.reduce((s, g) => s + (g.measurements[opts.activeUnit] ?? 0), 0)
  const unallocated = !isOrder && opts.frame != null
    ? Math.max(0, opts.frame - allocated) : 0
  const dataset: Goal[] = unallocated > 0
    ? [...active, phantomGoal(unallocated, opts.activeUnit)] : active

  const pie = d3pie<Goal>()
    .value(d => isOrder ? 1 : Math.max(0.001, d.measurements[opts.activeUnit] ?? DEFAULT_SIZE))
    .sort((a, b) => {
      if (a.id === UNALLOCATED_ID && b.id !== UNALLOCATED_ID) return 1
      if (a.id !== UNALLOCATED_ID && b.id === UNALLOCATED_ID) return -1
      return opts.sortUnitKind === 'order'
        ? (a.measurements[opts.sortUnit] ?? 0) - (b.measurements[opts.sortUnit] ?? 0)
        : (b.measurements[opts.sortUnit] ?? DEFAULT_SIZE) - (a.measurements[opts.sortUnit] ?? DEFAULT_SIZE)
    })
    .padAngle(PAD_ANGLE)

  // pie(data) returns slices in data order with each slice's .index reflecting
  // visual clockwise position. Sort by .index so atom array order = visual order.
  const slices = pie(dataset).sort((a, b) => a.index - b.index)

  const labelArc = d3arc<unknown, ArcParams>()
    .innerRadius(radius * 0.58).outerRadius(radius * 0.58)

  const atoms: AtomGeometry[] = slices.map(s => {
    const isPhantom = s.data.id === UNALLOCATED_ID
    const arcParams: ArcParams = {
      startAngle: s.startAngle,
      endAngle: s.endAngle,
      innerRadius: innerR,
      outerRadius: outerR,
      cornerRadius: 4,
      padAngle: PAD_ANGLE,
    }
    const [lx, ly] = labelArc.centroid({
      ...s, innerRadius: radius * 0.58, outerRadius: radius * 0.58,
    } as unknown as ArcParams)
    const v = s.data.measurements[opts.activeUnit]
    return {
      id: s.data.id,
      fill: s.data.color,
      shapeTransform: `translate(${cx},${cy})`,
      d: arcPath(arcParams),
      nameTransform: `translate(${lx}, ${ly - 6})`,
      valueTransform: `translate(${lx}, ${ly + 10})`,
      nameText: s.data.name,
      valueText: isOrder ? '' : v != null ? `${v} ${opts.activeUnit}` : '',
      textAnchor: 'middle',
      labelOpacity: (s.endAngle - s.startAngle) < MIN_ARC_ANGLE ? 0 : 1,
      arcParams,
      isPhantom,
    }
  })

  return {
    atoms,
    meta: { mode: 'radial', width: w, height: h, total: allocated, cx, cy, outerR, innerR },
  }
}
