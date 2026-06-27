// Shared interaction layer for cartesian (x-bisect) charts.
// Mirrors attachChartGestures for hierarchical charts.

import { wheelController, dragController } from "./interaction";
import type { ChartContext } from "./chart-context";
import { bisector } from "d3-array";
import { effect as biEffect } from "bireactive";
import type { Cell, Writable } from "bireactive";
import { makeBridge, type ElementWithBridge } from "./hud-bridge";

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
  /** When false, value-edit gestures (drag, wheel, arrow up/down) are disabled. Defaults to true. */
  canEdit?: () => boolean;
}

export function attachCartesianGestures<TData>(
  host: HTMLElement,
  svgEl: SVGSVGElement,
  opts: CartesianGestureOpts<TData>,
): () => void {
  const { ctx, state, findAtPixel, yPixel, mutateDatum, order } = opts;
  const canEdit = opts.canEdit ?? (() => true);

  const localPoint = (e: PointerEvent): { x: number; y: number } => {
    const rect = svgEl.getBoundingClientRect();
    const vb = svgEl.viewBox?.baseVal;
    const sx = vb && vb.width ? vb.width / rect.width : 1;
    const sy = vb && vb.height ? vb.height / rect.height : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  };

  // Frozen snapshot of order() taken at gesture-start. When sorted-by-value,
  // mid-gesture mutations shift order() — idxOf/datumAt must use the pre-gesture
  // snapshot so the bridge doesn't resolve a different datum from a shifted index.
  let gestureOrder: TData[] | null = null;

  // Per-gesture value-mapping handed to the SHARED wheel/drag controllers (app-
  // wide singletons; one pointer → one live gesture).
  const wheelConfig = {
    snapshot: (d: TData) => ctx.yAcc(d) as number,
    restore: (d: TData, v: number) => mutateDatum(d, v - (ctx.yAcc(d) as number)),
    onEnd: () => { state.hover.value = null; gestureOrder = null; },
  };

  // Move handler the drag controller invokes while a drag is live.
  let dragPointerId = -1;
  const onDragMove = (pe: PointerEvent) => {
    const t = dragController.target as TData | null;
    if (!t) return;
    const { y } = localPoint(pe);
    const ys = ctx.yScale.value as any;
    mutateDatum(t, ys.invert(y) - (ctx.yAcc(t) as number));
  };
  const dragConfig = {
    snapshot: (d: TData) => ctx.yAcc(d) as number,
    restore: (d: TData, v: number) => mutateDatum(d, v - (ctx.yAcc(d) as number)),
    onMove: onDragMove,
    onEnd: () => {
      if (dragPointerId >= 0 && (host as any).hasPointerCapture?.(dragPointerId)) {
        (host as any).releasePointerCapture(dragPointerId);
      }
      dragPointerId = -1;
      gestureOrder = null;
      host.style.cursor = "";
      (host as any).gestureActive = false;
    },
  };

  const onPointerLeave = () => { if (wheelController.active) return; state.hover.value = null; };

  const onClick = (e: Event) => {
    const { x } = localPoint(e as PointerEvent);
    if (x < ctx.plotX || x > ctx.plotX + ctx.plotWidth) return;
    const pt = findAtPixel(x);
    state.selected.value = state.selected.value === pt ? null : pt;
  };

  const onWheel = (e: Event) => {
    const we = e as WheelEvent;
    if (!we.ctrlKey || !canEdit()) return;
    if (!wheelController.active) gestureOrder = order();
    const target = wheelController.begin(state.hover.value ?? state.selected.value, wheelConfig);
    if (!target) return;
    we.preventDefault();
    const step = we.shiftKey ? 5 : 1;
    mutateDatum(target, we.deltaY < 0 ? +step : -step);
  };

  const onKeydown = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === "Escape") {
      // Drag-Esc is owned by the drag gesture. Here: clear selection if focused.
      if (state.selected.value != null) { state.selected.value = null; ke.preventDefault(); }
      return;
    }
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
    if (!cur || !canEdit()) return;
    const step = ke.shiftKey ? 5 : 1;
    if (ke.key === "ArrowUp") { mutateDatum(cur, +step); ke.preventDefault(); }
    else if (ke.key === "ArrowDown") { mutateDatum(cur, -step); ke.preventDefault(); }
  };

  const onPointerDown = (e: Event) => {
    if (dragController.active || !canEdit()) return;
    const pe = e as PointerEvent;
    const { x, y } = localPoint(pe);
    if (x < ctx.plotX || x > ctx.plotX + ctx.plotWidth) return;
    const pt = findAtPixel(x);
    if (!pt) return;
    if (Math.abs(y - yPixel(pt)) > 12) return;
    gestureOrder = order();
    dragPointerId = pe.pointerId;
    state.selected.value = pt;
    host.style.cursor = "ns-resize";
    (host as any).gestureActive = true;
    (host as any).setPointerCapture(pe.pointerId);
    dragController.begin(pt, dragConfig); // controller owns move/up/Esc from here
    pe.preventDefault();
  };

  // Hover only (drag motion is handled by the gesture controller).
  const onPointerMove = (e: Event) => {
    if (dragController.active || wheelController.active) return;
    const pe = e as PointerEvent;
    const { x, y } = localPoint(pe);
    if (x < ctx.plotX || x > ctx.plotX + ctx.plotWidth) { state.hover.value = null; host.style.cursor = ""; return; }
    const pt = findAtPixel(x);
    state.hover.value = pt;
    host.style.cursor = pt && Math.abs(y - yPixel(pt)) <= 12 ? "ns-resize" : "";
  };

  host.addEventListener("pointerleave", onPointerLeave);
  host.addEventListener("click", onClick);
  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("keydown", onKeydown);
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);

  // ── Cross-tile sync bridge ──────────────────────────────────────────────
  // Flat datums carry no PNode id, so the bridge keys on the datum's index in
  // `order()`; the React wrapper maps index ↔ PNode id via its parallel `ids[]`.
  const idxOf = (d: TData | null): string | null => {
    if (d == null) return null;
    const i = (gestureOrder ?? order()).indexOf(d);
    return i < 0 ? null : String(i);
  };
  const datumAt = (key: string | null): TData | null => {
    if (key == null) return null;
    const i = Number(key);
    const rows = gestureOrder ?? order();
    return Number.isInteger(i) && i >= 0 && i < rows.length ? rows[i]! : null;
  };

  let applyingExternal = false;
  const bridge = makeBridge({
    setHover: (key) => { applyingExternal = true; state.hover.value = datumAt(key); applyingExternal = false; },
    setSelect: (key) => { applyingExternal = true; state.selected.value = datumAt(key); applyingExternal = false; },
  });
  (host as ElementWithBridge).brSync = bridge;

  const hoverDispose = biEffect(() => {
    const h = state.hover.value;
    if (applyingExternal) return;
    bridge.emitHover(idxOf(h));
  });
  const selectDispose = biEffect(() => {
    const sel = state.selected.value;
    if (applyingExternal) return;
    bridge.emitSelect(idxOf(sel));
  });

  return () => {
    host.removeEventListener("pointerleave", onPointerLeave);
    host.removeEventListener("click", onClick);
    host.removeEventListener("wheel", onWheel);
    host.removeEventListener("keydown", onKeydown);
    host.removeEventListener("pointerdown", onPointerDown);
    host.removeEventListener("pointermove", onPointerMove);
    // If this host's drag is the live one, revert+tear it down. (The shared
    // wheel commits on modifier-release/blur; nothing host-local to clean up.)
    if (dragPointerId !== -1) dragController.cancel();
    hoverDispose();
    selectDispose();
    (host as ElementWithBridge).brSync = undefined;
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
