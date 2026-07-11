/**
 * tile-views.ts — View runtime objects (Source → QuerySource → Adapter → Chart).
 *
 * Implements the data-view seam from whiteboard §7. Each tile owns a View
 * runtime object: { spec, source, querySource, adapter, chart }.
 *
 * Replaces the ad-hoc tile-source resolution in tile-sources.ts with the
 * Source → QuerySource → Adapter → Chart pipeline.
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
import { resolveTileBindings } from './tile-sources'

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

/** Color nodes by ancestor group color */
function colorByGroup(nodes: VizNode[]): VizNode[] {
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

/** Build a View for a tile + dataset. */
export function buildTileView(
  tile: Tile,
  ds: Dataset,
  measureKey: string,
): TileView {
  const { valueBinding, orderBinding, orderDir } = resolveTileBindings(tile, measureKey)

  // 1. Source — plain mutable source from dataset nodes
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

  // 4. Adapter — bireactive for all charts (WIN-244 bireactiveValueStore)
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

  // Apply full-value patch to the source
  view.source.applyPatch({
    unit: 'nodes',
    range: '',
    content: rawNodes,
    context: { phase: 'updateNow' },
  })
}
