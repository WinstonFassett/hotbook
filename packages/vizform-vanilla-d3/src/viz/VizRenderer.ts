import { arc, pie } from 'd3-shape'
import { select, type Selection } from 'd3-selection'
import 'd3-transition'
import { drag } from 'd3-drag'
import { easeCubicInOut, easeQuadIn, easeQuadOut } from 'd3-ease'
import type { Goal, UnitKind, FlatMode, VizCallbacks } from '../types'
import type { AtomGeometry, LayoutResult, VizMode } from './types'
import { layoutTreemap } from './layoutTreemap'
import { layoutBands } from './layoutBands'
import { layoutRadial } from './layoutRadial'
import { phantomGoal } from './types'
import {
  arcPath, arcToArcTween, arcToRectReel, clientAngle, parseTranslate,
  rectPath, rectToArcReel, rectToRectScreen, rectToRectTween, shapeKind,
} from './pathPrimitives'
import {
  DEFAULT_SIZE, DUR, EASE, EXIT_DUR, HANDLE_HIT_W, HANDLE_VIS_W,
  MIN_ARC_ANGLE, MIN_NUMBER_ANGLE, PAD_ANGLE, REORDER_DUR, ROW_H,
} from './constants'
import { renderRadialChrome } from './chrome/radialChrome'

function getClientPos(e: Event): { clientX: number; clientY: number } {
  if ('touches' in e) {
    const t = (e as TouchEvent).touches[0] ?? (e as TouchEvent).changedTouches[0]
    if (t) return { clientX: t.clientX, clientY: t.clientY }
  }
  return { clientX: (e as MouseEvent).clientX, clientY: (e as MouseEvent).clientY }
}

function getClientAngle(sourceEvent: Event, svgEl: SVGSVGElement, cx: number, cy: number): number {
  const { clientX, clientY } = getClientPos(sourceEvent)
  return clientAngle(clientX, clientY, svgEl, cx, cy)
}
import { renderBandsChrome } from './chrome/bandsChrome'

type AtomEl = SVGGElement & { _angles?: { startAngle: number; endAngle: number } }

interface RadialResizeDrag {
  goalId: string
  startValue: number
  otherTotal: number
  arcStartAngle: number
  totalPad: number
  previewValue: number
}

interface RadialReorderDrag {
  goalId: string
  startMouseAngle: number
  startMidAngle: number
  arcSpan: number
  currentOrder: string[]
  layoutMap: Map<string, AtomGeometry>
  startX: number
  startY: number
  activated: boolean
}

interface BandsResizeDrag {
  goalId: string
  startValue: number
  lockedAxis: number
  trackLeftAbs: number
  trackW: number
  previewValue: number
}

interface BandsReorderDrag {
  goalId: string
  startClientX: number
  startClientY: number
  grabOffsetY: number
  initialOrder: string[]
  currentOrder: string[]
  activated: boolean
}

export interface VizRenderOptions {
  goals: Goal[]
  w: number
  h: number
  mode: FlatMode
  activeUnit: string
  unitKind: UnitKind
  sortUnit: string
  sortUnitKind: UnitKind
  frame: number | undefined
  onUpdate: (id: string, patch: Partial<Goal>) => void
  onReorder?: (orderedIds: string[]) => void
  onGoalClick?: (goal: Goal) => void
  // HUD wiring (cross-tile hover/select). Highlight is keyed by goal id.
  hoverId?: string | null
  selectionId?: string | null
  onHover?: (id: string | null) => void
  onSelect?: (id: string) => void
}

export class VizRenderer {
  private svgEl: SVGSVGElement

  // Morphing state
  private prevMode: VizMode | null = null
  private prevAtoms = new Map<string, AtomGeometry>()
  // When a drag ends, we capture the ghost positions here so the settle
  // transition starts from visual positions at release. update() consumes
  // this once (replaces prevAtoms for that render) then clears it.
  private dragSettlePrevAtoms: Map<string, AtomGeometry> | null = null

  // Drag state
  private radialResizeDrag: RadialResizeDrag | null = null
  private radialReorderDrag: RadialReorderDrag | null = null
  private bandsResizeDrag: BandsResizeDrag | null = null
  private bandsReorderDrag: BandsReorderDrag | null = null

  // Position freeze: IDs in display order captured at resize-drag start.
  // Passed as forceOrder to layout so sort doesn't resequence mid-drag.
  private dragOrderSnapshot: string[] | null = null
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null

  // Latest render state (for event handlers that fire outside render)
  private latestGoals: Goal[] = []
  private latestOpts: VizRenderOptions | null = null

  private wheelHandler: ((e: WheelEvent) => void) | null = null

  constructor(svgEl: SVGSVGElement) {
    this.svgEl = svgEl
    this._setupWheelHandler()
  }

  private _setupWheelHandler() {
    this.wheelHandler = (event: WheelEvent) => {
      const opts = this.latestOpts
      if (!opts) return
      if (opts.unitKind === 'order') return
      if (!(event.metaKey || event.ctrlKey)) return
      const hit = document.elementFromPoint(event.clientX, event.clientY) as Element | null
      const atomG = hit?.closest('g.goal-atom') as SVGGElement | null
      if (!atomG || atomG.classList.contains('phantom')) return
      const id = atomG.getAttribute('data-id')
      if (!id) return
      event.preventDefault()
      event.stopPropagation()
      const goal = this.latestGoals.find(g => g.id === id && !g.archived)
      if (!goal) return
      const step = event.shiftKey ? 5 : 1
      const dir = event.deltaY < 0 ? +1 : -1
      const cur = Math.max(0, goal.measurements[opts.activeUnit] ?? DEFAULT_SIZE)
      const next = Math.max(1, cur + dir * step)
      if (next !== cur) {
        opts.onUpdate(goal.id, { measurements: { ...goal.measurements, [opts.activeUnit]: next } })
      }
    }
    this.svgEl.addEventListener('wheel', this.wheelHandler, { passive: false })
  }

