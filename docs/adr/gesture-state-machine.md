# ADR: DataViewController and Global Gesture Coordinator

**Status:** Proposed  
**Amends:** `wiki/interaction-principles.md` Rule 15 (scale updates during value-editing gestures).  
**Covers:** `WIN-315`, `WIN-288` family, `WIN-300`, `WIN-310` gesture/transition/sort regressions.

## Context

The codebase has no single contract for how gestures, transitions, and live data updates interleave. The result is per-chart duplication and several contradictions:

- `gesture-state.ts` is a timer-based cell (`idle` → `gesturing` → `settling` → `idle` with `setTimeout`). The `settle` event is approximated by a timer, not a signal from the view.
- `tile-binder.ts` `getPhase()` reads `el.gestureActive` (per-element), so a table drag does not freeze a neighboring chart.
- `bar-chart.ts` checks `this.classList.contains(GESTURE_ACTIVE_CLASS)` to decide snap vs tween. This is a CSS class, not a state machine.
- `bar-chart`, `pie-chart`, `radar-chart`, `gauge`, etc. each duplicate `setGestureActive` and `gesturecommit` dispatch.
- `bar-chart` and `tile-binder` use a `gesturecommit` custom event + `queueMicrotask` `applyData({ phase: 'settling' })` workaround because the state machine does not drive the view.
- `wiki/interaction-principles.md` Rule 15 says scale/bounds updates defer to commit. In practice that makes value editing feel broken: the bar must scale live so it stays under the pointer and the value stays readable.
- `wiki/transitions-decision.md` says flat charts (bar, area, pie, radar, etc.) should use CSS transitions for settle/reorder. `bar-chart` currently uses `bireactive` `Anim` tweens for reorders.

## Layered view

From host to kernel:

- **Host app (`hotbook`)** — React. Owns workspace state, `TileRecord`, persistence. Renders `Tile` components. On each render it calls `tileController.update(source)`.
- **`tile-binder` (`packages/d3`)** — mounts the chart custom element, wires `bindEditOut`, `bindHudSync`, and calls `source.applyData(el, { phase, lastRef })`. It creates a per-chart `DataViewController` and registers it with the global `GestureCoordinator`. It is `bireactive`-agnostic except for `biEffect` inside `bindEditOut`.
- **`TileSource` (`buildTileSource` / `makeFlatSource` / `makeHierSource`)** — builds the chart's `dataCell`/`BiNode` tree from a `TileRecord`. One `TileSource` per tile today.
- **Chart custom element (`bar-chart`, `treetable`, etc.)** — uses `bireactive` `biEffect` and `Anim` to build the scene. It reads the chart's `DataViewController` to decide snap vs tween and calls `settle()` when its transition is complete.
- **External `bireactive` runtime** — `cell`, `derive`, `effect`, `batch`. Not imported by `DataViewController` core.
- **External `matchina`** — the state machine library used by `DataViewController`.

When a tab is hidden, `bindTile` disposes its `bireactive` effects, `DataViewController`, and any per-chart `TileSource` state. Hidden tiles are not kept alive.

## Decision

### Name and scope

`GestureController` is a misnomer. Each chart has a **per-chart `DataViewController`**: it owns that chart's direct-manipulation lifecycle and the transition lifecycle for live data / config changes. A small, separate **`GestureCoordinator`** tracks the currently active `DataViewController` and exposes a `globalGestureActive` signal.

### `matchina` shape

The machine is built with `matchina` states and transitions. `intent` and `origin` are state `data` (payload). `origin` is `unknown` so the core machine stays view-agnostic.

```ts
const states = defineStates({
  Idle: undefined,
  Gesturing: (intent: 'edit' | 'reorder', origin: unknown) => ({ intent, origin }),
  Settling: (intent: 'edit' | 'reorder', origin: unknown) => ({ intent, origin }),
});

const dataView = matchina(
  states,
  {
    Idle: {
      start: (intent, origin) => () => states.Gesturing(intent, origin),
    },
    Gesturing: {
      commit: () => (ev) => states.Settling(ev.from.data.intent, ev.from.data.origin),
      cancel: () => (ev) => states.Settling(ev.from.data.intent, ev.from.data.origin),
      start: (intent, origin) => () => states.Gesturing(intent, origin),
    },
    Settling: {
      settle: () => () => states.Idle(),
      start: (intent, origin) => () => states.Gesturing(intent, origin),
    },
  },
  'Idle'
);
```

### Public state

The public state is derived from `matchina`'s `getState()` (key + data). It is what consumers subscribe to.

```ts
interface DataViewState {
  key: 'Idle' | 'Gesturing' | 'Settling';
  transitioning: boolean; // derived: key === 'Settling'
  intent: 'edit' | 'reorder' | null;
  origin: unknown;
  frozen: { order: boolean }; // derived: key === 'Gesturing'
}

// Returned by DataViewController.getState() and the bireactive adapter cell.
```

