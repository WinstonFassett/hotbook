import { hierarchy } from "d3-hierarchy";
import { effect as biEffect, batch } from "bireactive";
import { leaves, type BiNode } from "./tree";

/** Per-call scaling mode for {@link applyDelta}. Mirrors the public
 *  `ScalingMode` in @hotbook/core; kept structural so this
 *  package stays leaf-side and doesn't import core. `proportional-selected`
 *  is reserved for the future multiselect work (WIN-38 follow-up) and
 *  currently falls back to `additive`. */
export type ScalingMode =
  | "additive"
  | "proportional-neighbor"
  | "proportional-siblings"
  | "proportional-selected";

export interface ApplyDeltaOptions {
  /** Override the scaling strategy for this call. Default: `proportional-siblings`. */
  mode?: ScalingMode;
  /** Cap for the parent's child-sum. When set, additive growth is clamped so
   *  `sum(children) <= fixedTotal`; siblings are untouched until the cap is hit.
   *  Unused by proportional modes (their sum is invariant by construction). */
  fixedTotal?: number;
}

/** Dynamic wheel step — proportional to current value so the gesture feels the
 *  same at value 5 and value 5000. Shift = fine grain. Always at least 1 so the
 *  edit is observable on small values. */
export function dynamicWheelStep(cur: number, shift: boolean): number {
  const pct = shift ? 0.01 : 0.10;
  return Math.max(1, Math.round(Math.abs(cur) * pct));
}

export function applyDelta(
  node: BiNode,
  parent: BiNode | undefined,
  delta: number,
  options: ApplyDeltaOptions = {},
): void {
  const mode: ScalingMode = options.mode ?? "proportional-siblings";

  // Additive (and the multiselect stub) only touches the target. Still valid
  // when there is no parent (root edit) — that's why this branches first.
  if (mode === "additive" || mode === "proportional-selected") {
    const cur = node.value.total.value;
    let next = Math.max(0, cur + delta);
    if (options.fixedTotal != null && parent) {
      const sibSum = (parent.children as BiNode[])
        .filter((c) => c !== node)
        .reduce((a, b) => a + b.value.total.value, 0);
      next = Math.min(next, Math.max(0, options.fixedTotal - sibSum));
    }
    if (next === cur) return;
    node.value.total.value = next;
    return;
  }

  if (!parent || parent.children.length === 0) return;
  const siblings = parent.children.filter((c) => c !== node) as BiNode[];
  const cur = node.value.total.value;
  const next = Math.max(0, cur + delta);
  const real = next - cur;
  if (real === 0) return;

  // proportional-neighbor: only the immediate next-or-prev sibling absorbs the
  // delta. Fall back to proportional-siblings when there is no single neighbor.
  if (mode === "proportional-neighbor" && siblings.length > 0) {
    const kids = parent.children as BiNode[];
    const idx = kids.indexOf(node);
    const neighbor = (kids[idx + 1] ?? kids[idx - 1]) as BiNode | undefined;
    if (neighbor) {
      const nv = neighbor.value.total.value;
      // Clamp so neither side goes negative.
      const take = real > 0 ? Math.min(real, nv) : Math.max(real, -cur);
      if (take === 0) return;
      batch(() => {
        node.value.total.value = cur + take;
        neighbor.value.total.value = nv - take;
      });
      return;
    }
  }

  // proportional-siblings (default): redistribute the whole resize in ONE
  // batch so the edit fires a single reactive flush. Every sibling is written
  // exactly once from pre-computed sums (poolSum / sibSum / shares captured
  // before any write), so deferred backward writes coalescing inside the batch
  // is safe. The single flush matters in embeddings (e.g. hotbook) where
  // each separate flush would round-trip through an external store and
  // interleave, snapping the tree back between writes; standalone it's just
  // one tidy update.
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

export function buildHierarchy(root: BiNode, sortBy?: 'index' | 'value') {
  const h = hierarchy<BiNode>(root, (n) => n.children as BiNode[])
    .sum((n) => (n.children.length > 0 ? 0 : n.value.total.value));
  if (sortBy === 'value') {
    // Sort by descending value so the largest children draw first in every
    // layout (pack, treemap, icicle, sunburst all respect hierarchy order).
    h.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  }
  return h;
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

// ── Real modifier-key state ──────────────────────────────────────────────
// Trackpad pinch fires wheel events with synthetic ctrlKey=true — the browser
// lies. To distinguish pinch from a real Cmd/Ctrl+wheel, we track whether a
// real modifier key is physically down. This is a lightweight always-on
// boolean tracker (not a gesture handler); it's the same key state the browser
// tracks internally, just made queryable for the synthetic-ctrlKey case.
let _realCtrlDown = false;
let _realMetaDown = false;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Control") _realCtrlDown = true;
    if (e.key === "Meta") _realMetaDown = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "Control") _realCtrlDown = false;
    if (e.key === "Meta") _realMetaDown = false;
  });
  window.addEventListener("blur", () => { _realCtrlDown = false; _realMetaDown = false; });
}
/** True only when a physical Ctrl or Cmd key is held down. Use this (NOT
 *  `e.ctrlKey` on a wheel event) to tell cmd+wheel from trackpad pinch. */
