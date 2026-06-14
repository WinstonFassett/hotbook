import { arc } from 'd3-shape'
import { interpolate } from 'd3-interpolate'
import type { ArcParams, AtomGeometry, LayoutMeta, RectParams } from './types'

const arcGen = arc<unknown, ArcParams>()

export function rectPath(rp: RectParams): string {
  const { w, h } = rp
  const rx = Math.max(0, Math.min(rp.rx, Math.min(w, h) / 2))
  if (rx <= 0.01) return `M0 0 H${w} V${h} H0 Z`
  return [
    `M${rx} 0`,
    `H${w - rx}`,
    `A${rx} ${rx} 0 0 1 ${w} ${rx}`,
    `V${h - rx}`,
    `A${rx} ${rx} 0 0 1 ${w - rx} ${h}`,
    `H${rx}`,
    `A${rx} ${rx} 0 0 1 0 ${h - rx}`,
    `V${rx}`,
    `A${rx} ${rx} 0 0 1 ${rx} 0`,
    'Z',
  ].join(' ')
}

export function arcPath(ap: ArcParams): string {
  return arcGen({
    ...ap,
    innerRadius: ap.innerRadius,
    outerRadius: ap.outerRadius,
  } as unknown as ArcParams) ?? ''
}

export function clientAngle(
  clientX: number,
  clientY: number,
  svgEl: SVGSVGElement,
  cx: number,
  cy: number,
): number {
  const rect = svgEl.getBoundingClientRect()
  const mx = clientX - rect.left - cx
  const my = clientY - rect.top - cy
  const a = Math.atan2(mx, -my)
  return (a + 2 * Math.PI) % (2 * Math.PI)
}

// ── Tweens ─────────────────────────────────────────────────────────────────

/** Rect → rect: lerp x/y/w/h/rx, render via rectPath. Translate group from→to. */
export function rectToRectTween(from: RectParams, to: RectParams) {
  return (t: number): string => {
    const lerp = (a: number, b: number) => a + (b - a) * t
    return rectPath({
      x: 0,
      y: 0,
      w: lerp(from.w, to.w),
      h: lerp(from.h, to.h),
      rx: lerp(from.rx, to.rx),
    })
  }
}

type Pt = [number, number]

/** Parse `translate(x, y)` from shapeTransform. Returns [0,0] if not parseable. */
export function parseTranslate(t: string): Pt {
  const m = /translate\(\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*\)/.exec(t)
  if (!m) return [0, 0]
  return [parseFloat(m[1]), parseFloat(m[2])]
}

/**
 * Rect ↔ arc morph using the d3-show-reel trick, generalized per atom.
 *
 * Insight: any rect in the plane is a degenerate arc — a thin sliver of a
 * giant circle whose center sits far on the opposite side from the chart
 * center. Place that giant circle, derive its (innerR, outerR, startAngle,
 * endAngle), then linearly interpolate ALL arc parameters and the arc's
 * center from the giant state to the real donut state. Each frame renders
 * a single proper arc — no sampling.
 *
 * The giant circle is placed so:
 *   - its outer rim passes through the rect's edge facing the chart center;
 *   - its mid-angle aims toward the chart center;
 *   - the rect's extent perpendicular to that direction becomes the arc's
 *     radial thickness; the parallel extent becomes a tiny angular sweep.
 */

interface ArcState {
  cx: number; cy: number
  innerRadius: number; outerRadius: number
  startAngle: number; endAngle: number
  cornerRadius: number; padAngle: number
}

const HUGE_FACTOR = 6 // huge_R = HUGE_FACTOR * max chart dim

/**
 * Build a giant-arc state that, at t=0, visually equals the rect.
 *
 * Place the giant circle's center perpendicular to the rect's LONGER side,
 * far on the side away from the chart center. This way the rect's longer
 * side aligns with the arc's tangent (so at t=0 the arc looks like a
 * screen-axis-aligned rectangle, not a tilted sliver).
 *
 * The longer side becomes the arc's angular sweep (length / R, tiny). The
 * shorter side becomes the radial thickness (outerR − innerR).
 *
 * Mid-angle aims toward the chart center so the swoop direction reads as
 * "rect → center" in screen space.
 */
