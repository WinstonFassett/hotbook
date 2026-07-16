# Handoff: Unified gesture/transition state machine for vizform

**Date:** 2026-07-13

> **Historical note (2026-08):** The `packages/bireactive/` fork referenced throughout this handoff has been removed from the repo. The file paths are historical — they describe the deleted fork's structure, not the current codebase. The handoff's *plan and ordering* are still relevant; the *file paths* are not.
**From:** design session with Dude  
**To:** Fable (planning / implementation)  
**Status:** ADR ready; moving to delivery plan.

## Goal

Replace the timer-based `gesture-state.ts` and per-element `GESTURE_ACTIVE_CLASS` hacks with a `matchina`-driven state machine that owns each chart's gesture and settle lifecycle, plus a global `GestureCoordinator` that freezes cross-tile order during live gestures.

## Authoritative ADR

`docs/adr/gesture-state-machine.md` is the source of truth. Read it first. It covers:

- Per-chart `DataViewController` (owned by the chart custom element, created in `connectedCallback`, disposed in `disconnectedCallback`).
- Global `GestureCoordinator` singleton.
- `matchina` state graph: `Idle → Gesturing → Settling → Idle`.
- Public state derived from `matchina` `getState()`: `key`, `transitioning`, `intent`, `origin`, `frozen`.
- `settle()` is view-owned; `withSettle` for CSS, `withAnimSettle` for `bireactive` `Anim`.
- `bar-chart`/`bands` migrate to CSS transitions.
- `applyData` `settling` writes `dataCell.value` only if data changed.
- `interaction.ts` `end` ordering: `dataView.commit()`/`cancel()` before `config.onEnd`.

## Key decisions already made

1. **Chart owns `DataViewController`** — no inversion of control. `bindTile` reads `el.dataView` but does not create it.
2. **No `Snapshot` concept** — `matchina` `getState()` is the public state; `bireactive` adapter exposes `dataView.state`.
3. **CSS is the default for `bar-chart`/`bands`** — `Anim` is a deviation and should be removed.
4. **`settle` is always called by the mechanism that knows the transition duration** — `withSettle`, `withAnimSettle`, `refresh`, or `numberDrag` `onEnd`; `biEffect` sets targets but does not call `settle()` for CSS charts.
5. **Per-tile `TileSource` remains** — shared `BiNode` cache is a future optimization, not in scope.
6. **Rule 15 amended** — value edits scale live; deferred scale is a future exception.

## Preliminary impact analysis

### New files

- `packages/bireactive/src/lib/data-view-controller.ts`
- `packages/bireactive/src/lib/gesture-coordinator.ts`
- `packages/bireactive/src/lib/data-view-adapter.ts`
- `packages/bireactive/src/lib/with-settle.ts` (or additions to `transitions.ts`)

### Core files to change

- `packages/bireactive/src/lib/gesture-state.ts` — delete
- `packages/bireactive/src/lib/interaction.ts` — `dataView`/`intent`/`origin` in `DragConfig`/`WheelConfig`; `end` ordering
- `packages/bireactive/src/lib/transitions.ts` — add `withSettle`/`withAnimSettle`
- `packages/bireactive/src/index.ts` — update exports

### Shared gesture helpers

- `packages/bireactive/src/lib/number-drag.ts` — drop `setHostActive`, add `dataView`/`intent`/`origin`/`onEnd` `settle`
- `packages/bireactive/src/lib/reorder-gesture.ts` — drop `setGestureActive`, add `dataView`/`intent`/`origin`
- `packages/bireactive/src/lib/gestures.ts` — hierarchical chart `wheel`/`keyboard` uses `dataView`
- `packages/bireactive/src/lib/cartesian-gestures.ts` — line/area/scatter drag/wheel uses `dataView`
- `packages/bireactive/src/lib/chart-context.ts` — use `dataView` instead of `GESTURE_ACTIVE_CLASS` for tween gate

### Chart files

