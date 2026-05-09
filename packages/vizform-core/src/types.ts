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
export type FlatMode = 'treemap' | 'radial' | 'bands'
export type HierMode = 'h-treemap' | 'h-icicle' | 'h-radial'

export interface GoalTree {
  id: string
  name: string
  color: string
  value: number
  children?: GoalTree[]
}

export interface VizConfig {
  mode: FlatMode
  activeUnit: string
  unitKind: UnitKind
  sortUnit: string
  sortUnitKind: UnitKind
  frame?: number
}

export interface HVizConfig {
  mode: HierMode
}

export interface VizCallbacks {
  onUpdate: (id: string, patch: Partial<Goal>) => void
  onGoalClick?: (goal: Goal) => void
}

export interface HVizCallbacks {
  onLeafClick?: (id: string) => void
}

export interface VizFormChangeEvent {
  type: 'change'
  id: string
  patch: Partial<Goal>
}

export interface VizFormClickEvent {
  type: 'click'
  goal: Goal
}

export type VizFormEvent = VizFormChangeEvent | VizFormClickEvent

export type Cleanup = () => void
