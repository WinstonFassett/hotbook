// behaviors/tile-body-drag.ts — drag-to-resize a tile by dragging its body.
// The number-scrubber convention: drag up or right = grow, drag down or left =
// shrink. Both axes contribute (magnitude from total travel, sign by direction)
// — the user is dragging a *number*, not a *boundary*, so orientation doesn't
// enter it.
//
// Value-mapping is governed by config.conservationMode (additive /
// proportional-neighbor / proportional-siblings), same as keyboard edit. This
// is the per-item gesture — the splitter (edge handle) is always two-sibling
// reapportion and ignores conservationMode.
//
// Click-vs-drag: a pointerdown that doesn't move past a 3px threshold is a
// click (focus the tile), not a drag. This preserves the existing click-to-
// focus behavior that numberDrag would have killed (it calls
// preventDefault/stopPropagation on pointerdown unconditionally).
//
// Routes through the Gesture/Editor draft system (not numberDrag's direct-set)
// so cross-tile sync, gesture-active class suppression, and Esc-revert all
// work via the existing plumbing.

import type { Gesture, Behavior, GestureGetter } from "../gesture";
import type { ConservationMode } from "./keyboard-edit";
import { applyConservedDelta, effectiveMode, type ConservationContext } from "./conservation";
import { captureOrderFromWindow } from "./preview-full-render";

/** Click-vs-drag threshold in pixels. Below this, pointerup is a click. */
const DRAG_THRESHOLD_PX = 3;
/** Pixels of pointer travel per +1 unit of value. */
const PX_PER_UNIT = 4;

export interface TileBodyDragOptions {
  /** Getter for the hovered or focused node id (drag target). */
  target: GestureGetter<string | null>;
  /** Getter for a function that returns the current value of a node by id. */
  valueOf: GestureGetter<(id: string) => number>;
  /** Function to write a value into the reactive tree. */
  writeValue: (id: string, value: number) => void;
  /** Getter for the conservation mode. */
  conservationMode: GestureGetter<ConservationMode>;
  /** Getter for a function that returns sibling ids of a node's parent group. */
  siblings: GestureGetter<(id: string) => string[]>;
  /** Getter for the frozen order map (or null). */
  frozenOrder: GestureGetter<Map<string, string[]> | null>;
  /** The rendered window cell (for capturing frozen order at gesture start). */
  windowGetter: GestureGetter<readonly { id: string }[] | null>;
  /** The frozen-order cell to write at gesture start (when sort !== 'index'). */
  frozenOrderCell: { value: Map<string, string[]> | null };
  /** Whether sort !== 'index' (so we need to freeze order during the gesture). */
  deferSort: GestureGetter<boolean>;
  /** Focus the tile on click (no-drag pointerup). */
  focusTile: (id: string) => void;
}

export function tileBodyDrag(opts: TileBodyDragOptions): Behavior {
  return (gesture: Gesture) => {
    const host = gesture.store.host;
    if (!host) return () => {};

    let active = false;
    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let startVal = 0;
    let moved = false;
    let targetId: string | null = null;

    const unsubCancel = gesture.editor.subscribe((t) => {
      if (t.type === "cancel") {
        active = false;
        moved = false;
        pointerId = -1;
        targetId = null;
        gesture.store.activeTarget = null;
      }
    });

    const onMove = (e: PointerEvent) => {
      if (pointerId === -1 || e.pointerId !== pointerId) return;
      if (!targetId) return;

      const dx = e.clientX - startX;
      const dy = startY - e.clientY; // up = positive
      const travel = dx + dy; // up/right = grow, down/left = shrink

      if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
        return; // still a potential click
      }

      if (!moved) {
        moved = true;
        // First real movement — start the gesture.
        gesture.store.takeSnapshot?.();
        gesture.store.activeTarget = targetId;

        // Capture frozen order before draft (same as splitter / startGesture).
        if (opts.deferSort(gesture) && !opts.frozenOrderCell.value) {
          const order = captureOrderFromWindow(opts.windowGetter(gesture));
          opts.frozenOrderCell.value = order;
          gesture.store.frozenOrder = order;
        }

        const valueFn = opts.valueOf(gesture);
        const frozenOrder = opts.frozenOrder(gesture);
        gesture.draft({
          nodeId: targetId,
          value: valueFn(targetId),
          source: "tile-body",
          intent: "edit",
          frozenOrder: frozenOrder ?? undefined,
        });
      }

      // Restore from snapshot so each frame starts from clean baseline.
      // The gesture store's restore function handles this.
      gesture.store.takeSnapshot && restoreFromSnapshot(gesture);

      const delta = travel / PX_PER_UNIT;
      const mode = effectiveMode(opts.conservationMode(gesture), e.altKey);
      const ctx: ConservationContext = {
        valueOf: opts.valueOf(gesture),
        writeValue: opts.writeValue,
        siblings: opts.siblings(gesture),
        snapshot: gesture.store.snapshot,
      };
      applyConservedDelta(ctx, targetId, delta, mode);

      const valueFn = opts.valueOf(gesture);
      const frozenOrder = opts.frozenOrder(gesture);
      gesture.updateDraft({
        nodeId: targetId,
        value: valueFn(targetId),
        source: "tile-body",
        intent: "edit",
        frozenOrder: frozenOrder ?? undefined,
      });
    };

    const onUp = (e: PointerEvent) => {
      if (pointerId === -1 || e.pointerId !== pointerId) return;
      const wasClick = !moved;

      try { (host as any).releasePointerCapture?.(pointerId); } catch { /* ok */ }
      pointerId = -1;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);

      if (wasClick && targetId) {
        // No movement → click → focus the tile.
        opts.focusTile(targetId);
      } else if (active && gesture.state === "Drafting") {
        gesture.commit();
      }
      active = false;
      moved = false;
      targetId = null;
      gesture.store.activeTarget = null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (gesture.state === "Drafting") return; // one gesture at a time

      // Resolve target from the hovered/focused tile.
      const id = opts.target(gesture);
      if (!id) return;

      // Don't start a body drag on the root tile (root is not editable, same
      // as wheel/keyboard).
      const sibs = opts.siblings(gesture)(id);
      if (sibs.length === 0) return; // root has no siblings → not editable

      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startVal = opts.valueOf(gesture)(id);
      moved = false;
      active = true;
      targetId = id;

      try { (host as any).setPointerCapture?.(pointerId); } catch { /* ok */ }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      e.preventDefault();
    };

    host.addEventListener("pointerdown", onDown);

    return () => {
      unsubCancel();
      host.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  };
}

/** Restore all leaf values from the gesture snapshot. */
function restoreFromSnapshot(gesture: Gesture): void {
  const root = gesture.store.tree?.value;
  if (!root || !gesture.store.snapshot) return;
  function walk(n: typeof root) {
    if (n.children.length === 0) {
      const v = gesture.store.snapshot!.get(n.id);
      if (v !== undefined) n.value.value = v;
    } else {
      for (const c of n.children) walk(c);
    }
  }
  walk(root);
}
