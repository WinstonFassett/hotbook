import { VizRenderer, mountIcicle, mountSunburst, mountTreemap } from '@winstonfassett/vizform-vanilla-d3'
import type {
  Goal, GoalTree, FlatMode, HierMode, UnitKind,
  IcicleMounted, SunburstMounted, TreemapMounted,
} from '@winstonfassett/vizform-vanilla-d3'

// ── <vizform-viz> — flat viz custom element ───────────────────────────────────

interface VizFormVizProps {
  goals: Goal[]
  mode: FlatMode
  activeUnit: string
  unitKind: UnitKind
  sortUnit: string
  sortUnitKind: UnitKind
  frame?: number
  onUpdate?: (id: string, patch: Partial<Goal>) => void
  onGoalClick?: (goal: Goal) => void
}

export class VizFormVizElement extends HTMLElement {
  private _svg: SVGSVGElement
  private _renderer: VizRenderer | null = null
  private _props: VizFormVizProps = {
    goals: [],
    mode: 'treemap',
    activeUnit: 'size',
    unitKind: 'size',
    sortUnit: 'size',
    sortUnitKind: 'size',
  }
  private _ro: ResizeObserver | null = null
  private _size = { w: 0, h: 0 }

  constructor() {
    super()
    this._svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this._svg.style.cssText = 'display:block;width:100%;height:100%;font-family:system-ui,-apple-system,sans-serif'
  }

  connectedCallback() {
    this.style.display = 'block'
    this.appendChild(this._svg)
    this._renderer = new VizRenderer(this._svg)
    this._ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      this._size = { w: Math.floor(width), h: Math.floor(height) }
      this._render()
    })
    this._ro.observe(this)
  }

  disconnectedCallback() {
    this._ro?.disconnect()
    this._renderer?.destroy()
    this._renderer = null
  }

  set goals(val: Goal[]) { this._props.goals = val; this._render() }
  set mode(val: FlatMode) { this._props.mode = val; this._render() }
  set activeUnit(val: string) { this._props.activeUnit = val; this._render() }
  set unitKind(val: UnitKind) { this._props.unitKind = val; this._render() }
  set sortUnit(val: string) { this._props.sortUnit = val; this._render() }
  set sortUnitKind(val: UnitKind) { this._props.sortUnitKind = val; this._render() }
  set frame(val: number | undefined) { this._props.frame = val; this._render() }
  set onUpdate(fn: ((id: string, patch: Partial<Goal>) => void) | undefined) { this._props.onUpdate = fn }
  set onGoalClick(fn: ((goal: Goal) => void) | undefined) { this._props.onGoalClick = fn }

  private _render() {
    if (!this._renderer || this._size.w === 0 || this._size.h === 0) return
    const { goals, mode, activeUnit, unitKind, sortUnit, sortUnitKind, frame } = this._props
    this._svg.setAttribute('width', String(this._size.w))
    this._svg.setAttribute('height', String(this._size.h))
    this._renderer.render({
      goals, w: this._size.w, h: this._size.h,
      mode, activeUnit, unitKind, sortUnit, sortUnitKind, frame,
      onUpdate: (id, patch) => {
        this._props.onUpdate?.(id, patch)
        this.dispatchEvent(new CustomEvent<{ id: string; patch: Partial<Goal> }>('vizform:change', {
          detail: { id, patch }, bubbles: true,
        }))
      },
      onGoalClick: (goal) => {
        this._props.onGoalClick?.(goal)
        this.dispatchEvent(new CustomEvent<{ goal: Goal }>('vizform:click', {
          detail: { goal }, bubbles: true,
        }))
      },
    })
  }
}

// ── <vizform-hviz> — hierarchical viz custom element ─────────────────────────

type HMounted = IcicleMounted | SunburstMounted | TreemapMounted

export class VizFormHVizElement extends HTMLElement {
  private _svg: SVGSVGElement
  private _mounted: HMounted | null = null
  private _tree: GoalTree | null = null
  private _mode: HierMode = 'h-treemap'

  constructor() {
    super()
    this._svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this._svg.style.cssText = 'display:block;width:100%;height:100%'
  }

  connectedCallback() {
    this.style.display = 'block'
    this.appendChild(this._svg)
    this._mount()
  }

  disconnectedCallback() {
    this._mounted?.destroy()
    this._mounted = null
  }

  set tree(val: GoalTree) {
    this._tree = val
    if (this._mounted) this._mounted.update(val)
    else this._mount()
  }

  set mode(val: HierMode) {
    if (val === this._mode) return
    this._mode = val
    this._remount()
  }

  set onLeafClick(fn: ((id: string) => void) | undefined) {
    this._onLeafClick = fn
  }

  private _onLeafClick?: (id: string) => void

  private _mount() {
    if (!this._tree) return
    this._mounted?.destroy()
    const callbacks = {
      onLeafClick: (id: string) => {
        this._onLeafClick?.(id)
        this.dispatchEvent(new CustomEvent<{ id: string }>('vizform:leaf-click', {
          detail: { id }, bubbles: true,
        }))
      },
    }
    if (this._mode === 'h-icicle') this._mounted = mountIcicle(this._svg, this._tree, callbacks)
    else if (this._mode === 'h-radial') this._mounted = mountSunburst(this._svg, this._tree, callbacks)
    else this._mounted = mountTreemap(this._svg, this._tree, callbacks)
  }

  private _remount() {
    this._mounted?.destroy()
    this._mounted = null
    this._mount()
  }
}
