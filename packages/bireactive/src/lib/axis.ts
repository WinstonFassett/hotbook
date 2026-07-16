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
  const ay0 = ctx.plotY;
  const rAx1 = derive(() => ctx.plotX + ctx.rPlotWidth.value);
  const rAy1 = derive(() => ctx.plotY + ctx.rPlotHeight.value);

  const baseline =
    placement === "bottom"
      ? line(Vec.derive(() => ({ x: ax0, y: rAy1.value })), Vec.derive(() => ({ x: rAx1.value, y: rAy1.value })), { thin: true, opacity: 0.5, stroke: color })
      : placement === "top"
        ? line(vec(ax0, ay0), Vec.derive(() => ({ x: rAx1.value, y: ay0 })), { thin: true, opacity: 0.5, stroke: color })
        : placement === "left"
          ? line(vec(ax0, ay0), Vec.derive(() => ({ x: ax0, y: rAy1.value })), { thin: true, opacity: 0.5, stroke: color })
          : line(Vec.derive(() => ({ x: rAx1.value, y: ay0 })), Vec.derive(() => ({ x: rAx1.value, y: rAy1.value })), { thin: true, opacity: 0.5, stroke: color });
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
      // Tick y-positions track the bottom/top of the plot area reactively.
      s(
        line(
          Vec.derive(() => ({ x: pos.value, y: placement === "bottom" ? rAy1.value : ay0 })),
          Vec.derive(() => ({ x: pos.value, y: placement === "bottom" ? rAy1.value + tickSize : ay0 - tickSize })),
          { thin: true, stroke: color, opacity: tickOpacity },
        ),
        label(
          Vec.derive(() => ({ x: pos.value, y: placement === "bottom" ? rAy1.value + tickSize + 12 : ay0 - tickSize - 4 })),
          text,
          { size: 10, align: Anchor.Center, fill: color, opacity: labelOpacity },
        ),
      );
    } else {
      // Left axis: ax0 is fixed (padding-based). Right axis: rAx1 tracks width.
      s(
        line(
          Vec.derive(() => ({ x: placement === "left" ? ax0 : rAx1.value, y: pos.value })),
          Vec.derive(() => ({ x: placement === "left" ? ax0 - tickSize : rAx1.value + tickSize, y: pos.value })),
          { thin: true, stroke: color, opacity: tickOpacity },
        ),
        label(
          Vec.derive(() => ({ x: placement === "left" ? ax0 - tickSize - 4 : rAx1.value + tickSize + 4, y: pos.value })),
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
