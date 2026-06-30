// numberDrag — Figma-style scrubber: drag horizontally on a DOM element to
// increment/decrement a value. Right = +, left = −.
//
// Routes through the shared dragController so the rest of the gesture system
// (one-pointer-one-gesture invariant, window-level pointermove/up, Esc revert)
// is reused unchanged. Esc reverts to the gesture-start value via the
// controller's snapshot/restore.
//
// This is the canonical "edit a Num cell with the pointer over its display"
// primitive — used by the gauge center readout, but applicable anywhere a
// scalar is shown.

import { dragController, wheelController, dynamicWheelStep } from "./interaction";

export interface NumberDragOpts {
  /** Get the current value at gesture-start (snapshot) and during drag (read). */
  get: () => number;
  /** Apply a new value. Called for each pointermove and on Esc-revert. */
  set: (v: number) => void;
  /** Pixels of horizontal pointer travel per +1 unit. Default 4. */
  pxPerUnit?: number;
  /** Clamp range; defaults to no clamp. */
  min?: number;
  max?: number;
  /** Multiplier when Shift is held during drag. Default 5 (coarse). */
  shiftMultiplier?: number;
  /** Multiplier when Alt/Option is held. Default 0.1 (fine). */
  altMultiplier?: number;
  /** Called once on gesture-start. */
  onStart?: () => void;
  /** Called once on gesture-end. `canceled` = reverted via Esc. */
  onEnd?: (canceled: boolean) => void;
}

/**
 * Attach number-scrubber drag to `el`. Returns a dispose function that removes
 * the pointerdown listener (and cancels the live gesture if it's mid-drag).
 */
export function numberDrag(el: HTMLElement | SVGElement, opts: NumberDragOpts): () => void {
  const pxPerUnit = opts.pxPerUnit ?? 4;
  const shiftMul = opts.shiftMultiplier ?? 5;
  const altMul = opts.altMultiplier ?? 0.1;
  const clamp = (v: number) => {
    if (opts.min !== undefined && v < opts.min) v = opts.min;
    if (opts.max !== undefined && v > opts.max) v = opts.max;
    return v;
  };

  // Cursor + touch-action so the OS doesn't fight the gesture.
  const prevCursor = el.style.cursor;
  if (!prevCursor) el.style.cursor = "ew-resize";
  (el.style as any).touchAction = "none";

  let pointerId = -1;
  let startX = 0;
  let startVal = 0;

  const onMove = (e: PointerEvent) => {
    if (pointerId === -1 || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    let mul = 1;
    if (e.shiftKey) mul *= shiftMul;
    if (e.altKey) mul *= altMul;
    const next = clamp(startVal + (dx / pxPerUnit) * mul);
    opts.set(next);
  };

  const onDown = (e: Event) => {
    if (dragController.active) return;
    const pe = e as PointerEvent;
    if (pe.button !== 0) return;
    pointerId = pe.pointerId;
    startX = pe.clientX;
    startVal = opts.get();
    try { (el as any).setPointerCapture?.(pe.pointerId); } catch { /* ok */ }
    opts.onStart?.();
    // Hand the shared controller this scrubber's value mapping for the gesture.
    // It owns move/up/Esc and reverts via restore on Esc.
    dragController.begin(el, {
      snapshot: () => startVal,
      restore: (_t, snap: number) => { opts.set(clamp(snap)); },
      onMove,
      onEnd: (canceled) => {
        try { (el as any).releasePointerCapture?.(pointerId); } catch { /* ok */ }
        pointerId = -1;
        opts.onEnd?.(canceled);
      },
    });
    pe.preventDefault();
    pe.stopPropagation();
  };

  el.addEventListener("pointerdown", onDown);

  // Wheel edit (ctrl+wheel / cmd+wheel).
  const wheelConfig = {
    snapshot: () => opts.get(),
    restore: (_t: unknown, snap: number) => { opts.set(clamp(snap)); },
    onEnd: () => { opts.onEnd?.(false); },
  };
  const onWheel = (e: Event) => {
    const we = e as WheelEvent;
    if (!we.ctrlKey && !we.metaKey) return;
    const t = wheelController.begin(el, wheelConfig);
    if (!t) return;
    we.preventDefault();
    const cur = opts.get();
    const step = dynamicWheelStep(cur, we.shiftKey);
    let mul = 1;
    if (we.altKey) mul *= altMul;
    const delta = (we.deltaY < 0 ? step : -step) * mul;
    opts.set(clamp(cur + delta));
    opts.onStart?.();
  };
  el.addEventListener("wheel", onWheel, { passive: false });

  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("wheel", onWheel);
    if (pointerId !== -1) dragController.cancel();
    el.style.cursor = prevCursor;
  };
}
