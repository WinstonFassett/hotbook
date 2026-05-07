export type UnitKind = 'size' | 'order'

export interface Goal {
  id: string
  name: string
  color: string
  measurements: Record<string, number>
  archived: boolean
  tags: string[]
  urgent: boolean
  important: boolean
  createdAt: string
  updatedAt: string
}

export type ViewMode = 'treemap' | 'radial' | 'bands' | 'h-treemap' | 'h-icicle' | 'h-radial'

export interface GoalTree {
  id: string
  name: string
  color: string
  value: number
  children?: GoalTree[]
}
