import React, { useEffect, useRef, useState } from 'react'
import { VizRenderer } from '@hotbook/d3'
import type { Goal, FlatMode, UnitKind } from '@hotbook/d3'

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
  hoverId?: string | null
  selectionId?: string | null
  onHover?: (id: string | null) => void
  onSelect?: (id: string) => void
}

export function Viz({ goals, mode, activeUnit, unitKind, sortUnit, sortUnitKind, frame, onUpdate, onReorder, onGoalClick, hoverId, selectionId, onHover, onSelect }: Props) {
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

  // Cmd/Ctrl affordance: arm the wheel-adjust cursor while the edit modifier is
  // held — matches the actual wheel-edit gate (metaKey || ctrlKey). Consumed by
  // the `[data-edit-armed] .viz-svg` cursor rule.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'Control') el.dataset.editArmed = e.type === 'keydown' ? 'true' : ''
    }
    const onBlur = () => { el.dataset.editArmed = '' }
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
    rendererRef.current.render({ goals, w: size.w, h: size.h, mode, activeUnit, unitKind, sortUnit, sortUnitKind, frame, onUpdate, onReorder, onGoalClick, hoverId, selectionId, onHover, onSelect })
  }, [goals, mode, activeUnit, unitKind, sortUnit, sortUnitKind, frame, size, onUpdate, onReorder, onGoalClick, hoverId, selectionId, onHover, onSelect])

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
