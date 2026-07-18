# 2026-07-18 — Hierarchical Chart Overhaul: Status, Matrix & Plan

## 1. What was the overhaul?

Port all hierarchical charts (icicle, sunburst, treemap, treetable, pack) from standalone `Diagram`-based implementations (~400-500 lines each, chart-owned gesture logic) to a shared `HierarchicalChartBase` architecture with:

- **Common base class** (`hierarchical-chart-base.ts`, 696 lines): config lifecycle, DataView/Kernel wiring, drill channel, breadcrumb, value accessors, behavior composition, `_deriveWindow`/`_deriveLayout`, `_composeStandardBehaviors`, `_selectDragBehaviors`, `_startGestureCommon`/`_endGestureCommon`
- **Shared behaviors** (`behaviors/`): wheelEdit, keyboardEdit, tileBodyDrag, tileBodyReorder, arcBodyReorder, transitionOnUpdated, previewFullRender, mark-lifecycle (membershipCell, withExitDelay, enterExitFade)
- **Per-chart geometry modules**: `computeLayout` (icicle), `computeRadialLayout` (sunburst), `computeTreemapLayout` (treemap), `computePackLayout` (pack)
- **Per-chart shape makers**: `makeTile`, `makeArc`, `makeTreemapTile`, `makeCircle`
- **Shared infra**: Kernel, DataView, Editor, Gesture, bi-adapter (legacy BiNode API compat)

## 2. What is DONE

### Charts ported (5/5 hierarchical)
- [x] **Icicle** → `IcicleChart` + `computeLayout` + `makeTile` + edge handles
- [x] **Sunburst** → `SunburstChart` + `computeRadialLayout` + `makeArc` + angular handles + arc settle tween
- [x] **Treemap** → `TreemapChart` + `computeTreemapLayout` + `makeTreemapTile` + draft freeze
- [x] **Treetable** → `TreetableChart` (HTML surface, numberDrag, expand/collapse)
- [x] **Pack** → `PackChart` + `computePackLayout` + `makeCircle` (resize-only, no reorder)

### Cross-cutting features
- [x] **colorMode** (flat/depth/mono) — `_colorModeCell` in base, `resolveFill` in tree.ts, wired in all SVG charts
- [x] **Cursor affordances** — grab/grabbing on tiles+handles, pointer for drill-only groups
- [x] **Handle visibility** — rgba(255,255,255,0.15)
- [x] **Cross-tile sync** — shared Kernel + gesture infra, verified by Playwright tests
- [x] **Drill** — dblclick to drill in, Esc to drill out, breadcrumb, Kernel drill channel sync
- [x] **Transition-on-updated** — CSS transitions on commit/updated, gesture-active suppression
- [x] **Enter/exit lifecycle** — membershipCell + withExitDelay (sunburst) or membership-only (others)
- [x] **Wheel edit** — additive, dynamic step
- [x] **Keyboard edit** — focused tile, additive default, Alt → proportional-neighbor
- [x] **Tile body drag** — resize (additive for treemap/pack, proportional-siblings for icicle/sunburst)
- [x] **Tile body reorder** — sort="index" only, icicle/sunburst/treemap
- [x] **Edge handle drag** — two-sibling reapportion, icicle (rectilinear) + sunburst (angular)
- [x] **Playwright drag tests** — 10 tests, all passing (HierDragHarness reusable harness)
- [x] **Specs remediated** — icicle.md, sunburst.md, treemap.md, treetable.md, pack.md, gesture-architecture.md

### Commits (24 on feat/gesture-transition-contract)
b65d5db8 → 39b00fbe: ports, fixes, refactors, tests, docs, colorMode, cursor, handle visibility, pack port

### Merged: WIN-352 tweaks panel (Opus, commit 1f185655)
- `lib/runtime-config.ts` — `motion.{baseMs,enterMs,exitMs,sortSec,drillMs}` live bireactive cells
- `lib/motion-tweaks-panel.ts` — lil-gui panel with sliders, mounted in both apps
- `lib/transitions.ts` — `TRANSITION_BASE_MS`/`ENTER_MS`/`EXIT_MS` → live bindings synced from motion cells
- Per-chart (bar/pie/gantt/radar/tree/concentric-arc/sankey) — read `motion.*.value` at tween-start
- **GAP**: hierarchical charts have their OWN `TRANSITION_BASE_MS` in `behaviors/transition-on-updated.ts` — tweaks panel does NOT yet control hierarchical charts. Unifying is in Phase 2.

## 3. What REMAINS

