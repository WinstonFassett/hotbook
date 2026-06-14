// Cartesian chart context — bireactive analog of LayerCake.
//
// d3-scale instances do the math. Bireactive cells hold all reactive state:
// data, accessors, derived scales, derived getters.

import { cell, derive, type Cell } from "bireactive";
import { extent } from "d3-array";
import { scaleLinear, scaleTime, type ScaleLinear, type ScaleTime } from "d3-scale";

export type Accessor<TData> = ((d: TData) => any) | keyof TData & string;

export type AnyScale =
  | ScaleLinear<number, number>
  | ScaleTime<number, number>
  | ((v: any) => number);

export type Padding = { top: number; right: number; bottom: number; left: number };

export interface ChartContextOpts<TData> {
  width: number;
  height: number;
  data: Cell<readonly TData[]> | readonly TData[];
  x: Accessor<TData>;
  y: Accessor<TData>;
  /** Optional padding (default 0 on all sides). */
  padding?: Partial<Padding>;
  /** Optional explicit xDomain. If absent, derived from data. `null` slots inherit from extent. */
  xDomain?: [number | Date | null, number | Date | null];
  yDomain?: [number | null, number | null];
  /** Pre-instantiated scale (e.g. scaleTime). Default: scaleLinear (or scaleTime if first x is Date). */
  xScale?: AnyScale;
  yScale?: AnyScale;
  /** Apply .nice() to inferred domain. */
  xNice?: boolean;
  yNice?: boolean;
  /** y baseline guaranteed visible (LC's yBaseline). */
  yBaseline?: number | null;
}

export interface ChartContext<TData> {
  data: Cell<readonly TData[]>;
  xAcc: (d: TData) => any;
  yAcc: (d: TData) => any;
  width: number;
  height: number;
  padding: Padding;
  /** Inner plot dimensions (width - padding.left - padding.right etc.) */
  plotWidth: number;
  plotHeight: number;
  /** Origin of plot area inside the SVG viewport. */
  plotX: number;
  plotY: number;
  /** Reactive scale instances. Domain is data-derived; range is plot bounds. */
  xScale: Cell<AnyScale>;
  yScale: Cell<AnyScale>;
  /** xScale(xAcc(d)). */
  xGet: Cell<(d: TData) => number>;
  yGet: Cell<(d: TData) => number>;
}

function normAccessor<TData>(a: Accessor<TData>): (d: TData) => any {
  return typeof a === "function" ? a : (d: TData) => (d as any)[a];
}

function asCell<T>(v: Cell<T> | T): Cell<T> {
  return v && typeof (v as any).value !== "undefined" && typeof (v as any).subscribe !== "undefined"
    ? (v as Cell<T>)
    : cell(v as T);
}

const DEFAULT_PADDING: Padding = { top: 0, right: 0, bottom: 0, left: 0 };

export function chartContext<TData>(opts: ChartContextOpts<TData>): ChartContext<TData> {
  const data = asCell(opts.data);
  const xAcc = normAccessor(opts.x);
  const yAcc = normAccessor(opts.y);

  const padding: Padding = { ...DEFAULT_PADDING, ...(opts.padding ?? {}) };
  const plotWidth = Math.max(0, opts.width - padding.left - padding.right);
  const plotHeight = Math.max(0, opts.height - padding.top - padding.bottom);
  const plotX = padding.left;
  const plotY = padding.top;

  const xScale = derive(() => {
    const rows = data.value;
    const first = rows[0];
    const firstX = first !== undefined ? xAcc(first) : undefined;
    const base =
      opts.xScale ??
      (firstX instanceof Date ? scaleTime() : scaleLinear());
    const inferred = extent(rows as TData[], xAcc) as [any, any];
    const domain: [any, any] = [
      opts.xDomain?.[0] ?? inferred[0] ?? 0,
      opts.xDomain?.[1] ?? inferred[1] ?? 1,
    ];
    const s: any = (base as any).copy ? (base as any).copy() : base;
    s.domain(domain);
    s.range([plotX, plotX + plotWidth]);
    if (opts.xNice && typeof s.nice === "function") s.nice();
    return s as AnyScale;
  });

  const yScale = derive(() => {
    const rows = data.value;
    const base = opts.yScale ?? scaleLinear();
    const inferred = extent(rows as TData[], yAcc) as [number | undefined, number | undefined];
    let lo = opts.yDomain?.[0] ?? inferred[0] ?? 0;
    let hi = opts.yDomain?.[1] ?? inferred[1] ?? 1;
    if (opts.yBaseline != null) {
      lo = Math.min(lo as number, opts.yBaseline);
      hi = Math.max(hi as number, opts.yBaseline);
    }
    const s: any = (base as any).copy ? (base as any).copy() : base;
    s.domain([lo, hi]);
    // y range reversed: SVG origin top-left, charts grow up
    s.range([plotY + plotHeight, plotY]);
    if (opts.yNice && typeof s.nice === "function") s.nice();
    return s as AnyScale;
  });

  const xGet = derive(() => {
    const s = xScale.value;
    return (d: TData) => (s as any)(xAcc(d));
  });
  const yGet = derive(() => {
    const s = yScale.value;
    return (d: TData) => (s as any)(yAcc(d));
  });

  return {
    data,
    xAcc,
    yAcc,
    width: opts.width,
    height: opts.height,
    padding,
    plotWidth,
    plotHeight,
    plotX,
    plotY,
    xScale,
    yScale,
    xGet,
    yGet,
  };
}
