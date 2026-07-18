# Spec — Enter/Exit Lifecycle

The hierarchical chart family (icicle, sunburst, treemap, pack, treetable) shares a common enter/exit lifecycle for marks (tiles, arcs, circles, rows). This document describes the contract and the `exitFade` config field that controls exit behavior.

## Contract

**Enter:** new marks appear immediately in the DOM with `opacity: 0`. A CSS transition (governed by `transitionOnUpdated`) animates opacity to 1. The transition duration is `ENTER_MS = 4 × TRANSITION_BASE_MS` (live-bound to `motion.baseMs`, WIN-352).

**Exit:** when a mark leaves the rendered set, its membership goes false → opacity transitions to 0. Whether the mark lingers in the DOM during this fade is controlled by `exitFade`:

- `exitFade: true` — `withExitDelay` wraps the rendered list. The mark stays in the DOM for `EXIT_MS` (default `4 × TRANSITION_BASE_MS`), fades out, then is evicted. The mark's geometry freezes at its last known position during the fade.
- `exitFade: false` (default for icicle/treemap/pack) — the mark is evicted immediately from the DOM. No exit fade plays. This is correct for charts where content moves off-screen on drill (the mark is gone, no fade needed).

**`prefers-reduced-motion`:** both enter and exit collapse to instant (no transition, no delay).

## Config

`ChartConfig.exitFade?: boolean` — controls whether `withExitDelay` is applied. Defaults per chart:

| Chart    | Default `exitFade` | Rationale                                              |
|----------|---------------------|-------------------------------------------------------|
| Icicle   | `false`             | Content moves off-screen on drill; no fade needed.    |
| Treemap  | `false`             | Same as icicle.                                       |
| Pack     | `false`             | Same as icicle.                                       |
| Sunburst | `true`              | Radial — items fade in place on level changes.        |
| Treetable| n/a                 | Table rows use CSS row transitions, not mark lifecycle.|

Override via the tile config (`exitFade` field on the tile) or the chart element's `exitFade` setter (bi-adapter).

## Implementation

- `withExitDelay(source, { key, exitMs, immediate })` — wraps a reactive list so removed items linger for `exitMs` before eviction. The `immediate` flag (when true at update time) evicts leavers immediately — used for drill transitions where held-over items would remap to degenerate geometry.
- `membershipCell(presentNodes, keyFn)` — reactive `Set<key>` for O(1) "is this item still present?" checks. Each mark reads `membership.value.has(id)` to set its opacity.
- `transitionOnUpdated` — installs the CSS transition on the chart's SVG elements. The transition value is live-bound to `motion.baseMs` so the tweaks panel controls timing.

## Timing tokens

All timing is live-bound to `motion.baseMs` (WIN-352):

- `TRANSITION_BASE_MS` — base token (default 100ms). Every duration is a multiple.
- `ENTER_MS = 4 × TRANSITION_BASE_MS` (400ms at default) — enter fade window.
- `EXIT_MS = 4 × TRANSITION_BASE_MS` (400ms at default) — exit linger window.
- Settle duration = `3 × TRANSITION_BASE_MS` (300ms at default) — geometry settle on commit/updated.

Bumping `motion.baseMs` via the tweaks panel updates all of these live, without a chart rebuild.
