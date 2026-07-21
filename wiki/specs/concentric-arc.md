# Spec — Concentric Arc

Delta spec for the concentric-arc `Chart`. Concentric-arc is in the Radial family with pie — every model-level claim in `wiki/specs/pie.md` carries over. This document lists **only the divergences**. The family contract is `wiki/gesture-architecture.md` §"Radial".

## Divergences from pie

### §1 Geometry
- **Multiple rings**, not one. Each ring is a full-360° track (the full circle) with a **value arc on top** showing the metric's value as a fraction of 360°. Rings are concentric (different radii); each ring is one metric.
- Marks are **arcs on a track**, not slices of a whole. A ring's value arc spans `value/ maxValue × 360°` of its track; the rest of the track is empty (not a sibling slice). There is **no sibling relationship between rings** — each ring is independent.
- **No inherent conservation.** Unlike pie (where slices tile 360° and sum is fixed), each ring's arc is an independent value against its own max. Editing one ring does not affect others. Conservation is **not inherent** here (unlike pie); it's N/A.

### §2 DataView query
- Same key shape as pie. `datasetId` names a `flat` `Dataset` (one row per ring/metric). Config: `measure` (value binding), `snap` (optional). `sortBy` is N/A (rings are arranged by radius, not by sort).
- Each ring has its own `maxValue` (the arc fills `value/maxValue` of the track). This is part of the data, not the config.

### §3 / §4 Control surfaces and intent
- **No boundary knob.** Rings don't share boundaries (they're on different radii); there's no inter-ring boundary to drag. The pie's primary edit surface doesn't apply.
- **Drag arc endpoint.** Dragging the endpoint of a ring's value arc scrubs its value (the endpoint moves along the circle). **Additive** — only the dragged ring's value changes. This is the concentric-arc's primary edit surface. `intent: edit`.
- **Wheel — ring.** Cmd/Ctrl+wheel over a ring scales its value. **Additive**; dynamic step. `intent: edit`.
- **Keyboard — focused ring.** Tab/arrow keys nav between rings; up/down edit the focused ring's value. **Additive** by default; Alt → proportional (N/A — no sibling total; Alt could be a no-op). `intent: edit`.
- **Cross-tile.** Source-defined value-mapping. `intent: edit`.
- No reorder. All `edit`.

### §5 Effects
- **`draft` (`edit`):** the edited ring's arc reflects its new value live (endpoint moves, arc grows/shrinks). Sibling rings are **frozen** (independent — no conservation, no shared coordinate). The **floor** (minimum value so the arc doesn't collapse to a near-zero sliver) applies to all edit surfaces — a chart-specific constraint, not a model-level one. No `transition` during the gesture.
- **`commit` / `cancel` / `updated`:** same as pie §5, with enter/exit on rendered-set changes (ring add/remove). `measure` swap re-derives arc lengths and `transition`s.

### §6 Family-contract gaps
**One: the Radial contract assumes a fixed-total coordinate (pie's 360° tiling).** Concentric-arc has **no fixed total** — each ring is independent. The contract line "rebalance the edited arc and its siblings; the total is fixed" doesn't apply. Proposed contract amendment: split Radial into two sub-patterns: (1) **fixed-total** (pie, donut — siblings tile a shared 360°, conservation inherent) and (2) **independent-track** (concentric-arc, gauge — each arc is an independent value, no sibling relationship, no conservation). The `draft` contracts differ: fixed-total rebalances siblings; independent-track freezes siblings and moves only the edited arc.

## Summary

Concentric-arc = pie's geometry (arcs on a circle) but **independent rings, not slices of a whole**. No boundary knob (rings don't share boundaries); drag the arc endpoint to edit. No inherent conservation. Siblings frozen during `draft` (independent). Floor on arc value so it doesn't collapse. One contract amendment: Radial splits into fixed-total (pie) and independent-track (concentric-arc, gauge).
