# Spec — Pack (Circle Pack)

Delta spec for the circle pack `Chart`. Pack combines the treemap's `draft` mechanism with the icicle/sunburst's drill geometry, plus one value-mapping difference. This document lists **only the divergences**; for anything not mentioned, read `wiki/specs/icicle.md` and `wiki/specs/treemap.md`. The Hierarchical family contract is `wiki/gesture-architecture.md` §"Hierarchical".

Vocabulary: `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. The old `MdPack` code was read once for behavior and then set aside.

## Divergences from icicle

### §1 Geometry
- **Circle pack.** Marks are **circles**; sibling circles pack inside the parent circle's bounds with fixed-pixel padding, radii ∝ √value. Circles **must stay circular** — a non-uniform scale would make them overlap, so the viewport uses a uniform `min(Wc/spanW, Hc/spanH)` scale (consequence for drill, §5).
- **No `orientation` config dimension** (same as sunburst/treemap).

### §2 DataView query
- Same key shape as sunburst/treemap: `datasetId` + `measure` + `sort` + `depth`. `Dataset.dataShape` is `hierarchical`.
- **Windowing:** focus node's subtree (plus the focus node as a context circle when drilled). Does not retain off-screen ancestors — drill is a **relayout** (re-run pack on the focused subtree, sized to the full canvas), not a viewport zoom. The pack layout is computed over the focus subtree on every drill.

### §3 / §4 Control surfaces and intent
- **No boundary knob, no reorder** — same capability shape as treemap. See treemap §3/§4 for the rationale.
- **Drag mark — resize** (WIN-260). Dragging horizontally on a circle (`ew-resize` cursor) scrubs its value. **Additive** — only the dragged circle's value changes. Same as treemap's drag-mark. `intent: edit`.
- **Wheel — circle.** Additive (only the target changes; dynamic step). Same as every chart's wheel.
- **Keyboard — focused circle.** **Additive** by default; **Alt → `proportional-siblings`** (pack's configured scaling — the delta is redistributed across all siblings, not absorbed by one neighbor). The Alt behavior differs from icicle/sunburst/treemap, whose Alt → `proportional-neighbor`; the default (additive) is the same across all four. `intent: edit`.
- **Cross-tile.** Source-defined value-mapping. Conservation not enforced on external edits — same as icicle §3.
- All `edit`; no `reorder` intent on this chart.

### §5 Effects
- **`draft` (`edit`): scale-against-frozen-siblings — same mechanism and invariant as treemap §5.** The edited circle's radius rescales live; sibling circles hold pre-gesture positions/radii (frozen); no relayout *transition* until `commit` (rule 8). The pack layout re-derives reactively as the value writes through, but the chart suppresses sibling repositioning while `Drafting`. Children of the edited circle may be faded or hidden. Per-surface value-mappings: drag-mark and wheel are additive; keyboard is additive by default, Alt → proportional-siblings (the one difference from treemap, whose Alt → proportional-neighbor). See icicle §5 for `commit`/`cancel`/`updated` (identical, including enter/exit on every rendered-set change and no settling).
- **Drill — relayout (same as icicle/treemap, not a viewport zoom).** On drill, the pack layout is re-computed over the focus node's subtree, sized to the full canvas. Circles snap to new positions (no CSS transition on cx/cy/r — pack positions change on every layout re-derivation, and CSS transitions would chase the layout derive). The drill model follows the family contract: an `updated`, rendered as an autonomous `transition`, interruptible/disposable (rule 13), enter/exit lifecycle (governed by `exitFade` config, §7), no continuous drill, no preview.
- `sort` toggle, `measure` swap, `depth` change are `updated` events rendered as `transition`s — circles snap to new pack positions/radii; enter/exit runs if the rendered set changes.

### §6 Family-contract gaps
**Same one as treemap** — the Hierarchical family `draft` contract was too narrow (described only subtree-patch; pack uses scale-against-frozen-siblings). **Fixed** in `wiki/gesture-architecture.md` §"Hierarchical". No remaining gaps.

### §7 Configurable exit fade
Pack defaults to `exitFade: false` — exiting circles are evicted immediately (no exit fade). This matches the icicle/treemap drill behavior: content moves off-screen, no fade needed. Set `exitFade: true` on the chart config to enable lingering exit fades (same as sunburst's default). See `wiki/specs/enter-exit.md` for the full `exitFade` contract.

## Summary

Pack = treemap's `draft` mechanism (scale-against-frozen-siblings) + its own drill geometry (relayout — re-run pack on the focused subtree, same as icicle/treemap) + one value-mapping difference (keyboard Alt → proportional-siblings, vs proportional-neighbor in the other three; default additive across all four). Same capability shape as treemap: no boundary knob, no reorder — drag-mark-resize (additive) + wheel (additive) + keyboard (additive, Alt → proportional-siblings) + cross-tile. The family-contract gap it exposed (same as treemap) is fixed in the model. Exit fade is configurable via `exitFade` (default false).
