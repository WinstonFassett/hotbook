// behaviors/preview-full-render.ts — render behavior: during `draft`, the
// entire chart re-renders with updated values live (the natural bireactive
// cascade). This behavior's specific job is the **frozenOrder** lifecycle:
// when `deferSort` resolves true at gesture start, capture the current
// sibling order and freeze it for the duration of the gesture so siblings
// don't reorder mid-gesture (interaction-principles rule 7 + rule 8 +
// Hierarchical family contract). Clear on commit/cancel.
//
// `deferSort` is a plain getter, read ONCE at gesture start. Not reactive,
// not a Cell — making it reactive would enable the exact thrash the freeze
// exists to prevent (see discussion: a mid-gesture flip either releases the
// freeze early → siblings jump, or captures a corrupted mid-gesture state).
// The decision is made once and held. Configurable at composition time, per
// chart: an icicle passes `() => config.sort !== 'index'`; a treemap could
// pass `() => true`; an experimental chart could pass `() => false`.
//
// This behavior handles the chart's OWN gestures (via Editor subscription).
// Cross-tile drafts (where this chart is a passive receiver) do not fire
// Editor events; chart-binding handles those by applying the incoming
// draft's frozenOrder to the cell. The cell is shared but written by
// different sources at different times (own gesture: Editor Drafting;
// cross-tile: Editor Idle) — no conflict.

import type { Cell, Writable } from "bireactive";
import type { Gesture, Behavior } from "../gesture";
import type { ChartNode, RenderNode } from "../hierarchy";

export interface PreviewFullRenderOptions {
  /** Predicate read once at gesture start. When true, capture and freeze
   *  sibling order for the gesture's duration. Not reactive — see header. */
  deferSort: () => boolean;
  /** The frozen-order cell that derivers (buildAllDescendants, computeLayout) read.
   *  The behavior writes to this cell: set on capture, cleared on commit/cancel. */
  frozenOrder: Writable<Cell<Map<string, string[]> | null>>;
  /** Capture the current sibling order from the tree. Returns a map of
   *  parentId → childIds in current order. */
  captureOrder: () => Map<string, string[]>;
}

/** Capture sibling order from a reactive tree root. NOTE: this captures
 *  the tree's children array order, which is the DATASET order (index
 *  order), NOT the rendered/sorted order. Use `captureOrderFromWindow`
 *  when you need the currently-displayed order (e.g. for freezing sort
 *  during gestures). */
export function captureOrderFromTree(root: ChartNode | null): Map<string, string[]> {
  const order = new Map<string, string[]>();
  if (!root) return order;
  function walk(n: ChartNode) {
    if (n.children.length > 0) {
      order.set(n.id, n.children.map((c) => c.id));
      for (const c of n.children) walk(c);
    }
  }
  walk(root);
  return order;
}

/** Capture the currently-rendered sibling order from the node list (the
 *  output of `buildAllDescendants`). This respects the current sort config
 *  and any existing frozenOrder, so it captures what the user actually sees —
 *  not the dataset's index order. */
export function captureOrderFromWindow(window: RenderNode[] | null): Map<string, string[]> {
  const order = new Map<string, string[]>();
  if (!window) return order;
  for (const rn of window) {
    if (rn.children.length > 0) {
      order.set(rn.id, rn.children.map((c) => c.id));
    }
  }
  return order;
}

export function previewFullRender(opts: PreviewFullRenderOptions): Behavior {
  return (gesture: Gesture) => {
    let captured = false;

    const unsub = gesture.editor.subscribe((t) => {
      if (t.type === "draft" && t.from === "Idle") {
        // Reorder gestures change sibling order live — never freeze.
        if (t.draft?.intent === "reorder") return;
        // Gesture start — read deferSort once, capture if true.
        // If frozenOrder is already set (e.g. startGesture captured it
        // before dispatching the draft), use that — don't re-capture.
        if (!captured && opts.deferSort()) {
          if (!opts.frozenOrder.value) {
            const order = opts.captureOrder();
            opts.frozenOrder.value = order;
          }
          gesture.store.frozenOrder = opts.frozenOrder.value;
          captured = true;
        }
      } else if (t.type === "commit" || t.type === "cancel") {
        opts.frozenOrder.value = null;
        gesture.store.frozenOrder = null;
        captured = false;
      }
    });

    return () => {
      unsub();
      // Defensive: clear if torn down mid-gesture.
      opts.frozenOrder.value = null;
      captured = false;
    };
  };
}
