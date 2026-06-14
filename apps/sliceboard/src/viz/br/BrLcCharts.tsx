import { useEffect, useRef } from 'react'
import type { PNode } from '../../persistence'
import { buildBiTree, buildFlatBiData } from './tree'

import { MdBarChartLC } from '@br-lc/demos/bar-chart'
import { MdLineChartLC } from '@br-lc/demos/line-chart'
import { MdAreaChartLC } from '@br-lc/demos/area-chart'
import { MdScatterChartLC } from '@br-lc/demos/scatter-chart'
import { MdPieChartLC } from '@br-lc/demos/pie-chart'
import { MdRadarChartLC } from '@br-lc/demos/radar-chart'
import { MdConcentricArcLC } from '@br-lc/demos/concentric-arc'
import { MdPack } from '@br-lc/demos/pack'
import { MdTreemapLC } from '@br-lc/demos/treemap'
import { MdIcicleLC } from '@br-lc/demos/icicle'
import { MdSunburstLC } from '@br-lc/demos/sunburst'

// Register custom elements once
const TAGS = [
  ['v-br-bar',            MdBarChartLC],
  ['v-br-line',           MdLineChartLC],
  ['v-br-area',           MdAreaChartLC],
  ['v-br-scatter',        MdScatterChartLC],
  ['v-br-pie',            MdPieChartLC],
  ['v-br-radar',          MdRadarChartLC],
  ['v-br-concentric-arc', MdConcentricArcLC],
  ['v-br-pack',           MdPack],
  ['v-br-treemap',        MdTreemapLC],
  ['v-br-icicle',         MdIcicleLC],
  ['v-br-sunburst',       MdSunburstLC],
] as const

for (const [tag, cls] of TAGS) {
  if (!customElements.get(tag)) customElements.define(tag, cls as CustomElementConstructor)
}

// ─── Generic wrapper ──────────────────────────────────────────────────────────

function useBrElement<T extends HTMLElement>(
  tag: string,
  setup: (el: T) => void,
  deps: unknown[],
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const elRef = useRef<T | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // Remove previous instance
    if (elRef.current) {
      container.removeChild(elRef.current)
      elRef.current = null
    }
    const el = document.createElement(tag) as T
    el.setAttribute('no-source', '')
    setup(el)
    container.appendChild(el)
    elRef.current = el
    return () => {
      if (container.contains(el)) container.removeChild(el)
      elRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return containerRef
}

// ─── Flat charts (label + value) ─────────────────────────────────────────────

interface FlatProps {
  nodes: PNode[]
  measureKey: string
}

export function BrLcBar({ nodes, measureKey }: FlatProps) {
  const data = buildFlatBiData(nodes, measureKey)
  const ref = useBrElement<MdBarChartLC>('v-br-bar', el => { el.externalData = data }, [JSON.stringify(data)])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcPie({ nodes, measureKey }: FlatProps) {
  const data = buildFlatBiData(nodes, measureKey)
  const ref = useBrElement<MdPieChartLC>('v-br-pie', el => { el.externalData = data }, [JSON.stringify(data)])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcRadar({ nodes, measureKey }: FlatProps) {
  const data = buildFlatBiData(nodes, measureKey).map(d => ({ name: d.label, value: d.value }))
  const ref = useBrElement<MdRadarChartLC>('v-br-radar', el => { el.externalData = data as any }, [JSON.stringify(data)])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcConcentricArc({ nodes, measureKey }: FlatProps) {
  const data = buildFlatBiData(nodes, measureKey).map((d, i) => ({
    label: d.label,
    color: ['#e05c5c', '#f0a742', '#4cba6e', '#5b8def', '#b76de0', '#44c4c4'][i % 6]!,
    value: Math.min(100, Math.round(d.value)),
  }))
  const ref = useBrElement<MdConcentricArcLC>('v-br-concentric-arc', el => { el.externalData = data as any }, [JSON.stringify(data)])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Scatter (two measures) ───────────────────────────────────────────────────

interface ScatterProps {
  nodes: PNode[]
  xKey: string
  yKey: string
}

export function BrLcScatter({ nodes, xKey, yKey }: ScatterProps) {
  const leaves = nodes.filter(n => !nodes.some(m => m.parentId === n.id))
  const data = leaves.map(n => ({ x: n.measures[xKey] ?? 0, y: n.measures[yKey] ?? 0 }))
  const ref = useBrElement<MdScatterChartLC>('v-br-scatter', el => { el.externalData = data }, [JSON.stringify(data)])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Time-series (index as x, measure as y) ───────────────────────────────────

export function BrLcLine({ nodes, measureKey }: FlatProps) {
  const leaves = nodes.filter(n => !nodes.some(m => m.parentId === n.id))
  const start = new Date(2026, 0, 1).getTime()
  const day = 86400 * 1000
  const data = leaves.map((n, i) => ({ date: new Date(start + i * day), value: n.measures[measureKey] ?? 0 }))
  const ref = useBrElement<MdLineChartLC>('v-br-line', el => { el.externalData = data }, [JSON.stringify(data)])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcArea({ nodes, measureKey }: FlatProps) {
  const leaves = nodes.filter(n => !nodes.some(m => m.parentId === n.id))
  const start = new Date(2026, 0, 1).getTime()
  const day = 86400 * 1000
  const data = leaves.map((n, i) => ({ date: new Date(start + i * day), value: n.measures[measureKey] ?? 0 }))
  const ref = useBrElement<MdAreaChartLC>('v-br-area', el => { el.externalData = data }, [JSON.stringify(data)])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

// ─── Hierarchical charts (BiNode) ─────────────────────────────────────────────

interface HierProps {
  nodes: PNode[]
  measureKey: string
}

export function BrLcPack({ nodes, measureKey }: HierProps) {
  const root = buildBiTree(nodes, measureKey)
  const ref = useBrElement<MdPack>('v-br-pack', el => { if (root) el.externalRoot = root }, [measureKey, nodes.map(n => `${n.id}:${n.measures[measureKey]}`).join(',')])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcTreemap({ nodes, measureKey }: HierProps) {
  const root = buildBiTree(nodes, measureKey)
  const ref = useBrElement<MdTreemapLC>('v-br-treemap', el => { if (root) el.externalRoot = root }, [measureKey, nodes.map(n => `${n.id}:${n.measures[measureKey]}`).join(',')])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcIcicle({ nodes, measureKey }: HierProps) {
  const root = buildBiTree(nodes, measureKey)
  const ref = useBrElement<MdIcicleLC>('v-br-icicle', el => { if (root) el.externalRoot = root }, [measureKey, nodes.map(n => `${n.id}:${n.measures[measureKey]}`).join(',')])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}

export function BrLcSunburst({ nodes, measureKey }: HierProps) {
  const root = buildBiTree(nodes, measureKey)
  const ref = useBrElement<MdSunburstLC>('v-br-sunburst', el => { if (root) el.externalRoot = root }, [measureKey, nodes.map(n => `${n.id}:${n.measures[measureKey]}`).join(',')])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}
