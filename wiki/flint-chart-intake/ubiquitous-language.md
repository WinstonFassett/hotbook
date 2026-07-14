# Flint intake — ubiquitous language

> Status: working doc, prompted by flint-chart intake (`inspo/flint-chart`).
> Not a decision record. Feeds ticket discussion on WIN-258 and future intake docs.
> House style per `wiki/layerchart-intake/`: this is phase-adjacent research, sitting
> next to `families.md`-style synthesis, not a build-session spec.

## 1. Why now

- Vizform has no `UBIQUITOUS_LANGUAGE.md`. Terms live scattered across
  `docs/architecture.md`, `wiki/chart-schema-design.md`, and code comments —
  each wrote its own vocabulary at the time, nobody reconciled them.
- WIN-258 (chart-schema-design) is mid-flight and is about to invent *more*
  nouns (`ChartSchema`, `capabilities`, `data`/`config` split) right as flint
  intake hands us a competing, more mature vocabulary for the same problem
  space (semantic types, channels, encodings). Better to cross-reference now
  than to discover the collision after both are shipped.
- Flint's compiler pipeline (spec → semantics → layout → backend) is the
  same shape as our chart-schema proposal's split (data shape → config →
  capabilities), but flint has 70+ semantic types and 9 orthogonal
  dimensions behind theirs. Worth stealing the vocabulary even if we never
  port the code.
- Some words are used by both projects for *different concepts*
  ("template", "mark", "spec") — if we don't write the disambiguation down
  now, every future intake doc will re-litigate it.

## 2. Term mapping table

