import type { Goal, UnitKind } from '../types'

export type VizMode = 'treemap' | 'radial' | 'bands'

export interface LayoutOpts {
  activeUnit: string
  unitKind: UnitKind
  sortUnit: string
  sortUnitKind: UnitKind
  frame?: number  // size-unit only; if set and > total, render unallocated remainder
}

export const UNALLOCATED_ID = '__unallocated__'
export const UNALLOCATED_FILL = 'oklch(0.28 0 0)'

export function phantomGoal(unallocated: number, activeUnit: string): Goal {
  return {
    id: UNALLOCATED_ID,
    name: 'Unallocated',
    color: UNALLOCATED_FILL,
    measurements: { [activeUnit]: unallocated },
    archived: false,
    tags: [],
    urgent: false,
    important: false,
    createdAt: '',
    updatedAt: '',
  }
}

export interface RectParams {
  x: number
  y: number
  w: number
  h: number
  rx: number
}

export interface ArcParams {
  startAngle: number
  endAngle: number
  innerRadius: number
  outerRadius: number
  cornerRadius: number
  padAngle: number
}

export interface AtomGeometry {
  id: string
  fill: string
  shapeTransform: string
  d: string
  nameTransform: string
  valueTransform: string
  nameText: string
  valueText: string
  textAnchor: 'start' | 'middle' | 'end'
  labelOpacity: number
  rectParams?: RectParams
  arcParams?: ArcParams
  isPhantom?: boolean  // unallocated remainder; non-interactive
}

export interface LayoutMeta {
  mode: VizMode
  width: number
  height: number
  total: number
  cx?: number
  cy?: number
  outerR?: number
  innerR?: number
  trackX?: number
  trackW?: number
  rowStep?: number
  rankX?: number
  rankW?: number
  rowH?: number
  topPad?: number
}

export interface LayoutResult {
  atoms: AtomGeometry[]
  meta: LayoutMeta
}
