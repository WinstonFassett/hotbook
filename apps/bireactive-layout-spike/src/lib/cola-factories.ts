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

export interface SidePad {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** GROUP non-overlap: hard AABB separation between two GROUPs, where
 *  each GROUP is represented by the bbox of its leaf positions plus a
 *  uniform leaf half-size and a per-side padding `inflate`. Both bboxes
 *  are computed *inside* the residual from the live leaf positions, so
 *  the constraint stays in sync as leaves move — no separate solver
 *  variable for the bbox itself.
 *
 *  The `inflate` parameter is the GROUP's chrome (chip + side + bottom
 *  padding). The constraint and the rendered hull must agree on this
 *  value or you get visible overlap of chrome-on-chrome.
 *
 *  Residual encoding mirrors rectNonOverlap: positive when the two
 *  group rects are separated on at least one axis. */
export function groupNonOverlap(
  leavesA: Vec2[],
  leavesB: Vec2[],
  leafHalfW: number,
  leafHalfH: number,
  inflateA: SidePad,
  inflateB: SidePad,
): Relation {
  const nA = leavesA.length;
  const deps = [...leavesA, ...leavesB];
  return generic(
    deps,
    1,
    (pos, out) => {
      let aMinX = Infinity, aMinY = Infinity, aMaxX = -Infinity, aMaxY = -Infinity;
      for (let i = 0; i < nA; i++) {
        const x = pos[i]![0]!;
        const y = pos[i]![1]!;
        if (x < aMinX) aMinX = x;
        if (x > aMaxX) aMaxX = x;
        if (y < aMinY) aMinY = y;
        if (y > aMaxY) aMaxY = y;
      }
      aMinX -= leafHalfW + inflateA.left;
      aMaxX += leafHalfW + inflateA.right;
      aMinY -= leafHalfH + inflateA.top;
      aMaxY += leafHalfH + inflateA.bottom;
      let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
      for (let i = nA; i < deps.length; i++) {
        const x = pos[i]![0]!;
        const y = pos[i]![1]!;
        if (x < bMinX) bMinX = x;
        if (x > bMaxX) bMaxX = x;
        if (y < bMinY) bMinY = y;
        if (y > bMaxY) bMaxY = y;
      }
      bMinX -= leafHalfW + inflateB.left;
      bMaxX += leafHalfW + inflateB.right;
      bMinY -= leafHalfH + inflateB.top;
      bMaxY += leafHalfH + inflateB.bottom;
      // Slack on each separating axis (positive when separated).
      // sx = how far apart horizontally beyond touching.
      const sx = Math.max(aMinX - bMaxX, bMinX - aMaxX);
      const sy = Math.max(aMinY - bMaxY, bMinY - aMaxY);
      out[0]! = Math.max(sx, sy);
    },
    { lambdaMax: [0] },
  );
}

/** Soft cohesion: pull `leaf` toward the centroid of `siblings`.
 *  Useful as the missing-half of `groupNonOverlap` — without it, leaves
 *  can fly out of their group when separation pressure from sibling
 *  groups exceeds their internal spring/repel balance. This is the
 *  "leaf belongs to its group" force, expressed as a soft attractor
 *  computed inside the residual so the centroid stays live. */
export function groupCohesion(
  leaf: Vec2,
  siblings: Vec2[],
  stiffness: number,
): Relation {
  const deps = [leaf, ...siblings];
  return generic(
    deps,
    2,
    (pos, out) => {
      let cx = 0, cy = 0;
      const n = siblings.length;
      for (let i = 1; i <= n; i++) {
        cx += pos[i]![0]!;
        cy += pos[i]![1]!;
      }
      cx /= n;
      cy /= n;
      out[0]! = pos[0]![0]! - cx;
      out[1]! = pos[0]![1]! - cy;
    },
    { hard: false, stiffness },
  );
}

type BoxCell = Writable<Cell<{ x: number; y: number; w: number; h: number }>>;

/** Hard AABB non-overlap between two writable Box cells. Treats each
 *  Box as a solver object — when the constraint is violated, the
 *  solver moves the Boxes themselves to satisfy it.
 *
 *  This is the "rect is first-class" version of groupNonOverlap. The
 *  rect is what the solver moves; leaves come along because they're
 *  clamped inside (see `clampInside`). */
export function rectsNonOverlap(a: BoxCell, b: BoxCell, gap = 0): Relation {
  return generic(
    [a, b],
    1,
    (pos, out) => {
      const ax = pos[0]![0]!;
      const ay = pos[0]![1]!;
      const aw = pos[0]![2]!;
      const ah = pos[0]![3]!;
      const bx = pos[1]![0]!;
      const by = pos[1]![1]!;
      const bw = pos[1]![2]!;
      const bh = pos[1]![3]!;
      const sx = Math.max(ax - (bx + bw), bx - (ax + aw)) - gap;
      const sy = Math.max(ay - (by + bh), by - (ay + ah)) - gap;
      out[0]! = Math.max(sx, sy);
    },
    { lambdaMax: [0] },
  );
}

/** Hard: leaf position stays inside container box, inset by leaf
 *  half-size so the leaf's full rect fits. Encoded as a single
 *  residual = min over the four edge slacks (positive when inside). */
export function clampInside(
  leaf: Vec2,
  container: BoxCell,
  halfW: number,
  halfH: number,
): Relation {
  return generic(
    [leaf, container],
    1,
    (pos, out) => {
      const lx = pos[0]![0]!;
      const ly = pos[0]![1]!;
      const cx = pos[1]![0]!;
      const cy = pos[1]![1]!;
      const cw = pos[1]![2]!;
      const ch = pos[1]![3]!;
      const left   = (lx - halfW) - cx;
      const right  = (cx + cw) - (lx + halfW);
      const top    = (ly - halfH) - cy;
      const bot    = (cy + ch) - (ly + halfH);
      out[0]! = Math.min(left, right, top, bot);
    },
    { lambdaMax: [0] },
  );
}

/** Hard: inner box stays inside outer box, with `inset` on each side.
 *  For child GROUP rect contained by parent GROUP content area. */
export function boxInside(
  inner: BoxCell,
  outer: BoxCell,
  inset: SidePad,
): Relation {
  return generic(
    [inner, outer],
    1,
    (pos, out) => {
      const ix = pos[0]![0]!;
      const iy = pos[0]![1]!;
      const iw = pos[0]![2]!;
      const ih = pos[0]![3]!;
      const ox = pos[1]![0]!;
      const oy = pos[1]![1]!;
      const ow = pos[1]![2]!;
      const oh = pos[1]![3]!;
      const left   = ix - (ox + inset.left);
      const right  = (ox + ow - inset.right) - (ix + iw);
      const top    = iy - (oy + inset.top);
      const bot    = (oy + oh - inset.bottom) - (iy + ih);
      out[0]! = Math.min(left, right, top, bot);
    },
    { lambdaMax: [0] },
  );
}

/** Soft: pull a Box's size toward a minimum (w,h target). Keeps a
 *  solver-variable rect from inflating beyond what containment
 *  requires. */
export function rectMinimize(b: BoxCell, targetW: number, targetH: number, stiffness: number): Relation {
  return generic(
    [b],
    2,
    (pos, out) => {
      out[0]! = pos[0]![2]! - targetW;
      out[1]! = pos[0]![3]! - targetH;
    },
    { hard: false, stiffness },
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
