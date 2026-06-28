// Cancelable shape-handle drag, built on the ONE app-wide drag controller
// (dragController in interaction.ts).
//
// Interaction principle Rule 6 (docs/interaction-principles.md): gestures are
// speculative — Esc reverts to gesture-start state. The Esc listener lives INSIDE
// the drag controller, armed on begin() and torn down on commit/cancel. There is
// no global listener and no registry; exactly one gesture (hence one Esc
// listener) is live at a time. See dragController for the lifecycle.
//
// This file only adapts a bireactive shape handle's pointer input into that
// controller: on pointerdown it hands the controller a per-handle config
// (snapshot/restore/onMove). Manual pixel-space drags (bar/radar/cartesian) call
// dragController.begin directly with their own pointerdown hit-test.

import type { AnyShape, Cell, Vec, Writable } from "bireactive";
import { batch } from "bireactive";
import { dragController } from "./interaction";

function ownTouchGesture(shape: AnyShape): void {
  shape.el.style.touchAction = "none";
  if (shape.intrinsic) shape.intrinsic.style.touchAction = "none";
}

function blockPageScroll(): () => void {
  const onMove = (e: Event) => e.preventDefault();
  document.addEventListener("touchmove", onMove, { passive: false });
  return () => document.removeEventListener("touchmove", onMove);
}

export interface DragCancelableOpts {
  /** Reactive active-state cell (drives handle highlight). */
  dragging?: Writable<Cell<boolean>>;
  /** Extra work on pointerdown. */
  onStart?: () => void;
  /** Extra work on end. `canceled` = reverted via Esc. */
  onEnd?: (canceled: boolean) => void;
  /** Host element — accepted for call-site convenience; unused (the shared drag
   *  controller listens on window, not the host). */
  host?: unknown;
}

/**
 * Drag a shape handle whose motion writes `target` (a Vec.lens over `sources`),
 * with Rule-6 Esc-revert. Snapshots `sources` on pointerdown; reverts them in one
 * batch on Esc. The whole speculative lifecycle (move/up/cancel listeners, Esc,
 * teardown) is owned by the drag controller — this just feeds it the handle's pointer
 * input and a move handler that writes the lens.
 *
 * @param shape   the draggable handle
 * @param target  the Vec.lens drag writes to (sources should be `sources`)
 * @param sources the writable cells the lens mutates — snapshotted for revert
 */
export function dragCancelable(
  shape: AnyShape,
  target: Writable<Vec>,
  sources: ReadonlyArray<Writable<Cell<number>>>,
  opts: DragCancelableOpts = {},
): () => void {
  if (!shape.el.style.cursor) shape.el.style.cursor = "grab";
  ownTouchGesture(shape);

  let dx = 0, dy = 0;
  let unblock: (() => void) | null = null;
  let pointerId = -1;

  // Move writes the lens; the live pointer is mapped to world space, offset by
  // the grab delta captured on pointerdown.
  const onMove = (e: PointerEvent) => {
    if (pointerId === -1 || e.pointerId !== pointerId) return;
    const world = shape.toWorld(e);
    target.value = { x: world.x - dx, y: world.y - dy };
  };

  const offDown = shape.on("pointerdown", (e: Event) => {
    if (dragController.active) return; // one pointer, one live drag
    const pe = e as PointerEvent;
    pointerId = pe.pointerId;
    try { shape.el.setPointerCapture(pointerId); } catch { /* ok */ }
    unblock = blockPageScroll();
    const world = shape.toWorld(pe);
    const v = target.value;
    dx = world.x - v.x;
    dy = world.y - v.y;
    if (opts.dragging) opts.dragging.value = true;
    opts.onStart?.();
    // Hand the shared controller this handle's value-mapping for the gesture.
    // It arms move/up/Esc and reverts the snapshotted cells on Esc.
    dragController.begin(true, {
      snapshot: () => sources.map((c) => c.value),
      restore: (_t, snap: number[]) => {
        batch(() => { sources.forEach((c, i) => { c.value = snap[i]!; }); });
      },
      onMove,
      onEnd: (canceled) => {
        try { shape.el.releasePointerCapture(pointerId); } catch { /* ok */ }
        pointerId = -1;
        unblock?.(); unblock = null;
        if (opts.dragging) opts.dragging.value = false;
        opts.onEnd?.(canceled);
      },
    });
  });

  return () => {
    offDown();
    // If this handle's gesture is the live one, revert+tear it down on dispose.
    if (pointerId !== -1) dragController.cancel();
  };
}
