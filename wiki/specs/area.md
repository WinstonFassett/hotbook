# Spec — Area

Delta spec for the area `Chart`. Area is in the Cartesian-continuous family with scatter — every model-level claim in `wiki/specs/scatter.md` carries over. This document lists **only the divergences**. The family contract is `wiki/gesture-architecture.md` §"Cartesian-continuous".

## Divergences from scatter

### §1 Geometry
- Marks are a **filled area** between a path (connecting points in x-order) and a baseline (typically y=0 or the x-axis). The area is a single SVG path; points are still the editable unit.
- X-ordering is inherent (same as line).

### §2 DataView query
- Same as scatter/line. `datasetId` + `measure` (y) + `xBinding` (x) + optional `snap`. `Dataset.dataShape` is `flat`.

### §3 / §4 Control surfaces and intent
- **Same as scatter §3/§4.** Drag a point vertically (additive), wheel (additive), keyboard (additive), cross-tile (source-defined). All `edit`; no `reorder`. Bisect hover (same as line).

### §5 Effects
- **`draft` / `commit` / `cancel` / `updated`:** identical to scatter §5 / line §5. The edited point moves live; the y-axis domain scales to contain it; the **area path re-derives reactively** through the edited point. Sibling points frozen. Enter/exit on `updated`: entering points extend the area; exiting points truncate it; surviving points transition.
- The area fill is cosmetic — it follows the path; no separate `draft`/`commit` behavior for the fill vs the path.
- Zoom/pan: same as scatter (viewport op, not an edit).

### §6 Family-contract gaps
None — same answer as scatter.

## Summary

Area = line + a filled baseline. Same edit surfaces, same value-mappings, same axis-domain behavior, same enter/exit. The fill follows the path; no separate gesture behavior for the fill.
