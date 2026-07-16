# Spec — Gauge

Delta spec for the gauge `Chart`. Gauge is in the Radial family — independent-track sub-pattern with concentric-arc. Every model-level claim in `wiki/specs/pie.md` and `wiki/specs/concentric-arc.md` carries over. This document lists **only the divergences**. The family contract is `wiki/gesture-architecture.md` §"Radial".

## Divergences from pie / concentric-arc

### §1 Geometry
- **Single arc** (not multiple rings, not multiple slices). A 270° sweep with a draggable endpoint and a center number readout. The arc fills from a start angle to the endpoint; the endpoint's angle represents the value.
- **min/max domain.** The value maps to a `[min, max]` range; the endpoint sits at `value → angle` within the 270° sweep. This is a bounded single-value chart, not a set of siblings.

### §2 DataView query
- `datasetId` names a `flat` `Dataset` with a single row (one value, one min, one max). Config: `measure` (value binding), `snap` (optional). No `sortBy` (one value).

### §3 / §4 Control surfaces and intent
- **Drag endpoint.** Dragging the arc endpoint scrubs the value (endpoint moves along the 270° sweep). **Additive** (only this value changes; there are no siblings). Primary edit surface. `intent: edit`.
- **Number-drag — center readout.** Dragging the center number display horizontally scrubs the value (same number-drag primitive as treemap/pack drag-mark-resize). **Additive**. `intent: edit`.
- **Wheel — arc.** Cmd/Ctrl+wheel scales the value. **Additive**; dynamic step. `intent: edit`.
- **Keyboard — focused gauge.** Arrow up/down edits the value. **Additive** (no siblings, no conservation). `intent: edit`.
- **Cross-tile.** Source-defined. `intent: edit`.
- No boundary knob, no reorder. All `edit`.

### §5 Effects
- **`draft` (`edit`):** the endpoint and the center readout reflect the new value live. No siblings (single value). The arc fills/empties reactively. No `transition` during the gesture. The value is clamped to `[min, max]` — a chart-specific constraint (the endpoint can't drag past the 270° sweep bounds).
- **`commit` / `cancel` / `updated`:** `transition` the endpoint and readout to the committed/cancelled/updated value. Enter/exit is N/A (single value; no rendered-set changes unless the gauge itself is mounted/dismounted).

### §6 Family-contract gaps
None beyond concentric-arc's independent-track amendment (which gauge is an instance of). Gauge is the simplest independent-track radial: one arc, one value, min/max bounds. No additional gaps.

## Summary

Gauge = the simplest independent-track radial: one 270° arc, one value, min/max domain. Two drag surfaces (endpoint + center number-drag), wheel, keyboard. No siblings, no conservation, no reorder. Value clamped to [min, max]. Concentric-arc's independent-track contract amendment covers it.
