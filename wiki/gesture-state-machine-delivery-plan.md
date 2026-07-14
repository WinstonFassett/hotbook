# Delivery plan: Unified gesture/transition state machine for vizform

**Status:** Proposed  
**Goal:** Implement `docs/adr/gesture-state-machine.md` and restore the gesture/transition/sort behavior for WIN-315, WIN-288, WIN-300, WIN-310.

## Phase 0 — Setup

1. Add `matchina` dependency to `packages/bireactive/package.json`.
   - Try `npm install matchina` first; if it is not published, use `file:../../matchina`.
2. Verify `packages/bireactive` builds and `bireactive` tests still pass.
3. Create `packages/bireactive/src/lib/data-view-controller.ts` and `packages/bireactive/src/lib/gesture-coordinator.ts`.
4. Create `packages/bireactive/src/lib/data-view-adapter.ts`.
5. Add `withSettle` and `withAnimSettle` to `packages/bireactive/src/lib/transitions.ts` (or `with-settle.ts`).

**Exit criteria:** `DataViewController` + `GestureCoordinator` + adapter + settle helpers compile and can be imported.

## Phase 1 — Core state machine and shared controllers

1. Implement `DataViewController` with `matchina` states `Idle`, `Gesturing`, `Settling`.
   - `start(intent, origin)`, `commit()`, `cancel()`, `settle()`.
   - `getState()` returns `DataViewState` with `key`, `transitioning`, `intent`, `origin`, `frozen`.
   - `subscribe()` emits `matchina` change events.
2. Implement `GestureCoordinator` singleton.
   - `setActive(controller)`, `active` getter, `isActive`.
   - `bireactive` adapter exposes `globalGestureActive` as a reactive `Writable<boolean>`.
3. Update `packages/bireactive/src/lib/interaction.ts`.
   - `DragConfig` / `WheelConfig` accept `dataView`, `intent`, `origin`.
   - `dragController` / `wheelController` call `dataView.start()` in `begin`.
   - `end()` calls `dataView.commit()` / `cancel()` **before** `config.onEnd`.
4. Update `packages/bireactive/src/lib/number-drag.ts`.
   - Accept `dataView`, `intent`, `origin`.
   - Remove `setHostActive` / `GESTURE_ACTIVE_CLASS` manipulation.
   - `onEnd` calls `dataView.settle()` if no transition.
5. Update `packages/bireactive/src/lib/reorder-gesture.ts`.
   - Accept `dataView`, `intent`, `origin`.
   - Remove `setGestureActive` / `GESTURE_ACTIVE_CLASS`.
   - Chart `onEnd` callback is responsible for transition + `settle()`.
6. Delete `packages/bireactive/src/lib/gesture-state.ts`.
7. Update `packages/bireactive/src/index.ts` exports.

**Exit criteria:** Unit tests for `DataViewController` + `GestureCoordinator` pass; `numberDrag` and `reorder-gesture` compile without `GESTURE_ACTIVE_CLASS`.

## Phase 2 — `tile-binder` and `bar-chart` (`v-br-bar`, `bands`)

1. `packages/d3/src/host/tile-binder.ts`
   - Remove `gesturecommit` handler.
   - Update `getPhase(el)` to use `el.dataView.getState().key` and `GestureCoordinator`.
   - Update `applyData` `settling` branch to write `dataCell.value` only on actual change.
   - `applyData` `settling` calls `el.refresh?.()` if defined.
   - `bindTile` does not create `DataViewController`; reads `el.dataView`.
2. `packages/bireactive/src/charts/bar-chart.ts`
   - Create `DataViewController` in `connectedCallback`, dispose in `disconnectedCallback`.
   - Remove `setGestureActive` in `dragConfig`/`wheelConfig`/`snapshot`; pass `dataView`/`intent`/`origin`.
   - `attachReorderGesture` passes `dataView`/`intent`/`origin`.
   - Remove `gesturecommit` dispatch.
   - Migrate to CSS transitions: `tile.el.style.transition = settleTransition(["x","y","width","height","fill"])`.
   - `biEffect` reads `dataView.state.value` and `globalGestureActive.value` instead of `classList`.
   - `onEnd` for reorder uses `withSettle` and calls `dataView.settle()`.
3. Update `packages/d3/tests/host/tile-binder.test.ts` for new `getPhase` contract.
4. Re-run WIN-300 cross-chart freeze R2 harness.

**Exit criteria:** `bar-chart` value drag, reorder, and cross-tile freeze work; `tile-binder` tests green.

## Phase 3 — `treetable` and hierarchical value edits

