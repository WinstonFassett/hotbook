import { useState, useCallback } from 'react'
import { Viz, HViz, pickColor } from 'alloc-viz-react'
import type { Goal, GoalTree, ViewMode } from 'alloc-viz-react'

interface Row {
  id: string
  name: string
  group: string
  value: number
}

const GROUPS = ['Alpha', 'Beta', 'Gamma']

const INITIAL_ROWS: Row[] = [
  { id: '1', name: 'Apples',   group: 'Alpha', value: 40 },
  { id: '2', name: 'Bananas',  group: 'Alpha', value: 25 },
  { id: '3', name: 'Carrots',  group: 'Beta',  value: 30 },
  { id: '4', name: 'Dates',    group: 'Beta',  value: 15 },
  { id: '5', name: 'Eggplant', group: 'Gamma', value: 20 },
  { id: '6', name: 'Fennel',   group: 'Gamma', value: 10 },
]

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
      children: rows.map((r, i) => ({
        id: r.id, name: r.name, color: pickColor(i), value: r.value,
      })),
    }
  }
  const groupMap = new Map<string, Row[]>()
  for (const r of rows) {
    if (!groupMap.has(r.group)) groupMap.set(r.group, [])
    groupMap.get(r.group)!.push(r)
  }
  const children = Array.from(groupMap.entries()).map(([grp, recs], gi) => ({
    id: `__grp__${grp}`, name: grp, color: pickColor(gi * 5), value: 0,
    children: recs.map((r, ri) => ({
      id: r.id, name: r.name, color: pickColor(gi * 5 + ri + 1), value: r.value,
    })),
  }))
  return { id: '__root__', name: 'All', color: 'oklch(0.28 0 0)', value: 0, children }
}

let nextId = INITIAL_ROWS.length + 1

const FLAT_MODES: ViewMode[] = ['treemap', 'radial', 'bands']
const HIER_MODES: ViewMode[] = ['h-treemap', 'h-icicle', 'h-radial']
const HIER_LABELS: Record<string, string> = { 'h-treemap': 'tree', 'h-icicle': 'icicle', 'h-radial': 'sunburst' }

const btnBase: React.CSSProperties = {
  padding: '2px 10px', borderRadius: 4, border: '1px solid #444',
  background: 'transparent', color: '#ccc', cursor: 'pointer', fontSize: 11,
}
const btnActive: React.CSSProperties = { ...btnBase, background: '#444', color: '#fff' }

export function App() {
  const [rows, setRows] = useState<Row[]>(INITIAL_ROWS)
  const [mode, setMode] = useState<ViewMode>('treemap')
  const [sortMode, setSortMode] = useState<'index' | 'size'>('index')
  const [grouped, setGrouped] = useState(false)

  const goals = rowsToGoals(rows)
  const tree = rowsToTree(rows, grouped)
  const isHier = (HIER_MODES as string[]).includes(mode)

  const handleUpdate = useCallback((id: string, patch: Partial<Goal>) => {
    if (!patch.measurements) return
    const v = patch.measurements['value']
    if (v == null) return
    setRows(rs => rs.map(r => r.id === id ? { ...r, value: v as number } : r))
  }, [])

  const addRow = () => {
    const id = String(nextId++)
    setRows(rs => [...rs, { id, name: `Item ${id}`, group: GROUPS[nextId % GROUPS.length], value: 10 }])
  }
  const removeRow = (id: string) => setRows(rs => rs.filter(r => r.id !== id))
  const updateName  = (id: string, v: string) => setRows(rs => rs.map(r => r.id === id ? { ...r, name: v } : r))
  const updateGroup = (id: string, v: string) => setRows(rs => rs.map(r => r.id === id ? { ...r, group: v } : r))
  const updateValue = (id: string, raw: string) => {
    const v = parseInt(raw, 10)
    if (!isNaN(v) && v >= 0) setRows(rs => rs.map(r => r.id === id ? { ...r, value: v } : r))
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>

      {/* Left: table */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#888', fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Data</span>
          <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#777', cursor: 'pointer' }}>
            <input type="checkbox" checked={grouped} onChange={e => setGrouped(e.target.checked)} />
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
                  <td style={tdStyle}><input style={inputStyle} value={r.name} onChange={e => updateName(r.id, e.target.value)} /></td>
                  {grouped && (
                    <td style={tdStyle}>
                      <select style={{ ...inputStyle, background: '#1a1a1a' }} value={r.group} onChange={e => updateGroup(r.id, e.target.value)}>
                        {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
                  )}
                  <td style={tdStyle}><input style={{ ...inputStyle, textAlign: 'right' }} value={r.value} type="number" min={0} onChange={e => updateValue(r.id, e.target.value)} /></td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <button onClick={() => removeRow(r.id)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 10px', borderTop: '1px solid #2a2a2a' }}>
          <button onClick={addRow} style={{ ...btnBase, width: '100%' }}>+ Add row</button>
        </div>
      </div>

      {/* Right: viz */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid #2a2a2a', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
          {FLAT_MODES.map(m => (
            <button key={m} style={mode === m ? btnActive : btnBase} onClick={() => setMode(m)}>{m}</button>
          ))}
          <span style={{ color: '#444', fontSize: 11 }}>|</span>
          {HIER_MODES.map(m => (
            <button key={m} style={mode === m ? btnActive : btnBase} onClick={() => setMode(m)}>{HIER_LABELS[m]}</button>
          ))}
          {!isHier && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button style={sortMode === 'index' ? btnActive : btnBase} onClick={() => setSortMode('index')}>idx</button>
              <button style={sortMode === 'size' ? btnActive : btnBase} onClick={() => setSortMode('size')}>↓val</button>
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 13 }}>
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
                frame={undefined} onUpdate={handleUpdate}
              />
            )}
          </div>
        )}
      </div>

    </div>
  )
}

const thStyle: React.CSSProperties = { padding: '4px 8px', textAlign: 'left', color: '#555', fontWeight: 400, fontSize: 11, borderBottom: '1px solid #222' }
const tdStyle: React.CSSProperties = { padding: '2px 4px', borderBottom: '1px solid #1a1a1a' }
const inputStyle: React.CSSProperties = { width: '100%', background: 'transparent', border: 'none', color: '#ccc', fontSize: 12, padding: '2px 4px', outline: 'none' }
