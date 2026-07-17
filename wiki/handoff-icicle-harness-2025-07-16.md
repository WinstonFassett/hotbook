# Handoff — Icicle Harness: Finish Spec, Dogfood, Plan

**Date:** 2025-07-16
**Branch:** `feat/gesture-transition-contract`
**Spec:** `wiki/specs/icicle.md`
**Architecture docs:** `wiki/gesture-architecture.md`, `wiki/interaction-principles.md`, `wiki/transitions-decision.md`

## What's done

The icicle harness (`apps/icicle-harness/`) has a working gesture architecture with composable behaviors. All three input gestures work, conservation modes work, and the side-table is a bireactive treetable with live cross-view sync.

### Architecture (current)

```
icicle-chart.ts     — custom element, implements GestureContext, composes behaviors
                       via setup(). Thin: rendering + edge handle lifecycle.
chart-binding.ts    — shared DataView→chart event bridge (draft/commit/cancel/updated).
                       Used by both icicle and side-table.
gesture.ts          — Gesture = Editor + store + setup() composition API.
                       Global Escape + Alt tracking.
gestures.ts         — attachEdgeHandleDrag + GestureContext interface.
data-view.ts        — Kernel subscription, cross-tile draft broadcast, Editor wiring.
editor.ts           — Idle/Drafting state machine.
hierarchy.ts        — buildTree, computeLayout, buildEdges, makeTile, makeHandle,
                       snapshot/restore/applyDraft helpers.
host-size.ts        — ResizeObserver → host pixel size cells.
side-table.ts       — bireactive treetable (leaf=num, parent=total derivation).
                       Drag parent → proportional distribution to leaves.

behaviors/
  conservation.ts   — applyConservedDelta, effectiveMode, invertMode.
                       Shared by wheel, keyboard, edge drag.
  wheel-edit.ts     — cmd/ctrl+wheel, additive, alt flips conservation.
  keyboard-edit.ts  — arrow keys, locked neighbor, alt flips conservation.
```

### Working features
- Wheel edit (cmd/ctrl+wheel, additive, alt flips to conservation)
- Keyboard edit (arrows, locked neighbor for whole gesture, alt flips)
- Edge handle drag (delta-based, no click jump, correct group scale for proportional-siblings)
- Three conservation modes: additive, proportional-neighbor, proportional-siblings
- Alt flips conservation mode live in all three gestures
- Bireactive treetable with live multi-level preview + cross-view sync
- Focus + hover state (stroke highlights)
- Frozen order during gestures (sort !== 'index')
- Config bar (orientation, sort, depth, conservation mode, reorder toggle)

### Commits this session
- `a5d2d7e7` feat: proportional-siblings default + bireactive treetable
- `55863e6e` fix: alt flips conservation mode live in all gestures
- `43060902` fix: lock neighbor pair for entire keyboard gesture
- `26f6ab92` refactor: extract shared conservation logic
- `9a2fd198` refactor: extract DataView event handling into chart-binding
- `a51094fb` fix: delta-based edge drag with correct group scale

## What's missing (the spec gaps)

The spec (`wiki/specs/icicle.md`) describes behaviors that are **not yet implemented**. These are the remaining todos:

### 1. `reorderDrag` behavior (spec §3, §4)
- **What:** Drag a tile to reorder among siblings. `intent: reorder`, no value change.
- **When enabled:** `canReorder === true` && `sort === 'index'` (both runtime-checked via getters).
- **Mechanics:** Dragged tile follows pointer along sibling axis; siblings slide to provisional slots. Parent span = total value at gesture start; spans recomputed proportionally to value in provisional order.
- **File to create:** `behaviors/reorder-drag.ts`
- **Mutual exclusion:** Tile body is reorder target when `canReorder` is on; otherwise it's click/focus target. Edge handles are separate (always available on interior edges).

### 2. `previewFullRender` behavior (spec §5)
- **What:** During `draft`, the entire chart re-renders with updated values live. `deferSort` getter: when true (sort !== 'index'), sibling ordering frozen at pre-gesture state.
- **Status:** Partially working — the reactive tree already re-renders live during drafts (bireactive cells cascade). But it's not extracted as a named behavior. The `frozenOrder` mechanism works but is wired inline in `icicle-chart.ts` via `chart-binding.ts`, not as a composable behavior.
- **Gap:** Extract as a proper behavior so the spec's composition model is real, not implicit.

### 3. `transitionOnUpdated` behavior (spec §5)
- **What:** On `commit`, `cancel`, `updated` — the chart **transitions** (animated) to the new state, not snaps.
- **Current state:** `commit`/`cancel`/`updated` currently **snap** (rebuild tree from dataset, layout recomputes, tiles jump to new positions). No animation.
- **Approach:** Per `wiki/transitions-decision.md`, use **CSS transitions on SVG geometry attributes** (`x`, `y`, `width`, `height`). Bireactive already drives these as cells; when the cell updates, the `<rect>` attribute changes — modern browsers animate SVG geometry attributes as CSS properties. Add a `settleTransition(["x","y","width","height"])` style during non-draft state transitions; suppress during draft (immediate).
- **Key detail:** The chart needs a "gesture-active" class toggle (already exists on icicle) that suppresses transitions during draft. On commit/cancel/updated, remove the class so the settle animates.
- **Reduced motion:** `prefers-reduced-motion` → `transition: none` (one place).

