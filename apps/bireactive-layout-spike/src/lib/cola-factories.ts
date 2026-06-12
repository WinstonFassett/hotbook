// New constraint factories for IPSepCoLa-style layout, built on
// bireactive's existing `generic()` term (custom residual function).
//
// These are spike-local; if useful, lift to a bireactive-cola or
// bireactive-extensions package later.
//
//   separation(a, b, axis, gap)  — a.<axis> + gap ≤ b.<axis>
//   rectNonOverlap(a, b, halfW, halfH) — pairwise hard AABB non-overlap

import type { Relation } from "@bireactive/constraints";
import { generic } from "@bireactive/constraints";
import type { Cell, Writable } from "@bireactive";

type Vec2 = Writable<Cell<{ x: number; y: number }>>;

/** Axis-aligned separation: `a.<axis> + gap ≤ b.<axis>`.
 *  Hard inequality — `lambdaMax: [0]` clamps the dual so the constraint
 *  only ever pushes apart, never together. */
export function separation(a: Vec2, b: Vec2, axis: "x" | "y", gap: number): Relation {
  const k = axis === "x" ? 0 : 1;
  return generic(
    [a, b],
    1,
    (pos, out) => {
      // residual ≥ 0 means satisfied. b[k] - a[k] - gap.
      out[0]! = pos[1]![k]! - pos[0]![k]! - gap;
    },
    { lambdaMax: [0] },
  );
}

/** Hard axis-aligned rectangle non-overlap: the smaller of the four
 *  separating axes is the one to push along. Encoded as a single
 *  residual that returns the *maximum* of the four "satisfied" gaps;
 *  if any one of them is positive the rects don't overlap.
 *
 *  This is a simpler formulation than CoLa's full RVO projection — it
 *  picks one axis at a time and lets the AVBD solver iterate. Works
 *  fine for small demos; the production version would project onto the
 *  closest separating axis explicitly. */
export function rectNonOverlap(a: Vec2, b: Vec2, halfW: number, halfH: number): Relation {
  return generic(
    [a, b],
    1,
    (pos, out) => {
      const ax = pos[0]![0]!;
      const ay = pos[0]![1]!;
      const bx = pos[1]![0]!;
      const by = pos[1]![1]!;
      const dx = Math.abs(bx - ax);
      const dy = Math.abs(by - ay);
      // satisfied if dx ≥ 2*halfW OR dy ≥ 2*halfH.
      // residual = max of the two slacks (positive when separated on
      // at least one axis).
      const sx = dx - 2 * halfW;
      const sy = dy - 2 * halfH;
      out[0]! = Math.max(sx, sy);
    },
    { lambdaMax: [0] },
  );
}

/** Anchor a cell to a target on one axis only (the other stays free).
 *  Useful for axis-aligned flow layouts. */
export function pinAxis(a: Vec2, axis: "x" | "y", value: number, stiffness: number): Relation {
  const k = axis === "x" ? 0 : 1;
  return generic(
    [a],
    1,
    (pos, out) => {
      out[0]! = pos[0]![k]! - value;
    },
    { hard: false, stiffness },
  );
}
