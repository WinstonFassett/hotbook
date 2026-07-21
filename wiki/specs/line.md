# Spec — Line

Delta spec for the line `Chart`. Line is in the Cartesian-continuous family with scatter — every model-level claim in `wiki/specs/scatter.md` carries over. This document lists **only the divergences**. The family contract is `wiki/gesture-architecture.md` §"Cartesian-continuous".

## Divergences from scatter

### §1 Geometry
- Marks are **path segments** connecting points in x-order, not isolated glyphs. The line is a single SVG path through all `(x, y)` points sorted by x. Points are still the editable unit (you edit a point's y, not "the line").
- **X-ordering is inherent.** Points are sorted by x for rendering; this is not a `sortBy` config — it's the geometry. Keyboard nav follows x-order.

### §2 DataView query
- Same as scatter. `datasetId` + `measure` (y) + `xBinding` (x) + optional `snap`. `Dataset.dataShape` is `flat`.
- `sortBy` is N/A (x-order is the only order). If present in config it's ignored for rendering; keyboard nav is x-order.

### §3 / §4 Control surfaces and intent
- **Same surfaces, same intents, same value-mappings as scatter §3/§4.** Drag a point vertically (additive, start-scale delta), wheel a point (additive), keyboard up/down (additive). Cross-tile (source-defined). All `edit`; no `reorder`.
- **Bisect hover:** because points are ordered by x, hover uses x-bisect (find the nearest point by x-coordinate) rather than per-point hit-testing. This is a hit-test detail, not a model difference.

### §5 Effects
- **`draft` / `commit` / `cancel` / `updated`:** identical to scatter §5. The edited point moves live; the y-axis domain scales to contain it; the **path re-derives reactively** through the edited point (the segments adjacent to the edited point stretch/contract). Sibling points frozen. Enter/exit on `updated` rendered-set changes: entering points extend the path (fade in); exiting points truncate it (fade out); surviving points transition.
- **Path tween on `commit`/`updated`:** the path is a single element; on `commit` the path `transition`s from the gesture-start shape to the committed shape. This is the same "transition the mark to its new position" as scatter, just over a path instead of a circle. The chart owns the tween (interruptible, disposable, rule 13).
- Zoom/pan: same as scatter (viewport op, not an edit).

### §6 Family-contract gaps
None — same answer as scatter.

## Summary

Line = scatter with a path connecting the points in x-order. Bisect hover instead of per-point hit-test; path re-derives during `draft` and `transition`s on `commit`. Everything else (axes, value-mappings, edit surfaces, enter/exit, zoom/pan) is identical to scatter.
