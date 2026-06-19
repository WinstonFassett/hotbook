// Shared interaction layer for cartesian (x-bisect) charts.
// Mirrors attachChartGestures for hierarchical charts.

import { installGestureRelease } from "./interaction";
import type { ChartContext } from "./chart-context";
import { bisector } from "d3-array";
import type { Cell, Writable } from "bireactive";

export interface CartesianGestureState<TData> {
  hover: Writable<Cell<TData | null>>;
  selected: Writable<Cell<TData | null>>;
}

export interface CartesianGestureOpts<TData> {
  ctx: ChartContext<TData>;
  state: CartesianGestureState<TData>;
  /** Returns the datum closest to pixel x. */
  findAtPixel: (px: number) => TData | null;
  /** Returns the y pixel for a datum (for drag hit detection). */
  yPixel: (d: TData) => number;
  /** Mutate datum value by delta, then re-signal data cell. */
  mutateDatum: (d: TData, delta: number) => void;
  /** Ordered flat list of all data points for keyboard nav. */
  order: () => TData[];
}

export function attachCartesianGestures<TData>(
  host: HTMLElement,
  svgEl: SVGSVGElement,
  opts: CartesianGestureOpts<TData>,
): () => void {
  const { ctx, state, findAtPixel, yPixel, mutateDatum, order } = opts;

  const localPoint = (e: PointerEvent): { x: number; y: number } => {
    const rect = svgEl.getBoundingClientRect();
    const vb = svgEl.viewBox?.baseVal;
    const sx = vb && vb.width ? vb.width / rect.width : 1;
    const sy = vb && vb.height ? vb.height / rect.height : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  };

  const wheelLocked = { current: null as TData | null };
  const releaseDispose = installGestureRelease(() => { wheelLocked.current = null; state.hover.value = null; });

  let dragTarget: TData | null = null;

  const onPointerLeave = () => { if (wheelLocked.current) return; state.hover.value = null; };

  const onClick = (e: Event) => {
    const { x } = localPoint(e as PointerEvent);
    if (x < ctx.plotX || x > ctx.plotX + ctx.plotWidth) return;
    const pt = findAtPixel(x);
    state.selected.value = state.selected.value === pt ? null : pt;
  };

  const onWheel = (e: Event) => {
    const we = e as WheelEvent;
    if (!(we.metaKey || we.ctrlKey)) return;
    if (!wheelLocked.current) wheelLocked.current = state.hover.value ?? state.selected.value;
    const target = wheelLocked.current;
    if (!target) return;
    we.preventDefault();
    const step = we.shiftKey ? 5 : 1;
    mutateDatum(target, we.deltaY < 0 ? +step : -step);
  };

  const onKeydown = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === "Escape") { state.selected.value = null; ke.preventDefault(); return; }
    const rows = order();
    if (rows.length === 0) return;
    const cur = state.selected.value;
    const i = cur ? rows.indexOf(cur) : -1;
    if (ke.key === "Tab") {
      state.selected.value = ke.shiftKey
        ? rows[(i <= 0 ? rows.length : i) - 1] ?? null
        : rows[(i + 1) % rows.length] ?? null;
      ke.preventDefault(); return;
    }
    if (ke.key === "ArrowRight") { state.selected.value = rows[(i + 1) % rows.length] ?? null; ke.preventDefault(); return; }
    if (ke.key === "ArrowLeft") { state.selected.value = rows[(i <= 0 ? rows.length : i) - 1] ?? null; ke.preventDefault(); return; }
    if (!cur) return;
    const step = ke.shiftKey ? 5 : 1;
    if (ke.key === "ArrowUp") { mutateDatum(cur, +step); ke.preventDefault(); }
    else if (ke.key === "ArrowDown") { mutateDatum(cur, -step); ke.preventDefault(); }
  };

  const onPointerDown = (e: Event) => {
    const pe = e as PointerEvent;
    const { x, y } = localPoint(pe);
    if (x < ctx.plotX || x > ctx.plotX + ctx.plotWidth) return;
    const pt = findAtPixel(x);
    if (!pt) return;
    if (Math.abs(y - yPixel(pt)) > 12) return;
    dragTarget = pt;
    state.selected.value = pt;
    host.style.cursor = "ns-resize";
    (host as any).setPointerCapture(pe.pointerId);
    pe.preventDefault();
  };

  const onPointerMove = (e: Event) => {
    const pe = e as PointerEvent;
    if (dragTarget) {
      const { y } = localPoint(pe);
      const ys = ctx.yScale.value as any;
      mutateDatum(dragTarget, ys.invert(y) - (ctx.yAcc(dragTarget) as number));
      return;
    }
    if (wheelLocked.current) return;
    const { x, y } = localPoint(pe);
    if (x < ctx.plotX || x > ctx.plotX + ctx.plotWidth) { state.hover.value = null; host.style.cursor = ""; return; }
    const pt = findAtPixel(x);
    state.hover.value = pt;
    // Show the vertical-drag cursor when the pointer is near a draggable marker.
    host.style.cursor = pt && Math.abs(y - yPixel(pt)) <= 12 ? "ns-resize" : "";
  };

  const onPointerUp = () => { dragTarget = null; host.style.cursor = ""; };

  host.addEventListener("pointerleave", onPointerLeave);
  host.addEventListener("click", onClick);
  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("keydown", onKeydown);
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerUp);

  return () => {
    host.removeEventListener("pointerleave", onPointerLeave);
    host.removeEventListener("click", onClick);
    host.removeEventListener("wheel", onWheel);
    host.removeEventListener("keydown", onKeydown);
    host.removeEventListener("pointerdown", onPointerDown);
    host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("pointerup", onPointerUp);
    host.removeEventListener("pointercancel", onPointerUp);
    releaseDispose();
  };
}

export function makeBisectFinder<TData>(
  data: { value: readonly TData[] },
  xAcc: (d: TData) => Date | number,
): (px: number, xScale: any) => TData | null {
  const bis = bisector<TData, Date | number>(xAcc).center;
  return (px, xScale) => {
    const rows = data.value;
    if (rows.length === 0) return null;
    const val = xScale.invert?.(px);
    if (val == null) return null;
    const i = bis(rows as TData[], val as any);
    return rows[Math.max(0, Math.min(rows.length - 1, i))] ?? null;
  };
}
