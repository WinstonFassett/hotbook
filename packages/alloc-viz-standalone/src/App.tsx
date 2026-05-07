import { useState, useCallback } from 'react'
import { Viz, pickColor } from 'alloc-viz-react'
import type { Goal, ViewMode } from 'alloc-viz-react'

interface Row {
  id: string
  name: string
  value: number
}

const INITIAL_ROWS: Row[] = [
  { id: '1', name: 'Alpha',   value: 40 },
  { id: '2', name: 'Beta',    value: 25 },
  { id: '3', name: 'Gamma',   value: 20 },
  { id: '4', name: 'Delta',   value: 15 },
]

function rowsToGoals(rows: Row[]): Goal[] {
  return rows.map((r, idx) => ({
    id: r.id,
    name: r.name,
    color: pickColor(idx),
    measurements: { value: r.value, _index: idx },
    archived: false,
    tags: [],
    urgent: false,
    important: false,
    createdAt: '',
    updatedAt: '',
  }))
}

let nextId = INITIAL_ROWS.length + 1

const btnBase: React.CSSProperties = {
  padding: '2px 10px',
  borderRadius: 4,
  border: '1px solid #444',
  background: 'transparent',
  color: '#ccc',
  cursor: 'pointer',
  fontSize: 11,
}
const btnActive: React.CSSProperties = { ...btnBase, background: '#444', color: '#fff' }

export function App() {
  const [rows, setRows] = useState<Row[]>(INITIAL_ROWS)
  const [mode, setMode] = useState<ViewMode>('treemap')
  const [sortMode, setSortMode] = useState<'index' | 'size'>('index')

  const goals = rowsToGoals(rows)

  const handleUpdate = useCallback((id: string, patch: Partial<Goal>) => {
    if (!patch.measurements) return
    const newVal = patch.measurements['value']
    if (newVal == null) return
    setRows(rs => rs.map(r => r.id === id ? { ...r, value: newVal as number } : r))
  }, [])

  const addRow = () => {
    const id = String(nextId++)
    setRows(rs => [...rs, { id, name: `Item ${id}`, value: 10 }])
  }

  const removeRow = (id: string) => setRows(rs => rs.filter(r => r.id !== id))

  const updateName = (id: string, name: string) =>
    setRows(rs => rs.map(r => r.id === id ? { ...r, name } : r))

  const updateValue = (id: string, raw: string) => {
    const v = parseInt(raw, 10)
    if (!isNaN(v) && v >= 0) setRows(rs => rs.map(r => r.id === id ? { ...r, value: v } : r))
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>

      {/* Left: table panel */}
      <div style={{
        width: 260, flexShrink: 0, borderRight: '1px solid #2a2a2a',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #2a2a2a', color: '#888', fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Data
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={{ ...thStyle, width: 60 }}>Value</th>
                <th style={{ ...thStyle, width: 28 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={tdStyle}>
                    <input
                      style={inputStyle}
                      value={r.name}
                      onChange={e => updateName(r.id, e.target.value)}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      style={{ ...inputStyle, textAlign: 'right' }}
                      value={r.value}
                      type="number"
                      min={0}
                      onChange={e => updateValue(r.id, e.target.value)}
                    />
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <button
                      onClick={() => removeRow(r.id)}
                      style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
                      title="Remove row"
                    >×</button>
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

      {/* Right: viz panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Mode strip */}
        <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid #2a2a2a', flexShrink: 0, alignItems: 'center' }}>
          {(['treemap', 'radial', 'bands'] as ViewMode[]).map(m => (
            <button key={m} style={mode === m ? btnActive : btnBase} onClick={() => setMode(m)}>
              {m}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button style={sortMode === 'index' ? btnActive : btnBase} onClick={() => setSortMode('index')} title="Sort by table order">idx</button>
            <button style={sortMode === 'size' ? btnActive : btnBase} onClick={() => setSortMode('size')} title="Sort by value">↓val</button>
          </div>
        </div>

        {rows.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 13 }}>
            Add a row to visualize
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Viz
              goals={goals}
              mode={mode}
              activeUnit="value"
              unitKind="size"
              sortUnit={sortMode === 'index' ? '_index' : 'value'}
              sortUnitKind={sortMode === 'index' ? 'order' : 'size'}
              frame={undefined}
              onUpdate={handleUpdate}
            />
          </div>
        )}
      </div>

    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '4px 8px',
  textAlign: 'left',
  color: '#555',
  fontWeight: 400,
  fontSize: 11,
  borderBottom: '1px solid #222',
}

const tdStyle: React.CSSProperties = {
  padding: '2px 4px',
  borderBottom: '1px solid #1a1a1a',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  color: '#ccc',
  fontSize: 12,
  padding: '2px 4px',
  outline: 'none',
}
