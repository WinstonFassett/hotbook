// Runtime-tunable design defaults (WIN-352). Live bireactive cells for
// motion / animation timing. Bump a cell here → every consumer that
// reads `.value` at call-time sees the new number on the next frame.
//
// Three cells, no multipliers. See wiki/transition-timing.md for the
// canonical reference.
//
// Apps wire these to a lil-gui panel; the cells themselves know nothing
// about the UI. Ephemeral by design — no persistence in wave 1.

import { cell, type Writable, type Cell } from "bireactive";

export interface MotionCells {
  /** Hover/focus micro-feedback — stroke, opacity, highlight rect tracking
   *  cursor. Distinct nature (direct manipulation feedback), own cell. */
  hoverMs: Writable<Cell<number>>;
  /** All layout and fade transitions — drill, config change (sort/measure/
   *  depth), value-commit, mark enter/exit. One cell, no multipliers. */
  motionMs: Writable<Cell<number>>;
  /** Visual separation between hierarchical marks (px). Drives sunburst
   *  arc stroke width, treemap paddingInner/Outer, pack border thickness,
   *  icicle gaps. One value, all hierarchical charts. */
  separation: Writable<Cell<number>>;
}

export const MOTION_DEFAULTS = {
  hoverMs: 100,
  motionMs: 300,
  separation: 1,
} as const;

export const motion: MotionCells = {
  hoverMs: cell<number>(MOTION_DEFAULTS.hoverMs),
  motionMs: cell<number>(MOTION_DEFAULTS.motionMs),
  separation: cell<number>(MOTION_DEFAULTS.separation),
};

export function resetMotionToDefaults(): void {
  motion.hoverMs.value = MOTION_DEFAULTS.hoverMs;
  motion.motionMs.value = MOTION_DEFAULTS.motionMs;
  motion.separation.value = MOTION_DEFAULTS.separation;
}
