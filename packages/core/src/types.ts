export type UnitKind = 'size' | 'order'

export interface VizNode {
  id: string
  parentId: string | null
  index: number
  name: string
  measures: Record<string, number>
  dims: Record<string, string>
  color?: string
}

/** @deprecated use `VizNode` */
export type PNode = VizNode

export interface PEdge {
  id?: string
  source: string            // references VizNode.id
  target: string            // references VizNode.id
  value: number
  lag?: number
  measures?: Record<string, number>
  dims?: Record<string, string>
}

export interface ColumnSchema {
  key: string
  label: string
  type: 'measure' | 'dim' | 'name' | 'parent-ref' | 'edge-source' | 'edge-target'
  rollup?: 'sum' | 'max' | 'mean' | 'none'
  unit?: string
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
  onReorder?: (orderedIds: string[]) => void
  onGoalClick?: (goal: Goal) => void
}

export interface HVizCallbacks {
  onLeafClick?: (id: string) => void
}

export interface hotbookChangeEvent {
  type: 'change'
  id: string
  patch: Partial<Goal>
}

export interface hotbookClickEvent {
  type: 'click'
  goal: Goal
}

export type hotbookEvent = hotbookChangeEvent | hotbookClickEvent

export type Cleanup = () => void

export type ScalingMode = 'additive' | 'proportional-neighbor' | 'proportional-siblings'

export interface VizConfigSchema {
  pickers: {
    measure?: boolean
    depth?: boolean       // 1–5 level selector
    sort?: boolean        // Order | Value
    groupBy?: boolean
    xKey?: boolean        // scatter only
    yKey?: boolean        // scatter only
    orientation?: boolean
  }
  gestureModes?: ScalingMode[]
  cascadeSupported?: boolean
  fixedTotalSupported?: boolean
  scrollBody?: boolean    // replaces SCROLL_KINDS
  drillKey?: string       // default "default" — tiles with same drillKey share drill context
  showBreadcrumb?: boolean // default true for hier charts when drilled
}
