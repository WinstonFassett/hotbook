// Centralized Escape contract for gesture-based charts.
//
// Interaction principle Rule 6 (docs/interaction-principles.md): gestures are
// speculative until committed — "Escape at any point cancels cleanly, reverting
// to the exact state at gesture start. The system must snapshot state at gesture
// start to support this."
//
// Historically every chart hand-rolled this (snapshot on pointerdown, revert on
// Esc, plus the clear-selection / fall-through priority), so the contract drifted
// per chart. This module is the single home for both halves:
//
//   1. dragCancelable() — a FORK of bireactive's drag() (it isn't exported in a
//      cancelable form, and wrapping it would mean two listener sets racing on
//      one handle). Same pointer wiring as the original, with snapshot-on-down +
//      revert-on-Esc built into the single gesture flow — mirroring how
//      makeWheelGesture owns its own cancel. If bireactive's drag() changes
//      materially, re-sync this fork.
//
//   2. attachEscContract() — one host keydown implementing the canonical
//      priority: live drag → revert; else selection → clear; else fall through
//      (no preventDefault) so Esc can still dismiss an outer menu/overlay.

import { batch } from "bireactive";
import type { AnyShape, Cell, Vec, Writable } from "bireactive";

// ─── Live-gesture registry ────────────────────────────────────────────────────
// A drag in flight registers its revert fn here, keyed by host. attachEscContract
// checks this first so a single host keydown can cancel whatever drag is active,
// without the chart threading per-handle state into its keydown.

interface LiveGesture { revert: () => void }
const liveByHost = new WeakMap<EventTarget, LiveGesture>();

/** The host a handle belongs to, walking out of any shadow roots since chart
 *  handles live inside a Diagram's shadow DOM. */
function hostOf(el: Element): EventTarget {
  let node: Node | null = el;
  while (node) {
    const root = node.getRootNode();
    if (root instanceof ShadowRoot) { node = root.host; continue; }
    return node instanceof Document ? (node.defaultView ?? window) : node;
  }
  return window;
}

// ── Touch/scroll helpers (inlined from bireactive's interaction.ts; not exported) ──

function ownTouchGesture(shape: AnyShape): void {
  shape.el.style.touchAction = "none";
  if (shape.intrinsic) shape.intrinsic.style.touchAction = "none";
}

/** Block page scroll/zoom for the lifetime of a drag (iOS Safari ignores
 *  touch-action on inner SVG nodes). Returns a disposer. */
function blockPageScroll(): () => void {
  const onMove = (e: Event) => e.preventDefault();
  document.addEventListener("touchmove", onMove, { passive: false });
  return () => document.removeEventListener("touchmove", onMove);
}

export interface DragCancelableOpts {
  /** Reactive active-state cell (drives handle highlight). True on down,
   *  false on up/cancel. */
  dragging?: Writable<Cell<boolean>>;
  /** Host whose Esc handler can cancel this drag. Defaults to the shape's host
   *  element (walking out of shadow DOM). */
  host?: EventTarget;
  /** Extra work on pointerdown (e.g. select the datum, set gestureActive). */
  onStart?: () => void;
  /** Extra work when the gesture ends. `canceled` = reverted via Esc. */
  onEnd?: (canceled: boolean) => void;
}

/**
 * drag() with the Rule-6 speculative contract: snapshots `sources` on
 * pointerdown and reverts them (one batch) if canceled via Esc. Otherwise
 * identical to bireactive's drag() — writes `target.value` from the pointer on
 * each move, pointer-captured so the drag survives leaving the handle.
 *
 * @param shape   the draggable handle
 * @param target  the Vec.lens drag writes to (its sources should be `sources`)
 * @param sources the writable cells the lens mutates — snapshotted for revert
 */
export function dragCancelable(
  shape: AnyShape,
  target: Writable<Vec>,
  sources: ReadonlyArray<Writable<Cell<number>>>,
  opts: DragCancelableOpts = {},
): () => void {
  if (!shape.el.style.cursor) shape.el.style.cursor = "grab";
  ownTouchGesture(shape);
  const host = opts.host ?? hostOf(shape.el);

  let dx = 0, dy = 0;
  let pointerId = -1;
  let unblock: (() => void) | null = null;
  let snapshot: number[] | null = null;

  const finish = (canceled: boolean) => {
    if (canceled && snapshot) {
      const snap = snapshot;
      batch(() => { sources.forEach((c, i) => { c.value = snap[i]!; }); });
    }
    snapshot = null;
    liveByHost.delete(host);
    if (opts.dragging) opts.dragging.value = false;
    opts.onEnd?.(canceled);
  };

  // Moves/ups on window (capture survives re-parent / pointer outrunning shape).
  const onMove = (e: PointerEvent) => {
    if (pointerId === -1 || e.pointerId !== pointerId) return;
    const world = shape.toWorld(e);
    target.value = { x: world.x - dx, y: world.y - dy };
  };
  const stop = (e?: PointerEvent) => {
    if (pointerId === -1 || (e && e.pointerId !== pointerId)) return;
    try { shape.el.releasePointerCapture(pointerId); } catch { /* ok */ }
    pointerId = -1;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", stop as EventListener);
    window.removeEventListener("pointercancel", stop as EventListener);
    unblock?.(); unblock = null;
    finish(false); // pointerup = commit
  };

  const offDown = shape.on("pointerdown", (e: Event) => {
    const pe = e as PointerEvent;
    pointerId = pe.pointerId;
    try { shape.el.setPointerCapture(pointerId); } catch { /* ok */ }
    unblock = blockPageScroll();
    const world = shape.toWorld(pe);
    const v = target.value;
    dx = world.x - v.x;
    dy = world.y - v.y;
    // Snapshot for Esc-revert + register with the host so attachEscContract
    // can cancel us.
    snapshot = sources.map((c) => c.value);
    liveByHost.set(host, { revert: () => { stopForCancel(); } });
    if (opts.dragging) opts.dragging.value = true;
    opts.onStart?.();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop as EventListener);
    window.addEventListener("pointercancel", stop as EventListener);
  });

  // Esc cancel: tear down listeners like stop(), but revert instead of commit.
  const stopForCancel = () => {
    if (pointerId !== -1) {
      try { shape.el.releasePointerCapture(pointerId); } catch { /* ok */ }
      pointerId = -1;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop as EventListener);
      window.removeEventListener("pointercancel", stop as EventListener);
      unblock?.(); unblock = null;
    }
    finish(true);
  };

  return () => {
    offDown();
    if (pointerId !== -1) stop();
    liveByHost.delete(host);
  };
}

// ─── Host Escape handler ──────────────────────────────────────────────────────

export interface EscContractOpts {
  /** Clear the chart's selection. Return true if something was cleared (so Esc
   *  is consumed); false to let Esc fall through. */
  clearSelection?: () => boolean;
}

/**
 * Install the canonical Escape handler on a chart host. Priority:
 *   1. a live drag → revert to gesture-start state
 *   2. else a selection → clear it
 *   3. else fall through (no preventDefault) so an outer overlay can handle Esc
 *
 * Returns a disposer.
 */
export function attachEscContract(
  host: HTMLElement | SVGElement,
  opts: EscContractOpts = {},
): () => void {
  const onKeydown = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key !== "Escape") return;
    const live = liveByHost.get(host);
    if (live) { live.revert(); ke.preventDefault(); return; }
    if (opts.clearSelection?.()) { ke.preventDefault(); return; }
    // else fall through — Esc not consumed.
  };
  host.addEventListener("keydown", onKeydown);
  return () => host.removeEventListener("keydown", onKeydown);
}
