# Gesture and Editing Architecture for Vizform

Source: `UBIQUITOUS_LANGUAGE.md` and `wiki/interaction-principles.md`.
`interaction-principles.md` is a living constraints document, not gospel; this design doc can expose gaps or conflicts in it.
This document is design only — no code, no file names, no current implementation.

## Core idea

- A `Chart` is a surface with an API. It renders data and exposes gestures, config, and effects.
- The app may provide a `Chart` with a `Kernel`.
- A `Chart` may create and subscribe to a `DataView` and may create an `Editor` if it is editable.
- `Editor` is a per-Chart state machine for `draft` / `commit` / `cancel` / `updated`.
- `Kernel.Drafts` tracks active `Editor`s and reports the global `Idle` / `Drafting` state.
- The `Chart` attaches `render` and `transition` effects to `Editor` events; the `Editor` does not decide rendering strategy.
- A `Chart` is a component with configuration properties; the design is independent of any particular property set.
- Geometry and presentation logic are separate from the `Chart` consumer. The `Chart` coordinates effects; geometry/presentation modules map coordinates, handle shapes, and rendering.
- Input is decoupled from output: drag handle, drag mark, wheel, keyboard, table cell drag, and programmatic edits are all control surfaces that produce the same value-change intent.

## Chart configuration and schema

- A `Chart` is a component with a configuration schema. The schema declares which properties the chart accepts and how they affect the `DataView` query.
- Common config dimensions: `measure`, `sortBy`, `depth`, `orientation`. Each chart family exposes the subset it supports.
- Config changes are applied to the `DataView` query. The `DataView` publishes an `updated` event. The `Chart` `transition`s to the new state. `transition` is the default response to `updated`; snapping is the exception, reserved for cases where transition is impossible or the chart explicitly chooses it.
- `updated` covers **any** non-gesture change to the chart's data or config — external data change, drill, sort toggle, orientation toggle, measure swap, `depth` change. There is no split between "external data change" and "config change"; both are `updated`, both `transition`.
- If an `Editor` is `Drafting`, an `updated` does not change the `Editor` state. The committed data `transition`s underneath the draft overlay; the draft overlay remains where the user last put it until `commit` or `cancel`.

## Universal input model

Every editing input is normalized into a `draft` event. A `draft` carries:

- `target`: the mark or value being edited.
- `value`: the proposed value.
- `source`: which control surface produced it (handle, mark, wheel, keyboard, table, etc.).
- `intent`: `value-change` or `reorder`.

The `Editor` is the same machine regardless of `source`. The `Chart` receives the `draft` and decides how to render it, based on its family and geometry.

## State machines

### Editor (per Chart)

```
Idle:
  draft -> Drafting
  updated -> Idle

Drafting:
  draft -> Drafting
  commit -> Idle
  cancel -> Idle
  updated -> Drafting
```

- `draft` starts or updates a speculative change.
- `commit` finalizes it.
- `cancel` discards it and reverts to the committed snapshot.
- `updated` is any non-gesture change to the chart's data or config while the `Editor` is `Idle` or `Drafting` — external data change, drill, sort/orientation/measure/depth toggle, etc. It does **not** change the `Editor` state. The `Chart` `transition`s to the new committed state; while `Drafting`, the transition runs underneath the draft overlay, which stays as the user left it until `commit` or `cancel`.

### Kernel.Drafts (global)

- Tracks all active `Editor`s.
- Reports the global `Idle` / `Drafting` state.
- Publishes; it does not command. Any `Chart` or `DataView` can subscribe and decide what to do (for example, freeze sort or suppress autonomous transitions).

### Chart family submachines

`BaseChart` and the family names are conceptual contracts, not class names. The implementation can be submachines, state-machine factories, mixins, base classes, or any other mechanism. The contract is what matters.

Families:

- `Cartesian` — bar, band, line, area, scatter, gantt.
- `Radial` — pie, sunburst, concentric-arc, gauge, gauge-segmented, radar.
- `Hierarchical` — icicle, sunburst, treemap, pack, tree, budget-tree.
- `Network/Flow` — sankey.
- `Table` — table / treetable.

Each family implements a common set of effect responses for `Editor` events. The `Editor` is the same for all.

## Layer responsibilities

- `Kernel` — owns canonical data, publishes updates, brokers `DataView`s, and tracks `Editor`s.
- `DataView` — the `Chart`'s query-keyed subscription into the `Kernel`. It attaches and detaches and routes events.
- `Editor` — the per-Chart state machine for draft/commit/cancel/updated.
- `Kernel.Drafts` — the global view of which `Editor`s are `Drafting`.
- `Chart` — the consumer of `DataView` and `Editor` events. It owns effects, geometry, and family-specific behavior.
- `Effect` (`render` / `transition`) — chart-owned, attached to `Editor` events. The `Editor` is agnostic to effects.

## Geometry taxonomy

The gesture contract is the same for all geometries. Only the handle shape and coordinate mapping differ.

- **Linear** — bar, band, line, area, scatter, gantt, icicle (rectilinear), treemap (rectilinear).
- **Radial** — pie, sunburst, concentric-arc, gauge, gauge-segmented, radar.
- **Hierarchical** — icicle, sunburst, treemap, pack, tree, budget-tree.
- **Network/Flow** — sankey.
- **Table** — table / treetable.

## Transition contract

