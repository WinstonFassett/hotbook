# Spec — Pack (Circle Pack)

Spec for the circle pack `Chart`. The pack is in the Hierarchical family. Like the treemap, it uses the **scale-against-frozen-siblings** `draft` strategy (interaction-principles §"Hierarchical marks", second bullet), not the icicle/sunburst subtree-patch. Like the icicle/sunburst, it uses an **affine viewport zoom** for drill. This spec calls out where pack diverges from `wiki/specs/icicle.md` and `wiki/specs/treemap.md`; everything not mentioned is identical to their model-level claims.

Vocabulary: `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. The old `MdPack` code was read once for behavior and then set aside.

## 1. What kind of `Chart` is this?

- **Family:** `Hierarchical`.
- **Geometry:** **circle pack**. Each node is a circle; sibling circles pack inside the parent circle's bounds with fixed-pixel padding, radii proportional to √value. Circles **must stay circular** — a non-uniform scale would make them overlap, so the viewport uses a uniform `min(Wc/spanW, Hc/spanH)` scale.
- **No orientation** config dimension.
- **Editable:** yes. Creates an `Editor`, registers with `Kernel.Drafts`.
- **Multi-level:** yes — nested circles show multiple depth levels simultaneously (rule 17). `depth` caps how many levels below the focus node are visible.

## 2. What `DataView` query does it subscribe?

Same as sunburst/treemap (no orientation):

- `measure` — value binding driving circle areas (radii ∝ √value).
- `sort` — `index` or `value`; drives sibling ordering within every parent.
- `depth` — maximum number of levels rendered below the focus node.

Windowing: focus node's subtree (plus the focus node as a context circle when drilled). Does not retain off-screen ancestors — the affine viewport zoom (§5) handles drill by remapping, and the pack layout is computed once over the full tree (not re-rooted on drill the way treemap re-roots).

## 3. Does it create an `Editor`?

Yes. Control surfaces that produce `draft` events:

- **Drag mark — number scrub.** Dragging horizontally on a circle scrubs its value (right = +, left = −; Shift = coarse, Alt = fine). Pack's primary edit surface — **no boundary knobs**. `intent: edit`.
- **Wheel — circle.** Cmd/Ctrl+wheel over a circle scales its value. Pack uses the **default** scaling mode (`proportional-siblings`), not `proportional-neighbor` — the pack layout redistributes the delta across siblings rather than absorbing it into a single neighbor. `intent: edit`.
- **Keyboard — focused circle.** Arrow / numeric entry on the focused circle edits its value. Same scaling mode. `intent: edit`.
- **Programmatic — cross-tile.** A livebound `Table` sharing the `DataView` publishes `draft` events; the pack renders the draft preview. `intent: edit`.

**No reorder gesture, no boundary knobs.** Same capability shape as treemap.

## 4. What `intent` does each control surface produce?

All control surfaces produce `edit`. The pack has no `reorder` intent.

## 5. What `render` / `transition` effects are attached to each `Editor` event?

Per the Hierarchical family effect contract — with the pack's `draft` geometry (scale-against-frozen-siblings):

- **`draft` (`edit`):** the edited circle reflects its new value live (radius rescales); sibling circles **hold their pre-gesture positions/radii** (frozen); no relayout transition runs during the gesture. Same mechanism and invariant as treemap — the pack layout re-derives reactively as the value writes through, but the chart suppresses sibling repositioning while `Drafting`. Children of the edited circle may be faded or hidden (chart-specific option). This is the **scale-against-frozen-siblings** strategy, the same family-contract finding as treemap (§6).
- **`commit`:** recompute the full pack layout with the committed values, then `transition` all circles to their new positions/radii. Post-commit transition is chart-owned, interruptible, disposable (rule 13); the `Editor` is `Idle` at `commit`. No settling state.
- **`cancel`:** `transition` back to the snapshot layout. Circles tween to their pre-gesture positions/radii.
- **`updated`:** `transition` to the new committed state. Covers external data change, drill, sort/measure/`depth` toggle. While `Drafting`, transitions the committed data underneath the draft overlay; the overlay stays until `commit` or `cancel`.

### Drill

Drill is an `updated`, rendered as an autonomous `transition` (no continuous drill, no preview). Geometry — pack uses the **affine viewport zoom** like icicle/sunburst, **not** the per-tile screen-rect tweens treemap uses:

- The viewport is a layout-space bounding box `[vx0, vy0, vx1, vy1]`; on drill it tweens to the union bounding box of the focus node's descendants. A uniform `min(Wc/spanW, Hc/spanH)` scale maps layout-space to canvas, keeping circles circular.
- Drill-in: the focus node's subtree expands to fill the canvas; ancestor and off-focus circles exit (fade out in place, geometry frozen so they don't ghost through the viewport tween). Drill-out: the reverse.
- Interruptible and disposable (rule 13): a new drill or resize during the tween cancels the in-flight viewport tween and starts from the current viewport position.

`sort` toggle, `measure` swap, and `depth` change are `updated` events rendered as `transition`s — circles slide to their new pack positions/radii. The only `render` (no transition) is the live `Drafting` preview.

## 6. What does this chart do that the family contract does not cover?

**Same finding as treemap — the Hierarchical family `draft` contract is too narrow.**

The family contract's `draft` line ("scale the edited node inside the saved parent bounds; freeze sibling ordering; do not recompute the full layout") describes the icicle/sunburst subtree-patch strategy. The pack, like the treemap, uses scale-against-frozen-siblings: the full pack layout *is* recomputed on every value write, but sibling repositioning is *not applied* while `Drafting`. The "do not recompute the full layout" and "freeze sibling ordering" clauses are both wrong for pack (no reorder gesture; siblings frozen by position, not order; layout is recomputed).

The proposed fix is the same one documented in `wiki/specs/treemap.md` §6: broaden the Hierarchical family `draft` line to state the observable invariant (edited mark reflects the new value live; siblings hold pre-gesture positions; relayout transition deferred to `commit`) and name the two mechanism variants (subtree-patch for icicle/sunburst; scale-against-frozen-siblings for treemap/pack).

No other gaps. Pack's `commit`/`cancel`/`updated`/drill behavior is identical to the icicle's at the model level (affine viewport drill like icicle/sunburst; `draft` mechanism like treemap). The scaling-mode difference (default `proportional-siblings` vs `proportional-neighbor`) is a value-mapping detail inside the `edit` intent, not a model concept.

## Summary

The pack is the third Hierarchical geometry. It combines the treemap's `draft` strategy (scale-against-frozen-siblings — exposing the same family-contract finding) with the icicle/sunburst's drill geometry (affine viewport zoom — circles must stay circular, so a uniform scale is required). No reorder, no boundary knobs — number scrub + wheel + keyboard + cross-tile only; default `proportional-siblings` scaling for value edits. The model fix proposed in `wiki/specs/treemap.md` covers pack as well.
