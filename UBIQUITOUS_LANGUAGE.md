# Ubiquitous Language

Vocabulary for the vizform/hotbook gesture and data-flow architecture.

## Principles

- `Chart` is a first-class consumer. The app provides it a `Kernel`; it connects itself to a `DataView` and `Kernel.Drafts` and controls its own rendering.
- This is fine-grained reactivity, not React top-down rendering. The `Chart` reacts directly to `DataView` updates.
- There are two layers: `Logical machines` are state machines; `Effects` are chart-specific handlers that the `Chart` attaches to machine events. Machines are agnostic to effects.

## Core system

| Term | Definition |
| --- | --- |
| **Chart** | The visual component that renders data. The app provides it a `Kernel`. It connects itself to a `DataView` and `Kernel.Drafts` and may create an `Editor` if it supports interactive editing. |
| **Kernel** | The central data service, often typed as `DataKernel` or `UpdatableDataKernel`. The app registers `Dataset`s with it and provides it to `Chart`s. It owns the canonical `Dataset`s by id, publishes data updates, brokers `DataView`s keyed by canonical config, and tracks active `Editor`s via `Kernel.Drafts`. |
| **Dataset** | An identified, addressable data source the `Kernel` owns. Has an `id` and a `dataShape` (`flat` / `hierarchical` / `graph`). The app registers `Dataset`s with the `Kernel`. A chart's config names the `Dataset`(s) it reads by id; a chart may read one or several (e.g. a sankey reads nodes and edges). A chart's `ChartSchema.dataShape` must match each `Dataset` it queries. |
| **DataView** | The chart's subscription into the `Kernel`, similar to TanStack Query. **Keyed by canonical config** — a canonical key derived from the chart's config, which includes `datasetId`(s) alongside `measure`, `sortBy`, `depth`, `orientation`, etc. (`datasetId` is a config field, not a separate axis.) Attaches on mount, detaches on dismount, routes relevant `Kernel` events to the `Chart`. Two charts with the same canonical config share a `DataView` (e.g. a livebound `Table` and an icicle); two charts whose config differs in *any* field — including `datasetId` — do not share. |
| **Editor** | Per-chart state machine for `draft`/`commit`/`cancel`/`updated`. Only editable charts have one. |
| **Kernel.Drafts** | The part of `Kernel` that tracks active `Editor`s and reports the global drafting state. |
| **BaseChart** | Base class for interactive charts. It may create an `Editor`. Subclasses — `BaseCartesianContinuousChart`, `BaseCartesianDiscreteChart`, `BaseRadialChart`, `BaseHierarchicalChart`, `BaseNetworkChart`, `BaseTableChart` — wire common editor effects. See `docs/adr/gesture-state-machine.md` for the family effect contracts. |
| **Conservation** | A per-chart setting (opt-in) that governs the chart's *own* gesture edits: when on, the chart's gestures preserve an invariant of the rendered layout (e.g. icicle/sunburst boundary knob preserves `sum(siblings) = parent.total`; pack Alt+keyboard redistributes across all siblings). Conservation lives on the chart, not the `Dataset` or `Kernel` — the invariant is a property of how a chart renders, not of the data. External edits (a `Table` cell, another chart) are **not corrected** by a chart with conservation on; the chart renders whatever values it receives (partition layouts normalize for display, so a broken sum still renders). If you want conservation, edit *through* a chart that enforces it. |
| **Snapping** | Whether edited values round to integers. Two homes, both legitimate: (1) a `Dataset`'s schema may declare a field integer-valued (a property of the data); (2) a chart may have a snap-on-edit setting (a property of the editing surface). The chart's setting governs only the chart's *own* writes — it snaps the value it is writing; it does **not** reach back and snap the rest of the `Dataset`. They compose: chart snap-on + integer dataset → snaps; chart snap-off + continuous dataset → fractional; chart snap-on + continuous dataset → snaps only what that chart writes (the dataset stays mixed). Gestures propose fractional deltas; the chart applies its snap policy to the write; the `Kernel` stores whatever it receives. |
| **Order freezing** | For hierarchical charts (icicle, sunburst) when sort !== 'index': during a gesture, the chart snapshots the current sibling order at every level and uses that frozen order for rendering instead of the config's sort policy. This prevents reordering during value edits. The frozen order is cleared on commit/cancel. Icicle/sunburst use full re-render with order freezing; circle pack/treemap use ghost overlays. |

