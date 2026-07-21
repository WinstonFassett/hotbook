# Spec — Treetable

Delta spec for the treetable `Chart`. Treetable is in the Table family with the flat table — every model-level claim in `wiki/specs/table.md` carries over. This document lists **only the divergences**. The family contract is `wiki/gesture-architecture.md` §"Table".

## Divergences from flat table

### §1 Geometry
- **Hierarchical rows.** Rows are nodes in a tree; child rows are indented under their parent. Expand/collapse toggles per parent row control which descendants are visible. The table is a projection of a `hierarchical` `Dataset` (not `flat`).
- No spatial marks — still a table (rows of cells). The hierarchy is in the row structure, not in the geometry.

### §2 DataView query
- `datasetId` names a `hierarchical` `Dataset` (same dataShape as icicle/sunburst/treemap/pack). Config: column set, `snap` (optional), `depth` (max visible levels — same `depth` config dimension as the hierarchical charts, controlling how many levels are expanded by default).
- A livebound icicle/sunburst/treemap/pack on the same canonical config shares this `DataView`. The treetable and the icicle are two projections of the same hierarchical data — editing a cell in the treetable publishes a `draft` that the icicle renders, and vice versa.

### §3 / §4 Control surfaces and intent
- **Same as flat table §3/§4.** Cell edit (type = absolute-set), number-drag (additive), cross-tile (source-defined). All `edit`; no `reorder`.
- **Expand/collapse** is a config change (toggles `depth` or per-node expansion state), rendered as an `updated` — rows enter/exit with a `transition`. Not a gesture edit.

### §5 Effects
- **`draft` / `commit` / `cancel`:** same as flat table. The edited cell updates reactively; the `draft` publishes to linked hierarchical charts. No spatial `transition` on the table itself.
- **`updated`:** reflect external changes. Enter/exit on row add/remove (a node added/removed in the hierarchy → a row enters/exits with a `transition`). Expand/collapse is an `updated` → rows enter/exit. `depth` change is an `updated` → rows enter/exit to the new depth. A linked icicle drilling is an `updated` that the treetable can reflect (focus node changes → the treetable could collapse to the focus subtree, if configured to follow drill — chart-specific option).

### §6 Family-contract gaps
None beyond the flat table's gaps (absolute-set, no spatial `transition`). The treetable adds hierarchical rows, but the model already handles hierarchical data (same `Dataset.dataShape` as the Hierarchical family) and the Table family contract already handles enter/exit on rendered-set changes. No new gaps.

## Instance hygiene

Treetable is rendered as HTML table rows, not SVG, so there are no `id`/`clipPath` collision concerns. However, if the implementation uses any CSS `id` selectors or ARIA `id` references (e.g. `aria-describedby`), those must incorporate an instance identifier. In practice, treetable row rendering uses class selectors and data attributes, so this is a non-issue — but the principle holds: no bare document-scoped identifiers.

## Summary

Treetable = flat table + hierarchical rows (indent, expand/collapse). Same edit surfaces (absolute-set type, additive number-drag), same cross-tile `draft` publishing, same no-spatial-`transition`-on-`commit`. `datasetId` names a `hierarchical` `Dataset` (shares `DataView` with icicle/sunburst/treemap/pack on the same config). Expand/collapse and `depth` changes are `updated` events with row enter/exit. No new model gaps.
