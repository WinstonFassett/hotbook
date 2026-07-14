// settle() sources — the mechanisms that know when a chart's transition has
// finished and call `dataView.settle()` (Settling -> Idle). See
// docs/adr/gesture-state-machine.md ("settle from the view").
//
// Both respect prefers-reduced-motion by calling settle() immediately when
// autonomous motion is suppressed.

import type { Animator } from "bireactive";
import type { DataViewController } from "./data-view-controller";
import { prefersReducedMotion } from "./transitions";

/** Minimal shape of `bireactive`'s `Anim` needed here — avoids importing the
 *  concrete class where only `start` is used. */
export interface AnimLike {
  start(...gs: Animator<any>[]): () => void;
}

/** Call `dataView.settle()` when a CSS transition on `el` (or any descendant
 *  — the listener is on the container and `transitionend` bubbles) finishes.
 *  Returns a dispose function that removes the listener. */
export function withSettle(
  el: HTMLElement | SVGElement,
  dataView: DataViewController,
): () => void {
  if (prefersReducedMotion()) {
    dataView.settle();
    return () => {};
  }
  const onTransitionEnd = () => dataView.settle();
  el.addEventListener("transitionend", onTransitionEnd);
  return () => el.removeEventListener("transitionend", onTransitionEnd);
}

/** Run `tweens` on `anim` as a joined group, calling `dataView.settle()` when
 *  every tween completes. Returns the `Anim` cancel handle. */
export function withAnimSettle(
  anim: AnimLike,
  dataView: DataViewController,
  ...tweens: Animator<any>[]
): () => void {
  if (prefersReducedMotion()) {
    dataView.settle();
    return () => {};
  }
  function* run(): Generator<any, void, any> {
    yield tweens;
    dataView.settle();
  }
  return anim.start(run());
}
