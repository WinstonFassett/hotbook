# Spec — Sankey

Reference spec for the Network/Flow family. The family contract is `wiki/gesture-architecture.md` §"Network/Flow".

Vocabulary: `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. `interaction-principles.md` is the living constraints doc. Design only — no code, no file names, no current implementation.

## 1. What is this chart?

A Sankey diagram: nodes (vertical bars) in columns, connected by flow ribbons (links) whose width is proportional to the link's value. **Flow conservation holds at every node**: `sum(incoming) = sum(outgoing)`. The structure (which nodes connect to which) is fixed; the values (link widths) are editable. Editing one link's value triggers a **propagation** through the graph to restore conservation at every affected node — backward to sources, forward to sinks.

- **Family:** Network/Flow.
- **Editable:** yes. Creates an `Editor`, registers with `Kernel.Drafts`.
- **Conservation:** inherent (flow conservation: in=out at every node). Not opt-in — it's the chart's defining invariant, enforced by propagation on every edit. This is the **third kind of conservation** in the model: hierarchical (sum(children)=parent.total, opt-in), radial-fixed-total (sum(slices)=360°, inherent by geometry), and **flow conservation (in=out at every node, inherent by propagation)**.
- **DataView query:** canonical config. `datasetId` names **two `Dataset`s** — a nodes dataset and an edges/links dataset (`dataShape: graph`). This is the multi-dataset case the model allows (a chart may read one or several datasets). Config dimensions: `measure` (link value binding), `snap` (optional).

## 2. What `DataView` query does it subscribe?

Canonical config. `datasetId` names two `Dataset`s (nodes + edges); the `Dataset`s' `dataShape` is `graph`. Config dimensions:
- `measure` — value binding driving link/ribbon widths.
- `snap` — optional chart snap-on-edit setting.

A livebound `Table` (on the edges) on the same canonical config shares this `DataView`. The nodes dataset is read-only from the chart's perspective (structure is fixed; only link values are editable).

## 3. Does it create an `Editor`?

Yes. Control surfaces that produce `draft` events. All produce `intent: edit`; each has its own value-mapping:

- **Drag handle — link.** A draggable handle sits on each link (or on a representative handle for a group of links). Dragging changes the link's value. **Conservation propagation:** the change cascades through the graph — backward (scale incoming links at the node whose outgoing changed, then cascade to predecessors) and forward (scale outgoing links at the node whose incoming changed, then cascade to successors). Propagation terminates at sources (no incoming) and sinks (no outgoing). The value-mapping is **link-edit-with-propagation** — the edited link changes by the drag delta; conservation is restored by scaling the unbalanced side. `intent: edit`.
- **Drag handle — scale (hub/collector).** A special handle that scales all branches proportionally. **Proportional-multi-link** — a set of links scales together by the drag fraction. `intent: edit`.
- **Drag handle — recirculation.** A handle that adjusts a recirculation loop; the input absorbs the remainder. **Residual-absorb** — the edited link changes, and a designated link absorbs the residual to maintain conservation. `intent: edit`.
- **Wheel — link.** Cmd/Ctrl+wheel over a link scales its value. **Additive on the target link**, then **propagation** restores conservation. Dynamic step. `intent: edit`.
- **Keyboard — focused link.** Arrow keys edit the focused link's value. **Additive** by default, then propagation. Alt → proportional (N/A in the usual sense — conservation is already inherent; Alt could adjust the propagation strategy, but that's a design question). `intent: edit`.
- **Programmatic — cross-tile.** A livebound `Table` on the edges publishes `draft` events; the sankey renders the draft preview **with propagation**. Source-defined value-mapping. `intent: edit`.

**No reorder gesture.** The node structure (columns, ordering) is fixed; reordering nodes would change the topology, which is out of scope for gesture edits. No boundary knob.

## 4. What `intent` does each control surface produce?

All `edit`. The sankey has no `reorder` intent. Value-mappings: link-handle = link-edit-with-propagation; scale-handle = proportional-multi-link; recirculation-handle = residual-absorb; wheel = additive-then-propagate; keyboard = additive-then-propagate; cross-tile = source-defined-then-propagate. The propagation is **not** a value-mapping — it's a **conservation enforcement step** that runs after every edit, regardless of the source's value-mapping. Value-mapping is overridable; propagation is not (it's the chart's inherent conservation).

## 5. What `render` / `transition` effects are attached to each `Editor` event?

Per the Network/Flow family effect contract:

- **`draft` (`edit`):** the edited link's width reflects its new value live; **conservation propagation runs reactively** — affected links scale to restore in=out at every touched node. The chart re-derives the layout (link paths, node heights) reactively as values churn. No `transition` during the gesture (rule 8); links and nodes move reactively. The propagation is visible to the user (they see the cascade ripple through the graph as they drag).
- **`commit`:** recompute the layout with committed values, then `transition` links and nodes to their final positions/widths. Post-commit transition is chart-owned, interruptible, disposable (rule 13); `Editor` is `Idle` at `commit`. No settling state.
- **`cancel`:** `transition` back to the snapshot (all link widths + node heights — the snapshot captures the full set because propagation touched many links).
- **`updated`:** `transition` to the new committed state, with **enter/exit lifecycle on every rendered-set change** (link add/remove, node add/remove — though structure is typically fixed, a filter could hide links). Covers external data change, filter, config toggle (`measure` swap → all link widths re-derive and `transition`). While `Drafting`, transitions the committed data underneath the draft overlay.

### Snapshot scope

Because propagation touches many links (not just the edited one), the gesture snapshot must capture **all link values**, not just the target. Esc-revert restores the entire graph to its pre-gesture state. This is a wider snapshot than Hierarchical (target + siblings) or Cartesian (target only).

## 6. What does this chart do that the family contract does not cover?

**One: the contract says "preserve flow constraints where possible."** That's underspecified. Sankey's conservation is **not** "where possible" — it's **always enforced, by propagation, on every edit**. The contract should say: "Network/Flow charts with flow conservation enforce in=out at every node by propagation on every edit; the propagation scales the unbalanced side and cascades to neighbors, terminating at sources and sinks." Proposed contract amendment.

**Two: multi-dataset query.** Sankey reads two `Dataset`s (nodes + edges). The model allows this (a chart may read one or several), but the family contract doesn't mention it. Not a gap in the model — just a note that Network/Flow is the typical multi-dataset case.

**Three: snapshot scope.** The contract doesn't address snapshot scope; sankey's is graph-wide (all links), not per-target. This is a chart-specific implementation detail, not a model-level gap, but worth noting.

## Summary

Sankey is the reference for Network/Flow: nodes + links, flow conservation (in=out) enforced by propagation on every edit. Three drag-handle variants (link, scale, recirculation) with distinct value-mappings; wheel and keyboard are additive-then-propagate. Multi-dataset (nodes + edges). Snapshot is graph-wide (propagation touches many links). No reorder. The contract's "preserve flow constraints where possible" should be sharpened to "enforce in=out by propagation on every edit." Enter/exit on `updated` rendered-set changes.
