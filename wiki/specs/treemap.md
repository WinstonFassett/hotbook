# Spec — Treemap

Spec for the treemap `Chart`. The treemap is in the Hierarchical family alongside the icicle, but it uses a **different `draft` geometry** from the icicle/sunburst branch: it scales the edited mark against a frozen sibling layout (interaction-principles §"Hierarchical marks", second bullet), rather than recomputing the affected subtree inside saved parent bounds. This spec calls out where the treemap diverges from `wiki/specs/icicle.md`; everything not mentioned is identical to the icicle's model-level claims (same `Editor`, same `commit`/`cancel`/`updated` transition semantics, same drill-as-`updated`, same chart-owned post-commit transition).

Vocabulary: `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. The old `MdTreemapLC` code was read once for behavior and then set aside.

## 1. What kind of `Chart` is this?

- **Family:** `Hierarchical`.
- **Geometry:** rectilinear **squarify** treemap. Each node is a rectangle; rectangles tile the parent's box edge-to-edge with fixed-pixel padding. Sibling spans are proportional to value, but the squarify algorithm chooses the split orientation that keeps aspect ratios close to 1 — sibling positions are **not** a simple proportional partition the way icicle/sunburst are.
- **Group headers:** interior (non-leaf) nodes carry a fixed-pixel header label pinned to the top of their rectangle. This is a presentation detail, not a model concept — but it has a geometry consequence for drill (§5).
- **No orientation** config dimension (same as sunburst).
- **Editable:** yes. Creates an `Editor`, registers with `Kernel.Drafts`.
- **Multi-level:** yes — nested rectangles show multiple depth levels simultaneously (rule 17). `depth` caps how many levels below the focus node are visible.

## 2. What `DataView` query does it subscribe?

Same key shape as sunburst — `(datasetId, canonical config)`, no `orientation`. The `Dataset`'s `dataShape` is `hierarchical`; a livebound `Table` or any other hierarchical chart on the same key shares this `DataView`.

- `measure` — value binding driving rectangle areas.
- `sort` — `index` or `value`; drives sibling ordering within every parent.
- `depth` — maximum number of levels rendered below the focus node.

Windowing: like sunburst, the treemap's window is the focus node's subtree (plus the focus node itself as a context header when drilled). It does not retain off-screen ancestors in the rendered set — squarify re-layouts from the focus node at full canvas size on drill (see §5), so ancestor geometry isn't needed for the drill transition.

## 3. Does it create an `Editor`?

Yes. Control surfaces that produce `draft` events. All produce `intent: edit`; each has its own value-mapping:

- **Drag mark — number scrub.** Dragging horizontally on a tile scrubs its value (right = +, left = −; Shift = coarse, Alt = fine). **Additive** — only the dragged tile's value changes; no sibling redistribution. This is the treemap's primary edit surface — there are **no boundary knobs**. `intent: edit`.
- **Wheel — tile.** Cmd/Ctrl+wheel over a tile scales its value. **Additive** — only the target changes; dynamic step (∝ value, Shift = fine). `intent: edit`.
- **Keyboard — focused tile.** Arrow / numeric entry on the focused tile edits its value. **Proportional-neighbor** (the chart's configured default; Alt → additive). `intent: edit`.
- **Programmatic — cross-tile.** A livebound `Table` sharing the `DataView` publishes `draft` events; the treemap renders the draft preview. Source-defined value-mapping. `intent: edit`.

**No reorder gesture, no boundary knobs.** The treemap does not expose drag-to-reorder — squarify positions are derived from value, not from caller order, so reordering caller-supplied order would have no observable effect (when `sort === 'index'` the order feeds the squarify traversal, but the chart doesn't surface a reorder control). This is a capability difference from the icicle, not a model difference.

## 4. What `intent` does each control surface produce?

All control surfaces produce `edit`, each with its own value-mapping (drag-mark = additive, wheel = additive, keyboard = proportional-neighbor, cross-tile = source-defined). The treemap has no `reorder` intent.

## 5. What `render` / `transition` effects are attached to each `Editor` event?

Per the Hierarchical family effect contract — with the treemap's `draft` geometry (scale-against-frozen-siblings, not subtree-patch):

- **`draft` (`edit`):** the edited tile reflects its new value live; sibling tiles **hold their pre-gesture positions** (frozen); no relayout *transition* runs during the gesture (rule 8). Per-surface, using the value-mappings from §3: drag-mark and wheel are additive (only the edited tile's area scales; siblings frozen; parent total grows/shrinks); keyboard is proportional-neighbor (the edited tile scales, the immediate neighbor absorbs the delta, parent total preserved). The mechanism: the squarify layout re-derives reactively as the value writes through, but the chart suppresses sibling repositioning while `Drafting` (siblings stay at their gesture-start positions; only the edited mark moves). Children of the edited tile may be faded or hidden — a chart-specific option (interaction-principles §"Hierarchical marks"). This is the **scale-against-frozen-siblings** strategy, distinct from the icicle/sunburst **subtree-patch** strategy; the observable invariant is the same — edited mark moves, siblings don't, relayout deferred to `commit`.
- **`commit`:** recompute the full squarify layout with the committed values, then `transition` all tiles to their new positions/areas. Post-commit transition is chart-owned, interruptible, disposable (rule 13); the `Editor` is `Idle` at `commit`. No settling state.
- **`cancel`:** `transition` back to the snapshot layout. Tiles tween to their pre-gesture positions/areas.
- **`updated`:** `transition` to the new committed state, with **enter/exit lifecycle on every rendered-set change** (entering tiles fade in at target geometry; exiting tiles fade out in place with geometry frozen; surviving tiles transition). Covers external data change (including structural: node/level added or removed), drill, sort/measure/`depth` toggle. While `Drafting`, transitions the committed data underneath the draft overlay; the overlay stays until `commit` or `cancel`.

### Drill

Drill is an `updated`, rendered as an autonomous `transition` (no continuous drill, no preview). Geometry differs from icicle/sunburst/pack:

- The treemap **does not use an affine viewport zoom** for drill. Reason: fixed-pixel group headers cannot be expressed inside a single affine scale (deep drill would multiply every nested header by the zoom factor, ballooning them). Instead, on drill the chart **re-layouts from the focus node at full canvas size** (`treemap().size([W, H])` rooted at the focus node) and **tweens each live tile's screen-space `{x,y,w,h}`** to its new target in the re-rooted layout. Group headers stay fixed-pixel because they're pinned labels, not scaled geometry.
- Drill-in: the focus node becomes the new root; its subtree re-layouts to fill the canvas; ancestor and off-focus tiles exit (fade out in place, geometry frozen). Drill-out: the reverse.
- Interruptible and disposable (rule 13): a new drill or resize during the tween cancels the in-flight per-tile tweens and re-targets from each tile's current position.

`sort` toggle, `measure` swap, and `depth` change are `updated` events rendered as `transition`s — tiles slide to their new squarify positions/areas. The only `render` (no transition) is the live `Drafting` preview.

## 6. What does this chart do that the family contract does not cover?

**One finding — the Hierarchical family `draft` contract is too narrow.**

The family contract (`gesture-architecture.md` §"Hierarchical") reads:

> `draft`: scale the edited node inside the saved parent bounds; freeze sibling ordering; do not recompute the full layout.

This describes the **icicle/sunburst** strategy (subtree-patch inside saved parent bounds). The treemap (and pack) use a **different** `draft` strategy documented in interaction-principles §"Hierarchical marks": scale the edited mark against a frozen sibling layout, optionally fading/hiding children. Two concrete divergences:

1. **"do not recompute the full layout"** is wrong for treemap. The treemap *does* recompute the full squarify layout on every value write (the layout is a reactive derivation over the value cells); it just *doesn't apply* the sibling repositioning while `Drafting`. The accurate invariant is "do not *apply* sibling repositioning or relayout transitions during `draft` — defer them to `commit`," which is exactly interaction-principles rule 8. The "do not recompute" clause conflates the *computation* (which treemap does) with the *application* (which both defer).
2. **"freeze sibling ordering"** is the wrong freeze for treemap/pack. They have no reorder gesture; what's frozen is sibling *positions*, not ordering. "Freeze sibling positions" covers both sub-groups.

The observable contract is the same for both branches: **during `draft`, the edited mark reflects the new value live; siblings hold their pre-gesture positions; no relayout transition runs until `commit`.** The *mechanism* (subtree-patch vs scale-against-frozen-siblings vs puzzle-piece) is a per-geometry choice the chart makes — consistent with rule 9 ("the `Editor` does not dictate the strategy") and rule 10 ("charts are autonomous consumers").

**Proposed fix:** broaden the Hierarchical family `draft` line to state the observable invariant, and name the two mechanism variants. See the model change proposed alongside this spec.

No other gaps. The treemap's `commit`/`cancel`/`updated`/drill behavior is identical to the icicle's at the model level — only the `draft` mechanism and the drill geometry (per-tile tweens vs affine viewport) differ, both of which are family-geometry details.

## Summary

The treemap is the second Hierarchical geometry. It diverges from the icicle in three ways, all geometry/mechanism, none model-level except the one `draft`-contract finding: (1) squarify layout with fixed-pixel group headers; (2) `draft` uses scale-against-frozen-siblings (not subtree-patch), exposing that the family contract's "do not recompute the full layout" and "freeze sibling ordering" clauses are too icicle-specific; (3) drill re-roots the layout and tweens per-tile screen rects (not an affine viewport zoom) because fixed-pixel headers can't be affine-scaled. No reorder, no boundary knobs — number scrub + wheel + keyboard + cross-tile only. The model fix proposed alongside this spec broadens the Hierarchical `draft` contract to cover both branches.
