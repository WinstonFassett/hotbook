# Spec — Treemap

Delta spec for the treemap `Chart`. The treemap is in the Hierarchical family but uses a **different `draft` mechanism** from the icicle/sunburst branch and a **different drill geometry**. This document lists **only the divergences**; for anything not mentioned, read `wiki/specs/icicle.md`. The Hierarchical family contract is `wiki/gesture-architecture.md` §"Hierarchical".

Vocabulary: `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. The old `MdTreemapLC` code was read once for behavior and then set aside. The d3-hierarchy `treemapSquarify` layout is used — we do not originate the squarify algorithm.

## Divergences from icicle

### §1 Geometry
- **Squarify** treemap, rectilinear. Uses `d3.treemap()` with `d3.treemapSquarify`. Marks are **rectangles** tiling the parent's box edge-to-edge with fixed-pixel padding. Sibling spans are proportional to value, but squarify chooses the split orientation that keeps aspect ratios near 1 — sibling positions are **not** a simple proportional partition the way icicle/sunburst are.
- **Nested multi-level.** All descendants of the focus node (within `depth` config) are rendered as nested rectangles — groups contain their children inside them, recursively. The `depth` config caps how many levels are visible, same as icicle.
- **Root is the invisible container.** The root node (or the drill focus when drilled) is NOT rendered as a tile — it is the canvas. Its children and their descendants tile the space. This is fundamental to treemap geometry, not a config option.
- **Group headers:** interior (non-leaf) nodes carry a fixed-pixel header label pinned to the top of their rectangle (`d3.treemap().paddingTop()`). Presentation detail, but it drives the drill geometry (§5).
- **No `orientation` config dimension** (same as sunburst).

### §2 DataView query
- Same key shape as sunburst: `datasetId` + `measure` + `sort` + `depth`. `Dataset.dataShape` is `hierarchical`.
- **Rendered set:** all descendants of the focus node (within `depth`), excluding the focus node itself. When not drilled, focus = root, so the rendered set is root's descendants. When drilled into node N, focus = N, rendered set = N's descendants.
- **Drill-out navigation:** the breadcrumb (from the base class) shows the path from root to the current focus. Clicking a breadcrumb segment drills out to that ancestor. This is how the user navigates back up — the root is not a tile, so there is no root tile to click.
- **Does not retain off-screen ancestors** — squarify re-layouts from the focus node at full canvas size on drill (§5), so ancestor geometry isn't needed for the drill transition. (Same windowing rationale as sunburst, different reason: treemap re-roots the layout instead of retaining ancestor geometry for a transition.)

### §3 / §4 Control surfaces and intent
- **No boundary knob.** The treemap has no inter-sibling boundary handle — squarify positions are derived, not caller-partitioned.
- **Reorder gesture — yes** (remediated 2026-07 during the WIN-350 port; this spec previously said "no reorder" on the claim that caller order has no observable effect — that claim was wrong for `sort === 'index'`, where the caller order feeds the squarify traversal and reordering visibly rearranges tiles). When `canReorder` and `sort === 'index'`, dragging a tile reorders it among its siblings, same intent/mechanics as icicle `reorderDrag`. `intent: reorder`.
- **Drag mark — resize** (WIN-260 "drag-to-resize"). Dragging horizontally on a leaf tile (`ew-resize` cursor) scrubs its value (right = +, left = −; Shift = coarse, Alt = fine). **Additive** — only the dragged tile's value changes; no sibling redistribution. This is the treemap's primary edit surface. `intent: edit`.
- **Wheel — tile.** Additive (only the target changes; dynamic step). Same as icicle's wheel.
- **Keyboard — focused tile.** Additive by default; Alt → `proportional-neighbor` (treemap's configured scaling). Same as icicle's keyboard.
- **Cross-tile.** Source-defined value-mapping. Conservation not enforced on external edits — same as icicle §3.
- Drag-mark-resize and reorder are mutually exclusive on the tile body (same rule as icicle): reorder when `canReorder && sort === 'index'`, resize otherwise.

### §5 Effects
- **`draft` (`edit`): scale-against-frozen-siblings, NOT subtree-patch.** This is the treemap's headline divergence. The edited tile reflects its new value live; sibling tiles hold their pre-gesture positions (frozen); no relayout *transition* runs until `commit` (rule 8). **Mechanism:** the squarify layout re-derives reactively as the value writes through, but the chart suppresses sibling repositioning while `Drafting` — only the edited mark moves. Children of the edited tile may be faded or hidden (chart-specific option, interaction-principles §"Hierarchical marks"). The observable invariant matches the icicle (edited mark moves, siblings frozen, relayout deferred) — the *mechanism* differs. Per-surface value-mappings: drag-mark and wheel are additive; keyboard is additive by default, Alt → proportional-neighbor. See icicle §5 for `commit`/`cancel`/`updated` (identical, including enter/exit on every rendered-set change and no settling).
- **Drill — relayout (re-root + per-tile transitions).** Fixed-pixel group headers cannot be expressed inside a single affine scale — deep drill would multiply every nested header by the zoom factor, ballooning them. So the treemap re-roots the layout at the focus node at full canvas size (`treemap().size([W, H])` rooted at the focus node) and **transitions each live tile's screen-space `{x,y,w,h}`** to its new target in the re-rooted layout. Group headers stay fixed-pixel (pinned labels, not scaled geometry). Same drill approach as icicle (relayout, not affine viewport): an `updated`, rendered as an autonomous `transition`, interruptible/disposable (rule 13), enter/exit lifecycle on the rendered set, no continuous drill, no preview.
- `sort` toggle, `measure` swap, `depth` change are `updated` events rendered as `transition`s — tiles slide to new squarify positions/areas; enter/exit runs if the rendered set changes.

### §6 Family-contract gaps
**One — the Hierarchical family `draft` contract was too narrow.** The family contract line (before the fix) read "scale the edited node inside the saved parent bounds; freeze sibling ordering; do not recompute the full layout" — that described only the icicle/sunburst subtree-patch. Treemap (and pack) use scale-against-frozen-siblings: the layout *is* recomputed on every value write, but sibling repositioning is *not applied* while `Drafting`. "Do not recompute the full layout" conflated computation with application; "freeze sibling ordering" was the wrong freeze (no reorder; positions freeze). **Fixed** in `wiki/gesture-architecture.md` §"Hierarchical": the contract now states the observable invariant (edited mark moves live; sibling positions frozen; relayout transition deferred to `commit`) and names both mechanism variants. No remaining gaps.

## Instance hygiene

Same requirement as icicle §8: every `id`, `clipPath` id, `<pattern>` id, and `xlink:href` / `url(#...)` reference must incorporate the chart's `instanceUid`. Tile clip paths, group-header backgrounds, and any `<defs>` elements must be instance-scoped. See icicle §8 for the pattern and verification steps.

## Summary

Treemap diverges from icicle on one axis, family-geometry: `draft` uses scale-against-frozen-siblings (layout recomputes internally, sibling repositioning suppressed until `commit`) vs icicle's subtree-patch. Drill is the same relayout approach in both (re-root at focus, transition tiles to new rects). The root is the invisible container (not a tile) — drill-out navigation is via breadcrumb. Uses `d3.treemapSquarify` — we do not originate the layout algorithm. Plus capability: no boundary knob, drag-mark-resize (additive) + wheel (additive) + keyboard (additive, Alt → proportional-neighbor) + cross-tile.