`frozen.order` means the chart's displayed order is frozen; the data store may change order but the layout does not reorder until `commit`. Scale is **not** frozen by default; value edits scale live. This amends `wiki/interaction-principles.md` Rule 15.

The `DataViewController` core follows the `matchina` contract: `getState()`, `subscribe()`, and `send()`. The `bireactive` adapter (`data-view-adapter.ts`) creates a `Writable<DataViewState>` cell from `getState()` and `subscribe()`. The `DataViewController` core does not import `bireactive`.

### Ownership and lifecycle

The **chart custom element owns its `DataViewController`**. It creates it in `connectedCallback`, attaches it to `el.dataView` so `tile-binder` can read it, and disposes it in `disconnectedCallback`. `bindTile` does not create or inject it. `DataViewController` dispose unsubscribes the `bireactive` cell, removes DOM-effect hooks, and clears the `GestureCoordinator` active reference if it is this controller.

### Global gesture coordinator

- One `GestureCoordinator` singleton.
- `DataViewController` `start()` calls `coordinator.setActive(this)`.
- `DataViewController` `commit()` / `cancel()` / `settle()` calls `coordinator.setActive(null)` if it is the active controller.
- `globalGestureActive` is `coordinator.active !== null`.

### `applyData` phase

`tile-binder` `getPhase(el)` becomes:

```ts
const dv = el.dataView; // per-chart, owned by the chart
const active = gestureCoordinator.active;
if (active && active !== dv) return 'gesturing'; // frozen by another tile's gesture
return dv.getState().key; // 'idle' | 'gesturing' | 'settling'
```

If a tile is the origin of the gesture, it uses its own `DataViewController` state. If another tile is the origin, this tile is `gesturing` (frozen order). When the origin tile is `Settling`, all other tiles are `idle` and can animate their own autonomous transitions.

### `settle` from the view

- `settle()` is called by the view when its transition finishes.
- `tile-binder` does not call `settle`.
- `applyData` in the `settling` branch writes `dataCell.value` only if the data actually changed (order, values, or length). If there is no data change, the view is still in `Settling` and must call `dataView.settle()` when its transition completes, or immediately if it has no transition.
- `settle()` is always called by the mechanism that knows the transition duration:
  - `withSettle` for CSS transitions (listens to `transitionend` on a container).
  - `withAnimSettle` for `bireactive` `Anim` completion.
  - The chart's `refresh` method for charts with no autonomous transition (e.g. `treetable` today).
  - `numberDrag` `onEnd` for no-transition value edits.
  - `biEffect` sets target values but does not call `settle()` directly for CSS charts; it lets `withSettle` handle it.
- Both helpers respect `prefers-reduced-motion` by calling `settle()` immediately when autonomous motion is suppressed. The `DataViewController` core does not import `withSettle`.

### `bar-chart` / `bands` transitions

`bar-chart` and `bands` are the same custom element (`v-br-bar`), so both use the same implementation. They should use CSS transitions for settle/reorder, matching `transitions-decision.md`. The `Anim` usage is a deviation and should be migrated. `bireactive` `Anim` remains available for effects CSS cannot express (stagger, path `d` in Firefox, etc.) through `withAnimSettle`, but `bar-chart` does not use it.

For a reorder cancel/no-op, `dataCell.value` does not change, so `applyData` `settling` is skipped. The `bar-chart` `onEnd` must set `barX`/`barY` targets with CSS `transition` and call `dataView.settle()` on `transitionend` (via `withSettle` on the container).

### `GESTURE_ACTIVE_CLASS`

The DOM adapter sets `GESTURE_ACTIVE_CLASS` on `origin` while `dataView.getState().key === 'Gesturing'`. The `setGestureActive` duplication in charts is removed. `bar-chart` stops reading `this.classList.contains(...)` and reads `this.dataView.state.value.key` (via the `bireactive` adapter cell).

### `DragConfig` / `WheelConfig`

Add `intent` and `origin` fields. `interaction.ts` calls `dataView.start(intent, origin)` on `begin`, `dataView.commit()` on `end`, `dataView.cancel()` on cancel.

### Cross-layer integration

The ADR presumes several changes in other layers. These must be explicit:

