// DataViewController — per-chart gesture/settle lifecycle state machine.
// Idle -> Gesturing(intent, origin) -> Settling(intent, origin) -> Idle.
// See docs/adr/gesture-state-machine.md and
// wiki/gesture-state-machine-delivery-plan.md (Phase 0/1).
//
// Core is view-agnostic: no `bireactive` import here (that's
// data-view-adapter.ts) and `origin` is `unknown`.

import { defineStates, matchina } from "matchina";
import { gestureCoordinator } from "./gesture-coordinator";

export type GestureIntent = "edit" | "reorder";

export type DataViewStateKey = "Idle" | "Gesturing" | "Settling";

/** tile-binder `applyData` phase — the lowercase projection of
 *  `DataViewStateKey` the host binding layer switches on. */
export type GesturePhase = "idle" | "gesturing" | "settling";

/** Map a `DataViewStateKey` to the lowercase `GesturePhase`. */
export function phaseOf(key: DataViewStateKey): GesturePhase {
  return key === "Gesturing" ? "gesturing" : key === "Settling" ? "settling" : "idle";
}

/** Public state — what `getState()` and the `bireactive` adapter cell expose. */
export interface DataViewState {
  key: DataViewStateKey;
  /** Derived: `key === 'Settling'`. */
  transitioning: boolean;
  intent: GestureIntent | null;
  origin: unknown;
  /** Derived: `key === 'Gesturing'`. Displayed order is frozen; scale is not
   *  (value edits scale live — amends interaction-principles.md Rule 15). */
  frozen: { order: boolean };
}

const dataViewStates = defineStates({
  Idle: undefined,
  Gesturing: (intent: GestureIntent, origin: unknown) => ({ intent, origin }),
  Settling: (intent: GestureIntent, origin: unknown) => ({ intent, origin }),
});

function toPublicState(state: { key: string; data: unknown }): DataViewState {
  const key = state.key as DataViewStateKey;
  const data =
    key === "Idle" ? null : (state.data as { intent: GestureIntent; origin: unknown });
  return {
    key,
    transitioning: key === "Settling",
    intent: data ? data.intent : null,
    origin: data ? data.origin : null,
    frozen: { order: key === "Gesturing" },
  };
}

/** Per-chart controller. Created by the chart custom element in
 *  `connectedCallback`, attached to `el.dataView`, disposed in
 *  `disconnectedCallback`. `bindTile` reads it; it does not create it. */
export class DataViewController {
  private machine = matchina(
    dataViewStates,
    {
      Idle: {
        start: (intent: GestureIntent, origin: unknown) => () =>
          dataViewStates.Gesturing(intent, origin),
      },
      Gesturing: {
        commit: () => (ev: { from: { data: { intent: GestureIntent; origin: unknown } } }) =>
          dataViewStates.Settling(ev.from.data.intent, ev.from.data.origin),
        cancel: () => (ev: { from: { data: { intent: GestureIntent; origin: unknown } } }) =>
          dataViewStates.Settling(ev.from.data.intent, ev.from.data.origin),
        start: (intent: GestureIntent, origin: unknown) => () =>
          dataViewStates.Gesturing(intent, origin),
      },
      Settling: {
        settle: () => () => dataViewStates.Idle(),
        start: (intent: GestureIntent, origin: unknown) => () =>
          dataViewStates.Gesturing(intent, origin),
      },
    },
    "Idle",
  );

  /** Begin a gesture (drag/wheel begin). Registers this controller as the
   *  active gesture for cross-tile freeze. */
  start(intent: GestureIntent, origin: unknown): void {
    this.machine.start(intent, origin);
    gestureCoordinator.setActive(this);
  }

  /** Commit the live gesture: Gesturing -> Settling. Clears this controller
   *  from the coordinator immediately (frozen only while Gesturing, not
   *  Settling — other tiles must not stay frozen through settle). */
  commit(): void {
    if (this.machine.getState().key !== "Gesturing") return;
    this.machine.commit();
    this.clearIfActive();
  }

  /** Cancel (Esc revert) the live gesture: Gesturing -> Settling. */
  cancel(): void {
    if (this.machine.getState().key !== "Gesturing") return;
    this.machine.cancel();
    this.clearIfActive();
  }

  /** Called by the view when its settle transition completes (or
   *  immediately, if it has none): Settling -> Idle. */
  settle(): void {
    if (this.machine.getState().key !== "Settling") return;
    this.machine.settle();
  }

  getState(): DataViewState {
    return toPublicState(this.machine.getState());
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: (state: DataViewState) => void): () => void {
    return this.machine.subscribe(() => listener(this.getState()));
  }

  /** Tear down: clears this controller from the coordinator if active. Does
   *  not touch the `bireactive` adapter cell/effect — the adapter disposes
   *  those itself. */
  dispose(): void {
    this.clearIfActive();
  }

  private clearIfActive(): void {
    if (gestureCoordinator.active === this) gestureCoordinator.setActive(null);
  }
}
