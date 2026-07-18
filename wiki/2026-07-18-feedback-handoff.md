# Handoff — Hierarchical Chart Feedback & Next Plan

## Session context

Branch: `feat/gesture-transition-contract`. Phases 1-6 of the hierarchical overhaul are complete (8 commits). All 12 Playwright tests passing. Status doc updated at `wiki/2026-07-18-hierarchical-overhaul-status.md`.

Dev servers: `hotbook-demos.localhost:1355` (demos) + `icicle-harness.localhost:1355` (harness). Both via portless.

## Winston's feedback (reviewed demos page, 2026-07-18)

### Round 2 feedback (slow-motion animation review, 2026-07-18)

**5. Treemap drill transition is fundamentally wrong.** When drilling into a node (e.g. "tech", the blue top-level node):
   - The "tech" node itself **shrinks into the upper-left corner** until it vanishes. This is backwards — tech is the container of the things filling the screen, so it should GROW and get pushed off-screen as its children take over.
   - The other root-level siblings **also scale down into the upper-left corner**. What they should do is slide DOWN (or in the appropriate direction), preserving separation, using offsets to push off-screen.
   - Labels vanish during the animation-out but reappear on pop-out (weird).
   - **Root cause:** `computeTreemapLayout` runs d3.treemap on the **effective root only** (drill target). The drill target's children get fresh layout filling [0,0,W,H], but the drill target itself + its siblings get NO layout entry → fall back to `{x:0,y:0,width:0,height:0}` → shrink to corner. This is NOT the D3 zoomable-treemap pattern.
   - **Fix:** mirror icicle's `computeLayout` — run d3.treemap on the FULL tree, then apply a 2D affine transform (scale + translate) that maps the focus node's rect → [0,0,W,H]. Off-subtree nodes scale up and translate off-screen, sliding there via CSS transitions. Icicle's transitions are the gold standard.
   - Reference: D3 zoomable treemap pattern. Production treemap (`packages/bireactive/src/charts/treemap.ts`) wraps the same `TreemapChart` — same bug. LayerChart inspo (`inspo/layerchart-treemap-sample.tsx`) is a static treemap, no drill transition to reference.

