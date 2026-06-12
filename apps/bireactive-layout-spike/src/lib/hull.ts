// Reactive hull box around a set of position cells. Derives a Box from
// the positions + sizes; padding can vary by container depth at the
// call site. Used by every spike that draws containment hulls.

import { Box, Vec, type Writable } from "@bireactive";

export type Size = { w: number; h: number };

export interface HullPad {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function asPad(pad: number | HullPad): HullPad {
  if (typeof pad === "number") return { top: pad, bottom: pad, left: pad, right: pad };
  return pad;
}

export function hullOf(
  positions: ReadonlyArray<Writable<Vec> | Vec>,
  sizes: readonly Size[],
  pad: number | HullPad,
): Box {
  const p = asPad(pad);
  return Box.derive(() => {
    let xmin = Number.POSITIVE_INFINITY;
    let ymin = Number.POSITIVE_INFINITY;
    let xmax = Number.NEGATIVE_INFINITY;
    let ymax = Number.NEGATIVE_INFINITY;
    positions.forEach((q, i) => {
      const sz = sizes[i]!;
      const v = q.value;
      xmin = Math.min(xmin, v.x - sz.w / 2);
      ymin = Math.min(ymin, v.y - sz.h / 2);
      xmax = Math.max(xmax, v.x + sz.w / 2);
      ymax = Math.max(ymax, v.y + sz.h / 2);
    });
    return {
      x: xmin - p.left,
      y: ymin - p.top,
      w: xmax - xmin + p.left + p.right,
      h: ymax - ymin + p.top + p.bottom,
    };
  });
}

export function hullLabelPos(hullBox: Box): Vec {
  return Vec.derive(() => {
    const b = hullBox.value;
    return { x: b.x + 10, y: b.y + 14 };
  });
}
