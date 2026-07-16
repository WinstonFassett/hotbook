# Spec — Gantt

Delta spec for the gantt `Chart`. Gantt is in the Cartesian-discrete family with bar — every model-level claim in `wiki/specs/bar.md` carries over. This document lists **only the divergences**. The family contract is `wiki/gesture-architecture.md` §"Cartesian-discrete".

## Divergences from bar

### §1 Geometry
- Marks are **spans** (rectangles with a start and end on the continuous axis), not single-value bars. The continuous axis is **time** (a date/time domain, not a numeric value domain). The discrete axis is **tasks** (categories, same as bar's category slots).
- A gantt bar has **two value edits**: start and end. This is the headline divergence from bar (one value per bar).

### §2 DataView query
- Same key shape as bar. `datasetId` names a `flat` `Dataset` (one row per task, with `start` and `end` fields). Config dimensions: `sortBy` (`index` or `value` — value = duration), `canReorder`, `snap` (optional).
- No `orientation` (gantt is always horizontal — time on x, tasks on y).
- `measure` is replaced by the start/end pair — the "value" being edited is either `start`, `end`, or both, depending on which handle is dragged.

### §3 / §4 Control surfaces and intent
- **Drag bar body — shift.** Dragging the body of a gantt bar shifts both start and end by the same delta (the bar translates along the time axis). **Space conservation:** shifting into an adjacent task pushes that task (and cascading tasks) to make room; on drag reverse, tasks return to origin. This is a **bidirectional push** — the edited task's duration is preserved; adjacent tasks shift their start/end to avoid overlap. `intent: edit`. Value-mapping: shift (start+end move together, neighbors push).
- **Drag left handle — move start.** Dragging the left handle changes only the start; the end is fixed. Duration changes. **Additive** (only this task's start changes; no sibling redistribution unless the start crosses an adjacent task, which triggers push). `intent: edit`.
- **Drag right handle — move end.** Dragging the right handle changes only the end; the start is fixed. Duration changes. **Additive** (same; push on collision). `intent: edit`.
- **Wheel — bar.** Cmd/Ctrl+wheel over a bar scales... which value? **Design decision needed** (see open questions below). Options: scale duration (end moves), scale start, or scale both. Default proposal: scale end (duration grows/shrinks). `intent: edit`.
- **Keyboard — focused bar.** Arrow keys edit the focused bar. Which value? Same question as wheel. Default proposal: arrow left/right shift (start+end together); arrow up/down nav between tasks. `intent: edit`.
- **Drag mark — reorder.** When `canReorder` and `sortBy === 'index'`, dragging a bar up/down reorders tasks on the discrete axis. `intent: reorder`. Same as bar.
- **Cross-tile.** Source-defined value-mapping. `intent: edit`.

### §5 Effects
- **`draft` (`edit`):** the edited bar reflects its new start/end live; the **time axis domain scales dynamically** to contain the preview (no overflow — same as bar's continuous-axis scaling). **Space conservation during `draft`:** when a shifted/resized bar would overlap an adjacent task, the adjacent task is pushed (its start/end shifts reactively to make room). Pushed tasks are **not frozen** — they move during `draft` (this is a gantt-specific exception to the "siblings frozen" rule, justified by the geometry: tasks can't overlap, so a shift *must* displace neighbors in real time). The push is reversible (drag back → neighbors return). No `transition` during the gesture (rule 8); pushes are reactive.
- **`draft` (`reorder`):** same as bar — dragged bar follows pointer along the discrete axis; siblings slide to provisional slots.
- **`commit` / `cancel` / `updated`:** same as bar §5, with enter/exit lifecycle on rendered-set changes (task add/remove, filter, time-range change). The time axis settles to fit committed values. `sortBy` toggle re-orders the discrete axis with a `transition`.

### §6 Family-contract gaps

1. **Space conservation (push) during `draft` breaks "siblings frozen."** The Cartesian-discrete contract says "sibling marks hold their slot positions" during `draft`. Gantt's shift gesture *must* push neighbors (tasks can't overlap) — siblings are **not** frozen during a shift. This is a justified exception (geometric necessity, not a model bug), but the contract should acknowledge it: "Cartesian-discrete charts with a space-conservation constraint (gantt) may push siblings during `draft` when the edited mark would overlap them; the push is reactive and reversible." Proposed contract amendment.

2. **Two value edits per mark (start + end).** The contract assumes one value per mark. Gantt has two (start, end) plus a derived third (duration). The `draft`'s `target`/`value` pair needs to carry *which* value is being edited. This is already handled by the universal input model (`target` identifies the mark; `value` carries the proposed value) — but the model should note that a mark can have multiple editable values, and the `draft` names which one. Not a gap in the state machine; a note in the contract.

3. **Wheel/keyboard default value.** Which of start/end/duration does wheel/keyboard edit? Open question (below).

## Summary

Gantt = bar with a time axis and two value edits (start + end) instead of one. Three drag surfaces: body (shift start+end with push), left handle (move start), right handle (move end). Space conservation during `draft` pushes neighbors (justified exception to "siblings frozen"). No orientation. Reorder same as bar. Two contract amendments proposed: (1) acknowledge push-during-draft for space-conserved charts; (2) note that a mark can have multiple editable values. One open question: wheel/keyboard default value (start vs end vs duration vs shift).
