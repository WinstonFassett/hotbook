import type { TileKind, Workspace } from '../schema/v11'
import { buildLifeDataset } from './life-goals'
import { buildFruitDataset } from './fruit'
import { buildTeamDataset } from './teams'
import { buildSupplyChainDataset } from './supply'
import { buildGanttDataset } from './gantt'

const NOW = '2026-05-13T12:00:00.000Z'

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Build the default seed workspace with all demo datasets and dashboards.
 */
export function buildSeedWorkspace(): Workspace {
  const life   = buildLifeDataset()
  const fruit  = buildFruitDataset()
  const team   = buildTeamDataset()
  const supply = buildSupplyChainDataset()
  const gantt  = buildGanttDataset()

  // Canon viz kinds for seed dashboard (retired gen-0/Svelte kinds excluded).
  // Hierarchical charts first (top row) for drill dogfooding.
  const ALL_KINDS: TileKind[] = [
    'pack', 'treemap', 'treetable', 'icicle', 'sunburst',
    'bar', 'bands', 'line', 'area', 'scatter', 'pie',
    'radar', 'concentric-arc',
    'sankey', 'tree', 'gantt',
  ]

  const GROUPBY_KINDS = new Set<TileKind>([
    'pack', 'treemap', 'treetable', 'icicle', 'sunburst', 'sankey', 'tree',
  ])

  function makeAllVizDash(prefix: string, flatGroupBy?: string) {
    const tiles = ALL_KINDS.map((kind, i) => ({
      id: `${prefix}-${i}`,
      kind,
      title: kind,
      ...(flatGroupBy && GROUPBY_KINDS.has(kind) ? { groupBy: flatGroupBy } : {}),
    }))
    const layout = ALL_KINDS.map((_, i) => ({
      i: `${prefix}-${i}`,
      x: (i % 4) * 3,
      y: Math.floor(i / 4) * 5,
      w: 3,
      h: 5,
    }))
    return { tiles, layout }
  }

  const lifeViz  = makeAllVizDash('lf', 'level')
  const fruitViz = makeAllVizDash('fr', 'group')
  const teamViz  = makeAllVizDash('tm', 'role')

  const supplyTiles = [{ id: 'sp-0', kind: 'sankey' as const, title: 'Supply chain' }]
  const supplyLayout = [{ i: 'sp-0', x: 0, y: 0, w: 12, h: 8 }]

  const ganttTiles = [{ id: 'gt-0', kind: 'gantt' as const, title: 'Project schedule' }]
  const ganttLayout = [{ i: 'gt-0', x: 0, y: 0, w: 12, h: 8 }]

  return {
    datasets: [life, fruit, team, supply, gantt],
    dashboards: [
      { id: 'dash-life',    datasetId: life.id,    name: 'Life',             createdAt: NOW, layout: lifeViz.layout,   tiles: lifeViz.tiles,    measureKey: 'est' },
      { id: 'dash-fruit',   datasetId: fruit.id,   name: 'Fruit',            createdAt: NOW, layout: fruitViz.layout,  tiles: fruitViz.tiles,   measureKey: 'value' },
      { id: 'dash-team',    datasetId: team.id,    name: 'Team',             createdAt: NOW, layout: teamViz.layout,   tiles: teamViz.tiles,    measureKey: 'budget' },
      { id: 'dash-supply',  datasetId: supply.id,  name: 'Supply chain',     createdAt: NOW, layout: supplyLayout,     tiles: supplyTiles,      measureKey: 'value' },
      { id: 'dash-gantt',   datasetId: gantt.id,   name: 'Project schedule', createdAt: NOW, layout: ganttLayout,      tiles: ganttTiles,       measureKey: 'start' },
    ],
    activeDatasetId: life.id,
    activeDashboardId: 'dash-life',
  }
}
