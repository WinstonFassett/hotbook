# @hotbook/core

Shared data model, types, color palette, and tree operations for the hotbook visualization packages. It is a source-only, runtime-light package consumed by `@hotbook/d3`, `@hotbook/bireactive`, and `@hotbook/apitable`.

## What it does

- Defines the domain types used across hotbook: `Goal`, `GoalTree`, `VizNode`, `ViewMode`, `FlatMode`, `HierMode`, `VizConfig`, `HVizConfig`, callbacks, and schema pickers.
- Provides a color system: `PALETTE`, `PALETTE_8`, `PALETTE_20`, `pickColor`, `colorFor`, and `getColorByStrategy` (index / value / identity / single).
- Provides tree and view operations on `VizNode` arrays: `buildTree`, `applyView`, `drillPath`, and `leavesOf`.

## High-level structure

```
src/
  types.ts      # Domain types and view configuration
  colors.ts     # Palette constants and color helpers
  data-ops/     # Tree/view operations
    index.ts    # buildTree, applyView, drillPath, leavesOf
    index.test.ts
  index.ts      # Public exports
```

## Build / develop scripts

This package has no build script. `tsconfig.json` sets `noEmit: true` and `allowImportingTsExtensions: true`; the package is imported directly from `src/`.

From the workspace root:

```sh
npm install
npx tsc -p packages/core/tsconfig.json  # type-check only
```

## License

MIT
