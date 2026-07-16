# Handoff — icicle-harness clean rewrite

**Date:** 2026-07-17  
**Branch:** feat/gesture-transition-contract  
**Status:** design remediated; implementation pending

## What we're doing

Rebuild the icicle harness from `wiki/chart-architecture.md` and `wiki/specs/icicle.md` to validate the gesture/transition architecture. This replaces the broken monolithic `icicle-chart.ts` and `side-table.ts`; it is not a patch job.

## Reference docs

- `wiki/chart-architecture.md`
- `wiki/specs/icicle.md`
- `wiki/gesture-architecture.md`
- `wiki/interaction-principles.md`
- `wiki/transitions-decision.md`

## What to keep

- `src/types.ts` — domain model.
- `src/editor.ts` — `Idle`/`Drafting` state machine.
- `src/kernel.ts` — data service.
- `src/data-view.ts` — `DataView` class; `Editor`/`Kernel` wiring is correct after recent fixes.
- `src/main.ts` — app wiring.
- `index.html` — two-panel layout.

## What to throw away

- `src/icicle-chart.ts` — full rewrite. Violates architecture (no reactive tree, no keyed list, wrong coordinate math, wrong commit ordering, handle recreation, inline gestures).
- `src/side-table.ts` — full rewrite. Same violations.

## Target module split

```
apps/icicle-harness/src/
├── types.ts
├── editor.ts
├── kernel.ts
├── data-view.ts
├── main.ts
├── hierarchy/
│   ├── tree.ts          # build reactive ChartNode tree from Dataset
│   ├── window.ts        # derive RenderNode[] from tree + config + drill + frozenOrder
│   ├── layout.ts        # pure fn: tree + config → Map<id, LayoutRect>
│   ├── gestures.ts      # divider-drag, wheel, keyboard, reorder behavior factories
│   └── render.ts        # keyed shape list with forEach, enter/exit fade
└── icicle/
    ├── layout.ts        # d3 partition, orientation-symmetric
    └── chart.ts         # custom element wiring
```

`side-table.ts` stays at top level.

## Per-chart state

- `DataView` owns one `Editor`.
- Chart owns:
  - reactive `ChartNode` tree,
  - `frozenOrder` snapshot,
  - gesture-start value snapshot,
  - `.gesture-active` CSS class on the host,
  - behavior `detach` functions.
- Behavior callbacks write the chart's reactive tree and call `dataView.draft` / `updateDraft` / `commit` / `cancel`.
- The chart's `commit` event handler writes final leaf values to `Kernel`.

## Value propagation

- Leaf values: `num()` cells.
- Parent totals: `total(parts)` lens over child `num()` cells.
- **Additive** (wheel, keyboard default): write target leaf only.
- **Proportional-neighbor** (Alt keyboard) / **two-sibling reapportion** (boundary knob): write target and adjacent sibling so their sum is unchanged; the `total()` parent stays constant.

## Gesture behaviors

All are factory functions returning `attach(element, callbacks)` → `detach()`.

- **Divider drag:** map pointer in SVG viewBox to sibling-axis fraction; write the two adjacent sibling `num()` cells.
- **Wheel:** Cmd/Ctrl+wheel on a tile. Step = 1% of current value; Shift = 0.1%.
- **Keyboard:** arrow keys on focused tile. Alt toggles proportional-neighbor. Track held keys; release of the last held arrow commits; Esc cancels.
- **Reorder:** drag tile along sibling axis. Provisional order from pointer; commit calls `kernel.writeReorder`.

## Rendering

- Use `bireactive` `forEach` over `window`, keyed by node id.
- Each mark is a `group` containing a `rect` and a `label`.
- CSS transitions on marks; `.gesture-active` class on the chart host suppresses them during local drafts.
- Exit marks fade out in place (geometry frozen). If `forEach` cannot delay removal, wrap it in `render.ts`.

## Implementation order

1. `hierarchy/tree.ts`
2. `hierarchy/window.ts`
3. `icicle/layout.ts`
4. `hierarchy/render.ts`
5. `hierarchy/gestures.ts`
6. `icicle/chart.ts`
7. `side-table.ts`
8. Playwright smoke tests

## Open questions for implementation

- Does `bireactive` `forEach` support exit-delay? If not, implement a wrapper in `render.ts`.
- Use `bireactive` `draggable` or manual document listeners? `draggable` uses `setPointerCapture`; verify Playwright support or fall back.
