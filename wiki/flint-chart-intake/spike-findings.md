# Spike findings: Flint steel thread (spec → 3 native backends + neutral IR)

Spike dir: `vizform/inspo/spikes/flint-steel-thread` (gitignored, not committed).
Script: `spike.mjs`. Package: `flint-chart@0.2.1` from npm (not the cloned repo).

## Result: worked end-to-end on the first real run, no wall hit

All five things the ticket asked for came back green in one `node spike.mjs` run:
`assembleVegaLite`, `assembleECharts`, `assembleChartjs`, the Phase 0/1 core pipeline
(`resolveChannelSemantics` → `computeChannelBudgets` → `filterOverflow` → `computeLayout`),
and `getChartOptions` / `getChartPivot`.

## Input spec used

Bar chart, 12 monthly rows, `YearMonth` × `Amount` semantics:

```js
{
  data: { values: [{ Month: '2024-01', Revenue: 12000 }, /* ...12 rows */] },
  semantic_types: { Month: 'YearMonth', Revenue: 'Amount' },
  chart_spec: {
    chartType: 'Bar Chart',
    encodings: { x: { field: 'Month' }, y: { field: 'Revenue' } },
    baseSize: { width: 480, height: 320 },
  },
  options: { addTooltips: true },
}
```

## Exact API surface used

- Root package (`flint-chart`): `assembleVegaLite(input)`, `assembleECharts(input)`,
  `assembleChartjs(input)`, `getChartOptions(input)`, `getChartPivot(input)`,
  `vlGetTemplateDef(chartTypeName)` (used only to reach a template's
  `declareLayoutMode`, see friction note below).
- Subpath `flint-chart/core` (VL-free): `resolveChannelSemantics(encodings, data,
  semanticTypes, convertedData?)`, `computeChannelBudgets(channelSemantics,
  declaration, data, canvasSize, options)`, `filterOverflow(channelSemantics,
  declaration, encodings, data, budgets, allMarkTypes)`, `computeLayout(channelSemantics,
  declaration, table, canvasSize, options?, facetGrid?)`, `convertTemporalData(data,
  semanticTypes)`.
- All signatures matched the `.d.ts` files in `node_modules/flint-chart/dist/`
  exactly — no reverse engineering beyond reading `dist/index.d.ts`,
  `dist/core/index.d.ts`, and `dist/types-4a-N1nQu.d.ts`.

## IR sample (`out/ir.json`, trimmed to 2 channels + key layout fields)

`ChannelSemantics` (Phase 0 output, before the assembler finalizes `zero`):

```json
{
  "x": {
    "field": "Month",
    "semanticAnnotation": { "semanticType": "YearMonth" },
    "type": "temporal",
    "sortDirection": "ascending",
    "nice": true,
    "stackable": false,
    "temporalFormat": "%b"
  },
  "y": {
    "field": "Revenue",
    "semanticAnnotation": { "semanticType": "Amount" },
    "type": "quantitative",
    "tooltipFormat": { "pattern": ",.2f" },
    "aggregationDefault": "sum",
    "sortDirection": "ascending",
    "binningSuggested": true,
    "nice": true,
    "stackable": "sum"
  }
}
```

`LayoutResult` (Phase 1 output — target-agnostic pixel budget):

```json
{
  "subplotWidth": 416,
  "subplotHeight": 320,
  "xStep": 32,
  "yStep": 32,
  "xContinuousAsDiscrete": 12,
  "yContinuousAsDiscrete": 0,
  "xNominalCount": 0,
  "yNominalCount": 0,
  "xLabel": { "fontSize": 10, "labelLimit": 100 },
  "yLabel": { "fontSize": 10, "labelLimit": 100 },
  "stepPadding": 0.1,
  "effectiveFacetGap": 0,
  "truncations": []
}
```

Also captured: `LayoutDeclaration` (`{ axisFlags: { x: { banded: true } } }`) and
`ChannelBudgets` (`{ maxValues: { x: 120, y: 80, column: null, row: null, color: 24 } }`).

## Native spec sample (Vega-Lite, trimmed)

```json
{
  "mark": { "type": "bar", "size": 29 },
  "encoding": {
    "x": {
      "field": "Month", "type": "temporal",
      "scale": { "nice": false, "domain": ["2023-12-16T18:32:43.636Z", "2024-12-16T05:27:16.363Z"] }
    },
    "y": {
      "field": "Revenue", "type": "quantitative",
      "scale": { "zero": true },
      "axis": { "format": ",.12~g" }
    }
  },
  "config": {
    "view": { "continuousWidth": 416, "continuousHeight": 320 },
    "axisX": { "labelLimit": 100, "labelFontSize": 10 },
    "axisY": { "labelFontSize": 10 },
    "facet": { "spacing": 32 },
    "mark": { "tooltip": true }
  }
}
```

ECharts and Chart.js specs (`out/echarts.json`, `out/chartjs.json`) came back as
expected native shapes — category axis + bar series for ECharts, `type: 'bar'`
dataset config for Chart.js — both consuming the same 12-row table and the same
formatted labels/step sizing derived from the shared `LayoutResult`.

