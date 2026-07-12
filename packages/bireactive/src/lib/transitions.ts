// Single source of truth for in-view transition timing across all charts
// (Interaction Principle 10). Role-specific durations are explicit multipliers
// of TRANSITION_BASE_MS — coherent rhythm from one tunable root.
//
// Decision: CSS transitions over tween cells. See wiki/transitions-decision.md.

export const TRANSITION_BASE_MS = 100;
export const TRANSITION_EASING = "cubic-bezier(0.4, 0.0, 0.2, 1)"; // ease-in-out

/** Mark enter/exit windows (WIN-155). Not multipliers — enter/exit is a fixed
 *  fade window, not a rhythm role. Charts fade marks in from opacity 0 on first
 *  render (CSS) and hold them visible for EXIT_MS on removal via
 *  `withExitDelay` before evicting. */
export const ENTER_MS = 400;
export const EXIT_MS = 400;

// Role multipliers. Keep these as multipliers (not raw ms) so the base rhythm
// can be tuned in one place. Names match interaction-principles.md vocabulary.
export const TRANSITION_DURATION = {
  /** Value-change settle (Part 2): bar height, slice radius, etc. */
  settle: 2.5 * TRANSITION_BASE_MS,        // 250ms
  /** Reorder slide (Part 3): item moves to new slot position. */
  reorder: 2.5 * TRANSITION_BASE_MS,       // 250ms
  /** Hover/select micro-feedback (was inline 0.1s / 0.12s — kept identical). */
  hover: 1.0 * TRANSITION_BASE_MS,          // 100ms
  /** Highlight rect sliding between columns/rows. */
  highlight: 1.5 * TRANSITION_BASE_MS,      // 150ms
  /** Drill in/out zoom (Part 5 placeholder). */
  drill: 3.0 * TRANSITION_BASE_MS,          // 300ms
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

/** Class name for global gestures (WIN-300). Used by cross-component gesture
 *  coordination (e.g., table value drags) to signal all charts to freeze sort.
 *  Separate from GESTURE_ACTIVE_CLASS to avoid conflicts with local gestures. */
export const GESTURE_ACTIVE_GLOBAL_CLASS = "vf-gesture-active-global";

/** CSS that disables `transition` on every descendant while a gesture is live.
 *  Inject once per chart `static styles`. Covers BOTH local and global gestures. */
export const GESTURE_SUPPRESSION_CSS = `:host(.${GESTURE_ACTIVE_CLASS}) * { transition: none !important; } :host(.${GESTURE_ACTIVE_GLOBAL_CLASS}) * { transition: none !important; }`;

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
