# Spec — Icicle

Spec for the icicle `Chart`, written in the vocabulary of `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. Design only — no code, no file names, no implementation details.

## 1. What kind of `Chart` is this?

- **Family:** `Hierarchical`.
- **Geometry:** rectilinear partition. Each node is an axis-aligned rectangle. Depth levels tile along one axis (the *depth axis*); siblings within a parent tile along the orthogonal axis (the *sibling axis*), their spans proportional to value.
- **Orientation:** the `orientation` config dimension selects which canvas axis is the depth axis:
  - `horizontal` — depth along x, siblings stacked along y (a "partition" chart).
  - `vertical` — depth along y, siblings along x (the original "icicle").
  All geometry and gesture math is orientation-symmetric; only the axis assignment changes.
- **Editable:** yes. The icicle creates a `Gesture` (which wraps an `Editor` plus a per-gesture store) and registers its editor with `Kernel.Drafts` via the `DataView`.
- **Multi-level:** yes. The icicle shows multiple depth levels simultaneously, per interaction-principles rule 17. A `depth` config dimension caps how many levels below the focus node are visible.
- **Host-sized:** the chart fills its container. The SVG coordinate space is the host's pixel size, driven by a resize observer — no fixed viewBox, no aspect-ratio distortion. Tiles never squish or stretch.

## 2. What `DataView` query does it subscribe?

The icicle subscribes a `DataView` keyed by canonical config. Config dimensions split into two tiers:

**Query fields** — determine what the `DataView` returns. These are the canonical key: two charts share a `DataView` iff their query fields match. A change to a query field creates a new `DataView` (rebuild).

- `datasetId` — names the `Dataset` (whose `dataShape` is `hierarchical`).
- `measure` — which value binding drives tile spans.
- `depth` — maximum number of levels rendered below the focus node. When unset, the full subtree is shown.

**Render fields** — determine how the chart renders the query result. Applied by the chart, not the `DataView`. A change to a render field is an `updated` event on the same `DataView`: the chart re-derives layout on existing DOM and `transition`s (§5). Render fields are NOT part of the canonical key.

- `sort` — `index` (caller-supplied child order) or `value` (descending value). Drives sibling ordering within every parent.
- `orientation` — depth-axis assignment (see §1). Does not change the query result, only the geometry.
- `conservationMode` — `'additive' | 'proportional-neighbor' | 'proportional-siblings'`, default `'additive'`. The default value-mapping for keyboard edits. Alt key overrides to `'proportional-neighbor'` regardless of this setting. Wheel is always additive and ignores this config.
- `canReorder` — `boolean`, default `false`. Enables the reorder input behavior. Only meaningful when `sort === 'index'`.

A livebound treetable (or any other hierarchical chart) shares this `DataView` iff their query fields match; a difference in any query field — including `datasetId` — means they do not share. Two charts with the same query fields but different render fields (e.g. one sorted by index, one by value) share the `DataView` but render differently.

The query result is a hierarchy windowed by the **drill focus** plus `depth`:

- With no focus (root view), the window is every node from depth 1 down to `depth` levels.
- With a focus node, the window is the focus node's subtree (capped at `depth` levels below it) plus the chain of ancestors of the focus node, retained so their geometry stays available for drill-out transitions.

The drill focus is part of the chart's state, not the `DataView` query per se; changing it produces a re-windowing that the chart renders as an animated drill transition (§5).

## 3. Does it create an `Editor`?

Yes — it creates a `Gesture` (which wraps an `Editor` plus a per-gesture store). The `Editor` is the state machine (`Idle` / `Drafting`, events `draft` / `commit` / `cancel` / `updated`); the `Gesture` adds a store for behaviors to share (snapshot, held keys, activation state, frozen order) and a `setup` composition API. Behaviors attach to the `Gesture`, read/write the store, and call through to the `Editor`. The `Gesture` creates its own `Editor` by default; if the `DataView` already has one, the `Gesture` can wrap that instead.

All input behaviors produce `intent: edit` or `intent: reorder`; each `edit` behavior has its own **value-mapping** (how the proposed `value` in the `draft` is derived from the input), encoded in the `draft`'s `value`, not in the `intent`. Runtime-varying parameters (e.g. whether reorder is enabled) are passed as getters — if a param is a function, the behavior resolves it at call time; if it's a plain value, it's treated as a constant:

- **`wheelEdit`** — cmd/ctrl+wheel over a leaf tile scales that leaf's value. **Additive** — only the target leaf changes; the parent total is *not* preserved. Target: the hovered tile, or the focused tile if nothing is hovered. Root is not editable. `intent: edit`.
- **`keyboardEdit`** — arrow keys on the focused tile edit its value. Value-mapping is `conservationMode` by default (additive — only the target changes, parent total not preserved). **Alt → proportional-neighbor** — the adjacent sibling in the direction of the arrow key absorbs the equal-and-opposite delta so the parent total is preserved. If no neighbor exists in that direction, the step is additive. First arrow of a sequence begins a gesture; each keydown (incl. key-repeat) applies a fractional dynamic step; Esc reverts the whole sequence to the gesture-start snapshot; keyup of the last held arrow commits. `intent: edit`.
- **`edgeHandleDrag`** — for each pair of adjacent siblings within a parent (≥ 2 children, interior edges only, root row excluded), an **edge handle** sits on their shared boundary along the sibling axis. Dragging **reapportions the two siblings' values with their sum preserved** (two-sibling reapportion — neither additive nor proportional; only the two adjacent siblings change, by the drag fraction). Suppressed when the `no-handles` attribute is present. `intent: edit`.
- **`reorderDrag`** — when `canReorder` is enabled and `sort === 'index'` (both checked at runtime via getters), dragging a tile reorders it among its siblings within the same parent. No value change — reorders only. The dragged tile follows the pointer along the sibling axis; siblings slide to provisional slots. `intent: reorder`.
- **Programmatic — cross-tile.** A livebound treetable sharing the `DataView` publishes `draft` events when a cell is edited; the icicle renders the draft preview. The value-mapping is whatever the source chart's edit produced. **Conservation is not enforced on external edits** — a treetable cell edit can leave `sum(children) ≠ parent.total`; the icicle renders it anyway (partition normalizes for display). The icicle's conservation setting governs only its *own* gesture edits. `intent: edit`.

Drag-to-reorder and value-edit drags are mutually exclusive on the same tile; the reorder behavior is only armed when `canReorder` is on, otherwise the tile body is a click/focus target.

## 4. What `intent` does each control surface produce?

- `wheelEdit` → `edit` (value-mapping: additive, parent total not preserved).
- `keyboardEdit` → `edit` (value-mapping: `conservationMode` by default; Alt → proportional-neighbor, parent total preserved).
- `edgeHandleDrag` → `edit` (value-mapping: two-sibling reapportion, sum preserved).
- `reorderDrag` → `reorder` (no value change).
- Programmatic / cross-tile → `edit` (value-mapping: source-defined).

All `edit` surfaces produce the same `intent`; they differ only in value-mapping, which is carried in the `draft`'s `value`. Both `edit` and `reorder` freeze the displayed sibling order during the gesture: `edit` does not reorder siblings, and `reorder` changes only order, not values. The `frozenOrder` snapshot is captured at gesture start and used by `buildWindow` while the `Gesture` is `Active`.

## 5. What `render` / `transition` effects are attached to each `Editor` event?

Per the Hierarchical family effect contract (`gesture-architecture.md` §"Hierarchical"). The icicle composes render behaviors onto the `Gesture`:

- **`previewFullRender({ deferSort })`** — during `draft`, the entire chart re-renders with updated values live. `deferSort` is a getter; when it resolves true (sort !== 'index'), sibling ordering is frozen at the pre-gesture state; no relayout *transition* runs until `commit` (rule 8). This is the `frozenOrder` mechanism — it's a render behavior, not a separate concept. Per-surface, using the value-mappings from §3:
  - *`edgeHandleDrag` (two-sibling reapportion):* the two adjacent siblings' spans update live along the sibling axis; their sum and the parent bounds are fixed, so the layout is patched in place. Other siblings and all other levels are frozen.
  - *`wheelEdit` (additive):* the entire chart re-renders with the edited leaf's new value; sibling ordering is frozen. Parent total grows/shrinks; all nodes reposition according to the frozen order.
  - *`keyboardEdit` (additive by default; Alt → proportional-neighbor):* the entire chart re-renders with the edited leaf's new value; sibling ordering is frozen. By default only the edited leaf's span scales (parent total grows/shrinks). With Alt, the immediate neighbor absorbs the delta so the parent total is preserved.
  - *Cross-tile `draft`:* the entire chart re-renders with the edited node's new value; sibling ordering is frozen. The draft value is written directly into the reactive tree, and gesture suppression ensures the preview is immediate, not animated. If the source edit leaves `sum(children) ≠ parent.total`, the icicle does **not** correct it — conservation is the chart's policy on its *own* edits, not a constraint it imposes on other editors.
  - *`reorderDrag`:* the dragged tile follows the pointer along the sibling axis; siblings slide to their provisional slots. The saved parent span is the parent's total value at gesture start; spans are recomputed by partitioning that saved total proportionally to each sibling's value in the provisional order. Sibling spans stay proportional to value throughout.
- **`transitionOnUpdated`** — on `commit`, `cancel`, and `updated`, the chart `transition`s. There is no "snap lane" and "tween lane" — there is `draft` (immediate, via `previewFullRender`) and `updated`/`commit`/`cancel` (transition, via `transitionOnUpdated`). That's the whole distinction.
  - `commit`: recompute the affected subtree (re-run the partition for the edited parent, or apply the new sibling order), then `transition` nodes to their new slots. The post-commit transition is an autonomous, interruptible, disposable effect owned by the chart (rule 13).
  - `cancel`: `transition` back to the snapshot layout.
  - `updated`: `transition` to the new committed state. `updated` covers *any* non-gesture change — external data change (including structural changes), drill, sort toggle, orientation toggle, measure swap, `depth` change. The default response is a `transition`, not a snap; snapping is the exception. While the `Gesture` is `Active`, an `updated` transitions the committed data underneath the draft overlay; the draft overlay stays where the user last put it until `commit` or `cancel`.
- **`enterExitLifecycle`** — on every `updated` that changes the rendered set, entering marks fade in at their target geometry; exiting marks fade out in place with their geometry frozen; surviving marks `transition` to their new slots. Under `prefers-reduced-motion`: enter/exit is immediate; autonomous transitions are suppressed; reactive motion (live drag feedback) stays on.

### Drill

Drill-down / drill-up is a change of the drill focus — an `updated`, not a gesture (there is no continuous drill, no preview of a drill). It is rendered as an autonomous `transition`:

- Drill-in: the focus node's subtree expands to fill the canvas; ancestors recede. A viewport tween animates the level change. Exiting tiles fade out in place; entering tiles fade in. The drilled-to node (the "context node") is visually distinguished from its expanded children (dimmed opacity).
- Drill-out: the reverse.
- The drill transition is interruptible and disposable (rule 13).

Orientation toggle, sort toggle, measure swap, and `depth` change are the same shape — `updated` events that the chart renders as `transition`s. The only `draft`-time responses are the live previews above, which `render` (full re-render with frozen order) rather than `transition`.

## 6. Focus and Hover

The icicle has chart-level interaction state — **focus** and **hover** — distinct from the `Gesture`/`Editor`. Neither starts a draft; a draft does not change either.

**Focus:**
- One focused node at a time (or null). Set by click on a tile, Tab navigation, or external bridge. Cleared by Escape (when no active gesture) or blur.
- Focus is required for `keyboardEdit` — arrow keys edit the focused tile. Without focus, arrow keys do nothing.
- Focus does **not** drive drill — drill is triggered by dblclick or breadcrumb.
- Visual: stroke highlight and focus ring. Focus is emitted to the host for cross-tile sync.

**Hover:**
- One hovered node at a time (or null). Set by pointerenter, cleared by pointerleave. External bridge for cross-tile sync.
- Hover is the default target for `wheelEdit` (focused tile as fallback).
- Visual: stroke highlight and pointer cursor. Hover does not dim non-hovered tiles.

Both focus and hover have visual highlights (stroke color/width changes); the exact styling is an implementation concern, not a spec concern. Focus and hover can both be active; focus takes precedence in the highlight.

## 7. What does this chart do that the family contract does not cover?

- **Focus/hover** (§6): chart-level selection and hover states with stroke highlights, Tab navigation, and cross-tile sync. These are not `Editor` states — they are independent interaction state layered on top.
- **Edge handles** (§3): the specific input behavior for two-sibling reapportion along interior edges. The family contract says "hierarchical marks have handles"; the icicle specifies edge handles between adjacent siblings.
- **`conservationMode` config** (§2): the family contract says value-mapping is overridable; the icicle exposes `conservationMode` as the config knob for keyboard edit value-mapping.
- **Drill viewport tween** (§5): the family contract says "drill is an `updated` rendered as a `transition`"; the viewport tween is the icicle's specific transition strategy for zooming into a subtree.

The core gesture/transition model holds: `draft` (via `previewFullRender`) patches in place with siblings frozen; `commit` / `cancel` / `updated` (via `transitionOnUpdated`) `transition`. The icicle composes shared behaviors onto a `Gesture` (an `Editor` + store + `setup` API) — the chart-specific code is the composition and the value-mappings, not the gesture machinery itself.

## Summary

The icicle is the reference Hierarchical chart. It composes shared input behaviors (`wheelEdit`, `keyboardEdit`, `edgeHandleDrag`, `reorderDrag`) and shared render behaviors (`previewFullRender`, `transitionOnUpdated`, `enterExitLifecycle`) onto a base `Gesture` machine. `draft` renders immediately with sibling order frozen; `commit` / `cancel` / `updated` transition. Drill is an `updated` rendered as a viewport-tween transition. Focus and hover are independent interaction state. The chart-specific code is the composition and the value-mappings — the gesture machinery is shared across all charts.
