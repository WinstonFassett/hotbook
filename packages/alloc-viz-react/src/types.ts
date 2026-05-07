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

export type ViewMode = 'treemap' | 'radial' | 'bands'
