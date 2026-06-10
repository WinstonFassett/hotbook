// Minimal chart context. Mirrors the shape of LayerChart's <Chart>:
// reactive width/height + a "focus domain" used by Bounds to do drill-in.
//
// Unlike LayerCake we don't try to be a generic scale framework — for the
// hierarchical-DM kit, the only thing layouts and primitives need to agree on
// is the px viewport and the current focus rectangle in layout-space.

import { derive, num, type Num, type Writable } from "bireactive";

export interface FocusDomain {
  x0: Writable<Num>;
  y0: Writable<Num>;
  x1: Writable<Num>;
  y1: Writable<Num>;
}

export interface ChartContext {
  width: Writable<Num>;
  height: Writable<Num>;
  /** Current focus rectangle in layout coords. Drill-in tweens this. */
  focus: FocusDomain;
  /** Full domain — what focus is reset to when popping all the way out. */
  full: FocusDomain;
  /** Set focus immediately (snap) to a new domain. */
  zoomTo: (d: { x0: number; y0: number; x1: number; y1: number }) => void;
  /** Reset to full domain. */
  reset: () => void;
}

export function chartContext(width: number, height: number): ChartContext {
  const fullX0 = num(0), fullY0 = num(0);
  const fullX1 = num(width), fullY1 = num(height);
  const focX0 = num(0), focY0 = num(0);
  const focX1 = num(width), focY1 = num(height);
  return {
    width: num(width),
    height: num(height),
    full: { x0: fullX0, y0: fullY0, x1: fullX1, y1: fullY1 },
    focus: { x0: focX0, y0: focY0, x1: focX1, y1: focY1 },
    zoomTo: (d) => {
      focX0.value = d.x0; focY0.value = d.y0;
      focX1.value = d.x1; focY1.value = d.y1;
    },
    reset: () => {
      focX0.value = fullX0.value; focY0.value = fullY0.value;
      focX1.value = fullX1.value; focY1.value = fullY1.value;
    },
  };
}

/**
 * Projects a value v from a source range [d0,d1] into a px range [r0,r1].
 * Used by Bounds: layout-space → view-space via the current focus domain.
 */
export function project(v: number, d0: number, d1: number, r0: number, r1: number): number {
  const span = d1 - d0;
  if (span === 0) return r0;
  return r0 + ((v - d0) / span) * (r1 - r0);
}

/** Reactive projector for x. Returns a Num cell. */
export function xProject(
  ctx: ChartContext,
  vCell: () => number,
) {
  return derive(() =>
    project(vCell(), ctx.focus.x0.value, ctx.focus.x1.value, 0, ctx.width.value),
  );
}

export function yProject(
  ctx: ChartContext,
  vCell: () => number,
) {
  return derive(() =>
    project(vCell(), ctx.focus.y0.value, ctx.focus.y1.value, 0, ctx.height.value),
  );
}
