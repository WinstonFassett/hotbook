// Single source of truth for in-view transition timing across all charts
// (Interaction Principle 10). Role-specific durations are explicit multipliers
// of the master rhythm — coherent rhythm from one tunable root.
//
// The rhythm root and enter/exit windows are LIVE cells (see runtime-config.ts,
// WIN-352). `TRANSITION_BASE_MS` / `ENTER_MS` / `EXIT_MS` remain named exports
// for callers that read a raw number at draw-time; they are `export let`
// live bindings kept in sync with the underlying cells via `effect`.
//
// Decision: CSS transitions over tween cells. See wiki/transitions-decision.md.

import { effect } from "bireactive";
import { motion } from "./runtime-config";

export const TRANSITION_EASING = "cubic-bezier(0.4, 0.0, 0.2, 1)"; // ease-in-out

/** Master rhythm (ms). Live-bound to `motion.baseMs`. */
export let TRANSITION_BASE_MS = motion.baseMs.value;

/** Mark enter/exit windows (WIN-155). Not multipliers — enter/exit is a fixed
 *  fade window, not a rhythm role. Charts fade marks in from opacity 0 on first
 *  render (CSS) and hold them visible for EXIT_MS on removal via
 *  `withExitDelay` before evicting. */
export let ENTER_MS = motion.enterMs.value;
export let EXIT_MS = motion.exitMs.value;

effect(() => { TRANSITION_BASE_MS = motion.baseMs.value; });
effect(() => { ENTER_MS = motion.enterMs.value; });
effect(() => { EXIT_MS = motion.exitMs.value; });

// Role multipliers — getters so any consumer sees the live base value.
// Names match interaction-principles.md vocabulary.
export const TRANSITION_DURATION = {
  /** Value-change settle (Part 2): bar height, slice radius, etc. */
  get settle()    { return 2.5 * motion.baseMs.value; },
  /** Reorder slide (Part 3): item moves to new slot position. */
  get reorder()   { return 2.5 * motion.baseMs.value; },
  /** Hover/select micro-feedback (was inline 0.1s / 0.12s — kept identical). */
  get hover()     { return 1.0 * motion.baseMs.value; },
  /** Highlight rect sliding between columns/rows. */
  get highlight() { return 1.5 * motion.baseMs.value; },
  /** Drill in/out zoom — independent of baseMs (navigation, not settle).
   *  Driven by motion.drillMs directly so the tweaks pane knob works. */
  get drill()     { return motion.drillMs.value; },
} as const;

/** True when the user has asked for reduced motion. Reactive (gesture-driven)
 *  motion ignores this; autonomous transitions (settle/reorder/drill) must
 *  respect it (Interaction Principle 9). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Compose a CSS `transition` shorthand for one or more properties on the
 *  settle rhythm. Returns "none" under reduced motion so autonomous transitions
 *  vanish without further plumbing at call sites. */
export function settleTransition(properties: string | readonly string[]): string {
  if (prefersReducedMotion()) return "none";
  const props = typeof properties === "string" ? [properties] : properties;
  return props.map(p => `${p} ${TRANSITION_DURATION.settle}ms ${TRANSITION_EASING}`).join(", ");
}

export function hoverTransition(properties: string | readonly string[]): string {
  const props = typeof properties === "string" ? [properties] : properties;
  return props.map(p => `${p} ${TRANSITION_DURATION.hover}ms ${TRANSITION_EASING}`).join(", ");
}

/** Reactive class name used by charts to suppress autonomous transitions while
 *  a gesture is active. Apply via `el.classList.toggle(GESTURE_ACTIVE_CLASS, ...)`
 *  on the chart host; pair with the CSS rule emitted by `gestureSuppressionCss`. */
export const GESTURE_ACTIVE_CLASS = "vf-gesture-active";

/** CSS that disables `transition` on every descendant while a gesture is live.
 *  Inject once per chart `static styles`. */
export const GESTURE_SUPPRESSION_CSS = `:host(.${GESTURE_ACTIVE_CLASS}) * { transition: none !important; }`;

/** Centralized visual affordance for the dragged mark during a reorder gesture
 *  (WIN-262). The `attachReorderGesture` helper toggles `[data-reordering]` on
 *  the dragged element; charts inject this CSS in their `static styles` so
 *  every chart gets the same drop-shadow lift without per-chart duplication.
 *  SVG `filter` renders drop-shadow correctly for `<path>` / `<rect>` / `<g>`. */
export const REORDER_ELEVATION_CSS = `
  [data-reordering] {
    filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.45));
    cursor: grabbing !important;
  }
`;
