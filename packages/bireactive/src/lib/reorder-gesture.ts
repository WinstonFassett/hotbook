// Shared drag-to-reorder gesture for charts sorted by natural order.
//
// Design context: wiki/interaction-principles.md. Rules honored here:
//   - Rule 2 (scale stability): during the gesture, layout freezes.
//   - Rule 5 (atomicity): threads through the ONE dragController — no other
//     drag can begin while a reorder is live.
//   - Rule 6 (speculative): preview is imperative; data is not touched until
//     commit. Esc reverts via dragController's Esc contract.
//   - Rule 7 (derived reorders defer to commit): the provisional order is a
//     local array; onReorder(ids) fires only on release-with-change.
//
// The five-layer split (Layer 3 = provisional order, Layer 4 = preview,
// Layer 5 = commit) is the same for pie, bar, sunburst, gantt. Per-chart
// hooks: computeTargetIndex (pointer → slot) and onPreview (imperative draw).

import { dragController } from "./interaction";
import { GESTURE_ACTIVE_CLASS } from "./transitions";

export interface ReorderGestureConfig {
  /** Element that receives pointerdown to start a reorder drag. Usually the
   *  data mark (Rule 8: affordance not chrome), but can be a dedicated grip. */
  hitEl: SVGElement | HTMLElement;
  /** Stable id of the item this hit-element represents. */
  itemId: string;
  /** Host element that carries GESTURE_ACTIVE_CLASS. Reactive layout effects
   *  check this class to skip work while a gesture is live. */
  host: HTMLElement;
  /** Snapshot the initial id sequence at pointerdown. */
  getInitialOrder: () => string[];
  /** Map pointer to a target slot index. Called on every pointermove. Return
   *  in [0, order.length - 1]; helper clamps into range. Radial charts return
   *  angle-derived index; row/column charts return position-derived index. */
  computeTargetIndex: (e: PointerEvent, initialOrder: readonly string[]) => number;
  /** Called once when the drag crosses the activation threshold. Set cursor,
   *  raise dragged element, etc. */
  onActivate?: () => void;
  /** Called on every pointermove after activation, with the current provisional
   *  order and pointer event. Caller writes ghost geometry (dragged item at
   *  pointer position) and updates siblings to their new slots. */
  onPreview: (order: readonly string[], e: PointerEvent) => void;
  /** Fires on gesture end. When `canceled` is true, Esc was pressed and the
   *  caller should revert to initial. When false and order changed, the caller
   *  should fire its user-facing `onReorder(ids)`. Always called after
   *  activation so cursor/highlight can be cleared. Never called when the
   *  gesture didn't activate (below threshold) — helper handles that. */
  onEnd: (finalOrder: readonly string[], canceled: boolean) => void;
  /** Pixel threshold before a drag counts as reorder (vs click). Default 5. */
  activationThreshold?: number;
}

export function attachReorderGesture(cfg: ReorderGestureConfig): () => void {
  const { hitEl, host, activationThreshold = 5 } = cfg;
  const threshSq = activationThreshold * activationThreshold;

  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let activated = false;
  let initialOrder: string[] = [];
  let currentOrder: string[] = [];

  const setGestureActive = (on: boolean) => host.classList.toggle(GESTURE_ACTIVE_CLASS, on);

  const applyProvisional = (e: PointerEvent) => {
    const raw = cfg.computeTargetIndex(e, initialOrder);
    const without = initialOrder.filter((id) => id !== cfg.itemId);
    const idx = Math.max(0, Math.min(without.length, Math.floor(raw)));
    const next = [...without.slice(0, idx), cfg.itemId, ...without.slice(idx)];
    let changed = next.length !== currentOrder.length;
    for (let i = 0; !changed && i < next.length; i++) if (next[i] !== currentOrder[i]) changed = true;
    if (changed) currentOrder = next;
    cfg.onPreview(currentOrder, e);
  };

  const onPointerDown = (e: Event) => {
    if (dragController.active) return;
    const pe = e as PointerEvent;
    pointerId = pe.pointerId;
    startX = pe.clientX;
    startY = pe.clientY;
    activated = false;
    initialOrder = cfg.getInitialOrder();
    currentOrder = initialOrder.slice();

    try { hitEl.setPointerCapture(pointerId); } catch { /* ignored */ }

    dragController.begin(true, {
      snapshot: () => initialOrder.slice(),
      restore: () => {
        // Esc: revert preview to initial. Caller's onEnd(canceled=true) does the
        // visual reset (we can't do it here without knowing the chart's geometry).
        currentOrder = initialOrder.slice();
      },
      onMove: (pe2: PointerEvent) => {
        if (!activated) {
          const dx = pe2.clientX - startX;
          const dy = pe2.clientY - startY;
          if (dx * dx + dy * dy < threshSq) return;
          activated = true;
          setGestureActive(true);
          cfg.onActivate?.();
        }
        applyProvisional(pe2);
      },
      onEnd: (canceled: boolean) => {
        try { hitEl.releasePointerCapture(pointerId); } catch { /* ignored */ }
        pointerId = -1;
        const wasActivated = activated;
        activated = false;
        if (wasActivated) {
          setGestureActive(false);
          cfg.onEnd(currentOrder, canceled);
        }
        // Below threshold: not a drag — treat as click, no onEnd call. Host may
        // still receive the click via normal DOM event bubbling.
      },
    });
  };

  hitEl.addEventListener("pointerdown", onPointerDown);
  // Touch: page scroll must lose to the reorder gesture.
  const prevTouchAction = (hitEl as HTMLElement).style?.touchAction;
  if ((hitEl as HTMLElement).style) (hitEl as HTMLElement).style.touchAction = "none";

  return () => {
    hitEl.removeEventListener("pointerdown", onPointerDown);
    if ((hitEl as HTMLElement).style && prevTouchAction != null) (hitEl as HTMLElement).style.touchAction = prevTouchAction;
    if (pointerId !== -1) dragController.cancel();
  };
}