## Pivot / options API

- `getChartOptions(input)` returned 4 `ChartOption`s for the bar chart: `cornerRadius`
  (continuous, 0–15), `independentYAxis` (binary, not applicable here), `xAxisType`
  and `yAxisType` (discrete enum, temporal vs nominal toggle — `yAxisType` not
  applicable since Y is quantitative). This is the control-rendering surface a
  host UI would use to build a properties panel.
- `getChartPivot(input)` returned a real `PivotSurface` for Bar Chart: a 2-option
  `View` pivot (`default`, `flip:x-y`) — i.e. orientation swap is a first-class
  alternative view, not something a caller has to hand-roll.

## Bundle / install footprint

- `npm install flint-chart` — 1 package, 0 dependencies, 0 vulnerabilities, ~2s.
- `node_modules/flint-chart` = 23M total, but that includes published `src/`
  (per `files` in package.json); the actual `dist/` JS is **2.6M**.
- Package ships dual ESM/CJS builds (`dist/index.js` + `.cjs`) plus one
  `.d.ts`/backend, so consuming from a plain ESM Node script needed zero
  transpilation — `"type": "module"` in the spike's own package.json was the
  only requirement.

## Friction

- **One real gap**: there is no root/core-level "give me the `LayoutDeclaration`
  for chart type X" export. `declareLayoutMode` lives on a backend's
  `ChartTemplateDef` (reached via `vlGetTemplateDef('Bar Chart')` in this spike),
  even though `LayoutDeclaration` and everything it touches
  (`ChannelSemantics`, `computeChannelBudgets`, `computeLayout`) is itself
  backend-neutral. A 4th backend currently has to either duplicate a `vlGetTemplateDef`-shaped
  call into one of the three existing backends just to get the declaration, or
  reimplement `declareLayoutMode` for every chart type it wants to support. This
  matches the backends doc's finding: "no formal Backend interface — the
  contract is by convention."
- Minor oddity, not a blocker: the Vega-Lite `x` scale domain for the `YearMonth`
  field came back as fractional-day ISO timestamps (`2023-12-16T18:32:43.636Z`)
  rather than clean month boundaries — looks like `YearMonth` → `Date` coercion
  interpolating between the 12 monthly buckets for the "nice" domain rather than
  snapping to month starts. Cosmetic for this spike (didn't affect the IR or the
  other two backends), but worth a closer look if `YearMonth` axes matter for
  vizform.
- No other warnings, errors, or type mismatches. All 4 core pipeline stages
  and both convenience APIs worked against their documented signatures with the
  published package, no source-level workarounds needed.

## Feasibility assessment for a 4th (vizform/bireactive) backend

- **High feasibility for the semantic layer.** `ChannelSemantics` is already
  fully backend-neutral JSON — field, resolved encoding type, format specs,
  scale hints, sort/ordinal info, color scheme recommendation, stackability.
  A bireactive backend consuming this needs no Flint-specific knowledge beyond
  the type definitions themselves.
- **High feasibility for the layout layer.** `LayoutResult` gives exactly the
  pixel-budget primitives (`subplotWidth/Height`, `xStep/yStep`, `stepPadding`,
  label sizing, facet grid) a from-scratch renderer needs to lay out axes and
  marks without re-deriving any of Flint's elastic-budget/gas-pressure math.
  This is the strongest part of the steel thread — it's genuinely
  target-agnostic, not merely VL-flavored.
- **Medium friction at the seam between Phase 0 and Phase 1.** `LayoutDeclaration`
  (needed by both `computeChannelBudgets`/`filterOverflow` and `computeLayout`)
  is sourced from a specific backend's `ChartTemplateDef.declareLayoutMode`,
  not from a chart-type-keyed core registry. A vizform backend calling the core
  functions directly (as this spike did) has to pick one existing backend as
  its "declaration donor" per chart type, which is a soft dependency on that
  backend's template catalog even though the declaration itself carries no
  VL/EC/CJS-specific data.
- **Phase 2 (native instantiation) is 100% new work per chart type**, as the
  backends doc already estimated — the IR only gets you through Phase 1; a
  bireactive renderer still needs its own axis/mark/legend placement code per
  chart type, using `ChannelSemantics` + `LayoutResult` as inputs rather than
  computing scale/format/zero-baseline decisions itself.
- **Packaging is a non-issue.** Dependency-free, dual ESM/CJS, small dist
  (2.6M), typed. A vizform backend can import `flint-chart/core` standalone
  (no VL/EC/CJS pulled in) and layer its own Phase 2 module the same way the
  three existing backends do.
- **Net read**: the "resolve semantics, compute layout, then translate" seam is
  real and clean enough to build against today; the only structural gap is that
  `declareLayoutMode` should ideally be promoted to (or duplicated at) the core
  level, keyed by chart type, so a 4th backend doesn't have to import a
  sibling backend just to bootstrap its own layout declarations.
