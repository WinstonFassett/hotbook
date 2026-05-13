import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy'
import type { Goal } from '../types'
import type { AtomGeometry, LayoutOpts, LayoutResult } from './types'
import { phantomGoal, UNALLOCATED_ID } from './types'
import { rectPath } from './pathPrimitives'
import { DEFAULT_SIZE, MIN_LABEL_H, MIN_LABEL_W } from './constants'

export function layoutTreemap(
  goals: Goal[],
  w: number,
  h: number,
  opts: LayoutOpts,
): LayoutResult {
  const active = goals.filter(g => !g.archived)
  const isOrder = opts.unitKind === 'order'

  const allocated = active.reduce((s, g) => s + (g.measurements[opts.activeUnit] ?? 0), 0)
  const unallocated = !isOrder && opts.frame != null
    ? Math.max(0, opts.frame - allocated) : 0
  const dataset: Goal[] = unallocated > 0
    ? [...active, phantomGoal(unallocated, opts.activeUnit)] : active

  const root = hierarchy<{ children?: Goal[]; id?: string }>({ children: dataset })
    .sum(d => {
      if (!('measurements' in d)) return 0
      if (isOrder) return DEFAULT_SIZE
      return (d as Goal).measurements[opts.activeUnit] ?? DEFAULT_SIZE
    })
    .sort(opts.forceOrder
      ? (a, b) => {
          const aId = 'id' in a.data ? (a.data as { id: string }).id : undefined
          const bId = 'id' in b.data ? (b.data as { id: string }).id : undefined
          const ai = aId ? opts.forceOrder!.indexOf(aId) : -1
          const bi = bId ? opts.forceOrder!.indexOf(bId) : -1
          if (ai === -1) return 1
          if (bi === -1) return -1
          return ai - bi
        }
      : (a, b) => {
          const aId = 'id' in a.data ? a.data.id : undefined
          const bId = 'id' in b.data ? b.data.id : undefined
          if (aId === UNALLOCATED_ID && bId !== UNALLOCATED_ID) return 1
          if (aId !== UNALLOCATED_ID && bId === UNALLOCATED_ID) return -1
          const av = 'measurements' in a.data ? (a.data as Goal).measurements[opts.sortUnit] ?? 0 : 0
          const bv = 'measurements' in b.data ? (b.data as Goal).measurements[opts.sortUnit] ?? 0 : 0
          return opts.sortUnitKind === 'order' ? av - bv : bv - av
        })

  treemap<{ children?: Goal[]; id?: string }>()
    .tile(treemapSquarify.ratio(1))
    .size([Math.max(1, w), Math.max(1, h)])
    .paddingInner(3)
    .paddingOuter(0)(root)

  const leaves = root.leaves() as unknown as HierarchyRectangularNode<Goal>[]

  const atoms: AtomGeometry[] = leaves.map(node => {
    const g = node.data
    const isPhantom = g.id === UNALLOCATED_ID
    const cellW = Math.max(0, node.x1 - node.x0)
    const cellH = Math.max(0, node.y1 - node.y0)
    const rectParams = { x: 0, y: 0, w: cellW, h: cellH, rx: 6 }
    const v = g.measurements[opts.activeUnit]
    return {
      id: g.id,
      fill: g.color,
      shapeTransform: `translate(${node.x0},${node.y0})`,
      d: rectPath(rectParams),
      nameTransform: `translate(12, 26)`,
      valueTransform: `translate(12, 42)`,
      nameText: g.name,
      valueText: isOrder ? '' : v != null ? `${v} ${opts.activeUnit}` : `— ${opts.activeUnit}`,
      textAnchor: 'start',
      labelOpacity: cellW < MIN_LABEL_W || cellH < MIN_LABEL_H ? 0 : 1,
      rectParams,
      isPhantom,
    }
  })

  return {
    atoms,
    meta: { mode: 'treemap', width: w, height: h, total: allocated },
  }
}
