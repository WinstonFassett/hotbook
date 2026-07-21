# Spec — Pie / Donut

Reference spec for the Radial family. Concentric-arc, gauge, gauge-segmented, and radar are deltas on this (see their specs). The family contract is `wiki/gesture-architecture.md` §"Radial".

Vocabulary: `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. `interaction-principles.md` is the living constraints doc. Design only — no code, no file names, no current implementation.

## 1. What is this chart?

A pie chart. Marks are **arcs** (slices) of a circle, each sized proportional to its value, tiling the full 360°. The donut variant has an empty center (inner radius > 0); the pie variant has inner radius = 0. The total is **fixed at 360°** — editing one slice's value inherently changes the others (the coordinate is a fixed total, so previewing a change inherently moves siblings, per interaction-principles §"Cartesian marks"). This is conservation by geometry, not by opt-in.

- **Family:** Radial.
- **Editable:** yes. Creates an `Editor`, registers with `Kernel.Drafts`.
- **Conservation:** inherent (360° total). Not opt-in — the geometry enforces it. All gesture edits preserve `sum(slices) = 360°` (equivalently, `sum(values) = total`).
- **DataView query:** canonical config. `datasetId` names a `flat` `Dataset` (one row per slice). Config dimensions: `measure` (value binding), `sortBy` (`index` or `value`), `snap` (optional). No `orientation` (radial has no orientation to toggle).

## 2. What `DataView` query does it subscribe?

Canonical config. `datasetId` is one field (naming a `flat` `Dataset`); the others:
- `measure` — value binding driving slice angular spans.
- `sortBy` — `index` (caller order) or `value` (drives slice ordering around the circle).
- `snap` — optional chart snap-on-edit setting.

A livebound `Table` on the same canonical config shares this `DataView`.

## 3. Does it create an `Editor`?

Yes. Control surfaces that produce `draft` events. All produce `intent: edit`; each has its own value-mapping:

- **Drag handle — boundary knob.** For each pair of adjacent slices, a draggable knob sits on their shared angular boundary. Dragging **reapportions the two siblings' values with their sum preserved** (two-sibling reapportion — same as icicle/sunburst boundary knob). This is the pie's primary edit surface. `intent: edit`.
- **Wheel — slice.** Cmd/Ctrl+wheel over a slice scales its value. **Additive** — only the target slice's value changes; the *visual* angular span of other slices adjusts because the total is fixed at 360° (the partition normalizes). The underlying data: target value changes, total changes, siblings' values are unchanged but their *angular share* shifts. (This is the additive-on-a-conserved-coordinate case — the data isn't conserved, the visual is.) `intent: edit`.
- **Keyboard — focused slice.** Arrow keys edit the focused slice's value. **Additive** by default; Alt → proportional-neighbor (the adjacent slice absorbs the delta, total preserved in the data). First arrow begins a gesture; Esc reverts; keyup commits. `intent: edit`.
- **Programmatic — cross-tile.** A livebound `Table` sharing the `DataView` publishes `draft` events; the pie renders the draft preview. Source-defined value-mapping. `intent: edit`.

**No reorder gesture.** Pie slices have no inherent linear order to reorder; `sortBy` only affects the rendering order around the circle (a sort toggle is an `updated`, not a gesture).

## 4. What `intent` does each control surface produce?

All `edit`. The pie has no `reorder` intent. Value-mappings: boundary knob = two-sibling reapportion (sum preserved); wheel = additive (visual conserved by partition, data not); keyboard = additive by default, Alt → proportional-neighbor; cross-tile = source-defined. Value-mapping is overridable.

## 5. What `render` / `transition` effects are attached to each `Editor` event?

Per the Radial family effect contract:

- **`draft` (`edit`):** the edited slice reflects its new value live; sibling slices' **angular positions adjust** because the total is fixed at 360° (the partition normalizes — this is inherent to the geometry, not a sibling-freeze violation). No `transition` during the gesture (rule 8); slices move reactively. Per-surface: boundary knob reapportions two siblings in place; wheel scales the target (siblings' angular share shifts); keyboard scales the target (additive) or redistributes to a neighbor (Alt).
- **`commit`:** recompute sort, then `transition` slices to their new angular positions. Post-commit transition is chart-owned, interruptible, disposable (rule 13); `Editor` is `Idle` at `commit`. No settling state.
- **`cancel`:** `transition` back to the snapshot (slice angular positions).
- **`updated`:** `transition` to the new committed state, with **enter/exit lifecycle on every rendered-set change** (entering slices fade in at target angular span; exiting slices fade out in place; surviving slices transition). Covers external data change (slice add/remove), filter, config toggle (`measure` swap → angular spans re-derive and `transition`; `sortBy` toggle → slices re-order around the circle with a `transition`). While `Drafting`, transitions the committed data underneath the draft overlay.

## 6. What does this chart do that the family contract does not cover?

One thing: the Radial contract says "rebalance the edited arc and its siblings; the total is fixed." That's correct for pie. But the contract doesn't distinguish **inherent conservation** (pie: 360° is geometric, not opt-in) from **opt-in conservation** (bar with conservation on). The pie's conservation is not a policy choice — it's the coordinate system. Worth noting in the contract: "Radial charts with a fixed-total coordinate (pie, donut) have inherent conservation; it's not the opt-in `Conservation` setting from `UBIQUITOUS_LANGUAGE.md`." Not a model gap — the behavior is the same (sum preserved); the *reason* differs (geometry vs policy).

## Summary

Pie/donut is the reference for Radial: arcs tiling 360°, inherent conservation (geometric, not opt-in), boundary knob (two-sibling reapportion) as the primary edit surface, wheel (additive, visual conserved by partition), keyboard (additive, Alt → proportional-neighbor). No reorder. `commit`/`cancel`/`updated` are `transition`s with enter/exit. Concentric-arc, gauge, gauge-segmented, and radar are deltas on this.
