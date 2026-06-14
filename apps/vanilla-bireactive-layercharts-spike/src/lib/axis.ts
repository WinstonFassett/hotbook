// Axis — ticks + tick labels + axis line, drawn as bireactive primitives.
// Reads ctx.xScale or ctx.yScale and uses d3's scale.ticks() / tickFormat().

import { Anchor, derive, label, line, type Mount, Vec, vec } from "bireactive";
import type { ChartContext } from "./chart-context";

export type AxisPlacement = "bottom" | "top" | "left" | "right";

export interface AxisOpts {
  placement: AxisPlacement;
  ticks?: number;
  tickFormat?: (v: any) => string;
  color?: string;
  tickSize?: number;
}

export function axis<TData>(s: Mount, ctx: ChartContext<TData>, opts: AxisOpts) {
  const placement = opts.placement;
  const horizontal = placement === "top" || placement === "bottom";
  const tickCount = opts.ticks ?? (horizontal ? 6 : 5);
  const color = opts.color ?? "#888";
  const tickSize = opts.tickSize ?? 4;

  const ax0 = ctx.plotX;
  const ax1 = ctx.plotX + ctx.plotWidth;
  const ay0 = ctx.plotY;
  const ay1 = ctx.plotY + ctx.plotHeight;

  const baseline =
    placement === "bottom"
      ? line(vec(ax0, ay1), vec(ax1, ay1), { thin: true, opacity: 0.5, stroke: color })
      : placement === "top"
        ? line(vec(ax0, ay0), vec(ax1, ay0), { thin: true, opacity: 0.5, stroke: color })
        : placement === "left"
          ? line(vec(ax0, ay0), vec(ax0, ay1), { thin: true, opacity: 0.5, stroke: color })
          : line(vec(ax1, ay0), vec(ax1, ay1), { thin: true, opacity: 0.5, stroke: color });
  s(baseline);

  const ticks = derive(() => {
    const scale: any = horizontal ? ctx.xScale.value : ctx.yScale.value;
    const arr: any[] =
      typeof scale.ticks === "function" ? scale.ticks(tickCount) : (scale.domain?.() ?? []);
    const fmt =
      opts.tickFormat ??
      (typeof scale.tickFormat === "function" ? scale.tickFormat(tickCount) : (v: any) => String(v));
    return arr.map((v) => ({ v, pos: scale(v), text: fmt(v) }));
  });

  const POOL = 12;
  for (let i = 0; i < POOL; i++) {
    const visible = derive(() => (ticks.value[i] ? 1 : 0));
    const tickOpacity = derive(() => 0.6 * visible.value);
    const labelOpacity = derive(() => 0.8 * visible.value);
    const text = derive(() => ticks.value[i]?.text ?? "");
    const pos = derive(() => ticks.value[i]?.pos ?? 0);

    if (horizontal) {
      const y0 = placement === "bottom" ? ay1 : ay0;
      const y1 = placement === "bottom" ? ay1 + tickSize : ay0 - tickSize;
      const lyText = placement === "bottom" ? ay1 + tickSize + 12 : ay0 - tickSize - 4;
      s(
        line(
          Vec.derive(() => ({ x: pos.value, y: y0 })),
          Vec.derive(() => ({ x: pos.value, y: y1 })),
          { thin: true, stroke: color, opacity: tickOpacity },
        ),
        label(
          Vec.derive(() => ({ x: pos.value, y: lyText })),
          text,
          { size: 10, align: Anchor.Center, fill: color, opacity: labelOpacity },
        ),
      );
    } else {
      const x0 = placement === "left" ? ax0 : ax1;
      const x1 = placement === "left" ? ax0 - tickSize : ax1 + tickSize;
      const lxText = placement === "left" ? ax0 - tickSize - 4 : ax1 + tickSize + 4;
      s(
        line(
          Vec.derive(() => ({ x: x0, y: pos.value })),
          Vec.derive(() => ({ x: x1, y: pos.value })),
          { thin: true, stroke: color, opacity: tickOpacity },
        ),
        label(
          Vec.derive(() => ({ x: lxText, y: pos.value })),
          text,
          {
            size: 10,
            align: placement === "left" ? Anchor.Right : Anchor.Left,
            fill: color,
            opacity: labelOpacity,
          },
        ),
      );
    }
  }
}
