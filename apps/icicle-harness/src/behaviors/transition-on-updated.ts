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

import type { Gesture, Behavior } from "../gesture";

/** Host CSS class toggled while a gesture is live. */
export const GESTURE_ACTIVE_CLASS = "gesture-active";

/** Base timing token (Interaction Principle 12): every duration is a multiple. */
export const TRANSITION_BASE_MS = 100;

const SETTLE_ATTRS = ["x", "y", "width", "height"] as const;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && !!window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Build a CSS transition string for the given SVG attributes. */
export function settleTransition(
  attrs: readonly string[] = SETTLE_ATTRS,
  durationMult = 3,
): string {
  if (prefersReducedMotion()) return "none";
  const dur = TRANSITION_BASE_MS * durationMult;
  return attrs.map((a) => `${a} ${dur}ms ease-out`).join(", ");
}

export interface TransitionOnUpdatedOptions {
  /** SVG attributes to transition. Defaults to x/y/width/height. */
  attrs?: readonly string[];
  /** Settle duration as a multiplier of TRANSITION_BASE_MS (default 3 = 300ms). */
  durationMult?: number;
  /** CSS selector scope for the transition rule. Defaults to the host tag. */
  selector?: string;
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
    const durationMult = opts.durationMult ?? 3;
    const selector = opts.selector ?? host.tagName.toLowerCase();

    const transitionValue = settleTransition(attrs, durationMult);
    // Scope the suppression to the host carrying the class so multiple charts
    // on the page don't clobber each other.
    const css = `
${selector} rect, ${selector} text { transition: ${transitionValue}; }
${selector}.${GESTURE_ACTIVE_CLASS} rect, ${selector}.${GESTURE_ACTIVE_CLASS} text { transition: none !important; }
${selector}.${GESTURE_ACTIVE_CLASS} * { transition: none !important; }
@media (prefers-reduced-motion: reduce) {
  ${selector} rect, ${selector} text { transition: none !important; }
}
`;

    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-vf-transitions", selector);
    styleEl.textContent = css;
    host.prepend(styleEl);

    // Single owner of the suppression class. Input behaviors call
    // gesture.draft/commit/cancel; this subscriber reacts. No other site
    // should toggle `gesture-active`.
    const unsub = gesture.editor.subscribe((t) => {
      if (t.type === "draft") {
        host.classList.add(GESTURE_ACTIVE_CLASS);
      } else if (t.type === "commit" || t.type === "cancel") {
        host.classList.remove(GESTURE_ACTIVE_CLASS);
      }
      // `updated` does not change Editor state — class stays as-is.
    });

    return () => {
      unsub();
      styleEl.remove();
      // Defensive: ensure the class is not left on the host if the behavior
      // is torn down mid-gesture (e.g. config change rebuilds the chart).
      host.classList.remove(GESTURE_ACTIVE_CLASS);
    };
  };
}
