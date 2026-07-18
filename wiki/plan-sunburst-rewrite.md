# Plan — Sunburst Rewrite + Shared-Primitive Extraction

**Branch:** `feat/gesture-transition-contract` (or a child branch)
**Spec:** `wiki/specs/sunburst.md` (updated), `wiki/specs/icicle.md` (reference)
**Reference pattern:** D3 *Zoomable Sunburst* — mount all descendants once, gate visibility by angular span, drill via viewport tween on `[va0,va1,vr0,vr1]`.
**Status:** planning — no code changes yet.

## Goal

Build a sunburst `Chart` in the icicle-harness style that shares the gesture/transition machinery with the icicle, with the geometry-specific code isolated. The icicle keeps working unchanged (it is the reference Hierarchical chart). The sunburst is the second Hierarchical chart; extraction is driven by what these two actually share, not by speculation about a third.

## What's already shared (geometry-neutral, reusable as-is)

These modules carry no rectilinear assumptions and the sunburst imports them directly:

- `kernel.ts` — data service, drill channels, draft broadcast.
- `data-view.ts` — Kernel subscription, Editor wiring. **One icicle assumption:** `buildWindow` retains ancestors of the drill focus (icicle needs them for drill-out context tiles). Sunburst discards ancestors (spec §2). → add a `retainAncestors` option (default `true` for icicle, `false` for sunburst) or a `windowStrategy` hook. Smallest change: a boolean flag.
- `editor.ts` — Idle/Drafting state machine.
- `gesture.ts` — Gesture = Editor + store + `setup()`. The store has `activeEdge` (edge-handle-shaped) — harmless for sunburst; leave it.
- `chart-binding.ts` — DataView→tree event bridge (calls tree ops only).
- `behaviors/conservation.ts`, `behaviors/wheel-edit.ts`, `behaviors/keyboard-edit.ts` — fully geometry-neutral (value/sibling/conservation only).
- `behaviors/preview-full-render.ts` — frozenOrder lifecycle, geometry-neutral.
- `behaviors/mark-lifecycle.ts`, `behaviors/enter-exit-lifecycle.ts` — opacity/shape fades, geometry-neutral.
- `host-size.ts` — ResizeObserver → host pixels.

## What's geometry-coupled (sunburst gets its own)