- **`interaction.ts` `end` ordering.** `dragController`/`wheelController` `end` must call `dataView.commit()`/`cancel()` **before** `config.onEnd`. `onEnd` then sees `Settling` (the view is still in transition) and can start `tween`/transition and call `dataView.settle()` when it finishes. `dataView` only becomes `Idle` after `settle()` is called. This is the key lifecycle change: `Gesturing` → `commit/cancel` → `Settling` → `onEnd` + view transition → `settle()` → `Idle`.
- **`numberDrag` (`packages/bireactive/src/lib/number-drag.ts`).** Remove `setHostActive`/`GESTURE_ACTIVE_CLASS`. Add `dataView`, `intent`, and `origin` to `NumberDragOpts`. `onEnd` calls `dataView.settle()` if no transition.
- **`reorder-gesture` (`packages/bireactive/src/lib/reorder-gesture.ts`).** Remove `setGestureActive`/`GESTURE_ACTIVE_CLASS` calls. Add `dataView`, `intent`, and `origin` to `ReorderGestureConfig`. The chart's `onEnd` callback is responsible for `dataView.settle()` after any tween.
- **`bar-chart` (`packages/bireactive/src/charts/bar-chart.ts`).** Create `DataViewController` in `connectedCallback` and dispose in `disconnectedCallback`. Remove `GESTURE_ACTIVE_CLASS` checks in `biEffect`, `pointermove`, and `click`; read `dataView.state.value` and `globalGestureActive.value` instead. Remove `gesturecommit` dispatch and `setGestureActive` in `dragConfig`/`wheelConfig`/`snapshot`. The `dragConfig`, `wheelConfig`, and `attachReorderGesture` calls use `dataView`/`intent`/`origin`. `onEnd` uses `withSettle` and calls `dataView.settle()` after its transition. `biEffect` `Settling` branch sets CSS targets but does not call `settle()` directly.
- **Other charts.** `pie-chart`, `radar-chart`, `concentric-arc`, `gauge`, `gantt`, `sankey`, and hierarchical charts (`sunburst`, `icicle`, `pack`, `treemap`) have the same `setGestureActive`/`gesturecommit`/`GESTURE_ACTIVE_CLASS` duplication and must be updated the same way.
- **`treetable` (`packages/bireactive/src/charts/treetable.ts`).** Create `DataViewController` in `connectedCallback`. Its `refresh` method (called by `applyData` in `settling`) must call `dataView.settle()`. `makeHierSource` passes `dataView`/`intent`/`origin` into `numberDrag`.
- **`transitions.ts` helpers.** Add `withSettle(el, dataView, transition)` for CSS `transitionend` and `withAnimSettle(anim, ...tweens, dataView)` for `bireactive` `Anim` completion. Both respect `prefers-reduced-motion` by calling `settle()` immediately.
- **`bireactive` adapter (`data-view-adapter.ts`).** Expose `createDataViewCell(dataView)` returning `Writable<DataViewState>`, a DOM effect that toggles `GESTURE_ACTIVE_CLASS` on `origin`, and `globalGestureActive` as a reactive cell.
- **`tile-binder` (`packages/d3/src/host/tile-binder.ts`).** `bindTile` reads `el.dataView` from the chart; it does not create or inject it. Remove the `onCommit` `gesturecommit` handler. `getPhase` uses `GestureCoordinator` and `dataView.getState()`. `applyData` `settling` writes `dataCell.value` only if the data changed and calls `el.refresh?.()` if the chart defines it.
- **`hotbook` `Tile` component.** Ensure `tileController.dispose()` is called on unmount; it already is, but `dispose` now also tears down the `DataViewController`.
- **`packages/bireactive/package.json`.** Add `matchina` dependency (or rely on workspace `matchina` if already wired).
- **`wiki/interaction-principles.md`.** Update Rule 15 text, not just the ADR reference.
- **Standalone charts (`demos`/`docs`).** Charts used outside `tile-binder` need a `DataViewController` either supplied by the harness or created lazily in `connectedCallback`.

## Rejected: `Settled` state

A `Settled` state (committed but still revertable) was considered. It was rejected because:

- `Esc` today cancels a *live* gesture, not a persisted state.
- Reverting after commit would require undoing a workspace persistence step, which is not a current requirement.
- If it becomes needed later, it can be added as an additional state without breaking the existing `Idle`/`Gesturing`/`Settling` graph.

## Consequences

- `gesture-state.ts` is replaced by per-chart `DataViewController` + `GestureCoordinator`.
- `gesturecommit` and `tile-binder` `onCommit` queueMicrotask are removed.
- `setGestureActive` duplication in charts is removed.
- `bar-chart` (and others) read `this.dataView.state.value` instead of `GESTURE_ACTIVE_CLASS`; each chart creates and owns its `DataViewController`.
- `tile-binder` `applyData` `settling` branch always writes `dataCell.value`.
- `matchina` is added as a dependency of `packages/bireactive` (or used from local `matchina` if workspace is wired).
- `wiki/interaction-principles.md` Rule 15 is amended: value edits scale live; deferred scale is a future exception only.

## Deferred

- **Shared `BiNode` / `dataCell` tree across tiles.** Each tile builds its own `TileSource` today. A shared reactive tree for the same dataset is a future optimization, not in this change.
