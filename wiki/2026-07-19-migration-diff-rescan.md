# E-spike — Migration diff re-scan

**Commits scanned:** `621b1b42` (migrate all charts off Diagram) + `908827bf` (bugfixes)
**Date:** 2026-07-19
**Method:** Three parallel read-only sub-agents, each comparing pre-migration (`621b1b42^`) vs post-migration (`908827bf`) versions of 4 charts. 12 charts total.

## Result: No new regressions found

All 12 migrated charts preserve their gesture wiring, reactive wiring, and interaction functionality. The migration is a clean refactoring that centralizes CSS injection and gesture management into base classes and shared behaviors.

## Charts scanned

| Chart | Risk | Notes |
|---|---|---|
| **pie-chart** | — | Intentional rewrite as SunburstChart wrapper (single-level sunburst). Old standalone Diagram replaced. SunburstChart provides equivalent wheel/keyboard/cross-tile sync via shared hierarchical gesture infra. No reorder in old or new. |
| **radar-chart** | — | Gesture wiring preserved (setGestureActive, wheel/drag/keyboard). FILL_STYLE dropped from CSS but base class sets equivalent inline styles. Bridge refactored to base class cells. |
| **gauge** | — | Gesture wiring preserved. FILL_STYLE dropped (base class handles). Bridge refactored. |
| **gauge-segmented** | — | Same as gauge. |
| **area-chart** | — | Uses `attachCartesianGestures` + `transitionOnUpdated()`. Gesture suppression CSS injected by the behavior (not static styles). |
| **line-chart** | — | Same as area. |
| **concentric-arc** | — | Has `setGestureActive` calls + `transitionOnUpdated()` for suppression CSS. |
| **sankey** | — | Library handles gestures internally with local `GESTURE_ACTIVE_CLASS` for sort-change suppression. `transitionOnUpdated()` also installed. |
| **gantt** | — | `setGestureActive`, `attachReorderGesture`, drag/wheel/keyboard all preserved. CSS moved to `ensureGanttCss()` + base class + `transitionOnUpdated()`. |
| **budget-tree** | — | `dragCancelable` preserved. CSS moved to `ensureBudgetCss()`. |
| **tree-chart** | — | `attachChartGestures` + d3-zoom preserved. CSS moved to `ensureTreeCss()`. |
| **scatter** | — | `attachCartesianGestures` preserved. CSS moved to `ensureScatterCss()`. |

## Key architectural change (not a regression)

**Old:** `static styles = \`...${GESTURE_SUPPRESSION_CSS}...\`` per chart
**New:** `transitionOnUpdated()` behavior injects suppression CSS at runtime (line 106 of `transition-on-updated.ts`):
```css
${selector}.${GESTURE_ACTIVE_CLASS} * { transition: none !important; }
```

This is centralized — the behavior owns the suppression class toggle (line 118: subscribes to editor state machine) and the CSS injection. No chart needs to include `GESTURE_SUPPRESSION_CSS` in its own styles anymore. Group 2 sub-agent initially flagged area/line/concentric-arc as missing this CSS, but verification confirmed `transitionOnUpdated()` injects it — false positive.

## Conclusion

The migration is clean. All previously-identified regressions (A1/A2/A3, bar reorder corruption) have been fixed and verified. No additional regressions surfaced from this re-scan. The branch is ready for review.
