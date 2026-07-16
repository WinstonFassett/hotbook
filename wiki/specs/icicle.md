# Spec — Icicle

Spec for the icicle `Chart`, written in the vocabulary of `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. The old `MdIcicleLC` code was read once for behavior and then set aside; this spec is the authority for the rewrite.

## 1. What kind of `Chart` is this?

- **Family:** `Hierarchical`.
- **Geometry:** rectilinear partition. Each node is an axis-aligned rectangle. Depth levels tile along one axis (the *depth axis*); siblings within a parent tile along the orthogonal axis (the *sibling axis*), their spans proportional to value.
- **Orientation:** the `orientation` config dimension selects which canvas axis is the depth axis:
  - `horizontal` — depth along x, siblings stacked along y (a "partition" chart).
  - `vertical` — depth along y, siblings along x (the original "icicle").
  All geometry and gesture math is orientation-symmetric; only the axis assignment changes.
- **Editable:** yes. The icicle creates an `Editor` and registers it with `Kernel.Drafts`.
- **Multi-level:** yes. The icicle shows multiple depth levels simultaneously, per interaction-principles rule 17. A `depth` config dimension caps how many levels below the focus node are visible.

## 2. What `DataView` query does it subscribe?

The icicle subscribes a `DataView` keyed by its config dimensions:

- `measure` — which value binding drives tile spans.
- `sort` — `index` (caller-supplied child order) or `value` (descending value). Drives sibling ordering within every parent.
- `depth` — maximum number of levels rendered below the focus node. When unset, the full subtree is shown.
- `orientation` — depth-axis assignment (see §1). Does not change the query, only the geometry.

The query result is a hierarchy windowed by the **drill focus** plus `depth`:

- With no focus (root view), the window is every node from depth 1 down to `depth` levels.
- With a focus node, the window is the focus node's subtree (capped at `depth` levels below it) plus the chain of ancestors of the focus node, retained so their geometry stays available for drill-out transitions.

The drill focus is part of the chart's state, not the `DataView` query per se; changing it produces a re-windowing that the chart renders as an animated drill transition (§5).

## 3. Does it create an `Editor`?

Yes. Control surfaces that produce `draft` events:

- **Drag handle — boundary knob.** For each pair of adjacent siblings within a parent, a draggable knob sits on their shared boundary along the sibling axis. Dragging reapportions the two siblings' values (sum preserved). `intent: edit`.
- **Wheel — tile.** Cmd/Ctrl+wheel over a leaf tile scales that leaf's value. The delta is absorbed by a neighbor (proportional-neighbor scaling) so the parent total is preserved. `intent: edit`.
- **Keyboard — focused tile.** Arrow / numeric entry on the focused tile edits its value. Same scaling mode as wheel. `intent: edit`.
- **Drag mark — reorder.** When `canReorder` is enabled and `sort === 'index'`, dragging a tile reorders it among its siblings within the same parent. `intent: reorder`.
- **Programmatic — cross-tile.** A livebound `Table` sharing the `DataView` publishes `draft` events when a cell is edited; the icicle renders the draft preview (interaction-principles "Cross-tile"). `intent: edit`.

Drag-to-reorder and value-edit drags are mutually exclusive on the same tile; the reorder surface is only armed when `canReorder` is on, otherwise the tile body is a click/focus target.

## 4. What `intent` does each control surface produce?

- Boundary knob drag → `edit`.
- Wheel on tile → `edit`.
- Keyboard on focused tile → `edit`.
- Programmatic / cross-tile → `edit`.
- Drag mark reorder → `reorder`.

The `reorder` intent freezes displayed sibling order during the gesture (per the universal input model and interaction-principles rule 7); `edit` does not.

## 5. What `render` / `transition` effects are attached to each `Editor` event?

Per the Hierarchical family effect contract (`gesture-architecture.md` §"Hierarchical"):

- **`draft` (`edit`):** scale the edited node inside the saved parent bounds; freeze sibling ordering; do not recompute the full partition layout. Concretely for the icicle:
  - *Boundary knob:* the two adjacent siblings' spans update live along the sibling axis; their sum and the parent bounds are fixed, so the layout is patched in place. Other siblings and all other levels are frozen.
  - *Wheel / keyboard on a leaf:* the edited leaf's span scales; the neighbor absorbs the delta so the parent total is preserved. Sibling order frozen.
  - *Cross-tile `draft`:* same — the edited node scales inside its parent bounds, siblings frozen.
- **`draft` (`reorder`):** the dragged tile follows the pointer along the sibling axis; siblings slide to their provisional slots with a short reactive tween, their spans recomputed from the provisional order against the saved parent span. No full partition recompute; ordering is the only thing that changes. Sibling spans stay proportional to value throughout.
- **`commit`:** recompute the affected subtree (re-run the partition for the edited parent, or apply the new sibling order), then `transition` nodes to their new slots. For `reorder`, the committed order is written back through the `DataView` and the chart animates the slide to the final layout. The post-commit transition is an autonomous, interruptible, disposable effect owned by the chart (rule 13); the `Editor` is `Idle` the moment `commit` fires, and the chart manages the animation's lifecycle itself. No "settling" state is observed or needed — no chart gates on whether another chart's post-commit animation is still running.
- **`cancel`:** `transition` back to the snapshot layout. Tiles tween to their committed slots; no reorder, no relayout beyond the revert.
- **`updated`:** `transition` to the new committed state. `updated` covers *any* non-gesture change to the chart's data or config — external data change, drill, sort toggle, orientation toggle, measure swap, `depth` change. The default response is a `transition`, not a snap; snapping is the exception, reserved for cases where transition is impossible or explicitly chosen. While the `Editor` is `Drafting`, an `updated` transitions the committed data underneath the draft overlay; the draft overlay stays where the user last put it until `commit` or `cancel` (interaction-principles rule 8: relayout/transition is deferred only while the gesture is active).

### Drill

Drill-down / drill-up is a change of the drill focus — an `updated`, not an `Editor` gesture (there is no continuous drill, no preview of a drill). It is rendered as an autonomous `transition`:

- Drill-in: the focus node's subtree expands to fill the canvas; ancestors recede. A viewport tween (depth-axis and sibling-axis bounds) animates the level change. Exiting tiles fade out in place (their geometry frozen so they don't ghost through the viewport tween); entering tiles fade in.
- Drill-out: the reverse.
- The drill transition is interruptible and disposable (rule 13): a new drill or a resize during the tween cancels the in-flight tween and starts from the current viewport position.

Orientation toggle, sort toggle, measure swap, and `depth` change are the same shape — `updated` events that the chart renders as `transition`s (tiles slide to their new slots/axes). The only transitions the icicle defers are the live `Drafting` previews in §5, which `render` (patch in place) rather than `transition`.

## 6. What does this chart do that the family contract does not cover?

Nothing. The icicle fits the Hierarchical family contract cleanly:

- `draft` (`edit`) scales the edited node inside saved parent bounds with sibling ordering frozen — exactly the family contract.
- `draft` (`reorder`) freezes displayed order during the gesture — exactly the universal input model's `reorder` intent.
- `commit` / `cancel` / `updated` all `transition`; the only `render` is the live `Drafting` preview — exactly the transition contract (defer relayout/transition while the gesture is active, transition on commit/cancel/updated).
- Drill is an `updated` rendered as a `transition` — covered by the broadened `updated` definition.
- Multi-level display and animated drill are rule 17.

The model holds for the icicle. No gaps.

## Summary

The icicle is the reference Hierarchical chart. Its spec is fully expressible in the locked model's vocabulary: `draft` patches in place inside saved parent bounds with siblings frozen; `commit` / `cancel` / `updated` (including drill and all config toggles) `transition`. Snapping is the exception, not the rule. The post-commit transition lifecycle is chart-owned and needs no observable machine state.
