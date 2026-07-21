// behaviors/transition-on-updated.ts — render behavior: animate the settle on
// commit / cancel / updated. Uses CSS transitions on SVG geometry attributes
// (x/y/width/height) — bireactive already drives these as cells via
// setAttribute, and modern browsers animate the SVG geometry attributes as
// CSS properties (Chrome 79+, Firefox 75+, Safari 16+). Zero per-frame cost;
// the browser owns the timeline.
//
// This behavior is the **single owner** of the gesture-suppression contract
// (interaction-principles rule 7/8 + gesture-architecture §"Kernel.Drafts":
// "Publishes; it does not command. Any Chart or DataView can subscribe and
// decide what to do (for example, freeze sort or suppress autonomous
// transitions)."). It subscribes to the Editor state machine: on `draft` it
// adds the `gesture-active` class; on `commit`/`cancel` it removes it. Input
// behaviors never touch the class — they only call `gesture.draft()` /
// `gesture.commit()` / `gesture.cancel()`, and this behavior reacts.
//
// Timing: input behavior writes values (cells, effects deferred to microtask)
// → calls `gesture.draft()` → editor emits synchronously → this behavior's
// subscriber adds the class (sync, within the `draft()` call) → microtask
// flushes → `setAttribute` runs with the class already set → no transition
// on the first frame. Safe under the current flush model and under
// `batch()`/`settle()` because the class is added inside `editor.draft()`
// before any flush can run.
//
// `prefers-reduced-motion` collapses to `transition: none` in one place.

import { effect } from "bireactive";
import { motion } from "../../lib/runtime-config";
import { TRANSITION_DURATION } from "../../lib/transitions";
import type { Gesture, Behavior } from "../gesture";

/** Host CSS class toggled while a gesture is live. */
export const GESTURE_ACTIVE_CLASS = "gesture-active";
/** Host CSS class for reorder gestures — allows sibling transitions. */
export const REORDER_ACTIVE_CLASS = "reorder-active";

const SETTLE_ATTRS = ["x", "y", "width", "height"] as const;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && !!window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Build a CSS transition string for the given SVG attributes. Reads the
 *  master rhythm at call-time so a tweaks-pane bump is picked up on the next
 *  `<style>` emission (see `transitionOnUpdated`, which re-emits on cell change).
 *  If `durationMs` is provided, it overrides the settle duration — use this
 *  for charts that have their own timing cell (e.g. motionMs for hierarchical). */
export function settleTransition(
  attrs: readonly string[] = SETTLE_ATTRS,
  durationMs?: () => number,
): string {
  if (prefersReducedMotion()) return "none";
  const dur = durationMs ? durationMs() : TRANSITION_DURATION.motion;
  return attrs.map((a) => `${a} ${dur}ms ease-out`).join(", ");
}

export interface TransitionOnUpdatedOptions {
  /** SVG attributes to transition. Defaults to x/y/width/height. */
  attrs?: readonly string[];
  /** Direct duration in ms (overrides settle default). Use for charts that
   *  have their own timing cell (e.g. motionMs for hierarchical charts). */
  durationMs?: () => number;
  /** CSS selector scope for the transition rule. Defaults to the host tag. */
  selector?: string;
  /** SVG element selectors to apply the transition to. Defaults to "rect, text". */
  elements?: string;
}

/** Render behavior: own the gesture-suppression class + install settle CSS.
 *
 *  Subscribes to the Editor state machine and toggles `gesture-active` on the
 *  host: `draft` → add, `commit`/`cancel` → remove. `updated` does not change
 *  Editor state, so the class is unaffected (an `updated` during `Drafting`
 *  keeps the overlay suppressed; an `updated` during `Idle` finds the class
 *  already absent and the settle CSS animates the change).
 *
 *  Also injects a scoped `<style>` with the settle transition on the chart's
 *  rect elements and the suppression override while the class is present. */
