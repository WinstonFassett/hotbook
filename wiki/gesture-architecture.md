# Gesture and Editing Architecture for Vizform

Source: `UBIQUITOUS_LANGUAGE.md` and `wiki/interaction-principles.md`.
`interaction-principles.md` is a living constraints document, not gospel; this design doc can expose gaps or conflicts in it.
This document is design only — no code, no file names, no current implementation.

## Core idea

- A `Chart` is a surface with an API. It renders data and exposes gestures, config, and effects.
- The app may provide a `Chart` with a `Kernel`.
- A `Chart` may create and subscribe to a `DataView` and may create an `Editor` if it is editable.
- A `DataView` is keyed by canonical config. The config includes `datasetId`(s) alongside the other dimensions (`measure`, `sortBy`, `depth`, `orientation`, …) — `datasetId` is a config field, not a separate axis. The app registers `Dataset`s with the `Kernel`; a chart's config names the `Dataset`(s) it reads by id, and a chart may read one or several. Two charts share a `DataView` iff their canonical config matches; a difference in *any* field — including `datasetId` — means they do not share.
- `Editor` is a per-Chart state machine for `draft` / `commit` / `cancel` / `updated`.
- `Kernel.Drafts` tracks active `Editor`s and reports the global `Idle` / `Drafting` state.
- The `Chart` attaches `render` and `transition` effects to `Editor` events; the `Editor` does not decide rendering strategy.
- A `Chart` is a component with configuration properties; the design is independent of any particular property set.
- Geometry and presentation logic are separate from the `Chart` consumer. The `Chart` coordinates effects; geometry/presentation modules map coordinates, handle shapes, and rendering.
- Input is decoupled from output: drag handle, drag mark, wheel, keyboard, table cell drag, and programmatic edits are all control surfaces that produce the same value-change intent.

## Chart configuration and schema

- A `Chart` is a component with a configuration schema. The schema declares which properties the chart accepts and how they affect the `DataView` query. The `DataView` query key is the canonical config; `datasetId` is one field in it.
- Common config dimensions: `measure`, `sortBy`, `depth`, `orientation`, `datasetId`. Each chart family exposes the subset it supports. `datasetId` names the `Dataset`(s) the chart reads.
- Config changes are applied to the `DataView` query. The `DataView` publishes an `updated` event. The `Chart` `transition`s to the new state. `transition` is the default response to `updated`; snapping is the exception, reserved for cases where transition is impossible or the chart explicitly chooses it.
- `updated` covers **any** non-gesture change to the chart's data or config — external data change, drill, sort toggle, orientation toggle, measure swap, `depth` change. There is no split between "external data change" and "config change"; both are `updated`, both `transition`.
- If an `Editor` is `Drafting`, an `updated` does not change the `Editor` state. The committed data `transition`s underneath the draft overlay; the draft overlay remains where the user last put it until `commit` or `cancel`.

## Universal input model

Every editing input is normalized into a `draft` event. A `draft` carries:

- `target`: the mark or value being edited.
- `value`: the proposed value.
- `source`: which control surface produced it (handle, mark, wheel, keyboard, table, etc.).
- `intent`: `edit` or `reorder`.
- `frozenOrder` (optional): snapshot of sibling order to freeze during gestures when sort !== 'index'. Used by hierarchical charts (icicle, sunburst) to prevent reordering during value edits.

The `Editor` is the same machine regardless of `source`. The `Chart` receives the `draft` and decides how to render it, based on its family and geometry.

**Value-mapping is overridable.** Each control surface has a default *value-mapping* — how the proposed `value` is derived from the input (e.g. wheel = additive, keyboard = chart-default scaling, boundary knob = two-sibling reapportion). The default is chart-configured, but the chart, host, or caller may override what a given surface does. A host could make wheel do something completely different; the model does not decree per-surface value-mapping. The `intent` is uniform (`edit`); the value-mapping is carried in the `draft`'s `value` and is a per-surface, overridable policy.

## Edits and policies

Gestures propose fractional `value` changes. The chart applies its own policies to the write before it reaches the `Kernel`; the `Kernel` stores whatever it receives. Two policies, both chart-owned:

