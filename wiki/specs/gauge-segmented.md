# Spec — Gauge Segmented

Delta spec for the gauge-segmented `Chart`. Gauge-segmented is gauge with discrete segments — every model-level claim in `wiki/specs/gauge.md` carries over. This document lists **only the divergences**.

## Divergences from gauge

### §1 Geometry
- Same 270° sweep as gauge, but rendered as **N discrete arc segments** that "light up" as the value crosses each segment boundary (battery/capacity-meter idiom). The endpoint isn't a single arc tip — it's the boundary between lit and unlit segments.
- `segments` is a config dimension (integer, typically 2–24). The value maps to `floor(value/maxValue × N)` lit segments.

### §2 DataView query
- Same as gauge + `segments` (integer config). `datasetId` names a `flat` `Dataset` with one row. Config: `measure`, `segments`, `snap` (optional — and snapping is arguably **inherent** here: the displayed state is discrete segments, so the value quantizes to segment boundaries for display; the underlying data can stay continuous).

### §3 / §4 Control surfaces and intent
- **Same as gauge §3/§4.** Drag endpoint, number-drag center, wheel, keyboard. All `edit`, all additive. The difference is **visual quantization**: during `draft`, the edited value is continuous (the endpoint/number-drag scrubs fractionally), but the *rendered* segments light up discretely (a segment lights when the value crosses its boundary). The `draft` value is continuous; the display is quantized. This is a render detail, not a model difference.

### §5 Effects
- **`draft` / `commit` / `cancel` / `updated`:** same as gauge. The segment lighting is reactive during `draft` (segments light/extinguish as the value crosses boundaries). No `transition` during the gesture; on `commit`/`updated`, segments `transition` (fade) to their committed lit/unlit state.

### §6 Family-contract gaps
None. The segment quantization is a render detail; the model treats it as a single-value gauge with a discrete display. No additional gaps.

## Summary

Gauge-segmented = gauge with N discrete segments that light up. Same edit surfaces, same value-mappings, same single-value model. The value is continuous during `draft`; the display quantizes to segment boundaries. `segments` is a config dimension. No new model gaps.
