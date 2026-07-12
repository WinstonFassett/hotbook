# @hotbook/bireactive

Fine-grained reactive chart and graph custom elements built on [bireactive](https://github.com/WinstonFassett/bireactive) and D3. The package is framework-agnostic: each chart is a web component that renders to SVG and owns its own lifecycle, gestures, and animation. It is used by the main `hotbook` app and the `demos` app.

## What it does

- Provides a set of chart custom elements (bar, line, area, scatter, pie, radar, treemap, icicle, sunburst, pack, sankey, gantt, gauge, etc.) that subscribe to reactive data and update incrementally.
- Exposes low-level utilities for authoring new chart components: a `Diagram` base class, a `Viewer` for pan/zoom/fit, a `CartesianViewer` for axis-aware pan/zoom, gesture controllers, tree builders, handles, number-drag, and chart metadata.
- Tracks chart maturity in `CHART_METADATA` so consumers can see whether a chart is `experimental`, `candidate`, or `released`.

## High-level structure

```
src/
  charts/         # One chart component per file. Each extends Diagram.
  lib/            # Shared primitives
    diagram.ts    # Diagram base class (custom element scaffold, SVG, chrome layer)
    viewer.ts     # Generic viewBox-based pan/zoom/fit
    cartesian-viewer.ts  # Axis-aware viewer with D3 scales and grid
    tree.ts       # BiNode tree helpers (group, leaf, leaves)
    interaction.ts       # wheel/drag controllers and gesture primitives
    number-drag.ts       # Figma-style number scrubber
    handles.ts    # Resize/reorder handle primitives
    host-size.ts  # Host container sizing
    hud-bridge.ts # Cross-tile hover/select bridge
    sankey*.ts    # Sankey layout and flow helpers
    ...           # color, transitions, mark lifecycle, drill breadcrumb, etc.
  metadata.ts     # CHART_METADATA and getChartMaturity
  index.ts        # Public exports
```

## Dependencies and install

`bireactive` is a required peer dependency (`^0.3.4`). It must be installed by the consuming app so the custom element registry and reactive cell identity are shared.

```sh
npm install bireactive
```

From the workspace:

```sh
npm install
```

## Build / develop scripts

```sh
npm run build   # vite build — produces dist/hotbook-charts.js, dist/hotbook-charts.umd.cjs, dist/index.d.ts
npm run watch   # vite build --watch
```

The build output is published under `dist/`. `files` in `package.json` includes only `dist`.

## License

MIT