  private cancelCallback: (() => void) | null = null

  private _startResizeDrag(atoms: AtomGeometry[], onCancel: () => void) {
    this.dragOrderSnapshot = atoms.filter(a => !a.isPhantom).map(a => a.id)
    this.cancelCallback = onCancel
    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Drag-cancel wins over any idle Esc-to-clear-selection handler upstream.
      e.preventDefault()
      e.stopPropagation()
      this._cancelResizeDrag()
    }
    // Capture phase so this fires before a bubble-phase app-level Esc handler.
    document.addEventListener('keydown', this.escapeHandler, true)
  }

  private _endResizeDrag() {
    this.dragOrderSnapshot = null
    this.cancelCallback = null
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler, true)
      this.escapeHandler = null
    }
  }

  private _cancelResizeDrag() {
    const revert = this.cancelCallback
    this.radialResizeDrag = null
    this.bandsResizeDrag = null
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    this._endResizeDrag()
    revert?.()
  }

  render(opts: VizRenderOptions) {
    const { goals, w, h, mode, activeUnit, unitKind, sortUnit, sortUnitKind, frame, onUpdate, onReorder, onGoalClick, hoverId, selectionId, onHover, onSelect } = opts
    this.latestGoals = goals
    this.latestOpts = opts

    if (!this.svgEl || w === 0 || h === 0) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dur = reducedMotion ? 0 : DUR
    const exitDur = reducedMotion ? 0 : EXIT_DUR
    const reorderDur = reducedMotion ? 0 : REORDER_DUR

    const active = goals.filter(g => !g.archived)
    if (active.length === 0) {
      select(this.svgEl).selectAll('*').remove()
      this.prevAtoms.clear()
      this.prevMode = mode
      return
    }

    const previewGoals: Goal[] = active.map(g => {
      const r = this.bandsResizeDrag
      if (r && r.goalId === g.id) return { ...g, measurements: { ...g.measurements, [activeUnit]: r.previewValue } }
      const rr = this.radialResizeDrag
      if (rr && rr.goalId === g.id) return { ...g, measurements: { ...g.measurements, [activeUnit]: Math.max(1, rr.previewValue) } }
      return g
    })

    const layoutOpts = { activeUnit, unitKind, sortUnit, sortUnitKind, frame, forceOrder: this.dragOrderSnapshot ?? undefined }
    const layout: LayoutResult =
      mode === 'treemap' ? layoutTreemap(previewGoals, w, h, layoutOpts) :
      mode === 'bands'   ? layoutBands(previewGoals, w, h, layoutOpts) :
                           layoutRadial(previewGoals, w, h, layoutOpts)

    const { atoms, meta } = layout

    const valueOf = (g: Goal) => Math.max(0, g.measurements[activeUnit] ?? DEFAULT_SIZE)
    const atomsWithValues = atoms.map(a => {
      const g = previewGoals.find(x => x.id === a.id)
      return Object.assign({}, a, { __value: g ? valueOf(g) : 0 }) as AtomGeometry & { __value: number }
    })

    const svg = select(this.svgEl)
    let chromeG = svg.select<SVGGElement>('g.viz-chrome')
    if (chromeG.empty()) chromeG = svg.append('g').attr('class', 'viz-chrome')
    let atomsG = svg.select<SVGGElement>('g.viz-atoms')
    if (atomsG.empty()) atomsG = svg.append('g').attr('class', 'viz-atoms')
    let topG = svg.select<SVGGElement>('g.viz-top')
    if (topG.empty()) topG = svg.append('g').attr('class', 'viz-top')
    chromeG.lower()
    atomsG.raise()
    topG.raise()

    const isModeChange = this.prevMode !== null && this.prevMode !== mode
    const morphDur = reducedMotion ? 0 : 600

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

    allAtoms.select<SVGPathElement>('path.shape')
      .on('click', (event, d) => {
        if (d.isPhantom) return
        if (this.radialReorderDrag?.activated || this.bandsReorderDrag?.activated) return
        if (this.radialResizeDrag || this.bandsResizeDrag) return
        event.stopPropagation()
        const goal = previewGoals.find(g => g.id === d.id)
        if (goal) onGoalClick?.(goal)
        onSelect?.(d.id)
      })

    // During settle sequence after radial reorder, use ghost positions as
    // transition start. Keep until a new drag starts (cleared on drag start).
    const isReordering = this.radialReorderDrag !== null
    const prevAtoms = this.dragSettlePrevAtoms ?? this.prevAtoms
    if (!isReordering) this.dragSettlePrevAtoms = null

    allAtoms.each(function(d) {
      const sel = select<AtomEl, AtomGeometry & { __value: number }>(this as AtomEl)
      const path = sel.select<SVGPathElement>('path.shape')
      const prev = prevAtoms.get(d.id)
      const sameMode = !isModeChange

      if (sameMode) {
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
        const fromKind = shapeKind(prev)
        const toKind = shapeKind(d)

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
          frame = rectToArcReel(fa[0], fa[1], prev.rectParams!, ta[0], ta[1], d.arcParams!, chartMaxDim)
        } else if (fromKind === 'arc' && toKind === 'rect') {
          frame = arcToRectReel(fa[0], fa[1], prev.arcParams!, ta[0], ta[1], d.rectParams!, chartMaxDim)
        } else if (fromKind === 'rect' && toKind === 'rect') {
          frame = rectToRectScreen(fa[0], fa[1], prev.rectParams!, ta[0], ta[1], d.rectParams!)
        } else {
          frame = (t: number) => ({
            d: t < 0.5 ? prev.d : d.d,
            transform: t < 0.5 ? prev.shapeTransform : d.shapeTransform,
          })
        }

        sel.interrupt().interrupt('settle').interrupt('morph')
        path.interrupt().interrupt('settle').interrupt('morph')
        sel.attr('data-morphing', '1')
        const nameSel = sel.select<SVGTextElement>('text.name').interrupt()
        const valueSel = sel.select<SVGTextElement>('text.value').interrupt()
        nameSel.attr('text-anchor', prev.textAnchor)
        valueSel.attr('text-anchor', prev.textAnchor)

        const f0 = frame(0)
        sel.attr('transform', f0.transform)
        path.attr('d', f0.d)
        nameSel.attr('transform', `translate(${fNameAbs[0]},${fNameAbs[1]})`)
        valueSel.attr('transform', `translate(${fValAbs[0]},${fValAbs[1]})`)

        path.transition('morph').duration(morphDur).ease(easeCubicInOut)
          .attrTween('d', () => (t: number) => {
            const f = frame(t)
            sel.attr('transform', f.transform)
            const lerp = (a: number, b: number) => a + (b - a) * t
            const nameScreen: [number, number] = [lerp(fNameAbs[0], tNameAbs[0]), lerp(fNameAbs[1], tNameAbs[1])]
            const valScreen: [number, number] = [lerp(fValAbs[0], tValAbs[0]), lerp(fValAbs[1], tValAbs[1])]
            const ft = parseTranslate(f.transform)
            nameSel.attr('transform', `translate(${nameScreen[0] - ft[0]},${nameScreen[1] - ft[1]})`)
            valueSel.attr('transform', `translate(${valScreen[0] - ft[0]},${valScreen[1] - ft[1]})`)
            return f.d
          })
          .attr('fill', d.fill)
          .on('end', function() {
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
        nameSel.transition('morph-label').duration(morphDur).ease(easeCubicInOut)
          .style('opacity', d.labelOpacity)
        valueSel.transition('morph-label').duration(morphDur).ease(easeCubicInOut)
          .style('opacity', d.labelOpacity)
        nameSel.text(d.nameText)
        valueSel.text(d.valueText)
      } else {
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

    atomSel.exit()
      .transition().duration(exitDur).ease(easeQuadIn)
      .style('opacity', 0)
      .remove()

    // ── HUD: hover/select highlight + cross-tile sync ──────────────────
    // Stroke convention matches the first-gen hierarchical charts (Sunburst/
    // Icicle): selection → --pv-ink, hover → --pv-ink-muted, else none.
    allAtoms.select<SVGPathElement>('path.shape')
      .attr('stroke', d => d.isPhantom ? 'none'
        : selectionId === d.id ? 'var(--pv-ink)'
        : hoverId === d.id ? 'var(--pv-ink-muted)'
        : 'none')
      .attr('stroke-width', d => (!d.isPhantom && (selectionId === d.id || hoverId === d.id)) ? 1.5 : 0)
    allAtoms
      .on('pointerenter.hud', (_ev, d) => { if (!d.isPhantom) onHover?.(d.id) })
      .on('pointerleave.hud', () => onHover?.(null))

    // ── Chrome ──────────────────────────────────────────────────────
    const targetChromeG: typeof chromeG | null =
      mode === 'radial' ? topG : mode === 'bands' ? chromeG : null
    const sourceChromeG: typeof chromeG | null =
      this.prevMode === 'radial' ? topG :
      this.prevMode === 'bands' ? chromeG : null

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
      renderBandsChrome(chromeG, atomsWithValues, meta, { isOrderActive, canResize, canReorder })
      if (isModeChange) {
        chromeG.style('opacity', 0)
          .interrupt('chrome')
          .transition('chrome').delay(exitDur / 2).duration(exitDur).ease(easeQuadOut)
          .style('opacity', 1)
      }
    }

    // ── Drag wiring ────────────────────────────────────────────────
    allAtoms.select<SVGPathElement>('path.shape').on('.drag', null)
    chromeG.selectAll<SVGCircleElement, unknown>('circle.resize-handle').on('.drag', null)
    chromeG.selectAll<SVGGElement, unknown>('g.band-handle').on('.drag', null)
    chromeG.selectAll<SVGGElement, unknown>('g.band-rank-wrap').on('.drag', null)
    topG.selectAll<SVGCircleElement, unknown>('circle.resize-handle').on('.drag', null)
    allAtoms.on('mouseenter.handle', null).on('mouseleave.handle', null)

    if (mode === 'radial') {
      this._attachRadialDrag(allAtoms, atomsG, topG, atoms, atomsWithValues, active, previewGoals, meta, activeUnit, unitKind, sortUnit, sortUnitKind, frame, reorderDur, onUpdate, onReorder)
    } else if (mode === 'bands') {
      this._attachBandsDrag(allAtoms, atomsG, chromeG, atoms, atomsWithValues, active, meta, activeUnit, unitKind, sortUnit, sortUnitKind, frame, reorderDur, onUpdate, onReorder)
    }

    const nextPrev = new Map<string, AtomGeometry>()
    atoms.forEach(a => nextPrev.set(a.id, a))
    this.prevAtoms = nextPrev
    this.prevMode = mode
  }

  private _attachRadialDrag(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allAtoms: any,
    atomsG: ReturnType<typeof select<SVGGElement, unknown>>,
    topG: ReturnType<typeof select<SVGGElement, unknown>>,
    atoms: AtomGeometry[],
    atomsWithValues: (AtomGeometry & { __value: number })[],
    active: Goal[],
    previewGoals: Goal[],
    meta: LayoutResult['meta'],
    activeUnit: string,
    unitKind: UnitKind,
    sortUnit: string,
    sortUnitKind: UnitKind,
    frame: number | undefined,
    reorderDur: number,
    onUpdate: VizCallbacks['onUpdate'],
    onReorder: VizCallbacks['onReorder'],
  ) {
    const self = this
    const cx = meta.cx ?? 0
    const cy = meta.cy ?? 0
    const outerR = meta.outerR ?? 0
    const innerR = meta.innerR ?? 0
    const N = atoms.length
    const isOrder = unitKind === 'order'
    const canResize = !isOrder
    const canReorder = sortUnitKind === 'order'
    const svgEl = this.svgEl

    if (canResize) {
      allAtoms
        .on('mouseenter.handle', function(_ev, d) {
          topG.select(`circle.resize-handle[data-id="${d.id}"]`).style('opacity', 1)
        })
        .on('mouseleave.handle', function(_ev, d) {
          if (!self.radialResizeDrag) {
            topG.select(`circle.resize-handle[data-id="${d.id}"]`).style('opacity', 0)
          }
        })
    }

    if (canResize) {
      const handles = topG.selectAll<SVGCircleElement, AtomGeometry>('circle.resize-handle')
      const self = this
      handles.call(
        drag<SVGCircleElement, AtomGeometry>()
          .on('start', function(event, d) {
            event.sourceEvent.stopPropagation()
            const ap = d.arcParams
            if (!ap) return
            const otherTotal = active
              .filter(g => g.id !== d.id)
              .reduce((s, g) => s + (g.measurements[activeUnit] ?? DEFAULT_SIZE), 0)
            const goal = active.find(g => g.id === d.id)!
            const startValue = goal.measurements[activeUnit] ?? DEFAULT_SIZE
            self.radialResizeDrag = {
              goalId: d.id, startValue, otherTotal,
              arcStartAngle: ap.startAngle,
              totalPad: N * PAD_ANGLE,
              previewValue: startValue,
            }
            self._startResizeDrag(atoms, () => {
              onUpdate(d.id, { measurements: { ...goal.measurements, [activeUnit]: startValue } })
            })
            select(this).style('opacity', 1)
            const root = topG.select<SVGGElement>('g.radial-root')
            root.select('text.center-total').classed('drag-mode', true).text(`${startValue}`)
            root.select('text.center-unit').classed('drag-mode', true).text(goal.name)
          })
          .on('drag', function(event, d) {
            const dr = self.radialResizeDrag
            if (!dr) return
            const mouseA = getClientAngle(event.sourceEvent, svgEl, cx, cy)
            const minEnd = dr.arcStartAngle + PAD_ANGLE + 0.05
            const maxEnd = dr.arcStartAngle + (2 * Math.PI - dr.totalPad) - 0.05
            let unwrapped = mouseA
            if (unwrapped < dr.arcStartAngle) unwrapped += 2 * Math.PI
            const newEndAngle = Math.max(minEnd, Math.min(maxEnd, unwrapped))
            const newSpan = newEndAngle - dr.arcStartAngle - PAD_ANGLE
            const availSpan = 2 * Math.PI - dr.totalPad
            const p = Math.max(0.001, Math.min(0.999, newSpan / availSpan))
            const previewValue = Math.max(1, Math.round(dr.otherTotal * p / (1 - p)))
            if (previewValue !== dr.previewValue) {
              dr.previewValue = previewValue
              const goal = active.find(g => g.id === dr.goalId)
              if (goal) onUpdate(dr.goalId, { measurements: { ...goal.measurements, [activeUnit]: previewValue } })
            } else {
              dr.previewValue = previewValue
            }
            const ghostArc = { ...d.arcParams!, endAngle: newEndAngle, innerRadius: innerR, outerRadius: outerR }
            const atomG = atomsG.select<SVGGElement>(`g.goal-atom[data-id="${dr.goalId}"]`)
            atomG.select<SVGPathElement>('path.shape').interrupt().attr('d', arcPath(ghostArc))
            const labelArcInner = (Math.min(meta.width, meta.height) / 2 * 0.86) * 0.58
            const labelGen = arc<unknown, typeof ghostArc>().innerRadius(labelArcInner).outerRadius(labelArcInner)
            const [lx, ly] = labelGen.centroid(ghostArc)
            atomG.select<SVGTextElement>('text.name').interrupt()
              .attr('transform', `translate(${lx}, ${ly - 6})`)
              .style('opacity', (newEndAngle - dr.arcStartAngle) < MIN_ARC_ANGLE ? 0 : 1)
            atomG.select<SVGTextElement>('text.value').interrupt()
              .attr('transform', `translate(${lx}, ${ly + 10})`)
              .style('opacity', (newEndAngle - dr.arcStartAngle) < MIN_ARC_ANGLE ? 0 : 1)
              .text(`${previewValue} ${activeUnit}`)
            const numR = (Math.min(meta.width, meta.height) / 2 * 0.86) * 0.78
            const numGen = arc<unknown, typeof ghostArc>().innerRadius(numR).outerRadius(numR)
            const [nx, ny] = numGen.centroid(ghostArc)
            topG.select(`text.arc-number[data-id="${dr.goalId}"]`).interrupt()
              .attr('transform', `translate(${nx},${ny})`)
              .style('opacity', (newEndAngle - dr.arcStartAngle) < MIN_NUMBER_ANGLE ? 0 : 1)
            select(this)
              .attr('cx', outerR * Math.sin(newEndAngle - PAD_ANGLE / 2))
              .attr('cy', -outerR * Math.cos(newEndAngle - PAD_ANGLE / 2))
            const root = topG.select<SVGGElement>('g.radial-root')
            root.select('text.center-total')
              .text(previewValue === dr.startValue ? `${dr.startValue}` : `${dr.startValue} → ${previewValue}`)
          })
          .on('end', function(_ev, d) {
            const dr = self.radialResizeDrag
            self.radialResizeDrag = null
            self._endResizeDrag()
            if (!dr) return
            select(this).style('opacity', 0)
            if (dr.previewValue !== dr.startValue) {
              const goal = active.find(g => g.id === d.id)
              if (goal) {
                onUpdate(d.id, { measurements: { ...goal.measurements, [activeUnit]: dr.previewValue } })
              }
            }
          })
      )
    }

    if (canReorder) {
      const self = this
      allAtoms.select<SVGPathElement>('path.shape')
        .style('cursor', d => d.isPhantom ? 'default' : 'grab')
        .call(
          drag<SVGPathElement, AtomGeometry & { __value: number }>()
            .clickDistance(5)
            .filter(event => !event.target || !(event.target as SVGElement).classList.contains('resize-handle'))
            .on('start', function(event, d) {
              if (d.isPhantom) return
              if (!d.arcParams) return
              self.dragSettlePrevAtoms = null
              const mouseA = getClientAngle(event.sourceEvent, svgEl, cx, cy)
              const initialOrder = atoms.filter(a => !a.isPhantom).map(a => a.id)
              const layoutMap = new Map<string, AtomGeometry>()
              atoms.forEach(a => layoutMap.set(a.id, a))
              self.radialReorderDrag = {
                goalId: d.id, startMouseAngle: mouseA,
                startMidAngle: (d.arcParams.startAngle + d.arcParams.endAngle) / 2,
                arcSpan: d.arcParams.endAngle - d.arcParams.startAngle,
                currentOrder: initialOrder, layoutMap,
                startX: event.x, startY: event.y, activated: false,
              }
            })
            .on('drag', function(event, d) {
              const dr = self.radialReorderDrag
              if (!dr) return
              if (!dr.activated) {
                const dx = event.x - dr.startX
                const dy = event.y - dr.startY
                if (dx * dx + dy * dy < 25) return
                dr.activated = true
                event.sourceEvent.stopPropagation()
                select(this).interrupt().style('cursor', 'grabbing')
                atomsG.select(`g.goal-atom[data-id="${dr.goalId}"]`).interrupt().raise()
              }
              const mouseA = getClientAngle(event.sourceEvent, svgEl, cx, cy)
              let delta = mouseA - dr.startMouseAngle
              if (delta > Math.PI) delta -= 2 * Math.PI
              if (delta < -Math.PI) delta += 2 * Math.PI
              const newMid = (dr.startMidAngle + delta + 2 * Math.PI) % (2 * Math.PI)
              const half = dr.arcSpan / 2
              const ap = d.arcParams!
              const ghost = { ...ap, startAngle: newMid - half, endAngle: newMid + half, innerRadius: innerR, outerRadius: outerR }
              select(this).attr('d', arcPath(ghost))
              const labelArcInner_d = (Math.min(meta.width, meta.height) / 2 * 0.86) * 0.58
              const labelGen_d = arc<unknown, typeof ghost>().innerRadius(labelArcInner_d).outerRadius(labelArcInner_d)
              const [lx_d, ly_d] = labelGen_d.centroid(ghost)
              atomsG.select<SVGTextElement>(`g.goal-atom[data-id="${dr.goalId}"] text.name`)
                .interrupt().attr('transform', `translate(${lx_d}, ${ly_d - 6})`)
              atomsG.select<SVGTextElement>(`g.goal-atom[data-id="${dr.goalId}"] text.value`)
                .interrupt().attr('transform', `translate(${lx_d}, ${ly_d + 10})`)
              topG.select<SVGCircleElement>(`circle.resize-handle[data-id="${dr.goalId}"]`)
                .interrupt()
                .attr('cx', outerR * Math.sin(ghost.endAngle - PAD_ANGLE / 2))
                .attr('cy', -outerR * Math.cos(ghost.endAngle - PAD_ANGLE / 2))
              const numR_d = (Math.min(meta.width, meta.height) / 2 * 0.86) * 0.78
              const numGen_d = arc<unknown, typeof ghost>().innerRadius(numR_d).outerRadius(numR_d)
              const [nx_d, ny_d] = numGen_d.centroid(ghost)
              topG.select<SVGTextElement>(`text.arc-number[data-id="${dr.goalId}"]`)
                .interrupt().attr('transform', `translate(${nx_d},${ny_d})`)
              const angles = dr.currentOrder.map(id => {
                if (id === dr.goalId) return { id, mid: newMid }
                const a = dr.layoutMap.get(id)
                if (!a?.arcParams) return { id, mid: 0 }
                return { id, mid: (a.arcParams.startAngle + a.arcParams.endAngle) / 2 }
              })
              angles.sort((a, b) => a.mid - b.mid)
              const newOrder = angles.map(x => x.id)
              let changed = false
              for (let i = 0; i < newOrder.length; i++) {
                if (newOrder[i] !== dr.currentOrder[i]) { changed = true; break }
              }
              if (changed) {
                dr.currentOrder = newOrder
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
                  const ap2 = { startAngle: s.startAngle, endAngle: s.endAngle, innerRadius: innerR, outerRadius: outerR, cornerRadius: 4, padAngle: PAD_ANGLE }
                  newMap.set(s.data.id, { ...atoms.find(a => a.id === s.data.id)!, arcParams: ap2 })
                  void i
                })
                dr.layoutMap = newMap
                for (const a of newMap.values()) {
                  if (a.id === dr.goalId) continue
                  const ap2 = a.arcParams!
                  atomsG.select<SVGPathElement>(`g.goal-atom[data-id="${a.id}"] path.shape`)
                    .interrupt().transition('reorder').duration(reorderDur).ease(EASE).attr('d', arcPath(ap2))
                  const labelArcInner = (Math.min(meta.width, meta.height) / 2 * 0.86) * 0.58
                  const labelGen = arc<unknown, typeof ap2>().innerRadius(labelArcInner).outerRadius(labelArcInner)
                  const [lx, ly] = labelGen.centroid(ap2)
                  atomsG.select<SVGTextElement>(`g.goal-atom[data-id="${a.id}"] text.name`)
                    .interrupt().transition('reorder').duration(reorderDur).ease(EASE).attr('transform', `translate(${lx}, ${ly - 6})`)
                  atomsG.select<SVGTextElement>(`g.goal-atom[data-id="${a.id}"] text.value`)
                    .interrupt().transition('reorder').duration(reorderDur).ease(EASE).attr('transform', `translate(${lx}, ${ly + 10})`)
                  topG.select(`circle.resize-handle[data-id="${a.id}"]`)
                    .interrupt().transition('reorder').duration(reorderDur).ease(EASE)
                    .attr('cx', outerR * Math.sin(ap2.endAngle - PAD_ANGLE / 2))
                    .attr('cy', -outerR * Math.cos(ap2.endAngle - PAD_ANGLE / 2))
                  const numR = (Math.min(meta.width, meta.height) / 2 * 0.86) * 0.78
                  const numGen = arc<unknown, typeof ap2>().innerRadius(numR).outerRadius(numR)
                  const [nx, ny] = numGen.centroid(ap2)
                  const newIndex = newOrder.indexOf(a.id)
                  topG.select<SVGTextElement>(`text.arc-number[data-id="${a.id}"]`)
                    .text(`#${newIndex + 1}`)
                    .interrupt().transition('reorder').duration(reorderDur).ease(EASE)
                    .attr('transform', `translate(${nx},${ny})`)
                }
                const draggedNewIdx = newOrder.indexOf(dr.goalId)
                topG.select<SVGTextElement>(`text.arc-number[data-id="${dr.goalId}"]`).text(`#${draggedNewIdx + 1}`)
              }
            })
            .on('end', function(_ev, d) {
              const dr = self.radialReorderDrag
              self.radialReorderDrag = null
              if (!dr) return
              select(this).style('cursor', 'grab')
              if (!dr.activated) return
              // Stop any in-flight reorder transitions so their mid-animation
              // positions don't interfere with the settle transition.
              dr.layoutMap.forEach((_, id) => {
                if (id === dr.goalId) return
                atomsG.select<SVGPathElement>(`g.goal-atom[data-id="${id}"] path.shape`).interrupt('reorder')
                atomsG.select<SVGTextElement>(`g.goal-atom[data-id="${id}"] text.name`).interrupt('reorder')
                atomsG.select<SVGTextElement>(`g.goal-atom[data-id="${id}"] text.value`).interrupt('reorder')
                topG.select<SVGCircleElement>(`circle.resize-handle[data-id="${id}"]`).interrupt('reorder')
                topG.select<SVGTextElement>(`text.arc-number[data-id="${id}"]`).interrupt('reorder')
              })
              // Build dragSettlePrevAtoms: ghost positions at release so the
              // settle transition animates from where slices visually are, not
              // pre-drag positions. update() uses this and clears it once done.
              const settleMap = new Map(self.prevAtoms)
              dr.layoutMap.forEach((a, id) => {
                if (id === dr.goalId) return
                const prev = settleMap.get(id)
                if (prev && a.arcParams) {
                  settleMap.set(id, { ...prev, arcParams: a.arcParams })
                }
              })
              if (d.arcParams) {
                const mouseA = getClientAngle(_ev.sourceEvent, svgEl, cx, cy)
                let delta = mouseA - dr.startMouseAngle
                if (delta > Math.PI) delta -= 2 * Math.PI
                if (delta < -Math.PI) delta += 2 * Math.PI
                const newMid = (dr.startMidAngle + delta + 2 * Math.PI) % (2 * Math.PI)
                const half = dr.arcSpan / 2
                const ghostArc = {
                  startAngle: newMid - half,
                  endAngle: newMid + half,
                  innerRadius: innerR,
                  outerRadius: outerR,
                  cornerRadius: d.arcParams.cornerRadius,
                  padAngle: d.arcParams.padAngle,
                }
                const prev = settleMap.get(d.id)
                if (prev) {
                  settleMap.set(d.id, { ...prev, arcParams: ghostArc })
                }
              }
              self.dragSettlePrevAtoms = settleMap
              if (sortUnitKind === 'order') {
                onReorder?.(dr.currentOrder)
              }
            })
        )
    } else {
      allAtoms.select<SVGPathElement>('path.shape').style('cursor', 'pointer')
    }
  }

  private _attachBandsDrag(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allAtoms: any,
    atomsG: ReturnType<typeof select<SVGGElement, unknown>>,
    chromeG: ReturnType<typeof select<SVGGElement, unknown>>,
    atoms: AtomGeometry[],
    atomsWithValues: (AtomGeometry & { __value: number })[],
    active: Goal[],
    meta: LayoutResult['meta'],
    activeUnit: string,
    unitKind: UnitKind,
    sortUnit: string,
    sortUnitKind: UnitKind,
    frame: number | undefined,
    reorderDur: number,
    onUpdate: VizCallbacks['onUpdate'],
    onReorder: VizCallbacks['onReorder'],
  ) {
    const isOrderActive = unitKind === 'order'
    const canResize = !isOrderActive
    const canReorder = sortUnitKind === 'order'
    const trackX = meta.trackX ?? 0
    const trackW = meta.trackW ?? 0
    const topPad = meta.topPad ?? 0
    const rowStep = meta.rowStep ?? 0
    const svgEl = this.svgEl
    void atomsWithValues

    const allocatedTotal = active.reduce((s, g) => s + Math.max(0, g.measurements[activeUnit] ?? DEFAULT_SIZE), 0)
    const dragUnallocated = (frame != null && unitKind !== 'order') ? Math.max(0, frame - allocatedTotal) : 0
    const dataMax = Math.max(1,
      ...active.map(g => Math.max(0, g.measurements[activeUnit] ?? DEFAULT_SIZE)),
      dragUnallocated)

    const self = this

    if (canResize) {
      allAtoms
        .on('mouseenter.handle', function(_ev, d) {
          chromeG.select(`g.band-handle[data-id="${d.id}"]`).style('opacity', 1)
        })
        .on('mouseleave.handle', function(_ev, d) {
          if (self.bandsResizeDrag?.goalId === d.id) return
          chromeG.select(`g.band-handle[data-id="${d.id}"]`).style('opacity', 0)
        })
    }

    if (canResize) {
      chromeG.selectAll<SVGGElement, { id: string; index: number; width: number }>('g.band-handle').call(
        drag<SVGGElement, { id: string; index: number; width: number }>()
          .on('start', function(event, d) {
            event.sourceEvent.stopPropagation()
            const rect = svgEl.getBoundingClientRect()
            const goal = active.find(g => g.id === d.id)
            if (!goal) return
            const startValue = Math.max(0, goal.measurements[activeUnit] ?? DEFAULT_SIZE)
            self.bandsResizeDrag = {
              goalId: d.id, startValue,
              lockedAxis: dataMax,
              trackLeftAbs: rect.left + trackX,
              trackW, previewValue: startValue,
            }
            self._startResizeDrag(atoms, () => {
              onUpdate(d.id, { measurements: { ...goal.measurements, [activeUnit]: startValue } })
            })
            select(this).style('opacity', 1)
            select(this).select<SVGRectElement>('rect.band-handle-vis').attr('fill', 'oklch(0.98 0 0)')
            document.body.style.userSelect = 'none'
            document.body.style.cursor = 'ew-resize'
          })
          .on('drag', function(event, d) {
            const dr = self.bandsResizeDrag
            if (!dr) return
            const x = getClientPos(event.sourceEvent).clientX - dr.trackLeftAbs
            const fraction = Math.max(0, x / dr.trackW)
            const newValue = Math.max(1, Math.round(dr.lockedAxis * fraction))
            if (newValue !== dr.previewValue) {
              dr.previewValue = newValue
              const goal = active.find(g => g.id === d.id)
              if (goal) onUpdate(d.id, { measurements: { ...goal.measurements, [activeUnit]: newValue } })
            } else {
              dr.previewValue = newValue
            }
            const visW = Math.max(2, Math.min(dr.trackW, (newValue / dr.lockedAxis) * dr.trackW))
            const labelOp = visW >= 70 ? 1 : 0
            const atomG = atomsG.select<SVGGElement>(`g.goal-atom[data-id="${d.id}"]`)
            atomG.select<SVGPathElement>('path.shape').interrupt()
              .attr('d', rectPath({ x: 0, y: 0, w: visW, h: ROW_H - 8, rx: 4 }))
            atomG.select<SVGTextElement>('text.value').interrupt()
              .attr('transform', `translate(${visW - 10}, ${(ROW_H - 8) / 2})`)
              .style('opacity', labelOp)
              .text(`${newValue}`)
            atomG.select<SVGTextElement>('text.name').interrupt().style('opacity', labelOp)
            const handleG = select(this)
            handleG.select<SVGRectElement>('rect.band-handle-hit').attr('x', trackX + visW - HANDLE_HIT_W / 2)
            handleG.select<SVGRectElement>('rect.band-handle-vis').attr('x', trackX + visW - HANDLE_VIS_W / 2)
          })
          .on('end', function(_ev, d) {
            const dr = self.bandsResizeDrag
            self.bandsResizeDrag = null
            self._endResizeDrag()
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
            select(this).select<SVGRectElement>('rect.band-handle-vis').attr('fill', 'oklch(0.93 0 0)')
            select(this).style('opacity', 0)
            if (!dr) return
            if (dr.previewValue !== dr.startValue) {
              const goal = active.find(g => g.id === d.id)
              if (goal) {
                const visW = Math.max(2, Math.min(dr.trackW, (dr.previewValue / dr.lockedAxis) * dr.trackW))
                const labelOp = visW >= 70 ? 1 : 0
                const prev = self.prevAtoms.get(d.id)
                if (prev?.rectParams) {
                  prev.rectParams = { ...prev.rectParams, w: visW }
                  prev.d = rectPath({ x: 0, y: 0, w: visW, h: ROW_H - 8, rx: 4 })
                  prev.valueTransform = `translate(${visW - 10}, ${(ROW_H - 8) / 2})`
                  prev.labelOpacity = labelOp
                  prev.valueText = `${Math.round(dr.previewValue)}`
                }
                onUpdate(d.id, { measurements: { ...goal.measurements, [activeUnit]: dr.previewValue } })
              }
            }
          })
      )
    }

    if (canReorder) {
      chromeG.selectAll<SVGGElement, { id: string; index: number }>('g.band-rank-wrap').call(
        drag<SVGGElement, { id: string; index: number }>()
          .clickDistance(5)
          .on('start', function(event, d) {
            const svgRect = svgEl.getBoundingClientRect()
            const { clientX: _sx, clientY: _sy } = getClientPos(event.sourceEvent)
            const ySvg = _sy - svgRect.top
            const rowTop = topPad + d.index * rowStep
            self.bandsReorderDrag = {
              goalId: d.id,
              startClientX: _sx,
              startClientY: _sy,
              grabOffsetY: ySvg - rowTop,
              initialOrder: atoms.map(x => x.id),
              currentOrder: atoms.map(x => x.id),
              activated: false,
            }
          })
          .on('drag', function(event, d) {
            const dr = self.bandsReorderDrag
            if (!dr) return
            const { clientX: _dx, clientY: _dy } = getClientPos(event.sourceEvent)
            if (!dr.activated) {
              const dx = _dx - dr.startClientX
              const dy = _dy - dr.startClientY
              if (dx * dx + dy * dy < 25) return
              dr.activated = true
              event.sourceEvent.stopPropagation()
              atomsG.select(`g.goal-atom[data-id="${d.id}"]`).interrupt().raise()
              document.body.style.userSelect = 'none'
              document.body.style.cursor = 'grabbing'
            }
            const svgRect = svgEl.getBoundingClientRect()
            const ySvg = _dy - svgRect.top
            const newTop = Math.max(topPad, Math.min(topPad + (atoms.length - 1) * rowStep, ySvg - dr.grabOffsetY))
            atomsG.select(`g.goal-atom[data-id="${d.id}"]`).attr('transform', `translate(${trackX}, ${newTop + 4})`)
            chromeG.select(`g.band-rank-wrap[data-id="${d.id}"]`).attr('transform', `translate(0, ${newTop})`)
            chromeG.select(`g.band-handle[data-id="${d.id}"]`).attr('transform', `translate(0, ${newTop})`)
            const centerY = newTop + ROW_H / 2
            const newIdx = Math.max(0, Math.min(atoms.length - 1, Math.floor((centerY - topPad) / rowStep + 0.0001)))
            const without = dr.initialOrder.filter(id => id !== d.id)
            const next = [...without.slice(0, newIdx), d.id, ...without.slice(newIdx)]
            const changed = next.some((id, i) => id !== dr.currentOrder[i])
            if (changed) {
              dr.currentOrder = next
              next.forEach((id, i) => {
                if (id === d.id) return
                const targetY = topPad + i * rowStep
                atomsG.select(`g.goal-atom[data-id="${id}"]`).interrupt()
                  .transition('reorder').duration(reorderDur).ease(EASE)
                  .attr('transform', `translate(${trackX}, ${targetY + 4})`)
                chromeG.select(`g.band-rank-wrap[data-id="${id}"]`).interrupt()
                  .transition('reorder').duration(reorderDur).ease(EASE)
                  .attr('transform', `translate(0, ${targetY})`)
                chromeG.select<SVGTextElement>(`g.band-rank-wrap[data-id="${id}"] text.band-rank`).text(`#${i + 1}`)
                chromeG.select(`g.band-handle[data-id="${id}"]`).interrupt()
                  .transition('reorder').duration(reorderDur).ease(EASE)
                  .attr('transform', `translate(0, ${targetY})`)
              })
              const draggedNewIdx = next.indexOf(d.id)
              chromeG.select<SVGTextElement>(`g.band-rank-wrap[data-id="${d.id}"] text.band-rank`).text(`#${draggedNewIdx + 1}`)
            }
          })
          .on('end', function(_ev, d) {
            const dr = self.bandsReorderDrag
            self.bandsReorderDrag = null
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
            if (!dr || !dr.activated) return
            const finalIdx = dr.currentOrder.indexOf(d.id)
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
            onReorder?.(dr.currentOrder)
          })
      )
    }
  }

  destroy() {
    if (this.wheelHandler) {
      this.svgEl.removeEventListener('wheel', this.wheelHandler)
      this.wheelHandler = null
    }
  }
}
