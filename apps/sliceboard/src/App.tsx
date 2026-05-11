import { useState, useCallback, useEffect, useRef } from 'react'
import { Viz, HViz, pickColor } from '@winstonfassett/vizform-react'
import type { Goal, GoalTree, ViewMode } from '@winstonfassett/vizform-react'
import {
  initStore, persistBoard, createBoard, deleteBoard,
  boardToUrl,
} from './persistence'
import type { Row, Board, BoardStore } from './persistence'
import './App.css'

const GROUPS = ['Alpha', 'Beta', 'Gamma']
const FLAT_MODES: ViewMode[] = ['treemap', 'radial', 'bands']
const HIER_MODES: ViewMode[] = ['h-treemap', 'h-icicle', 'h-radial']
const HIER_LABELS: Record<string, string> = { 'h-treemap': 'tree', 'h-icicle': 'icicle', 'h-radial': 'sunburst' }

function rowsToGoals(rows: Row[]): Goal[] {
  return rows.map((r, idx) => ({
    id: r.id, name: r.name, color: pickColor(idx),
    measurements: { value: r.value, _index: idx },
    archived: false, tags: [], urgent: false, important: false,
    createdAt: '', updatedAt: '',
  }))
}

function rowsToTree(rows: Row[], grouped: boolean): GoalTree {
  if (!grouped) {
    return {
      id: '__root__', name: 'All', color: 'oklch(0.28 0 0)', value: 0,
      children: rows.map((r, i) => ({ id: r.id, name: r.name, color: pickColor(i), value: r.value })),
    }
  }
  const groupMap = new Map<string, Row[]>()
  for (const r of rows) {
    if (!groupMap.has(r.group)) groupMap.set(r.group, [])
    groupMap.get(r.group)!.push(r)
  }
  return {
    id: '__root__', name: 'All', color: 'oklch(0.28 0 0)', value: 0,
    children: Array.from(groupMap.entries()).map(([grp, recs], gi) => ({
      id: `__grp__${grp}`, name: grp, color: pickColor(gi * 5), value: 0,
      children: recs.map((r, ri) => ({ id: r.id, name: r.name, color: pickColor(gi * 5 + ri + 1), value: r.value })),
    })),
  }
}

let _nextId = 1
function nextRowId(): string {
  return `r${Date.now()}-${_nextId++}`
}

// --- Board menu ---

