# Cross-file maintainability audit (WIN-288)

> **Historical note (2026-08):** The `packages/bireactive/` fork referenced throughout this doc has been removed from the repo. The file paths below are historical — they describe the deleted fork's structure, not the current codebase. The audit's *observations* about duplication and convergence are still relevant; the *file paths* are not. Going forward, gesture/transition code integrates with bireactive via its public exports (or a patch package if needed), not a vendored fork.

## Summary

`packages/bireactive/src/charts` and `packages/d3/src` are converging on the same interaction vocabulary, but the code is still implemented chart-by-chart. The biggest, most mechanical duplication is timing constants; the second is the "snap-vs-tween two-lane gate" that decides whether a value change is a structural change or a value edit; the third is the lifecycle of hierarchical marks (window, render, exit, drill, handles). The D3 `VizRenderer` and `hviz` hierarchical charts have their own token set that is not yet aligned with the bireactive `transitions.ts` token set.

This audit covers the surface requested in WIN-288, does not rewrite code, and proposes sub-tickets to fix it.

## Scope

Audited paths:

- `packages/bireactive/src/charts/*`
- `packages/bireactive/src/lib/*`
- `packages/d3/src/viz/*`
- `packages/d3/src/hviz/*`

## 1. Hardcoded durations and easings

### 1.1 Bireactive charts — copy-pasted constants

The same `SORT_SEC = 0.35` constant is declared independently in eight files, and several charts add their own drill/reorder constants that are not derived from `packages/bireactive/src/lib/transitions.ts`.

| constant | value | file | lines |
|---|---|---|---|
| `SORT_SEC` | `0.35` | `packages/bireactive/src/charts/sunburst.ts` | 38 |
| `SORT_SEC` | `0.35` | `packages/bireactive/src/charts/icicle.ts` | 36 |
| `SORT_SEC` | `0.35` | `packages/bireactive/src/charts/pack.ts` | 35 |
| `SORT_SEC` | `0.35` | `packages/bireactive/src/charts/pie-chart.ts` | 15 |
| `SORT_SEC` | `0.35` | `packages/bireactive/src/charts/bar-chart.ts` | 27 |
| `SORT_SEC` | `0.35` | `packages/bireactive/src/charts/radar-chart.ts` | 16 |
| `SORT_SEC` | `0.35` | `packages/bireactive/src/charts/concentric-arc.ts` | 16 |
| `SORT_SEC` | `0.35` | `packages/bireactive/src/charts/tree-chart.ts` | 30 |
| `SORT_SEC` | `0.35` | `packages/bireactive/src/lib/sankey.ts` | 143 |
| `SORT_SEC` | `0.35` | `packages/bireactive/src/charts/gantt.ts` | 60 |
| `DRILL_DURATION` | `800` | `packages/bireactive/src/charts/sunburst.ts` | 36 |
| `DRILL_SEC` | `DRILL_DURATION / 1000` | `packages/bireactive/src/charts/sunburst.ts` | 37 |
| `DRILL_DURATION` | `800` | `packages/bireactive/src/charts/icicle.ts` | 34 |
| `DRILL_SEC` | `DRILL_DURATION / 1000` | `packages/bireactive/src/charts/icicle.ts` | 35 |
| `DRILL_DURATION` | `800` | `packages/bireactive/src/charts/pack.ts` | 33 |
| `DRILL_SEC` | `DRILL_DURATION / 1000` | `packages/bireactive/src/charts/pack.ts` | 34 |
| `DRILL_DURATION` | `800` | `packages/bireactive/src/charts/treemap.ts` | 35 |
| `DRILL_SEC` | `DRILL_DURATION / 1000` | `packages/bireactive/src/charts/treemap.ts` | 36 |
| `REORDER_SEC` | `0.25` | `packages/bireactive/src/charts/bar-chart.ts` | 675 |
| `REORDER_SEC` | `0.1` | `packages/bireactive/src/charts/icicle.ts` | 550 |
| `REORDER_SEC_LOCAL` | `SORT_SEC` | `packages/bireactive/src/charts/sunburst.ts` | 292 |
| inline rOuter tween | `0.25` | `packages/bireactive/src/charts/concentric-arc.ts` | 227 |
| `DEFAULT_TWEEN_SEC` | `0.35` | `packages/bireactive/src/lib/chart-context.ts` | 108 |
| `animationDuration` default | `400` | `packages/bireactive/src/lib/viewer.ts` | 25 |

