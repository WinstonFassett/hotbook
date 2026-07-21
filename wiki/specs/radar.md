# Spec — Radar

Delta spec for the radar `Chart`. Radar is in the Radial family but is a distinct sub-pattern: N discrete axes (spokes) arranged radially, with a point on each spoke. Every model-level claim in `wiki/specs/pie.md` carries over where applicable; this document lists **only the divergences**. The family contract is `wiki/gesture-architecture.md` §"Radial".

## Divergences from pie

### §1 Geometry
- **N spokes** (discrete axes) arranged radially from a center point, one per category. A **point** sits on each spoke at a radius proportional to that category's value. The points are connected by a polygon path (the radar shape).
- Marks are **points on spokes** + the **connecting polygon**. The editable unit is a point (one per spoke). The polygon is cosmetic (connects the points).
- **No 360° tiling.** Spokes are discrete axes, not slices of a whole. There is **no inherent conservation** — each spoke's value is independent (unlike pie where slices tile 360°). Editing one point doesn't move others. This is the independent-track sub-pattern (like concentric-arc), not the fixed-total sub-pattern (like pie).
- The radial axis has a **domain** (0 to maxValue) that scales to fit the data, like a continuous axis but radial.

### §2 DataView query
- Same key shape as pie. `datasetId` names a `flat` `Dataset` (one row per spoke/category). Config: `measure` (value binding driving radial position), `snap` (optional). `sortBy` is N/A (spokes are arranged by category, not by value sort; the category order is the caller's data order).

### §3 / §4 Control surfaces and intent
- **Drag point — radial.** Dragging a point along its spoke changes its value (radius). The drag uses the **gesture-start radial scale** to compute deltas (same start-scale-delta pattern as Cartesian-continuous — avoids spike from domain re-derivation). **Additive** — only the dragged point's value changes; no sibling redistribution (no conservation). `intent: edit`.
- **Wheel — point.** Cmd/Ctrl+wheel over a point scales its value. **Additive**; dynamic step. `intent: edit`.
- **Keyboard — focused point.** Tab/arrow keys nav between spokes; up/down edit the focused point's value. **Additive** (no conservation). `intent: edit`.
- **Cross-tile.** Source-defined. `intent: edit`.
- No boundary knob (points don't share boundaries). No reorder (spokes are arranged by category). All `edit`.

### §5 Effects
- **`draft` (`edit`):** the edited point reflects its new value live (moves along its spoke); the **radial domain scales dynamically to contain the preview** (no overflow — same as Cartesian-continuous axis scaling, but radial). The polygon path re-derives reactively through the edited point. Sibling points frozen. No `transition` during the gesture.
- **`commit` / `cancel` / `updated`:** `transition` points to new positions; polygon `transition`s to new shape. Radial domain settles. Enter/exit on rendered-set changes (category add/remove adds/removes a spoke — the polygon gains/loses a vertex with enter/exit). `measure` swap re-derives radial positions and `transition`s.

### §6 Family-contract gaps
**Same as concentric-arc: the Radial contract assumes fixed-total (pie).** Radar is independent-track (no conservation, siblings frozen, radial domain scales). Covered by the same proposed contract amendment (Radial splits into fixed-total and independent-track). One additional note: radar's radial domain scaling is the radial analog of Cartesian-continuous's axis-domain scaling — the "no overflow" rule (interaction-principles) applies radially. Not a new gap; just the same rule in a different geometry.

## Summary

Radar = N discrete spokes arranged radially, points on each spoke, polygon connecting them. Independent-track (no conservation, no 360° tiling). Drag point along spoke (additive, start-scale delta), wheel, keyboard. Radial domain scales to fit (no overflow, radial analog of Cartesian-continuous). Polygon re-derives during `draft`. Covered by the independent-track Radial sub-pattern (same amendment as concentric-arc).