function BoardMenu({
  store, onSwitch, onNew, onDuplicate, onRename, onDelete, onCopyLink,
}: {
  store: BoardStore
  onSwitch: (b: Board) => void
  onNew: () => void
  onDuplicate: () => void
  onRename: () => void
  onDelete: () => void
  onCopyLink: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="sb-menu-wrap">
      <button
        className="sb-btn sb-menu-trigger"
        onClick={() => setOpen(o => !o)}
      >
        <span className="sb-menu-trigger-label">{store.active.name}</span>
        <span className="sb-menu-caret">▾</span>
      </button>

      {open && (
        <div className="sb-menu-dropdown">
          <div className="sb-menu-boards">
            {store.boards.map(b => (
              <button
                key={b.id}
                onClick={() => { onSwitch(b); setOpen(false) }}
                className={`sb-menu-board-btn${b.id === store.active.id ? ' active' : ''}`}
              >
                {b.name}
              </button>
            ))}
          </div>
          <div className="sb-menu-actions">
            {([
              { label: 'New board',  action: onNew },
              { label: 'Duplicate', action: onDuplicate },
              { label: 'Rename',    action: onRename },
              { label: 'Copy link', action: onCopyLink },
              { label: 'Delete',    action: onDelete, danger: true },
            ] as { label: string; action: () => void; danger?: boolean }[]).map(({ label, action, danger }) => (
              <button
                key={label}
                onClick={() => { action(); setOpen(false) }}
                className={`sb-menu-action-btn${danger ? ' danger' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// --- Main app ---

const initData = initStore()

export function App() {
  const [store, setStore] = useState<BoardStore>(initData)
  const active = store.active
  const { mode, grouped, sortMode } = active.state
  const rows = active.rows

  function patchActive(patch: Partial<Board>) {
    const next = { ...active, ...patch }
    setStore(s => ({ boards: persistBoard(next, s.boards), active: next }))
  }

  function patchState(patch: Partial<typeof active.state>) {
    patchActive({ state: { ...active.state, ...patch } })
  }

  function patchRows(next: Row[]) {
    patchActive({ rows: next })
  }

  const switchBoard = useCallback((b: Board) => {
    setStore(s => ({ boards: persistBoard(b, s.boards), active: b }))
  }, [])

  const newBoard = useCallback(() => {
    const name = prompt('Board name:', 'New board')
    if (!name) return
    const b = createBoard(name)
    setStore(s => { const boards = persistBoard(b, s.boards); return { boards, active: b } })
  }, [])

  const duplicateBoard = useCallback(() => {
    const name = prompt('Name for duplicate:', active.name + ' copy')
    if (!name) return
    const b = createBoard(name, active)
    setStore(s => { const boards = persistBoard(b, s.boards); return { boards, active: b } })
  }, [active])

  const renameBoard = useCallback(() => {
    const name = prompt('New name:', active.name)
    if (!name || name === active.name) return
    patchActive({ name })
  }, [active])

  const deleteCurrentBoard = useCallback(() => {
    if (store.boards.length <= 1) { alert('Cannot delete the only board.'); return }
    if (!confirm(`Delete "${active.name}"?`)) return
    const remaining = deleteBoard(active.id, store.boards)
    const next = remaining[0]
    setStore({ boards: persistBoard(next, remaining), active: next })
  }, [active, store.boards])

  const copyLink = useCallback(() => {
    const url = location.origin + location.pathname + boardToUrl(active)
    navigator.clipboard.writeText(url).then(() => alert('Link copied!'))
  }, [active])

  // Row ops
  const addRow = () => {
    const id = nextRowId()
    patchRows([...rows, { id, name: `Item ${rows.length + 1}`, group: GROUPS[rows.length % GROUPS.length], value: 10 }])
  }
  const removeRow = (id: string) => patchRows(rows.filter(r => r.id !== id))
  const updateName  = (id: string, v: string) => patchRows(rows.map(r => r.id === id ? { ...r, name: v } : r))
  const updateGroup = (id: string, v: string) => patchRows(rows.map(r => r.id === id ? { ...r, group: v } : r))
  const updateValue = (id: string, raw: string) => {
    const v = parseInt(raw, 10)
    if (!isNaN(v) && v >= 0) patchRows(rows.map(r => r.id === id ? { ...r, value: v } : r))
  }

  const handleVizUpdate = useCallback((id: string, patch: Partial<Goal>) => {
    if (!patch.measurements) return
    const m = patch.measurements
    const v = m['value']
    const newIndex = m['_index']
    setStore(s => {
      let rows = s.active.rows
      if (v != null) {
        rows = rows.map(r => r.id === id ? { ...r, value: v as number } : r)
      }
      if (newIndex != null) {
        const targetIdx = Math.max(0, Math.min(rows.length - 1, (newIndex as number) - 1))
        const curIdx = rows.findIndex(r => r.id === id)
        if (curIdx !== -1 && curIdx !== targetIdx) {
          const next = rows.slice()
          const [moved] = next.splice(curIdx, 1)
          next.splice(targetIdx, 0, moved)
          rows = next
        }
      }
      if (rows === s.active.rows) return s
      const next = { ...s.active, rows }
      return { boards: persistBoard(next, s.boards), active: next }
    })
  }, [])

  const goals = rowsToGoals(rows)
  const tree = rowsToTree(rows, grouped)
  const isHier = (HIER_MODES as string[]).includes(mode)

  return (
    <div className="sb-root">

      {/* Topbar */}
      <div className="sb-topbar">
        <span className="sb-wordmark">sliceboard</span>
        <BoardMenu
          store={store}
          onSwitch={switchBoard}
          onNew={newBoard}
          onDuplicate={duplicateBoard}
          onRename={renameBoard}
          onDelete={deleteCurrentBoard}
          onCopyLink={copyLink}
        />
      </div>

      {/* Body */}
      <div className="sb-body">

        {/* Left: data table */}
        <div className="sb-left">
          <div className="sb-left-header">
            <span className="sb-section-label">Data</span>
            <label className="sb-group-toggle">
              <input type="checkbox" checked={grouped} onChange={e => patchState({ grouped: e.target.checked })} />
              group by
            </label>
          </div>
          <div className="sb-table-scroll">
            <table className="sb-table">
              <thead>
                <tr>
                  <th className="sb-th">Name</th>
                  {grouped && <th className="sb-th">Group</th>}
                  <th className="sb-th sb-th-val">Value</th>
                  <th className="sb-th sb-th-del" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="sb-td">
                      <input className="sb-input" value={r.name} onChange={e => updateName(r.id, e.target.value)} />
                    </td>
                    {grouped && (
                      <td className="sb-td">
                        <select className="sb-select" value={r.group} onChange={e => updateGroup(r.id, e.target.value)}>
                          {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </td>
                    )}
                    <td className="sb-td">
                      <input className="sb-input sb-input-right" value={r.value} type="number" min={0} onChange={e => updateValue(r.id, e.target.value)} />
                    </td>
                    <td className="sb-td sb-td-center">
                      <button onClick={() => removeRow(r.id)} className="sb-del-btn">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sb-add-row">
            <button onClick={addRow} className="sb-btn sb-btn-full">+ Add row</button>
          </div>
        </div>

        {/* Right: viz */}
        <div className="sb-right">
          <div className="sb-viz-toolbar">
            {FLAT_MODES.map(m => (
              <button key={m} className={`sb-btn${mode === m ? ' sb-btn-active' : ''}`} onClick={() => patchState({ mode: m })}>{m}</button>
            ))}
            <span className="sb-toolbar-sep">|</span>
            {HIER_MODES.map(m => (
              <button key={m} className={`sb-btn${mode === m ? ' sb-btn-active' : ''}`} onClick={() => patchState({ mode: m })}>{HIER_LABELS[m]}</button>
            ))}
            {!isHier && (
              <div className="sb-sort-group">
                <button className={`sb-btn${sortMode === 'index' ? ' sb-btn-active' : ''}`} onClick={() => patchState({ sortMode: 'index' })}>idx</button>
                <button className={`sb-btn${sortMode === 'size' ? ' sb-btn-active' : ''}`} onClick={() => patchState({ sortMode: 'size' })}>↓val</button>
              </div>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="sb-viz-empty">Add a row to visualize</div>
          ) : (
            <div className="sb-viz-canvas">
              {isHier ? (
                <HViz tree={tree} mode={mode as 'h-treemap' | 'h-icicle' | 'h-radial'} />
              ) : (
                <Viz
                  goals={goals} mode={mode as 'treemap' | 'radial' | 'bands'}
                  activeUnit="value" unitKind="size"
                  sortUnit={sortMode === 'index' ? '_index' : 'value'}
                  sortUnitKind={sortMode === 'index' ? 'order' : 'size'}
                  frame={undefined} onUpdate={handleVizUpdate}
                />
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