Also the inline `tween(..., 0.25, easeInOut)` in `concentric-arc.ts` line 227 is not named or documented. This is a subtle `SORT_SEC` equivalent that diverges for one shape.

### 1.2 Inline CSS transition durations

The `transitions.ts` helpers `settleTransition` and `hoverTransition` already exist, but several call sites still hardcode strings.

| file | line | inline string |
|---|---|---|
| `packages/bireactive/src/charts/treemap.ts` | 361 | `opacity ${ENTER_MS}ms cubic-bezier(0.4,0,0.2,1)` |
| `packages/bireactive/src/charts/pack.ts` | 321 | `opacity ${ENTER_MS}ms cubic-bezier(0.4,0,0.2,1)` |
| `packages/bireactive/src/charts/sunburst.ts` | 41 | `transition: opacity 0.3s ease` (static styles) |
| `packages/bireactive/src/charts/bar-chart.ts` | 414 | `x 0.15s ease, y 0.15s ease, opacity 0.1s ease` |
| `packages/bireactive/src/charts/gantt.ts` | 840 | `opacity 0.1s ease` |
| `packages/bireactive/src/charts/gantt.ts` | 1010 | `stroke 0.12s ease, stroke-width 0.12s ease, opacity 0.12s ease` |
| `packages/bireactive/src/charts/concentric-arc.ts` | 321 | `opacity 0.12s` |
| `packages/bireactive/src/lib/sankey.ts` | 709, 813, 899 | `opacity 0.12s`, `opacity 0.12s, r 0.12s` |
| `packages/bireactive/src/charts/treetable.ts` | 309 | `background 80ms` |

The `cubic-bezier(0.4,0,0.2,1)` string is the same as `TRANSITION_EASING` in `transitions.ts`; `0.12s`, `0.1s`, and `0.15s` map to the `hover`/`highlight` token family. The sankey grip transitions are not in the same design-token tree, but should be.

### 1.3 D3 package — independent token set

`packages/d3/src/viz/constants.ts` contains a second, unrelated timing system:

- `DUR = 380` (legacy settle)
- `REORDER_DUR = 220`
- `EXIT_DUR = 200`
- `EASE = d3.easeExpOut`
- `DUR_MOVE = 600`
- `DUR_ENTER = 380`
- `DUR_EXIT = 240`
- `motion(role, scale, shape, explodeAmount)`

This is used by:

- `packages/d3/src/viz/VizRenderer.ts` (lines 274-276, 390, 395, 400, 404, 408, 414, 508, 535, 555, 566, 819, 824, 826, 828, 837, 1077, 1080, 1084, 1100, 1103, 1106)
- `packages/d3/src/hviz/treemap.ts` (line 191 `motion('move')`, line 249 `motion('exit')`)
- `packages/d3/src/hviz/sunburst.ts` (lines 10, 106, 122, 136, 170, 174)
- `packages/d3/src/hviz/icicle.ts` (lines 9, 86, 116)

These numbers are not multiples of `bireactive/lib/transitions.ts` `TRANSITION_BASE_MS` (100ms). The project currently has two living single-source-of-truth files, which is itself a violation of Interaction Principle 10.

## 2. Copy-pasted gesture patterns

### 2.1 `setGestureActive` + `gesturecommit` dispatch

The exact same closure appears in `bar-chart.ts`, `pie-chart.ts`, `radar-chart.ts`, and `concentric-arc.ts`:

```ts
const setGestureActive = (on: boolean) => { this.classList.toggle(GESTURE_ACTIVE_CLASS, on); (this as any).gestureActive = on; };
```

