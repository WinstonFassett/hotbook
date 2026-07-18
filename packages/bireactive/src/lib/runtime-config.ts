// Runtime-tunable design defaults (WIN-352). Live bireactive cells for
// motion / animation timing that used to be plain `const`s scattered across
// transitions.ts and per-chart files. Bump a cell here → every consumer that
// reads `.value` at call-time sees the new number on the next frame.
//
// Apps wire these to a lil-gui panel; the cells themselves know nothing
// about the UI. Ephemeral by design — no persistence in wave 1.

import { cell, type Writable, type Cell } from "bireactive";

export interface MotionCells {
  /** Master rhythm unit — the multiplier basis for TRANSITION_DURATION roles. */
  baseMs: Writable<Cell<number>>;
  /** Mark enter fade window. */
  enterMs: Writable<Cell<number>>;
  /** Mark exit lingering window before eviction. */
  exitMs: Writable<Cell<number>>;
  /** Sort / measure-swap / reorder tween duration for anim-clock charts. */
  sortSec: Writable<Cell<number>>;
  /** Drill-in/out leave-timer for hierarchical charts. */
  drillMs: Writable<Cell<number>>;
  /** Visual separation between hierarchical marks (px). Drives sunburst
   *  arc stroke width, treemap paddingInner/Outer, pack border thickness,
   *  icicle gaps. One value, all hierarchical charts. */
  separation: Writable<Cell<number>>;
}

export const MOTION_DEFAULTS = {
  baseMs: 100,
  enterMs: 400,
  exitMs: 400,
  sortSec: 0.35,
  drillMs: 300,
  separation: 1,
} as const;

export const motion: MotionCells = {
  baseMs: cell<number>(MOTION_DEFAULTS.baseMs),
  enterMs: cell<number>(MOTION_DEFAULTS.enterMs),
  exitMs: cell<number>(MOTION_DEFAULTS.exitMs),
  sortSec: cell<number>(MOTION_DEFAULTS.sortSec),
  drillMs: cell<number>(MOTION_DEFAULTS.drillMs),
  separation: cell<number>(MOTION_DEFAULTS.separation),
};

export function resetMotionToDefaults(): void {
  motion.baseMs.value = MOTION_DEFAULTS.baseMs;
  motion.enterMs.value = MOTION_DEFAULTS.enterMs;
  motion.exitMs.value = MOTION_DEFAULTS.exitMs;
  motion.sortSec.value = MOTION_DEFAULTS.sortSec;
  motion.drillMs.value = MOTION_DEFAULTS.drillMs;
  motion.separation.value = MOTION_DEFAULTS.separation;
}
