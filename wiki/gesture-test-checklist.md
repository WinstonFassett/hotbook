# Gesture Test Checklist — WIN-327

> User correction: static/unit/`tsc` verification is not acceptance testing. The only verification that counts is in-browser end-to-end behavior: what the user sees and what the browser does. We defer order-transition animations until the gesture ends.

## Core user scenario (applies to every chart + its side table)

For every chart on the demos page there is a side table. The chart and the table share the same underlying data. It does not matter which surface the gesture starts on — the same behavior must hold.

1. Set the chart/table to sort by value (or any sort that would reorder elements).
2. Start a gesture (drag, wheel, or keyboard) on element A.
3. Element A’s value updates live under the pointer.
4. The side table updates live to match the same value.
5. **No other element moves/reorders/jumps under the cursor during the gesture.**
6. Release the pointer (or key).
7. All elements, in the chart **and** the side table, transition/animate to their new sorted positions.
8. Press `Escape` during the gesture.
9. Values and positions revert to pre-gesture state in both the chart and the table.

## Per-chart coverage

For each chart in `apps/demos`, test the core user scenario from both surfaces:

| Status | Chart | Gesture in chart | Gesture in side table | Notes |
|---|---|---|---|---|
| NOT TESTED | BarChart | drag resize bar, ctrl+wheel on bar | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | Bands | drag resize band, ctrl+wheel on band | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | LineChart | drag point, ctrl+wheel on point | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | AreaChart | drag point, ctrl+wheel on point | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | ScatterChart | drag point, ctrl+wheel on point | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | PieChart | drag slice boundary, ctrl+wheel on slice | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | RadarChart | drag spoke endpoint, ctrl+wheel on spoke | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | ConcentricArc | drag ring arc, ctrl+wheel on ring | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | Gauge | drag endpoint / center scrub, ctrl+wheel | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | GaugeSegmented | drag segment boundary / center scrub, ctrl+wheel | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | Gantt | drag task, ctrl+wheel, drag label reorder | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | Icicle | drag node boundary, ctrl+wheel, drag-to-reorder | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | Sunburst | drag slice boundary, ctrl+wheel, drag-to-reorder | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | Pack | drag disc, ctrl+wheel | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | Treemap | drag tile, ctrl+wheel | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | TreeChart | drag node, ctrl+wheel, drag-to-reorder | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | BudgetTree | drag pill boundary | drag value cell | |
| NOT TESTED | SankeySimple | drag node/link, ctrl+wheel | drag value cell, ctrl+wheel on value cell | |
| NOT TESTED | SankeyComplex | drag node/link, ctrl+wheel | drag value cell, ctrl+wheel on value cell | |

## What to record for each test

For each chart + table pair we will record:

- **App used** (`apps/demos` or `apps/hotbook`)
- **Before/during/after screenshots** (start, mid-gesture, release, post-transition)
- **Element positions** captured via Playwright to prove no sibling moved during the gesture
- **Values** captured before/after/Esc to prove live update and revert, in both chart and table
- **Transition completion** detected by `dataView.subscribe` and `transitionend`/`animationend` events (no magic timeouts)
- **PASS / FAIL / PARTIAL** with a one-line explanation of the failure

## Excluded (per user request)

- `npx tsc --noEmit` (lint/static)
- `npm test -- --run` in `packages/bireactive` or `packages/d3` (unit tests, not browser behavior)
- `Editor` state-machine unit tests (implementation detail)

These are only run once the end-to-end behavior is correct.
