# Reorg 2026-07 Progress Report

## What changed

- Renamed `PNode` → `VizNode` and `Dataset.rows` → `Dataset.nodes` across the
  workspace (`vizform-core`, `sliceboard`, `vizform-react-d3`, `vizform-vanilla-d3`,
  `vizform-apitable`).
- Updated `PEdge` to the new shape (`sourceId`, `targetId`, `measures`, `dims`).
- Removed the duplicate/dead `apps/sliceboard/src/viz/br/tree.ts` file.
- Removed `packages/vizform-charts/src/lib/portfolio.ts` and moved
  `portfolio()` / `walkWithDepth` into `packages/vizform-charts/src/lib/tree.ts`.
- Updated chart fallback imports (`treemap`, `tree-chart`, `sunburst`, `pack`,
  `icicle`, `treetable`) to source from `lib/tree`.
- Fixed `packages/vizform-apitable/src/index.tsx` for the new 4-arg `group` / `leaf`
  signatures.
- Fixed `apps/vanilla-bireactive-layercharts-spike/src/fixtures/portfolio.ts` and
  `src/main.ts` for the new `group` / `leaf` signatures and wired `externalRoot`
  for hierarchical charts.
- Fixed `apps/sliceboard/src/main.ts` missing `DockView` import and `Array.at` ES2022
  usage.
- Added `serializeLayout` to `apps/sliceboard/src/url-layout.ts` so Vite can scan
  `test-parser.html` and the dev server starts cleanly.
- Added new files: `packages/vizform-core/tsconfig.json` and
  `packages/vizform-react-d3/src/types.ts`.
- Added `dogfood-output/` to `.gitignore`.

## Typecheck status

| package | `tsc --noEmit` | notes |
|---|---|---|
| `apps/sliceboard` | ✅ | |
| `packages/vizform-core` | ✅ | |
| `packages/vizform-vanilla-d3` | ✅ | |
| `packages/vizform-react-d3` | ✅ | |
| `packages/vizform-layout` | ✅ | |
| `packages/vizform-apitable` | ✅ | |
| `apps/vanilla-bireactive-layercharts-spike` | ✅ | |
| `apps/svelte-layerchart-spike` | ✅ | |
| `packages/vizform-charts` | ❌ | pre-existing `bireactive` API errors (`Tween` → `Animator`, `BrSyncBridge` `emitDrill`, `sankey` read-only/value issues, etc.) |
| `apps/vanilla-bireactive-spike` | ❌ | pre-existing `bireactive` `Vec`/`Range`/`Tween` and `d3-hierarchy` errors |

## Build status

`npm run build` succeeded for:

- `packages/vizform-vanilla-d3`
- `packages/vizform-react-d3`
- `packages/vizform-charts`
- `apps/sliceboard`

## Dogfood / webapp testing

- Started `npm run dev -w apps/sliceboard` on `http://127.0.0.1:4347/`.
- Used `agent-browser` to load the app and take snapshots.
- The SLICEBOARD shell, dataset/workspace dropdowns, and all tile panels render.
- Clicked the "Life areas" dropdown — it opened with no console errors.
- Console was clean except for Vite/webdev debug logs; no JS errors.

Screenshots:

- `dogfood-output/screenshots/sliceboard-initial.png`
- `dogfood-output/screenshots/sliceboard-life-areas-dropdown.png`

## Decisions

- `@svelte-lc` alias: keep. `apps/sliceboard/src/vite-env.d.ts` declares
  `declare module '@svelte-lc/*'`, and the Vite alias maps `@svelte-lc` to
  `apps/svelte-layerchart-spike/src`.
- Chart fallback data: remove `portfolio.ts` from `vizform-charts`; hosts are now
  responsible for setting `externalRoot` on hierarchical chart elements.

## Remaining known issues

- `packages/vizform-charts` and `apps/vanilla-bireactive-spike` still fail
  `tsc --noEmit` with pre-existing `bireactive` API type errors. These are not
  caused by the `PNode`/`VizNode` or `rows`/`nodes` rename.

## Commit

- `c3c1803` — `refactor(vizform): complete PNode→VizNode and Dataset.rows→Dataset.nodes rename`
- 58 files changed, 427 insertions(+), 462 deletions(-)
