// Shared interaction layer for cartesian (x-bisect) charts.
// Mirrors attachChartGestures for hierarchical charts.

import { wheelController, dragController } from "./interaction";
import type { ChartContext } from "./chart-context";
import { bisector } from "d3-array";
import { effect as biEffect } from "bireactive";
import type { Cell, Writable } from "bireactive";
import { makeBridge, type ElementWithBridge } from "./hud-bridge";
import { GESTURE_ACTIVE_CLASS } from "./transitions";

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
  /**
   * When provided and it returns false, value-edit gestures (drag, wheel,
   * arrow up/down) are disabled — e.g. a read-only tile. Defaults to always
   * editable. NOTE: do NOT wire this to sort state; sorting by value must not
   * disable editing.
   */
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

  // Frozen snapshot of order() taken at gesture-start, used by keyboard nav and
  // datumAt during a gesture so they read a stable list while values churn.
  // (Bridge identity is by datum id now, so a shifted order can't mis-resolve.)
  let gestureOrder: TData[] | null = null;

  // Per-gesture value-mapping handed to the SHARED wheel/drag controllers (app-
  // wide singletons; one pointer → one live gesture).
  const setGestureActive = (on: boolean) => host.classList.toggle(GESTURE_ACTIVE_CLASS, on);

  const wheelConfig = {
    snapshot: (d: TData) => { setGestureActive(true); return ctx.yAcc(d) as number; },
    restore: (d: TData, v: number) => mutateDatum(d, v - (ctx.yAcc(d) as number)),
    onEnd: () => { setGestureActive(false); state.hover.value = null; gestureOrder = null; host.dispatchEvent(new CustomEvent("gesturecommit")); },
  };

  // Captured at pointerdown, read by dragConfig.snapshot (called inside begin()).
  let dragStartY = 0;
  let dragStartScale: any = null;

  // Move handler the drag controller invokes while a drag is live.
  // snapshot = { origValue, startY, startScale } captured at pointerdown.
  // We derive delta from (currentY - startY) in the ORIGINAL scale, so the
  // computed delta is immune to domain re-derivation mid-drag (which would
  // cause the "spike" bug: scale shifts → invert(y) jumps → value rockets).
  let dragPointerId = -1;
  const onDragMove = (pe: PointerEvent, snap: { origValue: number; startY: number; startScale: any }) => {
    const t = dragController.target as TData | null;
    if (!t) return;
    const { y } = localPoint(pe);
    const valueDelta = snap.startScale.invert(y) - snap.startScale.invert(snap.startY);
    mutateDatum(t, snap.origValue + valueDelta - (ctx.yAcc(t) as number));
  };
  const dragConfig = {
    snapshot: (d: TData) => {
      setGestureActive(true);
      return {
        origValue: ctx.yAcc(d) as number,
        startY: dragStartY,
        startScale: dragStartScale,
      };
    },
    restore: (d: TData, snap: { origValue: number }) => mutateDatum(d, snap.origValue - (ctx.yAcc(d) as number)),
    onMove: onDragMove,
    onEnd: () => {
      if (dragPointerId >= 0 && (host as any).hasPointerCapture?.(dragPointerId)) {
        (host as any).releasePointerCapture(dragPointerId);
      }
      dragPointerId = -1;
      dragStartY = 0;
      dragStartScale = null;
      gestureOrder = null;
      host.style.cursor = "";
      (host as any).gestureActive = false;
      setGestureActive(false);
      host.dispatchEvent(new CustomEvent("gesturecommit"));
    },
  };

  const onPointerLeave = () => { if (wheelController.active) return; state.hover.value = null; };

  const onClick = (e: Event) => {
    const { x } = localPoint(e as PointerEvent);
    if (x < ctx.plotX || x > ctx.plotX + ctx.rPlotWidth.value) return;
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
    if (x < ctx.plotX || x > ctx.plotX + ctx.rPlotWidth.value) return;
    const pt = findAtPixel(x);
    if (!pt) return;
    if (Math.abs(y - yPixel(pt)) > 12) return;
    gestureOrder = order();
    dragPointerId = pe.pointerId;
    dragStartY = y;
    dragStartScale = ctx.yScale.value;
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
    if (x < ctx.plotX || x > ctx.plotX + ctx.rPlotWidth.value) { state.hover.value = null; host.style.cursor = ""; return; }
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
  const idOf = (d: TData | null): string | null =>
    d == null ? null : ((d as { id?: string }).id ?? null);
  const datumAt = (id: string | null): TData | null => {
    if (id == null) return null;
    const rows = gestureOrder ?? order();
    return rows.find(d => (d as { id?: string }).id === id) ?? null;
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
    bridge.emitHover(idOf(h));
  });
  const selectDispose = biEffect(() => {
    const sel = state.selected.value;
    if (applyingExternal) return;
    bridge.emitSelect(idOf(sel));
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
