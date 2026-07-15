import type { Dataset } from '../schema/v11'
import type { PEdge } from '@fiddleviz/core'

const NOW = '2026-05-13T12:00:00.000Z'

/**
 * Dataset 4: Supply chain (flat edge-list for Sankey)
 */
export function buildSupplyChainDataset(): Dataset {
  const NODES = ['Mining', 'Refining', 'Manufacturing', 'Warehouse', 'Retail', 'Export']
  const edges: PEdge[] = [
    { source: 'Mining',        target: 'Refining',       value: 80 },
    { source: 'Mining',        target: 'Export',         value: 20 },
    { source: 'Refining',      target: 'Manufacturing',  value: 65 },
    { source: 'Refining',      target: 'Export',         value: 15 },
    { source: 'Manufacturing', target: 'Warehouse',      value: 50 },
    { source: 'Manufacturing', target: 'Retail',         value: 15 },
    { source: 'Warehouse',     target: 'Retail',         value: 40 },
    { source: 'Warehouse',     target: 'Export',         value: 10 },
  ]
  return {
    id: 'ds-supply',
    name: 'Supply chain (sankey)',
    createdAt: NOW,
    shape: 'graph',
    nodes: [],
    edges,
    measureDefs: [],
    dimDefs: [],
  }
}