### Known gaps
- [ ] **Pack dead code** — `tileBodyReorder` configured but discarded by `_selectDragBehaviors` override
- [ ] **Sunburst type cast** — `renderedNodes as Cell<RenderNode[]>` unsafe cast (withExitDelay returns `Read<readonly T[]>`)
- [ ] **Unused enter-exit-lifecycle.ts** — `enterExitForEach` defined but no chart uses it
- [ ] **Type safety** — ~20 `(g: any)` casts in behavior configs across all charts
- [ ] **Schema gap** — chart-schemas.ts exists (valibot-based, WIN-258) and registers all charts including hierarchical, but the hierarchical schemas don't wire new config fields (`colorMode`, `dragBehavior`, `conservationMode`) through `mountProps` to the chart elements. The schemas drive the demo/hotbook config UI but don't pass through all the new hierarchical chart config fields added during the rewrite.

### Enter/exit fade — design decision (RESOLVED)
The fade/no-fade split is about the **visual metaphor** and whether solid things can be laid out off-screen before transitioning into place:

- **Icicle**: no fade on drill. Tiles materialize off-screen (new levels animate in from the edge) — no blink because the user doesn't realize it, they just smoothly animate into place. Changing displayed levels: levels animate out of view off-screen. No fade needed.
- **Sunburst**: must fade. Circular chart in a square frame — things enter/exit in the interior of the circle and on the outside of the circle. Can't slide off-screen. Fade is the only option.
- **Treemap**: like icicle for drill — siblings get cropped out of view, no fade needed on drill. BUT when changing the number of displayed levels, new levels should fade in/out. This is "fading in levels, not items" — slightly different. Current behavior is probably close.
- **Pack**: same as treemap. Drill = crop out of view (no fade). Level changes = fade in/out new levels.

So the real distinction is: **can the entering/exiting content move off-screen?** If yes (icicle, treemap drill, pack drill), no fade — just animate position. If no (sunburst, level changes on treemap/pack), fade.

Current state: only sunburst uses `withExitDelay`. This is correct for drill. The level-change fade on treemap/pack may already work via the transition-on-updated behavior (new tiles enter with CSS opacity transition). Needs verification, not a code change.

### Treetable architecture — deferred (WIN-353)
Treetable does not use `_deriveWindow`/`_deriveLayout`/`_composeStandardBehaviors`. It's HTML-based, fundamentally different from SVG charts. Works correctly as-is. Ticket **WIN-353** created in vizform project, unassigned for Winston to prioritize. Not in scope for this plan.

### Pack drill — relayout is correct (RESOLVED)
Spec says affine viewport zoom. Current impl uses relayout (re-run d3-pack on subtree). **Relayout is correct.** The viewport-zoom description in the spec is a design aspiration that, in practice, looks like relayout — if you had scale axes you'd redraw ticks/labels rather than transform-scale them. The spec should be updated to say relayout. No code change needed.

### Non-hierarchical charts — MUST be ported (NEW SCOPE)
No chart should be left behind on the old `Diagram`-based architecture. The `charts/` directory still has standalone implementations:

| Chart | Lines | Family |
|---|---|---|
| gantt.ts | 1193 | temporal |
| bar-chart.ts | 889 | flat (categorical) |
| tree-chart.ts | 518 | hierarchical (node-link) |
| radar.ts | 432 | flat (multi-axis) |
| gauge.ts | 270 | flat (single-value) |
| sankey.ts | 326 | flow |
| budget-tree.ts | 286 | hierarchical (sankey variant) |
| pie-chart.ts | 342 | flat (proportional) |
| area-chart.ts | 181 | flat (time series) |
| line-chart.ts | 179 | flat (time series) |
| scatter-chart.ts | 168 | flat (2D) |
| gauge-segmented.ts | — | flat (single-value) |
| sankey-flow.ts | — | flow |
| concentric-arc.ts | — | flat (proportional) |

**This requires a new `BaseChart`** (non-hierarchical) that shares the common infrastructure (config lifecycle, DataView/Kernel wiring, Editor/Gesture, behavior composition, transition-on-updated) but without drill/breadcrumb/hierarchical-specific features. `HierarchicalChartBase` would extend `BaseChart` with drill, breadcrumb, `_deriveWindow` (subtree filtering), edge handles, etc.

This is a large effort — deferred to a separate plan/ticket, but acknowledged as required work. The app will also need migration.

