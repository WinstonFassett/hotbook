const LS_BOARDS_KEY = 'sb:boards'
const LS_LAST_KEY = 'sb:lastBoardId'
const HASH_PREFIX = '#b='

export interface Row {
  id: string
  name: string
  group: string
  value: number
}

export interface BoardState {
  mode: string
  grouped: boolean
  sortMode: string
}

export interface Board {
  id: string
  name: string
  createdAt: string
  rows: Row[]
  state: BoardState
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export const SEED_BOARDS: Board[] = [
  {
    id: 'seed-fruit',
    name: 'Fruit (demo)',
    createdAt: new Date(0).toISOString(),
    rows: [
      { id: '1', name: 'Apples',   group: 'Alpha', value: 40 },
      { id: '2', name: 'Bananas',  group: 'Alpha', value: 25 },
      { id: '3', name: 'Carrots',  group: 'Beta',  value: 30 },
      { id: '4', name: 'Dates',    group: 'Beta',  value: 15 },
      { id: '5', name: 'Eggplant', group: 'Gamma', value: 20 },
      { id: '6', name: 'Fennel',   group: 'Gamma', value: 10 },
    ],
    state: { mode: 'treemap', grouped: false, sortMode: 'index' },
  },
  {
    id: 'seed-team',
    name: 'Team allocation (demo)',
    createdAt: new Date(0).toISOString(),
    rows: [
      { id: '1', name: 'Design',   group: 'Q2', value: 20 },
      { id: '2', name: 'Frontend', group: 'Q2', value: 35 },
      { id: '3', name: 'Backend',  group: 'Q2', value: 30 },
      { id: '4', name: 'Infra',    group: 'Q2', value: 15 },
      { id: '5', name: 'Design',   group: 'Q3', value: 25 },
      { id: '6', name: 'Frontend', group: 'Q3', value: 40 },
      { id: '7', name: 'Backend',  group: 'Q3', value: 25 },
      { id: '8', name: 'Infra',    group: 'Q3', value: 10 },
    ],
    state: { mode: 'treemap', grouped: true, sortMode: 'index' },
  },
]

// --- encode / decode ---

function encodeBoard(board: Board): string {
  return btoa(JSON.stringify(board))
}

function decodeBoard(encoded: string): Board | null {
  try {
    const parsed = JSON.parse(atob(encoded))
    if (!Array.isArray(parsed?.rows) || typeof parsed?.id !== 'string') return null
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

// --- localStorage boards list ---

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
  // URL takes priority — shared link carries full board data
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
    rows: fromBoard ? fromBoard.rows.map(r => ({ ...r, id: genId() })) : [],
    state: fromBoard?.state ?? { mode: 'treemap', grouped: false, sortMode: 'index' },
  }
}

export function deleteBoard(id: string, boards: Board[]): Board[] {
  const next = boards.filter(b => b.id !== id)
  saveBoards(next)
  return next
}
