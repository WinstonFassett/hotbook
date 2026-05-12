import { useState, useCallback, useEffect, useRef } from 'react'
import { Viz, HViz, HTreetable, pickColor } from '@winstonfassett/vizform-react'
import type { Goal, ViewMode, PNode, Measurement } from '@winstonfassett/vizform-react'
import { leavesOf } from '@winstonfassett/vizform-core'
import {
  initStore, persistBoard, createBoard, deleteBoard,
  boardToUrl,
} from './persistence'
import type { Board, BoardStore } from './persistence'
import './App.css'

const FLAT_MODES: ViewMode[] = ['treemap', 'radial', 'bands']
const HIER_MODES: ViewMode[] = ['h-treemap', 'h-icicle', 'h-radial', 'treetable']
const HIER_LABELS: Record<string, string> = {
  'h-treemap': 'tree',
  'h-icicle': 'icicle',
  'h-radial': 'sunburst',
  'treetable': 'table',
}

function nodesToGoals(nodes: PNode[], measureKey: string): Goal[] {
  const leaves = leavesOf(nodes)
  return leaves.map((n, idx) => ({
    id: n.id,
    name: n.name,
    color: n.color ?? pickColor(idx),
    measurements: { ...n.measurements, _index: idx },
    archived: false,
    tags: n.tags,
    urgent: false,
    important: false,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  }))
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
  const { mode, measureKey, sortMode } = active.state
  const nodes = active.nodes
  const measurements: Measurement[] = active.measurements

  function patchActive(patch: Partial<Board>) {
    const next = { ...active, ...patch }
    setStore(s => ({ boards: persistBoard(next, s.boards), active: next }))
  }

  function patchState(patch: Partial<typeof active.state>) {
    patchActive({ state: { ...active.state, ...patch } })
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

  const handleVizUpdate = useCallback((id: string, patch: Partial<Goal>) => {
    if (!patch.measurements) return
    const m = patch.measurements
    const newMeasureVal = m[measureKey]
    const newIndex = m['_index']
    setStore(s => {
      let ns = s.active.nodes
      if (newMeasureVal != null) {
        ns = ns.map(n => n.id === id
          ? { ...n, measurements: { ...n.measurements, [measureKey]: newMeasureVal as number } }
          : n)
      }
      if (newIndex != null) {
        const targetIdx = Math.max(0, Math.min(ns.length - 1, (newIndex as number) - 1))
        const curIdx = ns.findIndex(n => n.id === id)
        if (curIdx !== -1 && curIdx !== targetIdx) {
          const next = ns.slice()
          const [moved] = next.splice(curIdx, 1)
          next.splice(targetIdx, 0, moved)
          ns = next
        }
      }
      if (ns === s.active.nodes) return s
      const next = { ...s.active, nodes: ns }
      return { boards: persistBoard(next, s.boards), active: next }
    })
  }, [measureKey])

  const goals = nodesToGoals(nodes, measureKey)
  const isHier = (HIER_MODES as string[]).includes(mode)
  const isTreetable = mode === 'treetable'

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

        {/* Left: mode + measure controls */}
        <div className="sb-left">
          <div className="sb-left-header">
            <span className="sb-section-label">View</span>
          </div>

          <div className="sb-control-group">
            <div className="sb-control-label">Flat</div>
            <div className="sb-btn-group">
              {FLAT_MODES.map(m => (
                <button key={m} className={`sb-btn${mode === m ? ' sb-btn-active' : ''}`} onClick={() => patchState({ mode: m })}>{m}</button>
              ))}
            </div>
          </div>

          <div className="sb-control-group">
            <div className="sb-control-label">Hierarchy</div>
            <div className="sb-btn-group">
              {HIER_MODES.map(m => (
                <button key={m} className={`sb-btn${mode === m ? ' sb-btn-active' : ''}`} onClick={() => patchState({ mode: m })}>{HIER_LABELS[m]}</button>
              ))}
            </div>
          </div>

          {!isHier && (
            <div className="sb-control-group">
              <div className="sb-control-label">Sort</div>
              <div className="sb-btn-group">
                <button className={`sb-btn${sortMode === 'index' ? ' sb-btn-active' : ''}`} onClick={() => patchState({ sortMode: 'index' })}>idx</button>
                <button className={`sb-btn${sortMode === 'size' ? ' sb-btn-active' : ''}`} onClick={() => patchState({ sortMode: 'size' })}>↓val</button>
              </div>
            </div>
          )}

          <div className="sb-control-group">
            <div className="sb-control-label">Measure</div>
            <div className="sb-btn-group">
              {measurements.map(m => (
                <button
                  key={m.key}
                  className={`sb-btn${measureKey === m.key ? ' sb-btn-active' : ''}`}
                  onClick={() => patchState({ measureKey: m.key })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: viz */}
        <div className="sb-right">
          <div className="sb-viz-canvas">
            {isTreetable ? (
              <HTreetable nodes={nodes} measureKey={measureKey} />
            ) : isHier ? (
              <HViz nodes={nodes} measureKey={measureKey} mode={mode as 'h-treemap' | 'h-icicle' | 'h-radial'} />
            ) : (
              <Viz
                goals={goals} mode={mode as 'treemap' | 'radial' | 'bands'}
                activeUnit={measureKey} unitKind="size"
                sortUnit={sortMode === 'index' ? '_index' : measureKey}
                sortUnitKind={sortMode === 'index' ? 'order' : 'size'}
                frame={undefined} onUpdate={handleVizUpdate}
              />
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
