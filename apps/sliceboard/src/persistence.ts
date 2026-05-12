import type { PNode, Measurement } from '@winstonfassett/vizform-react'
import type { LayoutItem } from 'react-grid-layout'

export type { PNode, Measurement }

// ─── Column schema ────────────────────────────────────────────────────────────

export type ColumnType = 'number' | 'text'

export interface Column {
  key: string
  label: string
  type: ColumnType
  /** For number columns — rollup strategy */
  rollup?: Measurement['rollup']
  /** For number columns — display unit */
  unit?: string
}

// ─── Dataset ──────────────────────────────────────────────────────────────────

export interface Dataset {
  id: string
  name: string
  createdAt: string
  nodes: PNode[]
  columns: Column[]
}

// ─── Dashboard tile ───────────────────────────────────────────────────────────

export type TileKind =
  | 'treetable'
  | 'treemap'
  | 'radial'
  | 'bands'
  | 'h-treemap'
  | 'h-icicle'
  | 'h-radial'

export interface Tile {
  id: string
  kind: TileKind
  title?: string
  /** Per-tile measure override; falls back to dashboard.measureKey */
  measureKey?: string
  /** Per-tile groupBy override */
  groupBy?: string
  /** Per-tile color-by column key */
  colorBy?: string
  /** For hierarchical tiles: how many descendant levels to render below focus. Default 2. */
  depth?: number
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface Dashboard {
  id: string
  datasetId: string
  name: string
  createdAt: string
  /** RGL layout array — one entry per tile id */
  layout: LayoutItem[]
  tiles: Tile[]
  /** Global measure for tiles without an override */
  measureKey: string
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export interface Workspace {
  datasets: Dataset[]
  dashboards: Dashboard[]
  activeDatasetId: string
  activeDashboardId: string
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const LS_KEY = 'sb:workspace:v3'

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ─── Seed data ────────────────────────────────────────────────────────────────

const NOW = '2026-05-12T12:00:00.000Z'
const PALETTE = ['#e08888', '#d4a86c', '#7ec87e', '#7aaae8', '#b090e0', '#60c4c0']

let _idCounter = 0
function nid(): string { return `n${++_idCounter}` }

interface TaskSpec { name: string; status?: PNode['status']; estimate?: number; actual?: number }
interface SubSpec { name: string; status?: PNode['status']; tasks: TaskSpec[] }
interface ProjSpec { name: string; status?: PNode['status']; subs: SubSpec[] }
interface GoalSpec { name: string; color: string; projects: ProjSpec[] }

function makeTask(t: TaskSpec, parentId: string, index: number): PNode {
  return {
    id: nid(), type: 'task', parentId, index,
    name: t.name, status: t.status ?? 'todo', tags: [],
    measurements: {
      estimate_hours: t.estimate ?? 4,
      ...(t.actual != null ? { actual_hours: t.actual } : {}),
    },
    createdAt: NOW, updatedAt: NOW,
  }
}

function makeSub(s: SubSpec, parentId: string, index: number, color: string): PNode[] {
  const id = nid()
  const sub: PNode = {
    id, type: 'subproject', parentId, index,
    name: s.name, status: s.status ?? 'todo', tags: [],
    measurements: {}, color,
    createdAt: NOW, updatedAt: NOW,
  }
  return [sub, ...s.tasks.map((t, i) => makeTask(t, id, i + 1))]
}

function makeProject(p: ProjSpec, parentId: string, index: number, color: string): PNode[] {
  const id = nid()
  const proj: PNode = {
    id, type: 'project', parentId, index,
    name: p.name, status: p.status ?? 'doing', tags: [],
    measurements: {}, color,
    createdAt: NOW, updatedAt: NOW,
  }
  return [proj, ...p.subs.flatMap((s, i) => makeSub(s, id, i + 1, color))]
}

function makeGoal(g: GoalSpec, index: number): PNode[] {
  const id = nid()
  const goal: PNode = {
    id, type: 'goal', parentId: null, index,
    name: g.name, status: 'doing', tags: [],
    measurements: {}, color: g.color,
    createdAt: NOW, updatedAt: NOW,
  }
  return [goal, ...g.projects.flatMap((p, i) => makeProject(p, id, i + 1, g.color))]
}

const GOAL_SPECS: GoalSpec[] = [
  {
    name: 'Ship vizform v1',
    color: PALETTE[0],
    projects: [
      {
        name: 'Core renderer',
        subs: [
          {
            name: 'Flat viz',
            tasks: [
              { name: 'Treemap layout', status: 'done', estimate: 4, actual: 3.5 },
              { name: 'Radial layout', status: 'done', estimate: 4, actual: 4 },
              { name: 'Bands layout', status: 'done', estimate: 3, actual: 2.5 },
            ],
          },
          {
            name: 'Hierarchical viz',
            status: 'doing',
            tasks: [
              { name: 'H-treemap drill', status: 'done', estimate: 8, actual: 10 },
              { name: 'H-icicle drill', status: 'done', estimate: 6, actual: 5 },
              { name: 'H-radial drill', status: 'done', estimate: 6, actual: 6 },
              { name: 'PNode data model', status: 'done', estimate: 6, actual: 4 },
              { name: 'Treetable view', status: 'doing', estimate: 8 },
            ],
          },
        ],
      },
      {
        name: 'Sliceboard app',
        status: 'doing',
        subs: [
          {
            name: 'Data layer',
            tasks: [
              { name: 'Persistence + seed', status: 'doing', estimate: 3, actual: 2 },
              { name: 'Workspace model', status: 'doing', estimate: 4 },
            ],
          },
          {
            name: 'UI',
            tasks: [
              { name: 'Topbar + board menu', status: 'done', estimate: 2, actual: 2 },
              { name: 'HUD layout', status: 'todo', estimate: 6 },
              { name: 'RGL tile grid', status: 'todo', estimate: 8 },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Health & longevity',
    color: PALETTE[2],
    projects: [
      {
        name: 'Strength',
        subs: [
          {
            name: 'Barbell',
            tasks: [
              { name: 'Squat session', status: 'doing', estimate: 1, actual: 0.5 },
              { name: 'Deadlift session', status: 'done', estimate: 1, actual: 1 },
              { name: 'Press session', status: 'todo', estimate: 1 },
            ],
          },
          {
            name: 'Cardio',
            tasks: [
              { name: 'Zone 2 run', status: 'todo', estimate: 0.75 },
              { name: 'HIIT intervals', status: 'todo', estimate: 0.5 },
            ],
          },
        ],
      },
      {
        name: 'Sleep',
        status: 'review',
        subs: [
          {
            name: 'Hygiene',
            tasks: [
              { name: 'No screens after 10pm', status: 'doing', estimate: 0.5, actual: 0.25 },
              { name: 'Morning light', status: 'doing', estimate: 0.25, actual: 0.25 },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Open source',
    color: PALETTE[3],
    projects: [
      {
        name: 'tix CLI',
        subs: [
          {
            name: 'Core',
            tasks: [
              { name: 'Dep graph cmd', status: 'doing', estimate: 6, actual: 3 },
              { name: 'Acceptance criteria DSL', status: 'review', estimate: 4, actual: 4 },
            ],
          },
          {
            name: 'Web viewer',
            tasks: [
              { name: 'React shell', status: 'todo', estimate: 5 },
              { name: 'Graph visualization', status: 'todo', estimate: 8 },
            ],
          },
        ],
      },
    ],
  },
]

function buildSeedNodes(): PNode[] {
  _idCounter = 0
  return GOAL_SPECS.flatMap((g, i) => makeGoal(g, i + 1))
}

const SEED_COLUMNS: Column[] = [
  { key: 'estimate_hours', label: 'Estimate', type: 'number', rollup: 'sum', unit: 'h' },
  { key: 'actual_hours', label: 'Actual', type: 'number', rollup: 'sum', unit: 'h' },
]

function buildSeedWorkspace(): Workspace {
  const dsId = 'ds-vizform'
  const dash1Id = 'dash-overview'
  const dash2Id = 'dash-shape'

  const t1: Tile = { id: 'tile-table', kind: 'treetable', title: 'Tasks' }
  const t2: Tile = { id: 'tile-treemap', kind: 'h-treemap', title: 'Treemap' }
  const t3: Tile = { id: 'tile-icicle', kind: 'h-icicle', title: 'Icicle' }

  const overviewLayout: LayoutItem[] = [
    { i: t1.id, x: 0, y: 0, w: 6, h: 12 },
    { i: t2.id, x: 6, y: 0, w: 6, h: 6 },
    { i: t3.id, x: 6, y: 6, w: 6, h: 6 },
  ]

  const t4: Tile = { id: 'tile-radial', kind: 'radial', title: 'Radial' }
  const t5: Tile = { id: 'tile-sunburst', kind: 'h-radial', title: 'Sunburst' }

  const detailLayout: LayoutItem[] = [
    { i: t4.id, x: 0, y: 0, w: 6, h: 12 },
    { i: t5.id, x: 6, y: 0, w: 6, h: 12 },
  ]

  return {
    datasets: [
      {
        id: dsId,
        name: 'vizform roadmap',
        createdAt: NOW,
        nodes: buildSeedNodes(),
        columns: SEED_COLUMNS,
      },
    ],
    dashboards: [
      {
        id: dash1Id,
        datasetId: dsId,
        name: 'Overview',
        createdAt: NOW,
        layout: overviewLayout,
        tiles: [t1, t2, t3],
        measureKey: 'estimate_hours',
      },
      {
        id: dash2Id,
        datasetId: dsId,
        name: 'Shape',
        createdAt: NOW,
        layout: detailLayout,
        tiles: [t4, t5],
        measureKey: 'estimate_hours',
      },
    ],
    activeDatasetId: dsId,
    activeDashboardId: dash1Id,
  }
}

// ─── Load / save ──────────────────────────────────────────────────────────────

function load(): Workspace | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Workspace
  } catch {
    return null
  }
}

function save(ws: Workspace): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ws))
  } catch { /* storage unavailable */ }
}

export function initWorkspace(): Workspace {
  const stored = load()
  if (stored) return stored
  const ws = buildSeedWorkspace()
  save(ws)
  return ws
}

export function saveWorkspace(ws: Workspace): void {
  save(ws)
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function updateNode(ws: Workspace, dsId: string, nodeId: string, patch: Partial<PNode>): Workspace {
  return {
    ...ws,
    datasets: ws.datasets.map(ds =>
      ds.id !== dsId ? ds : {
        ...ds,
        nodes: ds.nodes.map(n => n.id !== nodeId ? n : { ...n, ...patch, updatedAt: new Date().toISOString() }),
      }
    ),
  }
}

export function createDataset(ws: Workspace, name: string): Workspace {
  const ds: Dataset = {
    id: genId(),
    name,
    createdAt: new Date().toISOString(),
    nodes: buildSeedNodes(),
    columns: SEED_COLUMNS,
  }
  return { ...ws, datasets: [...ws.datasets, ds] }
}

export function createDashboard(ws: Workspace, name: string, datasetId: string): Workspace {
  const ds = ws.datasets.find(d => d.id === datasetId)
  const dash: Dashboard = {
    id: genId(),
    datasetId,
    name,
    createdAt: new Date().toISOString(),
    layout: [],
    tiles: [],
    measureKey: ds?.columns.find(c => c.type === 'number')?.key ?? '',
  }
  return { ...ws, dashboards: [...ws.dashboards, dash] }
}

export function updateDataset(ws: Workspace, ds: Dataset): Workspace {
  return { ...ws, datasets: ws.datasets.map(d => d.id === ds.id ? ds : d) }
}

export function updateDashboard(ws: Workspace, dash: Dashboard): Workspace {
  return { ...ws, dashboards: ws.dashboards.map(d => d.id === dash.id ? dash : d) }
}

export function addTile(ws: Workspace, dashId: string, kind: TileKind): Workspace {
  const dash = ws.dashboards.find(d => d.id === dashId)
  if (!dash) return ws
  const tile: Tile = { id: genId(), kind }
  const layout: LayoutItem = { i: tile.id, x: 0, y: Infinity, w: 6, h: 8 }
  const next: Dashboard = {
    ...dash,
    tiles: [...dash.tiles, tile],
    layout: [...dash.layout, layout],
  }
  return updateDashboard(ws, next)
}

export function removeTile(ws: Workspace, dashId: string, tileId: string): Workspace {
  const dash = ws.dashboards.find(d => d.id === dashId)
  if (!dash) return ws
  const next: Dashboard = {
    ...dash,
    tiles: dash.tiles.filter(t => t.id !== tileId),
    layout: dash.layout.filter(l => l.i !== tileId),
  }
  return updateDashboard(ws, next)
}

export function deleteDashboard(ws: Workspace, dashId: string): Workspace {
  const remaining = ws.dashboards.filter(d => d.id !== dashId)
  const nextActive = remaining[0]?.id ?? ''
  return { ...ws, dashboards: remaining, activeDashboardId: nextActive }
}

export function deleteDataset(ws: Workspace, dsId: string): Workspace {
  const datasets = ws.datasets.filter(d => d.id !== dsId)
  const dashboards = ws.dashboards.filter(d => d.datasetId !== dsId)
  const nextDs = datasets[0]?.id ?? ''
  const nextDash = dashboards[0]?.id ?? ''
  return { ...ws, datasets, dashboards, activeDatasetId: nextDs, activeDashboardId: nextDash }
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function activeDataset(ws: Workspace): Dataset | undefined {
  return ws.datasets.find(d => d.id === ws.activeDatasetId)
}

export function activeDashboard(ws: Workspace): Dashboard | undefined {
  return ws.dashboards.find(d => d.id === ws.activeDashboardId)
}

export function dashboardsForDataset(ws: Workspace, dsId: string): Dashboard[] {
  return ws.dashboards.filter(d => d.datasetId === dsId)
}

export function measurementsFromColumns(columns: Column[]): Measurement[] {
  return columns
    .filter(c => c.type === 'number')
    .map(c => ({ key: c.key, label: c.label, unit: c.unit ?? '', rollup: c.rollup ?? 'sum' }))
}