export function realModifierDown(): boolean { return _realCtrlDown || _realMetaDown; }

// ===========================================================================
// ONE wheel controller + ONE drag controller for the WHOLE app.
//
// A human has one pointer. Only one wheel gesture and one drag gesture can ever
// be live at a time, so there is exactly ONE of each controller — a singleton —
// not one instance per chart. Each controller owns the (single) window listener
// set, the Esc-cancel, and the gesture FRAME (the locked target + the snapshot
// taken at begin). Charts own only their target and a pure value-mapping, which
// they hand to begin() per gesture (snapshot/restore differ chart-to-chart, so
// the mapping is per-begin config, not baked into the controller).
//
// Because only one gesture of each kind is ever live, exactly one Esc listener
// of each kind exists at a time — no global idle handlers, no registry, no
// cross-chart interference, by construction. When no gesture is live, Escape is
// untouched and falls through to the chart's own keydown (clear selection, etc).
//
// The listeners are on `window` (capture phase for keydown) because the chart
// element is NOT focused during cmd+wheel or a pointer-captured drag, so a
// per-element keydown never fires.
// ===========================================================================

/** Per-gesture value mapping for a wheel edit. Differs chart-to-chart, so it is
 *  passed to begin() rather than baked into the (shared) controller. */
export interface WheelConfig<T> {
  /** Capture revert state at begin. */
  snapshot: (target: T) => unknown;
  /** Applied on cancel (Esc). */
  restore: (target: T, snap: any) => void;
  /** Runs on any end. `canceled` = reverted via Esc (mirrors DragConfig.onEnd). */
  onEnd?: (canceled: boolean) => void;
}

export interface WheelController {
  /** Currently-locked target, or null when idle. Untyped: the caller holds its
   *  own typed reference; this is for the few sites that re-read across events. */
  readonly target: unknown;
  /** True while a gesture is live (i.e. its end-listeners are installed). */
  readonly active: boolean;
  /** Lock a target and capture its revert snapshot. No-op if already locked.
   *  Returns the locked target (or null) so callers can `const t = begin(...)`.
   *
   *  `opts.pinch = true` when the gesture is a trackpad pinch (synthetic
   *  ctrlKey, no real key press). Pinch gestures can't commit on keyup (no
   *  key was pressed), so they commit on the next non-wheel input instead,
   *  with an idle-timeout fallback. cmd+wheel (real key) keeps keyup commit. */
  begin<T>(target: T | null, config: WheelConfig<T>, opts?: { pinch?: boolean }): T | null;
  /** Force-cancel (revert) if still live. For teardown. */
  cancel(): boolean;
}

