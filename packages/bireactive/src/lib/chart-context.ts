// Cartesian chart context — bireactive analog of LayerCake.
//
// d3-scale instances do the math. Bireactive cells hold all reactive state:
// data, accessors, derived scales, derived getters.
//
// The context includes a TWEEN LAYER between the scale and the marks.
// Per-datum tween cells sit between the accessor and the scale getter.
// Marks read through ctx.xGet(d) / ctx.yGet(d), which read tween cells,
// NOT raw datum values. This makes the "tween cells animate to nowhere"
// bug architecturally impossible.
//
// The gate fires on accessor (binding) change → TWEEN. On value edit
// (same binding, different data) → SNAP. Same two-lane gate as WIN-143,
// but unified in the context instead of duplicated per chart.

import { cell, derive, easeOut, effect as biEffect, isCell, num, tween, untracked, type Cell } from "bireactive";
import { extent } from "d3-array";
import { scaleLinear, scaleTime, type ScaleLinear, type ScaleTime } from "d3-scale";
import { GESTURE_ACTIVE_CLASS, SETTLE_SEC } from "./transitions";

export type Accessor<TData> = ((d: TData) => any) | keyof TData & string;

export type AnyScale =
  | ScaleLinear<number, number>
  | ScaleTime<number, number>
  | ((v: any) => number);

export type Padding = { top: number; right: number; bottom: number; left: number };

export interface ChartContextOpts<TData> {
  width: number | Cell<number>;
  height: number | Cell<number>;
  data: Cell<readonly TData[]>;
  /** X accessor — static or reactive (Cell<Accessor>). When reactive, the
   *  gate detects binding changes and tweens. When static, no tween gate. */
  x: Accessor<TData> | Cell<Accessor<TData>>;
  /** Y accessor — same as x. */
  y: Accessor<TData> | Cell<Accessor<TData>>;
  /** Identity function for per-datum tween cell keying. Required when x/y
   *  are reactive Cells (tween layer active). */
  idOf?: (d: TData) => string;
  /** Host element — checked for GESTURE_ACTIVE_CLASS to suppress tweens
   *  during gestures (Principle 7: derived reorders defer to commit). */
  host?: HTMLElement;
  /** Animation controller — `this.anim` from a Diagram. Required for tween. */
  anim?: { start: (...anims: any[]) => () => void };
  /** Tween duration in seconds (default 0.35). */
  tweenSec?: number;
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
  /** Current x accessor function (reads from xAccCell.value). */
  xAcc: (d: TData) => any;
  /** Current y accessor function (reads from yAccCell.value). */
  yAcc: (d: TData) => any;
  /** Reactive x accessor cell — binding changes fire the tween gate. */
  xAccCell: Cell<(d: TData) => any>;
  /** Reactive y accessor cell — binding changes fire the tween gate. */
  yAccCell: Cell<(d: TData) => any>;
  /** Snapshot width at context creation. */
  width: number;
  /** Snapshot height at context creation. */
  height: number;
  padding: Padding;
  /** Snapshot inner plot dimensions — stable for hit-testing. */
  plotWidth: number;
  plotHeight: number;
  plotX: number;
  plotY: number;
  /** Reactive plot bounds — track container resize when width/height are Cells. */
  rPlotWidth: Cell<number>;
  rPlotHeight: Cell<number>;
  /** Reactive scale instances. Domain is tween-derived; range tracks container size. */
  xScale: Cell<AnyScale>;
  yScale: Cell<AnyScale>;
  /** xScale(tweenedX(d)). Reads through tween cells — marks always get animated positions. */
  xGet: Cell<(d: TData) => number>;
  /** yScale(tweenedY(d)). Reads through tween cells — marks always get animated positions. */
  yGet: Cell<(d: TData) => number>;
  /** Tweened data — raw data with values replaced by tween cell values.
   *  For charts that need to iterate over tweened data (spline path, etc.). */
  tweenedData: Cell<TData[]>;
}

function normAccessor<TData>(a: Accessor<TData>): (d: TData) => any {
  return typeof a === "function" ? a : (d: TData) => (d as any)[a];
}

function asCell<T>(v: Cell<T> | T): Cell<T> {
  return isCell(v) ? (v as Cell<T>) : cell(v as T);
}

const DEFAULT_PADDING: Padding = { top: 0, right: 0, bottom: 0, left: 0 };

