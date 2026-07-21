# Spec — Table (flat)

Reference spec for the Table family. Treetable is a delta on this (see `wiki/specs/treetable.md`). The family contract is `wiki/gesture-architecture.md` §"Table".

Vocabulary: `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. `interaction-principles.md` is the living constraints doc. Design only — no code, no file names, no current implementation.

## 1. What is this chart?

A flat table: rows of data, columns of fields, editable cells. The table is a `Chart` family — it's a **projection** of the same `Dataset` that other charts project. It can be livebound alongside any other chart by sharing the same `DataView` (same canonical config). When a cell is edited, the `draft` publishes through the `DataView` and linked charts render the preview. When an external chart edits a value, the table cell reflects it.

- **Family:** Table.
- **Editable:** yes. Creates an `Editor`, registers with `Kernel.Drafts`.
- **Conservation:** N/A. The table does not enforce any conservation invariant. It's a flat projection — it shows values as-is. If a linked chart has conservation (e.g. an icicle with conservation on), the table's edit can violate it; the linked chart renders it anyway (per the conservation model — external edits are not corrected). If you want conservation, edit through the chart that enforces it.
- **DataView query:** canonical config. `datasetId` names a `flat` `Dataset`. Config dimensions: the column set (which fields are visible/editable), `snap` (optional snap-on-edit for the table's own cell edits). No `sortBy` in the gesture sense — table sorting is a column-header click, which is an `updated` (config change), not a gesture.

## 2. What `DataView` query does it subscribe?

Canonical config. `datasetId` is one field (naming a `flat` `Dataset`); the others are the column configuration (visible columns, editable columns, column order). A chart on the same canonical config shares this `DataView`; a difference in any field means they do not share.

## 3. Does it create an `Editor`?

Yes. Control surfaces that produce `draft` events:

- **Cell edit — type.** Clicking a cell and typing a new value. **Absolute-set** — the value is set to exactly what was typed (not additive, not proportional). This is the table's primary edit surface and its distinct value-mapping: the user specifies the exact target value, not a delta. `intent: edit`.
- **Cell edit — number-drag.** Dragging horizontally on a numeric cell scrubs its value (same number-drag primitive as treemap/pack/gauge). **Additive** — the value changes by the drag delta. `intent: edit`.
- **Programmatic — cross-tile.** A linked chart publishes `draft` events; the table cell reflects the draft preview. Source-defined value-mapping. `intent: edit`.

**No reorder gesture** on a flat table (row reordering is via column-sort, which is an `updated`). No boundary knob. No wheel (wheel scrolls the table, not edits cells — table cells are not spatial marks).

## 4. What `intent` does each control surface produce?

All `edit`. The table has no `reorder` intent. Value-mappings: type = absolute-set; number-drag = additive; cross-tile = source-defined. Value-mapping is overridable.

## 5. What `render` / `transition` effects are attached to each `Editor` event?

Per the Table family effect contract:

- **`draft` (`edit`):** the edited cell reflects its new value live. No spatial `transition` (a cell is a text value, not a moving mark) — the cell text updates reactively. The `draft` publishes through the `DataView` so linked charts render their preview (e.g. an icicle scales the edited node, siblings frozen). No `transition` during the gesture.
- **`commit`:** finalize the value through the `DataView`. The `Editor` returns to `Idle`; linked charts run their `transition` effect (e.g. the icicle `transition`s to the committed layout). The table cell shows the committed value (no transition — it's already there from the `draft`).
- **`cancel`:** revert the cell to its pre-edit value. Linked charts revert their draft overlay.
- **`updated`:** reflect external changes. If a linked chart edited a value, the table cell updates to the new value. If the data changes externally (row add/remove), the table re-renders with **enter/exit** (new rows fade in; removed rows fade out). Column-sort toggle re-orders rows with a `transition`. While `Drafting`, external changes to the *same cell being edited* don't clobber the draft (the draft overlay stays until `commit` or `cancel`); external changes to *other cells* update underneath.

## 6. What does this chart do that the family contract does not cover?

**One: absolute-set value-mapping.** The Table family contract doesn't mention value-mappings. The table's primary edit (typing a value) is **absolute-set** — set the value to exactly X, not add X or scale by X. This is a distinct value-mapping not found in the spatial charts (where edits are always delta-based: additive or proportional). The contract should note it: "Table cell edits are absolute-set (the value is set to the typed value, not a delta); number-drag on a cell is additive." Not a model gap — the universal input model carries the value in the `draft`'s `value`, and absolute-set is just "the value is the target, not a delta."

**Two: no spatial `transition` on `draft`/`commit`.** The table's `draft` and `commit` don't `transition` the cell (it's text, not a moving mark). The `transition` happens on the *linked charts*, not the table. The contract says "the `Editor` returns to `Idle`; linked `Chart`s run their `transition` effect" — that's correct. But the table's own `commit` has no `transition`, which is a difference from every other family (where `commit` `transition`s the mark). Worth noting: the table is the one family where `commit` is a data event, not a visual transition.

## Summary

Table (flat) is the reference for the Table family: a projection of the `Dataset`, editable cells, `draft` publishes through the `DataView` to linked charts. Primary edit is **absolute-set** (type a value) — distinct from the delta-based value-mappings of spatial charts. Number-drag on a cell is additive. No conservation, no reorder, no spatial `transition` on `commit` (the `transition` happens on linked charts). Cross-tile is the whole point — the table is the projection that makes the conservation question matter. Treetable is a delta on this with hierarchical rows.
