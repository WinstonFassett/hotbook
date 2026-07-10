import React, { useEffect, useRef } from 'react'
import { mountIcicle, mountSunburst, mountTreemap } from '@hotbook/d3'
import type { IcicleMounted, SunburstMounted, TreemapMounted } from '@hotbook/d3'
import type { VizNode, HierMode } from '@hotbook/d3'

interface HVizProps {
  nodes: VizNode[]
  measureKey: string
  mode: Exclude<HierMode, 'treetable'>
  onLeafClick?: (id: string) => void
}

function HIcicle({ nodes, measureKey, onLeafClick }: { nodes: VizNode[]; measureKey: string; onLeafClick?: (id: string) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  const mountedRef = useRef<IcicleMounted | null>(null)

  useEffect(() => {
    if (!ref.current) return
    mountedRef.current = mountIcicle(ref.current, nodes, measureKey, { onLeafClick })
    return () => { mountedRef.current?.destroy(); mountedRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current?.update(nodes, measureKey)
  }, [nodes, measureKey])

  return <svg ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}

function HSunburst({ nodes, measureKey, onLeafClick }: { nodes: VizNode[]; measureKey: string; onLeafClick?: (id: string) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  const mountedRef = useRef<SunburstMounted | null>(null)

  useEffect(() => {
    if (!ref.current) return
    mountedRef.current = mountSunburst(ref.current, nodes, measureKey, { onLeafClick })
    return () => { mountedRef.current?.destroy(); mountedRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current?.update(nodes, measureKey)
  }, [nodes, measureKey])

  return <svg ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}

function HTreemap({ nodes, measureKey, onLeafClick }: { nodes: VizNode[]; measureKey: string; onLeafClick?: (id: string) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  const mountedRef = useRef<TreemapMounted | null>(null)

  useEffect(() => {
    if (!ref.current) return
    mountedRef.current = mountTreemap(ref.current, nodes, measureKey, { onLeafClick })
    return () => { mountedRef.current?.destroy(); mountedRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current?.update(nodes, measureKey)
  }, [nodes, measureKey])

  return <svg ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}

export function HViz({ nodes, measureKey, mode, onLeafClick }: HVizProps) {
  if (mode === 'h-icicle') return <HIcicle nodes={nodes} measureKey={measureKey} onLeafClick={onLeafClick} />
  if (mode === 'h-radial') return <HSunburst nodes={nodes} measureKey={measureKey} onLeafClick={onLeafClick} />
  return <HTreemap nodes={nodes} measureKey={measureKey} onLeafClick={onLeafClick} />
}
