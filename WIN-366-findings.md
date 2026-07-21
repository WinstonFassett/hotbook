# WIN-366 Follow-up Findings

Investigation of WIN-327 spec deviations on branch `feat/gesture-transition-contract` (PR #168).

## 1. DataViewController vs DataView reconciliation

### Current State
- **DataViewController** exists (`packages/bireactive/src/lib/editor.ts:190`) but is NEVER instantiated
- **Actual architecture that shipped:**
  - **Hierarchical charts** (treemap, pack, icicle, sunburst, treetable) use `DataView` class (`hierarchical/data-view.ts:159`)
  - **Cartesian/Radial charts** (bar, line, area, scatter, pie, gauge, etc.) use `Gesture` class (`hierarchical/gesture.ts`)
  - Both `DataView` and `Gesture` contain an `Editor` instance internally

### Evidence
```bash
# DataViewController: defined but never instantiated
grep -r "new DataViewController" packages/bireactive/src/
# Result: No matches

# DataView: instantiated in hierarchical charts
grep -r "new DataView" packages/bireactive/src/
# hierarchical-chart-base.ts:420: this._dataView = new DataView(kernel, config, this._gesture.editor);
# side-table.ts:83: this._dataView = new DataView(this._kernel, cfg, this._gesture.editor);

# Gesture: instantiated in cartesian/radial charts
grep -r "new Gesture" packages/bireactive/src/
# cartesian-chart-base.ts:316: this._gesture = new Gesture(undefined, config as any);
```

### Recommendation
**Option (a): Bless the current architecture** — Update WIN-327 spec/ADR to document that:
- `DataView` + `Editor` + `GestureCoordinator` is the canonical pattern for hierarchical charts
- `Gesture` + `Editor` is the canonical pattern for cartesian/radial charts
- `DataViewController` should be either repurposed or removed as unused

This is the shipped reality. The design achieves the intent (unified gesture lifecycle, cross-tile freeze) even though the class name differs from the spec.

## 2. bar-chart / bands CSS transitions

### Current State
- **bar-chart** (`packages/bireactive/src/charts/bar-chart.ts`) **DOES use CSS transitions**
  - Line 8-10: "Uses CartesianChartBase with CSS transitions for settle"
  - Imports `transitionOnUpdated` (line 21)
  - Comments throughout confirm CSS transition usage (lines 331-333, 370-372, 405-407)
  - `_transitionOpts()` method (line 773-780) configures CSS transitions
  - No `anim.clock` or cell tweens found

- **bands** (`packages/d3/src/viz/VizRenderer.ts`) **DOES use d3-transition**
  - Line 3: `import 'd3-transition'`
  - Lines 390-414: `.transition('settle')` usage for shape animations
  - This is in the legacy `packages/d3` pre-PowerView code

### Evidence
The issue description may refer to an earlier iteration or different branch. The current `feat/gesture-transition-contract` branch shows bar-chart using CSS transitions as specified.

### Recommendation
**Accept the current state as complete** — bar-chart uses CSS transitions (per spec); bands uses d3-transition because it's legacy d3 package code. If migrating bands to CSS transitions is desired, that should be a separate ticket, as it would require migrating the entire `packages/d3/src/viz/` legacy codebase.

## 3. Rule 15 amendment

### Status: ✅ COMPLETED
Applied the amendment from `wiki/orchestration-handoff.md:34` to `wiki/interaction-principles.md` Rule 15.

Added clarification: "Value edits scale live; deferred scale is a future exception."

## Minor Cleanup Items

### 3a. Hardcoded constants in `packages/d3/src/viz/constants.ts`
**Found:** Lines 7-10, 18-20
```typescript
export const DUR = 380
export const REORDER_DUR = 220
export const EXIT_DUR = 200
export const DUR_MOVE = 600
export const DUR_ENTER = 380
export const DUR_EXIT = 240
```

**Violates:** Interaction Principle 12 (single source of truth for timing)

**Context:** These are in the legacy `packages/d3` codebase (pre-PowerView). The comment at line 5-6 explicitly notes: "Legacy tokens — used by src/components/* (pre-PowerView). Don't add new callers; use motion() below."

**Recommendation:** Leave as-is (documented legacy) OR migrate `packages/d3` visualizations to bireactive (large scope).

### 3b. Hardcoded transition in `hierarchical-chart-base.ts:52`
**Found:**
```typescript
transition: color 100ms, background 100ms;
```

**Context:** This is for breadcrumb button hover styling (drill navigation UI), not data visualization animation.

**Recommendation:** Replace with `motion.hoverMs.value` via a dynamic style or CSS custom property if this level of consistency is desired. Low priority — it's UI chrome, not data animation.

### 3c. TRANSITION_EASING duplication
**Found in 3 files:**
- `packages/bireactive/src/lib/transitions.ts:9`
- `packages/bireactive/src/lib/mark-lifecycle.ts:22` (imports from transitions.ts, then also defines it)
- `packages/bireactive/src/hierarchical/behaviors/mark-lifecycle.ts:22`

**Recommendation:** Consolidate to single definition in `transitions.ts`, ensure all callers import from there.

### 3d. prefersReducedMotion() duplication
**Found in 6 files:**
- `packages/bireactive/src/lib/transitions.ts:23`
- `packages/bireactive/src/lib/mark-lifecycle.ts` (imports from transitions.ts)
- `packages/bireactive/src/hierarchical/treetable-chart.ts`
- `packages/bireactive/src/hierarchical/behaviors/transition-on-updated.ts:20` (defines its own)
- `packages/bireactive/src/hierarchical/behaviors/mark-lifecycle.ts` (imports from transition-on-updated.ts)
- `packages/bireactive/src/lib/cartesian-viewer.ts`

**Recommendation:** Ensure all callers import from `transitions.ts` (single source of truth). Some already do; verify the others.

## Summary

1. **DataViewController reconciliation** — Recommend blessing the current `DataView` + `Gesture` architecture
2. **bar-chart CSS transitions** — Already using CSS transitions; no action needed
3. **Rule 15 amendment** — ✅ Completed
4. **Minor cleanup** — Optional refinements for hardcoded values and duplication (low priority)
