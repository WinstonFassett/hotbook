# Plan — extract `@vizform/charts` (Foundation only)

> Handoff for an autonomous agent. **Execute steps in order. Do not ask
> questions — every decision is made here.** Scope is deliberately narrow:
> package the charts; change nothing about how they look or behave.

## Goal

Lift the bireactive charts out of the spike app
`apps/vanilla-bireactive-layercharts-spike/src` into a real publishable package
`packages/vizform-charts`, and make both consumers (sliceboard, the spike app)
import from the package instead of the `@br-lc` source alias. Charts must render
and behave **identically** afterward.

## Scope guardrails (DO / DO NOT)

- **DO NOT** touch chart visuals, gestures, or logic. This is a move + repackage.
- **DO NOT** move sort/group/identity logic out of sliceboard. `sortedNodes` /
  `applyGroupBy` / `colorByGroup` stay in `App.tsx`. (That lift is a *later* plan.)
- **DO NOT** de-React sliceboard. The `BrLcCharts.tsx` React wrappers stay.
- **DO NOT** touch `@vizform/core` contents — it already holds the shared types
  and colors. Charts don't import it; leave it alone.
- **DO NOT** move `@svelte-lc` (the Svelte charts) — leave that app and its alias
  untouched. Deferred.
- **DO NOT** ship demo/seed data: `lib/portfolio.ts` is fixture data — it stays in
  the spike app, not in the package's public exports.
- **Keep the npm scope `@winstonfassett/`** (matches existing packages). The
  `@vizform/*` names in `docs/dependencies.md` are aspirational; renaming the
  scope is out of scope here.
- **Stash, never reset** (per CLAUDE.md). Work on a branch.

## Facts already verified (don't re-investigate)

- sliceboard imports `@br-lc` from **one file only**: `apps/sliceboard/src/viz/br/BrLcCharts.tsx`,
  14 imports, all `@br-lc/demos/*` (no `@br-lc/lib/*`).
- The chart code is self-contained: only imports `bireactive` + `d3-array`,
  `d3-hierarchy`, `d3-scale`, `d3-shape`, and relative `./`. No `vizform-core`,
  no cross-app imports.
- `d3-sankey` appears **only in comments** (`lib/sankey.ts`, `lib/sankey-layout.ts`)
  — it is NOT imported. Do not add it as a dependency.
- Template for the no-build `node` export condition: `packages/vizform-vanilla-d3/package.json`.
- sliceboard vite resolve uses `conditions: ['browser','node']` + `dedupe` — see
  `apps/sliceboard/vite.config.ts`.

## Steps

### 1. Create the package skeleton
- New dir `packages/vizform-charts/`.
- `git mv` the reusable source from the spike app into it:
  - `apps/vanilla-bireactive-layercharts-spike/src/demos/`  → `packages/vizform-charts/src/demos/`
  - `apps/vanilla-bireactive-layercharts-spike/src/lib/`    → `packages/vizform-charts/src/lib/`
  - **Leave behind** in the spike app: `main.ts`, `index.html`, `style.css`,
    `vite.config.ts`, `tsconfig.json`, `package.json`.
  - **EXCEPTION:** `lib/portfolio.ts` is fixture data — `git mv` it back into the
    spike app at `apps/vanilla-bireactive-layercharts-spike/src/fixtures/portfolio.ts`
    and fix the demo importers' relative paths. (It must not be a package export.)

### 2. Package `index.ts`
Create `packages/vizform-charts/src/index.ts` that re-exports every chart class
(so consumers import from the package root, not `demos/*`):
```ts
export { MdBarChartLC } from './demos/bar-chart'
export { MdLineChartLC } from './demos/line-chart'
export { MdAreaChartLC } from './demos/area-chart'
export { MdScatterChartLC } from './demos/scatter-chart'
export { MdPieChartLC } from './demos/pie-chart'
export { MdRadarChartLC } from './demos/radar-chart'
export { MdConcentricArcLC } from './demos/concentric-arc'
export { MdPack } from './demos/pack'
export { MdTreemapLC } from './demos/treemap'
export { MdIcicleLC } from './demos/icicle'
export { MdSunburstLC } from './demos/sunburst'
export { MdSankeySimple, MdSankeyComplex, MdSankeyHierarchy } from './demos/sankey'
export { MdSankeyFlow } from './demos/sankey-flow'
export { MdTreeChart } from './demos/tree-chart'
export { MdBudgetTree } from './demos/budget-tree'
// Public lib types consumers may need:
export type { ElementWithBridge, BrSyncBridge } from './lib/hud-bridge'
export type { BiNode } from './lib/tree'
```
(Adjust the type re-exports to whatever actually compiles — keep classes complete.)

