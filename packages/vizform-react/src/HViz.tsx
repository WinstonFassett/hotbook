import React, { useEffect, useRef } from 'react'
import { mountIcicle, mountSunburst, mountTreemap } from '@winstonfassett/vizform-core'
import type { IcicleMounted, SunburstMounted, TreemapMounted } from '@winstonfassett/vizform-core'
import type { GoalTree, HierMode } from '@winstonfassett/vizform-core'

interface HVizProps {
  tree: GoalTree
  mode: HierMode
  onLeafClick?: (id: string) => void
}

function HIcicle({ tree, onLeafClick }: { tree: GoalTree; onLeafClick?: (id: string) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  const mountedRef = useRef<IcicleMounted | null>(null)

  useEffect(() => {
    if (!ref.current) return
    mountedRef.current = mountIcicle(ref.current, tree, { onLeafClick })
    return () => { mountedRef.current?.destroy(); mountedRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current?.update(tree)
  }, [tree])

  return <svg ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}

function HSunburst({ tree, onLeafClick }: { tree: GoalTree; onLeafClick?: (id: string) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  const mountedRef = useRef<SunburstMounted | null>(null)

  useEffect(() => {
    if (!ref.current) return
    mountedRef.current = mountSunburst(ref.current, tree, { onLeafClick })
    return () => { mountedRef.current?.destroy(); mountedRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current?.update(tree)
  }, [tree])

  return <svg ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}

function HTreemap({ tree, onLeafClick }: { tree: GoalTree; onLeafClick?: (id: string) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  const mountedRef = useRef<TreemapMounted | null>(null)

  useEffect(() => {
    if (!ref.current) return
    mountedRef.current = mountTreemap(ref.current, tree, { onLeafClick })
    return () => { mountedRef.current?.destroy(); mountedRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current?.update(tree)
  }, [tree])

  return <svg ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}

export function HViz({ tree, mode, onLeafClick }: HVizProps) {
  if (mode === 'h-icicle') return <HIcicle tree={tree} onLeafClick={onLeafClick} />
  if (mode === 'h-radial') return <HSunburst tree={tree} onLeafClick={onLeafClick} />
  return <HTreemap tree={tree} onLeafClick={onLeafClick} />
}
