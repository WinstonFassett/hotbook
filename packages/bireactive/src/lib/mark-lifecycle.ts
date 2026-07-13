// WIN-155 / WIN-292: enter/exit lifecycle for chart marks.
//
// Three layers, all exported so charts can compose freely:
//   • `withExitDelay` — hold removed items in the rendered cell long enough
//     for a CSS opacity fade to run before bireactive's `forEach` evicts them.
//   • `enterExitFade` — attach the actual CSS transition + enter/exit opacity
//     toggles to a rendered mark's DOM element.
//   • `windowedMarks` — WIN-292 shared hierarchical mark lifecycle: bundles
//     `withExitDelay` + `membershipCell` + a per-item `freezeOnExit` snapshot
//     + a thin `renderLayer` wrapper over bireactive's `forEach`. Used by
//     sunburst, icicle, pack, treemap so a fix in one place lands everywhere.

import { cell, derive, effect, forEach, readNow, untracked, type Read, type Val } from "bireactive";
import { ENTER_MS, EXIT_MS, prefersReducedMotion, TRANSITION_EASING } from "./transitions";

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
  const { key, exitMs = EXIT_MS, immediate } = opts;
  const rendered = cell<readonly T[]>(readNow(source));
  let timer: ReturnType<typeof setTimeout> | null = null;

  effect(() => {
    const next = readNow(source);
    untracked(() => {
      const skipDelay = (immediate ? readNow(immediate) : false) || prefersReducedMotion();
      const nextKeys = new Set(next.map(key));
      const prev = rendered.value;
      const leavers = prev.filter(item => !nextKeys.has(key(item)));

      if (timer) { clearTimeout(timer); timer = null; }

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
  /** Extra properties to transition alongside `opacity` on the enter/exit
   *  rhythm (e.g. `"transform"`). */
  extra?: readonly string[];
  /** Target opacity while present. Defaults to 1. Reactive so callers can
   *  compose lifecycle enter/exit with a role-based dim (e.g. context-node
   *  fading to 0.18) in one effect instead of two fighting for `opacity`. */
  presentOpacity?: Val<number>;
  /** Extra transition entries (raw CSS) appended to both enter and exit
   *  transitions. Used when a mark also transitions properties on their own
   *  rhythm — e.g. icicle's fill/stroke on the settle rhythm. */
  extraTransitionCss?: string;
}

/** Wire enter/exit fades onto a mark's DOM element. On mount the element starts
 *  at opacity 0 and transitions to `presentOpacity` (default 1). When `present`
 *  flips to false the element transitions back to opacity 0. `withExitDelay`
 *  keeps the element mounted long enough for the exit to complete. Under
 *  `prefers-reduced-motion` transitions are dropped but the reactive opacity
 *  toggle is preserved. */
export function enterExitFade(
  el: SVGElement | HTMLElement,
  opts: EnterExitFadeOptions,
): void {
  const enterMs = opts.enterMs ?? ENTER_MS;
  const exitMs = opts.exitMs ?? EXIT_MS;
  const presentOpacity = opts.presentOpacity;
  const reduced = prefersReducedMotion();
  const readTarget = () => (presentOpacity ? readNow(presentOpacity) : 1);

  if (reduced) {
    el.style.opacity = "1";
    effect(() => {
      const present = readNow(opts.present);
      el.style.opacity = present ? String(readTarget()) : "0";
    });
    return;
  }

  const props = ["opacity", ...(opts.extra ?? [])];
  // Set opacity 0 pre-frame so the first render has the pre-transition value.
  el.style.opacity = "0";
  const extraTail = opts.extraTransitionCss ? `, ${opts.extraTransitionCss}` : "";
  const enterTransition = props.map(p => `${p} ${enterMs}ms ${TRANSITION_EASING}`).join(", ") + extraTail;
  const exitTransition = props.map(p => `${p} ${exitMs}ms ${TRANSITION_EASING}`).join(", ") + extraTail;
  el.style.transition = enterTransition;

  // Kick opacity → presentOpacity after the browser has painted the initial 0,
  // THEN register the reactive effect that mirrors `present`. Registering it
  // earlier would fire synchronously with present=true and clobber the initial
  // opacity=0 before the CSS transition ever ran — killing the enter fade.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.opacity = String(readTarget());
      effect(() => {
        const present = readNow(opts.present);
        const target = presentOpacity ? readNow(presentOpacity) : 1;
        el.style.transition = present ? enterTransition : exitTransition;
        el.style.opacity = present ? String(target) : "0";
      });
    });
  });
}

