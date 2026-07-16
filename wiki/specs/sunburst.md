# Spec — Sunburst

Spec for the sunburst `Chart`. The sunburst is a radial variation of the icicle — same Hierarchical family, same `Editor`, same control surfaces, same effect contract. Only the geometry differs. This spec is written against `wiki/specs/icicle.md` (the reference Hierarchical spec) and calls out only where the sunburst diverges; everything not mentioned here is identical to the icicle.

Vocabulary: `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. The old `MdSunburstLC` code was read once for behavior and then set aside.

## 1. What kind of `Chart` is this?

- **Family:** `Hierarchical` (same as icicle).
- **Geometry:** **radial** partition. Each node is an **arc** (annular sector), not a rectangle. Depth is the **radial** axis (root at center, deeper levels outward); siblings within a parent tile along the **angular** axis, their angular spans proportional to value. Total angular span per parent is fixed (a full `2π` for the root's children, the parent's angular span for deeper levels).
- **No orientation.** Unlike the icicle, the sunburst exposes no `orientation` config dimension — radial geometry has no orientation toggle. This is the only config-shape difference from the icicle.
- **Editable:** yes. Creates an `Editor`, registers with `Kernel.Drafts`.
- **Multi-level:** yes. Concentric rings show multiple depth levels simultaneously (rule 17). `depth` caps how many rings below the focus node are visible.

## 2. What `DataView` query does it subscribe?

Same as icicle, minus `orientation`:

- `measure` — value binding driving arc angular spans.
- `sort` — `index` or `value`; drives sibling ordering within every parent.
- `depth` — maximum number of levels rendered below the focus node.

Windowing differs from icicle purely as a geometry consequence: the sunburst's window is the **focus node's subtree only** (plus, at root, all nodes depth 1..`depth`). It does **not** retain ancestors of the focus node in the rendered set, unlike the icicle. Reason: off-angle siblings of an ancestor remap to angles outside `[0, 2π]` and produce degenerate arc paths. The icicle can keep ancestor tiles because rectilinear remapping tolerates off-screen geometry; radial remapping does not. This is a rendering/windowing detail, not a model difference — the `DataView` query is the same shape.

## 3. Does it create an `Editor`?

Yes — same five control surfaces as the icicle:

- **Drag handle — boundary knob.** A draggable knob on the shared angular boundary between two adjacent sibling arcs. Dragging reapportions the two siblings' values (sum preserved). The knob is oriented **tangent to the arc** (perpendicular to the radial line at the boundary), whereas the icicle's knob is axis-aligned. `intent: edit`.
- **Wheel — arc.** Cmd/Ctrl+wheel over a leaf arc scales that leaf's value; a neighbor absorbs the delta (proportional-neighbor). `intent: edit`.
- **Keyboard — focused arc.** Arrow / numeric entry on the focused arc edits its value. Same scaling mode. `intent: edit`.
- **Drag mark — reorder.** When `canReorder` is enabled and `sort === 'index'`, dragging an arc reorders it among its siblings within the same parent. Slot computation is **angular** (pointer → angle → slot), not linear. `intent: reorder`.
- **Programmatic — cross-tile.** A livebound `Table` sharing the `DataView` publishes `draft` events; the sunburst renders the draft preview. `intent: edit`.

## 4. What `intent` does each control surface produce?

Identical to icicle: boundary knob / wheel / keyboard / cross-tile → `edit`; drag mark reorder → `reorder`.

## 5. What `render` / `transition` effects are attached to each `Editor` event?

Per the Hierarchical family effect contract — same as icicle, with "arc" substituted for "tile" and "angular" for "sibling-axis":

- **`draft` (`edit`):** scale the edited arc inside the saved parent's angular bounds; freeze sibling ordering; do not recompute the full partition. Boundary-knob drag patches the two adjacent arcs' angular spans in place (sum and parent angular span fixed). Wheel/keyboard on a leaf scales the leaf's angular span; the neighbor absorbs the delta; parent total preserved. Cross-tile `draft`: same. Siblings frozen throughout.
- **`draft` (`reorder`):** the dragged arc follows the pointer's angular position; siblings slide to their provisional angular slots with a short reactive tween, their spans recomputed from the provisional order against the saved parent angular span. No full partition recompute. Sibling spans stay proportional to value.
- **`commit`:** recompute the affected subtree, then `transition` arcs to their new angular/radial positions. For `reorder`, the committed order is written back through the `DataView` and the chart animates the slide. Post-commit transition is chart-owned, interruptible, disposable (rule 13); the `Editor` is `Idle` at `commit`. No settling state.
- **`cancel`:** `transition` back to the snapshot layout. Arcs tween to their committed angular/radial slots.
- **`updated`:** `transition` to the new committed state. Covers external data change, drill, sort/measure/`depth` toggle (no orientation toggle — see §1). While `Drafting`, transitions the committed data underneath the draft overlay; the overlay stays until `commit` or `cancel`.

### Drill

Same model as icicle — drill is an `updated`, rendered as an autonomous `transition` (no continuous drill, no preview). Geometry differs:

- **Drill-in:** the focus arc expands to fill the full circle (`[0, 2π]` angular, its inner radius → 0); the focus node's descendants become the new concentric rings. The ancestor rings are **discarded** from the rendered set (sunburst drills *into* a node and shows its subtree as the whole circle) — unlike the icicle, which keeps ancestors visible as context tiles.
- **Drill-out:** the reverse — the parent's ring returns and the current subtree contracts back into its angular slot within the parent.
- Viewport tween animates the angular domain `[x0, x1]` and radial domain `[y0, y1]`. Exiting arcs fade out in place (geometry frozen so they don't ghost through the viewport tween); entering arcs fade in.
- Interruptible and disposable (rule 13): a new drill or resize during the tween cancels the in-flight tween and starts from the current viewport.

`sort` toggle, `measure` swap, and `depth` change are `updated` events rendered as `transition`s — arcs slide to their new angular/radial positions. The only `render` (patch in place) is the live `Drafting` preview.

## 6. What does this chart do that the family contract does not cover?

Nothing — same answer as the icicle. The sunburst is the icicle with radial geometry; the Hierarchical family contract ("scale the edited node inside saved parent bounds; freeze sibling ordering; do not recompute the full layout") describes it exactly once "node" is read as "arc" and "parent bounds" as "parent's angular span." Drill is an `updated` rendered as a `transition` per the broadened `updated` definition. The model holds; no gaps.

## Summary

The sunburst is a radial variation of the icicle. Every model-level claim in `wiki/specs/icicle.md` carries over unchanged: `draft` patches in place inside saved parent bounds with siblings frozen; `commit` / `cancel` / `updated` (including drill and config toggles) `transition`; snapping is the exception; the post-commit transition lifecycle is chart-owned with no observable settling state. The only deltas are geometry (arcs not rects; radial/angular axes not depth/sibling axes), the absence of an `orientation` config dimension, the tangent-orientation of boundary knobs, angular slot computation for reorder, and the drill window discarding ancestors rather than retaining them. None of these are model-level; all are family-geometry details covered by the existing Hierarchical contract.
