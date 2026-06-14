// Spline — line through a data series, like LC's Spline.svelte.
// d3-shape produces the path string inside derive(); bireactive emits pathD.

import { derive, pathD } from "bireactive";
import { line as d3Line, type CurveFactory } from "d3-shape";
import type { ChartContext } from "./chart-context";

export interface SplineOpts {
  stroke?: string;
  strokeWidth?: number;
  curve?: CurveFactory;
  /** Override data instead of ctx.data. */
  data?: readonly any[];
}

export function spline<TData>(ctx: ChartContext<TData>, opts: SplineOpts = {}) {
  const stroke = opts.stroke ?? "#5b8def";
  const strokeWidth = opts.strokeWidth ?? 2;

  const d = derive(() => {
    const rows = opts.data ?? ctx.data.value;
    const gx = ctx.xGet.value;
    const gy = ctx.yGet.value;
    const gen = d3Line<TData>()
      .x((dp) => gx(dp as TData))
      .y((dp) => gy(dp as TData));
    if (opts.curve) gen.curve(opts.curve);
    return gen(rows as TData[]) ?? "";
  });

  return pathD(d, { stroke, strokeWidth, fill: "none" });
}
