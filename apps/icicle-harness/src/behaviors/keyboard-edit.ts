// behaviors/keyboard-edit.ts — shared keyboard editing input behavior.
// Arrow keys on the focused tile edit its value.
// Default value-mapping is governed by config.conservationMode (additive by default).
// Alt → proportional-neighbor (adjacent sibling absorbs equal-opposite delta).
//
// First arrow of a sequence begins a gesture; each keydown (incl. key-repeat)
// applies a fractional dynamic step; Esc reverts the whole sequence;
// keyup of the last held arrow commits.

import type { Gesture, Behavior, GestureGetter } from "../gesture";
import { effectiveMode } from "./conservation";

export type ConservationMode = "additive" | "proportional-neighbor" | "proportional-siblings";

const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

export interface KeyboardEditOptions {
  /** Getter for the focused node id. */
  target: GestureGetter<string | null>;
  /** Getter for a function that returns the current value of a node by id. */
  valueOf: GestureGetter<(id: string) => number>;
  /** Function to write a value into the reactive tree. */
  writeValue: (id: string, value: number) => void;
  /** Getter for the conservation mode. Receives the gesture so it can inspect config + modifiers. */
  conservationMode: GestureGetter<ConservationMode>;
  /** Getter for a function that returns sibling ids of a node's parent group, in order. */
  siblings: GestureGetter<(id: string) => string[]>;
  /** Getter for the frozen order map (or null). */
  frozenOrder: GestureGetter<Map<string, string[]> | null>;
  /** Step fraction of current value (default 0.1 = 10%). */
  stepFraction?: GestureGetter<number>;
  /** Fine step fraction with Shift (default 0.01 = 1%). */
  fineStepFraction?: GestureGetter<number>;
  /** Minimum absolute step (default 1). */
  minStep?: GestureGetter<number>;
}

export function keyboardEdit(opts: KeyboardEditOptions): Behavior {
  return (gesture: Gesture) => {
    const host = gesture.store.host;
    if (!host) return () => {};

    const heldKeys = gesture.store.heldKeys;
    let keySnapshot: Map<string, number> | null = null;
    let keyGestureActive = false;

    // Reset local state when the editor cancels (e.g. global Escape).
    const unsubCancel = gesture.editor.subscribe((t) => {
      if (t.type === "cancel") {
        keyGestureActive = false;
        keySnapshot = null;
        lockedNeighborId = null;
        heldKeys.clear();
        host.classList.remove("gesture-active");
      }
    });

    // Locked neighbor — resolved once at gesture start, reused for all keys.
    let lockedNeighborId: string | null = null;

    const resolveNeighbor = (id: string): string | null => {
      const siblingsFn = opts.siblings(gesture);
      const siblings = siblingsFn(id);
      const idx = siblings.indexOf(id);
      // Prefer next sibling; fall back to previous.
      const neighborIdx = idx + 1 < siblings.length ? idx + 1 : (idx - 1 >= 0 ? idx - 1 : -1);
      return neighborIdx >= 0 ? siblings[neighborIdx] : null;
    };

    const applyDelta = (id: string, delta: number, altMode: boolean) => {
      const mode = effectiveMode(opts.conservationMode(gesture), altMode);
      const valueFn = opts.valueOf(gesture);

      if (mode === "proportional-neighbor") {
        // Use the locked neighbor (resolved at gesture start).
        const neighborId = lockedNeighborId;
        if (neighborId) {
          const cur = valueFn(id);
          const neighborCur = valueFn(neighborId);
          const newSelf = Math.max(0, cur + delta);
          const actualDelta = newSelf - cur;
          const newNeighbor = Math.max(0, neighborCur - actualDelta);
          opts.writeValue(id, newSelf);
          opts.writeValue(neighborId, newNeighbor);
          return { secondaryId: neighborId, secondaryValue: newNeighbor };
        }
        // No neighbor — fall through to additive
      }

      if (mode === "proportional-siblings") {
        const siblingsFn = opts.siblings(gesture);
        const siblings = siblingsFn(id);
        const cur = valueFn(id);
        const newSelf = Math.max(0, cur + delta);
        const actualDelta = newSelf - cur;
        const others = siblings.filter((s) => s !== id);
        const otherTotal = others.reduce((sum, s) => sum + valueFn(s), 0);
        if (otherTotal <= 0) {
          opts.writeValue(id, newSelf);
          return null;
        }
        for (const s of others) {
          const sCur = valueFn(s);
          const share = otherTotal > 0 ? (sCur / otherTotal) * actualDelta : 0;
          opts.writeValue(s, Math.max(0, sCur - share));
        }
        opts.writeValue(id, newSelf);
        return null;
      }

      // Additive
      const cur = valueFn(id);
      const newVal = Math.max(0, cur + delta);
      opts.writeValue(id, newVal);
      return null;
    };

    const revertSnapshot = () => {
      if (keySnapshot) {
        for (const [id, val] of keySnapshot) opts.writeValue(id, val);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Escape is handled globally — just stop if no longer drafting.
      if (e.key === "Escape") return;
      if (!ARROW_KEYS.includes(e.key)) return;

      const targetId = opts.target(gesture);
      if (!targetId) return;

      e.preventDefault();

      // First arrow begins gesture
      if (!keyGestureActive) {
        keyGestureActive = true;
        // Snapshot before first write so cancel can revert.
        gesture.store.takeSnapshot?.();
        // Lock the neighbor for the entire gesture (like an edge handle).
        lockedNeighborId = resolveNeighbor(targetId);
        const siblingsFn = opts.siblings(gesture);
        const siblings = siblingsFn(targetId);
        const valueFn = opts.valueOf(gesture);
        keySnapshot = new Map(siblings.map((id) => [id, valueFn(id)]));
        host.classList.add("gesture-active");

        const frozenOrder = opts.frozenOrder(gesture);
        gesture.draft({
          nodeId: targetId,
          value: valueFn(targetId),
          source: "keyboard",
          intent: "edit",
          frozenOrder: frozenOrder ?? undefined,
        });
      }

      heldKeys.add(e.key);

      // Apply step
      const stepFrac = opts.stepFraction?.(gesture) ?? 0.1;
      const fineFrac = opts.fineStepFraction?.(gesture) ?? 0.01;
      const minStep = opts.minStep?.(gesture) ?? 1;
      const frac = e.shiftKey ? fineFrac : stepFrac;
      const valueFn = opts.valueOf(gesture);
      const cur = valueFn(targetId);
      const step = Math.max(minStep, Math.abs(cur * frac));
      const direction = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : -1;
      const delta = step * direction;

      const result = applyDelta(targetId, delta, e.altKey);
      const frozenOrder = opts.frozenOrder(gesture);

      gesture.updateDraft({
        nodeId: targetId,
        value: valueFn(targetId),
        secondaryNodeId: result?.secondaryId,
        secondaryValue: result?.secondaryValue,
        source: "keyboard",
        intent: "edit",
        frozenOrder: frozenOrder ?? undefined,
      });
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Escape") return; // handled globally
      if (!ARROW_KEYS.includes(e.key)) return;
      if (!keyGestureActive) return;

      heldKeys.delete(e.key);

      // Keyup of last held = commit
      if (heldKeys.size === 0) {
        keyGestureActive = false;
        keySnapshot = null;
        lockedNeighborId = null;
        host.classList.remove("gesture-active");
        gesture.commit();
      }
    };

    // Keyboard events on window so the gesture ends even if focus moved off the chart.
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      unsubCancel();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  };
}