### Refactor opportunities (from subagent analysis)
- [ ] **HIGH: Extract common behavior config factory** — eliminate ~100 lines of duplicated tileBodyDrag/tileBodyReorder config
- [ ] **HIGH: Fix type safety in behavior getters** — replace `(g: any)` with proper `GestureGetter<T>` types
- [ ] **HIGH: Chart config schemas** — formal schema validation for chart configs
- [ ] **MED: Extract _setupRendering template** — common pattern: deriveWindow → deriveLayout → membership → forEach
- [ ] **MED: Unify transition config** — per-chart transition options via override hook
- [ ] **MED: Split GestureContext** — treemap/pack shouldn't need stub implementations
- [ ] **MED: Make enter/exit fade configurable** — per-chart default + config override
- [ ] **LOW: Extract center computation** for radial charts
- [ ] **LOW: Consolidate duplicate angle logic** in sunburst startGesture/updateGesture
- [ ] **LOW: colorMode validation** in config setter

## 4. Feature Matrix — Charts × Capabilities

> This matrix is a snapshot dated 2026-07-18. If maintained, rename with new date.

| Capability | Icicle | Sunburst | Treemap | Treetable | Pack |
|---|---|---|---|---|---|
| **Geometry** | rectilinear | radial (angular+radial) | nested rect (squarify) | HTML rows | circle pack |
| **Layout type** | LayoutRect | RadialRect | LayoutRect | n/a | PackRect |
| **Surface** | SVG | SVG | SVG | HTML | SVG |
| **Drill** | relayout | relayout | relayout | filter rows | relayout |
| **Edge handles** | yes (rectilinear) | yes (angular) | no | no | no |
| **Tile body drag** | resize (prop-siblings) | resize (prop-siblings) | resize (additive, x-axis) | numberDrag | resize (additive, x-axis) |
| **Tile body reorder** | yes | yes (arc reorder) | yes | no | no |
| **Wheel edit** | yes | yes | yes | no | yes |
| **Keyboard edit** | yes | yes | yes | yes | yes |
| **colorMode** | yes (resolveFill) | yes (resolveFill) | yes (resolveFill) | no | yes (resolveFill) |
| **Enter/exit fade** | no (off-screen) | yes (circular frame) | no on drill, fade on level change | row transitions | no on drill, fade on level change |
| **Transition-on-updated** | default (x/y/w/h) | custom (opacity) | default + draftFreeze | manual | custom (opacity) |
| **Cross-tile sync** | yes (Kernel) | yes (Kernel) | yes (Kernel) | yes (Kernel) | yes (Kernel) |
| **Breadcrumb** | yes | yes | yes | yes | yes |
| **GestureContext** | full | full | stubs | no | stubs |
| **_deriveWindow** | yes | yes | yes | no | yes |
| **_deriveLayout** | yes | yes | yes | no | yes |
| **_composeStandardBehaviors** | yes | yes (custom opts) | yes (+ draftFreeze) | no | yes (custom opts) |
| **Spec written** | yes | yes | yes | yes | yes |
| **Playwright tests** | yes | yes | yes | yes | no |

## 5. Code Size

| File | Lines | Role |
|---|---|---|
| hierarchical-chart-base.ts | 696 | base class |
| treetable-chart.ts | 579 | HTML chart (most complex) |
| radial-geometry.ts | 522 | sunburst geometry + arcs + handles |
| hierarchy.ts | 417 | icicle geometry + tiles + handles + edges |
| bi-adapter.ts | 318 | legacy BiNode compat |
| data-view.ts | 311 | DataView query/publish |
| behaviors/arc-body-reorder.ts | 331 | sunburst radial reorder |
| behaviors/tile-body-reorder.ts | 311 | rectilinear reorder |
| behaviors/tile-body-drag.ts | 253 | resize drag |
| treemap-geometry.ts | 250 | treemap layout + tiles |
| sunburst-chart.ts | 246 | sunburst chart |
| behaviors/keyboard-edit.ts | 207 | keyboard edit |
| tree.ts | 171 | ChartNode, resolveFill, sortedChildren |
| treemap-chart.ts | 171 | treemap chart |
| kernel.ts | 172 | Kernel (dataset registry + drill channel) |
| pack-geometry.ts | 164 | pack layout + circles |
| gesture.ts | 144 | Gesture state machine |
| behaviors/mark-lifecycle.ts | 141 | enter/exit lifecycle |
| types.ts | 135 | shared types |
| behaviors/transition-on-updated.ts | 134 | CSS transition behavior |
| pack-chart.ts | 138 | pack chart |
| icicle-chart.ts | 193 | icicle chart |
| editor.ts | 130 | Editor state machine |
| gestures.ts | ~60 | attachEdgeHandleDrag, draggable |
| side-table.ts | 308 | side table sync |
| **Total** | **~7087** | |

## 6. Plan — Next Steps (Ranked)

