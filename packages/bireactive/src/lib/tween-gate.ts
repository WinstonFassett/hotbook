import { type Num, type Writable, tween, easeOut, type Easing, type Anim } from "bireactive";
import { GESTURE_ACTIVE_CLASS } from "./transitions";

/**
 * Shared timing constant for structural value changes (sort/measure swap/reorder).
 * WIN-288-1: All charts use this token so tween durations stay consistent.
 */
export const SORT_SEC = 0.35;

/**
 * Snap-vs-tween gate for structural value changes.
 *
 * If the value change is structural (sort, measure swap, reorder commit, orientation change)
 * AND the host is not gesture-active, tween. Otherwise snap.
 *
 * "Structural" means the layout's ordering or grouping changed, requiring a smooth
 * transition so users can track what moved where. Non-structural changes (value edits,
 * resizes, active drags) snap immediately for real-time responsiveness.
 *
 * @param opts.cell - The reactive cell to update (must be writable, e.g. from num())
 * @param opts.target - The new target value
 * @param opts.structural - Whether this change is structural (sort/measure/orientation/reorder)
 * @param opts.host - The host element to check for GESTURE_ACTIVE_CLASS
 * @param opts.anim - The animation clock to drive the tween
 * @param opts.duration - Tween duration in seconds (default: SORT_SEC)
 * @param opts.easing - Easing function (default: easeOut)
 * @returns A cancel function for the tween, or null if snapped
 */
export function applyWithTweenGate(opts: {
  cell: Writable<Num>;
  target: number;
  structural: boolean;
  host: HTMLElement;
  anim: Anim;
  duration?: number;
  easing?: Easing;
}): (() => void) | null {
  const {
    cell,
    target,
    structural,
    host,
    anim,
    duration = SORT_SEC,
    easing = easeOut,
  } = opts;

  if (structural && !host.classList.contains(GESTURE_ACTIVE_CLASS)) {
    return anim.start(tween(cell, target, duration, easing));
  } else {
    cell.value = target;
    return null;
  }
}

/**
 * Batch version of applyWithTweenGate for multiple cells.
 * Returns a combined cancel function.
 */
export function applyMultiWithTweenGate(opts: {
  updates: Array<{ cell: Writable<Num>; target: number }>;
  structural: boolean;
  host: HTMLElement;
  anim: Anim;
  duration?: number;
  easing?: Easing;
}): (() => void) | null {
  const { updates, structural, host, anim, duration = SORT_SEC, easing = easeOut } = opts;

  if (structural && !host.classList.contains(GESTURE_ACTIVE_CLASS)) {
    const generators = updates.map(({ cell, target }) => tween(cell, target, duration, easing));
    return anim.start(...generators);
  } else {
    updates.forEach(({ cell, target }) => {
      cell.value = target;
    });
    return null;
  }
}
