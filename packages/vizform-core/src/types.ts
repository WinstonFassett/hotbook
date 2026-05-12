export type UnitKind = 'size' | 'order'

export type NodeType = 'goal' | 'project' | 'subproject' | 'task'
export type Status = 'todo' | 'doing' | 'review' | 'done' | 'blocked'

export interface PNode {
  id: string
  type: NodeType
  parentId: string | null
  index: number
  name: string
  status: Status
  tags: string[]
  measurements: Record<string, number>
  color?: string
  createdAt: string
  updatedAt: string
}

export type Rollup = 'sum' | 'max' | 'mean' | 'none'

export interface Measurement {
  key: string
  label: string
  unit: string
  rollup: Rollup
}

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

export type ViewMode = 'treemap' | 'radial' | 'bands' | 'h-treemap' | 'h-icicle' | 'h-radial' | 'treetable'
export type FlatMode = 'treemap' | 'radial' | 'bands'
export type HierMode = 'h-treemap' | 'h-icicle' | 'h-radial' | 'treetable'

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
