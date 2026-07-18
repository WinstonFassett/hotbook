# Handoff — Hierarchical Chart Feedback & Next Plan

## Session context

Branch: `feat/gesture-transition-contract`. Phases 1-6 of the hierarchical overhaul are complete (8 commits). All 12 Playwright tests passing. Status doc updated at `wiki/2026-07-18-hierarchical-overhaul-status.md`.

Dev servers: `hotbook-demos.localhost:1355` (demos) + `icicle-harness.localhost:1355` (harness). Both via portless.

## Winston's feedback (reviewed demos page, 2026-07-18)

### Regressions (fix first)

1. **Pack not transitioning** — likely caused by Phase 3/4 changes (`exitFade` default, `_transitionOpts()` extraction). Pack drill has no transition animation at all. Investigate `pack-chart.ts` `_setupRendering` + `_transitionOpts()` + the `transitionOnUpdated` behavior wiring.

2. **Bar chart sort regression** — change sort to "order by value", edit a bar, release → bars animate back to original sort order instead of staying sorted by value. Probably a `frozenOrder` issue in `_composeStandardBehaviors` or the bar chart's own sort logic. Check `bar-chart.ts` + `behaviors/preview-full-render.ts`.

3. **Sunburst center color fades to black on drill** — when you drill into a colored node (e.g. red "health"), the center circle briefly shows the drilled color then fades/blinks back to black. The center should STAY the color of the drilled node — that's the current context. Check `sunburst-chart.ts` + `radial-geometry.ts` `makeArc` — the center circle's fill is probably static (root node color) instead of reactive to `drillId`.

4. **Pack has no breadcrumb / no way to drill out** — the base class has breadcrumb wiring but pack may not be calling it, or the demo isn't enabling it. User gets stuck after drilling in. Check `pack-chart.ts` — does it call `_composeStandardBehaviors` which includes breadcrumb? Is the demo config enabling breadcrumb?

### Demos page reorganization

5. **Sticky table of contents** — left sidebar TOC when width allows, hamburger menu when not (mobile can come later). Should list all demo sections, click to scroll.

6. **Section reordering** — things in better shape go higher, things in worse shape go lower:
   - **Top (tier 1)**: Hierarchical charts (icicle, sunburst, treemap, pack, treetable) — these are what Winston cares about most
   - **Middle**: Line chart, area chart, bar chart, scatter chart (Cartesian family)
   - **Novelty**: Radar, concentric arc, gauge, gauge-segmented
   - **Under construction / bottom**: Pie chart (not usable — see below), sankey, sankey-flow, tree-chart, budget-tree, gantt
   - **Bottom (experimental)**: Cartesian viewer (better shape), the other viewer (worse shape — not animating, overflow issues, no scrollbars)

### Hierarchical label overhaul

7. **Label color: black/near-black text** — white text gets washed out on the oklch color palette (especially lighter colors). Use near-black as default label color on all hierarchical charts. Budget tree already does this and looks good.

8. **Two-line label format** — name on first line (bold), value on second line (lighter weight). Budget tree has this pattern. Apply to:
   - Pack (circles — currently shows name only, no value)
   - Treemap (currently shows name only)
   - Icicle (currently shows no values — should add them)
   - Format the value appropriately (dollar amount, etc.)

