# Spec — Pack (Circle Pack)

Delta spec for the circle pack `Chart`. Pack combines the treemap's `draft` mechanism with the icicle/sunburst's drill geometry, plus one value-mapping difference. This document lists **only the divergences**; for anything not mentioned, read `wiki/specs/icicle.md` and `wiki/specs/treemap.md`. The Hierarchical family contract is `wiki/gesture-architecture.md` §"Hierarchical".

Vocabulary: `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. The old `MdPack` code was read once for behavior and then set aside.

## Divergences from icicle

### §1 Geometry
- **Circle pack.** Marks are **circles**; sibling circles pack inside the parent circle's bounds with fixed-pixel padding, radii ∝ √value. Circles **must stay circular** — a non-uniform scale would make them overlap, so the viewport uses a uniform `min(Wc/spanW, Hc/spanH)` scale (consequence for drill, §5).
- **No `orientation` config dimension** (same as sunburst/treemap).

### §2 DataView query
- Same key shape as sunburst/treemap: `datasetId` + `measure` + `sort` + `depth`. `Dataset.dataShape` is `hierarchical`.
- **Windowing:** focus node's subtree (plus the focus node as a context circle when drilled). Does not retain off-screen ancestors — the affine viewport zoom (§5) handles drill by remapping, and the pack layout is computed once over the full tree (not re-rooted on drill the way treemap re-roots).

### §3 / §4 Control surfaces and intent
- **No boundary knob, no reorder** — same capability shape as treemap. See treemap §3/§4 for the rationale.
- **Drag mark — resize** (WIN-260). Dragging horizontally on a circle (`ew-resize` cursor) scrubs its value. **Additive** — only the dragged circle's value changes. Same as treemap's drag-mark. `intent: edit`.
- **Wheel — circle.** Additive (only the target changes; dynamic step). Same as every chart's wheel.
- **Keyboard — focused circle.** **`proportional-siblings`** (pack's configured default — the delta is redistributed across all siblings, not absorbed by one neighbor; Alt → additive). **This differs from icicle/sunburst/treemap**, whose keyboard uses `proportional-neighbor`. `intent: edit`.
- **Cross-tile.** Source-defined value-mapping. Same as icicle.
- All `edit`; no `reorder` intent on this chart.

### §5 Effects
- **`draft` (`edit`): scale-against-frozen-siblings — same mechanism and invariant as treemap §5.** The edited circle's radius rescales live; sibling circles hold pre-gesture positions/radii (frozen); no relayout *transition* until `commit` (rule 8). The pack layout re-derives reactively as the value writes through, but the chart suppresses sibling repositioning while `Drafting`. Children of the edited circle may be faded or hidden. Per-surface value-mappings: drag-mark and wheel are additive; keyboard is proportional-siblings (the one difference from treemap). See icicle §5 for `commit`/`cancel`/`updated` (identical, including enter/exit on every rendered-set change and no settling).
- **Drill — affine viewport zoom, same as icicle/sunburst (NOT treemap's per-tile tweens).** The viewport is a layout-space bounding box `[vx0, vy0, vx1, vy1]`; on drill it tweens to the union bounding box of the focus node's descendants. A **uniform** `min(Wc/spanW, Hc/spanH)` scale maps layout-space to canvas — required because circles must stay circular. Otherwise the drill model is the same as icicle: an `updated`, rendered as an autonomous `transition`, interruptible/disposable (rule 13), enter/exit lifecycle, no continuous drill, no preview.
- `sort` toggle, `measure` swap, `depth` change are `updated` events rendered as `transition`s — circles slide to new pack positions/radii; enter/exit runs if the rendered set changes.

### §6 Family-contract gaps
**Same one as treemap** — the Hierarchical family `draft` contract was too narrow (described only subtree-patch; pack uses scale-against-frozen-siblings). **Fixed** in `wiki/gesture-architecture.md` §"Hierarchical". No remaining gaps.

## Summary

Pack = treemap's `draft` mechanism (scale-against-frozen-siblings) + icicle/sunburst's drill geometry (affine viewport zoom — circles must stay circular, so uniform scale) + one value-mapping difference (keyboard = `proportional-siblings`, not `proportional-neighbor`). Same capability shape as treemap: no boundary knob, no reorder — drag-mark-resize (additive) + wheel (additive) + keyboard (proportional-siblings) + cross-tile. The family-contract gap it exposed (same as treemap) is fixed in the model.