- **Conservation** (opt-in per chart): the chart's *own* gesture edits preserve a rendered-layout invariant (e.g. `sum(siblings) = parent.total` for an icicle with conservation on). Conservation lives on the chart because the invariant is a property of how the chart renders, not of the data — a `Dataset` doesn't know it's "an icicle." **External edits are not corrected.** A `Table` cell edit or another chart's edit can leave the data in a state that violates this chart's conservation; the chart renders it anyway (partition layouts normalize for display). No correction loop. If you want conservation, edit through a chart that enforces it.
- **Snapping** (per chart + per `Dataset` schema): a chart may snap its own writes to integers; a `Dataset` schema may declare a field integer-valued. The chart's setting governs only its own writes — it does not snap the rest of the `Dataset`. Gestures propose fractional deltas; the chart snaps the write if its policy says to; the `Kernel` stores the result.

The `Kernel` and `Dataset` enforce **no** conservation or snapping policy themselves. They store values; charts and tables project them. Both are projections — neither corrects the other.

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

### Cartesian-continuous

Two continuous axes (x, y). Marks are points or paths positioned by both.
Charts: scatter, line, area.

- `draft`: resize the edited mark and scale the matching axis/domain to fit the preview value; keep siblings frozen. The axis domain is **dynamic** — it grows/shrinks to contain the preview so the mark never overflows (interaction-principles "No overflow"). Sibling marks hold their positions; only the edited mark and its axis move.
- `commit`: recompute sort if applicable, then `transition` marks to new positions. The axis/domain settles to fit the committed values.
- `cancel`: `transition` back to the snapshot (mark positions + axis domain).
- `updated`: `transition` committed data to the new state; keep the draft overlay if `Drafting`. Enter/exit lifecycle on every rendered-set change (data add/remove, filter, config toggle that changes the rendered set).

### Cartesian-discrete

One continuous axis (value) + one discrete axis (category/time). Marks are bars or spans positioned by category on the discrete axis and sized by value on the continuous axis.
Charts: bar, gantt.

