# Chart schema-driven config — design doc (WIN-258)

> Status: **draft for discussion**. This is the first deliverable of WIN-258.
> Nothing here is committed until Winston lands on an approach. The migration
> path in §10 is written to be reversible if we change tack after a stage.

## 1. Problem

Today a chart does not declare what it accepts. Two symptoms:

1. **The config-UI story is off-chart.** `apps/hotbook/src/tile-config-schemas.ts`
   holds a hand-maintained map from `TileKind` to a bag of boolean pickers
   (`measure`, `sort`, `depth`, `orientation`, `xKey`, `yKey`, `groupBy`).
   `DockView.ts` (~L599–715) reads that bag and builds `<select>` elements
   inline. Adding a new picker means editing three files that don't know each
   other: the chart, the type in `@hotbook/core`, and the DockView renderer.
2. **The data-shape story is nowhere.** Nothing declares "this chart needs a
   flat rowset with one numeric measure" vs. "this chart needs a
   `containmentForest` with N measures rolled up sum." The knowledge exists in
   the chart's constructor + how the caller wires `externalRoot`, `measureKey`,
   etc. — it can't be introspected, validated, or driven by an editor.

Consequence: the demos page and hotbook each re-implement "how do I feed this
chart" in prose. Extensions (APITable) have no shared surface to build config
UI against. The migration to a framework (Svelte, later maybe React) will
either duplicate that prose again or block on this refactor.

WIN-258 is the schema refactor, spun out of WIN-255.

## 2. Current state (audit)

### 2a. What a chart accepts today

Charts are custom elements (extend `Diagram`) exposing reactive cells as
properties. `MdSunburstLC` (`packages/bireactive/src/charts/sunburst.ts`):

```ts
externalRoot?: BiNode          // hierarchical data
drillKey?: string              // shared drill context id
maxDepth?: number              // depth clamp
drillNodeId: string | null
sortBy: 'index' | 'value'
measureKey: string             // which measures.<key> drives area
```

`MdBarChartLC` (`bar-chart.ts`):

```ts
dataCell: cell<readonly Bar[]>     // flat, {id,label,value}
orientation: 'vertical' | 'horizontal'
// (plus color/label/valueMode via constructor opts, not shown)
```

Two different shapes (`BiNode` tree vs. `Bar[]`), two different key names for
"the measure," no shared vocabulary. The consumer has to know this per chart.

### 2b. What `@hotbook/core` exports today

`packages/core/src/types.ts` L108–124 defines `VizConfigSchema`:

```ts
export interface VizConfigSchema {
  pickers: { measure?: boolean; depth?: boolean; sort?: boolean;
             groupBy?: boolean; xKey?: boolean; yKey?: boolean;
             orientation?: boolean }
  gestureModes?: ScalingMode[]
  cascadeSupported?: boolean
  fixedTotalSupported?: boolean
  scrollBody?: boolean
  drillKey?: string
  showBreadcrumb?: boolean
}
```

That's the entire schema surface. It answers "which pickers should the tile
header show" and nothing about data shape. The pickers themselves are
booleans — the domain of each (e.g. sort options `[index, value]`) is
hard-coded in `DockView._buildTileHeader`.

### 2c. Where it's consumed

Exactly one consumer: `apps/hotbook/src/DockView.ts` L599–715. Same file
hand-builds each `<select>`, hard-codes the options list, and wires the
change handler to a `tileRec.on*Change` callback. `TileRecord` (the state
adapter) is another hand-maintained shim between the tile persistence model
and the chart properties.

Not consumed by: the demos page (`apps/demos`) — it wires props directly.
Not consumed by: `packages/apitable` — currently stale, no config UI.

### 2d. Where per-chart knowledge leaks

- Sort options domain `[index, value]` — `DockView.ts:635`.
- Depth options domain `[0..5]` — `DockView.ts:621`.
- Orientation default (bar → vertical, else horizontal) — `DockView.ts:648`.
- Scatter's default X `_index` — `DockView.ts:668,673`.
- `maxDepth === 0 → undefined` mapping — inside chart adapters.

Every one of these is a fact the chart already "knows." Today the DockView is
where it lands.

## 3. Goals & non-goals