function makeWheelController(): WheelController {
  let target: unknown = null;
  let snap: unknown = undefined;
  let cfg: WheelConfig<any> | null = null;
  let teardown: (() => void) | null = null;
  let isPinchGesture = false;
  // After Esc cancels a pinch, the user's fingers are still on the trackpad
  // and wheel events keep coming. Without suppression, the very next event
  // starts a NEW gesture on the same element — Esc appears to do nothing.
  // Suppression is PER-TARGET: only the cancelled element is blocked. A
  // different element can start a new gesture immediately. The suppression
  // lifts 200ms after the last wheel event for the blocked element (i.e.
  // when the physical pinch ends). No global wheel-eater — the call sites
  // drive the timer via rejected begin() calls.
  let suppressedTarget: unknown = null;
  let suppressTimer: ReturnType<typeof setTimeout> | null = null;
  const SUPPRESS_MS = 200;

  const clearSuppress = () => { if (suppressTimer) { clearTimeout(suppressTimer); suppressTimer = null; } };
  const armSuppress = () => {
    clearSuppress();
    suppressTimer = setTimeout(() => { suppressedTarget = null; }, SUPPRESS_MS);
  };

  // Remove the gesture-scoped listeners and clear the frame. Idempotent.
  const end = (canceled: boolean) => {
    if (teardown) { teardown(); teardown = null; }
    const onEnd = cfg?.onEnd;
    target = null;
    snap = undefined;
    cfg = null;
    onEnd?.(canceled);
  };
  const commit = () => { if (target !== null) end(false); };
  const cancel = (): boolean => {
    if (target === null || !cfg) return false;
    cfg.restore(target, snap);
    if (isPinchGesture) {
      // Esc during pinch: revert values, then suppress THIS target only.
      // The user's fingers are still on the trackpad; wheel events keep
      // coming. We block re-lock on this specific element until the pinch
      // physically ends (200ms with no wheel event for it). A different
      // element can start a new gesture immediately.
      const cancelledTarget = target;
      const onEnd = cfg.onEnd;
      if (teardown) { teardown(); teardown = null; }
      target = null;
      snap = undefined;
      cfg = null;
      suppressedTarget = cancelledTarget;
      onEnd?.(true);
      armSuppress();
    } else {
      end(true);
    }
    return true;
  };

  return {
    get target() { return target; },
    // active does NOT include suppression — other elements can start gestures.
    get active() { return target !== null; },
    begin<T>(t: T | null, config: WheelConfig<T>, opts?: { pinch?: boolean }): T | null {
      if (target !== null || t == null) return target as T | null;
      // If this specific target is suppressed (Esc-cancelled pinch still in
      // progress), reject and reset the suppression timer. The call site
      // sees null and returns without applying a delta. A different target
      // is not suppressed — fall through and start a new gesture, lifting
      // any prior suppression.
      if (suppressedTarget !== null && t === suppressedTarget) {
        armSuppress();
        return null;
      }
      // Different target — clear any stale suppression.
      clearSuppress();
      suppressedTarget = null;

      target = t;
      cfg = config;
      snap = config.snapshot(t);
      isPinchGesture = opts?.pinch ?? false;

      if (isPinchGesture) {
        // Trackpad pinch: synthetic ctrlKey, no real key was pressed, so keyup
        // will never fire. The gesture stays live until a REAL signal ends it:
        //   - Esc → cancel (revert to snapshot)
        //   - pointermove/pointerdown/click → commit (user did something else)
        //   - non-ctrlKey wheel → commit (user switched to plain scroll)
        //   - any keydown other than Esc → commit (user pressed a key)
        //   - blur → commit (window lost focus)
        // NO idle timeout — it creates false gesture boundaries. A 150ms gap
        // in wheel events is not "pinch ended"; it's just a slow pinch. With
        // no timeout, Esc always reverts to the TRUE gesture start, not to
        // some mid-pinch commit point. The gesture stays live until the user
        // does something else, which is the correct behavior.
        const onAnyInput = () => commit();
        const onWheelOther = (e: WheelEvent) => { if (!e.ctrlKey) commit(); };
        const onKeydown = (e: KeyboardEvent) => {
          if (e.key === "Escape") { if (cancel()) { e.preventDefault(); e.stopPropagation(); } }
          else commit(); // any other key = pinch is over
        };
        window.addEventListener("pointermove", onAnyInput);
        window.addEventListener("pointerdown", onAnyInput);
        window.addEventListener("click", onAnyInput);
        window.addEventListener("wheel", onWheelOther);
        window.addEventListener("keydown", onKeydown, true);
        window.addEventListener("blur", onAnyInput);
        teardown = () => {
          window.removeEventListener("pointermove", onAnyInput);
          window.removeEventListener("pointerdown", onAnyInput);
          window.removeEventListener("click", onAnyInput);
          window.removeEventListener("wheel", onWheelOther);
          window.removeEventListener("keydown", onKeydown, true);
          window.removeEventListener("blur", onAnyInput);
        };
      } else {
        // cmd+wheel (real key press): commit when the key is released.
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
      }
      return t;
    },
    cancel,
  };
}

