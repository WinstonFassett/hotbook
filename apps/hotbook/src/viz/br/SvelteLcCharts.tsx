// Svelte LayerChart adaptation surfaced on sliceboard.
//
// These are the REAL Svelte 5 + LayerChart components from
// apps/svelte-layerchart-spike, compiled to web components by the svelte Vite
// plugin and consumed here live from source (see sliceboard vite.config.ts:
// the `svelte()` plugin + `@svelte-lc` alias). They are the canon the vanilla
// BR-LC ports (BrLcCharts.tsx) were derived from — surfacing them lets us
// compare Svelte-render vs Vanilla-render vs D3 side-by-side on the board.
//
// Each *LC.svelte now accepts an `externalRoot` BiNode tree (built from the
// active dataset) and writes edits back through it, and exposes the same
// `brSync` cross-tile hover/select bridge as the vanilla ones — so we reuse
// BrLcCharts' generic `useLiveHierElement` hook unchanged, just pointed at the
// Svelte custom-element tags. The tree shape is structurally identical across
// both spikes (TreeNode<{id?,label,color,total}>), so externalRoot is directly
// compatible with what `buildBiTree` produces.

import { useEffect, useRef } from 'react'
import type { VizNode } from '../../persistence'
import { makeHierSource, hierShapeKey, hierValueKey } from './bindTile'
import { BrLcTile } from './BrLcTile'

// Importing each component runs its <svelte:options customElement="…"> which
// registers the element with customElements — no manual define() needed.
import '@svelte-lc/lib/SunburstLC.svelte'
import '@svelte-lc/lib/IcicleLC.svelte'
import '@svelte-lc/lib/PackLC.svelte'
import '@svelte-lc/lib/TreemapLC.svelte'
import '@svelte-lc/lib/Treemap.svelte'

interface HierProps {
  nodes: VizNode[]
  measureKey: string
  onUpdate?: (nodeId: string, measures: VizNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: VizNode['measures'] }>) => void
}

// Build a hier TileSource for a Svelte custom-element tag (same path as the
// vanilla `makeHier`; Svelte charts take no depth/sortBy).
function makeHier(tag: string, { nodes, measureKey, onUpdate, onUpdateMany }: HierProps) {
  return makeHierSource({
    tag, nodes, measureKey,
    shapeKey: hierShapeKey(tag, nodes, measureKey),
    valueKey: hierValueKey(nodes, measureKey),
    onUpdate, onUpdateMany,
  })
}

export function SvelteLcSunburst(props: HierProps) {
  return <BrLcTile source={makeHier('lc-sunburst-lc', props)} />
}

export function SvelteLcIcicle(props: HierProps) {
  return <BrLcTile source={makeHier('lc-icicle-lc', props)} />
}

export function SvelteLcPack(props: HierProps) {
  return <BrLcTile source={makeHier('lc-pack-lc', props)} />
}

export function SvelteLcTreemap(props: HierProps) {
  return <BrLcTile source={makeHier('lc-treemap-lc', props)} />
}

// The non-LayerChart d3 Svelte demo. NOT bireactive/LC and has no external-data
// seam, so it renders its own internal demo data only (no live sync, no
// write-back). Mounted once; nothing to drive.
export function SvelteTreemapDemo() {
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const el = document.createElement('lc-treemap-demo')
    container.appendChild(el)
    return () => { if (container.contains(el)) container.removeChild(el) }
  }, [])
  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
