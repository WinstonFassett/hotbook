import { useState, useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { colorFor } from '@hotbook/core'
import type { VizNode } from '../persistence'

// ─── Resize-aware dimensions ──────────────────────────────────────────────────

export function useDimensions(): [React.RefObject<SVGSVGElement>, number, number] {
  const ref = useRef<SVGSVGElement>(null)
  const [dims, setDims] = useState<[number, number]>([0, 0])

  useEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const ro = new ResizeObserver(entries => {
      const e = entries[0]
      if (!e) return
      const { width, height } = e.contentRect
      setDims(([pw, ph]) => (Math.round(width) === pw && Math.round(height) === ph ? [pw, ph] : [Math.round(width), Math.round(height)]))
    })
    ro.observe(el)
    // Seed from current size (getBoundingClientRect works on SVG; clientWidth/clientHeight return 0)
    const r = el.getBoundingClientRect()
    if (r.width > 0 || r.height > 0) setDims([Math.round(r.width), Math.round(r.height)])
    return () => ro.disconnect()
  }, [])

  return [ref, dims[0], dims[1]]
}

// ─── Alt+scroll to edit measurement ──────────────────────────────────────────

export function useAltScroll(
  ref: React.RefObject<SVGSVGElement>,
  nodes: VizNode[],
  measureKey: string,
  cellSelector: string,
  nodeIdAttr: string,
  onUpdate: (nodeId: string, measures: VizNode['measures']) => void,
) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const hit = document.elementFromPoint(e.clientX, e.clientY) as Element | null
      const cell = hit?.closest(cellSelector) as SVGElement | null
      if (!cell) return
      const id = cell.getAttribute(nodeIdAttr)
      if (!id) return
      const node = nodes.find(n => n.id === id)
      if (!node) return
      e.preventDefault()
      e.stopPropagation()
      const cur = node.measures[measureKey] ?? 0
      const step = e.shiftKey ? 5 : 1
      const next = Math.max(1, cur + (e.deltaY < 0 ? 1 : -1) * step)
      if (next !== cur) onUpdate(id, { ...node.measures, [measureKey]: next })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [ref, nodes, measureKey, onUpdate, cellSelector, nodeIdAttr])
}

// ─── Motion ───────────────────────────────────────────────────────────────────

export type EaseShape = 'linear' | 'sin' | 'quad' | 'cubic' | 'poly' | 'exp'
export type MotionRole = 'move' | 'enter' | 'exit'

export interface MotionSpec {
  duration: number
  ease: (t: number) => number
  explodeMin: number
}

type EaseDir = 'in' | 'out' | 'inOut'

const EASE_TABLE: Record<EaseShape, Record<EaseDir, (t: number) => number>> = {
  linear: { in: d3.easeLinear, out: d3.easeLinear, inOut: d3.easeLinear },
  sin:    { in: d3.easeSinIn,    out: d3.easeSinOut,    inOut: d3.easeSinInOut },
  quad:   { in: d3.easeQuadIn,   out: d3.easeQuadOut,   inOut: d3.easeQuadInOut },
  cubic:  { in: d3.easeCubicIn,  out: d3.easeCubicOut,  inOut: d3.easeCubicInOut },
  poly:   { in: d3.easePolyIn,   out: d3.easePolyOut,   inOut: d3.easePolyInOut },
  exp:    { in: d3.easeExpIn,    out: d3.easeExpOut,     inOut: d3.easeExpInOut },
}

const DUR = { move: 600, enter: 380, exit: 240 }

export function motion(role: MotionRole, scale = 1, shape: EaseShape = 'cubic', explodeAmount = 0): MotionSpec {
  const dir: EaseDir = role === 'move' ? 'inOut' : 'out'
  return {
    duration: Math.max(0, Math.round(DUR[role] * scale)),
    ease: EASE_TABLE[shape][dir],
    explodeMin: 1 - Math.max(0, Math.min(0.5, explodeAmount)),
  }
}

export function explodePulse(t: number): number {
  return t < 0.5 ? t * 2 : (1 - t) * 2
}

// ─── Color ────────────────────────────────────────────────────────────────────

export function nodeColor(nodes: VizNode[], id: string): string {
  const byId = new Map(nodes.map(n => [n.id, n]))
  let cur = byId.get(id)
  let root = cur
  while (cur) {
    if (cur.color) return cur.color
    root = cur
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return colorFor(root?.name ?? id)
}

export function statusVar(status: string): string {
  return `var(--pv-status-${status})`
}

export function fmtNum(v: number): string {
  if (v === 0) return '0'
  if (v < 1) return v.toFixed(2)
  if (v < 10) return v.toFixed(1)
  return Math.round(v).toString()
}

// ─── Tree builder ─────────────────────────────────────────────────────────────

export type TreeDatum = { id: string; children?: TreeDatum[] }

export function buildVizTree(nodes: VizNode[]): TreeDatum | null {
  function build(id: string): TreeDatum | null {
    const kids = nodes
      .filter(n => n.parentId === id)
      .sort((a, b) => a.index - b.index)
      .map(k => build(k.id))
      .filter((x): x is TreeDatum => !!x)
    return { id, ...(kids.length ? { children: kids } : {}) }
  }
  const roots = nodes.filter(n => n.parentId === null).map(r => build(r.id)).filter((x): x is TreeDatum => !!x)
  if (roots.length === 0) return null
  return { id: '__root__', children: roots }
}
