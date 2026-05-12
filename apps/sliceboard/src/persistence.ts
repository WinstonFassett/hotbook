import type { PNode, Measurement } from '@winstonfassett/vizform-react'

const LS_BOARDS_KEY = 'sb:boards:v2'
const LS_LAST_KEY = 'sb:lastBoardId:v2'
const HASH_PREFIX = '#b2='

export type { PNode, Measurement }

export interface BoardState {
  mode: string
  measureKey: string
  sortMode: string
}

export interface Board {
  id: string
  name: string
  createdAt: string
  nodes: PNode[]
  measurements: Measurement[]
  state: BoardState
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// --- Seed data: Goal → Project → Subproject → Task (4 levels) ---

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
              { name: 'PNode data model', status: 'doing', estimate: 6, actual: 2 },
              { name: 'Treetable view', status: 'todo', estimate: 8 },
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
              { name: 'Persistence + seed', status: 'doing', estimate: 3, actual: 1 },
              { name: 'Board CRUD', status: 'done', estimate: 4, actual: 3 },
            ],
          },
          {
            name: 'UI',
            tasks: [
              { name: 'Topbar + board menu', status: 'done', estimate: 2, actual: 2 },
              { name: 'Viz toolbar', status: 'doing', estimate: 2, actual: 1 },
              { name: 'Mode switcher', status: 'todo', estimate: 2 },
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
      {
        name: 'cass search',
        status: 'doing',
        subs: [
          {
            name: 'Search engine',
            tasks: [
              { name: 'BM25 index', status: 'done', estimate: 10, actual: 12 },
              { name: 'Semantic fallback', status: 'doing', estimate: 6, actual: 3 },
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

export const SEED_MEASUREMENTS: Measurement[] = [
  { key: 'estimate_hours', label: 'Estimate', unit: 'h', rollup: 'sum' },
  { key: 'actual_hours', label: 'Actual', unit: 'h', rollup: 'sum' },
]

export const SEED_BOARDS: Board[] = [
  {
    id: 'seed-vizform',
    name: 'vizform roadmap (demo)',
    createdAt: new Date(0).toISOString(),
    nodes: buildSeedNodes(),
    measurements: SEED_MEASUREMENTS,
    state: { mode: 'treetable', measureKey: 'estimate_hours', sortMode: 'index' },
  },
]

// --- encode / decode ---

function encodeBoard(board: Board): string {
  return btoa(JSON.stringify(board))
}

function decodeBoard(encoded: string): Board | null {
  try {
    const parsed = JSON.parse(atob(encoded))
    if (!Array.isArray(parsed?.nodes) || typeof parsed?.id !== 'string') return null
    return parsed as Board
  } catch {
    return null
  }
}

// --- URL ---

export function boardToUrl(board: Board): string {
  return HASH_PREFIX + encodeBoard(board)
}

function boardFromUrl(): Board | null {
  const hash = location.hash
  if (!hash.startsWith(HASH_PREFIX)) return null
  return decodeBoard(hash.slice(HASH_PREFIX.length))
}

export function writeUrl(board: Board): void {
  history.replaceState(null, '', boardToUrl(board))
}

// --- localStorage ---

function loadBoards(): Board[] {
  try {
    const raw = localStorage.getItem(LS_BOARDS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as Board[]
  } catch {
    return []
  }
}

function saveBoards(boards: Board[]): void {
  try {
    localStorage.setItem(LS_BOARDS_KEY, JSON.stringify(boards))
  } catch { /* storage unavailable */ }
}

function saveLastId(id: string): void {
  try {
    localStorage.setItem(LS_LAST_KEY, id)
  } catch { /* storage unavailable */ }
}

function loadLastId(): string | null {
  try {
    return localStorage.getItem(LS_LAST_KEY)
  } catch {
    return null
  }
}

// --- public API ---

export interface BoardStore {
  boards: Board[]
  active: Board
}

export function initStore(): BoardStore {
  const urlBoard = boardFromUrl()
  if (urlBoard) {
    const boards = loadBoards()
    const merged = boards.some(b => b.id === urlBoard.id)
      ? boards.map(b => b.id === urlBoard.id ? urlBoard : b)
      : [...boards, urlBoard]
    saveBoards(merged)
    saveLastId(urlBoard.id)
    return { boards: merged, active: urlBoard }
  }

  const boards = loadBoards()
  if (boards.length === 0) {
    saveBoards(SEED_BOARDS)
    writeUrl(SEED_BOARDS[0])
    saveLastId(SEED_BOARDS[0].id)
    return { boards: SEED_BOARDS, active: SEED_BOARDS[0] }
  }

  const lastId = loadLastId()
  const last = (lastId ? boards.find(b => b.id === lastId) : undefined) ?? boards[0]
  writeUrl(last)
  return { boards, active: last }
}

export function persistBoard(board: Board, boards: Board[]): Board[] {
  const next = boards.some(b => b.id === board.id)
    ? boards.map(b => b.id === board.id ? board : b)
    : [...boards, board]
  saveBoards(next)
  saveLastId(board.id)
  writeUrl(board)
  return next
}

export function createBoard(name: string, fromBoard?: Board): Board {
  return {
    id: genId(),
    name,
    createdAt: new Date().toISOString(),
    nodes: fromBoard ? fromBoard.nodes.map(n => ({ ...n, id: genId() })) : buildSeedNodes(),
    measurements: fromBoard?.measurements ?? SEED_MEASUREMENTS,
    state: fromBoard?.state ?? { mode: 'treetable', measureKey: 'estimate_hours', sortMode: 'index' },
  }
}

export function deleteBoard(id: string, boards: Board[]): Board[] {
  const next = boards.filter(b => b.id !== id)
  saveBoards(next)
  return next
}
