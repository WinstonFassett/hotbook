// Shared boundary-knob handle window derivation for hierarchical charts.
//
// A boundary handle sits between two adjacent siblings at the same depth and
// lets the user drag to reapportion the values of the two peers (sum preserved
// by a Num.lens). Sunburst uses angular position for adjacency; icicle/treemap
// use rectangular sibling-axis position; pack has no natural boundary handle
// but could opt in per depth ring if desired later.
//
// Two things are shared:
//   1) The `derive` that emits the ordered `{ aNode, bNode }` pair list from
//      `renderedSet` + `nodeDepth` + a per-depth sort comparator.
//   2) The gesture-freeze contract that keeps the pair list identical while
//      the chart host has `GESTURE_ACTIVE_CLASS`, so `forEach(..., { key })`
//      does not tear down a live `dragCancelable` handle mid-gesture
//      (root cause of WIN-257).
//
// ── Key contract ─────────────────────────────────────────────────────────────
// The `forEach` key MUST be a function of the two node identities only —
// never of layout state (x0/y0) or of the pair index within a depth. Because
// nodes carry stable `value.id` strings, `${aId}:${bId}` is the canonical
// key. The `defaultBoundaryKey` export codifies this so every chart uses the
// same shape.
//
// Even with a stable key, the pair identity itself changes when siblings are
// re-ranked (sort:value on sunburst; a reorder gesture on icicle). During an
// active gesture we therefore freeze the whole window: the derive returns the
// snapshotted list unchanged so the pair identities — and thus the keys —
// don't move. The chart flips `GESTURE_ACTIVE_CLASS` on pointerdown/up as it
// already does to suppress CSS transitions.
//
// ── Treemap / pack integration ───────────────────────────────────────────────
// Treemap and pack are not yet wired in. Design notes:
//
// * Treemap (slice / dice / slice-and-dice): siblings share a 1D partition
//   axis per parent (children of a horizontally-sliced parent split along x;
//   vertically-sliced along y). This helper works as-is when the axis is
//   chosen per parent — pass `compareSiblings` that reads the child's own
//   `x0`/`y0` on the parent's split axis. The `byDepth` grouping in this
//   helper is currently by absolute depth, which fuses adjacency across
//   parents; treemap needs adjacency scoped to `(depth, parent)`. Extend the
//   helper with an optional `siblingGroup(node) => key` predicate before the
//   treemap migration — sunburst / icicle default to `depth`.
//
// * Treemap (squarified): adjacency is 2D. Every child has up to four
//   neighbours (left / right / top / bottom), so 1D pairing under-serves it.
//   A future variant should emit one handle per shared edge and derive the
//   edge geometry (endpoints + orientation) here so the chart only supplies
//   the peer-value lens.
//
// * Pack: no natural pairwise boundary — sibling circles touch at points, not
//   along an edge. Drag-a-boundary UX doesn't apply; pack should stay with
//   per-node radius knobs instead of adopting this helper.

import { derive, readNow, type Val } from "bireactive";
import { GESTURE_ACTIVE_CLASS } from "./transitions";

export type BoundaryHandleItem<N> = { aNode: N; bNode: N };

export interface BoundaryHandlesOptions<N> {
  /** Nodes currently rendered (includes exit-delay holds). Iterable list is fine — order is ignored, sorting happens per depth via `compareSiblings`. */
  renderedSet: Val<Iterable<N>>;
  /** Depth lookup. Structure-scoped map is fine — pass the getter, not a Val. */
  nodeDepth: (node: N) => number;
  /** Current focused depth (drill level). Handles are only emitted at depths `> focusDepth`. */
  focusDepth: Val<number>;
  /** Total tree depth. Handles are only emitted at depths `<= focusDepth + maxDepth` (or `<= totalDepth` when uncapped). */
  totalDepth: Val<number> | number;
  /** Optional depth cap window from focus. Missing / `<= 0` disables the cap. */
  maxDepth?: Val<number | undefined>;
  /**
   * Order siblings at a single depth level. Called during derivation, so any
   * reactive reads inside are tracked and will re-run the derive on change —
   * except while the host is gesture-active, when the frozen list is returned
   * unchanged.
   */
  compareSiblings: (a: N, b: N) => number;
  /**
   * Chart host element. When it carries `GESTURE_ACTIVE_CLASS`, the derive
   * returns the last-computed list unchanged. Omit only for tests / charts
   * that never route gestures through the host class.
   */
  gestureHost?: Element;
}

/**
 * Canonical key builder for `forEach(handleLayer, handleWindow, ..., { key })`.
 * Nodes are required to expose `value.id` (BiNode contract). The key is a pure
 * function of node identity — never of pair position — so a re-emit with the
 * same pair keeps the same handle instance and its live `dragCancelable` state.
 */
export function defaultBoundaryKey<N extends { value: { id?: string } }>(
  item: BoundaryHandleItem<N>,
): string {
  return `${item.aNode.value.id ?? ""}:${item.bNode.value.id ?? ""}`;
}

/**
 * Derive the ordered `{ aNode, bNode }` list from a rendered set. Groups nodes
 * by depth, sorts each depth's siblings via `compareSiblings`, then emits
 * adjacent pairs.
 *
 * See the file header for the key-stability contract this collaborates with.
 */
export function boundaryHandles<N>(
  options: BoundaryHandlesOptions<N>,
): Val<readonly BoundaryHandleItem<N>[]> {
  const {
    renderedSet,
    nodeDepth,
    focusDepth,
    totalDepth,
    maxDepth,
    compareSiblings,
    gestureHost,
  } = options;

  let frozen: readonly BoundaryHandleItem<N>[] | null = null;

  return derive((): readonly BoundaryHandleItem<N>[] => {
    if (
      gestureHost &&
      frozen &&
      gestureHost.classList.contains(GESTURE_ACTIVE_CLASS)
    ) {
      return frozen;
    }

    const fd = readNow(focusDepth);
    const totalD = readNow(totalDepth);
    const rawMaxD = maxDepth === undefined ? undefined : readNow(maxDepth);
    const capped = rawMaxD !== undefined && rawMaxD > 0;
    const maxWindow = capped ? fd + rawMaxD! : totalD;

    const byDepth = new Map<number, N[]>();
    for (const n of readNow(renderedSet)) {
      const d = nodeDepth(n);
      if (d <= fd || d > maxWindow) continue;
      let bucket = byDepth.get(d);
      if (!bucket) { bucket = []; byDepth.set(d, bucket); }
      bucket.push(n);
    }

    const items: BoundaryHandleItem<N>[] = [];
    for (const nodes of byDepth.values()) {
      nodes.sort(compareSiblings);
      for (let i = 1; i < nodes.length; i++) {
        items.push({ aNode: nodes[i - 1]!, bNode: nodes[i]! });
      }
    }

    frozen = items;
    return items;
  });
}
