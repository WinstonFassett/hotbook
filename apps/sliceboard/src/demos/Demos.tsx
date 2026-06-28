/**
 * /demos — kitchen-sink isolated chart pages.
 *
 * Each chart renders against a checked-in fixture (no sliceboard, no config UI,
 * no persistence). Spike harness for developing chart features in isolation.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { HTreetable } from '@winstonfassett/vizform-react-d3'
import {
  BrLcBar, BrLcLine, BrLcArea, BrLcScatter, BrLcPie, BrLcRadar, BrLcConcentricArc,
  BrLcPack, BrLcTreemap, BrLcIcicle, BrLcSunburst, BrLcSankey, BrLcSankeyFlow, BrLcTree,
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

interface DemoDef {
  slug: string
  label: string
  fixtureName: string
  fixture: unknown
  render: () => ReactNode
}

const DEMOS: DemoDef[] = [
  {
    slug: 'treetable', label: 'Treetable', fixtureName: 'team-hier', fixture: TEAM,
    render: () => <HTreetable nodes={TEAM.rows} measureKey="budget" />,
  },
  {
    slug: 'br-lc-bar', label: 'Bar', fixtureName: 'fruit-flat', fixture: FRUIT,
    render: () => <BrLcBar nodes={FRUIT.rows} measureKey="value" />,
  },
  {
    slug: 'br-lc-line', label: 'Line', fixtureName: 'fruit-flat', fixture: FRUIT,
    render: () => <BrLcLine nodes={FRUIT.rows} measureKey="value" />,
  },
  {
    slug: 'br-lc-area', label: 'Area', fixtureName: 'fruit-flat', fixture: FRUIT,
    render: () => <BrLcArea nodes={FRUIT.rows} measureKey="value" />,
  },
  {
    slug: 'br-lc-scatter', label: 'Scatter', fixtureName: 'fruit-flat', fixture: FRUIT,
    render: () => <BrLcScatter nodes={FRUIT.rows} xKey="value" yKey="value2" />,
  },
  {
    slug: 'br-lc-pie', label: 'Pie', fixtureName: 'fruit-flat', fixture: FRUIT,
    render: () => <BrLcPie nodes={FRUIT.rows} measureKey="value" />,
  },
  {
    slug: 'br-lc-radar', label: 'Radar', fixtureName: 'fruit-flat', fixture: FRUIT,
    render: () => <BrLcRadar nodes={FRUIT.rows} measureKey="value" />,
  },
  {
    slug: 'br-lc-concentric-arc', label: 'Concentric Arc', fixtureName: 'fruit-flat', fixture: FRUIT,
    render: () => <BrLcConcentricArc nodes={FRUIT.rows} measureKey="value" />,
  },
  {
    slug: 'br-lc-pack', label: 'Pack', fixtureName: 'team-hier', fixture: TEAM,
    render: () => <BrLcPack nodes={TEAM.rows} measureKey="budget" />,
  },
  {
    slug: 'br-lc-treemap', label: 'Treemap', fixtureName: 'team-hier', fixture: TEAM,
    render: () => <BrLcTreemap nodes={TEAM.rows} measureKey="budget" />,
  },
  {
    slug: 'br-lc-icicle', label: 'Icicle', fixtureName: 'team-hier', fixture: TEAM,
    render: () => <BrLcIcicle nodes={TEAM.rows} measureKey="budget" />,
  },
  {
    slug: 'br-lc-sunburst', label: 'Sunburst', fixtureName: 'team-hier', fixture: TEAM,
    render: () => <BrLcSunburst nodes={TEAM.rows} measureKey="budget" />,
  },
  {
    slug: 'br-lc-tree', label: 'Tree', fixtureName: 'team-hier', fixture: TEAM,
    render: () => <BrLcTree nodes={TEAM.rows} measureKey="budget" />,
  },
  {
    slug: 'br-lc-sankey', label: 'Sankey', fixtureName: 'supply-edges', fixture: SUPPLY,
    render: () => <BrLcSankey edges={SUPPLY.edges} />,
  },
  {
    slug: 'br-lc-sankey-flow', label: 'Sankey Flow', fixtureName: '(built-in)', fixture: { note: 'conservation-flow demo uses element internal data' },
    render: () => <BrLcSankeyFlow />,
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
  if (!slug) return <DemoIndex />
  const demo = DEMOS.find(d => d.slug === slug)
  if (!demo) return <NotFound slug={slug} />
  return (
    <DemoFrame title={demo.label} fixtureName={demo.fixtureName} fixture={demo.fixture}>
      {demo.render()}
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