### 3.1 Goals

1. **Charts declare their own schema.** A chart module exports its data shape
   and its configuration schema. Nothing about "which pickers, with what
   options" lives in a downstream registry.
2. **One schema type, two audiences.** The same schema drives both (a) the
   config-editing UI in hotbook/DockView and eventually apitable, and (b)
   runtime validation of the config object saved in a dashboard.
3. **Framework-agnostic core.** The schemas + validators live in a package
   with no DOM dependency, so a Svelte or React tile shell can consume them
   later without a rewrite.
4. **JSON-Schema-shaped enough** to feed a schema-form renderer (rjsf-style)
   for the "long tail" of options we don't want to hand-code widgets for.
5. **Static enough for extensions.** APITable's field-config panel is built
   once at extension install time — it needs a schema it can serialize +
   render without importing the chart's runtime.
6. **Backwards-compatible migration.** Existing persisted dashboards keep
   working through the whole rollout. Each stage is a merged PR that ships;
   nothing is a big-bang rewrite.

### 3.2 Non-goals (this ticket)

- Deleting the current `VizConfigSchema` / `TILE_CONFIG_SCHEMAS`. It stays as
  the compatibility surface while charts opt in.
- De-Reacting or Svelte-porting anything. This ticket makes that easier; it
  is not that ticket.
- Reworking data pipelines (`applyView`, group-by, drill). Those consume the
  same `VizNode` today and will keep doing so.
- Palette / color-strategy schema — WIN-255 item 6 is a sibling and should
  slot into the same schema surface, but its picker taxonomy is out of scope
  here.

## 4. Design

### 4.1 What "chart schema" means

A chart schema is the pair:

```ts
interface ChartSchema<Config = unknown, Data = unknown> {
  /** Machine id — "bar", "sunburst", "sankey"…                              */
  kind: string
  /** Human label / description for pickers & docs.                          */
  label: string
  /** Data-shape schema — what `input` the chart binds against.              */
  data: ValidatorSchema<Data>
  /** Config-shape schema — everything editable per-tile.                    */
  config: ValidatorSchema<Config>
  /** Optional presentation hints for the schema-form renderer.              */
  ui?: UiHints<Config>
  /** Capabilities / behavior flags (drill, scroll, cascade…).               */
  capabilities?: Capabilities
}
```

Two shapes: `data` (what the chart consumes) and `config` (what a user
edits). Both are validators; both are traversable metadata. `ui` is
JSON-Schema-form's `uiSchema` in spirit: order, widget hint, labels.

### 4.2 The validator library — Zod vs. Valibot

Both are considered. Recommendation and rationale:

|                              | Zod (v3.23+) | Valibot (v0.x)           |
| ---------------------------- | ------------ | ------------------------ |
| Bundle size                  | ~13 KB       | ~1-2 KB (tree-shakable)  |
| Ergonomics for a UI editor   | `.describe`, `.default`, `.meta` — feels designed for it | Modular; metadata via `.pipe` |
| Introspection (build widgets)| Direct AST (`_def`) — well-trodden path (rjsf-zod adapters exist) | Object AST — newer, fewer adapters |
| JSON-Schema export           | Multiple mature packages (`zod-to-json-schema`) | `@valibot/to-json-schema` — real but younger |
| Types-first ergonomics       | Excellent  | Excellent |
| Ecosystem breadth            | Huge       | Small but growing |
| Downstream package weight    | Charged once at the boundary | Basically free in extensions |

Recommendation: **Zod for the core schemas, at the `@hotbook/core` layer.**
Reasoning: (1) we already carry non-trivial JS in the bundle; the extra ~12KB
buys us the mature `zod-to-json-schema` + `@rjsf/*` pipeline, which is what
turns "chart declares config" into "APITable renders a form" without us
hand-writing widgets; (2) the introspection story is production-tested; (3) a
`ChartSchema` is authored once per chart, imported by app shells — we don't
pay the size in extension bundles unless the extension itself wants runtime
validation.

The *escape hatch*: if the bundle cost bites on `@hotbook/apitable` (embedded
in APITable, size-sensitive), we can dual-publish the introspected JSON
Schema alongside the Zod schema at build time. Extensions consume the JSON
Schema + a tiny runtime; the workspace consumes the Zod object. This keeps
the door open to Valibot in extensions later without re-authoring.