It is also duplicated in `packages/bireactive/src/lib/cartesian-gestures.ts` line 62 and `packages/bireactive/src/lib/reorder-gesture.ts` line 80.

The `wheelConfig` / `dragConfig` shape (`snapshot`, `restore`, `onEnd`, `dispatchEvent(new CustomEvent("gesturecommit", ...))`) is repeated in `bar-chart.ts`, `pie-chart.ts`, `radar-chart.ts`, `concentric-arc.ts`, `gauge.ts`, `gauge-segmented.ts`, and `gantt.ts`. `cartesian-gestures.ts` refactored this for scatter/line/area; the flat charts still hand-roll it.

### 2.2 `seenSortBy` / `seenMeasureKey` / `seenOrientation` snap-vs-tween gate

This is the canonical "structural change vs value edit" detection. The same shape appears in at least six files:

- `packages/bireactive/src/charts/sunburst.ts` lines 242-247, 323-343
- `packages/bireactive/src/charts/icicle.ts` lines 416-435
- `packages/bireactive/src/charts/pack.ts` lines 248-261
- `packages/bireactive/src/charts/treemap.ts` lines 244-269
- `packages/bireactive/src/charts/bar-chart.ts` lines 503-547
- `packages/bireactive/src/charts/tree-chart.ts` lines 274-315
- `packages/bireactive/src/charts/pie-chart.ts` lines 108-112, 168-174
- `packages/bireactive/src/charts/radar-chart.ts` lines 215-219
- `packages/bireactive/src/charts/concentric-arc.ts` lines 271-275
- `packages/bireactive/src/lib/chart-context.ts` lines 173-198
- `packages/bireactive/src/lib/sankey.ts` lines 286-336

All implement some variation of:

1. capture `untracked` previous values.
2. on effect run, compare `sortBy`/`measureKey`/`orientation`/`order` to previous.
3. if structural and `!host.classList.contains(GESTURE_ACTIVE_CLASS)`, start a `tween(..., SORT_SEC, easeOut)`.
4. else snap value.

`chart-context.ts` is already the shared abstraction for cartesian charts, but it still uses its own `DEFAULT_TWEEN_SEC = 0.35` and the same `GESTURE_ACTIVE_CLASS` check. It could be the single helper if it exported `SORT_SEC` from `transitions.ts`.

### 2.3 Gesture-freeze layout and reorder

The reorder-then-settle flow is repeated in `sunburst.ts`, `icicle.ts`, and `bar-chart.ts`, with `attachReorderGesture` but different per-chart preview math. The right abstraction is the existing `lib/reorder-gesture.ts`, but the preview callbacks still carry sibling-tween cancels and `REORDER_SEC` values per chart.

## 3. Copy-pasted layout / tween effects

### 3.1 Hierarchical drill viewport tween

The "viewport cells" pattern (four `num()` cells representing the current visible rectangle, a `tween` to a target rectangle on drill, and a `GESTURE_ACTIVE_CLASS` flash) is duplicated in:

- `packages/bireactive/src/charts/treemap.ts` lines 166-240
- `packages/bireactive/src/charts/pack.ts` lines 162-191
- `packages/bireactive/src/charts/icicle.ts` lines 275-359
- `packages/bireactive/src/charts/sunburst.ts` lines 220-267

Each chart names the cells differently (`vx0/vy0/vx1/vy1`, `va0/va1/vr0/vr1`, `lx0/ly0/lx1/ly1`) but the structure is identical: hold a viewport, tween it on drill change, and clip the `forEach` output to the current window.

### 3.2 `windowTarget` / `renderedSet` / `windowMembership` / `forEach` lifecycle

The same pattern is repeated in four hierarchical charts:

- `packages/bireactive/src/charts/sunburst.ts` lines 160-163, 296, 579
- `packages/bireactive/src/charts/icicle.ts` lines 270-273, 380, 489
- `packages/bireactive/src/charts/pack.ts` lines 216-219, 223, 320
- `packages/bireactive/src/charts/treemap.ts` lines 296-299, 328, 360