9. **Root node label** — when drilled, show the root/context node as a labeled bar (like budget tree's "Portfolio $X"). Icicle should do this too. Proposed: render root node as labeled context when drilled, hide at top level.

### Separation / padding as config

10. **Configurable separation** — the gap between tiles/arcs/circles should be a config field, not hard-coded. LayerChart exposes:
    - `paddingInner` (gap between siblings — this is the "separation")
    - `paddingOuter` (gap between parent edge and children)
    - `paddingTop/Bottom/Left/Right` (per-side)
    - These map to d3-hierarchy's `treemap().padding*()` API
    
    Winston wants the separation to be consistent across charts that have the concept (treemap, icicle, pack, sunburst). The dividers/borders live in the center of the separation. Should also be a tweak (live-adjustable).

11. **Sunburst needs separation + borders** — currently no gap between arcs, handles look weird (thick, translucent). Adding `paddingInner` (angular gap) + hairline borders would fix this.

12. **Hairline border as config** — treemap has borders, sunburst doesn't. Make border style/thickness/color a config property. LayerChart uses `hsl(fill).darker(1)` for stroke color, `rx={5}` for rounded corners.

13. **Tile algorithm config** — LayerChart exposes `tile` option (squarify, resquarify, binary, dice, slice, sliceDice). We currently hard-code squarify. Should be configurable.

### Pie chart

14. **Pie chart is not usable** — move to under-construction section. Long-term plan: adapt sunburst to act as a pie chart (one-level sunburst, no drill, same controls/interactions). Could be a config preset on sunburst or a thin `PieChart` subclass. Not a priority now.

### Viewers (experimental)

15. **Cartesian viewer** — cool that you can touch-zoom, but needs:
    - Touch pan-scroll (drag to scroll axes)
    - Pinch-zoom on touchpad
    - Scrolling should scroll the axes
    - Currently in better shape than the other viewer
    
16. **Other viewer** — not animating, overflow problems, no scrollbars. Move to very bottom. These will eventually become behaviors, not chart-specific code. The "viewport tween" language was factored out because it's not exactly what we mean. Defer fixing until behavior extraction discussion.

### Demo data

17. **More levels in demo data** — current demos are 2-3 levels. Need 4-5 level fixtures to properly test deep hierarchies. Some demos in the app (hotbook) have deeper data; bring that richness to the demos page.

### Other notes

18. **Sankey/sankey-flow** — move to under-construction. Winston wants them but they're not first tier.

19. **Tree-chart** — similar, under-construction.

20. **Budget-tree** — test thing for bireactive parity. Keep but mark as test/parity.

21. **Gantt** — more useful than sankey but still kludgy. Under-construction.

22. **Nested-layered** — proven out in another project, adapted here, basically works but has a weird unrelated treetable. Under-construction.

## LayerChart inspo reference

File: `inspo/layerchart-treemap-sample.tsx` + `inspo/layerchart/packages/layerchart/src/lib/components/Treemap.svelte`

Key patterns to adopt:
- **Padding API**: `paddingInner` / `paddingOuter` / per-side — maps to d3-hierarchy
- **Label segments**: name (10px font-medium) + value (8px font-extralight), black text
- **Stroke**: `hsl(fill).darker(1)`, `strokeOpacity` varies by colorMode
- **Rounded corners**: `rx={5}`
- **Color modes**: children (parent/leaf opacity), depth (sequential), parent (ancestor hue + brightness)
- **Tile algorithm**: configurable (squarify, resquarify, binary, dice, slice, sliceDice)
- **Clip path**: `RectClipPath` for label overflow (we do this too)
- **Controls component**: separate config UI component bound to config state (our equivalent: tweaks panel / config schema)

## Proposed plan (next session)

### Phase A: Fix regressions (blockers)
1. Pack transitions — investigate `pack-chart.ts` `_setupRendering` + `_transitionOpts()`
2. Bar chart sort — investigate `frozenOrder` + `preview-full-render`
3. Sunburst center color on drill — make center circle fill reactive to `drillId`
4. Pack breadcrumb — ensure breadcrumb wiring is active in pack

### Phase B: Demos reorganization
5. Sticky TOC (left sidebar, hamburger on narrow)
6. Section reordering per Winston's tiers
7. Richer demo data (4-5 level fixtures)

### Phase C: Hierarchical label overhaul
8. Black/near-black label text on all hierarchical charts
9. Two-line label format (name bold + value light) on pack, treemap, icicle
10. Root node context label when drilled (icicle + sunburst)

### Phase D: Separation/padding config
11. Add `paddingInner` / `paddingOuter` to `ChartConfig`
12. Wire through schemas → bi-adapter → layout functions
13. Add to tweaks panel (live-adjustable)
14. Sunburst: angular gap + hairline borders
15. Border style/thickness/color as config

### Phase E: Pie chart disposition
16. Move pie to under-construction
17. (Deferred) Adapt sunburst as pie — config preset or thin subclass

## Files to read first (next session)

- `packages/bireactive/src/hierarchical/pack-chart.ts` — regression #1, #4
- `packages/bireactive/src/hierarchical/sunburst-chart.ts` — regression #3
- `packages/bireactive/src/hierarchical/radial-geometry.ts` — regression #3 (center circle fill)
- `packages/bireactive/src/charts/bar-chart.ts` — regression #2
- `packages/bireactive/src/hierarchical/behaviors/preview-full-render.ts` — regression #2
- `apps/demos/src/main.ts` — demos reorganization
- `inspo/layerchart-treemap-sample.tsx` — padding/label/border inspo
- `inspo/layerchart/packages/layerchart/src/lib/components/Treemap.svelte` — d3 padding API
- `packages/bireactive/src/hierarchical/types.ts` — where to add padding config fields
- `packages/bireactive/src/hierarchical/treemap-geometry.ts` — where padding is currently hard-coded
- `packages/bireactive/src/hierarchical/hierarchy.ts` — icicle layout padding
- `packages/bireactive/src/hierarchical/pack-geometry.ts` — pack layout padding
- `packages/bireactive/src/hierarchical/radial-geometry.ts` — sunburst layout padding
