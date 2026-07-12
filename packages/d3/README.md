# @hotbook/d3

Pure D3 + TypeScript rendering engine for proportional and hierarchical visualizations. It has no framework dependencies and renders into SVG inside a container element. It is used by `@hotbook/bireactive` and the host apps for lower-level rendering and tile binding.

## What it does

- `VizRenderer` renders single-level (flat) data across `treemap`, `radial`, and `bands` modes, with drag-to-edit and drag-to-reorder support.
- `mountTreemap`, `mountIcicle`, and `mountSunburst` mount hierarchical visualizations from a `GoalTree`.
- `tile-binder` connects reactive data sources to `bireactive` custom chart elements in a framework-agnostic way.
- `biTree` builds `bireactive` tree nodes from flat `VizNode` arrays.

## High-level structure

```
src/
  viz/                  # Flat visualization engine
    VizRenderer.ts      # Flat viz renderer
    chrome/             # Radial and bands chrome
    layout*.ts          # Treemap, bands, radial layout helpers
    pathPrimitives.ts   # Shape morphing primitives
  hviz/                 # Hierarchical visualization engine
    treemap.ts          # mountTreemap
    icicle.ts           # mountIcicle
    sunburst.ts         # mountSunburst
    pnodeUtils.ts       # Tree build and rollup helpers
  host/                 # Glue for reactive charts
    tile-binder.ts      # bindTile, TileSource, TileController
    biTree.ts           # buildBiTree, biLeaf, biGroup
  colors.ts             # pickColor, colorFor
  types.ts              # Re-exported from @hotbook/core
  index.ts              # Public exports
```

## Build / develop scripts

```sh
npm run build      # vite build — produces dist/hotbook-d3.js, dist/hotbook-d3.umd.cjs, dist/index.d.ts
npm run watch      # vite build --watch
npm run test       # vitest run
npm run test:watch # vitest
```

The build output is published under `dist/`. `files` in `package.json` includes only `dist`.

## License

MIT
