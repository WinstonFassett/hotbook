import React, { useEffect, useRef, useState } from 'react'
import { VizRenderer } from '@winstonfassett/vizform-core'
import type { Goal, FlatMode, UnitKind } from '@winstonfassett/vizform-core'

interface Props {
  goals: Goal[]
  mode: FlatMode
  activeUnit: string
  unitKind: UnitKind
  sortUnit: string
  sortUnitKind: UnitKind
  frame?: number
  onUpdate: (id: string, patch: Partial<Goal>) => void
  onReorder?: (orderedIds: string[]) => void
  onGoalClick?: (goal: Goal) => void
}

export function Viz({ goals, mode, activeUnit, unitKind, sortUnit, sortUnitKind, frame, onUpdate, onReorder, onGoalClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const rendererRef = useRef<VizRenderer | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      setSize({ w: Math.floor(width), h: Math.floor(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!svgRef.current) return
    rendererRef.current = new VizRenderer(svgRef.current)
    return () => { rendererRef.current?.destroy(); rendererRef.current = null }
  }, [])

  // Alt-key affordance: show wheel-adjust cursor while modifier is held
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Alt') el.dataset.altArmed = e.type === 'keydown' ? 'true' : ''
    }
    const onBlur = () => { el.dataset.altArmed = '' }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(() => {
    if (!rendererRef.current || size.w === 0 || size.h === 0) return
    rendererRef.current.render({ goals, w: size.w, h: size.h, mode, activeUnit, unitKind, sortUnit, sortUnitKind, frame, onUpdate, onReorder, onGoalClick })
  }, [goals, mode, activeUnit, unitKind, sortUnit, sortUnitKind, frame, size, onUpdate, onReorder, onGoalClick])

  const active = goals.filter(g => !g.archived)

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {active.length === 0 && (
        <div className="empty-state">
          <span>No active goals. Add one to begin.</span>
        </div>
      )}
      <svg ref={svgRef} width={size.w} height={size.h} className={`viz-svg viz-${mode}`}
        style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
      />
    </div>
  )
}
