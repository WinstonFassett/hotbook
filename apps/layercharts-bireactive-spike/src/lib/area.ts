// Area — filled band between y0 and y1, like LC's Area.svelte.
// v1: y0 defaults to yScale(0) (or yRange max if 0 not in domain), y1 = y accessor.

import { derive, pathD } from "bireactive";
import { area as d3Area, type CurveFactory } from "d3-shape";
import type { ChartContext } from "./chart-context";

export interface AreaOpts {
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  curve?: CurveFactory;
  data?: readonly any[];
  /** Override y0 accessor. Default: yScale(0) clamped to yRange. */
  y0?: (d: any) => number;
}

export function area<TData>(ctx: ChartContext<TData>, opts: AreaOpts = {}) {
  const fill = opts.fill ?? "#5b8def";
  const fillOpacity = opts.fillOpacity ?? 0.3;

  const d = derive(() => {
    const rows = opts.data ?? ctx.data.value;
    const gx = ctx.xGet.value;
    const gy = ctx.yGet.value;
    const ys: any = ctx.yScale.value;
    const yRange = ys.range?.() ?? [0, 0];
    const baseline = ys(0);
    // Clamp baseline to the visible range (mirrors LC's Math.min($yScale(0), $yRange[0]) pattern).
    const y0Default = Math.max(...yRange);
    const y0 = Number.isFinite(baseline) ? Math.min(baseline, y0Default) : y0Default;

    const gen = d3Area<TData>()
      .x((dp) => gx(dp as TData))
      .y0(opts.y0 ?? (() => y0))
      .y1((dp) => gy(dp as TData));
    if (opts.curve) gen.curve(opts.curve);
    return gen(rows as TData[]) ?? "";
  });

  return pathD(d, {
    fill,
    opacity: fillOpacity,
    stroke: opts.stroke ?? "transparent",
    strokeWidth: opts.strokeWidth ?? 0,
  });
}
