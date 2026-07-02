/**
 * global-gesture-state.ts — Coordinate gesture-active class across all charts.
 *
 * When wheelController or dragController is active, ALL charts should suppress
 * settle transitions (not just the one being edited), because value changes
 * flow to dependent charts and should update immediately during direct manipulation
 * (Interaction Principle 3: real-time feedback).
 *
 * The local chart's own gestureActive flag stays — it's still needed for
 * per-chart hit-testing and hover behavior. This module adds the GLOBAL signal
 * so settle transitions suppress everywhere when ANY chart is being edited.
 */

import { GESTURE_ACTIVE_CLASS } from "./transitions";
import { wheelController, dragController } from "./interaction";

/**
 * Set of all mounted chart elements. When global gesture state changes,
 * we toggle the class on every registered chart.
 */
const charts = new Set<HTMLElement>();

let lastActive = false;
let pollIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Poll global controllers and sync the gesture-active class on all charts.
 * Checks every animation frame while charts are mounted.
 */
function poll() {
  const active = wheelController.active || dragController.active;
  if (active === lastActive) return;
  lastActive = active;
  for (const el of charts) {
    el.classList.toggle(GESTURE_ACTIVE_CLASS, active);
  }
}

/**
 * Start polling if not already running.
 */
function startPolling() {
  if (pollIntervalId !== null) return;
  // Poll at 60fps (every ~16ms) to catch gesture state changes quickly.
  pollIntervalId = setInterval(poll, 16);
}

/**
 * Stop polling when no charts are registered.
 */
function stopPolling() {
  if (pollIntervalId === null) return;
  clearInterval(pollIntervalId);
  pollIntervalId = null;
}

/**
 * Register a chart element for global gesture-active class sync.
 * Returns a dispose function to unregister on unmount.
 *
 * Call this once in each chart's scene() after the element is connected.
 */
export function trackGlobalGesture(el: HTMLElement): () => void {
  charts.add(el);
  // Seed current state immediately (in case a gesture is already live).
  el.classList.toggle(GESTURE_ACTIVE_CLASS, wheelController.active || dragController.active);

  // Start polling when the first chart registers.
  if (charts.size === 1) {
    startPolling();
  }

  return () => {
    charts.delete(el);
    // Clean up the class on unregister so orphaned elements don't keep it.
    el.classList.remove(GESTURE_ACTIVE_CLASS);

    // Stop polling when the last chart unregisters.
    if (charts.size === 0) {
      stopPolling();
      lastActive = false;
    }
  };
}
