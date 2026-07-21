# Delivery Plan: Chart Family Effect Contract

**Status:** Proposed  
**Goal:** Deliver the `Editor`/`DataView`/`BaseChart` family effect contract across every chart in `wiki/gesture-test-checklist.md` and its side table.  
**Grounded in:** `docs/adr/gesture-state-machine.md` and `UBIQUITOUS_LANGUAGE.md`.  
**Source of truth for coverage:** `wiki/gesture-test-checklist.md`.

## Acceptance

The only acceptance that counts is end-to-end in-browser behavior: what the user sees and what the browser does. The core user scenario is the same for every chart and its side table:

1. Sort the chart/table by value (or any sort that would reorder elements).
2. Start a gesture on element A.
3. Element A's value updates live under the pointer.
4. The side table updates live to match the same value.
5. No other element moves/reorders/jumps under the cursor during the gesture.
6. Release the pointer.
7. All elements, in the chart **and** the side table, transition/animate to their new sorted positions.
8. Press `Escape` during the gesture.
9. Values and positions revert to the pre-gesture state in both the chart and the table.

Static/unit/`tsc` verification is not acceptance. The test checklist is the source of truth for coverage.

## Chart-to-family mapping

| Family | Charts |
|---|---|
| `BaseCartesianChart` | `BarChart`, `Bands`, `LineChart`, `AreaChart`, `ScatterChart`, `Gantt` |
| `BaseRadialChart` | `PieChart`, `RadarChart`, `ConcentricArc`, `Gauge`, `GaugeSegmented` |
| `BaseHierarchicalChart` | `Sunburst`, `Icicle`, `Treemap`, `Pack`, `TreeChart`, `BudgetTree` |
| `BaseNetworkChart` | `SankeySimple`, `SankeyComplex`, `SankeyFlow` |
| `BaseTableChart` | `Treetable` |

## Delivery order

Order is chosen by dependency and blast radius:

1. **Core contract** — `Kernel`, `DataView`, `Editor`, `Kernel.Drafts`, `BaseChart` skeleton. Not chart-specific. The contract must exist before any family can be built.
2. **`BaseCartesianChart`** — it owns the shared `chartContext` and `attachCartesianGestures` used by the largest chart family. The `BarChart` is the reference chart for this family.
3. **`BaseRadialChart`** — same two-state `Editor` contract, but the geometry and preview semantics differ. `PieChart` is the reference.
4. **`BaseHierarchicalChart`** — the `BiNode` tree, `buildParentIndex`, portfolio, and `walkTree` primitives are shared here. `Sunburst`/`Icicle` are good references.
5. **`BaseNetworkChart`** — `Sankey` flow layout is the main concern.
6. **`BaseTableChart`** — `Treetable` is HTML, not SVG, so the row/cell gesture layer is a separate family.

## Per-family delivery checklist

For each family:

1. Define the family effect contract (the `snapshot`/`applyPreview`/`commit`/`cancel`/`updated` hooks).
2. Implement the reference chart for the family.
3. Apply the core user scenario from both the chart surface and the side table.
4. Record per the test checklist: app, before/during/after screenshots, element positions, values, transition completion, PASS/FAIL/PARTIAL.
5. Once the reference chart is accepted, the remaining charts in the family should be mechanical porting.

## Per-wave exit criteria

### Wave 1 — Core contract

- `Kernel`, `DataView`, `Editor`, `Kernel.Drafts` types and runtime behavior match the ADR.
- `BaseChart` abstract skeleton connects `DataView`, `Editor`, and `Kernel.Drafts`.
- Observable transitions can be subscribed to and tested in isolation.
- No chart-specific code yet.

### Wave 2 — `BaseCartesianChart`

- `BaseCartesianChart` effect hooks are defined.
- `BarChart` value drag, wheel, and reorder from both chart and side table follow the core user scenario.
- `Bands` reuses the same family contract.
- `LineChart`, `AreaChart`, `ScatterChart`, `Gantt` follow.

### Wave 3 — `BaseRadialChart`

- `BaseRadialChart` effect hooks are defined.
- `PieChart` is the reference chart.
- `RadarChart`, `ConcentricArc`, `Gauge`, `GaugeSegmented` follow.

### Wave 4 — `BaseHierarchicalChart`

- `BaseHierarchicalChart` effect hooks are defined.
- `Sunburst` and `Icicle` are reference charts.
- `Treemap`, `Pack`, `TreeChart`, `BudgetTree` follow.
- Drill-in/out is treated as a separate transition and is validated.

### Wave 5 — `BaseNetworkChart`

- `BaseNetworkChart` effect hooks are defined.
- `SankeySimple` is the reference chart.
- `SankeyComplex`, `SankeyFlow` follow.

### Wave 6 — `BaseTableChart`

- `BaseTableChart` effect hooks are defined.
- `Treetable` is the reference chart.
- HTML row/cell gesture layer is validated.

## Test checklist integration

For each chart and table pair, record:

- App used (`apps/demos` or `apps/hotbook`).
- Before/during/after screenshots.
- Element positions captured via Playwright to prove no sibling moved during the gesture.
- Values captured before/after/Esc to prove live update and revert in both chart and table.
- Transition completion detected by `DataView`/`Editor` transition subscription and `transitionend`/`animationend` events.
- PASS / FAIL / PARTIAL with a one-line explanation of the failure.

## What is out of scope for this plan

- Refactoring or describing legacy gesture/transition code. The ADR is the source of truth for the new contract.
- Cross-mode transitions (flat ↔ hierarchical) are a separate, later problem.
- Performance optimization beyond the current contract.

## Rollback / risk mitigations

- If a family proves too large, split it by chart rather than by the whole family.
- If the `BaseCartesianChart` contract needs revision, the other families should not be started until it settles.
- If `prefers-reduced-motion` handling differs across families, make it an explicit condition in the base contract, not a family-specific workaround.

## Definition of done

- Every chart in `wiki/gesture-test-checklist.md` is mapped to a family.
- Every family has a defined effect contract.
- The core user scenario passes end-to-end for every chart and its side table.
- The ADR, this plan, and the test checklist are consistent with each other.
