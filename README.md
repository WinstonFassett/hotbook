# hotbook

Experimental proportional and hierarchical visualization kit. It leans on [bireactive](https://github.com/WinstonFassett/bireactive) for fine-grained reactivity, uses a small set of D3 modules for layout and scales, and takes heavy inspiration from [LayerCharts](https://github.com/techniq/layercharts). React has been stripped out of the core packages; the surfaces are framework-agnostic custom elements.

This is an experiment. The APIs, package names, and overall direction will change.

**Live demo:** [hotbook-build.netlify.app](https://hotbook-build.netlify.app)

## Packages

```mermaid
graph LR
  subgraph packages["packages"]
    core["@hotbook/core"]
    bireactive["@hotbook/bireactive"]
    d3["@hotbook/d3"]
    layout["@hotbook/layout"]
    apitable["@hotbook/apitable"]
  end
  subgraph apps["apps"]
    hotbook["hotbook"]
    demos["hotbook-demos"]
    docs["docs"]
  end

  d3 --> bireactive
  d3 --> core
  layout --> bireactive
  apitable --> bireactive
  apitable --> core
  hotbook --> bireactive
  hotbook --> d3
  hotbook --> core
  demos --> bireactive
  demos --> layout
  docs --> bireactive
```

| Package | Description |
|---|---|
| [`@hotbook/core`](packages/core) | Shared types, data model, state machine, and edit primitives. |
| [`@hotbook/bireactive`](packages/bireactive) | Fine-grained reactive surfaces for charts, graphs, and tables. |
| [`@hotbook/d3`](packages/d3) | D3-backed rendering surfaces and tile binders. |
| [`@hotbook/layout`](packages/layout) | Bireactive 2D graph layout primitives (state machines, flow diagrams, etc.). |
| [`@hotbook/apitable`](packages/apitable) | APITable widget adapter. Currently stale and not actively maintained. |

## Monorepo layout

```
packages/
  core/         # Shared types and data model
  bireactive/   # Reactive chart/table/graph surfaces
  d3/           # D3 rendering engine
  layout/       # Bireactive 2D layout
  apitable/     # APITable widget (stale)
apps/
  hotbook/      # Main demo app (Netlify)
  demos/        # Consolidated single-page chart demos
  docs/         # Documentation site (Astro)
```

## Development

```sh
npm install
npm run build        # builds the full docs site with demos + hotbook app
```

To develop a specific app:

```sh
npm run dev                  # hotbook app + demos
npm run dev:hotbook          # hotbook app
npm run dev:demos            # consolidated demos page
npm run dev:docs             # Astro docs site
```

To build a single package:

```sh
npm run build -w packages/bireactive
npm run build -w packages/d3
```

### Demos

`npm run dev:demos` serves the chart demos at `/demos/`.

## License

MIT
