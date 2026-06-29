/**
 * /demos — kitchen-sink isolated chart pages.
 *
 * Each chart renders against a checked-in fixture (no sliceboard, no config UI,
 * no persistence). Spike harness for developing chart features in isolation.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { HTreetable } from '@winstonfassett/vizform-react-d3'
import {
  BrLcBar, BrLcLine, BrLcArea, BrLcScatter, BrLcPie, BrLcRadar, BrLcConcentricArc,
  BrLcPack, BrLcTreemap, BrLcIcicle, BrLcSunburst, BrLcSankey, BrLcSankeyFlow, BrLcSankeyGrouped, BrLcSankeyHier, BrLcTree,
} from '../viz/br/BrLcCharts'
import type { PNode, PEdge } from '../persistence'
import { DemoFrame } from './DemoFrame'
import fruitFlat from './fixtures/fruit-flat.json'
import teamHier from './fixtures/team-hier.json'
import supplyEdges from './fixtures/supply-edges.json'

interface FlatFixture { name: string; description: string; rows: PNode[] }
interface EdgeFixture { name: string; description: string; edges: PEdge[] }
const FRUIT: FlatFixture = fruitFlat as FlatFixture
const TEAM:  FlatFixture = teamHier  as FlatFixture
const SUPPLY: EdgeFixture = supplyEdges as EdgeFixture

type OnNodeUpdate = (nodeId: string, measures: PNode['measures']) => void
type OnNodesUpdate = (updates: Array<{ id: string; measures: PNode['measures'] }>) => void

interface DemoDef {
  slug: string
  label: string
  fixtureName: string
  fixture: unknown
  initRows?: PNode[]
  initEdges?: PEdge[]
  render: (rows: PNode[], edges: PEdge[], onNodeUpdate: OnNodeUpdate, onNodesUpdate: OnNodesUpdate) => ReactNode
}

const DEMOS: DemoDef[] = [
  {
    slug: 'treetable', label: 'Treetable', fixtureName: 'team-hier', fixture: TEAM,
    initRows: TEAM.rows,
    render: (rows) => <HTreetable nodes={rows} measureKey="budget" />,
  },
  {
    slug: 'br-lc-bar', label: 'Bar', fixtureName: 'fruit-flat', fixture: FRUIT,
    initRows: FRUIT.rows,
    render: (rows, _edges, onNodeUpdate) => <BrLcBar nodes={rows} measureKey="value" onUpdate={onNodeUpdate} />,
  },
  {
    slug: 'br-lc-line', label: 'Line', fixtureName: 'fruit-flat', fixture: FRUIT,
    initRows: FRUIT.rows,
    render: (rows, _edges, onNodeUpdate) => <BrLcLine nodes={rows} measureKey="value" onUpdate={onNodeUpdate} />,
  },
  {
    slug: 'br-lc-area', label: 'Area', fixtureName: 'fruit-flat', fixture: FRUIT,
    initRows: FRUIT.rows,
    render: (rows, _edges, onNodeUpdate) => <BrLcArea nodes={rows} measureKey="value" onUpdate={onNodeUpdate} />,
  },
  {
    slug: 'br-lc-scatter', label: 'Scatter', fixtureName: 'fruit-flat', fixture: FRUIT,
    initRows: FRUIT.rows,
    render: (rows, _edges, onNodeUpdate) => <BrLcScatter nodes={rows} xKey="value" yKey="value2" onUpdate={onNodeUpdate} />,
  },
  {
    slug: 'br-lc-pie', label: 'Pie', fixtureName: 'fruit-flat', fixture: FRUIT,
    initRows: FRUIT.rows,
    render: (rows, _edges, onNodeUpdate, onNodesUpdate) => <BrLcPie nodes={rows} measureKey="value" onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />,
  },
  {
    slug: 'br-lc-radar', label: 'Radar', fixtureName: 'fruit-flat', fixture: FRUIT,
    initRows: FRUIT.rows,
    render: (rows, _edges, onNodeUpdate) => <BrLcRadar nodes={rows} measureKey="value" onUpdate={onNodeUpdate} />,
  },
  {
    slug: 'br-lc-concentric-arc', label: 'Concentric Arc', fixtureName: 'fruit-flat', fixture: FRUIT,
    initRows: FRUIT.rows,
    render: (rows, _edges, onNodeUpdate) => <BrLcConcentricArc nodes={rows} measureKey="value" onUpdate={onNodeUpdate} />,
  },
  {
    slug: 'br-lc-pack', label: 'Pack', fixtureName: 'team-hier', fixture: TEAM,
    initRows: TEAM.rows,
    render: (rows, _edges, onNodeUpdate, onNodesUpdate) => <BrLcPack nodes={rows} measureKey="budget" onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />,
  },
  {
    slug: 'br-lc-treemap', label: 'Treemap', fixtureName: 'team-hier', fixture: TEAM,
    initRows: TEAM.rows,
    render: (rows, _edges, onNodeUpdate, onNodesUpdate) => <BrLcTreemap nodes={rows} measureKey="budget" onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />,
  },
  {
    slug: 'br-lc-icicle', label: 'Icicle', fixtureName: 'team-hier', fixture: TEAM,
    initRows: TEAM.rows,
    render: (rows, _edges, onNodeUpdate, onNodesUpdate) => <BrLcIcicle nodes={rows} measureKey="budget" onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />,
  },
  {
    slug: 'br-lc-sunburst', label: 'Sunburst', fixtureName: 'team-hier', fixture: TEAM,
    initRows: TEAM.rows,
    render: (rows, _edges, onNodeUpdate, onNodesUpdate) => <BrLcSunburst nodes={rows} measureKey="budget" onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />,
  },
  {
    slug: 'br-lc-tree', label: 'Tree', fixtureName: 'team-hier', fixture: TEAM,
    initRows: TEAM.rows,
    render: (rows, _edges, onNodeUpdate, onNodesUpdate) => <BrLcTree nodes={rows} measureKey="budget" onUpdate={onNodeUpdate} onUpdateMany={onNodesUpdate} />,
  },
  {
    slug: 'br-lc-sankey', label: 'Sankey', fixtureName: 'supply-edges', fixture: SUPPLY,
    initEdges: SUPPLY.edges,
    render: (_rows, edges) => <BrLcSankey edges={edges} />,
  },
  {
    slug: 'br-lc-sankey-flow', label: 'Sankey Flow', fixtureName: '(built-in)', fixture: { note: 'conservation-flow demo uses element internal data' },
    render: () => <BrLcSankeyFlow />,
  },
  {
    slug: 'br-lc-sankey-grouped', label: 'Sankey (grouped)', fixtureName: '(built-in)', fixture: { note: 'WIN-56 spike — grouped nodes, hierarchical containers' },
    render: () => <BrLcSankeyGrouped />,
  },
  {
    slug: 'br-lc-sankey-hier', label: 'Sankey (hierarchical, expand/collapse)', fixtureName: '(built-in)', fixture: { note: 'WIN-56 — click dashed bars to expand/collapse group nodes' },
    render: () => <BrLcSankeyHier />,
  },
]

function useHashRoute(): string {
  // Returns the part after #/demos — '' for the index, or e.g. 'br-lc-bar' for a chart route.
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const m = hash.match(/^#\/demos\/?(.*)$/)
  return m?.[1] ?? ''
}

export function Demos() {
  const slug = useHashRoute()

  // Reactive fixture state — keyed by slug so navigation preserves edits.
  const [rowsMap, setRowsMap] = useState<Record<string, PNode[]>>(() =>
    Object.fromEntries(
      DEMOS.filter(d => d.initRows).map(d => [d.slug, d.initRows!])
    )
  )
  const [edgesMap, setEdgesMap] = useState<Record<string, PEdge[]>>(() =>
    Object.fromEntries(
      DEMOS.filter(d => d.initEdges).map(d => [d.slug, d.initEdges!])
    )
  )

  const handleNodeUpdate = useCallback((demoSlug: string, nodeId: string, measures: PNode['measures']) => {
    setRowsMap(prev => ({
      ...prev,
      [demoSlug]: (prev[demoSlug] ?? []).map(r => r.id !== nodeId ? r : { ...r, measures }),
    }))
  }, [])

  const handleNodesUpdate = useCallback((demoSlug: string, updates: Array<{ id: string; measures: PNode['measures'] }>) => {
    const byId = new Map(updates.map(u => [u.id, u.measures]))
    setRowsMap(prev => ({
      ...prev,
      [demoSlug]: (prev[demoSlug] ?? []).map(r => {
        const m = byId.get(r.id)
        return m !== undefined ? { ...r, measures: m } : r
      }),
    }))
  }, [])

  if (!slug) return <DemoIndex />
  const demo = DEMOS.find(d => d.slug === slug)
  if (!demo) return <NotFound slug={slug} />

  const rows = rowsMap[slug] ?? []
  const edges = edgesMap[slug] ?? []
  const onNodeUpdate: OnNodeUpdate = (nodeId, measures) => handleNodeUpdate(slug, nodeId, measures)
  const onNodesUpdate: OnNodesUpdate = (updates) => handleNodesUpdate(slug, updates)

  return (
    <DemoFrame title={demo.label} fixtureName={demo.fixtureName} fixture={demo.fixture}>
      {demo.render(rows, edges, onNodeUpdate, onNodesUpdate)}
    </DemoFrame>
  )
}

function DemoIndex() {
  return (
    <div style={{
      minHeight: '100vh', background: '#0e0e0e', color: '#ddd',
      fontFamily: 'system-ui, -apple-system, sans-serif', padding: '32px 48px',
    }}>
      <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>vizform — chart demos</h1>
      <p style={{ fontSize: 13, opacity: 0.7, margin: '0 0 24px', maxWidth: 640 }}>
        Each chart rendered in isolation against a small checked-in fixture. No sliceboard, no
        config UI, no persistence. Use this surface to develop and debug a single chart without
        the tile plumbing in the way.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
        {DEMOS.map(d => (
          <li key={d.slug}>
            <a href={`#/demos/${d.slug}`} style={{
              display: 'block', padding: '12px 14px', textDecoration: 'none',
              background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4, color: '#ddd',
            }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{d.label}</div>
              <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>
                <code>{d.slug}</code> · fixture <code>{d.fixtureName}</code>
              </div>
            </a>
          </li>
        ))}
      </ul>
      <p style={{ fontSize: 12, opacity: 0.5, marginTop: 32 }}>
        ← <a href="#/" style={{ color: '#7aaae8' }}>back to sliceboard</a>
      </p>
    </div>
  )
}

function NotFound({ slug }: { slug: string }) {
  return (
    <div style={{ padding: 32, color: '#ddd', background: '#0e0e0e', minHeight: '100vh', fontFamily: 'system-ui' }}>
      <p>Unknown demo: <code>{slug}</code></p>
      <a href="#/demos" style={{ color: '#7aaae8' }}>← demos</a>
    </div>
  )
}