- `draft`: resize the edited mark along the continuous (value) axis and scale that axis/domain to fit the preview value. The **discrete axis is fixed** — categories are slots, not a scalable domain; they don't grow or shrink to fit a preview. Sibling marks hold their slot positions; only the edited mark's height/width and the continuous axis change. **Exception:** charts with a space-conservation constraint (gantt) may **push** siblings during `draft` when the edited mark would overlap them; the push is reactive and reversible (drag back → neighbors return). This is a geometric necessity (tasks can't overlap), not a sibling-freeze violation.
- `commit`: recompute sort (which may reorder the discrete slots), then `transition` marks to new positions. The discrete axis re-orders if sort changed; the continuous axis settles to fit committed values.
- `cancel`: `transition` back to the snapshot (mark sizes + slot order + continuous axis).
- `updated`: `transition` committed data to the new state; keep the draft overlay if `Drafting`. Enter/exit lifecycle on every rendered-set change (category add/remove, filter, time-range change in gantt). Sort toggle re-orders the discrete axis with a `transition`.
- **Reorder** (opt-in per chart, via `canReorder` when `sortBy === 'index'`): drag a mark along the discrete axis to reorder it among siblings. `intent: reorder`; no value change. The universal `reorder` intent (see "Universal input model") covers it; the contract notes it here because it's a capability addition specific to Cartesian-discrete.

### Radial

Two sub-patterns, both radial geometry:

**Fixed-total** (pie, donut): arcs tile a shared 360°; conservation is **inherent by geometry** (not the opt-in `Conservation` setting from `UBIQUITOUS_LANGUAGE.md`).
- `draft`: rebalance the edited arc and its siblings; the total is fixed. Sibling angular positions adjust because the partition normalizes (inherent to the coordinate, not a sibling-freeze violation).
- `commit`: recompute sort, then `transition` arcs to new angular positions.
- `cancel`: `transition` back to the snapshot.
- `updated`: `transition` committed data. Enter/exit on rendered-set change (slice add/remove).

**Independent-track** (concentric-arc, gauge, gauge-segmented, radar): each arc/point is an independent value on its own track/spoke; **no inherent conservation**, no sibling relationship.
- `draft`: the edited arc/point reflects its new value live; siblings are **frozen** (independent — no shared total). The radial domain (gauge/radar max) may scale to contain the preview (no overflow), like a continuous axis but radial.
- `commit`: `transition` the edited arc/point to its committed position; siblings stay.
- `cancel`: `transition` back to the snapshot.
- `updated`: `transition` committed data. Enter/exit on rendered-set change (ring/category add/remove).

### Hierarchical

- `draft`: the edited node reflects its new value live; **sibling positions are frozen** at their pre-gesture state; no relayout *transition* runs until `commit` (rule 8). The layout may be recomputed internally — what's deferred is *applying* sibling repositioning, not the computation itself. Two mechanism variants, both satisfying this invariant (interaction-principles §"Hierarchical marks"):
  - *Subtree-patch* (icicle, sunburst): patch the edited node's span inside the saved parent bounds; do not relayout siblings.
  - *Scale-against-frozen-siblings* (treemap, pack): the full layout re-derives reactively as the value writes through, but sibling repositioning is suppressed while `Drafting`; only the edited mark moves. Children of the edited node may be faded or hidden (chart-specific option).
- `commit`: recompute the subtree (or the full layout for treemap/pack), then `transition` nodes to their new positions. Animate drill/level changes if needed.
- `cancel`: `transition` back to the snapshot layout.
- `updated`: `transition` committed data. Drill and config toggles are `updated` and `transition`.

### Network/Flow

- `draft`: update node or link values; **enforce flow conservation (in=out at every node) by propagation on every edit** — scale the unbalanced side to match the changed side, cascade to neighbors, terminating at sources and sinks. The propagation is visible to the user (the cascade ripples through the graph as they drag). Not "where possible" — always enforced. The propagation is not a value-mapping (it's conservation enforcement); value-mapping is overridable, propagation is not.
- `commit`: recompute the layout, then `transition` links and nodes to final positions/widths. Snapshot is graph-wide (propagation touches many links).
- `cancel`: `transition` back to the snapshot (all link values + node heights).
- `updated`: `transition` committed data. Enter/exit on rendered-set change (link/node add/remove via filter).

### Table

- The `Table` is a `Chart` family. It can be livebound alongside any other chart by sharing the same `DataView` and `Kernel`.
- `draft`: update the cell value and publish it through the `DataView` so linked `Chart`s (e.g., an icicle) render the draft preview. **Value-mapping: absolute-set** (the typed value is the target, not a delta) — distinct from the delta-based mappings (additive, proportional) of spatial charts. Number-drag on a cell is additive.
- `commit`: finalize the value through the `DataView`. The `Editor` returns to `Idle`; linked `Chart`s run their `transition` effect. The table's own `commit` has **no spatial `transition`** (a cell is a text value, not a moving mark) — the `transition` happens on linked charts, not the table. This is the one family where `commit` is a data event, not a visual transition.
- `cancel`: revert the cell.
- `updated`: reflect external changes while preserving any draft overlay. Enter/exit on row add/remove (fade in/out).
- The table supports tree rows with expand/collapse (treetable). It is a separate view of the same hierarchical data; it does not need its own layout geometry beyond row rendering.

## Plan

1. Lock the `Editor` / `Kernel.Drafts` contract and state machine.
2. Define the family effect contracts (this document).
3. Implement the `Editor` and `Kernel.Drafts` as a shared, decoupled service.
4. Validate with a temporary hierarchical harness, starting with the icicle chart.
5. Once icicle is solid, extend to the other three interactive hierarchical charts: sunburst, treemap, and pack.
6. After the hierarchical family is proven, extend to Cartesian-continuous, Cartesian-discrete, Radial, Network/Flow, and Table.
7. Update the acceptance test checklist per family as it is migrated.

## Resolved

- `Editor` is per-`Chart`; `DataView` and `Editor` are optional. A livebound `Table` and `Chart` are two `Chart` surfaces; they may share a `DataView` or each use their own.
- `Table` is a `Chart` family.
- If external `updated` changes the same value being drafted, the draft overlay stays. UBIQUITOUS already answers this.
- `Kernel.Drafts` exposes a **list of active `Editor`s**. No boolean. Derived values (`Idle`/`Drafting`, count, etc.) are computed from the list — we solve derivation later, it is not the hard part. No information hiding: the list is the truth, derived flags are projections.
- Config schema: a `ChartSchema` descriptor with a valibot runtime `config` schema, `ui.fields` picker descriptors, `dataShape`, `capabilities`, and `mount`/`mountProps`/`toChart`. Not a new design problem — the schema descriptor pattern is settled; where it lives (bireactive public export, local, or patch) is TBD.
- `intent`: `edit` is the common case — anything mutated (value, config, data, "shit changed"). `reorder` is the special intent singled out because it freezes displayed order during the gesture. Future intents with different freeze/transition semantics get added when they exist, not now.
- One draft at a time. No multi-value / simultaneous drafts. `gestureCoordinator.setActive` already enforces one active gesture globally. No observed need for more; do not expand scope.

## Implementation invariants

These are non-negotiable correctness requirements for chart implementations. Violations will break multi-instance usage, cross-chart sync, or memory safety.

### Disposer discipline

Any function returning a dispose/cleanup function MUST be caught and disposed on unmount or re-attach. This includes:
- Reactive effect subscriptions (`effect`, `derive` with a returned cleanup, `watch`)
- Event listener attachments that return a removal function
- Timer/animation frame handles wrapped as disposers
- Manual cleanup closures

**Pattern:** Maintain a `Set<Disposer>` on the owning object. On every call that returns a disposer, add it to the set. On unmount/cleanup, iterate the set and call each disposer.

**Verification:** Grep the diff for callers that discard the return value of known-disposer-returning functions. Any `const x = fn()` where `fn` is known to return a disposer but `x` is not captured into a disposal set is a leak.

### Reactive-source ordering

Every `derive()` call MUST depend ONLY on cells (reactive primitives), NOT on side-effect-populated data structures like `Map` or `Array` filled via `forEach` or imperative loops.

**Wrong:**
```javascript
const map = new Map()
data.forEach(d => map.set(d.id, compute(d)))  // side effect
const result = derive(() => map.get(someId))  // reads stale map
```

**Right:**
```javascript
const mapCell = cell(new Map())
effect(() => {
  const map = new Map()
  data.forEach(d => map.set(d.id, compute(d)))
  mapCell.set(map)  // reactive write
})
const result = derive(() => mapCell.get().get(someId))  // reads reactive map
```

The `derive()` sees the populated map only after the effect runs. A `derive()` that reads a plain `Map` will execute before any `forEach` that populates it, producing stale or empty results.

**Verification:** Any `derive()` that closes over a `Map`, `Set`, or `Array` that is mutated elsewhere (via `set()`, `push()`, `forEach`) is suspect. The structure must be wrapped in a cell and written atomically.

### Drill and hover structural contracts

Every hierarchical chart implementation MUST:

1. **Accept `drillId` in its visibility/windowing computation.** The rendered set must respect the drill channel. A chart that ignores `drillId` will not respond to drill events from other charts.

2. **Call `setHover(nodeId)` on row/tile enter and `setHover(null)` on leave.** Hover state is cross-chart; failing to emit it breaks hover sync.

**Verification (drill):** Find the function that computes the visible node set. It must accept `drillId` (or the chart's drill-focus cell) and filter/window the tree accordingly.

**Verification (hover):** Find the tile/row `pointerenter` and `pointerleave` handlers. They must call the chart's hover setter (which routes to the shared hover channel).

### Multi-instance ID hygiene

Charts rendered as custom elements may be instantiated multiple times on the same page. **No `id`, `clipPath` id, `<pattern>` id, `<use xlink:href>`, or any other document-scoped identifier may be bare (instance-independent).**

**Wrong:**
```javascript
<clipPath id="tile-clip-tech">  <!-- collides across instances -->
<use xlink:href="#tile-clip-tech"/>
```

**Right:**
```javascript
<clipPath id={`tile-clip-tech-${instanceId}`}>
<use xlink:href={`#tile-clip-tech-${instanceId}`}/>
```

The base class provides a protected `instanceId` (a short unique string per chart instance). Every generated `id` and every `xlink:href` / `url(#...)` reference MUST incorporate it.

**Verification:** Grep the chart implementation for string literals containing `id="` or `id=\``, `clipPath id`, `<pattern id`, `<use xlink:href`, or `url(#`. Every match must incorporate the instance uid. Bare IDs are bugs.

**Consequence of violation:** The second instance of the chart on the page will reference the first instance's `<defs>`, clipping or rendering to the wrong geometry and producing invisible or misplaced marks.

## Open questions

- **Per-surface value-mapping vocabulary.** Each `edit` control surface has its own value-mapping (`additive`, `proportional-neighbor`, `proportional-siblings`, two-sibling reapportion). The override statement (above) makes them per-surface policy, not model vocabulary. If a future cross-tile consumer needs to reason about value-mapping at the model level, promote them to `UBIQUITOUS_LANGUAGE.md`. Open; not blocking.