- `packages/bireactive/src/charts/bar-chart.ts` — own `DataViewController`, CSS transitions, remove `gesturecommit`/`setGestureActive`
- `packages/bireactive/src/charts/treetable.ts` — own `DataViewController`, `refresh` calls `settle`
- `packages/bireactive/src/charts/pie-chart.ts` — same `GESTURE_ACTIVE_CLASS`/`gesturecommit` cleanup
- `packages/bireactive/src/charts/radar-chart.ts` — same
- `packages/bireactive/src/charts/concentric-arc.ts` — same
- `packages/bireactive/src/charts/gantt.ts` — same
- `packages/bireactive/src/charts/gauge.ts` — `numberDrag` passes `dataView`
- `packages/bireactive/src/charts/gauge-segmented.ts` — same
- `packages/bireactive/src/charts/treemap.ts` — `attachChartGestures` cleanup
- `packages/bireactive/src/charts/pack.ts` — same
- `packages/bireactive/src/charts/sunburst.ts` — same
- `packages/bireactive/src/charts/icicle.ts` — same
- `packages/bireactive/src/charts/tree-chart.ts` — same
- `packages/bireactive/src/charts/line-chart.ts` — `chartContext`/`cartesian-gestures` cleanup
- `packages/bireactive/src/charts/area-chart.ts` — same
- `packages/bireactive/src/charts/scatter-chart.ts` — same
- `packages/bireactive/src/charts/sankey-flow.ts` — same
- `packages/bireactive/src/lib/sankey.ts` — same

### Host / binding layer

- `packages/d3/src/host/tile-binder.ts` — remove `gesturecommit` handler, update `getPhase`, `applyData` `settling` writes only on change, `bindTile` reads `el.dataView` not creates it
- `packages/d3/src/host/tile-binder.ts` (hier) — `makeHierSource` `mountProps` passes `dataView`/`intent`/`origin` into `numberDrag`
- `packages/d3/tests/host/tile-binder.test.ts` — update tests for new `getPhase` contract

### Package / docs

- `packages/bireactive/package.json` — add `matchina` dependency
- `wiki/interaction-principles.md` — update Rule 15 text

## Open risks / questions for implementation

1. **`matchina` dependency.** `matchina` is not currently in `vizform` workspace; decide `npm install matchina`, `file:../../matchina`, or symlink before implementation starts.
2. **`chart-context` `tween` layer.** `chart-context` uses `GESTURE_ACTIVE_CLASS` to decide structural-tween vs snap. It needs `dataView` and `withAnimSettle` integration. `line`/`area`/`scatter` charts depend on it.
3. **`bar-chart` CSS migration detail.** Per-bar `transitionend` aggregation is solvable via container listener + `settle`; confirm `settleTransition` properties are `x`, `y`, `width`, `height`, `fill`.
4. **`interaction.ts` `end` ordering.** `onEnd` now runs after `dataView.commit()`/`cancel()`; verify `bar-chart` and `reorder-gesture` `onEnd` assumptions hold.
5. **Test harness / WIN-300 cross-chart freeze.** The R2 harness in `packages/d3/tests/host/tile-binder.test.ts` and `bar-chart` tests need updating for `dataView` state.
6. **Other charts with `gesturecommit`/`GESTURE_ACTIVE_CLASS`.** Some may be dead code or stubs; a `grep` pass will reveal which are real vs copy-paste.

## Suggested skills for next agent

- `codebase-exploration` — to map the actual callers of `gesturecommit`/`setGestureActive`/`GESTURE_ACTIVE_CLASS`.
- `systematic-debugging` — for the `bar-chart` CSS migration and `chart-context` integration.
- `tdd` — for `DataViewController` + `GestureCoordinator` + `tile-binder` tests.
- `multica-api` — if breaking this into tickets in Multica.

## Related docs

- `docs/adr/gesture-state-machine.md`
- `wiki/interaction-principles.md`
- `wiki/transitions-decision.md`
- `wiki/gesture-transition-lineage.md`
- `packages/bireactive/src/lib/gesture-state.ts`
- `packages/bireactive/src/lib/interaction.ts`
- `packages/d3/src/host/tile-binder.ts`
