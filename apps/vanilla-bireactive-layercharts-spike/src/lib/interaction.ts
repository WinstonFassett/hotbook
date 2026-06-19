import { hierarchy } from "d3-hierarchy";
import { effect as biEffect, batch } from "bireactive";
import { leaves, type BiNode } from "./tree";

export function applyDelta(node: BiNode, parent: BiNode | undefined, delta: number): void {
  if (!parent || parent.children.length === 0) return;
  const siblings = parent.children.filter((c) => c !== node) as BiNode[];
  const cur = node.value.total.value;
  const next = Math.max(0, cur + delta);
  const real = next - cur;
  if (real === 0) return;
  // Redistribute the whole resize in ONE batch so the edit fires a single
  // reactive flush. Every sibling is written exactly once from pre-computed
  // sums (poolSum / sibSum / shares captured before any write), so deferred
  // backward writes coalescing inside the batch is safe. The single flush
  // matters in embeddings (e.g. sliceboard) where each separate flush would
  // round-trip through an external store and interleave, snapping the tree
  // back between writes; standalone it's just one tidy update.
  batch(() => {
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
  });
}

export function flatOrder(root: BiNode): BiNode[] {
  const out: BiNode[] = [];
  const walk = (n: BiNode) => {
    if (n !== root) out.push(n);
    (n.children as BiNode[]).forEach(walk);
  };
  walk(root);
  return out;
}

export function buildHierarchy(root: BiNode) {
  return hierarchy<BiNode>(root, (n) => n.children as BiNode[])
    .sum((n) => (n.children.length > 0 ? 0 : n.value.total.value));
}

export function subscribeAllLeaves(root: BiNode, onChange: () => void): () => void {
  const allLeaves = leaves(root);
  return biEffect(() => {
    for (const l of allLeaves) void l.value.total.value;
    onChange();
  });
}

/** Commit a gesture when the edit modifier (Meta/Ctrl) is released or focus is
 *  lost. The returned dispose removes the listeners. */
export function installGestureRelease(release: () => void): () => void {
  const onKeyup = (e: KeyboardEvent) => { if (e.key === "Meta" || e.key === "Control") release(); };
  const onBlur = () => release();
  window.addEventListener("keyup", onKeyup);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keyup", onKeyup);
    window.removeEventListener("blur", onBlur);
  };
}

/**
 * A wheel-edit gesture (cmd/ctrl + wheel). The gesture is the span where a
 * target is locked: it BEGINS on the first cmd+wheel tick and ENDS on either
 * COMMIT (modifier released / blur — keep the edits) or CANCEL (Escape — revert
 * to the snapshot taken at begin).
 *
 * The end-of-gesture listeners (Meta/Ctrl-up + blur to commit, Escape to cancel)
 * exist ONLY for the duration of the gesture — installed at begin, removed at
 * end — exactly like gen-1 VizRenderer's _startResizeDrag/_endResizeDrag. There
 * is no global handler armed while idle: when no gesture is live, Escape is not
 * touched and falls through to the chart's own keydown (clear selection, etc).
 *
 * The Escape and release listeners are on `window` (capture phase) because the
 * chart element is NOT focused during cmd+wheel, so a per-element keydown never
 * fires. Charts vary only in WHAT they lock and HOW they snapshot/restore it.
 *
 *   const g = makeWheelGesture<Datum>({
 *     snapshot: (d) => d.value,            // capture revert state at begin
 *     restore:  (d, s) => setValue(d, s),  // applied on cancel
 *     onEnd:    () => { hover.value = null }, // optional, runs on any end
 *   })
 *   // in onWheel: g.begin(hover ?? selected); const t = g.target; if (!t) return; ...
 *   g.active     // true while a gesture is live (guard hover/pointer handlers)
 */
export interface WheelGesture<T> {
  /** Currently-locked target, or null when idle. */
  readonly target: T | null;
  /** True while a gesture is live (i.e. its end-listeners are installed). */
  readonly active: boolean;
  /** Lock a target and capture its revert snapshot. No-op if already locked. */
  begin(target: T | null): void;
  /** End the gesture, force-cancelling (revert) if still live. For teardown. */
  dispose(): void;
}

export function makeWheelGesture<T>(opts: {
  snapshot: (target: T) => unknown;
  restore: (target: T, snap: any) => void;
  onEnd?: () => void;
}): WheelGesture<T> {
  let target: T | null = null;
  let snap: unknown = undefined;
  let teardown: (() => void) | null = null;

  // Remove the gesture-scoped listeners and clear state. Idempotent.
  const end = () => {
    if (teardown) { teardown(); teardown = null; }
    target = null;
    snap = undefined;
    opts.onEnd?.();
  };

  const commit = () => { if (target !== null) end(); };
  const cancel = (): boolean => {
    if (target === null) return false;
    opts.restore(target, snap);
    end();
    return true;
  };

  return {
    get target() { return target; },
    get active() { return target !== null; },
    begin(t) {
      if (target !== null || t == null) return;
      target = t;
      snap = opts.snapshot(t);
      // Install end-of-gesture listeners for the lifetime of THIS gesture only.
      const onKeyup = (e: KeyboardEvent) => { if (e.key === "Meta" || e.key === "Control") commit(); };
      const onBlur = () => commit();
      const onKeydown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && cancel()) { e.preventDefault(); e.stopPropagation(); }
      };
      window.addEventListener("keyup", onKeyup);
      window.addEventListener("blur", onBlur);
      window.addEventListener("keydown", onKeydown, true);
      teardown = () => {
        window.removeEventListener("keyup", onKeyup);
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("keydown", onKeydown, true);
      };
    },
    dispose() { cancel(); },
  };
}
