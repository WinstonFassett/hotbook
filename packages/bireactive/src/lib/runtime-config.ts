// Runtime-tunable design defaults (WIN-352). Live bireactive cells for
// motion / animation timing. Bump a cell here → every consumer that
// reads `.value` at call-time sees the new number on the next frame.
//
// Five motion categories, five cells, zero multipliers. See
// wiki/transition-timing.md for the canonical reference.
//
// Apps wire these to a lil-gui panel; the cells themselves know nothing
// about the UI. Ephemeral by design — no persistence in wave 1.

import { cell, type Writable, type Cell } from "bireactive";

export interface MotionCells {
  /** Hover/focus micro-feedback — stroke, opacity, highlight rect. */
  hoverMs: Writable<Cell<number>>;
  /** Post-commit settle — value change, resize, sort reorder, layout reflow. */
  settleMs: Writable<Cell<number>>;
  /** Hierarchical drill navigation — zoom in/out. */
  drillMs: Writable<Cell<number>>;
  /** Mark appear — fade in on first render or filter-in. */
  enterMs: Writable<Cell<number>>;
  /** Mark disappear — fade out before eviction. */
  exitMs: Writable<Cell<number>>;
  /** Sort / measure-swap / reorder tween duration for anim-clock charts. */
  sortSec: Writable<Cell<number>>;
  /** Visual separation between hierarchical marks (px). Drives sunburst
   *  arc stroke width, treemap paddingInner/Outer, pack border thickness,
   *  icicle gaps. One value, all hierarchical charts. */
  separation: Writable<Cell<number>>;
}

export const MOTION_DEFAULTS = {
  hoverMs: 100,
  settleMs: 250,
  drillMs: 300,
  enterMs: 400,
  exitMs: 400,
  sortSec: 0.35,
  separation: 1,
} as const;

export const motion: MotionCells = {
  hoverMs: cell<number>(MOTION_DEFAULTS.hoverMs),
  settleMs: cell<number>(MOTION_DEFAULTS.settleMs),
  drillMs: cell<number>(MOTION_DEFAULTS.drillMs),
  enterMs: cell<number>(MOTION_DEFAULTS.enterMs),
  exitMs: cell<number>(MOTION_DEFAULTS.exitMs),
  sortSec: cell<number>(MOTION_DEFAULTS.sortSec),
  separation: cell<number>(MOTION_DEFAULTS.separation),
};

export function resetMotionToDefaults(): void {
  motion.hoverMs.value = MOTION_DEFAULTS.hoverMs;
  motion.settleMs.value = MOTION_DEFAULTS.settleMs;
  motion.drillMs.value = MOTION_DEFAULTS.drillMs;
  motion.enterMs.value = MOTION_DEFAULTS.enterMs;
  motion.exitMs.value = MOTION_DEFAULTS.exitMs;
  motion.sortSec.value = MOTION_DEFAULTS.sortSec;
  motion.separation.value = MOTION_DEFAULTS.separation;
}
