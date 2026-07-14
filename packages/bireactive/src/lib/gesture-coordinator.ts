// GestureCoordinator — one singleton tracking the currently active
// DataViewController across every tile. Freezes cross-tile order during a
// live gesture (WIN-300). See docs/adr/gesture-state-machine.md.
//
// Typed as `unknown` (not `DataViewController`) so this module has no
// dependency on data-view-controller.ts — DataViewController imports THIS
// module, not the other way around.
//
// Backed by a `bireactive` cell so `data-view-adapter.ts` can derive
// `globalGestureActive` reactively instead of polling. The public
// `GestureCoordinator` surface stays plain getters/setter, matching the ADR;
// `activeGestureController` is the reactive hook other modules key off.

import { cell, type Cell } from "bireactive";

export interface GestureCoordinator {
  /** The DataViewController currently in `Gesturing`, or null when idle.
   *  Only set while `Gesturing` — cleared on `commit()`/`cancel()`, before
   *  `Settling` begins, so other tiles' settle transitions are never frozen. */
  readonly active: unknown;
  /** True iff a gesture is live somewhere in the app. */
  readonly isActive: boolean;
  setActive(controller: unknown): void;
}

const _active = cell<unknown>(null);

function makeGestureCoordinator(): GestureCoordinator {
  return {
    get active() {
      return _active.value;
    },
    get isActive() {
      return _active.value !== null;
    },
    setActive(controller: unknown) {
      _active.value = controller;
    },
  };
}

/** The one GestureCoordinator for the whole app. */
export const gestureCoordinator: GestureCoordinator = makeGestureCoordinator();

/** Reactive backing for `gestureCoordinator.active`. Not part of the public
 *  `GestureCoordinator` surface — used by `data-view-adapter.ts` to derive
 *  `globalGestureActive`. */
export const activeGestureController: Cell<unknown> = _active;