- **During `Drafting`:** render the preview immediately. Do not reorder, relayout, or animate to a new sorted position. Scale the edited mark and the relevant axis or domain if possible.
- **On `commit`:** re-evaluate sort, scale, and domain. Animate or snap to the new layout. Reorder, relayout, and enter/exit transitions happen here.
- **On `cancel`:** `transition` back to the snapshot. No reorder, no relayout beyond the revert; the transition undoes the live preview.
- **`updated` during `Drafting`:** `transition` the committed data to its new state underneath the draft overlay, but do not reapply the draft. (`updated` outside `Drafting` is the normal case below — `transition` to the new state.)
- **All autonomous transitions are interruptible and disposable.** When interrupted, the mark stays at its current visual position and the new transition starts from there.
- **Reduced motion:** reactive motion (direct manipulation feedback) stays on; autonomous motion (post-commit transitions, reorder, mode-change morphs) is suppressible.
- **Post-commit:** layout should contain all data — no overflow, no persistent empty space.
- **Hierarchical changes:** drill and level transitions are animated, not cut.
- **Visual cohesion:** labels and marks move together; interpolate color, position, and threshold crossings.

## Family effect contracts

The `Editor` is the same for every family. Each family attaches effects that know the geometry.

### Cartesian

- `draft`: resize the edited mark and scale the matching axis/domain to fit the preview value; keep siblings frozen.
- `commit`: recompute sort, then animate or snap bars/points to new positions.
- `cancel`: `transition` back to the snapshot.
- `updated`: `transition` committed data to the new state; keep the draft overlay if `Drafting`.

### Radial

- `draft`: rebalance the edited arc and its siblings; the total is fixed.
- `commit`: recompute sort, then animate arcs to new angular positions.
- `cancel`: `transition` back to the snapshot.
- `updated`: `transition` committed data.

### Hierarchical

- `draft`: the edited node reflects its new value live; **sibling positions are frozen** at their pre-gesture state; no relayout *transition* runs until `commit` (rule 8). The layout may be recomputed internally — what's deferred is *applying* sibling repositioning, not the computation itself. Two mechanism variants, both satisfying this invariant (interaction-principles §"Hierarchical marks"):
  - *Subtree-patch* (icicle, sunburst): patch the edited node's span inside the saved parent bounds; do not relayout siblings.
  - *Scale-against-frozen-siblings* (treemap, pack): the full layout re-derives reactively as the value writes through, but sibling repositioning is suppressed while `Drafting`; only the edited mark moves. Children of the edited node may be faded or hidden (chart-specific option).
- `commit`: recompute the subtree (or the full layout for treemap/pack), then `transition` nodes to their new positions. Animate drill/level changes if needed.
- `cancel`: `transition` back to the snapshot layout.
- `updated`: `transition` committed data. Drill and config toggles are `updated` and `transition`.

### Network/Flow

- `draft`: update node or link values while preserving flow constraints where possible.
- `commit`: recompute the layout, then transition.
- `cancel`: `transition` back to the snapshot.
- `updated`: `transition` committed data.

### Table

- The `Table` is a `Chart` family. It can be livebound alongside any other chart by sharing the same `DataView` and `Kernel`.
- `draft`: update the cell value and publish it through the `DataView` so linked `Chart`s (e.g., an icicle) render the draft preview.
- `commit`: finalize the value through the `DataView`. The `Editor` returns to `Idle`; linked `Chart`s run their `transition` effect.
- `cancel`: revert the cell.
- `updated`: reflect external changes while preserving any draft overlay.
- The table supports tree rows with expand/collapse. It is a separate view of the same hierarchical data; it does not need its own layout geometry beyond row rendering.

## Plan

1. Lock the `Editor` / `Kernel.Drafts` contract and state machine.
2. Define the family effect contracts (this document).
3. Implement the `Editor` and `Kernel.Drafts` as a shared, decoupled service.
4. Validate with a temporary hierarchical harness, starting with the icicle chart.
5. Once icicle is solid, extend to the other three interactive hierarchical charts: sunburst, treemap, and pack.
6. After the hierarchical family is proven, extend to Cartesian, Radial, Network/Flow, and Table.
7. Update the acceptance test checklist per family as it is migrated.

## Resolved

- `Editor` is per-`Chart`; `DataView` and `Editor` are optional. A livebound `Table` and `Chart` are two `Chart` surfaces; they may share a `DataView` or each use their own.
- `Table` is a `Chart` family.
- If external `updated` changes the same value being drafted, the draft overlay stays. UBIQUITOUS already answers this.
- `Kernel.Drafts` exposes a **list of active `Editor`s**. No boolean. Derived values (`Idle`/`Drafting`, count, etc.) are computed from the list — we solve derivation later, it is not the hard part. No information hiding: the list is the truth, derived flags are projections.
- Config schema is already baked: a `ChartSchema` descriptor with a valibot runtime `config` schema, `ui.fields` picker descriptors, `dataShape`, `capabilities`, and `mount`/`mountProps`/`toChart`. See `packages/bireactive/src/chart-schemas.ts`. Not a new design problem.
- `intent`: `edit` is the common case — anything mutated (value, config, data, "shit changed"). `reorder` is the special intent singled out because it freezes displayed order during the gesture. Future intents with different freeze/transition semantics get added when they exist, not now. Matches `GestureIntent = "edit" | "reorder"` in the code.
- One draft at a time. No multi-value / simultaneous drafts. `gestureCoordinator.setActive` already enforces one active gesture globally. No observed need for more; do not expand scope.

## Open questions

None.