function giantArcFromRect(
  rectScreenX: number, rectScreenY: number,
  rectW: number, rectH: number,
  chartCx: number, chartCy: number,
  cornerRadius: number, padAngle: number,
  chartMaxDim: number,
): ArcState {
  const rcx = rectScreenX + rectW / 2
  const rcy = rectScreenY + rectH / 2
  const hugeR = HUGE_FACTOR * chartMaxDim

  // Pick which axis is "tangent" (parallel to longer side). For wide rects
  // (w >= h) the tangent is horizontal; the giant circle center sits VERTICALLY
  // above or below the rect. For tall rects (h > w) the tangent is vertical;
  // the giant circle center sits horizontally to the left or right.
  const isWide = rectW >= rectH
  const tangentLength = isWide ? rectW : rectH
  const radialThickness = isWide ? rectH : rectW

  // u = unit direction from giant center → rect center. We want this u to
  // point AWAY from the chart center (so the rect's "near-chart-center" edge
  // becomes the outer rim of the giant arc).
  let ux: number, uy: number
  if (isWide) {
    // Center sits vertically. Pick the side opposite the chart center.
    uy = chartCy >= rcy ? -1 : 1
    ux = 0
  } else {
    // Center sits horizontally. Pick the side opposite the chart center.
    ux = chartCx >= rcx ? -1 : 1
    uy = 0
  }
  const gcx = rcx - ux * hugeR
  const gcy = rcy - uy * hugeR

  // Mid-angle: direction from giant center to rect center, in d3 convention.
  // (ux, uy) is that direction. d3 angle: atan2(sin θ, −cos θ) where (sin θ,
  // −cos θ) = (ux, uy).
  const midAngle = Math.atan2(ux, -uy)
  const sweep = tangentLength / hugeR

  return {
    cx: gcx,
    cy: gcy,
    outerRadius: hugeR,
    innerRadius: hugeR - radialThickness,
    startAngle: midAngle - sweep / 2,
    endAngle: midAngle + sweep / 2,
    cornerRadius,
    padAngle,
  }
}

const arcStateGen = arc<unknown, ArcState>()
  .innerRadius(d => d.innerRadius)
  .outerRadius(d => d.outerRadius)
  .startAngle(d => d.startAngle)
  .endAngle(d => d.endAngle)
  .cornerRadius(d => d.cornerRadius)
  .padAngle(d => d.padAngle)

/** Per-frame morph result: SVG path d (relative to atom group) + group translate. */
export interface MorphFrame {
  d: string
  transform: string
}

/**
 * Build a tween between two arc states (giant or real).
 *  At t=0, returns `from`. At t=1, returns `to`. Linear lerp on all params.
 * Group transform is translate(lerp(from.cx, to.cx), lerp(from.cy, to.cy)).
 */
function arcStateTween(from: ArcState, to: ArcState) {
  return (t: number): MorphFrame => {
    const lerp = (a: number, b: number) => a + (b - a) * t
    const s: ArcState = {
      cx: lerp(from.cx, to.cx),
      cy: lerp(from.cy, to.cy),
      innerRadius: Math.max(0, lerp(from.innerRadius, to.innerRadius)),
      outerRadius: Math.max(0.01, lerp(from.outerRadius, to.outerRadius)),
      startAngle: lerp(from.startAngle, to.startAngle),
      endAngle: lerp(from.endAngle, to.endAngle),
      cornerRadius: lerp(from.cornerRadius, to.cornerRadius),
      padAngle: lerp(from.padAngle, to.padAngle),
    }
    return {
      d: arcStateGen(s) ?? '',
      transform: `translate(${s.cx},${s.cy})`,
    }
  }
}

/**
 * Rect → arc using the reel's exact schedule, generalized per atom.
 *
 * Schedule (matches /tmp/pen_d3_3.js arcTween almost verbatim):
 *   a = cos(t · π/2)               // 1 at t=0, 0 at t=1; smooth at endpoints
 *   r = arc.outerRadius / max(t, ε)  // hyperbolic: ∞ at t=0, outerR at t=1
 * Everything else cosine-blends via `a` between the rect-derived "giant" state
 * and the real arc state. Center, angles, radial thickness all lerp in lock-
 * step with `a` so every frame is a real arc that visually smoothly morphs.
 *
 * Per-atom geometry: the giant circle's center sits perpendicular to the
 * rect's longer side, far on the side opposite the chart center. So at t=0
 * the rect's longer side aligns with the arc's tangent → the arc visually
 * equals a screen-axis-aligned rect. As r shrinks the arc swoops toward the
 * chart center and rotates into its slice angle.
 */