export function chartContext<TData>(opts: ChartContextOpts<TData>): ChartContext<TData> {
  const data = opts.data;
  const wCell = asCell(opts.width);
  const hCell = asCell(opts.height);

  // Normalize accessors to cells. If static, wrap in a cell (no re-derivation).
  // If reactive (Cell<Accessor>), the gate detects binding changes.
  const xAccCell: Cell<(d: TData) => any> = isCell(opts.x)
    ? opts.x as Cell<(d: TData) => any>
    : cell(normAccessor(opts.x as Accessor<TData>));
  const yAccCell: Cell<(d: TData) => any> = isCell(opts.y)
    ? opts.y as Cell<(d: TData) => any>
    : cell(normAccessor(opts.y as Accessor<TData>));
  const xAcc = derive(() => xAccCell.value);
  const yAcc = derive(() => yAccCell.value);

  const padding: Padding = { ...DEFAULT_PADDING, ...(opts.padding ?? {}) };
  const plotX = padding.left;
  const plotY = padding.top;
  const plotWidth = Math.max(0, wCell.value - padding.left - padding.right);
  const plotHeight = Math.max(0, hCell.value - padding.top - padding.bottom);
  const rPlotWidth = derive(() => Math.max(0, wCell.value - padding.left - padding.right));
  const rPlotHeight = derive(() => Math.max(0, hCell.value - padding.top - padding.bottom));

  // ── Tween layer ──────────────────────────────────────────────────────
  // Per-datum tween cells. Created once from initial data. Keyed by idOf.
  // Gate: binding change → TWEEN (animate to new positions). Value edit → SNAP.
  // Marks read through ctx.xGet/ctx.yGet which read tween cells — never raw.
  //
  // Only tween an axis if:
  //   1. The accessor is reactive (Cell) — static accessors never change
  //   2. The value is a number — num() can't tween Dates (line/area x = date)
  const canTween = !!(opts.idOf && opts.host && opts.anim);
  const xIsReactive = isCell(opts.x);
  const yIsReactive = isCell(opts.y);
  const data0 = data.peek() as TData[];
  const xVal0 = data0[0] !== undefined ? xAccCell.value(data0[0]) : undefined;
  const yVal0 = data0[0] !== undefined ? yAccCell.value(data0[0]) : undefined;
  const tweenX = canTween && xIsReactive && typeof xVal0 === 'number';
  const tweenY = canTween && yIsReactive && typeof yVal0 === 'number';
  const xTweens = new Map<string, ReturnType<typeof num>>();
  const yTweens = new Map<string, ReturnType<typeof num>>();
  const tweenSec = opts.tweenSec ?? SETTLE_SEC;

  if (tweenX || tweenY) {
    const idOf = opts.idOf!;
    const host = opts.host!;
    const anim = opts.anim!;
    for (const d of data0) {
      const pid = idOf(d);
      let xc: ReturnType<typeof num> | null = null;
      let yc: ReturnType<typeof num> | null = null;
      if (tweenX) {
        const xTarget = derive(() => { void data.value; return xAcc.value(d); });
        xc = num(xTarget.value);
        xTweens.set(pid, xc);
      }
      if (tweenY) {
        const yTarget = derive(() => { void data.value; return yAcc.value(d); });
        yc = num(yTarget.value);
        yTweens.set(pid, yc);
      }
      let cancel: (() => void) | null = null;
      let inited = false;
      let seenXAcc = untracked(() => xAccCell.value);
      let seenYAcc = untracked(() => yAccCell.value);
      biEffect(() => {
        const xt = tweenX ? (derive(() => { void data.value; return xAcc.value(d); })).value : 0;
        const yt = tweenY ? (derive(() => { void data.value; return yAcc.value(d); })).value : 0;
        const xa = untracked(() => xAccCell.value);
        const ya = untracked(() => yAccCell.value);
        if (!inited) {
          inited = true; seenXAcc = xa; seenYAcc = ya;
          if (xc) xc.value = xt; if (yc) yc.value = yt;
          return;
        }
        const structural = (tweenX && xa !== seenXAcc) || (tweenY && ya !== seenYAcc);
        seenXAcc = xa; seenYAcc = ya;
        if (structural && !host.classList.contains(GESTURE_ACTIVE_CLASS)) {
          cancel?.();
          const anims: any[] = [];
          if (xc) anims.push(tween(xc, xt, tweenSec, easeOut));
          if (yc) anims.push(tween(yc, yt, tweenSec, easeOut));
          cancel = anim.start(...anims);
        } else {
          cancel?.(); cancel = null;
          if (xc) xc.value = xt; if (yc) yc.value = yt;
        }
      });
    }
  }

  // Tweened data — raw data mapped through tween cells. Used by scales
  // (domain tracks tweened values) and by charts that iterate over data
  // (spline path, area path, etc.).
  const tweenedData: Cell<TData[]> = derive(() => {
    void data.value;
    const rows = data.peek() as TData[];
    if (!tweenX && !tweenY) return rows as TData[];
    const idOf = opts.idOf!;
    return rows.map((d) => {
      const pid = idOf(d);
      const xc = xTweens.get(pid), yc = yTweens.get(pid);
      if (!xc && !yc) return d;
      return { ...d, ...(xc ? { __tx: xc.value } : {}), ...(yc ? { __ty: yc.value } : {}) };
    }) as unknown as TData[];
  });

  // Scales derive from tweened data so domains animate with points.
  // The accessor reads __tx/__ty (tweened values) if present, else raw.
  const xScaleAcc = derive(() => {
    const acc = xAcc.value;
    return (d: any) => d.__tx !== undefined ? d.__tx : acc(d);
  });
  const yScaleAcc = derive(() => {
    const acc = yAcc.value;
    return (d: any) => d.__ty !== undefined ? d.__ty : acc(d);
  });

  const xScale = derive(() => {
    const rows = tweenedData.value;
    const pw = Math.max(0, wCell.value - padding.left - padding.right);
    const acc = xScaleAcc.value;
    const first = rows[0];
    const firstX = first !== undefined ? acc(first) : undefined;
    const base =
      opts.xScale ??
      (firstX instanceof Date ? scaleTime() : scaleLinear());
    const inferred = extent(rows as TData[], acc) as [any, any];
    const domain: [any, any] = [
      opts.xDomain?.[0] ?? inferred[0] ?? 0,
      opts.xDomain?.[1] ?? inferred[1] ?? 1,
    ];
    const s: any = (base as any).copy ? (base as any).copy() : base;
    s.domain(domain);
    s.range([plotX, plotX + pw]);
    if (opts.xNice && typeof s.nice === "function") s.nice();
    return s as AnyScale;
  });

  const yScale = derive(() => {
    const rows = tweenedData.value;
    const ph = Math.max(0, hCell.value - padding.top - padding.bottom);
    const acc = yScaleAcc.value;
    const base = opts.yScale ?? scaleLinear();
    const inferred = extent(rows as TData[], acc) as [number | undefined, number | undefined];
    let lo = opts.yDomain?.[0] ?? inferred[0] ?? 0;
    let hi = opts.yDomain?.[1] ?? inferred[1] ?? 1;
    if (opts.yBaseline != null) {
      lo = Math.min(lo as number, opts.yBaseline);
      hi = Math.max(hi as number, opts.yBaseline);
    }
    const s: any = (base as any).copy ? (base as any).copy() : base;
    s.domain([lo, hi]);
    s.range([plotY + ph, plotY]);
    if (opts.yNice && typeof s.nice === "function") s.nice();
    return s as AnyScale;
  });

  // xGet/yGet read through tween cells. Marks call ctx.xGet.value(d) inside
  // a derive — both the scale cell and the tween cell are tracked, so the
  // mark re-derives when either changes.
  const xGet = derive(() => {
    const s = xScale.value;
    const acc = xAcc.value;
    if (!tweenX) return (d: TData) => (s as any)(acc(d));
    const idOf = opts.idOf!;
    return (d: TData) => {
      const tween = xTweens.get(idOf(d));
      const val = tween ? tween.value : acc(d);
      return (s as any)(val);
    };
  });
  const yGet = derive(() => {
    const s = yScale.value;
    const acc = yAcc.value;
    if (!tweenY) return (d: TData) => (s as any)(acc(d));
    const idOf = opts.idOf!;
    return (d: TData) => {
      const tween = yTweens.get(idOf(d));
      const val = tween ? tween.value : acc(d);
      return (s as any)(val);
    };
  });

  // xAcc/yAcc as plain functions (backward compat for spline.ts, area.ts,
  // cartesian-gestures.ts which call ctx.xAcc(d) directly). Reads current
  // value from the cell.
  const xAccFn = (d: TData) => xAccCell.value(d);
  const yAccFn = (d: TData) => yAccCell.value(d);

  return {
    data,
    xAcc: xAccFn,
    yAcc: yAccFn,
    xAccCell,
    yAccCell,
    width: wCell.value,
    height: hCell.value,
    padding,
    plotWidth,
    plotHeight,
    plotX,
    plotY,
    rPlotWidth,
    rPlotHeight,
    xScale,
    yScale,
    xGet,
    yGet,
    tweenedData,
  };
}