If Winston prefers Valibot for footprint reasons and is willing to spend
adapter-writing time, the design is intentionally isomorphic — swap the
validator import in `@hotbook/core` and the propagation model is identical.

### 4.3 Where schemas live

New package: `@hotbook/schemas` (or fold into `@hotbook/core` — see §11).

```
packages/schemas/src/
  index.ts             # re-exports
  primitives.ts        # shared: measureKey, sortSpec, orientation, depth, drillKey…
  data.ts              # shared data-shape schemas: FlatRowset, HierRoot, EdgeSet
  charts/
    bar.ts             # BarChartSchema — imports primitives + FlatRowset
    sunburst.ts        # SunburstChartSchema — HierRoot + drillKey + depth
    scatter.ts         # ScatterChartSchema — FlatRowset + xKey/yKey
    ...
  types.ts             # ChartSchema<>, UiHints, Capabilities
  registry.ts          # Map<kind, ChartSchema> + register/lookup
```

The chart *implementation* (in `@hotbook/bireactive`) imports its schema
from `@hotbook/schemas` and re-exports it alongside the class:

```ts
// packages/bireactive/src/charts/bar-chart.ts
import { BarChartSchema } from '@hotbook/schemas/charts/bar'
export { BarChartSchema }
export class MdBarChartLC extends Diagram { … }
```

Rationale: the schema is *data* about the chart. It has no bireactive
runtime dependency and it should be consumable by an extension that never
loads the DOM chart element. Charts and their schemas are shipped as a pair;
consumers pick which they need.

### 4.4 Anatomy of a chart schema (example)

```ts
// packages/schemas/src/charts/bar.ts
import * as z from 'zod'
import { measureKey, sortSpec, orientation, FlatRowset } from '../primitives'

export const BarChartConfig = z.object({
  measureKey: measureKey.describe('Value measure'),
  sortBy:     sortSpec.default('index'),
  orientation: orientation.default('vertical'),
  colorMode:  z.enum(['single', 'palette']).default('palette'),
  labelMode:  z.enum(['axis', 'inside', 'both']).default('axis'),
})
export type BarChartConfig = z.infer<typeof BarChartConfig>

export const BarChartSchema: ChartSchema<BarChartConfig, FlatRowset> = {
  kind: 'bar',
  label: 'Bar chart',
  data: FlatRowset,
  config: BarChartConfig,
  ui: {
    order: ['measureKey', 'sortBy', 'orientation', 'colorMode', 'labelMode'],
    fields: {
      measureKey: { widget: 'measure-picker' },
      sortBy:     { widget: 'sort-picker' },
      orientation:{ widget: 'segmented' },
    },
  },
  capabilities: { scrollBody: false, cascadeSupported: false },
}
```

Notes:

- `measureKey`, `sortSpec`, `orientation` are shared primitives. Same field
  key means same widget everywhere. The scatter chart uses `xKey`/`yKey`
  that reuse `measureKey` under different labels.
- `.default()` folds "what does DockView pick when the tile is created" back
  into the schema. Chart-level defaults (bar → vertical) live in the schema,
  not in the DockView.
- Every domain (`sortBy` = `['index', 'value']`) is enumerated in the
  primitive, not in the header renderer.
- `ui.widget` is a *hint*, not a dependency. A renderer that doesn't
  recognize `measure-picker` falls back to a generic string enum widget
  driven by the runtime-resolved measure list.

### 4.5 Runtime-resolved enums (`measureKey`, `dimKey`)

The tricky part: the *domain* of `measureKey` depends on the dataset the
tile is bound to, not on the chart. Two approaches:

- **A) Late-bound enum.** Schema exports `measureKey` as `z.string()` +
  `ui.widget: 'measure-picker'`; renderer looks the domain up from the
  bound `Dataset` (has `measureDefs: MeasureDef[]`) and builds the options.
  Recommended default — the schema stays static, the widget is smart.
