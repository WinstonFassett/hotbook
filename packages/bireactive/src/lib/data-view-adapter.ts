// bireactive adapter for DataViewController — bridges the view-agnostic
// matchina machine to bireactive's reactive graph. See
// docs/adr/gesture-state-machine.md ("Public state").
//
// DataViewController core does not import bireactive; this module does.

import { cell, derive, effect as biEffect, type Cell, type Writable } from "bireactive";
import type { DataViewController, DataViewState } from "./data-view-controller";
import { activeGestureController } from "./gesture-coordinator";
import { GESTURE_ACTIVE_CLASS } from "./transitions";

export interface DataViewCellHandle {
  /** Reactive mirror of `dataView.getState()`. Read `.value` inside a
   *  `biEffect`/`derive` to react to gesture/settle transitions. */
  cell: Writable<Cell<DataViewState>>;
  /** Unsubscribes from the controller and tears down the DOM effect. */
  dispose: () => void;
}

/** Create a `bireactive` cell mirroring `dataView`'s state, plus a DOM effect
 *  that toggles `GESTURE_ACTIVE_CLASS` on `origin` while `Gesturing`. Callers
 *  (chart custom elements) create this in `connectedCallback` alongside their
 *  `DataViewController` and dispose it in `disconnectedCallback`. */
export function createDataViewCell(dataView: DataViewController): DataViewCellHandle {
  const stateCell = cell<DataViewState>(dataView.getState());
  const unsubscribe = dataView.subscribe((state) => {
    stateCell.value = state;
  });
  const disposeDomEffect = biEffect(() => {
    const state = stateCell.value;
    const origin = state.origin;
    if (!(origin instanceof Element)) return;
    origin.classList.toggle(GESTURE_ACTIVE_CLASS, state.key === "Gesturing");
    return () => {
      origin.classList.remove(GESTURE_ACTIVE_CLASS);
    };
  });
  return {
    cell: stateCell,
    dispose: () => {
      unsubscribe();
      disposeDomEffect();
    },
  };
}

/** True while ANY chart's `DataViewController` is `Gesturing` — the global
 *  cross-tile freeze signal (WIN-300). Reactive; read via `.value` inside a
 *  `biEffect`/`derive`. NOT true during `Settling`, so autonomous transitions
 *  on other tiles still play. */
export const globalGestureActive: Cell<boolean> = derive(
  activeGestureController,
  (active) => active !== null,
);
