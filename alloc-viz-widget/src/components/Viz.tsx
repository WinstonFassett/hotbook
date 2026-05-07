import React, { useEffect, useRef, useState } from 'react'
import { arc, pie } from 'd3-shape'
import { select, type Selection } from 'd3-selection'
import 'd3-transition' // side-effect: patches Selection.prototype.transition
import { drag } from 'd3-drag'
import { easeCubicInOut, easeQuadIn, easeQuadOut } from 'd3-ease'
import type { Goal, UnitKind } from '../types'
import type { AtomGeometry, LayoutResult, VizMode } from '../viz/types'
import { layoutTreemap } from '../viz/layoutTreemap'
import { layoutBands } from '../viz/layoutBands'
import { layoutRadial } from '../viz/layoutRadial'
import { phantomGoal } from '../viz/types'
import {
  arcPath, arcToArcTween, arcToRectReel, clientAngle, parseTranslate,
  rectPath, rectToArcReel, rectToRectScreen, rectToRectTween, shapeKind,
} from '../viz/pathPrimitives'
import {
  DEFAULT_SIZE, DUR, EASE, EXIT_DUR, HANDLE_HIT_W, HANDLE_VIS_W,
  MIN_ARC_ANGLE, MIN_NUMBER_ANGLE, PAD_ANGLE, REORDER_DUR, ROW_H,
} from '../viz/constants'
import { renderRadialChrome } from '../viz/chrome/radialChrome'
import { renderBandsChrome } from '../viz/chrome/bandsChrome'

interface Props {
  goals: Goal[]
  mode: VizMode
  activeUnit: string
  unitKind: UnitKind
  sortUnit: string
  sortUnitKind: UnitKind
  frame: number | undefined
  onUpdate: (id: string, patch: Partial<Goal>) => void
  onGoalClick?: (goal: Goal) => void
}

type AtomEl = SVGGElement & { _angles?: { startAngle: number; endAngle: number } }