**6. Sunburst transitions are also not right.** Icicle transitions are wonderful and set the bar; sunburst needs to match. Need to study the D3 zoomable-sunburst example more carefully. (Also still has regression #3 below — center color fades to black on drill.)

**7. Circle pack still not zooming at all, still no breadcrumb.** (Same as regressions #1 + #4 below — confirmed still open.)

### Round 3 feedback (visual separation + layout, 2026-07-18)

**17. Breadcrumb space reservation** — when breadcrumb is enabled, it currently appears/disappears dynamically, causing a layout jump when drilling in (chart resizes to accommodate the breadcrumb bar, then transitions). Fix: if `showBreadcrumb` is enabled, always reserve the breadcrumb bar's space (even at root level when no breadcrumb shows). The chart area stays constant; the breadcrumb bar is either populated or empty but always takes the same height.

**18. Hierarchical family layout** — rearrange the 4-chart grid to 5 charts in a neat rectangle:
   - Left column: icicle (full height)
   - Center column: pack (top) + sunburst (bottom) — these fit in one column due to their dimensions
   - Right column: treemap (full height)
   - This makes it easy to compare visual/separation styles across all 4 hierarchical SVG charts + treetable.

**19. Inner padding / separation standardization** (extends #10-12 above with more specificity):
   - Icicle has the nicest separation — nothing nested inside, gaps are clean.
   - Sunburst could have just as good separation as icicle. Needs a standard `paddingInner` (angular gap) that creates separation between top-level groups (black shows through the gaps) and between nested levels (parent color shows through).
   - At nested levels, the gap shows the parent's color, not black. This raises a design question: **hairline borders** on nested slices/arcs/circles would give better visual distinction between levels. LayerChart uses `hsl(fill).darker(1)` for stroke.
   - Treemap: top-level separation is good, but nested blocks go flush against their container edges. Need `paddingOuter` (gap between parent edge and children) matching the separation amount, so nested blocks don't look like they're touching the container wall.
   - Standardize one `paddingInner` value across all hierarchical charts for consistent separation feel.

### Round 4 feedback (slow-motion audit, 2026-07-18)

**20. Treemap paddingOuter — 2px is too small.** The 2px `paddingOuter` fix was the right idea but wrong value. Needs to be larger to create visible breathing room between nested blocks and their container. Winston wants to review visually and discuss the right amount.

**21. Text styles audit needed.** Text is differently sized/formatted across the 4 hierarchical charts. Need to audit and standardize text styles across all charts (font size, weight, formatting).

**22. Treemap labels overflow their nodes.** Labels spill out of their tile into the parent container. Need proper clipping. LayerChart likely has this solved — check their approach.

**23. Two-line label format (name + value).** Budget tree is the reference: bold name on first line, dollar-formatted value on second line (lighter weight). Apply to:
   - Pack: split name from value, separate lines, bold name
   - Treemap: upper-left positioning, amount on new line below
   - Sunburst: name then dollar underneath
   - Container vs leaf labeling may differ — needs design discussion
   - Dollar-format the value when appropriate

**24. Font color — STILL not addressed.** White text on light oklch backgrounds is hard to read. Need near-black/dark text on all hierarchical charts. This has been raised multiple times and remains unfixed. **Priority.**

**25. Circle pack borders look sharp.** Whatever border style pack is using looks good. Consider applying the same to other charts (sunburst, treemap).

**26. Transition timing — base vs drill.** Charts are using "base" transition timing for drill transitions, not "drill" timing. Drill transitions should use drill-specific timing. The 1000ms base slowdown reveals disparities between charts.

**27. Visual consistency strategy needed.** With all 4 hierarchical charts side by side, the disparities are clear. Need a strategy session to align: separation, borders, labels, text styles, transition feel.

### Round 5 feedback (sunburst drill metaphor, 2026-07-18)

**28. Sunburst drill: collapse-to-zero, not fade-in-place.** The D3 zoomable sunburst uses a "folding" metaphor: when drilling into a slice, that slice expands to fill the full circle while everything else **collapses its angular width to zero** — the focus "swallows" the non-focus arcs. Currently our non-focus arcs fade out in place (opacity tween with frozen geometry), which looks wrong. The layout already computes zero-width for off-subtree nodes (angular clamping), but `makeArc`'s exit freeze prevents the animation — it freezes geometry at the last position instead of letting it animate to zero. Fix: remove the exit freeze for sunburst so arcs animate their angular width to zero via the settle tween. Keep `withExitDelay` so arcs stay mounted during the collapse animation. No opacity fade — arcs are visible until they collapse to zero, then evicted. Also fix z-index: fading labels overlay the expanding focus arc.

### Round 1 regressions (fix first)

1. **Pack not transitioning** — likely caused by Phase 3/4 changes (`exitFade` default, `_transitionOpts()` extraction). Pack drill has no transition animation at all. Investigate `pack-chart.ts` `_setupRendering` + `_transitionOpts()` + the `transitionOnUpdated` behavior wiring. **Root cause found:** pack never wired `withExitDelay` (unlike sunburst), so exiting circles are evicted immediately — the opacity CSS transition fires but is invisible. Also pack uses the same "recompute on effective root" pattern as treemap (see #5 above) — needs the same D3-style affine transform fix.

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

## D3 zoomable reference (fetched to `inspo/d3-zoomable/`)

Source: `inspo/d3-zoomable/zoomable-treemap.js`, `zoomable-sunburst.js`, `zoomable-icicle.js` (from `https://api.observablehq.com/@d3/zoomable-*.js`).

### Icicle (the gold standard — already matches)

- `d3.partition().size([height, (height+1)*width/3])` — **full tree laid out once**.
- On click: `focus = focus === p ? p.parent : p`, then compute `d.target` for EVERY node:
  - `x0: (d.x0 - p.x0) / (p.x1 - p.x0) * height` — affine on value axis (scale + translate)
  - `y0: d.y0 - p.y0` — depth shift (translate only, no scale on depth)
- Transition: `cell.transition().duration(750).attr("transform", d => translate(target.y0, target.x0))` + rect height tween + label opacity tween.
- **No clamp.** Off-subtree nodes get `x0/x1` outside `[0, height]` → slide off-canvas. This is why icicle feels right — siblings slide away, focus children slide in, all on one shared timeline.
- Our `computeLayout` already does this (1D affine on value axis). ✓

### Treemap (the fix target)

- Custom `tile` function: `d3.treemapBinary(node, 0, 0, width, height)` then rescale children: `child.x0 = x0 + child.x0/width * (x1-x0)` etc. — **affine during tiling**, so focus children fill the focus's rect.
- `d3.treemap().tile(tile)(hierarchy)` — full tree laid out once.
- Scales `x.domain([d.x0, d.x1]); y.domain([d.y0, d.y1])` map focus rect → `[0,W]×[0,H]`.
- **Transition = two-layer crossfade**: `zoomin` creates a NEW `<g>` on top with the focus's children (fades in), the OLD `<g>` transitions to `position(d.parent)` (slides/shrinks to where focus was in the old view) + fades out + removes. `zoomout` reverses (old on top fades out, new underneath).
- D3 renders ONE level at a time (focus.children only), so crossfade is the natural choice.
- **Our architecture renders ALL descendants (nested)**, so we have a better option: single-set + 2D affine (the icicle pattern extended to 2D). Lay out the full nested treemap once, then for each rect apply `scaleX = W/focusW, scaleY = H/focusH, translate = (-focusX*scaleX, -focusY*scaleY)`. Every node including focus siblings gets a target → they slide off-screen (downward if focus was at top, preserving separation). Focus children scale up from inside the focus's old rect → fill screen. CSS transitions on x/y/width/height animate the slide. This gives the icicle feel Winston wants, not the crossfade D3 uses.

### Sunburst (also needs work)

- `d3.partition().size([2π, height+1])` — full tree laid out once.
- `root.each(d => d.current = d)` — stores per-node current state.
- On click: compute `d.target` for EVERY node:
  - `x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2π` — **CLAMPED to [0, 2π]**
  - `y0: Math.max(0, d.y0 - p.depth)` — clamped to ≥0
- Transition: `path.transition(t).tween("data", d => interpolate(d.current, d.target)).attrTween("d", d => () => arc(d.current))` — **interpolates `current → target` per frame** via `attrTween`, re-rendering the arc path each frame. The clamp makes off-subtree arcs collapse to slivers, but the smooth interpolation makes the collapse look like a smooth shrink, not a snap.
- `arcVisible(d)`: `d.y1 <= 3 && d.y0 >= 1 && d.x1 > d.x0` — visibility gate (2 rings at a time).
- **NO center colored disc in the D3 reference.** The center is a transparent `<circle>` with `datum(root)` for click-to-zoom-out. Winston's "center stays drilled color" is our own design choice — needs its own fix (don't crossfade the center; swap instantly or z-order it on top so the old root disc is never visible during the transition).
- Our `computeRadialLayout` already clamps (matching D3) and uses per-arc cells + `settleArcCells` RAF tween (analogous to `attrTween`). The clamp is correct for sunburst. The remaining issue is the center color crossfade (#3) + matching the feel of icicle's transitions.

### Key takeaway

The unifying pattern: **lay out the full tree once, compute a per-node target on drill, tween every node from current → target.** Icicle does this (1D affine, no clamp). Sunburst does this (angular affine + clamp + attrTween). Treemap should do this (2D affine, no clamp) — our nested-rendering architecture makes single-set + affine a better fit than D3's crossfade. Pack should do this (2D affine on circles).

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

### Phase A: Fix drill transitions (blockers — biggest wins)

The unifying root cause: treemap, pack, and sunburst all use a "recompute layout on the effective root (drill target)" pattern. This makes the drill target's children fill the screen but leaves everything else with no layout entry → shrink-to-corner. Icicle is the gold standard because it walks the FULL tree and applies a D3-style affine transform so off-subtree nodes slide off-canvas.

**A1. Treemap drill transition** (feedback #5) — `treemap-geometry.ts` `computeTreemapLayout`:
  - Run d3.treemap on the FULL `root` (not `effectiveRoot`), walking all descendants into the map.
  - If `drillId`, find the focus rect `[fx, fy, fw, fh]` and apply 2D affine: `scaleX = W/fw, scaleY = H/fh, translate = (-fx*scaleX, -fy*scaleY)` to every rect.
  - Result: focus node grows to fill screen → its children (nested inside) take over; siblings scale up + translate off-screen (e.g. downward) preserving relative layout. CSS transitions on x/y/width/height animate the slide.
  - This matches icicle's `computeLayout` drill transform (1D value-axis scale) extended to 2D.
  - **Focus-node rendering = config option** (Winston's call): like icicle's `showRoot` and like `showBreadcrumb`, treemap should expose a config flag (e.g. `showRoot` reused, or a treemap-specific `showFocusTile`) controlling whether the focus node renders as a visible tile during drill or is the invisible container. Default TBD — likely hidden (container) to match D3 zoomable-treemap, but consumer-configurable.

**A2. Pack drill transition** (feedback #7, regression #1) — `pack-geometry.ts` `computePackLayout`:
  - Same fix: run d3.pack on the FULL tree, apply 2D affine transform mapping focus circle → canvas. Off-subtree circles slide off-screen.
  - Also wire `withExitDelay` in `pack-chart.ts` `_setupRendering` (like sunburst) so exit fade is visible. Currently exiting circles are evicted immediately → opacity transition fires but is invisible.
  - Pack positions (cx/cy/r) change on every layout re-derivation — the `_transitionOpts` already excludes cx/cy/r from CSS transition (only opacity). The affine transform approach should make this work because circles move smoothly via the transform, not via re-derivation chasing. May need to revisit whether to CSS-transition cx/cy/r now that the layout is stable.

**A3. Sunburst drill transition** (feedback #6, regression #3) — `radial-geometry.ts`:
  - Study D3 zoomable-sunburst example. Current `computeRadialLayout` already walks the full tree + applies angular scaling, BUT clamps angles to [0, 2π] → off-subtree arcs collapse to slivers instead of sliding off. Icicle lets off-subtree nodes go off-canvas. Sunburst may need the same (no clamp, let arcs render outside [0, 2π]).
  - Center color bug (#3): the root arc (full disc, rIn=0) fades out via `withExitDelay` while the drilled node's arc fades in → crossfade through black background. Fix: the new center (drilled node) should appear instantly or the old root should persist until the new one is opaque (z-order / timing).

**A4. Pack breadcrumb** (regression #4) — `pack-chart.ts`:
  - Pack calls `_composeStandardBehaviors` (which doesn't include breadcrumb — breadcrumb is wired in `connectedCallback` via `_setupBreadcrumb`, gated on `config.showBreadcrumb === true`). Check the demo config sets `showBreadcrumb: true`. The base wiring is shared; pack inherits it automatically. Likely a demo config issue.

**A5. Bar chart sort** (regression #2) — `apps/demos/src/main.ts` — **FIXED (fully reactive)**:
  - **Root cause:** the demos page was entirely imperative — no `cell`/`derive`/`effect` imports, just a mutable `let config` + `addEventListener('hashchange')` + an `applySort` loop walking a `mounted[]` array. Two sort states (global `config.sort` vs per-chart selector) fought because every sort code path unconditionally used the global, clobbering per-chart overrides.
  - **Architectural principle added** to `wiki/chart-architecture.md` §"Core stance": **Config layering — global defaults, per-chart overrides win.** The chart's effective config is the per-chart setting if set, else the global default. The chart is the source of truth for its own effective config; the global bar is a default, not a hidden override.
  - **Fix (reactive):** `globalSort = cell<'index'|'value'>(readConfig().sort)`. Each chart gets `sortOverride = cell<'index'|'value'|null>(null)` + `effective = derive(() => override.value ?? globalSort.value)`. A `wireSort(el, treetable, model, kind)` effect per chart applies the effective sort to the chart + treetable whenever it changes. The per-chart selector writes to `override.value`; the global button writes the URL hash → `hashchange` → `globalSort.value`. No `applySort` loop, no `mounted[]` array, no `gesturecommit` re-apply reading a stale global. The `gesturecommit` handler now reads `chartSort(el).effective.value` (reactive) for the bar chart's post-commit re-feed.
  - **Bar chart itself is already reactive on sort** — it detects data-array id-sequence changes via `orderHash` and tweens positions. It just needs the data model to re-feed sorted data, which the `wireSort` effect does. No bar-chart code change needed.
  - **What was deleted:** `let config` (mutable global), `applySort()` (imperative loop), `effectiveSort()` (event-faking helper), `mounted[]` array, `updateSortLabel()`, the second `hashchange` handler that walked `mounted[]`. ~70 lines of imperative orchestration replaced by ~40 lines of reactive wiring.

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