/** Build a fast membership check that stays reactive with a source cell. */
export function membershipCell<T>(source: Val<readonly T[]>, key: (item: T) => unknown): Read<Set<unknown>> {
  return derive(() => {
    const items = readNow(source);
    return new Set(items.map(key));
  });
}

// ─── WIN-292: shared windowed-marks scaffolding ─────────────────────────────

export interface WindowedMarksOptions<T> {
  /** Identity for `withExitDelay` + `membershipCell`. Same key is used for
   *  freeze-on-exit lookups so a caller's compute() runs against the same
   *  membership signal that drives the fade. */
  key: (item: T) => unknown;
  /** How long a removed item lingers before eviction. Defaults to `EXIT_MS`. */
  exitMs?: number;
  /** When true at update time, `withExitDelay` evicts leavers immediately. */
  immediate?: Val<boolean>;
}

export interface WindowedMarks<T> {
  /** Reactive current+lingering set. Wire into `renderLayer` / `forEach`. */
  renderedSet: Read<readonly T[]>;
  /** Reactive membership set of the live window (excluding lingerers). */
  windowMembership: Read<Set<unknown>>;
  /** Read cell for whether `item` is currently in the live window. Handy for
   *  `enterExitFade({ present: isPresent(item) })`. */
  isPresent: (item: T) => Read<boolean>;
  /** Snapshot-on-exit: while `item` is in the live window returns `compute()`
   *  reactively; when it leaves, captures the last value and returns it
   *  frozen until it re-enters. Replaces the per-chart `frozenGeom` block. */
  freezeOnExit: <G>(item: T, compute: () => G) => Read<G>;
  /** Thin wrapper around bireactive's `forEach` that binds the layer to
   *  `renderedSet`. Callers may still pass a `key` for DOM identity. */
  renderLayer: (
    layer: unknown,
    render: (item: T) => unknown,
    forEachOpts?: { key?: (item: T) => unknown },
  ) => void;
}

/** Bundle the hierarchical mark lifecycle used by sunburst/icicle/pack/treemap
 *  — windowed rendering with an exit-fade delay, per-item freeze-on-exit for
 *  drill viewport tweens, and a `renderLayer` binding. */
export function windowedMarks<T>(
  windowTarget: Val<readonly T[]>,
  opts: WindowedMarksOptions<T>,
): WindowedMarks<T> {
  const key = opts.key;
  const renderedSet = withExitDelay(windowTarget, {
    key,
    exitMs: opts.exitMs,
    immediate: opts.immediate,
  });
  const windowMembership = membershipCell(windowTarget, key);

  const isPresent = (item: T): Read<boolean> => {
    const k = key(item);
    return derive(() => windowMembership.value.has(k));
  };

  const freezeOnExit = <G>(item: T, compute: () => G): Read<G> => {
    const k = key(item);
    const raw = derive(compute);
    let frozen: G | null = null;
    let hasFrozen = false;
    return derive(() => {
      if (windowMembership.value.has(k)) {
        hasFrozen = false;
        frozen = null;
        return raw.value;
      }
      if (!hasFrozen) {
        frozen = untracked(() => raw.value);
        hasFrozen = true;
      }
      return frozen as G;
    });
  };

  const renderLayer = (
    layer: unknown,
    render: (item: T) => unknown,
    forEachOpts?: { key?: (item: T) => unknown },
  ): void => {
    // `forEach` is the reactive keyed-list renderer from bireactive; its
    // `layer` and `render` shapes are lib-defined and not re-exported as
    // discrete types here, so we accept them as `unknown` and hand them off.
    (forEach as unknown as (
      layer: unknown,
      source: Read<readonly T[]>,
      render: (item: T) => unknown,
      opts?: { key?: (item: T) => unknown },
    ) => void)(layer, renderedSet, render, forEachOpts);
  };

  return { renderedSet, windowMembership, isPresent, freezeOnExit, renderLayer };
}