export function Viz({
  goals, mode, activeUnit, unitKind, sortUnit, sortUnitKind, frame, onUpdate, onGoalClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  // Track previous mode so we know when to morph
  const prevModeRef = useRef<VizMode | null>(null)
  // Track previous atom geometries (for morph source)
  const prevAtomsRef = useRef<Map<string, AtomGeometry>>(new Map())

  // ── Drag state (shared across modes) ─────────────────────────────────
  const radialResizeDrag = useRef<{
    goalId: string
    startValue: number
    otherTotal: number
    arcStartAngle: number
    totalPad: number
    previewValue: number
  } | null>(null)

  const radialReorderDrag = useRef<{
    goalId: string
    startMouseAngle: number
    startMidAngle: number
    arcSpan: number
    currentOrder: string[]
    layoutMap: Map<string, AtomGeometry>
    startX: number
    startY: number
    activated: boolean
  } | null>(null)

  const bandsResizeDrag = useRef<{
    goalId: string
    startValue: number
    lockedAxis: number
    trackLeftAbs: number
    trackW: number
    previewValue: number
  } | null>(null)

  const bandsReorderDrag = useRef<{
    goalId: string
    startClientX: number
    startClientY: number
    grabOffsetY: number
    initialOrder: string[]
    currentOrder: string[]
    activated: boolean
  } | null>(null)

  // ResizeObserver
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

  // Alt-wheel value adjustment. Attached at the SVG level (delegated)
  // so we can use { passive: false } and call preventDefault — d3's
  // selection.on doesn't expose listener options. Disabled for order-kind
  // active units.
  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) return
    const handler = (event: WheelEvent) => {
      if (unitKind === 'order') return
      if (!event.altKey) return
      const target = event.target as Element
      const atomG = target.closest('g.goal-atom') as SVGGElement | null
      if (!atomG || atomG.classList.contains('phantom')) return
      const id = atomG.getAttribute('data-id')
      if (!id) return
      event.preventDefault()
      event.stopPropagation()
      const goal = goals.find(g => g.id === id && !g.archived)
      if (!goal) return
      const step = event.shiftKey ? 5 : 1
      const dir = event.deltaY < 0 ? +1 : -1
      const cur = Math.max(0, goal.measurements[activeUnit] ?? DEFAULT_SIZE)
      const next = Math.max(0, cur + dir * step)
      if (next !== cur) {
        onUpdate(goal.id, { measurements: { ...goal.measurements, [activeUnit]: next } })
      }
    }
    svgEl.addEventListener('wheel', handler, { passive: false })
    return () => svgEl.removeEventListener('wheel', handler)
  }, [goals, activeUnit, unitKind, onUpdate])

  // Track Alt-key state on the container so we can show a wheel-adjust
  // cursor affordance only while the modifier is held.
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
    const { w, h } = size
    if (!svgRef.current || w === 0 || h === 0) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dur = reducedMotion ? 0 : DUR
    const exitDur = reducedMotion ? 0 : EXIT_DUR
    const reorderDur = reducedMotion ? 0 : REORDER_DUR

    const active = goals.filter(g => !g.archived)
    if (active.length === 0) {
      // clean svg to avoid stale visuals
      select(svgRef.current).selectAll('*').remove()
      prevAtomsRef.current.clear()
      prevModeRef.current = mode
      return
    }

    // Apply drag preview overrides BEFORE layout
    const previewGoals: Goal[] = active.map(g => {
      const r = bandsResizeDrag.current
      if (r && r.goalId === g.id) return { ...g, measurements: { ...g.measurements, [activeUnit]: r.previewValue } }
      return g
    })

    const opts = { activeUnit, unitKind, sortUnit, sortUnitKind, frame }
    const layout: LayoutResult =
      mode === 'treemap' ? layoutTreemap(previewGoals, w, h, opts) :
      mode === 'bands'   ? layoutBands(previewGoals, w, h, opts) :
                           layoutRadial(previewGoals, w, h, opts)

    const { atoms, meta } = layout

    // Attach __value to each atom for chrome (bands rail segments need it)
    const valueOf = (g: Goal) =>
      Math.max(0, g.measurements[activeUnit] ?? DEFAULT_SIZE)
    const atomsWithValues = atoms.map(a => {
      const g = previewGoals.find(x => x.id === a.id)
      return Object.assign({}, a, { __value: g ? valueOf(g) : 0 }) as AtomGeometry & { __value: number }
    })

    const svg = select(svgRef.current)
    let chromeG = svg.select<SVGGElement>('g.viz-chrome')
    if (chromeG.empty()) chromeG = svg.append('g').attr('class', 'viz-chrome')
    let atomsG = svg.select<SVGGElement>('g.viz-atoms')
    if (atomsG.empty()) atomsG = svg.append('g').attr('class', 'viz-atoms')

    // Keep atoms above chrome in stacking? No — atoms should be ABOVE the rail bg
    // but BELOW slice numbers and labels. Simplest: chrome drawn first, atoms second,
    // and chrome elements that need to sit on top (numbers, total) get raise() calls.
    // Currently DOM order is: chrome, atoms — chrome below atoms. That's fine for
    // bands rail (background-ish) but means radial numbers are hidden by atoms.
    // We mitigate by keeping numbers/center as a separate top-layer group.
    let topG = svg.select<SVGGElement>('g.viz-top')
    if (topG.empty()) topG = svg.append('g').attr('class', 'viz-top')
    // Re-order: chrome → atoms → top
    chromeG.lower()
    atomsG.raise()
    topG.raise()

    const isModeChange = prevModeRef.current !== null && prevModeRef.current !== mode
    const morphDur = reducedMotion ? 0 : 600 // a touch longer than DUR for the polygon morph

    // ── Atom binding ──────────────────────────────────────────────────
    const atomSel = atomsG
      .selectAll<AtomEl, AtomGeometry>('g.goal-atom')
      .data(atomsWithValues, d => d.id)

    const atomEnter = atomSel.enter()
      .append('g')
      .attr('class', d => d.isPhantom ? 'goal-atom phantom' : 'goal-atom')
      .attr('data-id', d => d.id)
      .attr('transform', d => d.shapeTransform)
      .style('opacity', 0)

    atomEnter.append('path')
      .attr('class', 'shape')
      .attr('d', d => d.d)
      .attr('fill', d => d.fill)
      .style('cursor', 'pointer')

    atomEnter.append('text')
      .attr('class', 'name')
      .attr('transform', d => d.nameTransform)
      .attr('text-anchor', d => d.textAnchor)
      .attr('dominant-baseline', 'central')
      .style('fill', 'rgba(0,0,0,0.9)')
      .style('font-size', '11px')
      .style('pointer-events', 'none')

    atomEnter.append('text')
      .attr('class', 'value')
      .attr('transform', d => d.valueTransform)
      .attr('text-anchor', d => mode === 'bands' ? 'end' : d.textAnchor)
      .attr('dominant-baseline', 'central')
      .style('fill', 'rgba(0,0,0,0.55)')
      .style('font-size', '10px')
      .style('pointer-events', 'none')

    const allAtoms = atomSel.merge(atomEnter)

    // Always sync click handler
    allAtoms.select<SVGPathElement>('path.shape')
      .on('click', (event, d) => {
        if (d.isPhantom) return
        if (radialReorderDrag.current?.activated || bandsReorderDrag.current?.activated) return
        if (radialResizeDrag.current || bandsResizeDrag.current) return
        event.stopPropagation()
        const goal = previewGoals.find(g => g.id === d.id)
        if (goal) onGoalClick?.(goal)
      })

    // ── Update phase: settle to current layout ─────────────────────
    // Cross-mode morph postponed; for now mode change is a hard cut to the
    // new layout (with same-mode transitions used for sort/value tweens).
    allAtoms.each(function(d) {
      const sel = select<AtomEl, AtomGeometry & { __value: number }>(this as AtomEl)
      const path = sel.select<SVGPathElement>('path.shape')
      const prev = prevAtomsRef.current.get(d.id)
      const sameMode = !isModeChange

      if (sameMode) {
        // If a cross-mode morph is in flight, don't interrupt it — the group is
        // at an off-screen giant-arc position and interrupting would start settle
        // from there. Just sync text and let the morph complete normally.
        if ((this as Element).getAttribute('data-morphing') === '1') {
          sel.select<SVGTextElement>('text.name').text(d.nameText)
          sel.select<SVGTextElement>('text.value').text(d.valueText)
          return
        }

        sel.transition('settle').duration(dur).ease(EASE)
          .style('opacity', 1)
          .attr('transform', d.shapeTransform)
        if (d.arcParams && prev?.arcParams) {
          const tweenD = arcToArcTween(prev.arcParams, d.arcParams)
          path.transition('settle').duration(dur).ease(EASE)
            .attrTween('d', () => (t: number) => tweenD(t))
            .attr('fill', d.fill)
        } else if (d.rectParams && prev?.rectParams) {
          const tweenD = rectToRectTween(prev.rectParams, d.rectParams)
          path.transition('settle').duration(dur).ease(EASE)
            .attrTween('d', () => (t: number) => tweenD(t))
            .attr('fill', d.fill)
        } else {
          path.transition('settle').duration(dur).ease(EASE)
            .attr('d', d.d).attr('fill', d.fill)
        }
        sel.select<SVGTextElement>('text.name')
          .transition('settle').duration(dur).ease(EASE)
          .attr('transform', d.nameTransform)
          .style('opacity', d.labelOpacity)
          .attr('text-anchor', d.textAnchor)
          .text(d.nameText)
        sel.select<SVGTextElement>('text.value')
          .transition('settle').duration(dur).ease(EASE)
          .attr('transform', d.valueTransform)
          .style('opacity', d.labelOpacity)
          .attr('text-anchor', mode === 'bands' ? 'end' : d.textAnchor)
          .text(d.valueText)
      } else if (prev) {
        // Cross-mode morph: closed-form, one real arc/rect per frame.
        // Strategy:
        //   - rect → arc: place a giant circle perpendicular to the rect's
        //     longer side; lerp giant_arc_state → real_arc_state.
        //   - arc → rect: same, reversed in t.
        //   - rect → rect (treemap ↔ bands): lerp rect params + screen origin.
        //   - arc → arc: shouldn't happen across modes (only radial uses arcs).
        // Each frame: per-atom group transform = translate(currentCenter), and
        // path d = real arc/rect at that frame.
        const fromKind = shapeKind(prev)
        const toKind = shapeKind(d)

        // Compute label absolute screen positions (during morph the group's
        // transform is the per-frame center, so labels need to live in
        // screen-relative coords to animate independently).
        const fa = parseTranslate(prev.shapeTransform)
        const ta = parseTranslate(d.shapeTransform)
        const fname = parseTranslate(prev.nameTransform)
        const tname = parseTranslate(d.nameTransform)
        const fval = parseTranslate(prev.valueTransform)
        const tval = parseTranslate(d.valueTransform)
        const fNameAbs: [number, number] = [fa[0] + fname[0], fa[1] + fname[1]]
        const tNameAbs: [number, number] = [ta[0] + tname[0], ta[1] + tname[1]]
        const fValAbs:  [number, number] = [fa[0] + fval[0],  fa[1] + fval[1]]
        const tValAbs:  [number, number] = [ta[0] + tval[0],  ta[1] + tval[1]]

        const chartMaxDim = Math.max(meta.width, meta.height)

        let frame: (t: number) => { d: string; transform: string }
        if (fromKind === 'rect' && toKind === 'arc') {
          frame = rectToArcReel(
            fa[0], fa[1], prev.rectParams!,
            ta[0], ta[1], d.arcParams!,
            chartMaxDim,
          )
        } else if (fromKind === 'arc' && toKind === 'rect') {
          frame = arcToRectReel(
            fa[0], fa[1], prev.arcParams!,
            ta[0], ta[1], d.rectParams!,
            chartMaxDim,
          )
        } else if (fromKind === 'rect' && toKind === 'rect') {
          frame = rectToRectScreen(
            fa[0], fa[1], prev.rectParams!,
            ta[0], ta[1], d.rectParams!,
          )
        } else {
          // arc → arc — shouldn't occur across modes; fall through to reel
          // path via giant-arc construction with rect of size 0 at chart
          // center isn't meaningful. Skip.
          frame = (t: number) => ({
            d: t < 0.5 ? prev.d : d.d,
            transform: t < 0.5 ? prev.shapeTransform : d.shapeTransform,
          })
        }

        // Pre-step: position labels at their absolute "from" positions; the
        // group transform is now per-frame, so labels need to be in screen
        // coords. To make label coords work as screen coords, we need labels
        // outside the per-frame translate. Trick: subtract the per-frame
        // translate from the label transform. Easier: temporarily move labels
        // to a sibling group or use absolute coords via a counter-translate.
        //
        // Implementation: the atom group will have transform = translate(centerX, centerY).
        // The labels live INSIDE that group. So a label's screen position =
        // (centerX, centerY) + label.transform. We want labels to appear at a
        // fixed screen position regardless of the group's center, so we set
        // label.transform = (desiredScreenX − centerX, desiredScreenY − centerY).
        // This is computed per-frame; we'll do it inline in the tween.
        sel.interrupt().interrupt('settle').interrupt('morph')
        path.interrupt().interrupt('settle').interrupt('morph')
        sel.attr('data-morphing', '1')
        const nameSel = sel.select<SVGTextElement>('text.name').interrupt()
        const valueSel = sel.select<SVGTextElement>('text.value').interrupt()
        // Set initial label anchor immediately (don't tween anchor)
        nameSel.attr('text-anchor', prev.textAnchor)
        valueSel.attr('text-anchor', prevModeRef.current === 'bands' ? 'end' : prev.textAnchor)

        // Pre-set the t=0 state imperatively. Without this the SVG stays at the
        // previous render's state (rectPath/arcPath at prev.shapeTransform) until
        // the first transition frame fires, causing a visible "jump" to the
        // giant-arc-form at t=0 of the morph.
        const f0 = frame(0)
        sel.attr('transform', f0.transform)
        path.attr('d', f0.d)
        nameSel.attr('transform', `translate(${fNameAbs[0]},${fNameAbs[1]})`)
        valueSel.attr('transform', `translate(${fValAbs[0]},${fValAbs[1]})`)

        // The path tween drives both d AND group transform AND label transforms,
        // because all three depend on the per-frame center.
        path.transition('morph').duration(morphDur).ease(easeCubicInOut)
          .attrTween('d', () => (t: number) => {
            const f = frame(t)
            sel.attr('transform', f.transform)
            // Label screen positions: lerp between from-abs and to-abs.
            const lerp = (a: number, b: number) => a + (b - a) * t
            const nameScreen: [number, number] = [
              lerp(fNameAbs[0], tNameAbs[0]),
              lerp(fNameAbs[1], tNameAbs[1]),
            ]
            const valScreen: [number, number] = [
              lerp(fValAbs[0], tValAbs[0]),
              lerp(fValAbs[1], tValAbs[1]),
            ]
            // Counter the group's translate so labels land at screen positions.
            const ft = parseTranslate(f.transform)
            nameSel.attr('transform', `translate(${nameScreen[0] - ft[0]},${nameScreen[1] - ft[1]})`)
            valueSel.attr('transform', `translate(${valScreen[0] - ft[0]},${valScreen[1] - ft[1]})`)
            return f.d
          })
          .attr('fill', d.fill)
          .on('end', function() {
            // Restore relative transforms + final shape
            sel.attr('data-morphing', null).attr('transform', d.shapeTransform)
            select(this).attr('d', d.d)
            nameSel.attr('transform', d.nameTransform)
              .attr('text-anchor', d.textAnchor)
              .style('opacity', d.labelOpacity)
              .text(d.nameText)
            valueSel.attr('transform', d.valueTransform)
              .attr('text-anchor', mode === 'bands' ? 'end' : d.textAnchor)
              .style('opacity', d.labelOpacity)
              .text(d.valueText)
          })
        // Fade label text/opacity over the morph
        nameSel.transition('morph-label').duration(morphDur).ease(easeCubicInOut)
          .style('opacity', d.labelOpacity)
        valueSel.transition('morph-label').duration(morphDur).ease(easeCubicInOut)
          .style('opacity', d.labelOpacity)
        // Update text content immediately at start (so it doesn't read stale
        // for the duration). Since labels move smoothly, swapping text mid-
        // animation is acceptable.
        nameSel.text(d.nameText)
        valueSel.text(d.valueText)
      } else {
        // Atom is new (existed in neither prev) — entered above with opacity 0,
        // settle to its layout.
        sel.attr('transform', d.shapeTransform).style('opacity', 1)
        path.attr('d', d.d).attr('fill', d.fill)
        sel.select<SVGTextElement>('text.name')
          .attr('transform', d.nameTransform).style('opacity', d.labelOpacity)
          .attr('text-anchor', d.textAnchor).text(d.nameText)
        sel.select<SVGTextElement>('text.value')
          .attr('transform', d.valueTransform).style('opacity', d.labelOpacity)
          .attr('text-anchor', mode === 'bands' ? 'end' : d.textAnchor).text(d.valueText)
      }
    })

    // Exit
    atomSel.exit()
      .transition().duration(exitDur).ease(easeQuadIn)
      .style('opacity', 0)
      .remove()

    // ── Chrome ──────────────────────────────────────────────────────
    // Top layer (radial numbers + center) lives in g.viz-top so they're above atoms.
    // bands chrome (rail, total, rank, handles) lives in g.viz-chrome.
    // We empty out the inactive chrome groups when mode doesn't match.
    // Identify which group hosts current vs previous chrome
    const targetChromeG: typeof chromeG | null =
      mode === 'radial' ? topG : mode === 'bands' ? chromeG : null
    const sourceChromeG: typeof chromeG | null =
      prevModeRef.current === 'radial' ? topG :
      prevModeRef.current === 'bands' ? chromeG : null

    // Fade out outgoing chrome on mode change
    if (isModeChange && sourceChromeG && sourceChromeG.node() !== targetChromeG?.node()) {
      sourceChromeG.style('pointer-events', 'none')
        .interrupt('chrome')
        .transition('chrome').duration(exitDur).ease(easeQuadIn)
        .style('opacity', 0)
        .on('end', function() {
          select<SVGGElement, unknown>(this as SVGGElement).selectAll('*').remove()
          select<SVGGElement, unknown>(this as SVGGElement)
            .style('opacity', 1).style('pointer-events', null)
        })
    }

    // Render new chrome (or clear if treemap)
    if (mode === 'radial') {
      const api = renderRadialChrome(topG as unknown as Selection<SVGGElement, unknown, null, undefined>, atoms, meta)
      const isOrder = unitKind === 'order'
      api.setCenter(
        isOrder ? String(active.length) : String(meta.total),
        isOrder ? 'goals' : activeUnit,
        false,
      )
      if (isModeChange) {
        topG.style('opacity', 0)
          .interrupt('chrome')
          .transition('chrome').delay(exitDur / 2).duration(exitDur).ease(easeQuadOut)
          .style('opacity', 1)
      }
    } else if (mode === 'bands') {
      const isOrderActive = unitKind === 'order'
      const canResize = !isOrderActive
      const canReorder = sortUnitKind === 'order'
      renderBandsChrome(chromeG, atomsWithValues, meta, {
        isOrderActive,
        canResize,
        canReorder,
      })
      if (isModeChange) {
        chromeG.style('opacity', 0)
          .interrupt('chrome')
          .transition('chrome').delay(exitDur / 2).duration(exitDur).ease(easeQuadOut)
          .style('opacity', 1)
      }
    }
    // (treemap: no chrome to render; outgoing already handled above)

    // ── Drag wiring ────────────────────────────────────────────────
    // Always detach previous drag bindings first
    allAtoms.select<SVGPathElement>('path.shape').on('.drag', null)
    chromeG.selectAll<SVGCircleElement, unknown>('circle.resize-handle').on('.drag', null)
    chromeG.selectAll<SVGGElement, unknown>('g.band-handle').on('.drag', null)
    chromeG.selectAll<SVGGElement, unknown>('g.band-rank-wrap').on('.drag', null)
    topG.selectAll<SVGCircleElement, unknown>('circle.resize-handle').on('.drag', null)
    allAtoms.on('mouseenter.handle', null).on('mouseleave.handle', null)

    if (mode === 'radial') {
      attachRadialDrag()
    } else if (mode === 'bands') {
      attachBandsDrag()
    }

    // Save current atoms as "previous" for next render's morph source
    const nextPrev = new Map<string, AtomGeometry>()
    atoms.forEach(a => nextPrev.set(a.id, a))
    prevAtomsRef.current = nextPrev
    prevModeRef.current = mode

    // ────────────────────────────────────────────────────────────────
    // Drag: radial
    // ────────────────────────────────────────────────────────────────
    function attachRadialDrag() {
      const cx = meta.cx ?? 0
      const cy = meta.cy ?? 0
      const outerR = meta.outerR ?? 0
      const innerR = meta.innerR ?? 0
      const N = atoms.length
      const isOrder = unitKind === 'order'
      const canResize = !isOrder
      const canReorder = sortUnitKind === 'order'

      // Hover: show/hide handle for arc atoms
      if (canResize) {
        allAtoms
          .on('mouseenter.handle', function(_ev, d) {
            topG.select(`circle.resize-handle[data-id="${d.id}"]`).style('opacity', 1)
          })
          .on('mouseleave.handle', function(_ev, d) {
            if (!radialResizeDrag.current) {
              topG.select(`circle.resize-handle[data-id="${d.id}"]`).style('opacity', 0)
            }
          })
      }

      // Resize handle drag
      if (canResize) {
        const handles = topG.selectAll<SVGCircleElement, AtomGeometry>('circle.resize-handle')
        handles.call(
          drag<SVGCircleElement, AtomGeometry>()
            .on('start', function(event, d) {
              event.sourceEvent.stopPropagation()
              const ap = d.arcParams
              if (!svgRef.current || !ap) return
              const otherTotal = active
                .filter(g => g.id !== d.id)
                .reduce((s, g) => s + (g.measurements[activeUnit] ?? DEFAULT_SIZE), 0)
              const goal = active.find(g => g.id === d.id)!
              const startValue = goal.measurements[activeUnit] ?? DEFAULT_SIZE
              radialResizeDrag.current = {
                goalId: d.id,
                startValue,
                otherTotal,
                arcStartAngle: ap.startAngle,
                totalPad: N * PAD_ANGLE,
                previewValue: startValue,
              }
              select(this).style('opacity', 1)
              const root = topG.select<SVGGElement>('g.radial-root')
              root.select('text.center-total').classed('drag-mode', true).text(`${startValue}`)
              root.select('text.center-unit').classed('drag-mode', true).text(goal.name)
            })
            .on('drag', function(event, d) {
              const drag = radialResizeDrag.current
              if (!drag || !svgRef.current) return
              const mouseA = clientAngle(event.sourceEvent.clientX, event.sourceEvent.clientY, svgRef.current, cx, cy)

              const minEnd = drag.arcStartAngle + PAD_ANGLE + 0.05
              const maxEnd = drag.arcStartAngle + (2 * Math.PI - drag.totalPad) - 0.05
              let unwrapped = mouseA
              if (unwrapped < drag.arcStartAngle) unwrapped += 2 * Math.PI
              const newEndAngle = Math.max(minEnd, Math.min(maxEnd, unwrapped))

              const newSpan = newEndAngle - drag.arcStartAngle - PAD_ANGLE
              const availSpan = 2 * Math.PI - drag.totalPad
              const p = Math.max(0.001, Math.min(0.999, newSpan / availSpan))
              const previewValue = Math.max(0, Math.round(drag.otherTotal * p / (1 - p)))
              drag.previewValue = previewValue

              const ghostArc = {
                ...d.arcParams!,
                endAngle: newEndAngle,
                innerRadius: innerR,
                outerRadius: outerR,
              }
              const atomG = atomsG.select<SVGGElement>(`g.goal-atom[data-id="${drag.goalId}"]`)
              atomG.select<SVGPathElement>('path.shape')
                .interrupt()
                .attr('d', arcPath(ghostArc))
              const labelArcInner = (Math.min(meta.width, meta.height) / 2 * 0.86) * 0.58
              const labelGen = arc<unknown, typeof ghostArc>().innerRadius(labelArcInner).outerRadius(labelArcInner)
              const [lx, ly] = labelGen.centroid(ghostArc)
              atomG.select<SVGTextElement>('text.name')
                .interrupt()
                .attr('transform', `translate(${lx}, ${ly - 6})`)
                .style('opacity', (newEndAngle - drag.arcStartAngle) < MIN_ARC_ANGLE ? 0 : 1)
              atomG.select<SVGTextElement>('text.value')
                .interrupt()
                .attr('transform', `translate(${lx}, ${ly + 10})`)
                .style('opacity', (newEndAngle - drag.arcStartAngle) < MIN_ARC_ANGLE ? 0 : 1)
                .text(`${previewValue} ${activeUnit}`)

              // Slice number follows
              const numR = (Math.min(meta.width, meta.height) / 2 * 0.86) * 0.78
              const numGen = arc<unknown, typeof ghostArc>().innerRadius(numR).outerRadius(numR)
              const [nx, ny] = numGen.centroid(ghostArc)
              topG.select(`text.arc-number[data-id="${drag.goalId}"]`)
                .interrupt()
                .attr('transform', `translate(${nx},${ny})`)
                .style('opacity', (newEndAngle - drag.arcStartAngle) < MIN_NUMBER_ANGLE ? 0 : 1)

              // Move the handle itself
              select(this)
                .attr('cx', outerR * Math.sin(newEndAngle - PAD_ANGLE / 2))
                .attr('cy', -outerR * Math.cos(newEndAngle - PAD_ANGLE / 2))

              const root = topG.select<SVGGElement>('g.radial-root')
              root.select('text.center-total')
                .text(previewValue === drag.startValue
                  ? `${drag.startValue}`
                  : `${drag.startValue} → ${previewValue}`)
            })
            .on('end', function(_ev, d) {
              const drag = radialResizeDrag.current
              radialResizeDrag.current = null
              if (!drag) return
              select(this).style('opacity', 0)
              if (drag.previewValue !== drag.startValue) {
                const goal = active.find(g => g.id === d.id)
                if (goal) {
                  onUpdate(d.id, { measurements: { ...goal.measurements, [activeUnit]: drag.previewValue } })
                }
              }
            })
        )
      }

      // Reorder by dragging arc body
      if (canReorder) {
        allAtoms.select<SVGPathElement>('path.shape')
          .style('cursor', d => d.isPhantom ? 'default' : 'grab')
          .call(
            drag<SVGPathElement, AtomGeometry & { __value: number }>()
              .clickDistance(5)
              .filter(event => !event.target || !(event.target as SVGElement).classList.contains('resize-handle'))
              .on('start', function(event, d) {
                if (d.isPhantom) return
                if (!svgRef.current || !d.arcParams) return
                const mouseA = clientAngle(event.sourceEvent.clientX, event.sourceEvent.clientY, svgRef.current, cx, cy)
                const initialOrder = atoms.filter(a => !a.isPhantom).map(a => a.id)
                const layoutMap = new Map<string, AtomGeometry>()
                atoms.forEach(a => layoutMap.set(a.id, a))
                radialReorderDrag.current = {
                  goalId: d.id,
                  startMouseAngle: mouseA,
                  startMidAngle: (d.arcParams.startAngle + d.arcParams.endAngle) / 2,
                  arcSpan: d.arcParams.endAngle - d.arcParams.startAngle,
                  currentOrder: initialOrder,
                  layoutMap,
                  startX: event.x,
                  startY: event.y,
                  activated: false,
                }
              })
              .on('drag', function(event, d) {
                const drag = radialReorderDrag.current
                if (!drag || !svgRef.current) return
                if (!drag.activated) {
                  const dx = event.x - drag.startX
                  const dy = event.y - drag.startY
                  if (dx * dx + dy * dy < 25) return
                  drag.activated = true
                  event.sourceEvent.stopPropagation()
                  select(this).interrupt().style('cursor', 'grabbing')
                  atomsG.select(`g.goal-atom[data-id="${drag.goalId}"]`).interrupt().raise()
                }
                const mouseA = clientAngle(event.sourceEvent.clientX, event.sourceEvent.clientY, svgRef.current, cx, cy)
                let delta = mouseA - drag.startMouseAngle
                if (delta > Math.PI) delta -= 2 * Math.PI
                if (delta < -Math.PI) delta += 2 * Math.PI
                const newMid = (drag.startMidAngle + delta + 2 * Math.PI) % (2 * Math.PI)
                const half = drag.arcSpan / 2
                const ap = d.arcParams!
                const ghost = {
                  ...ap, startAngle: newMid - half, endAngle: newMid + half,
                  innerRadius: innerR, outerRadius: outerR,
                }
                select(this).attr('d', arcPath(ghost))

                // Determine new order by midpoint angle
                const angles = drag.currentOrder.map(id => {
                  if (id === drag.goalId) return { id, mid: newMid }
                  const a = drag.layoutMap.get(id)
                  if (!a?.arcParams) return { id, mid: 0 }
                  return { id, mid: (a.arcParams.startAngle + a.arcParams.endAngle) / 2 }
                })
                angles.sort((a, b) => a.mid - b.mid)
                const newOrder = angles.map(x => x.id)
                let changed = false
                for (let i = 0; i < newOrder.length; i++) {
                  if (newOrder[i] !== drag.currentOrder[i]) { changed = true; break }
                }
                if (changed) {
                  drag.currentOrder = newOrder
                  // Re-layout pie with the proposed order (using current pie parameters)
                  const ordered = newOrder.map(id => previewGoals.find(g => g.id === id)).filter(Boolean) as Goal[]
                  const phantomAtom = atoms.find(a => a.isPhantom)
                  if (phantomAtom) {
                    const allocated = ordered.reduce((s, g) => s + Math.max(0, g.measurements[activeUnit] ?? DEFAULT_SIZE), 0)
                    const unallocated = (frame != null && !isOrder) ? Math.max(0, frame - allocated) : 0
                    if (unallocated > 0) ordered.push(phantomGoal(unallocated, activeUnit))
                  }
                  const newPie = pie<Goal>()
                    .value(g => isOrder ? 1 : Math.max(0.001, g.measurements[activeUnit] ?? DEFAULT_SIZE))
                    .sort(null)
                    .padAngle(PAD_ANGLE)(ordered)
                  const newMap = new Map<string, AtomGeometry>()
                  newPie.forEach((s, i) => {
                    const ap2 = {
                      startAngle: s.startAngle, endAngle: s.endAngle,
                      innerRadius: innerR, outerRadius: outerR,
                      cornerRadius: 4, padAngle: PAD_ANGLE,
                    }
                    newMap.set(s.data.id, {
                      ...atoms.find(a => a.id === s.data.id)!,
                      arcParams: ap2,
                    })
                    void i
                  })
                  drag.layoutMap = newMap

                  for (const a of newMap.values()) {
                    if (a.id === drag.goalId) continue
                    const ap2 = a.arcParams!
                    atomsG.select<SVGPathElement>(`g.goal-atom[data-id="${a.id}"] path.shape`)
                      .interrupt()
                      .transition('reorder').duration(reorderDur).ease(EASE)
                      .attr('d', arcPath(ap2))
                    const labelArcInner = (Math.min(meta.width, meta.height) / 2 * 0.86) * 0.58
                    const labelGen = arc<unknown, typeof ap2>().innerRadius(labelArcInner).outerRadius(labelArcInner)
                    const [lx, ly] = labelGen.centroid(ap2)
                    atomsG.select<SVGTextElement>(`g.goal-atom[data-id="${a.id}"] text.name`)
                      .interrupt()
                      .transition('reorder').duration(reorderDur).ease(EASE)
                      .attr('transform', `translate(${lx}, ${ly - 6})`)
                    atomsG.select<SVGTextElement>(`g.goal-atom[data-id="${a.id}"] text.value`)
                      .interrupt()
                      .transition('reorder').duration(reorderDur).ease(EASE)
                      .attr('transform', `translate(${lx}, ${ly + 10})`)
                    topG.select(`circle.resize-handle[data-id="${a.id}"]`)
                      .interrupt()
                      .transition('reorder').duration(reorderDur).ease(EASE)
                      .attr('cx', outerR * Math.sin(ap2.endAngle - PAD_ANGLE / 2))
                      .attr('cy', -outerR * Math.cos(ap2.endAngle - PAD_ANGLE / 2))
                    const numR = (Math.min(meta.width, meta.height) / 2 * 0.86) * 0.78
                    const numGen = arc<unknown, typeof ap2>().innerRadius(numR).outerRadius(numR)
                    const [nx, ny] = numGen.centroid(ap2)
                    const newIndex = newOrder.indexOf(a.id)
                    topG.select<SVGTextElement>(`text.arc-number[data-id="${a.id}"]`)
                      .text(`#${newIndex + 1}`)
                      .interrupt()
                      .transition('reorder').duration(reorderDur).ease(EASE)
                      .attr('transform', `translate(${nx},${ny})`)
                  }
                  // Update dragged number text
                  const draggedNewIdx = newOrder.indexOf(drag.goalId)
                  topG.select<SVGTextElement>(`text.arc-number[data-id="${drag.goalId}"]`)
                    .text(`#${draggedNewIdx + 1}`)
                }
              })
              .on('end', function(_ev, d) {
                const drag = radialReorderDrag.current
                radialReorderDrag.current = null
                if (!drag) return
                select(this).style('cursor', 'grab')
                if (!drag.activated) return

                if (sortUnitKind === 'order') {
                  const sortValues = active
                    .map(g => g.measurements[sortUnit] ?? 0)
                    .sort((a, b) => a - b)
                  drag.currentOrder.forEach((id, i) => {
                    const goal = active.find(g => g.id === id)
                    if (!goal) return
                    const newSortValue = sortValues[i]
                    if (goal.measurements[sortUnit] !== newSortValue) {
                      onUpdate(id, { measurements: { ...goal.measurements, [sortUnit]: newSortValue } })
                    }
                  })
                }
                void d
              })
          )
      } else {
        allAtoms.select<SVGPathElement>('path.shape').style('cursor', 'pointer')
      }
    }

    // ────────────────────────────────────────────────────────────────
    // Drag: bands
    // ────────────────────────────────────────────────────────────────
    function attachBandsDrag() {
      const isOrderActive = unitKind === 'order'
      const canResize = !isOrderActive
      const canReorder = sortUnitKind === 'order'
      const trackX = meta.trackX ?? 0
      const trackW = meta.trackW ?? 0
      const topPad = meta.topPad ?? 0
      const rowStep = meta.rowStep ?? 0
      // Match layoutBands: include the unallocated remainder in the domain
      // so the drag scale matches what the layout will compute.
      const allocatedTotal = active.reduce(
        (s, g) => s + Math.max(0, g.measurements[activeUnit] ?? DEFAULT_SIZE), 0,
      )
      const dragUnallocated = (frame != null && unitKind !== 'order')
        ? Math.max(0, frame - allocatedTotal) : 0
      const dataMax = Math.max(1,
        ...active.map(g => Math.max(0, g.measurements[activeUnit] ?? DEFAULT_SIZE)),
        dragUnallocated)

      // Hover for bar handles
      if (canResize) {
        allAtoms
          .on('mouseenter.handle', function(_ev, d) {
            chromeG.select(`g.band-handle[data-id="${d.id}"]`).style('opacity', 1)
          })
          .on('mouseleave.handle', function(_ev, d) {
            if (bandsResizeDrag.current?.goalId === d.id) return
            chromeG.select(`g.band-handle[data-id="${d.id}"]`).style('opacity', 0)
          })
      }

      // Bar handle resize
      if (canResize) {
        chromeG.selectAll<SVGGElement, { id: string; index: number; width: number }>('g.band-handle').call(
          drag<SVGGElement, { id: string; index: number; width: number }>()
            .on('start', function(event, d) {
              event.sourceEvent.stopPropagation()
              const svgEl = svgRef.current
              if (!svgEl) return
              const rect = svgEl.getBoundingClientRect()
              const goal = active.find(g => g.id === d.id)
              if (!goal) return
              const startValue = Math.max(0, goal.measurements[activeUnit] ?? DEFAULT_SIZE)
              bandsResizeDrag.current = {
                goalId: d.id,
                startValue,
                lockedAxis: dataMax,
                trackLeftAbs: rect.left + trackX,
                trackW,
                previewValue: startValue,
              }
              select(this).style('opacity', 1)
              select(this).select<SVGRectElement>('rect.band-handle-vis').attr('fill', 'oklch(0.98 0 0)')
              document.body.style.userSelect = 'none'
              document.body.style.cursor = 'ew-resize'
            })
            .on('drag', function(event, d) {
              const drag = bandsResizeDrag.current
              if (!drag) return
              const x = event.sourceEvent.clientX - drag.trackLeftAbs
              const fraction = Math.max(0, x / drag.trackW)
              const newValue = Math.max(0, Math.round(drag.lockedAxis * fraction))
              drag.previewValue = newValue
              const visW = Math.max(2, Math.min(drag.trackW, (newValue / drag.lockedAxis) * drag.trackW))
              const labelOp = visW >= 70 ? 1 : 0
              const atomG = atomsG.select<SVGGElement>(`g.goal-atom[data-id="${d.id}"]`)
              atomG.select<SVGPathElement>('path.shape').interrupt()
                .attr('d', rectPath({ x: 0, y: 0, w: visW, h: ROW_H - 8, rx: 4 }))
              atomG.select<SVGTextElement>('text.value').interrupt()
                .attr('transform', `translate(${visW - 10}, ${(ROW_H - 8) / 2})`)
                .style('opacity', labelOp)
                .text(`${newValue}`)
              atomG.select<SVGTextElement>('text.name').interrupt()
                .style('opacity', labelOp)
              const handleG = select(this)
              handleG.select<SVGRectElement>('rect.band-handle-hit').attr('x', trackX + visW - HANDLE_HIT_W / 2)
              handleG.select<SVGRectElement>('rect.band-handle-vis').attr('x', trackX + visW - HANDLE_VIS_W / 2)
            })
            .on('end', function(_ev, d) {
              const drag = bandsResizeDrag.current
              bandsResizeDrag.current = null
              document.body.style.userSelect = ''
              document.body.style.cursor = ''
              select(this).select<SVGRectElement>('rect.band-handle-vis').attr('fill', 'oklch(0.93 0 0)')
              select(this).style('opacity', 0)
              if (!drag) return
              if (drag.previewValue !== drag.startValue) {
                const goal = active.find(g => g.id === d.id)
                if (goal) {
                  // Pre-stamp prev with the released geometry so the next render's
                  // settle tween starts where the user let go — not the pre-drag
                  // position. Otherwise the bar snaps back and animates forward.
                  const visW = Math.max(2, Math.min(drag.trackW,
                    (drag.previewValue / drag.lockedAxis) * drag.trackW))
                  const labelOp = visW >= 70 ? 1 : 0
                  const prev = prevAtomsRef.current.get(d.id)
                  if (prev?.rectParams) {
                    prev.rectParams = { ...prev.rectParams, w: visW }
                    prev.d = rectPath({ x: 0, y: 0, w: visW, h: ROW_H - 8, rx: 4 })
                    prev.valueTransform = `translate(${visW - 10}, ${(ROW_H - 8) / 2})`
                    prev.labelOpacity = labelOp
                    prev.valueText = `${Math.round(drag.previewValue)}`
                  }
                  onUpdate(d.id, { measurements: { ...goal.measurements, [activeUnit]: drag.previewValue } })
                }
              }
            })
        )
      }

      // Rank reorder
      if (canReorder) {
        chromeG.selectAll<SVGGElement, { id: string; index: number }>('g.band-rank-wrap').call(
          drag<SVGGElement, { id: string; index: number }>()
            .clickDistance(5)
            .on('start', function(event, d) {
              const svgEl = svgRef.current
              if (!svgEl) return
              const svgRect = svgEl.getBoundingClientRect()
              const ySvg = event.sourceEvent.clientY - svgRect.top
              const rowTop = topPad + d.index * rowStep
              bandsReorderDrag.current = {
                goalId: d.id,
                startClientX: event.sourceEvent.clientX,
                startClientY: event.sourceEvent.clientY,
                grabOffsetY: ySvg - rowTop,
                initialOrder: atoms.map(x => x.id),
                currentOrder: atoms.map(x => x.id),
                activated: false,
              }
            })
            .on('drag', function(event, d) {
              const drag = bandsReorderDrag.current
              if (!drag) return
              if (!drag.activated) {
                const dx = event.sourceEvent.clientX - drag.startClientX
                const dy = event.sourceEvent.clientY - drag.startClientY
                if (dx * dx + dy * dy < 25) return
                drag.activated = true
                event.sourceEvent.stopPropagation()
                atomsG.select(`g.goal-atom[data-id="${d.id}"]`).interrupt().raise()
                document.body.style.userSelect = 'none'
                document.body.style.cursor = 'grabbing'
              }
              const svgEl = svgRef.current
              if (!svgEl) return
              const svgRect = svgEl.getBoundingClientRect()
              const ySvg = event.sourceEvent.clientY - svgRect.top
              const newTop = Math.max(
                topPad,
                Math.min(topPad + (atoms.length - 1) * rowStep, ySvg - drag.grabOffsetY),
              )
              // Update dragged atom's transform & corresponding chrome row's transform
              atomsG.select(`g.goal-atom[data-id="${d.id}"]`)
                .attr('transform', `translate(${trackX}, ${newTop + 4})`)
              chromeG.select(`g.band-rank-wrap[data-id="${d.id}"]`)
                .attr('transform', `translate(0, ${newTop})`)
              chromeG.select(`g.band-handle[data-id="${d.id}"]`)
                .attr('transform', `translate(0, ${newTop})`)

              // New order
              const centerY = newTop + ROW_H / 2
              const newIdx = Math.max(0, Math.min(atoms.length - 1, Math.floor((centerY - topPad) / rowStep + 0.0001)))
              const without = drag.initialOrder.filter(id => id !== d.id)
              const next = [...without.slice(0, newIdx), d.id, ...without.slice(newIdx)]
              const changed = next.some((id, i) => id !== drag.currentOrder[i])
              if (changed) {
                drag.currentOrder = next
                next.forEach((id, i) => {
                  if (id === d.id) return
                  const targetY = topPad + i * rowStep
                  atomsG.select(`g.goal-atom[data-id="${id}"]`)
                    .interrupt()
                    .transition('reorder').duration(reorderDur).ease(EASE)
                    .attr('transform', `translate(${trackX}, ${targetY + 4})`)
                  chromeG.select(`g.band-rank-wrap[data-id="${id}"]`)
                    .interrupt()
                    .transition('reorder').duration(reorderDur).ease(EASE)
                    .attr('transform', `translate(0, ${targetY})`)
                  chromeG.select<SVGTextElement>(`g.band-rank-wrap[data-id="${id}"] text.band-rank`)
                    .text(`#${i + 1}`)
                  chromeG.select(`g.band-handle[data-id="${id}"]`)
                    .interrupt()
                    .transition('reorder').duration(reorderDur).ease(EASE)
                    .attr('transform', `translate(0, ${targetY})`)
                })
                const draggedNewIdx = next.indexOf(d.id)
                chromeG.select<SVGTextElement>(`g.band-rank-wrap[data-id="${d.id}"] text.band-rank`)
                  .text(`#${draggedNewIdx + 1}`)
              }
            })
            .on('end', function(_ev, d) {
              const drag = bandsReorderDrag.current
              bandsReorderDrag.current = null
              document.body.style.userSelect = ''
              document.body.style.cursor = ''
              if (!drag) return
              if (!drag.activated) return
              const finalIdx = drag.currentOrder.indexOf(d.id)
              const targetY = topPad + finalIdx * rowStep
              atomsG.select(`g.goal-atom[data-id="${d.id}"]`)
                .transition('reorder').duration(reorderDur).ease(EASE)
                .attr('transform', `translate(${trackX}, ${targetY + 4})`)
              chromeG.select(`g.band-rank-wrap[data-id="${d.id}"]`)
                .transition('reorder').duration(reorderDur).ease(EASE)
                .attr('transform', `translate(0, ${targetY})`)
              chromeG.select(`g.band-handle[data-id="${d.id}"]`)
                .transition('reorder').duration(reorderDur).ease(EASE)
                .attr('transform', `translate(0, ${targetY})`)

              // Commit
              const sortValues = active.map(g => g.measurements[sortUnit] ?? 0).sort((a, b) => a - b)
              drag.currentOrder.forEach((id, i) => {
                const g = active.find(x => x.id === id)
                if (!g) return
                const newSortValue = sortValues[i]
                if (g.measurements[sortUnit] !== newSortValue) {
                  onUpdate(id, { measurements: { ...g.measurements, [sortUnit]: newSortValue } })
                }
              })
            })
        )
      }

    }
  }, [goals, mode, activeUnit, unitKind, sortUnit, sortUnitKind, frame, size, onUpdate, onGoalClick])

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
