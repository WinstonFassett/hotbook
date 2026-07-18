// behaviors/enter-exit-lifecycle.ts — render behavior: animate structural
// changes (enter/exit) on `updated`. Wraps the chart's tile forEach with
// enter (fade-in) and exit (fade-out-in-place) transitions.
//
// Spec (icicle.md §5): "on every `updated` that changes the rendered set,
// entering marks fade in at their target geometry; exiting marks fade out
// in place with their geometry frozen; surviving marks `transition` to
// their new slots."
//
// Implementation: a drop-in replacement for `forEach` that intercepts
// removals. When a key disappears from the source, instead of disposing
// immediately, it animates the shape's `opacity` cell from 1 to 0 via
// bireactive's `tween`, and removes after the animation completes. New
// keys animate opacity from 0 to 1.
//
// `prefers-reduced-motion`: enter/exit is immediate (no fade), matching
// the spec ("enter/exit is immediate; autonomous transitions are
// suppressed").

import { effect, readNow, untracked, tween, easeIn, easeOut, play, type Val, type Yieldable } from "bireactive";
import type { AnyShape } from "bireactive";
import { prefersReducedMotion, TRANSITION_BASE_MS } from "./transition-on-updated";

export interface EnterExitOptions<T> {
  /** Stable identity per item. Defaults to index. */
  key?: (item: T, index: number) => unknown;
  /** Fade duration in seconds (default 0.2 = 200ms). */
  enterSec?: number;
  exitSec?: number;
}

export interface ForEachResult {
  dispose: () => void;
  at: (i: number) => AnyShape | undefined;
  all: (i: number) => readonly AnyShape[] | undefined;
}

/** Like `forEach`, but entering items fade in and exiting items fade out
 *  in place before removal. Surviving items are reused (their reactive
 *  geometry derivers update normally — the settle CSS from
 *  `transitionOnUpdated` animates them). */
export function enterExitForEach<T>(
  parent: AnyShape,
  source: Val<readonly T[]>,
  render: (item: T, index: number) => AnyShape | AnyShape[],
  options: EnterExitOptions<T> = {},
): ForEachResult {
  const { key: keyOf } = options;
  const enterSec = options.enterSec ?? (TRANSITION_BASE_MS * 2) / 1000;
  const exitSec = options.exitSec ?? (TRANSITION_BASE_MS * 2) / 1000;
  const reduced = prefersReducedMotion();

  interface Entry {
    key: unknown;
    shapes: AnyShape[];
    exiting?: boolean;
    anim?: Yieldable | Yieldable[];
  }

  let entries: Entry[] = [];

  const eff = effect(() => {
    const next = readNow(source);
    untracked(() => {
      const prevByKey = new Map<unknown, Entry>();
      for (const e of entries) {
        if (!e.exiting) prevByKey.set(e.key, e);
      }

      const nextEntries: Entry[] = [];
      for (let i = 0; i < next.length; i++) {
        const item = next[i];
        const k = keyOf ? keyOf(item, i) : i;
        const existing = prevByKey.get(k);
        if (existing) {
          nextEntries.push(existing);
          prevByKey.delete(k);
        } else {
          const result = render(item, i);
          const shapes = Array.isArray(result) ? result : [result];
          parent.add(...shapes);
          // Enter: fade in from 0 to 1 via bireactive tween.
          if (!reduced) {
            for (const s of shapes) {
              s.opacity.value = 0;
              const anim = tween(s.opacity, 1, enterSec, easeOut);
              play(anim);
            }
          }
          nextEntries.push({ key: k, shapes });
        }
      }

      // Anything left in prevByKey is exiting.
      for (const removed of prevByKey.values()) {
        if (reduced) {
          parent.remove(...removed.shapes);
        } else {
          // Exit: fade out via bireactive tween, then remove.
          removed.exiting = true;
          const anims: Yieldable[] = [];
          for (const s of removed.shapes) {
            const anim = tween(s.opacity, 0, exitSec, easeIn);
            anims.push(anim);
          }
          removed.anim = anims;
          // Play all exit animations, then remove after the longest one.
          for (const a of anims) play(a);
          const shapesToRemove = removed.shapes;
          setTimeout(() => {
            parent.remove(...shapesToRemove);
            entries = entries.filter((e) => e !== removed);
          }, exitSec * 1000 + 50);
        }
      }
      entries = nextEntries;
    });
  });

  return {
    dispose: () => {
      eff();
      const toRemove = entries;
      entries = [];
      for (const e of toRemove) parent.remove(...e.shapes);
    },
    at: (i) => entries[i]?.shapes[0],
    all: (i) => entries[i]?.shapes,
  };
}
