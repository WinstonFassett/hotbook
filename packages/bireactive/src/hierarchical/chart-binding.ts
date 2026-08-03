// chart-binding.ts — bridges a DataView's events to a chart's reactive tree.
// Extracts the boilerplate event handling (snapshot/commit/cancel/updated)
// that every chart needs. The chart provides its tree root, gesture, and
// a rebuild callback; this module handles the rest.

import type { DataView, DataViewEvent } from "./data-view";
import type { Gesture } from "./gesture";
import type { ChartNode } from "./hierarchy";
import { applyDraft, buildTree, leafValues, restoreValues, snapshotValues } from "./hierarchy";

/** Collect only leaves whose value changed since the snapshot. Falls back
 *  to collecting ALL leaves if no snapshot is available (e.g. gesture
 *  initiated without a draft event). This is the targeted-write replacement
 *  for the old `leafValues(root)` + `writeValues(ALL)` pattern: instead of
 *  writing every leaf to the Kernel on every commit, we write only the
 *  leaves that actually changed. For a single-value edit that's 1 write
 *  instead of N; for a two-sibling reapportion that's 2 writes; for a
 *  treetable parent-edit (total() scales all children) that's K writes
 *  where K = number of leaves in the edited subtree. */
function changedLeaves(
  root: ChartNode,
  snapshot: Map<string, number> | null,
): Array<{ nodeId: string; value: number }> {
  if (!snapshot) return leafValues(root);
  const out: Array<{ nodeId: string; value: number }> = [];
  function walk(n: ChartNode) {
    if (n.children.length === 0) {
      const old = snapshot.get(n.id);
      const cur = n.value.value;
      if (old !== cur) out.push({ nodeId: n.id, value: cur });
    } else {
      for (const c of n.children) walk(c);
    }
  }
  walk(root);
  return out;
}

export interface ChartBinding {
  /** The reactive tree root cell (writable). */
  treeRoot: { value: ChartNode | null };
  /** The gesture (for state + store access). */
  gesture: Gesture;
  /** The data view (for kernel access + config). */
  dataView: DataView;
  /** Called when the tree should be rebuilt from the dataset (updated event). */
  rebuild: () => void;
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
        // Reorder commits: the reorder behavior already called writeReorder
        // before commit (swapping the DataNode children array + publishing).
        // No leaf values changed — skip the value write entirely. Previously
        // this wrote ALL leaves (a no-op that triggered a second _publish +
        // double rebuild on all views).
        if (event.draft?.intent !== "reorder") {
          const writes = changedLeaves(root, g.store.snapshot);
          if (writes.length > 0) {
            b.dataView.kernel.writeValues(b.dataView.config.datasetId, writes);
          }
        }
      }
      // frozenOrder clear on commit/cancel is owned by the previewFullRender
      // behavior (via Editor subscription). chart-binding only clears on
      // `updated` (stale after data change) and applies incoming frozenOrder
      // on cross-tile drafts.
      g.resetStore();
      return;
    }

    if (event.type === "cancel") {
      if (g.store.snapshot) restoreValues(root, g.store.snapshot);
      g.resetStore();
      return;
    }
  });
}

/** Rebuild the tree from the dataset. */
export function rebuildTree(dataView: DataView, treeRoot: { value: ChartNode | null }): void {
  const ds = dataView.kernel.getDataset(dataView.config.datasetId);
  if (ds) treeRoot.value = buildTree(ds.root);
}
