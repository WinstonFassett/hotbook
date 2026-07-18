// Single source of truth for transition timing across all charts.
// Five motion categories, five cells, zero multipliers. See
// wiki/transition-timing.md for the canonical reference.
//
// Decision: CSS transitions over tween cells. See wiki/transitions-decision.md.

import { motion } from "./runtime-config";

export const TRANSITION_EASING = "cubic-bezier(0.4, 0.0, 0.2, 1)"; // ease-in-out

// Direct cell reads — no multipliers, no magic numbers. Each duration is
// independently tunable via the tweaks pane.
export const TRANSITION_DURATION = {
  /** Hover/focus micro-feedback. */
  get hover()  { return motion.hoverMs.value; },
  /** Post-commit settle (value change, resize, sort reorder). */
  get settle() { return motion.settleMs.value; },
  /** Hierarchical drill navigation. */
  get drill()  { return motion.drillMs.value; },
  /** Mark appear (fade in). */
  get enter()  { return motion.enterMs.value; },
  /** Mark disappear (fade out before eviction). */
  get exit()   { return motion.exitMs.value; },
} as const;

/** True when the user has asked for reduced motion. Reactive (gesture-driven)
 *  motion ignores this; autonomous transitions (settle/drill) must
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
