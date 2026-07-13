import * as d3 from 'd3-ease'

export const DEFAULT_SIZE = 5

// Timing tokens aligned with bireactive (packages/bireactive/src/lib/transitions.ts).
// Role-based durations derive from a single source of truth (Interaction Principle 10).
export const DUR = 350            // settle/sort baseline (was 380)
export const REORDER_DUR = 350    // reorder (was 220, now matches settle)
export const EXIT_DUR = 400       // exit fade (was 200, now matches bireactive)
export const EASE = d3.easeExpOut

// ---------- Motion tokens (PowerView) ----------
//
// Three roles, asymmetric: enter/exit use ease-out (responsive); on-screen
// movement uses ease-in-out (gentle attack + settle). Built-in CSS-style
// easings feel weak — we use d3-ease equivalents of strong custom curves.

export const DUR_MOVE = 800       // drill/zoom (was 600, now matches bireactive DRILL)
export const DUR_ENTER = 400      // enter fade (was 380, now matches bireactive)
export const DUR_EXIT = 400       // exit fade (was 240, now matches bireactive)

// Shape = the curve formula. Direction = where the deceleration is.
// User picks shape; we choose direction per role (movement = inOut, since
// the element starts at rest and lands at rest; enter/exit = out, since the
// element responds to a discrete trigger).

export type EaseShape = 'linear' | 'sin' | 'quad' | 'cubic' | 'poly' | 'exp'
export type EaseDirection = 'in' | 'out' | 'inOut'

const EASE_TABLE: Record<EaseShape, Record<EaseDirection, (t: number) => number>> = {
  linear: { in: d3.easeLinear, out: d3.easeLinear, inOut: d3.easeLinear },
  sin: { in: d3.easeSinIn, out: d3.easeSinOut, inOut: d3.easeSinInOut },
  quad: { in: d3.easeQuadIn, out: d3.easeQuadOut, inOut: d3.easeQuadInOut },
  cubic: { in: d3.easeCubicIn, out: d3.easeCubicOut, inOut: d3.easeCubicInOut },
  poly: { in: d3.easePolyIn, out: d3.easePolyOut, inOut: d3.easePolyInOut },
  exp: { in: d3.easeExpIn, out: d3.easeExpOut, inOut: d3.easeExpInOut },
}

export type MotionRole = 'move' | 'enter' | 'exit'

export interface MotionSpec {
  duration: number
  ease: (t: number) => number
  /** Peak inward scale during a move. 1 = no explode, 0.9 = pulse to 90%. */
  explodeMin: number
}

export function motion(
  role: MotionRole,
  scale = 1,
  shape: EaseShape = 'cubic',
  explodeAmount = 0,
): MotionSpec {
  const base = role === 'move' ? DUR_MOVE : role === 'enter' ? DUR_ENTER : DUR_EXIT
  const dir: EaseDirection = role === 'move' ? 'inOut' : 'out'
  const ease = EASE_TABLE[shape][dir]
  return {
    duration: Math.max(0, Math.round(base * scale)),
    ease,
    explodeMin: 1 - Math.max(0, Math.min(0.5, explodeAmount)),
  }
}

/** Pulse 0 → 1 → 0 over t∈[0,1], peaking at midpoint. Smooth (sin-shaped). */
export function explodePulse(t: number): number {
  return Math.sin(t * Math.PI)
}

// Treemap
export const MIN_LABEL_W = 72
export const MIN_LABEL_H = 48

// Radial
export const PAD_ANGLE = 0.022
export const MIN_ARC_ANGLE = 0.32
export const MIN_NUMBER_ANGLE = 0.12

// Bands
export const ROW_H = 36
export const ROW_GAP = 10
export const ROW_STEP = ROW_H + ROW_GAP
export const LEFT_PAD = 24
export const RIGHT_PAD = 28
export const TOP_PAD = 28
export const RANK_W = 28
export const META_GAP = 8
export const NAME_W = 148
export const TRACK_GAP = 16
export const HANDLE_HIT_W = 16
export const HANDLE_VIS_W = 4
export const HANDLE_VIS_H = 22
