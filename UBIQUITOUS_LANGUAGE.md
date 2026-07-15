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
| **Kernel** | The central data service, often typed as `DataKernel` or `UpdatableDataKernel`. The app subscribes data sources to it and provides it to `Chart`s. It publishes data updates, brokers `DataView`s, and tracks active `Editor`s via `Kernel.Drafts`. |
| **DataView** | The chart's query-keyed subscription into the `Kernel`, similar to TanStack Query. It attaches on mount, detaches on dismount, and routes relevant `Kernel` events to the `Chart`. |
| **Editor** | Per-chart state machine for `draft`/`commit`/`cancel`/`updated`. Only editable charts have one. |
| **Kernel.Drafts** | The part of `Kernel` that tracks active `Editor`s and reports the global drafting state. |
| **BaseChart** | Base class for interactive charts. It may create an `Editor`. Subclasses like `BaseCartesianChart` and `BaseHierarchicalChart` wire common editor effects. |

## Draft lifecycle

| Term | Definition |
| --- | --- |
| **draft** | A speculative value or event that starts or updates a pending change. |
| **committed** | The stored, non-speculative data value. |
| **commit** | Finalize the current `draft` and move it to `committed`. |
| **cancel** | Discard the current `draft` and revert to the committed baseline. |
| **updated** | External data changed while the `Editor` is `Idle` or `Drafting`. |

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
- `updated` is an external data change; it does not change `Editor` state.
- The `Chart` attaches `transition`/`render` effects to these events.

## Relationships

- The app provides a `Kernel` to a `Chart`.
- A `Chart` is a first-class consumer of `Kernel` data and controls its own rendering.
- A `Chart` connects itself to a `DataView` and may create an `Editor` if it supports interactive editing.
- A `Chart` that creates an `Editor` registers it with `Kernel.Drafts`.
- A `Kernel` is subscribed to data sources by the app and publishes data updates.
- `Kernel.Drafts` tracks active `Editor`s and reports a global `Idle`/`Drafting` state.
- `commit` and `cancel` are the only transitions out of `Drafting`.
- `updated` does not change `Editor` state.
- `Chart`s attach `transition`/`render` effects to `Editor` events and implement the actual CSS/D3/transition logic.

## Example dialogue

> **Dev:** "When the user drags a bar, the `Chart` calls `editor.draft(info)`?"
>
> **Designer:** "Yes, if the `Chart` is interactive. The app has provided a `Kernel`, and the `Chart` has connected itself to a `DataView` and `Kernel.Drafts`. If the `Editor` is `Idle`, it transitions to `Drafting`. If it's already `Drafting`, it just updates the draft. The `Chart` attaches a `render` effect to render the draft preview without reordering."
>
> **Dev:** "And when the user releases?"
>
> **Designer:** "The `Chart` calls `editor.commit()`. The `Editor` goes back to `Idle` and the `Chart` attaches a `transition` effect to animate the committed layout, or a `render` effect to snap it."
>
> **Dev:** "What if the data changes in the file system while the user is still dragging?"
>
> **Designer:** "The `Kernel` publishes an `updated` event through the `DataView`. The `Editor` stays `Drafting` and the `Chart` re-renders the committed data, but it does **not** reapply the draft. The draft overlay stays as the user last set it until they `commit` or `cancel`."