export function transitionOnUpdated(opts: TransitionOnUpdatedOptions = {}): Behavior {
  return (gesture: Gesture) => {
    const host = gesture.store.host as (HTMLElement & { tagName: string }) | null;
    if (!host) return () => {};

    const attrs = opts.attrs ?? SETTLE_ATTRS;
    const durationMs = opts.durationMs;
    const selector = opts.selector ?? host.tagName.toLowerCase();
    const elements = opts.elements ?? "rect, text";

    // Scope the suppression to the host carrying the class so multiple charts
    // on the page don't clobber each other.
    const elemSel = elements.split(", ").map((e) => `${selector} ${e}`).join(", ");

    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-vf-transitions", selector);
    host.prepend(styleEl);

    // Re-emit the settle CSS whenever the master rhythm changes so the tweaks
    // pane retimes settle live (WIN-352). settleTransition reads the timing
    // cell (or durationMs) at call-time; the effect subscribes via that read.
    // Suppress transitions until the chart has rendered real geometry. Charts
    // mount with empty data; the tile binder sets externalData afterward,
    // which flips overflowMode / bandScale / rect attrs. If transitions are
    // enabled during that first data-driven flush, marks animate from 0 or
    // compressed to final — visible as "scaling down."
    let suppressTransitions = true;
    const emitStyle = () => {
      // Always call settleTransition to subscribe to timing cells, even while
      // suppressed — otherwise the effect won't re-run when timing changes.
      const transitionValue = settleTransition(attrs, durationMs);
      const effective = suppressTransitions ? "none" : transitionValue;
      styleEl.textContent = `
${elemSel} { transition: ${effective}; }
${selector}.${GESTURE_ACTIVE_CLASS} * { transition: none !important; }
${selector}.${REORDER_ACTIVE_CLASS} [data-reordering],
${selector}.${REORDER_ACTIVE_CLASS} [data-reordering] * { transition: none !important; }
@media (prefers-reduced-motion: reduce) {
  ${elemSel} { transition: none !important; }
}
`;
    };
    const styleDispose = effect(emitStyle);

    // Enable transitions after the first data-driven layout. Two cases:
    // 1. Elements already exist with geometry (synchronous data) → enable
    //    after one rAF to let the current flush complete.
    // 2. Elements don't exist yet (async data via tile binder) → watch for
    //    the first attribute write, then enable.
    const hasGeometryNow = () => {
      const els = host.querySelectorAll(elements);
      for (const el of els) {
        const r = el as SVGElement;
        const w = parseFloat(r.getAttribute("width") || "0");
        const h = parseFloat(r.getAttribute("height") || "0");
        if (w > 0 || h > 0) return true;
      }
      return false;
    };
    const enableNextFrame = () => {
      requestAnimationFrame(() => { suppressTransitions = false; emitStyle(); });
    };
    if (hasGeometryNow()) {
      // Elements already have geometry — data was set synchronously.
      // Enable after one frame so any pending attribute writes don't animate.
      enableNextFrame();
    } else {
      // Watch for the first geometry attribute write (async data arrival).
      const mo = new MutationObserver(() => {
        if (!suppressTransitions) return;
        if (hasGeometryNow()) {
          mo.disconnect();
          enableNextFrame();
        }
      });
      mo.observe(host, { subtree: true, attributes: true, attributeFilter: ["x", "width", "height", "y"] });
      // Safety: enable after 2s if no data ever arrives.
      setTimeout(() => { mo.disconnect(); if (suppressTransitions) enableNextFrame(); }, 2000);
    }

    // Single owner of the suppression class. Input behaviors call
    // gesture.draft/commit/cancel; this subscriber reacts. No other site
    // should toggle `gesture-active`.
    const unsub = gesture.editor.subscribe((t) => {
      if (t.type === "draft") {
        // Reorder gestures use a separate class that allows sibling
        // transitions (siblings slide to provisional slots). Value-edit
        // gestures suppress all transitions to prevent jitter.
        if (t.draft?.intent === "reorder") {
          host.classList.add(REORDER_ACTIVE_CLASS);
        } else {
          host.classList.add(GESTURE_ACTIVE_CLASS);
        }
      } else if (t.type === "commit" || t.type === "cancel") {
        host.classList.remove(GESTURE_ACTIVE_CLASS);
        host.classList.remove(REORDER_ACTIVE_CLASS);
      }
      // `updated` does not change Editor state — class stays as-is.
    });

    return () => {
      unsub();
      styleDispose();
      styleEl.remove();
      // Defensive: ensure the class is not left on the host if the behavior
      // is torn down mid-gesture (e.g. config change rebuilds the chart).
      host.classList.remove(GESTURE_ACTIVE_CLASS);
      host.classList.remove(REORDER_ACTIVE_CLASS);
    };
  };
}