- **B) Schema-injection.** At render time, the tile shell calls
  `chart.config.extend({ measureKey: z.enum(datasetMeasureKeys) })` before
  handing to rjsf. Better for pure JSON-Schema pipelines (APITable), where
  we materialize the schema into JSON and want the options embedded.

Ship (A) for hotbook (fast); reuse the *same widget hint* under (B) when
APITable is built. Both use `Dataset.measureDefs` as source of truth.

### 4.6 Data-shape schemas

`FlatRowset`, `HierRoot`, `EdgeSet` in `primitives.ts`:

```ts
export const FlatRowset = z.object({
  rows:  z.array(z.object({ id: z.string(), name: z.string(),
                            measures: z.record(z.number()) })),
  measures: z.array(MeasureDef),
  dims:     z.array(DimDef).optional(),
})

export const HierRoot = z.object({
  root:     BiNodeSchema,          // recursive z.lazy(...)
  measures: z.array(MeasureDef),
})

export const EdgeSet = z.object({
  nodes: z.array(VizNodeSchema),
  edges: z.array(z.object({ source: z.string(), target: z.string(),
                            value: z.number() })),
  measures: z.array(MeasureDef),
})
```

Purpose: gives the tile shell one call — `chart.data.safeParse(candidate)` —
to decide "can this dataset feed this chart?" That is what powers the "pick a
chart for this dataset" affordance (WIN-255 mentions this in demos), and
what will let APITable's config panel refuse an incompatible field mapping.

### 4.7 Capabilities (leftover)

`capabilities` absorbs the current `VizConfigSchema` non-picker flags
(`scrollBody`, `drillKey`, `showBreadcrumb`, `gestureModes`,
`cascadeSupported`, `fixedTotalSupported`). These aren't config the user
edits — they're presentation contracts for the tile shell. Keep them
separate from `config`.

### 4.8 Registry

```ts
// packages/schemas/src/registry.ts
export const chartRegistry = new Map<string, ChartSchema>()
export function registerChart<C, D>(s: ChartSchema<C, D>) {
  chartRegistry.set(s.kind, s as ChartSchema)
}
```

Charts self-register on module import. The DockView (or any tile shell)
does `chartRegistry.get(kind)` in place of the current `schemaFor(kind)`
call. Retired kinds fall through to a null-object render (same as today's
`EMPTY`).

### 4.9 Propagation through packages

```
┌────────────────────────┐
│ @hotbook/schemas       │  Zod schemas + ChartSchema type + registry
│  – no DOM, no d3       │  Tiny; safe for extensions
└──────────┬─────────────┘
           │ depended on by
           ▼
┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
│ @hotbook/bireactive    │  │ @hotbook/core          │  │ @hotbook/apitable      │
│  charts import their   │  │  Dataset + MeasureDef  │  │  builds config UI      │
│  own schemas & register│  │  reference primitives  │  │  from schema JSON      │
└──────────┬─────────────┘  └───────┬────────────────┘  └───────────┬────────────┘
           │                        │                                │
           ▼                        ▼                                ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│ apps/hotbook (DockView) & apps/demos (demo page)                              │
│  Look up chartRegistry.get(kind) → build header widgets from ChartSchema.ui  │
│  Same code path for both apps.                                                │
└───────────────────────────────────────────────────────────────────────────────┘
```

`@hotbook/schemas` sits *below* `@hotbook/core` (in the dependency arrow
above, `core` references primitives; charts reference both). If `core` also
depends on `schemas`, dependencies stay a DAG.

Alternative: fold `schemas` into `core`. Cheaper long-term (one package to
version); tolerable Zod-in-core cost given `core` is already imported
everywhere. Winston's call — see §11.

### 4.10 Extension surface (APITable)

The APITable extension config panel:

1. Import `@hotbook/schemas` at build time.
2. `chartRegistry.get('bar').config` → `zodToJsonSchema(...)` at build → ship
   a JSON blob into the extension bundle. No Zod runtime in the extension.
3. At runtime, extension asks APITable for the field mapping (which
   APITable column = which measure), applies §4.5B schema-injection to
   embed the concrete enum, then renders with a plain JSON-Schema form
   library (rjsf, uniforms, etc.). This is the "some static, some runtime"
   split from the ticket.

