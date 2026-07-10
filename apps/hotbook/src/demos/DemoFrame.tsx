import { useState, type ReactNode } from 'react'

interface Props {
  title: string
  fixtureName: string
  fixture: unknown
  children: ReactNode
}

export function DemoFrame({ title, fixtureName, fixture, children }: Props) {
  const [showRaw, setShowRaw] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '8px 16px',
        borderBottom: '1px solid #2a2a2a', background: '#1a1a1a', color: '#ddd', flex: '0 0 auto',
      }}>
        <a href="#/demos" style={{ color: '#7aaae8', textDecoration: 'none', fontSize: 13 }}>← demos</a>
        <h1 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{title}</h1>
        <span style={{ fontSize: 12, opacity: 0.6 }}>fixture: <code>{fixtureName}</code></span>
        <button
          onClick={() => setShowRaw(s => !s)}
          style={{
            marginLeft: 'auto', padding: '4px 10px', fontSize: 12, cursor: 'pointer',
            background: showRaw ? '#3a5a8a' : '#2a2a2a', color: '#ddd',
            border: '1px solid #444', borderRadius: 3,
          }}
        >{showRaw ? 'hide raw' : 'show raw'}</button>
      </header>
      <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, position: 'relative', background: '#0e0e0e' }}>
          {children}
        </div>
        {showRaw && (
          <aside style={{
            flex: '0 0 360px', overflow: 'auto', borderLeft: '1px solid #2a2a2a',
            background: '#101010', color: '#bbb', fontFamily: 'ui-monospace, monospace', fontSize: 11,
            padding: 12, whiteSpace: 'pre',
          }}>{JSON.stringify(fixture, null, 2)}</aside>
        )}
      </div>
    </div>
  )
}
