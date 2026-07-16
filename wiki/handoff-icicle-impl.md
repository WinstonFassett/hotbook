# Handoff: Clean icicle implementation + demo + scenario testing

**Date:** 2026-08
**From:** design session
**Status:** all families specced; ready to validate the specs by building icicle from scratch.

## Goal

Validate the gesture/transition architecture by building a **clean icicle implementation** from the specs — no forked bireactive, no cargo-culted code — and demoing it live alongside a side table, then working out the best way to test all our scenarios in-browser.

The icicle is the reference spec for the Hierarchical family and exercises the most contract surface (boundary knob, wheel, keyboard, reorder, drill, cross-tile, conservation, enter/exit). If icicle works end-to-end, the family contract is proven; the other three hierarchical charts (sunburst, treemap, pack) are deltas on it.

## What to build

A clean icicle chart + a side table, sharing a `DataView` on the same canonical config. Built on bireactive's **public exports** (or a patch package if a gap is found — escalate, don't fork).

### Scope (in order)

1. **Icicle chart** — rectilinear partition, hierarchical data, multi-level display, drill.
   - Config dimensions: `measure`, `sort` (index/value), `depth`, `orientation` (horizontal/vertical).
   - Edit surfaces (per `wiki/specs/icicle.md` §3): boundary knob (two-sibling reapportion), wheel (additive), keyboard (additive default, Alt → proportional-neighbor), drag-to-reorder (when `canReorder` + `sort === 'index'`).
   - Effects (per §5): `draft` (write-through to reactive tree with sibling ordering frozen), `commit` (recompute + transition), `cancel` (transition to snapshot), `updated` (transition + enter/exit on rendered-set change).
   - Conservation: opt-in, governs own edits only. External edits not corrected.
   - Keyboard goes through the state machine: `start` (`draft`) / `commit` / `cancel` only (no `settle` state); Esc reverts to the snapshot; fractional dynamic step.
2. **Side table** — flat table on the same `DataView`, editable cells (absolute-set type + number-drag).
3. **Cross-tile** — editing in the icicle publishes `draft` to the table; editing in the table publishes `draft` to the icicle. Both render the preview. Esc reverts both.

### Out of scope (for this validation round)

- The other 15 charts. They're specced; they get built once icicle proves the contract.
- The `Kernel`/`Kernel.Drafts` shared service — icicle uses a `DataViewController` (per-chart); the global coordinator is a separate concern.
- Polish (colors, fonts, exact easings). Functional correctness first.

## Where it lives

TBD. The bireactive fork is gone. Options (escalate if blocked):
- A new `packages/charts/` or `packages/vizform/` package, depending on bireactive's public exports.
- A demo app (`apps/demos` or similar) hosting the icicle + side table.

## How to test it

Per `wiki/gesture-test-checklist.md`: **in-browser end-to-end behavior is the only acceptance test.** Not `tsc`, not unit tests, not state-machine tests. Those run only after the end-to-end behavior is correct.

### Core scenario (from the checklist)

For the icicle + side table pair:
1. Set sort to value (so a value change would reorder).
2. Start a gesture on element A (drag boundary knob, wheel, or keyboard).
3. A's value updates live under the pointer.
4. The side table updates live to match.
5. **No other element moves/reorders/jumps during the gesture** (siblings frozen — the core invariant).
6. Release.
7. All elements, in the chart **and** the table, transition to their new sorted positions.
8. Press Esc during a gesture.
9. Values and positions revert in both.

### Icicle-specific scenarios to cover

Beyond the core scenario, icicle exercises:

| # | Scenario | What it proves |
|---|---|---|
| 1 | Boundary knob drag — two siblings reapportion, sum preserved | Two-sibling reapportion value-mapping; conservation on own edits |
| 2 | Wheel on leaf — additive, parent total grows, siblings frozen | Additive value-mapping; siblings-frozen invariant |
| 3 | Keyboard additive — arrow on focused tile, Esc reverts sequence | Keyboard through state machine; Esc-revert; dynamic step |
| 4 | Keyboard Alt — proportional-neighbor, parent total preserved | Alt → chart scaling; conservation |
| 5 | Drag-to-reorder — tile slides among siblings, no value change | `reorder` intent; order frozen during gesture, transitions on commit |
| 6 | Drill — click a node, focus changes, ancestors retain, descendants enter | `updated` drill transition; enter/exit lifecycle |
| 7 | Cross-tile: edit in table → icicle renders draft | Cross-tile `draft` publishing; source-defined value-mapping |
| 8 | Cross-tile: edit in icicle → table cell updates | Reverse cross-tile; live update in table |
| 9 | Cross-tile Esc — revert in both surfaces | Esc propagates through the `DataView` to all surfaces |
| 10 | External edit breaks conservation — table cell leaves sum ≠ total, icicle renders anyway | Conservation not enforced on external edits; partition normalizes for display |
| 11 | Orientation toggle — vertical ↔ horizontal morph | `updated` config toggle; whole-chart transition |
| 12 | Sort toggle — index ↔ value, siblings re-order | `updated` sort toggle; transition |
| 13 | `depth` change — levels enter/exit | `updated` depth change; enter/exit |
| 14 | Measure swap — spans re-derive | `updated` measure swap; transition |

### Recording

For each scenario: before/during/after screenshots, element positions via Playwright (prove no sibling moved during gesture), values before/after/Esc, transition completion via `dataView.subscribe` + `transitionend`/`animationend` (no magic timeouts). PASS/FAIL/PARTIAL with one-line explanation.

## What we're validating (the specs, not just the code)

The icicle implementation is a **spec validation exercise**. If a spec is wrong or underspecified, the implementation will hit a wall — and that's the point. Expected friction points (from the specs themselves):

- **Gantt §3 open question:** wheel/keyboard default value (start vs end vs duration vs shift). Not blocking icicle, but will surface when we get to gantt.
- **Table absolute-set value-mapping:** the model carries the value in the `draft`'s `value`; absolute-set means the value *is* the target, not a delta. The `DataView`/`Editor` need to handle this (most surfaces are delta-based). Icicle's cross-tile with a table will exercise this.
- **Radial independent-track vs fixed-total:** the contract split is proposed but unproven. Icicle doesn't exercise Radial; pie/concentric-arc will.
- **Sankey propagation snapshot scope:** graph-wide snapshot. Icicle's snapshot is target + siblings; sankey's is all links. Different scope, same mechanism — icicle validates the snapshot/restore mechanism, sankey validates the wider scope.
- **bireactive integration:** how much of the gesture/transition machinery can be built on bireactive's public exports vs. needs a patch package. Icicle is the first test of this.

## Open questions for the implementation

1. **Where does the code live?** New package? In the demo app? Escalate when starting.
2. **bireactive public exports sufficiency.** Does bireactive export what we need for the `Editor` state machine, `DataView`, gestures, transitions? Or do we need a patch package? Find out by trying to build icicle; escalate if blocked.
3. **`Kernel`/`Kernel.Drafts` scope.** The icicle uses a per-chart `DataViewController`. The global `Kernel.Drafts` (list of active editors, cross-tile coordination) — is that needed for the icicle demo, or can it be deferred? Probably deferred (one chart + one table, both on the same `DataView`); confirm when starting.
4. **Testing harness.** Playwright? The checklist says Playwright for element positions. Is there an existing harness, or build one?

## Concrete steps

1. Decide where the code lives (new package vs demo app); escalate if blocked on bireactive integration approach.
2. Build the icicle chart from `wiki/specs/icicle.md` — partition, multi-level, drill. No gestures yet; just render + drill + `updated` transitions.
3. Add the side table on the same `DataView`. Verify cross-tile data flow (edit in table → icicle re-renders; drill in icicle → table updates if configured).
4. Add the boundary knob gesture (two-sibling reapportion). Verify core scenario 1-9 with the boundary knob.
5. Add wheel (additive). Verify core scenario.
6. Add keyboard (additive + Alt). Verify Esc-revert, dynamic step, state-machine lifecycle.
7. Add drag-to-reorder. Verify `reorder` intent, order frozen during gesture.
8. Run all 14 icicle-specific scenarios. Record results.
9. Fix any spec issues discovered (update `wiki/specs/icicle.md` and `wiki/gesture-architecture.md` if the implementation reveals a contract gap).
10. Once icicle is solid, hand off to the next chart (sunburst — the easiest delta).