export function rectToArcReel(
  rectScreenX: number, rectScreenY: number, rect: RectParams,
  arcChartCx: number, arcChartCy: number, arc: ArcParams,
  chartMaxDim: number,
) {
  const rcx = rectScreenX + rect.w / 2
  const rcy = rectScreenY + rect.h / 2
  const isWide = rect.w >= rect.h
  const tangentLength = isWide ? rect.w : rect.h
  const radialThickness = isWide ? rect.h : rect.w
  let ux: number, uy: number
  if (isWide) {
    uy = arcChartCy >= rcy ? -1 : 1
    ux = 0
  } else {
    ux = arcChartCx >= rcx ? -1 : 1
    uy = 0
  }
  const giantMidAngle = Math.atan2(ux, -uy)
  const finalThickness = arc.outerRadius - arc.innerRadius

  const halfPerp = (isWide ? rect.h : rect.w) / 2
  // Cap r so giant-circle coordinates stay within ~6× chart size.
  // Without this cap, r → ∞ as t → 0, causing SVG precision failures
  // and elements appearing to fly in from off-screen.
  const maxR = Math.max(arc.outerRadius * 20, chartMaxDim > 0 ? chartMaxDim * 6 : 1000)

  return (t: number): MorphFrame => {
    // At t=1 return exact arc state — avoids the giant-arc snap artifact
    // that occurs when the last tween frame fires just before on('end').
    if (t >= 1) return {
      d: arcPath(arc),
      transform: `translate(${arcChartCx},${arcChartCy})`,
    }
    const a = Math.cos(t * Math.PI / 2)
    const blend = (giant: number, real: number) => a * giant + (1 - a) * real

    const r = Math.min(arc.outerRadius / Math.max(t, 1e-3), maxR)

    const offset = r - halfPerp
    const giantCx = rcx - ux * offset
    const giantCy = rcy - uy * offset
    const giantSweep = tangentLength / r
    const giantStart = giantMidAngle - giantSweep / 2
    const giantEnd = giantMidAngle + giantSweep / 2

    const cx = blend(giantCx, arcChartCx)
    const cy = blend(giantCy, arcChartCy)
    const thickness = blend(radialThickness, finalThickness)
    const startAngle = blend(giantStart, arc.startAngle)
    const endAngle = blend(giantEnd, arc.endAngle)
    const cornerRadius = blend(rect.rx, arc.cornerRadius)
    const padAngle = blend(0, arc.padAngle)

    const s: ArcState = {
      cx, cy,
      innerRadius: Math.max(0, r - thickness),
      outerRadius: Math.max(0.01, r),
      startAngle, endAngle,
      cornerRadius,
      padAngle,
    }
    return {
      d: arcStateGen(s) ?? '',
      transform: `translate(${cx},${cy})`,
    }
  }
}

/** Arc → rect: same as rectToArcReel but reversed in t. */
export function arcToRectReel(
  arcChartCx: number, arcChartCy: number, arc: ArcParams,
  rectScreenX: number, rectScreenY: number, rect: RectParams,
  chartMaxDim: number,
) {
  const fwd = rectToArcReel(rectScreenX, rectScreenY, rect, arcChartCx, arcChartCy, arc, chartMaxDim)
  return (t: number): MorphFrame => {
    // At t=1 return exact rect state — avoids the giant-arc snap artifact
    if (t >= 1) return {
      d: rectPath({ x: 0, y: 0, w: rect.w, h: rect.h, rx: rect.rx }),
      transform: `translate(${rectScreenX},${rectScreenY})`,
    }
    return fwd(1 - t)
  }
}

/**
 * Rect ↔ rect across modes (treemap ↔ bands): lerp rect params and origin
 * directly, render via rectPath. Group transform = translate to current
 * screen origin.
 */
export function rectToRectScreen(
  fromX: number, fromY: number, fromR: RectParams,
  toX: number, toY: number, toR: RectParams,
) {
  return (t: number): MorphFrame => {
    const lerp = (a: number, b: number) => a + (b - a) * t
    const rp: RectParams = {
      x: 0, y: 0,
      w: lerp(fromR.w, toR.w),
      h: lerp(fromR.h, toR.h),
      rx: lerp(fromR.rx, toR.rx),
    }
    return {
      d: rectPath(rp),
      transform: `translate(${lerp(fromX, toX)},${lerp(fromY, toY)})`,
    }
  }
}

/** Arc → arc: interpolate angles + radii (used inside radial mode). */
export function arcToArcTween(from: ArcParams, to: ArcParams) {
  const iStart = interpolate(from.startAngle, to.startAngle)
  const iEnd = interpolate(from.endAngle, to.endAngle)
  const iInner = interpolate(from.innerRadius, to.innerRadius)
  const iOuter = interpolate(from.outerRadius, to.outerRadius)
  const iPad = interpolate(from.padAngle, to.padAngle)
  const iCorner = interpolate(from.cornerRadius, to.cornerRadius)
  return (t: number): string =>
    arcPath({
      startAngle: iStart(t),
      endAngle: iEnd(t),
      innerRadius: iInner(t),
      outerRadius: iOuter(t),
      padAngle: iPad(t),
      cornerRadius: iCorner(t),
    })
}

export function shapeKind(g: AtomGeometry): 'rect' | 'arc' {
  return g.arcParams ? 'arc' : 'rect'
}
