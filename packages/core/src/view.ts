import type { Source } from './source'
import type { QuerySource } from './query-source'
import type { Query } from './query'
import type { ValueStore } from './value-store'

// ViewConfig is chart-specific configuration.
export interface ViewConfig {
  kind: 'bar' | 'line' | 'pack' | 'table' | string
  measureKey?: string
  xField?: string
  sortDir?: 'asc' | 'desc'
  // chart-specific options (extensible)
  [key: string]: unknown
}

// DataView is a workspace-level declaration of a view.
// It says: take a source, apply this query, render with this adapter/config.
export interface DataView {
  id: string
  query: Query
  // adapter key selects the strategy (bireactive or plain)
  adapter: string
  config: ViewConfig
}

// Chart is the renderer interface.
export interface Chart<T> {
  mount(store: ValueStore<T>, container: HTMLElement): void
  dispose(): void
}

// Adapter factory interface.
// An Adapter creates a living ValueStore from a QuerySource.
// Concrete implementations (BireactiveValueStore, etc.) come in WIN-244.
export interface Adapter<T> {
  key: string
  create(querySource: QuerySource<T>): ValueStore<T>
}

// View is the runtime object created from a DataView + Source.
// The viewer resolves DataView → View.
export interface View<T = unknown> {
  spec: DataView
  source: Source<T>
  querySource: QuerySource<T>
  adapter: ValueStore<T> // the living adapter
  chart: Chart<T>
}

// Adapter registry placeholder (implementation in WIN-244).
// The viewer picks the Adapter by spec.adapter key.
export const adapterRegistry = new Map<string, Adapter<any>>()
