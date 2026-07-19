# Spec — Enter/Exit Lifecycle

The hierarchical chart family (icicle, sunburst, treemap, pack, treetable) shares a common enter/exit lifecycle for marks (tiles, arcs, circles, rows). This document describes the contract and the `exitFade` config field that controls exit behavior.

## Contract

**Enter:** new marks appear immediately in the DOM with `opacity: 0`. A CSS transition (governed by `transitionOnUpdated`) animates opacity to 1. The transition duration is `motionMs` (live-bound to `motion.motionMs`, default 300ms).

**Exit:** when a mark leaves the rendered set, its membership goes false → opacity transitions to 0. Whether the mark lingers in the DOM during this fade is controlled by `exitFade`:

- `exitFade: true` — `withExitDelay` wraps the rendered list. The mark stays in the DOM for `motionMs`, fades out, then is evicted. The mark's geometry freezes at its last known position during the fade.
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
- `transitionOnUpdated` — installs the CSS transition on the chart's SVG elements. The transition value is live-bound to `motion.motionMs` so the tweaks panel controls timing.

## Timing tokens

All timing is live-bound to `motion.motionMs` (default 300ms):

- `motionMs` — single duration for enter fade, exit linger, and geometry settle on commit/updated. No multipliers.
- `hoverMs` (default 100ms) — micro-feedback (hover/focus stroke, opacity), separate from layout transitions.

Bumping `motion.motionMs` via the tweaks panel updates all layout/fade durations live, without a chart rebuild. See `wiki/transition-timing.md` for the full reference.
