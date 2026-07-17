// chart-binding.ts — bridges a DataView's events to a chart's reactive tree.
// Extracts the boilerplate event handling (snapshot/commit/cancel/updated)
// that every chart needs. The chart provides its tree root, gesture, and
// a rebuild callback; this module handles the rest.

import type { DataView, DataViewEvent } from "./data-view";
import type { Gesture } from "./gesture";
import type { ChartNode } from "./hierarchy";
import { applyDraft, buildTree, leafValues, restoreValues, snapshotValues } from "./hierarchy";

export interface ChartBinding {
  /** The reactive tree root cell (writable). */
  treeRoot: { value: ChartNode | null };
  /** The gesture (for state + store access). */
  gesture: Gesture;
  /** The data view (for kernel access + config). */
  dataView: DataView;
  /** Called when the tree should be rebuilt from the dataset (updated event). */
  rebuild: () => void;
  /** Called when gesture-active state changes (add/remove CSS class, etc). */
  onActiveChange?: (active: boolean) => void;
  /** Optional: frozen order cell to update on draft/cancel. */
  frozenOrder?: { value: Map<string, string[]> | null };
}

/** Subscribe to a DataView and handle events via the binding.
 *  Returns an unsubscribe function. */
export function bindChart(b: ChartBinding): () => void {
  return b.dataView.subscribe((event: DataViewEvent) => {
    const root = b.treeRoot.value;
    if (!root) return;
    const g = b.gesture;

    if (event.type === "updated") {
      if (g.state === "Drafting") return;
      b.frozenOrder && (b.frozenOrder.value = null);
      g.resetStore();
      b.rebuild();
      return;
    }

    if (event.type === "draft") {
      if (event.isActive) {
        if (!g.store.snapshot) g.store.snapshot = snapshotValues(root);
        return;
      }
      const draft = event.draft!;
      if (!g.store.snapshot) g.store.snapshot = snapshotValues(root);
      applyDraft(root, draft);
      b.frozenOrder && (b.frozenOrder.value = draft.frozenOrder ? new Map(draft.frozenOrder.entries()) : null);
      return;
    }

    if (event.type === "commit") {
      if (event.isActive) {
        const writes = leafValues(root);
        b.dataView.kernel.writeValues(b.dataView.config.datasetId, writes);
      }
      b.frozenOrder && (b.frozenOrder.value = null);
      g.resetStore();
      b.onActiveChange?.(false);
      return;
    }

    if (event.type === "cancel") {
      if (g.store.snapshot) restoreValues(root, g.store.snapshot);
      b.frozenOrder && (b.frozenOrder.value = null);
      g.resetStore();
      b.onActiveChange?.(false);
      return;
    }
  });
}

/** Rebuild the tree from the dataset. */
export function rebuildTree(dataView: DataView, treeRoot: { value: ChartNode | null }): void {
  const ds = dataView.kernel.getDataset(dataView.config.datasetId);
  if (ds) treeRoot.value = buildTree(ds.root);
}
