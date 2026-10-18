# 2026-08-02 — Chart interaction regressions

Post-vacation dogfooding session. Branch `fix/chart-interaction-regressions`
(PR #181), 5 commits ahead of `main`.

## Regressions fixed

| # | Regression | Cause | Fix | Commit |
|---|---|---|---|---|
| 1 | Bar cmd+wheel felt off vs drag | Wheel deltaY/12 dampener broke 1:1 pixel mapping | Removed dampener | `1c570707` |
| 2 | Obnoxious white border behind bar value axis | Solid backdrop rect with `fill: var(--pv-bg)` | Removed backdrop rect (area/line use shared axis() with none) | `1c570707` |
| 3 | Budget tree drag-resize lagged behind pointer | `GESTURE_ACTIVE_CLASS` not toggled during `dragCancelable`, so `transitionOnUpdated` didn't suppress sibling CSS transitions | Toggle class during drag | `1c570707` |
| 4 | Gantt drag-to-reorder broken | Migration added `transitionOnUpdated()` to gantt → CSS transitions on rect x/y/width/height conflict with gantt's own JS tween system (`tween(entry.yCell, ...)`) | Removed `transitionOnUpdated`; gantt manages `GESTURE_ACTIVE_CLASS` manually | `e3fb7ac8` |
| 5 | Treetable drag-resize broken on Cartesian charts (bar/bands/radar/concentric arc) | Primary column `numberDrag` routed through `_dataView.draft()` → kernel broadcast, but Cartesian charts don't subscribe to kernel. BiNode tree (connected to chart via `Num.lens`) never written | Also write to BiNode `total` measure cell directly in `set` | `e3fb7ac8` |
| 6 | Bar/bands labels jump during reorder | Labels positioned via SVG `<text>` x/y attrs (not CSS-animatable); bars via `<rect>` x/y (CSS-animatable). Labels snapped while bars slid | Labels now positioned via CSS `transform: translate()` on `<g>` wrapper using `translate` opt on `label()` | `e3fb7ac8` |
| 7 | Treemap sort transition: rects jumped instead of animating | `transitionOnUpdated` enabled transitions via rAF, which ran after layout re-derivation wrote new positions | Enable transitions synchronously on rebuild when chart provides `durationMs` | `aa3be898` |
| 8 | Icicle handle rects unmount/remount on sort (no transition) | Handles keyed by sibling pair (`leftId..rightId`); sort changes pairs → DOM teardown/recreate | Key handles by `parentId:index` (position slot) — same slot, different pair, rect attrs transition | `aa3be898` |
| 9 | Handles visible during sort transitions (meaningless mid-flight) | No opacity gate during layout transitions | `_layoutTransitioning` cell: fade handles out on sort change, fade back after `motionMs` | `d673bf1f` |
| 10 | Treemap recursive PAD_TOP over-corrected on drill | Flat reclaim at every depth instead of cumulative | Shift each node by `depth * reclaim` (cumulative) | `aa3be898` |

## Feature added

| Feature | Description | Commit |
|---|---|---|
| Treemap ghostResize toggle | `ghostResize` config (default true): when true, dragging a tile freezes siblings and scales only the edited tile from center. When false, siblings relayout live. | `7d3ee021` |

## Notes

- `kernel.writeValues` on commit writes ALL leaf values and republishes to ALL
  subscribers — violates fine-grained reactivity. Pre-existing, not addressed
  here. Separate refactor needed.
- Four theming PRs (#174, #178, #179, #180) from Jul 21-22 still open; user
  wants to close without merging.
- Sunburst wraparound divider feature partially reverted before vacation;
  fate TBD.
- All regressions except #1-3 were caused by the chart architecture migration
  (`24a0f1ba`, Jul 19): Diagram → CartesianChartBase/RadialChartBase with
  gesture state machine and CSS transitions.