### 3. Package `package.json`
Mirror `packages/vizform-vanilla-d3/package.json` exactly for `type`, `exports`
(the `node` → `./src/index.ts` condition is REQUIRED for no-build HMR),
`publishConfig`, `files`, `scripts`, `license: MIT`. Set:
- `"name": "@hotbook/charts"`, `"version": "0.1.0"`.
- `dependencies`: `bireactive` `^0.3.4`, `d3-array` `^3.2.4`, `d3-hierarchy`
  `^3.1.2`, `d3-scale` `^4.0.2`, `d3-shape` `^3.2.0`.
- `devDependencies`: matching `@types/d3-*`, `typescript`, `vite`, `vite-plugin-dts`.
- Add a `vite.config.ts` + `tsconfig.json` mirroring vanilla-d3's (lib build).

### 4. Repoint sliceboard
- `apps/sliceboard/src/viz/br/BrLcCharts.tsx`: replace the 14 `@br-lc/demos/*`
  imports with named imports from `@hotbook/charts`. The tag
  registry/`useBrElement`/dispatch code stays unchanged.
- `apps/sliceboard/package.json`: add `"@hotbook/charts": "*"` to
  dependencies.
- `apps/sliceboard/vite.config.ts`:
  - Remove the `'@br-lc'` alias (now a real package). **Keep `'@svelte-lc'`.**
  - Add `'bireactive'` to `dedupe` (alongside react/react-dom) so the
    source-resolved package and sliceboard share ONE bireactive runtime.

### 5. Repoint the spike app (keep it as a demo harness on the package)
- `apps/vanilla-bireactive-layercharts-spike/src/main.ts`: change the
  `./demos/*` class imports to `@hotbook/charts`. The registration
  loop, repro-hash harness, and `experiments[]` list stay.
- `apps/vanilla-bireactive-layercharts-spike/package.json`: add
  `"@hotbook/charts": "*"`.
- Its `vite.config.ts` needs the same `conditions: ['browser','node']` so it
  resolves the package to source for live dev (copy from sliceboard).

### 6. Install + verify (all must pass; do not skip)
```bash
npm install                                   # relink workspaces
npx vite build packages/vizform-charts        # package builds (dist + d.ts)
npx vite build apps/vanilla-bireactive-layercharts-spike   # demo app builds
npx vite build apps/sliceboard                # main app builds
```
Then a behavior smoke (per repo memory — real Playwright, not synthetic events):
- Start sliceboard dev; confirm BR-LC tiles render (charts in shadow DOM —
  pierce `el.shadowRoot`).
- Verify one flat chart (bar) and one hier chart (icicle): hover highlights,
  wheel-edit changes a value, drag-resize works, Esc reverts. No console errors.
- Confirm cross-tile hover/select still syncs.

## Done when
- All four builds pass; sliceboard + spike app render identically to before.
- `git grep '@br-lc'` returns **nothing** (alias fully removed).
- `packages/vizform-charts` has a clean `index.ts`, MIT license, `node` export
  condition, and depends only on bireactive + granular d3-*.
- sliceboard, the spike app, and the package each depend on
  `@hotbook/charts` via `*`.

## Out of scope (explicitly deferred — do not start)
- Lifting `applyView`/sort/group into `@vizform/core`.
- **De-Reacting sliceboard / removing `selfSig`/dedupe machinery — this is the
  IMMEDIATE NEXT plan (Winston wants it very soon). Do not start it here, but
  keep this extraction's diff a clean pure-move so the de-React lands on a stable
  packaged target.** Target end state: `BrLcCharts.tsx`'s two mega-hooks +
  echo-suppression + `shapeKey`/`commitTick`/`gestureActive` membrane collapse to
  one framework-agnostic `bindTile(el, source)`.
- Moving the Svelte charts (`@svelte-lc`) into the package.
- npm-scope rename to `@vizform/*`.
- apitable peer surface.
- Renaming the package's internal `demos/` dir to `charts/`.