| Flint term | Vizform term | Proposed canonical |
|---|---|---|
| `ChartAssemblyInput` — full compiler input | Persisted tile shape + proposed `tile.config` | **tile spec** (data ref + `config` + `capabilities`) |
| `encodings` map | `Binding` (`xBinding`, `yBinding`, `orderBinding`) | **binding** = per-channel entry; encoding = whole map |
| **channel** (`x`, `y`, `color`, ...) | *(unnamed — just a property name per binding)* | **channel** — adopt flint's word |
| `field` (raw column reference) | `measureKey` / `dimKey` | **field** = generic; **measureKey**/**dimKey** = typed field |
| **semantic type** (70+ types, 9-dim registry) | `ColumnSchema` (`type`, `rollup?`, `unit?`) | **`ColumnSchema` gains a `semanticType`** |
| **template** (`ChartTemplateDef`, compiler recipe) | `Diagram` subclass / proposed `ChartSchema` | **collision — always qualify** (see §3) |
| `assemble*()` — stateless batch compile | `Diagram.scene()` — one-shot then reactive re-derive | **assemble** (flint) vs **render** (vizform) — don't blur |
| `LayoutResult` — target-agnostic layout IR | *(none — inline per-chart scale/step math)* | **gap** — no shared layout-budget module |
| **pivot** — named alternative view (orientation/series swap) | *(none — ad hoc `orientation` config per chart)* | **gap** — worth a `pivots` capability |
| **mark** — declarative shape choice in a template | **mark** — live scene-graph shape w/ tween cell | **collision — same word, different layer** (see §3) |
| **backend** — output-side render target (VL/ECharts/CJS) | **surface** — input-side interop boundary (`docs/architecture.md` §5) | Keep both; note direction of data flow |
| **overflow filtering / truncation warning** | *(none — render-all or silent SVG clip)* | **gap** — concrete, low-risk import (see §4) |
| `accessor` (`ctx.xGet`/`ctx.yGet`) | same — **accessor** | **accessor** (vizform-only, keep) |
| — | **tween cell** | keep, no flint equivalent |
| — | **gate** (TWEEN vs SNAP routing) | keep, no flint equivalent |

Detail on each row, cited:

- **Tile spec vs. `ChartAssemblyInput`.** Flint's input (`packages/flint-js/src/core/types.ts:944`) is stateless and fully self-describing — data inline or by URL, `chart_spec`, `semantic_types`. Vizform's tile is a live reference into a reactive `Dataset` plus a persisted config diff (`DockView.ts` reads `{kind, measureKey, sortBy, orientation, xKey, yKey, ...}`, per `wiki/chart-schema-design.md` §6; proposed new shape in the same doc's §4.9). Don't conflate: vizform can never be "just a spec you hand to a compiler," because the chart holds live cells, not a rendered snapshot.
- **Binding vs. encoding.** `chart_spec.encodings` (e.g. `{x: {field:"Stage"}, y:{field:"Value"}, color:{field:"Series"}}`) is declarative and re-derived on every assemble. Vizform's `Binding` (`xBinding`, `yBinding`, `orderBinding` — custom-element props, `docs/architecture.md` §5 and `packages/bireactive/src/chart-schemas.ts`) is a **reactive cell** — swapping it is what triggers the tween gate (`docs/architecture.md` §3-4). Same concept, opposite runtime contract: flint's is stateless, vizform's is stateful.
- **Channel.** Vizform has the concept (which visual property a binding drives) but never named it — it's baked into property names (`xBinding` vs `yBinding`) instead of being a first-class value. Worth adopting flint's word outright; see §4.
- **Field vs. measureKey/dimKey.** Flint doesn't pre-split fields into measure/dim — that split is inferred at Phase 0 from semantic type + `aggRole`. Vizform bakes the split into the schema up front (`ColumnSchema.type: 'measure'|'dim'|'name'|'parent-ref'|'edge-source'|'edge-target'`, `packages/core/src/types.ts:26-31`). Keep vizform's split; borrow flint's word "field" as the generic term when type doesn't matter yet.
- **Semantic type vs. `ColumnSchema`.** Flint's `TypeRegistryEntry` (`type-registry.ts:57`) carries 9 dimensions per type: `t0`/`t1` family, `visEncodings`, `aggRole`, `domainShape`, `diverging`, `formatClass`, `zeroBaseline`, `zeroPad`. Vizform's `ColumnSchema` (`packages/core/src/types.ts:26-31`) only carries `key, label, type, rollup?, unit?`. It answers "is this a measure" but not "is zero meaningful here," "how should ties break," or "what format." This is the single biggest gift in this doc — see §4 and §5.
- **Template collision.** Flint's `ChartTemplateDef` (`{chart, template: {mark, encoding}, channels, markCognitiveChannel, instantiate, pivot?}`) is a compiler-side codegen recipe, one per chart type (~30 of them). Vizform has no current use of the word; the natural analog is a chart's `Diagram` subclass (`docs/architecture.md` §5) plus its proposed `ChartSchema` (`wiki/chart-schema-design.md` §4.1). Never say "template" unqualified across both systems.
- **Assemble vs. render.** Flint has no notion of "update in place" — every field swap re-assembles from scratch, no runtime state carried forward. Vizform's whole value prop is the opposite: `Diagram.scene(s)` runs once on `connectedCallback`, then cells re-derive incrementally (`docs/architecture.md` §2, steps 4-5). Don't call vizform's render path "compile" — that word implies flint's stateless batch semantics.
- **`LayoutResult` gap.** Flint's Phase 1 (`core/compute-layout.ts`) produces a target-agnostic `LayoutResult` — `subplotWidth/Height`, `xStep/yStep`, `xLabel/yLabel` sizing decisions, `facet`, `truncations` — consumed identically by all three backends. Vizform computes layout inline per-chart; each `Diagram` subclass owns its own scale/step math in `scene()`. No shared "given N categories and W px, decide step size + truncation" module exists. Real architecture gap, not just a naming one.
- **Pivot gap.** `ChartTemplateDef.pivot` / `getChartPivot(spec)` declares named alternative views (orientation swap, series swap) without a full spec rewrite. Vizform's closest thing is the bar chart's `orientation` config field — ad hoc, per-chart, not a declared/discoverable surface.
- **Mark collision.** Flint's mark (`template.mark`, e.g. `"bar"`, `"point"`; classified by `markCognitiveChannel: 'position'|'length'|'area'|'color'`) is a declarative choice baked into a template def — never changes at runtime. Vizform's mark (`packages/bireactive/src/shapes/` — `rect`, `circle`, `path`, `label`) is a live scene-graph node with reactive cells wired to tween state, read via `ctx.xGet/yGet`. Same word, opposite temporality — flint's mark never animates; vizform's does, that's the whole point of the tween/gate machinery.
- **Backend vs. surface.** Flint's "backend" (Vega-Lite/ECharts/Chart.js, `02-flint-backends.md` §2) is which rendering library receives the compiled spec — output side, no formal `interface Backend`, parallel-module-shaped by convention. Vizform's "surface" (`docs/architecture.md` §5) is the interop contract a framework host uses to talk to a chart — input/lifecycle side. Not a true collision, but easy to conflate in prose since both answer "who renders this."
- **Overflow/truncation gap.** Flint's `filter-overflow.ts` ranks discrete values by frequency against a channel budget, drops the rest, and emits a `TruncationWarning[]` the caller can render as "+N more." Vizform charts today either render every category (perf risk on large domains) or silently clip via the SVG viewport with no user-facing signal. Concrete, low-risk import — see §4.
- **Vizform-only, keep as-is.** `accessor` (`chart-context.ts:21`), **tween cell**, and **gate** (`docs/architecture.md` §3-4) have no flint equivalent — flint resolves encodings once into `ChannelSemantics` and never re-reads per datum, and it doesn't animate at all (`02-flint-backends.md` §7: "Animation: not configured"). No renaming needed, just noting flint has nothing to map onto.

## 3. Collisions & traps

- **"template."** Flint: a per-chart-type compiler recipe (`ChartTemplateDef`, code-level, ~30 instances, each declares `mark`, `channels`, `instantiate()`). Vizform: no current use of the word, but the natural candidate is a chart's `Diagram` subclass or its future `ChartSchema`. **Rule: never say "template" unqualified in a doc that discusses both systems — say "flint template" or "chart schema/class."**
- **"spec."** Flint: `ChartAssemblyInput` / `chart_spec` — a serializable, stateless JSON blob, the *entire* input to the compiler. Vizform: closest usage is the persisted tile config (`{kind, config: {...}}`, `wiki/chart-schema-design.md` §6) — but that's a config diff against a live `Dataset` + chart class, not a self-contained spec. **Rule: "spec" in a vizform context always means "persisted config for one tile," never "everything needed to render," because the data reference and chart class are separate from it.**
- **"mark."** Same word, opposite temporality. Flint's mark is chosen once at template-authoring time and never changes at runtime. Vizform's mark is a live shape node with a tween cell attached. **Rule: qualify every use — "flint mark" (declarative) vs "scene mark"/"shape" (live, in `packages/bireactive/src/shapes/`).**
- **"render."** Flint doesn't really have a render step — it assembles a *spec* that some other renderer (Vega runtime, ECharts, Chart.js) consumes. Vizform's "render" is the actual DOM/SVG paint, done by `Diagram.scene(s)` and kept live via reactive cells. **Rule: "render" in flint-comparison prose always means "the output library's paint step," downstream of assemble; in vizform prose it means the chart's own `scene()`.**
- **"channel."** Flint uses it for the declared encoding slot (`x`, `y`, `color`, `size`...) — a spec-level concept. Vizform has the same idea without the word (see `xBinding`/`yBinding` as ad hoc named properties instead of `bindings.x`/`bindings.color`). **Rule: adopting "channel" (see §4) means eventually renaming `xBinding`/`yBinding` conceptually to "binding for channel x/y" — not urgent, but don't let the two usages drift once we start saying "channel" out loud.**
- **"config."** Flint: `chart_spec.chartProperties` / `options` — free-form, per-template. Vizform's proposed `ChartSchema.config` (`wiki/chart-schema-design.md` §4.1) is Zod-validated and shared-vocabulary (`measureKey`, `sortSpec`, `orientation` primitives). **Rule: vizform's "config" is a stricter, schema-checked thing than flint's — don't assume config parity just because both call it config.**

## 4. Gifts worth adopting

One line each — vocabulary (and in some cases the underlying decision logic) worth importing into vizform even without porting flint code.

- **Semantic type (vs. raw column type).** `ColumnSchema` (`packages/core/src/types.ts:26-31`) only says measure-vs-dim; it can't answer "is zero meaningful," "how should I format this," or "should this be treated as ordinal." A `semanticType` field (even a much smaller lattice than flint's 70) would let every chart stop hand-rolling zero-baseline and format logic per-chart.
- **Channel.** Vizform has the concept (binding target) but no noun for it. Naming it unblocks a cleaner `ChartSchema.config` shape: bindings become `{ channel: 'x' | 'y' | 'color' | ..., field }` instead of one differently-named property per chart (`xBinding` vs `dataCell` vs `measureKey`).
- **Zero-baseline decision.** Flint's `computeZeroDecision()` derives "should this axis start at zero" from the semantic type's `zeroBaseline` dimension (`meaningful`/`arbitrary`/`contextual`/`none`), not from chart type. Vizform charts currently don't have this as an explicit, inspectable decision at all — it's implicit in whatever each chart's scale-building code does. Worth lifting as a named function even before the schema refactor lands.
- **Elastic budget / gas pressure (`compute-layout.ts`, `decisions.ts`).** Flint's layout phase treats available pixel space as a budget to be distributed across categories/labels with backpressure ("gas pressure") when things don't fit. Vizform has no chart-agnostic equivalent — every `Diagram` subclass reinvents its own step-sizing math in `scene()`. Naming this concept is a precondition for ever sharing layout code across the 18 charts.
- **Cognitive channel (position/length/area/color, `markCognitiveChannel`).** A cheap, useful classification: which perceptual channel is doing the "which value is bigger" work for a given mark. Vizform doesn't currently classify its 18 charts this way. Useful for chart-picker UX ("recommend the best chart for this data") that both `wiki/chart-schema-design.md` (chart/dataset compatibility check, §4.6) and demos already want.
- **Pivot / named view.** A declared "here are the alternate views of the same encoding" surface (orientation flip, series swap) instead of one ad hoc boolean config field per chart. Directly relevant to the `orientation` primitive already proposed in `wiki/chart-schema-design.md` §4.4 — could generalize into a `pivots` capability instead of a single hardcoded enum.
- **Truncation warning.** Flint's overflow filter emits a structured warning object when it drops data to fit a budget. Vizform charts today either render everything (performance risk on large categorical domains) or silently clip via the SVG viewport with no user-facing signal. A `TruncationWarning`-shaped return from any future layout/budget code gives the tile UI something concrete to render ("+12 more categories hidden").

## 5. Implications for `wiki/chart-schema-design.md` (WIN-258)

- **`ColumnSchema` (`packages/core/src/types.ts:26-31`) should grow a `semanticType` field**, not just `type: 'measure'|'dim'|...`. This is the highest-leverage single change — it lets `zeroBaseline`, default format, and default aggregation move out of per-chart code and into data, matching flint's Phase 0.
- **`ChartSchema.config` bindings (§4.4 of the design doc) should be expressed as `{channel, field}` pairs**, not per-chart differently-named properties (`measureKey` vs `xKey`/`yKey` vs `dataCell`). This is exactly the normalization problem §2a of the design doc already flags ("two different key names for 'the measure'") — adopting "channel" as a first-class concept is the fix, not just a naming nicety.
- **`ChartSchema.capabilities` (§4.7) is a natural home for a `pivots` list** (borrowing flint's pivot concept) instead of baking `orientation` in as a single hardcoded config primitive. Lets a chart declare "I support orientation flip" and "I support series swap" independently, discoverable the same way `scrollBody`/`cascadeSupported` are today.
- **Validation error messages should borrow truncation-warning language.** When `chart.data.safeParse(candidate)` (§4.6) rejects a dataset for exceeding cardinality/shape limits, the message shape should look like flint's `TruncationWarning` (what was dropped, why, how many) rather than a generic Zod validation error — more actionable for both the hotbook UI and a future APITable config panel.
- **`FlatRowset`/`HierRoot`/`EdgeSet` (§4.6) are vizform's version of flint's `data` + `semantic_types` input** — worth treating the `MeasureDef`/`DimDef` primitives listed in §5a of the design doc as the landing spot for `semanticType`, not a separate concept bolted on later.
- **The `ui.widget` hints (§4.4, e.g. `'measure-picker'`, `'sort-picker'`) could be driven by cognitive-channel classification** — a picker for a "color" channel binding a categorical field behaves differently than one for a "position" channel binding a quantitative field; that distinction doesn't exist yet in the schema design.
- **No layout-budget equivalent is proposed anywhere in WIN-258, and it should be**, even out of scope for Stage 1-2. `capabilities` currently only covers presentation *contracts* (scroll, cascade, drill) — nothing covers "how does this chart behave when it doesn't have enough pixels for all its categories." Flint's `LayoutResult`/budget system is the reference shape if/when this gets tackled.
- **Rename discipline**: once "channel" is adopted as vocabulary, the design doc's own examples (§4.4's `BarChartConfig` with `measureKey`, `sortBy`, `orientation`) read as chart-specific config, not channel bindings — worth being explicit in Stage 2 about which config fields are "channel bindings" (data-shape-coupled, should use the shared primitive) vs. "chart behavior config" (sortBy, colorMode — chart-specific, no flint analog needed).

## 6. Open questions

1. Do we actually want a semantic-type lattice, or just a handful of boolean/enum flags on `ColumnSchema` (`zeroBaseline`, `formatClass`) without the full 70-type, 9-dimension flint registry? Flint's registry is overkill for 18 charts; a 5-8 type lattice might get 80% of the value.
2. Is "channel" worth a real rename of `xBinding`/`yBinding`/`orderBinding` now, or just a conceptual label until the schema refactor forces the actual property rename?
3. Should `pivots` (orientation/series-swap declaration) land in WIN-258 Stage 2 alongside `bar`/`sunburst`, or is it a separate follow-up ticket — the design doc's Stage boundaries don't currently have a slot for it?
4. Does the truncation-warning concept belong in `@hotbook/schemas` validators (`data.safeParse`) or in the layout/scene layer per-chart? The two live in different packages today (`schemas` has no DOM, per §4.3 of the design doc) and truncation is fundamentally a layout-time decision, not a data-shape validation.
5. Is there appetite to prototype a chart-agnostic layout-budget module (flint's Phase 1 analog) as a spike, or does that stay out of scope until a second/third chart family surfaces the duplication pain concretely?
6. Should this doc's collision table live permanently somewhere (e.g. folded into a future `UBIQUITOUS_LANGUAGE.md` at repo root) once vizform's own vocabulary stabilizes post-WIN-258, rather than staying scoped to the flint intake folder?