This works because the schema is data. Nothing in the extension needs to
know how the chart *renders*; the extension only produces a config object
that gets shipped back through the widget contract and instantiates a chart
somewhere else.

### 4.11 Framework migration story (Svelte, later React)

Because `ChartSchema` is data:

- A Svelte tile shell can render the same schema against a Svelte form
  library. The chart itself is still a custom element (works in Svelte
  templates natively). The header pickers are the only place the framework
  changes — and they're now schema-driven, so we author picker components
  once per framework, not per chart.
- A React shell (hotbook today) does the same. The existing React header in
  `apps/hotbook` becomes a thin generic renderer.
- The *charts* stay bireactive custom elements. Reframing to Svelte later
  is orthogonal to this ticket — see WIN-255 item 1 discussion.

## 5. Contract at each package boundary

### 5a. `@hotbook/schemas` public API

```ts
// exports
export type ChartSchema<C = unknown, D = unknown>
export const chartRegistry: ReadonlyMap<string, ChartSchema>
export function registerChart(s: ChartSchema): void
export function getChartSchema(kind: string): ChartSchema | undefined

// primitives
export { measureKey, dimKey, sortSpec, orientation, depth, drillKey }
export { FlatRowset, HierRoot, EdgeSet, MeasureDef, DimDef }

// per-chart (re-exported by each chart module too)
export { BarChartSchema } from './charts/bar'
// …one per chart
```

### 5b. `@hotbook/bireactive` charts contract

Each chart module `export`s **both** the element class and its schema:

```ts
export { MdBarChartLC } from './bar-chart'
export { BarChartSchema } from '@hotbook/schemas/charts/bar'  // re-exported
```

Chart classes gain no new required constructor args. Optionally, we add a
static `schema` field on the class for reflection:

```ts
export class MdBarChartLC extends Diagram {
  static schema = BarChartSchema
  …
}
```

### 5c. Tile shell contract

Replaces the current `_buildTileHeader` picker cascade with:

```ts
const schema = getChartSchema(tile.kind)
if (!schema) return renderEmptyHeader(tileRec)
const config = schema.config.parse(tile.config ?? {})
renderSchemaForm({ schema, config, ui: schema.ui,
                   onChange: (patch) => tileRec.onConfigPatch(patch) })
```

`renderSchemaForm` is one small file per framework. Not per chart.

## 6. Config storage & migration

Persisted tiles today have shape `{ kind, measureKey, sortBy, orientation,
xKey, yKey, groupBy, depth, drillNodeId, valueBinding, orderBinding,
xBinding, yBinding, ... }` (per `DockView.ts` reads). New shape:

```ts
{ kind: 'bar', config: { measureKey: 'revenue', sortBy: 'value', … } }
```

Migration: read-side compatibility shim. `Tile.parseConfig(kind, raw)`
inspects `raw`; if it's the old flat shape, it maps to the new shape using
per-kind rules once, then `schema.config.safeParse` to validate. Persisted
data is written in the new shape from that point on. Zero user-visible
change; no version bump on persistence needed if we roll it into the
existing tile normalizer.

## 7. Testing & rollout gate

Per repo convention (`CLAUDE.md` and Definition of Done): every stage lands
via PR, live-tested in the Netlify preview. Testing for this refactor:

- **Unit**: `schema.config.parse(defaults)` returns valid object for every
  chart. `schema.data.safeParse(fixture)` passes for the chart's fixture.
- **Snapshot**: `zodToJsonSchema(schema.config)` for every chart, so PRs
  make schema drift visible.
- **Integration**: DockView renders header from schema, tile round-trips
  config through persistence, dashboards from the old schema still open.
- **Manual on preview** (mandatory per repo rules): open hotbook preview,
  change every picker on every chart type, verify visual + persistence.

## 8. Open questions (need Winston's answer before Stage 2)

1. **Zod vs Valibot** — recommendation is Zod (§4.2); confirm or override.
2. **`@hotbook/schemas` vs. fold into `@hotbook/core`** — recommendation is
   its own package for staged rollout, but consolidation is defensible.
3. **Old `VizConfigSchema` — retire in Stage 4 or leave as a legacy adapter
   permanently?** Retiring gives us one truth; leaving costs almost nothing.