### 4. `enterExitLifecycle` behavior (spec §5)
- **What:** On `updated` that changes the rendered set: entering marks fade in at target geometry; exiting marks fade out in place (geometry frozen); surviving marks transition to new slots.
- **Current state:** `forEach` in `icicle-chart.ts` handles add/remove of tiles/edges, but there's no enter/exit animation — tiles just appear/disappear.
- **Gap:** Need exit-clone mechanism (freeze exiting tile's geometry, fade opacity, remove after duration) and enter animation (fade in opacity). This is the one place CSS transitions aren't sufficient — need a small lifecycle wrapper around `forEach`.

### 5. Drill + viewport tween (spec §5, "Drill" section)
- **What:** Drill-down/up changes the drill focus → `updated` event → animated transition. The focus node's subtree expands to fill canvas; ancestors recede. Viewport tween animates the level change.
- **Current state:** `DataView` has `drillId` and `setDrill()` but **nothing calls it**. No dblclick handler, no breadcrumb UI. The `buildWindow` function in `data-view.ts` already supports drill (includes ancestors, walks from focus node), but it's untested.
- **Gap:** Add dblclick on tile → `dataView.setDrill(tileId)`. Add breadcrumb or back button → `setDrill(null)`. The transition is a viewport tween (animate the depth-axis position of each level). This is the hardest transition — may need a bireactive tween cell for the viewport position, not just CSS transitions on individual tiles.

## Next steps (in order)

### Phase 1: Finish the spec
1. **`transitionOnUpdated`** — add CSS transition helper, wire to commit/cancel/updated. This is the highest-impact missing piece; every gesture currently ends with a snap. Reference: `wiki/transitions-decision.md`.
2. **`enterExitLifecycle`** — wrap `forEach` with enter/exit animation. Needed for drill and for any structural change (depth change, sort toggle).
3. **`reorderDrag`** — implement the reorder behavior. Lower priority but spec-required.
4. **Drill** — wire dblclick → `setDrill`, add breadcrumb. Depends on enter/exit + transition being in place.

### Phase 2: Dogfood and remediate
5. **Dogfood** — use the `dogfood` skill to systematically test the harness. Check: every gesture type, every conservation mode, alt flip, cross-view sync, config bar toggles, edge cases (empty groups, single child, root edit attempt).
6. **Remediate** — fix whatever the dogfood finds.

### Phase 3: Plan for everything else
7. **Plan** — after dogfooding, assess what else the spec calls for that isn't in the harness. Possible items: `prefers-reduced-motion` handling, Tab navigation for focus, cross-tile focus/hover sync bridge, `no-handles` attribute, orientation toggle animation, measure swap.

## Key files to read first

- `wiki/specs/icicle.md` — the spec (design only, no code)
- `wiki/gesture-architecture.md` — the architecture model
- `wiki/interaction-principles.md` — constraints (rules 8-13 are the transition rules)
- `wiki/transitions-decision.md` — CSS transitions on SVG attributes (the chosen approach)
- `apps/icicle-harness/src/icicle-chart.ts` — the chart (composition + GestureContext)
- `apps/icicle-harness/src/chart-binding.ts` — the shared event bridge
- `apps/icicle-harness/src/behaviors/conservation.ts` — shared conservation logic
- `apps/icicle-harness/src/gesture.ts` — Gesture = Editor + store + setup()

## Skills to use

- `dogfood` — for Phase 2 (systematic QA)
- `webapp-testing` — for Playwright-based verification of gestures
- `tdd` — if writing tests for new behaviors (reorderDrag, transitions)
- `systematic-debugging` — for any bugs found during dogfooding

## Gotchas

- **`rect()` overload:** `rect(x, y, w, h, opts)` is corner-based; `rect(Vec, w, h, opts)` is center-based. Always pass x/y as separate values for corner positioning. (See `CLAUDE.md`.)
- **Edge handle drag coordinates:** bireactive's `draggable` gives SVG root coordinates directly (handle has no transform). Do NOT call `handle.toWorld()` — it expects a pointer event, not a Vec, and returns NaN.
- **Edge handle drag scale:** in proportional-siblings mode, pixel→value conversion must use `groupTotal / groupSize`, not `pairTotal / pairSize`. The left tile's pixel width is its share of the entire sibling group.
- **Layout after restore:** `this.restore()` writes to the reactive tree, but `this.layout()` is a `derive()` that may not recompute synchronously. The edge handle drag captures boundary position and sizes at gesture start (`_dragBoundary`, `_dragPairSize`, `_dragGroupSize`) to avoid reading stale layout mid-drag.
- **Sort during gesture:** `frozenOrder` is captured at gesture start and passed to `buildWindow` so siblings don't reorder mid-gesture when `sort === 'value'`. The `chart-binding.ts` handles this via the `frozenOrder` field on `ChartBinding`.
- **Wiki docs are not canonical.** Many are stale. Prefer `wiki/specs/icicle.md` and `wiki/gesture-architecture.md` over older handoffs. When in conflict, prefer the newer doc.