## Draft lifecycle

| Term | Definition |
| --- | --- |
| **draft** | A speculative value or event that starts or updates a pending change. |
| **committed** | The stored, non-speculative data value. |
| **commit** | Finalize the current `draft` and move it to `committed`. |
| **cancel** | Discard the current `draft` and revert to the committed baseline. |
| **updated** | Any non-gesture change to the chart's data or config while the `Editor` is `Idle` or `Drafting` — external data change, drill, sort/orientation/measure/depth toggle, etc. The `Chart` `transition`s to the new state; snapping is the exception. |

## Effects

Effects are attached to machine events by the `Chart`. They are where the actual rendering (CSS, D3, etc.) happens.

| Term | Definition |
| --- | --- |
| **transition** | An effect that performs an autonomous animation to a new layout, including entry/exit/update transitions. |
| **render** | An effect that performs an immediate re-render to a new layout. |

## Logical machines

### Editor

```
Editor
  Idle:
    draft -> Drafting
    updated -> Idle
  Drafting:
    draft -> Drafting
    commit -> Idle
    cancel -> Idle
    updated -> Drafting
```

- `draft` starts or updates a draft.
- `commit` and `cancel` return to `Idle`.
- `updated` is any non-gesture data or config change (external data change, drill, sort/orientation/measure/depth toggle, etc.); it does not change `Editor` state. The `Chart` `transition`s to the new state by default; snapping is the exception.
- The `Chart` attaches `transition`/`render` effects to these events.

## Relationships

- The app provides a `Kernel` to a `Chart`.
- A `Chart` is a first-class consumer of `Kernel` data and controls its own rendering.
- A `Chart` connects itself to a `DataView` and may create an `Editor` if it supports interactive editing.
- A `Chart` that creates an `Editor` registers it with `Kernel.Drafts`.
- A `Kernel` owns registered `Dataset`s (by id) and publishes data updates. The app registers `Dataset`s with the `Kernel` and provides the `Kernel` to `Chart`s.
- `Kernel.Drafts` tracks active `Editor`s and reports a global `Idle`/`Drafting` state.
- `commit` and `cancel` are the only transitions out of `Drafting`.
- `updated` does not change `Editor` state.
- `Chart`s attach `transition`/`render` effects to `Editor` events and implement the actual CSS/D3/transition logic.

## Example dialogue

> **Dev:** "When the user drags a bar, the `Chart` calls `editor.draft(info)`?"
>
> **Designer:** "Yes, if the `Chart` is interactive. The app has provided a `Kernel`, and the `Chart` has connected itself to a `DataView` and `Kernel.Drafts`. If the `Editor` is `Idle`, it transitions to `Drafting`. If it's already `Drafting`, it just updates the draft. The `Chart` attaches a `render` effect to render the draft preview."
>
> **Dev:** "And when the user releases?"
>
> **Designer:** "The `Chart` calls `editor.commit()`. The `Editor` goes back to `Idle` and the `Chart` attaches a `transition` effect to animate the committed layout, or a `render` effect to snap it."
>
> **Dev:** "What if the data changes in the file system while the user is still dragging?"
>
> **Designer:** "The `Kernel` publishes an `updated` event through the `DataView`. The `Editor` stays `Drafting` and the `Chart` `transition`s the committed data to its new state underneath the draft, but it does **not** reapply the draft. The draft overlay stays as the user last set it until they `commit` or `cancel`."
>
> **Dev:** "For hierarchical charts like icicle, how do we prevent reordering during gestures when sorted by value?"
>
> **Designer:** "The chart captures the current sibling order at every level when the gesture starts (order freezing). During the gesture, it uses this frozen order for rendering instead of the config's sort policy. The frozen order is cleared on commit/cancel. Icicle/sunburst do full re-render with order freezing; circle pack/treemap use ghost overlays."
