/**
 * tile-views.ts — View runtime objects (Source → QuerySource → Adapter → Chart).
 *
 * Implements the data-view seam from whiteboard §7. Each tile owns a View
 * runtime object: { spec, source, querySource, adapter, chart }.
 *
 * WIN-245 Option A (facade): buildTileSource routes rawNodes through the
 * QuerySource returned here. The bireactive adapter is constructed but its
 * getValue() is deferred until the gesture-migration follow-up (whiteboard §3
 * updatePending/updateNow routing).
 */

import type { VizNode, Tile, Dataset } from './persistence'
import {
  plainSource,
  plainQuerySource,
  type Source,
  type QuerySource,
  type ValueStore,
  type Query,
} from '@hotbook/core'
import { bireactiveValueStore } from '@hotbook/bireactive'
import { applyGroupBy } from './persistence'
import { colorFor } from '@hotbook/core'

// ─── Shared tile helpers (moved from tile-sources.ts to break circular import) ─

/** Resolve tile bindings, falling back to deprecated aliases. */
export function resolveTileBindings(tile: Tile, defaultValueBinding: string) {
  const valueBinding = tile.valueBinding ?? tile.measureKey ?? defaultValueBinding
  const xBinding = tile.xBinding ?? tile.xKey
  const yBinding = tile.yBinding ?? tile.yKey
  const orderBinding = tile.orderBinding ?? tile.sortBy ?? 'index'
  const orderDir = tile.orderDir ?? (orderBinding === 'value' ? 'desc' : 'asc')
  return { valueBinding, xBinding, yBinding, orderBinding, orderDir }
}

/** Color nodes by ancestor group color. */
export function colorByGroup(nodes: VizNode[]): VizNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const nearestColor = (n: VizNode): string => {
    let cur = n
    while (true) {
      if (cur.color) return cur.color
      if (!cur.parentId || !byId.has(cur.parentId)) return colorFor(cur.name)
      cur = byId.get(cur.parentId)!
    }
  }
  return nodes.map(n => ({ ...n, color: n.color ?? nearestColor(n) }))
}

// ─── View runtime ─────────────────────────────────────────────────────────────

/**
 * TileView — the runtime object for a tile (whiteboard §7).
 *
 * Each tile owns:
 * - source: base data (Dataset → Source<VizNode[]>)
 * - querySource: filtered/sorted view (Source + Query → QuerySource)
 * - adapter: living ValueStore (QuerySource → Adapter)
 * - (chart: rendered element, owned by DockView/bindTile)
 */
export interface TileView {
  source: Source<VizNode[]>
  querySource: QuerySource<VizNode[]>
  adapter: ValueStore<VizNode[]>
  tile: Tile
  dataset: Dataset
  measureKey: string
}

/** Build a View for a tile + dataset. */
export function buildTileView(
  tile: Tile,
  ds: Dataset,
  measureKey: string,
): TileView {
  const { valueBinding, orderBinding, orderDir } = resolveTileBindings(tile, measureKey)

  // 1. Source — plain mutable source from dataset nodes (post groupBy + color)
  const rawNodes = colorByGroup(tile.groupBy ? applyGroupBy(ds.nodes, tile.groupBy) : ds.nodes)
  const source = plainSource<VizNode[]>(rawNodes)

  // 2. Query — filter/sort from tile spec (levelBy/aggregateBy out of scope)
  const sortField = orderBinding === 'value' || orderBinding === '_value'
    ? valueBinding
    : orderBinding === 'index' || orderBinding === '_index'
      ? '_index'
      : orderBinding

  const query: Query = {
    sourceId: ds.id ?? 'dataset',
    filters: [],
    sorts: [{ field: sortField, dir: orderDir }],
  }

  // 3. QuerySource — apply query to source
  const querySource = plainQuerySource(source, query)

  // 4. Adapter — bireactive for all charts (WIN-244 bireactiveValueStore).
  //    Constructed but not read here; the gesture-migration follow-up will
  //    route updatePending/updateNow patches through it.
  const adapter = bireactiveValueStore(querySource)

  return {
    source,
    querySource,
    adapter,
    tile,
    dataset: ds,
    measureKey: valueBinding,
  }
}

/** Update an existing View with new source data (dataset changed, tile spec unchanged). */
export function updateTileView(
  view: TileView,
  ds: Dataset,
): void {
  const { tile } = view
  const rawNodes = colorByGroup(tile.groupBy ? applyGroupBy(ds.nodes, tile.groupBy) : ds.nodes)

  view.source.applyPatch({
    unit: 'nodes',
    range: '',
    content: rawNodes,
    context: { phase: 'updateNow' },
  })
}
