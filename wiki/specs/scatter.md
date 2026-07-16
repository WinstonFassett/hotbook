# Spec — Scatter

Reference spec for the Cartesian-continuous family. Line and area are deltas on this (see `wiki/specs/line.md`, `wiki/specs/area.md`). The family contract is `wiki/gesture-architecture.md` §"Cartesian-continuous".

Vocabulary: `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. `interaction-principles.md` is the living constraints doc. Design only — no code, no file names, no current implementation.

## 1. What is this chart?

A two-axis point chart. Marks are circles (or other glyphs) positioned by `(x, y)` where both x and y are continuous. The chart renders a fitted domain on each axis (no parent-child partition; no fixed total). It is **editable**: the user can drag a point vertically to change its y-value (the canonical edit), wheel-scale a point, or keyboard-edit the focused point. X is typically the independent variable and is not gesture-edited by default (the chart can opt to allow x-editing).

- **Family:** Cartesian-continuous (two continuous axes).
- **Editable:** yes. Creates an `Editor`, registers with `Kernel.Drafts`.
- **DataView query:** canonical config. `datasetId` names a `flat` `Dataset` (one row per point). Config dimensions: `measure` (y-binding), `xBinding` (x-binding), `sortBy` (optional; rarely used on scatter), `snap` (optional snap-on-edit). A livebound `Table` on the same canonical config shares this `DataView`.

## 2. What `DataView` query does it subscribe?

Canonical config. `datasetId` is one field (naming a `flat` `Dataset`); the others:
- `measure` — y-value binding driving point positions on the y-axis.
- `xBinding` — x-value binding driving point positions on the x-axis.
- `sortBy` — optional; rarely used (scatter has no inherent order). When set, drives the keyboard navigation order.
- `snap` — optional chart snap-on-edit setting (see `UBIQUITOUS_LANGUAGE.md` Snapping).

A livebound `Table` (or line/area chart) on the same canonical config shares this `DataView`; a difference in any field means they do not share.

## 3. Does it create an `Editor`?

Yes. Control surfaces that produce `draft` events. All produce `intent: edit`; each has its own value-mapping:

- **Drag mark — vertical.** Dragging a point vertically changes its y-value. The drag uses the **gesture-start y-scale** to compute deltas (so a domain re-derivation mid-drag doesn't cause a spike — the delta is in original-scale space, not re-inverted each move). **Additive** — only the dragged point's y changes; no sibling redistribution (scatter has no sibling-total invariant). `intent: edit`.
- **Wheel — point.** Cmd/Ctrl+wheel over a point scales its y-value. **Additive** — only the target changes; dynamic step (∝ value, Shift = fine). `intent: edit`.
- **Keyboard — focused point.** Arrow up/down edits y; arrow left/right moves focus between points (navigation, not edit). **Additive** by default; Alt → proportional is N/A on scatter (no sibling total to preserve) — Alt could be a no-op or could opt into a future x-edit mode. First arrow begins a gesture (`dataView.start('edit')`); Esc reverts the sequence; keyup of the last held arrow commits. `intent: edit`.
- **Programmatic — cross-tile.** A livebound `Table` sharing the `DataView` publishes `draft` events when a cell is edited; the scatter renders the draft preview. Source-defined value-mapping. Conservation is N/A (no invariant). `intent: edit`.

**No reorder gesture.** Scatter has no inherent order to reorder; `sortBy` only affects keyboard nav order. No boundary knob (no shared boundary between points).

## 4. What `intent` does each control surface produce?

All `edit`. The scatter has no `reorder` intent. Each surface's value-mapping is carried in the `draft`'s `value`: drag-mark and wheel are additive; keyboard is additive; cross-tile is source-defined. Value-mapping is overridable (see gesture-architecture "Value-mapping is overridable").

## 5. What `render` / `transition` effects are attached to each `Editor` event?

Per the Cartesian-continuous family effect contract:

- **`draft` (`edit`):** the edited point reflects its new y-value live; the **y-axis domain scales dynamically to contain the preview** (interaction-principles "No overflow" — the mark must never render outside the chart bounds). Other points hold their positions (frozen); only the edited point and the y-axis move. The x-axis is unaffected by a y-edit. No `transition` runs during the gesture (rule 8); the axis domain and the point move reactively. Per-surface: drag-mark and wheel are additive (only the point moves; y-domain grows/shrinks); keyboard is additive (same).
- **`commit`:** recompute sort if applicable, then `transition` points to their committed positions. The y-axis domain settles to fit the committed values. Post-commit transition is chart-owned, interruptible, disposable (rule 13); the `Editor` is `Idle` at `commit`. No settling state.
- **`cancel`:** `transition` back to the snapshot (point positions + y-axis domain).
- **`updated`:** `transition` to the new committed state, with **enter/exit lifecycle on every rendered-set change** (entering points fade in at target position; exiting points fade out in place; surviving points transition). Covers external data change (point add/remove), filter, config toggle (`measure`/`xBinding` swap → axes re-bind and `transition`). While `Drafting`, transitions the committed data underneath the draft overlay; the overlay stays until `commit` or `cancel`.

### Drill / zoom / pan

Scatter supports zoom and pan (interaction-principles §"Zoom, pan, and viewport"). Zoom/pan is a **viewport** operation, not a data edit — it changes the visible domain, not the data. It is **not** an `Editor` event (no `draft`/`commit`). Selections and pre-edits are stable across zoom/pan. Zoom/pan is interruptible and reversible but doesn't go through the `Editor` state machine.

## 6. What does this chart do that the family contract does not cover?

Nothing. The Cartesian-continuous contract ("resize the edited mark and scale the matching axis/domain to fit the preview value; keep siblings frozen") describes scatter exactly. The dynamic-axis-domain behavior is the contract's default (interaction-principles rule 9 + "No overflow"). Zoom/pan is a viewport operation, separate from the edit gesture contract — the contract doesn't cover it, but it doesn't need to (it's not an edit). No gaps.

## Summary

Scatter is the reference for Cartesian-continuous: two continuous axes, points positioned by (x, y), y-edit via drag/wheel/keyboard, dynamic y-axis domain scaling during `draft` (no overflow), siblings frozen, `commit`/`cancel`/`updated` are `transition`s with enter/exit on rendered-set changes. No reorder, no boundary knob, no conservation invariant. Zoom/pan is a viewport op, not an edit. Line and area are deltas on this.
