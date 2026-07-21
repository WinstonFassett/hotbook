# Spec — Sunburst

Delta spec for the sunburst `Chart`. The sunburst is the icicle with radial geometry — every model-level claim in `wiki/specs/icicle.md` carries over unchanged. This document lists **only the divergences**; for anything not mentioned here, read icicle. The Hierarchical family contract is `wiki/gesture-architecture.md` §"Hierarchical".

Vocabulary: `UBIQUITOUS_LANGUAGE.md` and `wiki/gesture-architecture.md`. The old `MdSunburst` code was read once for behavior and then set aside. Reference pattern for drill: the D3 *Zoomable Sunburst* (`observablehq.com/@d3/zoomable-sunburst`) — mount all descendants once, gate visibility by angular span, drill by tweening the angular+radial viewport domain.

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
  - **Wraparound divider** (sunburst-only, full-circle parents): When a parent arc is a full circle (drilled-in node or root with `showRoot=true`), its N children wrap all the way around. Icicle has N-1 boundary knobs; sunburst needs N — the extra one is the seam at 0°/2π where the last child meets the first child. This knob uses the same reapportion math (conserve total between the two siblings) but different drag mechanics: during drag, the seam follows the cursor and all arcs appear to rotate (the "origin" of the ring shifts); on release, the layout snaps back to canonical position (child[0] starts at 0°) with the new proportions baked in — a counter-rotation. Only exists on full-circle parents; on slices, the a0/a1 boundaries are the parent's own edges (inherited from grandparent), not adjustable from this level. See `wiki/2026-07-18-sunburst-wraparound-divider.md` for the full design.
  - **Reorder** uses **angular** slot computation (pointer → angle → slot, with shortest-angular-delta for wraparound), vs the icicle's linear sibling-axis. `intent: reorder` — same as icicle.
  - Wheel (additive), keyboard (additive by default, Alt → proportional-neighbor), cross-tile (source-defined) — identical to icicle.

### §5 Effects
- **`draft` / `commit` / `cancel` / `updated`**: identical *model* to icicle §5. Same per-surface value-mappings; same enter/exit lifecycle on every rendered-set change; same "no settling; post-commit transition chart-owned" rule. Substitute "arc"/"angular span" for "tile"/"sibling-axis span" throughout.
- **Transition mechanism diverges (geometry consequence):**
  - Icicle settles via **CSS transitions on SVG rect geometry attributes** (`x`, `y`, `width`, `height`) — modern browsers animate these as CSS properties, zero per-frame JS.
  - Sunburst arcs **cannot** settle via CSS transitions on the `d` path attribute: interpolating consecutive `d` strings flips the large-arc-flag mid-tween, producing sliver/spoke artifacts. Instead the sunburst settles via **bireactive `tween()` on per-arc layout cells** (`a0`, `a1`, `rIn`, `rOut`) — each arc owns four cells that derive its path; on `commit`/`cancel`/`updated` the cells tween to the new layout targets and the path re-derives each frame. This is the same shape as the D3 zoomable-sunburst `tween("data")` that interpolates `d.current → d.target` on **all** arcs (including invisible ones) so an interrupted transition restarts cleanly (rule 13).
  - The `gesture-active` suppression contract still holds: during `draft`, arc layout cells **snap** (no tween) so the live preview is immediate; on `commit`/`cancel`/`updated` the cells **tween**. The suppression is owned by the same `transitionOnUpdated` behavior (class toggle); the sunburst's settle behavior subscribes to it.
- **Drill** — same model (an `updated`, rendered as an autonomous `transition`), geometry differs:
  - **Drill-in:** the focus arc expands to fill the full circle (`[0, 2π]` angular, inner radius → 0); the focus node's descendants become the new concentric rings. The ancestor rings are **discarded** from the rendered set (sunburst drills *into* a node and shows its subtree as the whole circle) — unlike the icicle, which keeps ancestors visible as context tiles. This is the windowing difference from §2 showing up in drill.
  - **Drill-out:** the reverse.
  - **Viewport tween** animates the angular domain `[va0, va1]` and radial domain `[vr0, vr1]` — the radial analog of the icicle's affine layout transform. All arcs (present and exiting) interpolate through the viewport remap so an interrupted drill restarts from the current visual position (rule 13). Interruptible/disposable, same as icicle. *(Implementation note, 2026-07 port: the shipped mechanism bakes the drill remap into each arc's layout target and tweens the per-arc cells toward those targets from their current values — equivalent observable behavior [all arcs interpolate coherently; interruption restarts from the current position] without explicit viewport-domain cells. The contract above is stated in viewport-domain terms; either mechanism satisfies it.)*
  - **Exiting arcs freeze geometry** at their last visible remapped position so the exit fade plays in place rather than sliding through the viewport tween (same rule as icicle's "exiting marks fade out in place with geometry frozen").

### §6 Family-contract gaps
None — same answer as icicle. The broadened Hierarchical `draft` contract covers the sunburst (subtree-patch variant, same as icicle). No model gaps. The transition-mechanism divergence (§5) is a geometry consequence, not a model gap — the *contract* (snap during draft, tween on commit/cancel/updated, interruptible, disposable) is identical; only the *mechanism* (CSS-on-rect-attrs vs tween-on-arc-cells) differs.

## Instance hygiene

Same requirement as icicle §8: every `id`, `clipPath` id, `<pattern>` id, and `xlink:href` / `url(#...)` reference must incorporate the chart's `instanceId`. Arc clip paths, gradient/pattern fills, and any `<defs>` elements must be instance-scoped. See icicle §8 for the pattern and verification steps.

## Summary

Sunburst = icicle with radial geometry. Six divergences, all geometry, none model-level: (1) arcs/radial-angular axes vs rects/sibling-depth axes; (2) no `orientation` config; (3) tangent boundary knobs on angular boundaries; (4) angular slot computation for reorder; (5) drill discards ancestors (windowing consequence of radial remapping not tolerating off-angle geometry); (6) transition mechanism is tween-on-arc-cells + viewport tween, not CSS-on-rect-attrs (consequence of `d` not being CSS-transitionable). The effect *contract* (snap during draft, tween on commit/cancel/updated, interruptible, disposable, enter/exit in place) is identical to icicle. Read icicle for everything else.