- `hierarchy.ts` → split. Tree ops (`buildTree`, `findNode`, `snapshotValues`, `restoreValues`, `applyDraft`, `sortedChildren`, `leafValues`, `treeDepth`, `buildAllDescendants`, `buildEdges`) are geometry-neutral → extract to `tree.ts`. `computeLayout` (rectilinear partition), `makeTile` (rect + label), `makeHandle` (rect boundary knob) stay as `icicle-geometry.ts`.
- New `radial-geometry.ts`: `computeRadialLayout` (partition into `[0,2π]×[0,Rfull]`), `makeArc` (annularSector + angular label), `makeAngularHandle` (tangent knob on the shared angular boundary). Arc layout type: `ArcLayout { a0, a1, rIn, rOut }` (vs `LayoutRect`).
- `behaviors/tile-body-drag.ts` → `behaviors/arc-body-drag.ts`. Proportional scaling transfers; axis math is angular (pointer → angle → value delta via `startVal / angularSpan`). Up/right = grow convention maps to clockwise/CCW (pick one, document it).
- `behaviors/tile-body-reorder.ts` → `behaviors/arc-body-reorder.ts`. Center-crossing algorithm transfers; midpoints are angular; use `shortestDelta` for wraparound; ghost transform is a rotation, not a translate.
- `behaviors/transition-on-updated.ts` — already takes `attrs`; keep the class-toggle + suppression CSS (it's the single owner of `gesture-active`). Sunburst passes arc-appropriate attrs (or none — the arc settle is JS-tweened, see below) and reuses the class contract.
- New `behaviors/arc-settle.ts` — the sunburst's settle: per-arc `a0/a1/rIn/rOut` cells + viewport `va0/va1/vr0/vr1` cells; on `commit`/`cancel`/`updated`, `tween()` cells to new layout/viewport targets (D3 `tween("data")` pattern — tween all arcs incl. invisible so interrupts restart clean). Snaps during `draft` (reads `gesture-active` class). Freezes exiting arcs' geometry at last visible remap (exit fade in place). This is the one genuinely new behavior; it's the radial analog of icicle's CSS-on-rect-attrs settle.
- `icicle-chart.ts` → extract the geometry-neutral chart boilerplate into `hierarchical-chart-base.ts` (cells, config setter/query-key, `drill()`, `valueOf`/`writeValue`/`siblings`/`restore`, `_build` skeleton, `connectedCallback` skeleton, breadcrumb). Icicle and sunburst each provide geometry hooks (`makeMark`, `makeHandle`, `computeLayout`, drag/reorder behaviors, settle behavior, settle attrs). **Extraction shape:** a base class is the pragmatic fit here (~300 lines of boilerplate is real duplication), but keep it thin — hooks via a small interface, not a deep hierarchy. Per CLAUDE.md: interfaces over spaghetti, pubsub over imperative. The base owns cells + lifecycle; the chart owns geometry composition.
- New `sunburst-chart.ts` — the element, composing shared base + radial geometry + arc behaviors.

## Build order (smallest-first, icicle unbroken at each step)

1. **Extract `tree.ts` from `hierarchy.ts`.** Move geometry-neutral tree ops; leave `computeLayout`/`makeTile`/`makeHandle` in `hierarchy.ts` (rename file → `icicle-geometry.ts` or leave as-is). Icicle imports from both. Verify icicle still works (no behavior change).
2. **Parameterize `data-view.ts` windowing.** Add `retainAncestors` (or `windowStrategy`) so sunburst can discard ancestors. Icicle passes `true` (default, no change). Verify icicle.
3. **Extract `hierarchical-chart-base.ts`.** Pull the geometry-neutral chart boilerplate out of `icicle-chart.ts`; icicle extends/uses it with its existing geometry hooks. Verify icicle — this is a pure refactor, no behavior change.
4. **Add `radial-geometry.ts`.** `computeRadialLayout`, `makeArc`, `makeAngularHandle`. No chart yet — unit-test the layout against a known tree (angles sum to 2π, radii band correctly).
5. **Add `behaviors/arc-settle.ts`.** Per-arc layout cells + viewport cells + tween-on-commit. Test in isolation if feasible; otherwise wire into the chart next step.
6. **Add `sunburst-chart.ts`.** Compose base + radial geometry + shared input behaviors (wheel, keyboard, conservation, preview-full-render, mark-lifecycle) + `arc-body-drag`/`arc-body-reorder` + `arc-settle`. Wire dblclick→drill, Esc→drill-out, breadcrumb (shared from base). Get a static render + drill working first, then gestures.
7. **Add `arc-body-drag.ts` and `arc-body-reorder.ts`.** Port from the tile versions; angular axis math. Wire into sunburst's `setup()`.
8. **Wire into `main.ts`** — add a `<v-sunburst>` next to `<v-icicle>`, share the same Kernel + config (minus `orientation`).
9. **Dogfood** (dogfood skill) — every gesture, every conservation mode, alt flip, drill in/out, cross-view sync with the side table, config toggles. Remediate.

## Open questions

1. **`hierarchical-chart-base.ts` shape: base class vs factory/composition?** A base class is the pragmatic fit for ~300 lines of boilerplate, but CLAUDE.md leans against heavy class hierarchies and toward interfaces/pubsub. Recommendation: a thin base class (or a `createHierarchicalChart(opts)` factory) with geometry hooks passed as an interface — decide at step 3 based on how the icicle refactor feels. Lean factory if the hooks are many; lean base if the shared lifecycle dominates.
2. **Up/right = grow convention for angular drag.** Icicle: right = grow (vertical), up = grow (horizontal). Sunburst: clockwise vs CCW — pick one and document in the spec. Recommendation: clockwise = grow (matches "right = grow" rotated into angle space, and matches the production sunburst).
3. **Arc label placement.** Icicle labels are top-left + rotate -90° on vertical. Sunburst labels are angular — rotate to the arc's mid-angle, anchor at the arc's radial midpoint, flip 180° on the left half so they're never upside-down. Confirm against the production `MdSunburstLC` label transform.
4. **Does `arc-settle` replace `transitionOnUpdated` for sunburst, or compose with it?** Recommendation: compose. `transitionOnUpdated` keeps owning the `gesture-active` class contract (single owner); `arc-settle` subscribes to Editor events and reads the class to decide snap-vs-tween. `transitionOnUpdated`'s CSS rule is a no-op for arcs (no `x/y/w/h`) but harmless; sunburst passes `attrs: []` or arc attrs as needed.
5. **Viewport tween on drill vs affine layout transform.** Icicle drills via an affine transform baked into `computeLayout` (scale the value axis so the focus fills the canvas). Sunburst drills via a separate viewport tween (`va0/va1/vr0/vr1`) applied as a remap in `makeArc` — because the affine approach on angles produces the off-`[0,2π]` degenerate-arc problem (spec §2). Confirm the viewport tween lives in `arc-settle` (it owns the viewport cells) and that `computeRadialLayout` produces the *natural* (un-remapped) layout. This matches production `MdSunburstLC`.

---

## Wraparound divider handle (open design)

**Problem:** When a parent arc is a full circle (drilled-in node or root with
`showRoot=true`), its N children wrap all the way around. Icicle would have
N-1 dividers; sunburst needs N — the extra one is the seam at 0°/2π where
the last child meets the first child.

**Why it's different:** Every other divider is an interior boundary between
adjacent siblings — drag it, one grows, the other shrinks, start point stays
fixed. The wraparound divider is the boundary between child[N-1] and child[0].
Dragging it moves the "origin" of the whole ring. Visually it looks like
rotation: child[N-1] shrinks from its left, child[0] grows from its right,
and everything appears to rotate around the disc.

**Proposed interaction:**
1. Grab the wraparound divider at the 0°/2π seam.
2. During drag: reapportion child[N-1] and child[0] (conserve total, same
   as any other divider). The visual effect is rotation — the seam follows
   the cursor, all arcs shift because the start angle moved.
3. On release: snap the layout back to canonical position (child[0] starts
   at 0°) with the new proportions baked in. The rotation unwinds; the
   values stay. Counter-rotation.

**Implementation sketch:**
- `buildEdges` needs to emit one extra edge for full-circle parents: the
  pair (child[N-1], child[0]) with a flag `wraparound: true`.
- The handle sits at the 0°/2π boundary. During drag, instead of moving
  an interior boundary angle, it shifts an `originOffset` that rotates
  the whole ring. The reapportion math is the same (conserve total between
  the two siblings); the difference is that the layout reads the offset
  and rotates all arcs by it during the drag.
- On release, the offset resets to 0 and the new values are committed.
  The arcs snap to their canonical positions with updated proportions.

**Open questions:**
- Does the counter-rotation happen instantly on release, or animate?
  Recommendation: animate at `settleMs` so it feels like the ring
  "unwinds" rather than jumping.
- Does this handle exist on non-full-circle parents? No — only when the
  parent wraps all the way around. On slices, the a0/a1 boundaries are
  the parent's own edges (inherited from grandparent), not adjustable
  from this level.
- Multiple full-circle levels? Only the innermost visible level is
  full-circle. Deeper levels are slices within the disc.
