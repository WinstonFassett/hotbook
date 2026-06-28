import type { PNode } from '@winstonfassett/vizform-react-d3'
import type { PEdge, ScalingMode } from '@winstonfassett/vizform-core'
import { colorFor } from '@winstonfassett/vizform-core'
import type { LayoutItem } from 'react-grid-layout'

export type { PNode, PEdge }

// ─── Schema defs ──────────────────────────────────────────────────────────────

export interface MeasureDef {
  key: string
  label: string
  unit?: string
}

export interface PEdge {
  source: string
  target: string
  value: number
}

export interface DimDef {
  key: string
  label: string
  values?: string[]
}

// ─── Dataset ──────────────────────────────────────────────────────────────────

export interface Dataset {
  id: string
  name: string
  createdAt: string
  shape: 'flat' | 'tree' | 'graph'
  rows: PNode[]
  edges?: PEdge[]
  measureDefs: MeasureDef[]
  dimDefs: DimDef[]
}

// ─── Dashboard tile ───────────────────────────────────────────────────────────

// Gen-0 and Svelte variants are retired from the picker but kept as string literals
// so old persisted dashboards don't crash if encountered.
export type RetiredTileKind =
  | 'treemap' | 'radial' | 'bands'           // gen-0 flat morph trio
  | 'h-treemap' | 'h-icicle' | 'h-radial'   // gen-0 hier D3
  | 'svelte-br-lc-sunburst' | 'svelte-br-lc-icicle' | 'svelte-br-lc-pack' | 'svelte-br-lc-treemap' | 'svelte-treemap-demo'

export type TileKind =
  | 'treetable'
  // bireactive LC-port charts (canon)
  | 'br-lc-bar'
  | 'br-lc-bands'
  | 'br-lc-line'
  | 'br-lc-area'
  | 'br-lc-scatter'
  | 'br-lc-pie'
  | 'br-lc-radar'
  | 'br-lc-concentric-arc'
  | 'br-lc-pack'
  | 'br-lc-treemap'
  | 'br-lc-icicle'
  | 'br-lc-sunburst'
  | 'br-lc-sankey'
  | 'br-lc-sankey-flow'
  | 'br-lc-tree'
  | RetiredTileKind

