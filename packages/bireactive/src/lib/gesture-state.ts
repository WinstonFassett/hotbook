// Transitional shim. The timer-based gesture-state machine was replaced by the
// per-chart DataViewController + GestureCoordinator (Phase 0/1). pie-chart,
// radar-chart, concentric-arc, and gantt still import `globalGestureActive`
// from this path until Phase 4 migrates them onto the DataViewController
// adapter; re-exporting the real symbol here keeps the package barrel
// importable so those (still type-unmigrated) charts don't turn a missing-
// module resolve error into a load failure for the whole package.
//
// DELETE this file once Phase 4 points those charts at ./data-view-adapter.

export { globalGestureActive } from "./data-view-adapter";
export type { GesturePhase } from "./data-view-controller";