/** Per-gesture value mapping for a drag edit. */
export interface DragConfig<T> {
  snapshot: (target: T) => unknown;
  restore: (target: T, snap: any) => void;
  /** Invoked for each pointermove while live, with the live pointer AND the
   *  gesture-start snapshot — so callers that need a start reference read it from
   *  the controller (which owns the frame) instead of stashing loose start vars. */
  onMove: (e: PointerEvent, snapshot: any) => void;
  /** Runs on any end. `canceled` = reverted via Esc. */
  onEnd?: (canceled: boolean) => void;
}

export interface DragController {
  readonly target: unknown;
  readonly active: boolean;
  /** Lock a target, snapshot it, arm move/up/cancel/Esc listeners. No-op if a
   *  drag is already live. The caller still owns pointerDOWN (hit-test / capture):
   *  it decides WHEN to begin() and on what target; the controller owns everything
   *  after (move/up/cancel, snapshot, revert, teardown). Returns the locked target. */
  begin<T>(target: T | null, config: DragConfig<T>): T | null;
  /** Commit (keep edits) — e.g. on pointerup. */
  commit(): void;
  /** Cancel (revert to snapshot). Returns true if a gesture was live. */
  cancel(): boolean;
}

function makeDragController(): DragController {
  let target: unknown = null;
  let snap: unknown = undefined;
  let cfg: DragConfig<any> | null = null;
  let teardown: (() => void) | null = null;

  const end = (canceled: boolean) => {
    if (teardown) { teardown(); teardown = null; }
    const onEnd = cfg?.onEnd;
    target = null;
    snap = undefined;
    cfg = null;
    onEnd?.(canceled);
  };
  const commit = () => { if (target !== null) end(false); };
  const cancel = (): boolean => {
    if (target === null || !cfg) return false;
    cfg.restore(target, snap);
    end(true);
    return true;
  };

  return {
    get target() { return target; },
    get active() { return target !== null; },
    begin<T>(t: T | null, config: DragConfig<T>): T | null {
      if (target !== null || t == null) return target as T | null;
      target = t;
      cfg = config;
      snap = config.snapshot(t);
      const onPointerMove = (e: Event) => config.onMove(e as PointerEvent, snap);
      const onPointerUp = () => commit();
      const onBlur = () => commit();
      const onKeydown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && cancel()) { e.preventDefault(); e.stopPropagation(); }
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
      window.addEventListener("blur", onBlur);
      window.addEventListener("keydown", onKeydown, true);
      teardown = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("keydown", onKeydown, true);
      };
      return t;
    },
    commit,
    cancel,
  };
}

/** The ONE wheel controller for the whole app. */
export const wheelController: WheelController = makeWheelController();
/** The ONE drag controller for the whole app. */
export const dragController: DragController = makeDragController();
