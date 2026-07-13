import { cell, derive } from "bireactive";
import { TRANSITION_DURATION } from "./transitions";

export type GesturePhase = "idle" | "gesturing" | "settling";

const _state = cell<GesturePhase>("idle");
let settleTimer: ReturnType<typeof setTimeout> | null = null;

function clearSettleTimer() {
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
}

/** Move the global state machine into `gesturing`.
 *  Interrupts a pending `settling` if the user starts a new gesture. */
export function startGesture(): void {
  clearSettleTimer();
  _state.value = "gesturing";
}

/** Commit the current gesture: move to `settling` and return to `idle`
 *  after the longest structural transition (reorder) has had time to finish.
 *  A new gesture can interrupt this at any time. */
export function commitGesture(): void {
  clearSettleTimer();
  _state.value = "settling";
  settleTimer = setTimeout(() => {
    settleTimer = null;
    _state.value = "idle";
  }, TRANSITION_DURATION.reorder);
}

/** Cancel the current gesture: revert and return immediately to `idle`. */
export function cancelGesture(): void {
  clearSettleTimer();
  _state.value = "idle";
}

/** Reactive source of truth for the global gesture state machine.
 *  `idle` → `gesturing` → `settling` → `idle`. */
export const gestureState = _state;

/** True only while the machine is in `gesturing` — i.e. a live user gesture
 *  (drag, wheel, numberDrag, keyboard nudge) is in progress. This is NOT true
 *  during `settling`, so autonomous transitions can still play. */
export const globalGestureActive = derive(() => _state.value === "gesturing");