4. **Palette/color-strategy schema (WIN-255 item 6)** — same primitive?
   Recommend yes, but the picker taxonomy is a separate ticket.
5. **Chart-viewer capability keys (pan/zoom/scroll, WIN-255 item 2)** —
   these belong in `capabilities`, not `config`. Confirm.
6. **Do we generate JSON-Schema at build time for extensions, or embed
   `zod-to-json-schema` in the extension?** Recommend build-time.
7. **Do datasets get schemas too?** Almost certainly yes — `MeasureDef`,
   `DimDef`, `Dataset` all become Zod schemas in `primitives.ts`. Included
   in scope of Stage 1 below; call out if that's too much.

## 9. Risks

- **Bundle cost.** Zod adds ~12KB gz to the app bundle. Not to extensions
  (build-time JSON schema). Acceptable given what it enables.
- **Refactor scope creep.** Every chart's ad-hoc property surface differs
  slightly (see §2a — different key names). Normalizing to schema means
  editing every chart. Staged rollout in §10 keeps each PR small.
- **Framework churn.** A future Svelte port that lands *before* this
  refactor completes will need to know about both the old picker registry
  and the new schema registry. Land this first.
- **APITable divergence.** Extension has its own build system; JSON schema
  export needs a real integration story, not a wish. Stage 5 spikes it.

## 10. Incremental migration path

Every stage lands as a merged PR. Stages are ordered so intermediate states
are shippable; no big-bang.

### Stage 1 — Introduce `@hotbook/schemas` (no consumer change)

- Create `packages/schemas` with `types.ts`, `primitives.ts`, `registry.ts`,
  data-shape schemas, and Zod schemas for `MeasureDef`/`DimDef`.
- No chart or app changes. Package builds. Snapshot test the primitives.
- **Ship this alone.**

### Stage 2 — Author schemas for two chart kinds (bar, sunburst)

- `packages/schemas/src/charts/bar.ts`, `.../sunburst.ts`.
- Re-export from `packages/bireactive`.
- `BarChartSchema` + `SunburstChartSchema` in the registry on import.
- **No behavior change** — DockView still uses the old `TILE_CONFIG_SCHEMAS`.
- Snapshot the JSON-Schema output. This is where we discover mistakes cheap.

### Stage 3 — Schema-driven DockView (bar + sunburst only)

- `renderSchemaForm` helper in `apps/hotbook`.
- DockView: `if (chartRegistry.has(kind)) renderSchemaForm(...) else oldPath`.
- **Behavior identical** — parity gate. Live-test on preview.

### Stage 4 — Migrate remaining charts

- One chart per PR (or bundled in ~3s: flat, hier, graph groups).
- Delete each entry from `TILE_CONFIG_SCHEMAS` as its schema lands.
- When the last one lands, retire `_buildTileHeader`'s old branches and the
  legacy `VizConfigSchema` type (or dial it down to a deprecated alias per
  Q3 above).

### Stage 5 — Extension proof-of-concept

- Build `apitable` config panel from the JSON-Schema pipeline for one chart.
- Prove the "some static, some runtime" split named in the ticket.
- Ship even if only bar-chart config renders — de-risks the whole story.

### Stage 6 — Framework-agnostic renderer (deferred, tracked separately)

- Extract `renderSchemaForm` from `apps/hotbook` to
  `packages/schema-form-vanilla` (no framework). Sets the Svelte port up.
- Explicitly out of scope for WIN-258; documented so the door isn't shut.

## 11. Recommendation summary (TL;DR)

- One new package `@hotbook/schemas`, Zod-based, no DOM.
- Each chart owns its schema, re-exported next to the class; charts
  self-register into a shared registry.
- DockView (and later APITable / a Svelte shell) is a generic renderer over
  `ChartSchema.config` + `ui`.
- Data-shape schemas live in the same package, unlock validation and the
  "which charts fit this dataset" UI.
- Zod at build time → JSON-Schema for extensions; escape hatch to Valibot
  preserved by isomorphic design.
- Six stages, each a shippable PR, backwards-compatible reads at every
  point.

Open questions in §8 are the ones I'd like Winston's call on before Stage 1
lands.
