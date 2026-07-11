export interface Filter {
  field: string
  op: 'eq' | 'neq' | 'in' | 'gt' | 'lt' | 'contains'
  value: unknown
}

export interface Sort {
  field: string      // measure key, dim key, '_index', or '_value'
  dir: 'asc' | 'desc'
}

export interface Dimension {
  field: string      // a dim key or measure key
}

export interface Query {
  sourceId?: string
  filters?: Filter[]
  sorts?: Sort[]

  // Structural grouping for hierarchical levels.
  // Raw nodes are preserved; synthetic group nodes may be added above them.
  levelBy?: Dimension[]

  // Destructive aggregation (out of scope for minimal implementation).
  // Raw nodes are collapsed into one aggregated node per dimension combination.
  aggregateBy?: Dimension[]
}
