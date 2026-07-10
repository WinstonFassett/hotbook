import type { Dataset, VizNode } from '../schema/v11'

const NOW = '2026-05-13T12:00:00.000Z'

let _idc = 0
function nid(): string { return `n${++_idc}` }

function row(name: string, measures: Record<string, number>, dims: Record<string, string>, parentId?: string, color?: string) {
  return { id: nid(), parentId: parentId ?? null, index: _idc, name, measures, dims, ...(color ? { color } : {}) }
}

/**
 * Dataset 3 — Life Areas (4-level hierarchy: goal → project → subproject → task)
 *   Shape: tree (5-6 top-level goals, each with 2-3 projects, 2-3 subprojects, 2-5 tasks).
 *   Measures: est (hours estimated), act (hours actual, optional).
 *   Dims: level (goal/project/subproject/task), status (done/doing/todo).
 *   Colors: each goal has a distinct palette color; descendants inherit it.
 *   Use: deep hier charts (icicle/sunburst/pack/treemap — depth selector meaningful here),
 *        groupBy:'level' groups leaves by level for flat charts,
 *        groupBy:'status' clusters by done/doing/todo.
 */

const PALETTE = ['#e08888', '#d4a86c', '#7ec87e', '#7aaae8', '#b090e0', '#60c4c0']

interface TaskSpec  { name: string; status?: string; est?: number; act?: number }
interface SubSpec   { name: string; status?: string; tasks: TaskSpec[] }
interface ProjSpec  { name: string; status?: string; subs: SubSpec[] }
interface GoalSpec  { name: string; color: string; projects: ProjSpec[] }

function makeHierarchy(goals: GoalSpec[]) {
  const out: VizNode[] = []
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

export function buildLifeDataset(): Dataset {
  _idc = 0
  const nodes = makeHierarchy(LIFE_GOALS)
  return {
    id: 'ds-life',
    name: 'Life areas',
    createdAt: NOW,
    shape: 'tree' as const,
    nodes,
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
