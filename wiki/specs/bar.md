# Spec — Bar

Reference spec for the Cartesian-discrete family. Gantt is a delta on this (see `wiki/specs/gantt.md`). The family contract is `wiki/gesture-architecture.md` §"Cartesian-discrete".

Vocabulary: `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. `interaction-principles.md` is the living constraints doc. Design only — no code, no file names, no current implementation.

## 1. What is this chart?

A bar chart. Marks are rectangles (bars) positioned by **category** on the discrete axis and sized by **value** on the continuous axis. The discrete axis is a set of fixed slots (categories); the continuous axis is a scalable domain (values). The chart supports **orientation** (vertical: bars go up, category axis is x; horizontal: bars go sideways, category axis is y) — orientation is a reactive config that morphs on change.

- **Family:** Cartesian-discrete (one continuous axis + one discrete axis).
- **Editable:** yes. Creates an `Editor`, registers with `Kernel.Drafts`.
- **Reorderable:** yes (opt-in via `canReorder`, typically when `sortBy === 'index'`).
- **DataView query:** canonical config. `datasetId` names a `flat` `Dataset` (one row per bar). Config dimensions: `measure` (value binding), `sortBy` (`index` or `value`), `orientation` (`vertical` or `horizontal`), `canReorder` (boolean), `snap` (optional snap-on-edit).

## 2. What `DataView` query does it subscribe?

Canonical config. `datasetId` is one field (naming a `flat` `Dataset`); the others:
- `measure` — value binding driving bar length on the continuous axis.
- `sortBy` — `index` (caller order) or `value` (drives slot ordering on the discrete axis).
- `orientation` — `vertical` or `horizontal`. Reactive; morphs on change (WIN-144).
- `canReorder` — boolean; when true and `sortBy === 'index'`, drag-to-reorder is armed.
- `snap` — optional chart snap-on-edit setting.

A livebound `Table` on the same canonical config shares this `DataView`.

## 3. Does it create an `Editor`?

Yes. Control surfaces that produce `draft` events. All produce `intent: edit` (value edits) or `intent: reorder` (reorder); each value-edit surface has its own value-mapping:

- **Drag mark — resize.** Dragging the tip of a bar (the end opposite the baseline) resizes its value. The drag uses the **gesture-start continuous-axis scale** to compute deltas (same start-scale-delta pattern as Cartesian-continuous — avoids the spike from domain re-derivation mid-drag). **Additive** — only the dragged bar's value changes; no sibling redistribution (bar has no sibling-total invariant by default; conservation is opt-in per chart). `intent: edit`.
- **Wheel — bar.** Cmd/Ctrl+wheel over a bar scales its value. **Additive** — only the target changes; dynamic step (∝ value, Shift = fine). `intent: edit`.
- **Keyboard — focused bar.** Arrow up/down (vertical) or left/right (horizontal) edits the focused bar's value. **Additive** by default; Alt → proportional-neighbor (the adjacent bar absorbs the delta, parent total preserved — only meaningful if conservation is on). First arrow begins a gesture; Esc reverts; keyup commits. `intent: edit`.
- **Drag mark — reorder.** When `canReorder` is enabled and `sortBy === 'index'`, dragging a bar along the discrete axis reorders it among its siblings. No value change — reorders only. `intent: reorder`.
- **Programmatic — cross-tile.** A livebound `Table` sharing the `DataView` publishes `draft` events; the bar renders the draft preview. Source-defined value-mapping. Conservation not enforced on external edits (same rule as Hierarchical — the chart's conservation governs its own edits only). `intent: edit`.

**Conservation** (opt-in per chart): when on, the bar chart's own gesture edits preserve `sum(bars) = total` (redistribute to siblings). The boundary-knob pattern from Hierarchical doesn't apply (bars don't share boundaries); conservation is enforced through the value-mapping (proportional-neighbor or proportional-siblings on keyboard/Alt), not a knob. External edits are not corrected.

## 4. What `intent` does each control surface produce?

- Drag mark resize → `edit` (additive).
- Wheel → `edit` (additive).
- Keyboard → `edit` (additive by default, Alt → proportional-neighbor).
- Drag mark reorder → `reorder` (no value change).
- Cross-tile → `edit` (source-defined).

Value-edit and reorder drags are mutually exclusive on the same bar; the reorder surface is only armed when `canReorder` is on, otherwise the bar body is a drag-resize/drag-edit target.

## 5. What `render` / `transition` effects are attached to each `Editor` event?

Per the Cartesian-discrete family effect contract:

- **`draft` (`edit`):** the edited bar reflects its new value live (length changes on the continuous axis); the **continuous-axis domain scales dynamically to contain the preview** (no overflow). The **discrete axis is fixed** — category slots don't grow or shrink. Sibling bars hold their slot positions; only the edited bar's length and the continuous axis change. No `transition` during the gesture (rule 8). Per-surface: drag-mark and wheel are additive; keyboard is additive (Alt → proportional-neighbor if conservation on).
- **`draft` (`reorder`):** the dragged bar follows the pointer along the discrete axis; siblings slide to their provisional slots with a short reactive tween. No value change; ordering is the only thing that changes. Sibling bar lengths stay proportional to value throughout.
- **`commit` (`edit`):** recompute sort if `sortBy` changed, then `transition` bars to new positions/lengths. The continuous-axis domain settles to fit committed values. Post-commit transition is chart-owned, interruptible, disposable (rule 13); `Editor` is `Idle` at `commit`. No settling state.
- **`commit` (`reorder`):** finalize the new order; fire `onReorder(orderedIds)`. The caller persists the order; the chart `transition`s bars to their committed slots. `Editor` is `Idle`.
- **`cancel`:** `transition` back to the snapshot (bar lengths + slot order + continuous axis).
- **`updated`:** `transition` to the new committed state, with **enter/exit lifecycle on every rendered-set change** (entering bars fade in at target slot/length; exiting bars fade out in place; surviving bars transition). Covers external data change (category add/remove), filter, config toggle (`measure` swap → lengths re-derive and `transition`; `orientation` toggle → the whole chart morphs from vertical to horizontal or vice versa with a `transition`; `sortBy` toggle → slots re-order with a `transition`). While `Drafting`, transitions the committed data underneath the draft overlay.

### Orientation morph

The `orientation` toggle is an `updated` that `transition`s the entire chart: bars rotate 90°, the discrete and continuous axes swap roles, labels reposition. This is a single `transition` covering all marks — the chart owns the morph (interruptible, disposable, rule 13). Visual cohesion (rule 14): labels move with their bars through the morph.

### Overflow

When the number of bars exceeds the viewport, the discrete axis overflows and the chart scrolls (the continuous axis does not overflow — it scales to fit). Scrolling is a viewport op, not an edit. Selections and pre-edits are stable across scroll.

## 6. What does this chart do that the family contract does not cover?

Two things, both covered by extensions to the contract:

1. **Reorder.** The Cartesian-discrete contract doesn't mention reorder; bar adds it (opt-in via `canReorder`). This is a capability addition, not a model gap — `reorder` is already a first-class `intent` in the model (gesture-architecture "Universal input model"). The contract could note it: "Cartesian-discrete charts may support `reorder` along the discrete axis when `sortBy === 'index'`."
2. **Orientation morph.** The `orientation` config toggle is an `updated` that `transition`s the whole chart. The contract says "config toggle → `transition`" which covers it, but the *whole-chart morph* is a bigger transition than a single-axis re-fit. Worth noting in the contract but not a model gap.

No model-level gaps. The family contract + the universal `reorder` intent + the `updated`-on-config-toggle rule cover bar.

## Summary

Bar is the reference for Cartesian-discrete: one continuous axis (value, scalable domain) + one discrete axis (category, fixed slots). Value edits resize the bar and scale the continuous axis; the discrete axis stays fixed. Reorder is opt-in along the discrete axis. Orientation morph (vertical↔horizontal) is a whole-chart `transition`. Conservation is opt-in (governs own edits only). Enter/exit on `updated` rendered-set changes. Overflow scrolls the discrete axis. Gantt is a delta on this with a time axis and start+end handles.
