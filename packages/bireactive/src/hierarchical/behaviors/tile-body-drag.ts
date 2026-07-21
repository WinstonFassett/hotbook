// behaviors/tile-body-drag.ts — drag-to-resize a tile by dragging its body.
//
// The drag is proportional to the tile's pixel span along the sibling axis:
// dragging the tile by its full width doubles its value, matching the visual
// exactly. This is the same approach as the splitter (pairTotal / pairPixelSpan)
// — applied to a single tile (startVal / tilePixelSpan).
//
// Travel is along the sibling axis only: right = grow for vertical orientation
// (siblings along x), up = grow for horizontal orientation (siblings along y).
// The visual feedback is along that axis, so proportionality requires matching
// it. The number-scrubber convention (up/right = grow) is preserved per-axis.
//
// Value-mapping is governed by config.conservationMode (additive /
// proportional-neighbor / proportional-siblings), same as keyboard edit. No
// alt-flip — without a splitter there's no clear "neighbor" to flip to, so the
// mode is a config choice, not a per-gesture toggle. This is the per-item
// gesture — the splitter (edge handle) is always two-sibling reapportion and
// ignores conservationMode.
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
import { applyConservedDelta, type ConservationContext } from "./conservation";
import { captureOrderFromWindow } from "./preview-full-render";

/** Click-vs-drag threshold in pixels. Below this, pointerup is a click. */
const DRAG_THRESHOLD_PX = 3;

export interface TileBodyDragOptions {
  /** Getter for the hovered or focused node id (drag target). */
  target: GestureGetter<string | null>;
  /** Getter for a function that returns the current value of a node by id. */
  valueOf: GestureGetter<(id: string) => number>;
  /** Function to write a value into the reactive tree. */
  writeValue: (id: string, value: number) => void;
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
  /** Value-mapping for the drag. Default: "proportional-siblings" (the
   *  icicle body-drag semantic). Treemap passes "additive" per its spec
   *  (drag-mark-resize: only the dragged tile's value changes). */
  mode?: GestureGetter<"additive" | "proportional-neighbor" | "proportional-siblings">;
  /** Drag axis override. Default: derived from config.orientation (the
   *  icicle sibling axis). Treemap passes "x" (horizontal scrub, right = +). */
  axis?: "x" | "y";
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
    let valueScale = 0; // value per pixel along the sibling axis
    let isHoriz = false;

    const unsubCancel = gesture.editor.subscribe((t) => {
      if (t.type === "cancel") {
        active = false;
        moved = false;
        pointerId = -1;
        targetId = null;
        valueScale = 0;
        gesture.store.activeTarget = null;
      }
    });

    const onMove = (e: PointerEvent) => {
      if (pointerId === -1 || e.pointerId !== pointerId) return;
      if (!targetId) return;

      const dx = e.clientX - startX;
      const dy = startY - e.clientY; // up = positive
      // Travel along the sibling axis only (right for vertical, up for horizontal).
      const travel = isHoriz ? dy : dx;

      if (!moved && Math.abs(travel) < DRAG_THRESHOLD_PX) {
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
      restoreFromSnapshot(gesture);

      // Proportional scaling: travel pixels × (startVal / tilePixelSpan) = value delta.
      // Dragging the tile by its full span doubles its value — matches the visual.
      const delta = travel * valueScale;
      // Body drag always distributes across ALL siblings (proportional-siblings).
      // conservationMode (which may be proportional-neighbor) doesn't apply here —
      // without a boundary there's no way to know which neighbor the user means.
      // The splitter is the pair operation; the body drag is the all-siblings one.
      const ctx: ConservationContext = {
        valueOf: opts.valueOf(gesture),
        writeValue: opts.writeValue,
        siblings: opts.siblings(gesture),
        snapshot: gesture.store.snapshot,
      };
      applyConservedDelta(ctx, targetId, delta, opts.mode ? opts.mode(gesture) : "proportional-siblings");

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
      valueScale = 0;
      gesture.store.activeTarget = null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (gesture.state === "Drafting") return; // one gesture at a time
      // Ignore pointerdown outside the SVG (breadcrumb buttons, chrome layer) —
      // setPointerCapture would steal the click from HTML elements.
      if (!(e.target as Element)?.closest?.("svg")) return;

      // Resolve target from the hovered/focused tile.
      const id = opts.target(gesture);
      if (!id) return;

      // Don't start a body drag on the root tile (root is not editable, same
      // as wheel/keyboard).
      const sibs = opts.siblings(gesture)(id);
      if (sibs.length === 0) return; // root has no siblings → not editable

      // Read orientation from config to determine the sibling axis, unless
      // the chart pinned an explicit drag axis (treemap: horizontal scrub).
      const config = gesture.store.config.value;
      isHoriz = opts.axis ? opts.axis === "y" : config.orientation === "horizontal";

      // Capture the target tile's pixel span along the sibling axis from the DOM.
      // This makes the drag proportional: dragging by the tile's full span doubles
      // its value, matching the visual exactly (same approach as the splitter).
      const tileG = host.querySelector(`g[data-id="${id}"]`);
      const tileEl = tileG?.querySelector("rect") ?? tileG?.querySelector("circle");
      const tileRect = tileEl?.getBoundingClientRect();
      if (!tileRect) return;
      const pixelSpan = isHoriz ? tileRect.height : tileRect.width;
      if (pixelSpan <= 0) return;

      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startVal = opts.valueOf(gesture)(id);
      valueScale = startVal / pixelSpan;
      moved = false;
      active = true;
      targetId = id;

      try { (host as any).setPointerCapture?.(pointerId); } catch { /* ok */ }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      // Don't preventDefault on pointerdown — it suppresses dblclick events,
      // which we need for drill. Text selection / default drag is prevented
      // via CSS user-select:none on the host instead.
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
