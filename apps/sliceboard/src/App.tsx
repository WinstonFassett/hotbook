import { useState, useCallback, useEffect, useRef } from 'react'
import { Viz, HViz, pickColor } from '@winstonfassett/vizform-react'
import type { Goal, GoalTree, ViewMode } from '@winstonfassett/vizform-react'
import {
  initStore, persistBoard, createBoard, deleteBoard,
  boardToUrl,
} from './persistence'
import type { Row, Board, BoardStore } from './persistence'

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
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        style={{ ...btnBase, display: 'flex', alignItems: 'center', gap: 6, maxWidth: 200, overflow: 'hidden' }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {store.active.name}
        </span>
        <span style={{ color: '#555', flexShrink: 0 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 100,
          background: '#1a1a1a', border: '1px solid #333', borderRadius: 4,
          minWidth: 220, marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,.6)',
        }}>
          <div style={{ padding: '4px 0', borderBottom: '1px solid #252525' }}>
            {store.boards.map(b => (
              <button
                key={b.id}
                onClick={() => { onSwitch(b); setOpen(false) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '5px 12px', background: 'none', border: 'none',
                  color: b.id === store.active.id ? '#fff' : '#888',
                  fontSize: 12, cursor: 'pointer',
                  borderLeft: b.id === store.active.id ? '2px solid #555' : '2px solid transparent',
                }}
              >
                {b.name}
              </button>
            ))}
          </div>
          <div style={{ padding: '4px 0' }}>
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
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '5px 12px', background: 'none', border: 'none',
                  color: danger ? '#c44' : '#777', fontSize: 11, cursor: 'pointer',
                }}
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
    const v = patch.measurements['value']
    if (v == null) return
    // rows ref is stale in useCallback — read from store via functional update
    setStore(s => {
      const next = { ...s.active, rows: s.active.rows.map(r => r.id === id ? { ...r, value: v as number } : r) }
      return { boards: persistBoard(next, s.boards), active: next }
    })
  }, [])

  const goals = rowsToGoals(rows)
  const tree = rowsToTree(rows, grouped)
  const isHier = (HIER_MODES as string[]).includes(mode)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Topbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 10px', borderBottom: '1px solid #222',
        flexShrink: 0, background: '#111',
      }}>
        <span style={{ color: '#444', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 4, userSelect: 'none' }}>
          sliceboard
        </span>
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
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* Left: data table */}
        <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #222', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '6px 10px', borderBottom: '1px solid #1e1e1e', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#444', fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Data</span>
            <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#555', cursor: 'pointer' }}>
              <input type="checkbox" checked={grouped} onChange={e => patchState({ grouped: e.target.checked })} />
              group by
            </label>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Name</th>
                  {grouped && <th style={thStyle}>Group</th>}
                  <th style={{ ...thStyle, width: 55 }}>Value</th>
                  <th style={{ ...thStyle, width: 28 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={tdStyle}>
                      <input style={inputStyle} value={r.name} onChange={e => updateName(r.id, e.target.value)} />
                    </td>
                    {grouped && (
                      <td style={tdStyle}>
                        <select style={{ ...inputStyle, background: '#111' }} value={r.group} onChange={e => updateGroup(r.id, e.target.value)}>
                          {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </td>
                    )}
                    <td style={tdStyle}>
                      <input style={{ ...inputStyle, textAlign: 'right' }} value={r.value} type="number" min={0} onChange={e => updateValue(r.id, e.target.value)} />
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <button onClick={() => removeRow(r.id)} style={{ background: 'none', border: 'none', color: '#3a3a3a', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '8px 10px', borderTop: '1px solid #1e1e1e' }}>
            <button onClick={addRow} style={{ ...btnBase, width: '100%' }}>+ Add row</button>
          </div>
        </div>

        {/* Right: viz */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{
            display: 'flex', gap: 4, padding: '4px 8px',
            borderBottom: '1px solid #222', flexShrink: 0,
            alignItems: 'center', flexWrap: 'wrap',
          }}>
            {FLAT_MODES.map(m => (
              <button key={m} style={mode === m ? btnActive : btnBase} onClick={() => patchState({ mode: m })}>{m}</button>
            ))}
            <span style={{ color: '#2a2a2a', fontSize: 11 }}>|</span>
            {HIER_MODES.map(m => (
              <button key={m} style={mode === m ? btnActive : btnBase} onClick={() => patchState({ mode: m })}>{HIER_LABELS[m]}</button>
            ))}
            {!isHier && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button style={sortMode === 'index' ? btnActive : btnBase} onClick={() => patchState({ sortMode: 'index' })}>idx</button>
                <button style={sortMode === 'size' ? btnActive : btnBase} onClick={() => patchState({ sortMode: 'size' })}>↓val</button>
              </div>
            )}
          </div>

          {rows.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontSize: 13 }}>
              Add a row to visualize
            </div>
          ) : (
            <div style={{ flex: 1, overflow: 'hidden' }}>
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

const btnBase: React.CSSProperties = {
  padding: '2px 10px', borderRadius: 4, border: '1px solid #2a2a2a',
  background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 11,
}
const btnActive: React.CSSProperties = { ...btnBase, background: '#2a2a2a', color: '#eee' }
const thStyle: React.CSSProperties = { padding: '4px 8px', textAlign: 'left', color: '#3a3a3a', fontWeight: 400, fontSize: 11, borderBottom: '1px solid #1a1a1a' }
const tdStyle: React.CSSProperties = { padding: '2px 4px', borderBottom: '1px solid #161616' }
const inputStyle: React.CSSProperties = { width: '100%', background: 'transparent', border: 'none', color: '#aaa', fontSize: 12, padding: '2px 4px', outline: 'none' }