Pattern:

```ts
const renderedSet = withExitDelay(windowTarget, { key: (n) => n });
const windowMembership = membershipCell(windowTarget, (n) => n);
const nodeLayer = s(group());
forEach(nodeLayer, renderedSet, (node) => { ... }, { key: (n) => n.value.id ?? "" });
```

### 3.3 `frozenGeom` on exit

The "exit the mark but freeze its geometry in place so it fades out at its last visible position" pattern is copied in:

- `packages/bireactive/src/charts/sunburst.ts` lines 353-365
- `packages/bireactive/src/charts/icicle.ts` lines 445-457
- `packages/bireactive/src/charts/pack.ts` lines 294-301

The same four `derive` blocks are renamed each time. This is exactly the behavior that `mark-lifecycle.ts` is trying to own, but the hierarchical charts do not use `enterExitFade` consistently (`treemap`/`pack` roll the opacity transition manually, `icicle` uses `settleTransition` only, `sunburst` uses `enterExitFade`).

### 3.4 `handleWindow` / `handleLayer` boundary-knob rendering

The boundary-knob handle generation is duplicated between `sunburst.ts` and `icicle.ts`:

- `packages/bireactive/src/charts/sunburst.ts` lines 630-666
- `packages/bireactive/src/charts/icicle.ts` lines 712-753

Both group nodes by depth, sort by position along the sibling axis, and emit `{ aNode, bNode }` pairs for `forEach` with key `${aNode.value.id}:${bNode.value.id}`. The only difference is the coordinate axis. `treemap` and `pack` do not have these handles yet; adding them will create another copy unless this is shared.

### 3.5 `buildHierarchy` / `buildParentIndex` / `walkWithDepth` boilerplate

The following setup is repeated in every hierarchical chart:

```ts
const root = this.externalRoot ?? portfolio();
const parentIdx = buildParentIndex(root);
const parentOf = (n: BiNode) => parentIdx.get(n);
attachChartGestures(this, { root, parentOf, state });
let totalDepth = 0;
for (const { node, depth } of walkWithDepth(root)) { ... }
```

Files: `treemap.ts`, `sunburst.ts`, `icicle.ts`, `pack.ts`, `tree-chart.ts`, `treetable.ts`, `sankey.ts` (hierarchy via `d3.hierarchy` in `hierarchyToSankey`).

## 4. Keyed rendering and key stability

### 4.1 `forEach` key choices

- `forEach(nodeLayer, renderedSet, ..., { key: (n) => n.value.id ?? "" })` in `treemap.ts`, `pack.ts`, `icicle.ts`.
- `forEach(arcLayer, renderedSet, ..., { key: (n) => n.value.id })` in `sunburst.ts`.
- `forEach(handleLayer, handleWindow, ..., { key: ({ aNode, bNode }) => `${aNode.value.id}:${bNode.value.id}` })` in `sunburst.ts` and `icicle.ts`.
- The bar chart does not use `forEach`; it allocates per-datum cells keyed by datum id and manually looks them up in `barCells`.

The problem is that the `key` function is local at every `forEach` site. The `forEach` primitive is shared, but the key contract is not. This is a key-stability concern; it was the root cause of WIN-257 where live handles were destroyed mid-gesture because the `key` or the `source` cell changed.

### 4.2 `data-*` id bindings

Every chart sets `el.dataset.id = node.value.id ?? ""` (or `tile.el.dataset.id` / `arc.el.dataset.id` / `disc.el.dataset.id`) independently. This is a low-level contract that could be centralized in the `forEach` callback or a helper.

## 5. Other duplication smells

### 5.1 Remap helpers

Every hierarchical chart has local `remapX`/`remapY` or `remapAngle`/`remapRadius` functions to map from layout space to canvas space. These are the same concept for every zoomable chart.

### 5.2 `attachChartGestures` options