### Phase 1: Correctness fixes (low risk, high value)
1. **Remove pack dead code** — delete unused tileBodyReorder config in pack-chart.ts
2. **Fix sunburst type cast** — `renderedNodes as Cell<RenderNode[]>` → proper `Read<readonly RenderNode[]>`
3. **Remove unused enter-exit-lifecycle.ts** — or document intended use

### Phase 2: Type safety + schema wiring (medium risk, high value)
4. **Replace `(g: any)` with `Gesture` type** — ~20 casts across all charts + base class
5. **Add proper types to behavior option getters** — use `GestureGetter<T>` consistently
6. **Wire new hierarchical config fields through chart-schemas.ts** — `colorMode`, `dragBehavior`, `conservationMode` need `mountProps` entries for icicle/sunburst/treemap/pack schemas so they flow from config UI → chart element. Schemas already exist (valibot, WIN-258); this is filling in the new fields added during the rewrite.
7. **Wire hierarchical charts to `motion` cells** — hierarchical charts have their own `TRANSITION_BASE_MS` in `behaviors/transition-on-updated.ts`, separate from `lib/transitions.ts` that Opus made live (WIN-352). Unify so the tweaks panel controls hierarchical charts too.

### Phase 3: Enter/exit fade verification (low risk, medium value)
8. **Verify level-change fade on treemap/pack** — when changing displayed levels, new levels should fade in/out. This may already work via transition-on-updated's CSS opacity on enter. Check, don't assume.
9. **Confirm icicle/treemap/pack drill = no fade** — correct per visual metaphor (content moves off-screen). Only sunburst needs fade on drill (circular frame, can't move off-screen).
10. **Make fade configurable** — per-chart default + config override, so consumers can choose. Components shouldn't be opinionated beyond sane defaults.

### Phase 4: DRY extraction (medium risk, medium value)
10. **Extract common behavior config factory** — `configureTileBehaviors()` helper
11. **Extract _setupRendering template** — common derive→membership→forEach pattern
12. **Add transition config override hook** — `_getTransitionOptions()` in base class
13. **Split GestureContext interface** — treemap/pack don't need stub methods

### Phase 5: Spec updates (low risk)
14. **Update pack spec** — drill = relayout (not viewport zoom); relayout is correct because scale axes would redraw ticks/labels, not transform-scale them
15. **Update enter/exit spec** — fade is configurable, defaults match visual metaphor (solid vs translucent)

### Phase 6: Polish (low priority)
16. **Extract center computation** for radial charts
17. **Consolidate angle logic** in sunburst
18. **colorMode validation** in config setter
19. **Add Playwright tests for pack** — drag, drill, cross-tile

### Phase 7: Non-hierarchical chart migration (deferred, large effort)
20. **Design `BaseChart`** — shared base for all charts (config, DataView, Kernel, Editor, Gesture, behaviors, transitions) without hierarchical features
21. **Port flat charts** — bar, line, area, pie, scatter, radar, gauge, gauge-segmented, concentric-arc
22. **Port flow charts** — sankey, sankey-flow
23. **Port temporal charts** — gantt
24. **Port remaining hierarchical** — tree-chart (node-link), budget-tree
25. **Migrate app** — update all consumers to new chart components
26. **Create ticket** for this phase (deferred from this plan)

## 7. Resolved Decisions

1. **Enter/exit fade**: The distinction is whether content can move off-screen. Icicle/treemap/pack drill = no fade (content crops/moves off-screen). Sunburst = fade (circular frame). Treemap/pack level changes = fade in new levels. Current state is probably close — needs verification, not redesign.

2. **Schema wiring**: Schemas already exist (valibot, WIN-258, `chart-schemas.ts`). The gap is that new hierarchical config fields (`colorMode`, `dragBehavior`, `conservationMode`) aren't wired through `mountProps`. This is a fill-in task, not a schema format question.

3. **BaseChart extraction**: Config lifecycle, DataView/Kernel wiring, Editor/Gesture, behavior composition, transition-on-updated are all generic. Drill, breadcrumb, `_deriveWindow` (subtree filtering), edge handles, `_deriveLayout` (hierarchical layout) are hierarchical-specific. Gestures should be as generic as possible and take configuration. Prefer exported composable behavior lists over baked-in auto-inclusion — charts opt in to the behaviors they want.

4. **Non-hierarchical chart migration priority**: Bar first (best direct-manipulation scenario, good test case). Then Cartesian charts (line/area/scatter — unclear fit yet, may need architecture discussion). Arc charts (pie/concentric-arc/gauge/radar) can clump together. Sankey/gantt/tree are weird — may need further architecture conversations. This is a ticket for later, not part of this local development plan.
