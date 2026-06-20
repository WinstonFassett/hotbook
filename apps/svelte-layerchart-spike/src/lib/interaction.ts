// Shared direct-manipulation logic for the LayerChart hierarchy demos
// (treemap, sunburst, icicle, pack). Each viz differs in geometry but the
// gesture model and write semantics are identical: hover-targeted scrub with
// a sticky modifier-held lock, Tab navigation, arrow nudges, and writes that
// flow through the Num.lens at each branch.

import { hierarchy } from "d3-hierarchy";
import { effect as biEffect } from "bireactive";
import { leaves, type BiNode } from "./tree";

/**
 * Redistribute a value change across the tree so the parent total is preserved.
 * Writes to a branch node go through its Num.lens (children rescale
 * proportionally); siblings of the target absorb the delta either by
 * proportional shrink (growing the target) or proportional grow (shrinking it).
 *
 * `parentOf` resolves a node's parent in the active tree (the parent index is
 * per-root: standalone uses the module sharedTree index, injected roots build
 * their own — see tree.ts::buildParentIndex).
 */
export function applyDelta(
  node: BiNode,
  delta: number,
  parentOf: (n: BiNode) => BiNode | undefined,
) {
  const parent = parentOf(node);
  if (!parent || parent.children.length === 0) return;
  const siblings = parent.children.filter((c) => c !== node) as BiNode[];
  const cur = node.value.total.value;
  const next = Math.max(0, cur + delta);
  const real = next - cur;
  if (real === 0) return;
  node.value.total.value = next;
  let remaining = real;
  if (real > 0) {
    const pool = siblings.filter((s) => s.value.total.value > 0);
    const poolSum = pool.reduce((a, b) => a + b.value.total.value, 0);
    if (poolSum > 0) {
      for (const sib of pool) {
        const share = (sib.value.total.value / poolSum) * real;
        const take = Math.min(sib.value.total.value, share);
        sib.value.total.value -= take;
        remaining -= take;
      }
      for (const sib of siblings) {
        if (remaining <= 0) break;
        const take = Math.min(sib.value.total.value, remaining);
        sib.value.total.value -= take;
        remaining -= take;
      }
    }
  } else if (siblings.length > 0) {
    const sibSum = siblings.reduce((a, b) => a + b.value.total.value, 0);
    if (sibSum > 0) {
      for (const sib of siblings) {
        const share = (sib.value.total.value / sibSum) * -real;
        sib.value.total.value += share;
      }
    } else {
      for (const sib of siblings) sib.value.total.value += -real / siblings.length;
    }
  }
}

/** Depth-first node order, excluding the root. Used for Tab navigation. */
export function flatOrder(root: BiNode): BiNode[] {
  const out: BiNode[] = [];
  const walk = (n: BiNode) => {
    if (n !== root) out.push(n);
    (n.children as BiNode[]).forEach(walk);
  };
  walk(root);
  return out;
}

/**
 * Build a d3 hierarchy snapshot of the given bireactive tree. Caller passes
 * the version signal so this re-runs whenever any leaf cell changes.
 */
export function buildHierarchy(root: BiNode) {
  return hierarchy<BiNode>(root, (n) => n.children as BiNode[])
    .sum((n) => (n.children.length > 0 ? 0 : n.value.total.value));
}

/**
 * Subscribe to every leaf's total in the given tree. Returns the dispose
 * function. Use inside onDestroy. The caller passes a callback that should bump
 * a Svelte $state value, which downstream $derived.by reads to re-run.
 */
export function subscribeAllLeaves(root: BiNode, onChange: () => void) {
  const allLeaves = leaves(root);
  return biEffect(() => {
    for (const l of allLeaves) void l.value.total.value;
    onChange();
  });
}

/**
 * Install a window-level keyup/blur listener that fires `release()` when
 * cmd/ctrl is released or the window loses focus. Used to clear the wheel
 * gesture lock. Element-level listeners miss this because wheels don't
 * transfer focus and inside a customElement shadow root focus often stays
 * on document.body.
 *
 * Call from inside `$effect(() => installGestureRelease(release))` so it
 * tears down with the component.
 */
export function installGestureRelease(release: () => void): () => void {
  const onKeyup = (e: KeyboardEvent) => {
    if (e.key === "Meta" || e.key === "Control" || (!e.metaKey && !e.ctrlKey)) {
      release();
    }
  };
  const onBlur = () => release();
  window.addEventListener("keyup", onKeyup);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keyup", onKeyup);
    window.removeEventListener("blur", onBlur);
  };
}
