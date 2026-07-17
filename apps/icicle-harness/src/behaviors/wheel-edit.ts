// behaviors/wheel-edit.ts — shared wheel editing input behavior.
// cmd/ctrl+wheel over a leaf tile scales that leaf's value.
// Trackpad pinch (synthetic ctrlKey) is treated the same as cmd+wheel.
//
// The gesture lifecycle is tied to the modifier key:
// - ctrl/cmd held + wheel → gesture active (can pause wheeling indefinitely)
// - ctrl/cmd released → commit
// - Escape while held → cancel
//
// The target is resolved ONCE at gesture start (hovered or focused leaf)
// and cached in store.activeTarget.

import type { Gesture, Behavior, GestureGetter } from "../gesture";

export type WheelMapping = "additive" | "proportional";

export interface WheelEditOptions {
  target: GestureGetter<string | null>;
  valueOf: GestureGetter<(id: string) => number>;
  writeValue: (id: string, value: number) => void;
  frozenOrder: GestureGetter<Map<string, string[]> | null>;
  mapping?: GestureGetter<WheelMapping>;
  stepFraction?: GestureGetter<number>;
  fineStepFraction?: GestureGetter<number>;
  minStep?: GestureGetter<number>;
}

export function wheelEdit(opts: WheelEditOptions): Behavior {
  return (gesture: Gesture) => {
    const host = gesture.store.host;
    if (!host) return () => {};

    let active = false;

    // Reset local state when the editor cancels (e.g. global Escape).
    const unsubCancel = gesture.editor.subscribe((t) => {
      if (t.type === "cancel") {
        active = false;
        gesture.store.activeTarget = null;
        host.classList.remove("gesture-active");
      }
    });

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;

      let targetId = gesture.store.activeTarget;
      if (!active) {
        targetId = opts.target(gesture);
        if (!targetId) return;
        gesture.store.activeTarget = targetId;
      }

      e.preventDefault();

      // Snapshot before first write so cancel can revert to pre-gesture values.
      if (!active) {
        gesture.store.takeSnapshot?.();
      }

      const valueFn = opts.valueOf(gesture);
      const currentValue = valueFn(targetId);
      const stepFrac = opts.stepFraction?.(gesture) ?? 0.1;
      const fineFrac = opts.fineStepFraction?.(gesture) ?? 0.01;
      const minStep = opts.minStep?.(gesture) ?? 1;

      const frac = e.shiftKey ? fineFrac : stepFrac;
      const direction = e.deltaY < 0 ? 1 : -1;
      const step = Math.max(minStep, Math.abs(currentValue * frac)) * direction;
      const newValue = Math.max(0, currentValue + step);

      opts.writeValue(targetId, newValue);

      const frozenOrder = opts.frozenOrder(gesture);

      if (!active) {
        active = true;
        host.classList.add("gesture-active");
        // Snapshot before first write so cancel can revert to pre-gesture values.
        if (!gesture.store.snapshot) {
          gesture.store.snapshot = takeSnapshot(gesture);
        }
        gesture.draft({
          nodeId: targetId,
          value: newValue,
          source: "wheel",
          intent: "edit",
          frozenOrder: frozenOrder ?? undefined,
        });
      } else {
        gesture.updateDraft({
          nodeId: targetId,
          value: newValue,
          source: "wheel",
          intent: "edit",
          frozenOrder: frozenOrder ?? undefined,
        });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      // Modifier released → commit. Escape is handled globally.
      if ((e.key === "Control" || e.key === "Meta") && active) {
        active = false;
        gesture.store.activeTarget = null;
        host.classList.remove("gesture-active");
        gesture.commit();
      }
    };

    // Wheel starts on the host; modifier release (commit) is on window
    // so the gesture ends even if focus moved off the chart.
    host.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keyup", onKeyUp);

    return () => {
      unsubCancel();
      host.removeEventListener("wheel", onWheel);
      window.removeEventListener("keyup", onKeyUp);
    };
  };
}