export interface Tile {
  id: string
  kind: TileKind
  title?: string
  measureKey?: string
  xKey?: string
  yKey?: string
  groupBy?: string
  depth?: number
  sortBy?: 'index' | 'value'
  orientation?: 'vertical' | 'horizontal'
  colorMode?: 'single' | 'palette'
  labelMode?: 'axis' | 'inside' | 'both'
  valueMode?: 'inside' | 'outside' | 'none'
  minBandSize?: number
  maxItems?: number
  scalingMode?: ScalingMode
  cascadeEnabled?: boolean
  fixedTotal?: number | null
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface Dashboard {
  id: string
  datasetId: string
  name: string
  createdAt: string
  layout: LayoutItem[]
  tiles: Tile[]
  measureKey: string
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export interface Workspace {
  datasets: Dataset[]
  dashboards: Dashboard[]
  activeDatasetId: string
  activeDashboardId: string
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const LS_KEY = 'sb:workspace:v10'

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ─── Seed data ────────────────────────────────────────────────────────────────

const NOW = '2026-05-13T12:00:00.000Z'

let _idc = 0
function nid(): string { return `n${++_idc}` }

function row(name: string, measures: Record<string, number>, dims: Record<string, string>, parentId?: string, color?: string): PNode {
  return { id: nid(), parentId: parentId ?? null, index: _idc, name, measures, dims, ...(color ? { color } : {}) }
}

// ─── Seed datasets ────────────────────────────────────────────────────────────
//
// Dataset 1 — Fruit (flat + groupBy demo)
//   Shape: flat (no parentId). 12 rows, 1 measure (value), 2 dims (group, season).
//   Groups: Alpha (Apples/Bananas/Grapes), Beta (Carrots/Dates/Elderberry),
//           Gamma (Eggplant/Fennel/Honeydew), Delta (Jackfruit/Kale/Lemon).
//   Use: exercises flat charts (bar/line/area/pie/radar/concentric-arc/scatter),
//        groupBy demos (group or season → hierarchy for pack/treemap/icicle/sunburst).
//
// Dataset 2 — Team Allocation (2-level hierarchy)
//   Shape: tree (3 quarter roots Q2/Q3/Q4 → team leaves). 16 rows total.
//   Measures: budget (k), headcount. Dims: team, role.
//   Teams per quarter: Design, Frontend, Backend, Infra (+ PM in Q4).
//   Use: exercises hier charts natively (no groupBy needed), scatter (budget vs headcount),
//        multi-measure selector, cross-quarter comparison via flat charts on leaves.
//
// Dataset 3 — Life Areas (4-level hierarchy: goal → project → subproject → task)
//   Shape: tree (5-6 top-level goals, each with 2-3 projects, 2-3 subprojects, 2-5 tasks).
//   Measures: est (hours estimated), act (hours actual, optional).
//   Dims: level (goal/project/subproject/task), status (done/doing/todo).
//   Colors: each goal has a distinct palette color; descendants inherit it.
//   Use: deep hier charts (icicle/sunburst/pack/treemap — depth selector meaningful here),
//        groupBy:'level' groups leaves by level for flat charts,
//        groupBy:'status' clusters by done/doing/todo.
//   Note: all nodes already have parentId (fully hierarchical), so applyGroupBy only
//         re-roots the top-level goal nodes under a virtual parent named by the dim value.
//
// ─────────────────────────────────────────────────────────────────────────────
// ─── Dataset 1: Fruit (flat + groupBy demo) ───────────────────────────────────

function buildFruitDataset(): Dataset {
  _idc = 0
  const rows: PNode[] = [
    row('Apples',      { value: 40 }, { group: 'Alpha', season: 'fall' },     undefined, '#e08888'),
    row('Bananas',     { value: 25 }, { group: 'Alpha', season: 'all-year' }, undefined, '#e08888'),
    row('Grapes',      { value: 35 }, { group: 'Alpha', season: 'fall' },     undefined, '#e08888'),
    row('Carrots',     { value: 30 }, { group: 'Beta',  season: 'spring' },   undefined, '#7aaae8'),
    row('Dates',       { value: 15 }, { group: 'Beta',  season: 'all-year' }, undefined, '#7aaae8'),
    row('Elderberry',  { value: 12 }, { group: 'Beta',  season: 'summer' },   undefined, '#7aaae8'),
    row('Eggplant',    { value: 20 }, { group: 'Gamma', season: 'summer' },   undefined, '#b090e0'),
    row('Fennel',      { value: 10 }, { group: 'Gamma', season: 'fall' },     undefined, '#b090e0'),
    row('Honeydew',    { value: 18 }, { group: 'Gamma', season: 'summer' },   undefined, '#b090e0'),
    row('Jackfruit',   { value: 22 }, { group: 'Delta', season: 'all-year' }, undefined, '#7ec87e'),
    row('Kale',        { value: 14 }, { group: 'Delta', season: 'winter' },   undefined, '#7ec87e'),
    row('Lemon',       { value: 28 }, { group: 'Delta', season: 'all-year' }, undefined, '#7ec87e'),
  ]
  return {
    id: 'ds-fruit',
    name: 'Fruit (demo)',
    createdAt: NOW,
    shape: 'flat' as const,
    rows,
    measureDefs: [{ key: 'value', label: 'Value' }],
    dimDefs: [
      { key: 'group', label: 'Group', values: ['Alpha', 'Beta', 'Gamma', 'Delta'] },
      { key: 'season', label: 'Season', values: ['spring', 'summer', 'fall', 'winter', 'all-year'] },
    ],
  }
}

// ─── Dataset 2: Team allocation (2-level hierarchy + groupBy demo) ────────────

function buildTeamDataset(): Dataset {
  _idc = 0
  const q2id = nid(); const q3id = nid(); const q4id = nid()
  const q2: PNode = { id: q2id, parentId: null, index: 1, name: 'Q2', measures: {}, dims: {}, color: '#7ec87e' }
  const q3: PNode = { id: q3id, parentId: null, index: 2, name: 'Q3', measures: {}, dims: {}, color: '#7aaae8' }
  const q4: PNode = { id: q4id, parentId: null, index: 3, name: 'Q4', measures: {}, dims: {}, color: '#b090e0' }
  const rows: PNode[] = [
    q2, q3, q4,
    row('Design',   { budget: 20, headcount: 2 }, { team: 'Design',   role: 'product' }, q2id),
    row('Frontend', { budget: 35, headcount: 3 }, { team: 'Frontend', role: 'eng' },     q2id),
    row('Backend',  { budget: 30, headcount: 3 }, { team: 'Backend',  role: 'eng' },     q2id),
    row('Infra',    { budget: 15, headcount: 1 }, { team: 'Infra',    role: 'eng' },     q2id),
    row('Design',   { budget: 25, headcount: 2 }, { team: 'Design',   role: 'product' }, q3id),
    row('Frontend', { budget: 40, headcount: 4 }, { team: 'Frontend', role: 'eng' },     q3id),
    row('Backend',  { budget: 25, headcount: 3 }, { team: 'Backend',  role: 'eng' },     q3id),
    row('Infra',    { budget: 10, headcount: 1 }, { team: 'Infra',    role: 'eng' },     q3id),
    row('Design',   { budget: 30, headcount: 2 }, { team: 'Design',   role: 'product' }, q4id),
    row('Frontend', { budget: 45, headcount: 4 }, { team: 'Frontend', role: 'eng' },     q4id),
    row('Backend',  { budget: 35, headcount: 3 }, { team: 'Backend',  role: 'eng' },     q4id),
    row('Infra',    { budget: 20, headcount: 2 }, { team: 'Infra',    role: 'eng' },     q4id),
    row('PM',       { budget: 18, headcount: 1 }, { team: 'PM',       role: 'product' }, q4id),
  ]
  return {
    id: 'ds-team',
    name: 'Team allocation (demo)',
    createdAt: NOW,
    shape: 'tree' as const,
    rows,
    measureDefs: [
      { key: 'budget', label: 'Budget', unit: 'k' },
      { key: 'headcount', label: 'Headcount' },
    ],
    dimDefs: [
      { key: 'team', label: 'Team', values: ['Design', 'Frontend', 'Backend', 'Infra', 'PM'] },
      { key: 'role', label: 'Role', values: ['product', 'eng'] },
    ],
  }
}

// ─── Dataset 3: Life areas (4-level: goal → project → subproject → task) ──────

const PALETTE = ['#e08888', '#d4a86c', '#7ec87e', '#7aaae8', '#b090e0', '#60c4c0']

interface TaskSpec  { name: string; status?: string; est?: number; act?: number }
interface SubSpec   { name: string; status?: string; tasks: TaskSpec[] }
interface ProjSpec  { name: string; status?: string; subs: SubSpec[] }
interface GoalSpec  { name: string; color: string; projects: ProjSpec[] }

function makeHierarchy(goals: GoalSpec[]): PNode[] {
  const out: PNode[] = []
  goals.forEach((g, gi) => {
    const gid = nid()
    out.push({ id: gid, parentId: null, index: gi + 1, name: g.name, measures: {}, dims: { level: 'goal' }, color: g.color })
    g.projects.forEach((p, pi) => {
      const pid = nid()
      out.push({ id: pid, parentId: gid, index: pi + 1, name: p.name, measures: {}, dims: { level: 'project', status: p.status ?? 'doing' }, color: g.color })
      p.subs.forEach((s, si) => {
        const sid = nid()
        out.push({ id: sid, parentId: pid, index: si + 1, name: s.name, measures: {}, dims: { level: 'subproject', status: s.status ?? 'todo' }, color: g.color })
        s.tasks.forEach((t, ti) => {
          out.push({
            id: nid(), parentId: sid, index: ti + 1, name: t.name,
            measures: { est: t.est ?? 4, ...(t.act != null ? { act: t.act } : {}) },
            dims: { level: 'task', status: t.status ?? 'todo' },
          })
        })
      })
    })
  })
  return out
}

const LIFE_GOALS: GoalSpec[] = [
  {
    name: 'Ship vizform v1',
    color: PALETTE[0],
    projects: [
      {
        name: 'Core renderer', status: 'doing',
        subs: [
          { name: 'Flat viz', status: 'done', tasks: [
            { name: 'Treemap layout',  status: 'done', est: 4, act: 3.5 },
            { name: 'Radial layout',   status: 'done', est: 4, act: 4 },
            { name: 'Bands layout',    status: 'done', est: 3, act: 2.5 },
          ]},
          { name: 'Hierarchical viz', status: 'doing', tasks: [
            { name: 'H-treemap drill', status: 'done', est: 8, act: 10 },
            { name: 'H-icicle drill',  status: 'done', est: 6, act: 5 },
            { name: 'H-radial drill',  status: 'done', est: 6, act: 6 },
            { name: 'Data model',      status: 'done', est: 6, act: 4 },
            { name: 'Treetable view',  status: 'doing', est: 8 },
            { name: 'GroupBy wiring',  status: 'doing', est: 6 },
          ]},
        ],
      },
      {
        name: 'Sliceboard app', status: 'doing',
        subs: [
          { name: 'Data layer', status: 'doing', tasks: [
            { name: 'Persistence + seed', status: 'done', est: 3, act: 2 },
            { name: 'Generic row model',  status: 'done', est: 4, act: 4 },
            { name: 'APITable integration', status: 'todo', est: 8 },
          ]},
          { name: 'UI', tasks: [
            { name: 'Topbar + board menu', status: 'done', est: 2, act: 2 },
            { name: 'Tile grid (RGL)',     status: 'done', est: 8, act: 6 },
            { name: 'HUD layout',          status: 'todo', est: 6 },
            { name: 'GroupBy selector',    status: 'done', est: 3, act: 2 },
          ]},
        ],
      },
    ],
  },
  {
    name: 'Open source',
    color: PALETTE[3],
    projects: [
      {
        name: 'tix CLI', status: 'doing',
        subs: [
          { name: 'Core', status: 'doing', tasks: [
            { name: 'Dep graph cmd',         status: 'doing', est: 6, act: 3 },
            { name: 'Acceptance criteria DSL', status: 'review', est: 4, act: 4 },
            { name: 'Web export',            status: 'todo', est: 5 },
          ]},
          { name: 'Web viewer', tasks: [
            { name: 'React shell',        status: 'todo', est: 5 },
            { name: 'Graph visualization', status: 'todo', est: 8 },
            { name: 'Ticket detail view', status: 'todo', est: 4 },
          ]},
        ],
      },
      {
        name: 'vizform-react pkg', status: 'todo',
        subs: [
          { name: 'NPM publish', tasks: [
            { name: 'Clean up exports', status: 'todo', est: 2 },
            { name: 'Write README',     status: 'todo', est: 3 },
            { name: 'Publish to npm',   status: 'todo', est: 1 },
          ]},
          { name: 'Docs site', tasks: [
            { name: 'Landing page',  status: 'todo', est: 6 },
            { name: 'API reference', status: 'todo', est: 8 },
            { name: 'Examples',      status: 'todo', est: 5 },
          ]},
        ],
      },
    ],
  },
  {
    name: 'Learning',
    color: PALETTE[2],
    projects: [
      {
        name: 'Engineering', status: 'doing',
        subs: [
          { name: 'Compilers', tasks: [
            { name: 'Crafting Interpreters ch1-10', status: 'doing', est: 10, act: 4 },
            { name: 'Crafting Interpreters ch11-20', status: 'todo', est: 10 },
            { name: 'Write a toy compiler',         status: 'todo', est: 16 },
          ]},
          { name: 'Distributed systems', tasks: [
            { name: 'Raft paper',         status: 'done', est: 2, act: 2 },
            { name: 'MIT 6.824 labs',     status: 'doing', est: 20, act: 6 },
            { name: 'Designing Data-Intensive Apps', status: 'todo', est: 12 },
          ]},
        ],
      },
      {
        name: 'Design', status: 'doing',
        subs: [
          { name: 'Data viz', tasks: [
            { name: 'D3 in Depth',           status: 'doing', est: 8, act: 3 },
            { name: 'Visualization Analysis & Design', status: 'todo', est: 10 },
            { name: 'Build 5 practice charts', status: 'todo', est: 10 },
          ]},
          { name: 'UI/UX fundamentals', tasks: [
            { name: 'Laws of UX',         status: 'done', est: 2, act: 2 },
            { name: 'Refactoring UI',     status: 'doing', est: 6, act: 2 },
            { name: 'Design a dashboard', status: 'todo', est: 8 },
          ]},
        ],
      },
    ],
  },
  {
    name: 'Health',
    color: PALETTE[1],
    projects: [
      {
        name: 'Fitness', status: 'doing',
        subs: [
          { name: 'Strength', tasks: [
            { name: 'Squat session',    status: 'doing', est: 1, act: 0.75 },
            { name: 'Deadlift session', status: 'done',  est: 1, act: 1 },
            { name: 'Press session',    status: 'todo',  est: 1 },
            { name: 'Row session',      status: 'todo',  est: 1 },
          ]},
          { name: 'Cardio', tasks: [
            { name: 'Zone 2 run',    status: 'todo', est: 0.75 },
            { name: 'HIIT session',  status: 'todo', est: 0.5 },
            { name: 'Long walk',     status: 'done', est: 1, act: 1 },
          ]},
        ],
      },
      {
        name: 'Sleep', status: 'review',
        subs: [
          { name: 'Hygiene', tasks: [
            { name: 'No screens after 10pm', status: 'doing', est: 0.5, act: 0.25 },
            { name: 'Morning light',         status: 'doing', est: 0.25, act: 0.25 },
            { name: 'Consistent wake time',  status: 'todo',  est: 0.25 },
          ]},
          { name: 'Environment', tasks: [
            { name: 'Blackout curtains', status: 'done', est: 1, act: 0.5 },
            { name: 'Room temperature',  status: 'todo', est: 0.5 },
          ]},
        ],
      },
      {
        name: 'Nutrition', status: 'todo',
        subs: [
          { name: 'Tracking', tasks: [
            { name: 'Set macro targets',  status: 'todo', est: 0.5 },
            { name: 'Log meals for 2wks', status: 'todo', est: 4 },
            { name: 'Review and adjust',  status: 'todo', est: 1 },
          ]},
          { name: 'Meal prep', tasks: [
            { name: 'Plan weekly menu',   status: 'todo', est: 0.5 },
            { name: 'Sunday batch cook',  status: 'todo', est: 2 },
          ]},
        ],
      },
    ],
  },
  {
    name: 'Family',
    color: PALETTE[4],
    projects: [
      {
        name: 'Home', status: 'doing',
        subs: [
          { name: 'Maintenance', tasks: [
            { name: 'HVAC filter',      status: 'todo', est: 0.5 },
            { name: 'Gutter clean',     status: 'todo', est: 2 },
            { name: 'Smoke detectors',  status: 'done', est: 0.5, act: 0.5 },
            { name: 'Water heater check', status: 'todo', est: 0.5 },
          ]},
          { name: 'Organization', tasks: [
            { name: 'Garage sort',    status: 'todo', est: 4 },
            { name: 'Pantry restock', status: 'doing', est: 1, act: 0.5 },
            { name: 'File paperwork', status: 'todo', est: 2 },
          ]},
        ],
      },
      {
        name: 'Connection', status: 'doing',
        subs: [
          { name: 'Quality time', tasks: [
            { name: 'Weekly family dinner', status: 'doing', est: 2, act: 2 },
            { name: 'Game night',           status: 'todo',  est: 2 },
            { name: 'Day trip plan',        status: 'todo',  est: 3 },
          ]},
          { name: 'Admin', tasks: [
            { name: 'Review insurance',   status: 'todo', est: 1 },
            { name: 'Update emergency contacts', status: 'todo', est: 0.5 },
            { name: 'Budget review',      status: 'doing', est: 2, act: 1 },
          ]},
        ],
      },
    ],
  },
]

function buildLifeDataset(): Dataset {
  _idc = 0
  const rows = makeHierarchy(LIFE_GOALS)
  return {
    id: 'ds-life',
    name: 'Life areas',
    createdAt: NOW,
    shape: 'tree' as const,
    rows,
    measureDefs: [
      { key: 'est', label: 'Estimate', unit: 'h' },
      { key: 'act', label: 'Actual', unit: 'h' },
    ],
    dimDefs: [
      { key: 'level', label: 'Level', values: ['goal', 'project', 'subproject', 'task'] },
      { key: 'status', label: 'Status', values: ['todo', 'doing', 'review', 'done'] },
    ],
  }
}

// ─── Dataset 4: Supply chain (flat edge-list for Sankey) ──────────────────────

function buildSupplyChainDataset(): Dataset {
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
    rows: [],
    edges,
    measureDefs: [],
    dimDefs: [],
  }
}

function buildSeedWorkspace(): Workspace {
  const fruit = buildFruitDataset()
  const team  = buildTeamDataset()
  const life  = buildLifeDataset()

  // Canon viz kinds for seed dashboard (retired gen-0/Svelte kinds excluded)
  const ALL_KINDS: TileKind[] = [
    'treetable',
    'br-lc-bar', 'br-lc-bands', 'br-lc-line', 'br-lc-area', 'br-lc-scatter', 'br-lc-pie',
    'br-lc-radar', 'br-lc-concentric-arc',
    'br-lc-pack', 'br-lc-treemap', 'br-lc-icicle', 'br-lc-sunburst', 'br-lc-sankey', 'br-lc-sankey-flow', 'br-lc-tree',
  ]

  const GROUPBY_KINDS = new Set<TileKind>([
    'br-lc-pack', 'br-lc-treemap', 'br-lc-icicle', 'br-lc-sunburst', 'br-lc-sankey', 'br-lc-tree',
  ])

  function makeAllVizDash(prefix: string, flatGroupBy?: string): { tiles: Tile[]; layout: LayoutItem[] } {
    const tiles: Tile[] = ALL_KINDS.map((kind, i) => ({
      id: `${prefix}-${i}`,
      kind,
      title: kind,
      ...(flatGroupBy && GROUPBY_KINDS.has(kind) ? { groupBy: flatGroupBy } : {}),
    }))
    const layout: LayoutItem[] = ALL_KINDS.map((_, i) => ({
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
  const supply   = buildSupplyChainDataset()
  const supplyTiles: Tile[] = [{ id: 'sp-0', kind: 'br-lc-sankey', title: 'Supply chain' }]
  const supplyLayout: LayoutItem[] = [{ i: 'sp-0', x: 0, y: 0, w: 12, h: 8 }]

  return {
    datasets: [life, fruit, team, supply],
    dashboards: [
      { id: 'dash-life',   datasetId: life.id,   name: 'Life',          createdAt: NOW, layout: lifeViz.layout,   tiles: lifeViz.tiles,   measureKey: 'est' },
      { id: 'dash-fruit',  datasetId: fruit.id,  name: 'Fruit',         createdAt: NOW, layout: fruitViz.layout,  tiles: fruitViz.tiles,  measureKey: 'value' },
      { id: 'dash-team',   datasetId: team.id,   name: 'Team',          createdAt: NOW, layout: teamViz.layout,   tiles: teamViz.tiles,   measureKey: 'budget' },
      { id: 'dash-supply', datasetId: supply.id, name: 'Supply chain',  createdAt: NOW, layout: supplyLayout,     tiles: supplyTiles,     measureKey: 'value' },
    ],
    activeDatasetId: life.id,
    activeDashboardId: 'dash-life',
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

// ─── GroupBy helper ───────────────────────────────────────────────────────────

// Given a flat list of rows and a dim key, inserts virtual group-parent nodes
// so the viz sees a two-level tree: group → leaf. Rows that already have a
// parentId are passed through unchanged (groupBy only affects root-level rows).
export function applyGroupBy(rows: PNode[], dimKey: string): PNode[] {
  const roots = rows.filter(r => !r.parentId)
  const nonRoots = rows.filter(r => r.parentId)

  const groups = new Map<string, string>() // dimValue → virtual node id
  const groupNodes: PNode[] = []
  let gi = 0

  for (const r of roots) {
    const val = r.dims[dimKey] ?? '(none)'
    if (!groups.has(val)) {
      const gid = `__grp__${dimKey}__${val}`
      groups.set(val, gid)
      // Color the synthetic group by its members' shared color so the inner ring
      // matches the outer ring (members carry explicit hues in flat datasets).
      // Fall back to a palette pick from the group name when members are uncolored.
      const members = roots.filter(m => (m.dims[dimKey] ?? '(none)') === val)
      const memberColors = new Set(members.map(m => m.color).filter(Boolean))
      const groupColor = memberColors.size === 1 ? members.find(m => m.color)!.color! : colorFor(val)
      groupNodes.push({ id: gid, parentId: null, index: gi, name: val, measures: {}, dims: {}, color: groupColor })
      gi++
    }
  }

  const regrouped = roots.map(r => ({
    ...r,
    parentId: groups.get(r.dims[dimKey] ?? '(none)') ?? null,
  }))

  return [...groupNodes, ...regrouped, ...nonRoots]
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function updateRow(ws: Workspace, dsId: string, rowId: string, patch: Partial<PNode>): Workspace {
  return {
    ...ws,
    datasets: ws.datasets.map(ds =>
      ds.id !== dsId ? ds : {
        ...ds,
        rows: ds.rows.map(r => r.id !== rowId ? r : { ...r, ...patch }),
      }
    ),
  }
}

// Apply many row patches in a SINGLE workspace update. Parent-resize gestures
// redistribute across siblings, changing several leaves on one tick; emitting
// them as separate updateRow calls would clobber each other (each starts from
// the same stale workspace, so only the last write survives). Batching keeps
// every changed leaf in one commit.
export function updateRows(ws: Workspace, dsId: string, patches: Array<{ id: string; patch: Partial<PNode> }>): Workspace {
  if (patches.length === 0) return ws
  const byId = new Map(patches.map(p => [p.id, p.patch]))
  return {
    ...ws,
    datasets: ws.datasets.map(ds =>
      ds.id !== dsId ? ds : {
        ...ds,
        rows: ds.rows.map(r => { const p = byId.get(r.id); return p ? { ...r, ...p } : r }),
      }
    ),
  }
}

export function reorderLeaves(ws: Workspace, dsId: string, orderedLeafIds: string[]): Workspace {
  return {
    ...ws,
    datasets: ws.datasets.map(ds => {
      if (ds.id !== dsId) return ds
      const leafSet = new Set(ds.rows.filter(n => !ds.rows.some(m => m.parentId === n.id)).map(n => n.id))
      const leafPositions = ds.rows.reduce<number[]>((acc, n, i) => { if (leafSet.has(n.id)) acc.push(i); return acc }, [])
      const byId = new Map(ds.rows.map(n => [n.id, n]))
      const result = [...ds.rows]
      orderedLeafIds.forEach((id, i) => { result[leafPositions[i]!] = byId.get(id)! })
      return { ...ds, rows: result }
    }),
  }
}

export function createDataset(ws: Workspace, name: string): Workspace {
  const ds: Dataset = {
    id: genId(),
    name,
    createdAt: new Date().toISOString(),
    rows: [],
    measureDefs: [{ key: 'value', label: 'Value' }],
    dimDefs: [],
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
    measureKey: ds?.measureDefs[0]?.key ?? 'value',
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
  return updateDashboard(ws, { ...dash, tiles: [...dash.tiles, tile], layout: [...dash.layout, layout] })
}

export function removeTile(ws: Workspace, dashId: string, tileId: string): Workspace {
  const dash = ws.dashboards.find(d => d.id === dashId)
  if (!dash) return ws
  return updateDashboard(ws, {
    ...dash,
    tiles: dash.tiles.filter(t => t.id !== tileId),
    layout: dash.layout.filter(l => l.i !== tileId),
  })
}

export function deleteDashboard(ws: Workspace, dashId: string): Workspace {
  const remaining = ws.dashboards.filter(d => d.id !== dashId)
  return { ...ws, dashboards: remaining, activeDashboardId: remaining[0]?.id ?? '' }
}

export function deleteDataset(ws: Workspace, dsId: string): Workspace {
  const datasets = ws.datasets.filter(d => d.id !== dsId)
  const dashboards = ws.dashboards.filter(d => d.datasetId !== dsId)
  return { ...ws, datasets, dashboards, activeDatasetId: datasets[0]?.id ?? '', activeDashboardId: dashboards[0]?.id ?? '' }
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