`treemap.ts`, `sunburst.ts`, `icicle.ts`, `tree-chart.ts`, `pack.ts` all call `attachChartGestures` with `scalingMode: "proportional-neighbor"` or no scaling mode, and all build the same `SelectionState` object. `gantt.ts` does not use `attachChartGestures` and instead hand-rolls keyboard/wheel/drag controllers.

### 5.3 `makeBridge` / `emitHover` / `emitSelect`

The cross-tile bridge is wired per chart in `bar-chart.ts`, `cartesian-gestures.ts`, `gantt.ts`, `sunburst.ts`, `icicle.ts`, `treemap.ts`, `pack.ts`, `radar-chart.ts`, `pie-chart.ts`, `concentric-arc.ts`, `sankey.ts`, `treetable.ts`, `budget-tree.ts`, `sankey-flow.ts`. Some use a helper, some inline it.

### 5.4 `settleTransition` vs `enterExitFade` vs inline opacity

Enter/exit/opacity lifecycle is a single concept but has three implementations:

- `mark-lifecycle.ts` `enterExitFade(el, { present })` — used by `sunburst.ts`
- `settleTransition(['fill', 'stroke', ...])` — used by `icicle.ts`
- Inline `tile.el.style.transition = `opacity ${ENTER_MS}ms ...` with `requestAnimationFrame` fade — used by `treemap.ts`, `pack.ts`
- `settleTransition(['opacity', 'transform']), background 80ms` — used by `treetable.ts`

### 5.5 `sankey.ts` outlier

`packages/bireactive/src/lib/sankey.ts` defines its own `GESTURE_ACTIVE_CLASS = "gesture-active"` (line 287), which is the wrong class name (actual `vf-gesture-active`) and is never set on the host. The `SORT_SEC` used there is also the only `SORT_SEC` exported from `lib/` rather than `charts/`, and the grip transitions are hardcoded `0.12s`.

## 6. Judgment: share now / share later / leave alone

### Should share now

1. **Timing constants** — highest value, lowest risk. The `SORT_SEC`/`REORDER_SEC`/`DRILL_SEC`/`DRILL_DURATION` family should be replaced with `TRANSITION_DURATION` from `transitions.ts` (or a new `TRANSITION_DURATION.drill` / `.settle` / `.reorder` in seconds). The D3 constants in `packages/d3/src/viz/constants.ts` should be aligned with the same token set.
2. **Inline CSS transition strings** — replace with `settleTransition` / `hoverTransition` / `enterExitFade` or new helpers. The `cubic-bezier(0.4,0,0.2,1)` and `0.12s`/`0.1s`/`0.15s`/`0.3s` literals are the same tokens expressed differently.
3. **`setGestureActive` + `gesturecommit` dispatch** — a `setGestureActive(host, on)` helper and a `dispatchGestureCommit(host, detail?)` helper should live in `transitions.ts` or `gestures.ts`. Several charts can delete the same 5-line block.
4. **`seenSortBy`/`seenMeasureKey`/`seenOrientation` gate** — move to a shared helper, likely in `chart-context.ts` or a new `lib/tween-gate.ts`. This is the same pattern for every chart and is the core of WIN-257.
5. **`handleWindow`/`handleLayer` boundary generation** — share between `sunburst` and `icicle` before `treemap`/`pack` grow handles. The only variance is which axis is the sibling axis.

### Share later

1. **Full hierarchical viewport tween abstraction** — the `vx0...vy1` four-cell viewport is a real abstraction, but each chart's geometry is just different enough that a shared helper is a medium-sized design task. Worth doing after the timing gate is fixed.
2. **`frozenGeom` exit freeze** — this is a function that can be parameterized by the shape's `x/y/w/h` or `cx/cy/r` or `a0/a1/rIn/rOut`. A shared helper is desirable but the variance is larger.
3. **Cross-tile bridge wiring** — many charts, but the bridge is small and the user-facing semantics differ (hierarchical vs flat vs sankey). A thin adapter can be built after the gesture layer is stabilized.

### Leave alone

1. **Domain constants like `DAY_MS`, `W`, `H`, `ROW_H`, `PAD_ANGLE` etc.** — these are layout geometry, not timing, and naturally belong to the chart.
2. **Chart-specific color, padding, and scale-domain choices** — these are not the duplication under audit.

## 7. Proposed Phase 2 sub-tickets

1. **WIN-289: Single source of truth for timing across bireactive and d3**
   - Export `SORT_SEC`/`REORDER_SEC`/`DRILL_SEC` equivalents from `transitions.ts` (or a new `lib/timing.ts`) in seconds and milliseconds.
   - Replace every per-file `const SORT_SEC = 0.35` and `const DRILL_DURATION = 800` in `packages/bireactive/src/charts` and `packages/bireactive/src/lib`.
   - Update `chart-context.ts` `DEFAULT_TWEEN_SEC` to use the same token.
   - Align `packages/d3/src/viz/constants.ts` (`DUR`, `REORDER_DUR`, `EXIT_DUR`, `DUR_MOVE`, `DUR_ENTER`, `DUR_EXIT`) with the same role tokens.
   - Update `wiki/interaction-principles.md` Rule 10 from "Partial" to "Done".

2. **WIN-290: Shared snap-vs-tween gate for structural value changes**
   - Extract the `seenSortBy`/`seenMeasureKey`/`seenOrientation`/`order` gate into a helper.
   - Use it in `sunburst`, `icicle`, `pack`, `treemap`, `bar-chart`, `pie-chart`, `radar-chart`, `concentric-arc`, `tree-chart`, `sankey`, `gantt`, and `chart-context`.
   - Ensure the helper respects `GESTURE_ACTIVE_CLASS` and accepts custom tween duration/easing.

3. **WIN-291: Standardize gesture-active and gesturecommit dispatch**
   - Add `setGestureActive(host, on)` and `dispatchGestureCommit(host, detail?)` to `lib/transitions.ts` or `lib/gestures.ts`.
   - Replace duplicated closures in `bar-chart`, `pie-chart`, `radar-chart`, `concentric-arc`, `gauge`, `gauge-segmented`, and `gantt`.

4. **WIN-292: Shared hierarchical mark lifecycle (window, exit, drill)**
   - Unify `withExitDelay` + `membershipCell` + `forEach` + `frozenGeom` into a `windowedMarks` helper that returns `{ renderedSet, windowMembership, renderLayer, freezeOnExit }`.
   - Migrate `sunburst`, `icicle`, `pack`, `treemap` to use it.
   - Standardize `enterExitFade` vs inline opacity transitions.

5. **WIN-293: Shared boundary-knob handle generation and key stability**
   - Extract `handleWindow` derivation from `sunburst` and `icicle` into a `boundaryHandles` helper.
   - Ensure `forEach` key stability for handles so reordering/drilling does not destroy live `dragCancelable` handles (root cause of WIN-257).
   - Apply to `sunburst` and `icicle` first; design `treemap`/`pack` integration.

6. **WIN-294: Clean up sankey gesture-active and inline transitions**
   - Fix `packages/bireactive/src/lib/sankey.ts` `GESTURE_ACTIVE_CLASS` to use the real `vf-gesture-active` exported from `transitions.ts` and wire it through the host class.
   - Replace the inline `0.12s` grip transitions with `hoverTransition` or equivalent.

## 8. References

- `packages/bireactive/src/lib/transitions.ts`
- `packages/bireactive/src/lib/mark-lifecycle.ts`
- `packages/bireactive/src/lib/chart-context.ts`
- `packages/bireactive/src/lib/reorder-gesture.ts`
- `packages/bireactive/src/lib/gestures.ts`
- `packages/bireactive/src/lib/cartesian-gestures.ts`
- `packages/d3/src/viz/constants.ts`
- `packages/d3/src/viz/VizRenderer.ts`
- `wiki/interaction-principles.md` Rule 10
- `wiki/transitions-decision.md`