1. `packages/bireactive/src/charts/treetable.ts`
   - Create `DataViewController` in `connectedCallback`, dispose in `disconnectedCallback`.
   - `refresh` calls `dataView.settle()` after rendering.
2. `packages/d3/src/host/tile-binder.ts` (hier `makeHierSource`)
   - `numberDrag` calls in `mountProps` pass `typedEl.dataView`, `intent: 'edit'`, `origin`.
3. Verify treetable value drag and cross-tile freeze.

**Exit criteria:** Treetable value edits and commit/snap back work.

## Phase 4 — Other flat and hierarchical charts

1. Flat charts with `GESTURE_ACTIVE_CLASS` / `gesturecommit`:
   - `packages/bireactive/src/charts/pie-chart.ts`
   - `packages/bireactive/src/charts/radar-chart.ts`
   - `packages/bireactive/src/charts/concentric-arc.ts`
   - `packages/bireactive/src/charts/gantt.ts`
   - `packages/bireactive/src/charts/gauge.ts`
   - `packages/bireactive/src/charts/gauge-segmented.ts`
   - `packages/bireactive/src/charts/sankey-flow.ts`
   - `packages/bireactive/src/lib/sankey.ts`
   For each: create `DataViewController`, remove `setGestureActive`/`gesturecommit`, use `dataView` in gesture configs.
2. Hierarchical charts with `attachChartGestures` (`packages/bireactive/src/lib/gestures.ts`):
   - `packages/bireactive/src/charts/treemap.ts`
   - `packages/bireactive/src/charts/pack.ts`
   - `packages/bireactive/src/charts/sunburst.ts`
   - `packages/bireactive/src/charts/icicle.ts`
   - `packages/bireactive/src/charts/tree-chart.ts`
   Update `gestures.ts` to use `dataView`, then verify each chart still gestures.

**Exit criteria:** No `gesturecommit` / `setGestureActive` / `GESTURE_ACTIVE_CLASS` references remain in chart files except `transitions.ts` and the `GESTURE_SUPPRESSION_CSS` rule.

## Phase 5 — Cartesian charts (`chart-context` + `cartesian-gestures`)

1. `packages/bireactive/src/lib/chart-context.ts`
   - Accept `dataView` in `ChartContextOpts`.
   - Replace `host.classList.contains(GESTURE_ACTIVE_CLASS)` with `dataView.state.value.key === 'Gesturing'`.
   - Use `withAnimSettle` for structural tweens; `settle` immediate when no tween.
2. `packages/bireactive/src/lib/cartesian-gestures.ts`
   - Remove `setGestureActive` / `gesturecommit`.
   - Pass `dataView`/`intent`/`origin` to `dragConfig`/`wheelConfig`.
   - `onEnd` cleanup only; `chartContext` handles `settle`.
3. `packages/bireactive/src/charts/line-chart.ts`, `area-chart.ts`, `scatter-chart.ts`
   - Create `DataViewController` in `connectedCallback`.
   - Pass `dataView` to `chartContext` and `attachCartesianGestures`.

**Exit criteria:** Line/area/scatter value drag and transitions work.

## Phase 6 — Tests, docs, and cleanup

1. Add/update tests for `DataViewController`, `GestureCoordinator`, `withSettle`, `numberDrag`, `reorder-gesture`, `tile-binder` `getPhase`.
2. Re-run `bar-chart` and `treetable` R2 harnesses.
3. Update `wiki/interaction-principles.md` Rule 15 text.
4. Update `packages/bireactive/src/index.ts` to remove `gesture-state` export.
5. Run `knip` or lint to catch dead code.
6. Review `packages/bireactive/package.json` for `matchina` version.

**Exit criteria:** Full test suite green; docs updated; no `gesture-state.ts` references.

## Rollback / risk mitigations

- If `bar-chart` CSS migration proves too risky, keep `Anim` for `bar-chart` in Phase 2 using `withAnimSettle`, and migrate to CSS in a follow-up PR.
- If `chart-context` integration is blocked, Phase 5 can be merged after the `bar-chart`/`treetable` regression fix.
- The `GestureCoordinator` `active` check must be `Gesturing` only, not `Settling`, to avoid breaking other tiles' settle transitions.

## Definition of done

- `gesture-state.ts` removed.
- All charts use `DataViewController`.
- `bar-chart`/`bands` use CSS transitions for settle/reorder.
- Cross-tile freeze (WIN-300) passes.
- `tile-binder` tests pass.
- `wiki/interaction-principles.md` Rule 15 updated.
