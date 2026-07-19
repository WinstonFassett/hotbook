// behaviors/mark-lifecycle.ts — enter/exit lifecycle for chart marks.
// Ported from packages/bireactive/src/lib/mark-lifecycle.ts (the reference's
// proven CSS-based pattern), adapted to the harness's transition tokens.
//
// Three pieces:
//   • `withExitDelay` — wraps a reactive list so removed items linger in the
//     returned cell for `EXIT_MS` before eviction, giving a CSS opacity fade
//     time to play before bireactive's `forEach` disposes the element.
//   • `enterExitFade` — attach the CSS transition + enter/exit opacity
//     toggles to a rendered mark's DOM element.
//   • `membershipCell` — reactive `Set<key>` for O(1) "is this item still
//     present" checks, used to freeze geometry on exiting marks.
//
// CSS-first (per wiki/transitions-decision.md): no `Anim`/RAF dependency.
// The harness already uses CSS transitions via `transitionOnUpdated` for
// sort/orientation/value settle; enter/exit is CSS too — consistent.

import { cell, derive, effect, readNow, untracked, type Read, type Val } from "bireactive";
import { motion } from "../../lib/runtime-config";
import { prefersReducedMotion } from "./transition-on-updated";

export const TRANSITION_EASING = "cubic-bezier(0.4, 0.0, 0.2, 1)"; // ease-in-out

export interface WithExitDelayOptions<T> {
  key: (item: T) => unknown;
  /** How long a removed item lingers before eviction. Defaults to `EXIT_MS`.
   *  Under `prefers-reduced-motion`, the delay is forced to 0. */
  exitMs?: number;
  /** When true at update time, evict leavers immediately (no delay). Used by
   *  hierarchical charts on drill, where held-over items would remap to
   *  degenerate geometry. Read via `readNow` on every source change. */
  immediate?: Val<boolean>;
}

/** Wrap a reactive list so items removed from `source` remain in the returned
 *  cell for `exitMs`, then evict. New items appear immediately. Charts wire the
 *  returned cell into bireactive's `forEach` and let CSS handle the fade. */
export function withExitDelay<T>(
  source: Val<readonly T[]>,
  opts: WithExitDelayOptions<T>,
): Read<readonly T[]> {
  const { key, exitMs = motion.motionMs.value, immediate } = opts;
  const rendered = cell<readonly T[]>(readNow(source));
  let timer: ReturnType<typeof setTimeout> | null = null;

  effect(() => {
    const next = readNow(source);
    untracked(() => {
      const skipDelay = (immediate ? readNow(immediate) : false) || prefersReducedMotion();
      const nextKeys = new Set(next.map(key));
      const prev = rendered.value;
      const leavers = prev.filter((item) => !nextKeys.has(key(item)));

      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      if (leavers.length === 0 || skipDelay) {
        rendered.value = next;
        return;
      }
      rendered.value = [...next, ...leavers];
      timer = setTimeout(() => {
        timer = null;
        rendered.value = readNow(source);
      }, exitMs);
    });
  });

  return rendered;
}

export interface EnterExitFadeOptions {
  /** True while the item is still present in the underlying (undelayed) source.
   *  When it flips to false, the element fades to opacity 0. */
  present: Val<boolean>;
  enterMs?: number;
  exitMs?: number;
  /** Extra properties to transition alongside `opacity` (e.g. `"transform"`). */
  extra?: readonly string[];
}

/** Wire enter/exit fades onto a mark's DOM element. On mount the element starts
 *  at opacity 0 and transitions to 1 (enter). When `present` flips to false the
 *  element transitions back to opacity 0 (exit). `withExitDelay` keeps the
 *  element mounted long enough for the exit to complete. Under
 *  `prefers-reduced-motion` all transitions are dropped. */
export function enterExitFade(
  el: SVGElement | HTMLElement,
  opts: EnterExitFadeOptions,
): void {
  const enterMs = opts.enterMs ?? motion.motionMs.value;
  const exitMs = opts.exitMs ?? motion.motionMs.value;
  const reduced = prefersReducedMotion();

  if (reduced) {
    el.style.opacity = "1";
    effect(() => {
      const present = readNow(opts.present);
      el.style.opacity = present ? "1" : "0";
    });
    return;
  }

  const props = ["opacity", ...(opts.extra ?? [])];
  // Set opacity 0 pre-frame so the first render has the pre-transition value.
  el.style.opacity = "0";
  const enterTransition = props.map((p) => `${p} ${enterMs}ms ${TRANSITION_EASING}`).join(", ");
  const exitTransition = props.map((p) => `${p} ${exitMs}ms ${TRANSITION_EASING}`).join(", ");
  el.style.transition = enterTransition;

  // Kick opacity → 1 after the browser has painted the initial 0, THEN register
  // the reactive effect that mirrors `present`. Registering it earlier would
  // fire synchronously with present=true and clobber the initial opacity=0
  // before the CSS transition ever ran — killing the enter fade.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      effect(() => {
        const present = readNow(opts.present);
        el.style.transition = present ? enterTransition : exitTransition;
        el.style.opacity = present ? "1" : "0";
      });
    });
  });
}

/** Build a fast membership check that stays reactive with a source cell. */
export function membershipCell<T>(
  source: Val<readonly T[]>,
  key: (item: T) => unknown,
): Read<Set<unknown>> {
  return derive(() => {
    const items = readNow(source);
    return new Set(items.map(key));
  });
}
