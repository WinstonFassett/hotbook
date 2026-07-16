# Spec — Sunburst

Delta spec for the sunburst `Chart`. The sunburst is the icicle with radial geometry — every model-level claim in `wiki/specs/icicle.md` carries over unchanged. This document lists **only the divergences**; for anything not mentioned here, read icicle. The Hierarchical family contract is `wiki/gesture-architecture.md` §"Hierarchical".

Vocabulary: `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. The old `MdSunburst` code was read once for behavior and then set aside.

## Divergences from icicle

### §1 Geometry
- **Radial**, not rectilinear. Marks are **arcs** (concentric rings), not rectangles. Axes are **angular** (sibling) and **radial** (depth) — vs icicle's sibling-axis and depth-axis.
- **No `orientation` config dimension.** Radial geometry has no orientation to toggle; the depth-axis is always radial. The `DataView` query key is therefore the icicle's key minus `orientation` (see icicle §2; `datasetId` is still a config field).

### §2 DataView query
- Same key shape as icicle minus `orientation`: `datasetId` + `measure` + `sort` + `depth`. The `Dataset`'s `dataShape` is `hierarchical`.
- **Windowing differs (geometry consequence, not model):** the sunburst's window is the focus node's subtree only — it does **not** retain ancestors of the focus node in the rendered set, unlike the icicle. Reason: off-angle siblings of an ancestor remap to angles outside `[0, 2π]` and produce degenerate arc paths. The icicle can keep ancestor tiles because rectilinear remapping tolerates off-screen geometry; radial remapping does not.

### §3 / §4 Control surfaces and intent
- **Same five surfaces, same intents, same per-surface value-mappings as icicle §3/§4.** Geometry differences only:
  - **Boundary knob** sits on the shared **angular** boundary between two adjacent sibling arcs and is oriented **tangent to the arc** (perpendicular to the radial line), vs the icicle's axis-aligned knob on a rectilinear boundary. Value-mapping: two-sibling reapportion (sum preserved) — same as icicle.
  - **Reorder** uses **angular** slot computation (pointer → angle → slot), vs the icicle's linear sibling-axis. `intent: reorder` — same as icicle.
  - Wheel (additive), keyboard (additive by default, Alt → proportional-neighbor), cross-tile (source-defined) — identical to icicle.

### §5 Effects
- **`draft` / `commit` / `cancel` / `updated`**: identical to icicle §5. Same per-surface value-mappings; same enter/exit lifecycle on every rendered-set change; same "no settling; post-commit transition chart-owned" rule. Substitute "arc"/"angular span" for "tile"/"sibling-axis span" throughout.
- **Drill** — same model (an `updated`, rendered as an autonomous `transition`), geometry differs:
  - **Drill-in:** the focus arc expands to fill the full circle (`[0, 2π]` angular, inner radius → 0); the focus node's descendants become the new concentric rings. The ancestor rings are **discarded** from the rendered set (sunburst drills *into* a node and shows its subtree as the whole circle) — unlike the icicle, which keeps ancestors visible as context tiles. This is the windowing difference from §2 showing up in drill.
  - **Drill-out:** the reverse.
  - Viewport tween animates the angular domain `[x0, x1]` and radial domain `[y0, y1]`. Interruptible/disposable (rule 13), same as icicle.

### §6 Family-contract gaps
None — same answer as icicle. The broadened Hierarchical `draft` contract covers the sunburst (subtree-patch variant, same as icicle). No model gaps.

## Summary

Sunburst = icicle with radial geometry. Five divergences, all geometry, none model-level: (1) arcs/radial-angular axes vs rects/sibling-depth axes; (2) no `orientation` config; (3) tangent boundary knobs on angular boundaries; (4) angular slot computation for reorder; (5) drill discards ancestors (windowing consequence of radial remapping not tolerating off-angle geometry). Read icicle for everything else.
