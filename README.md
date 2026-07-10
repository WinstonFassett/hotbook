# vizform

D3-based proportional and hierarchical visualization library — framework-agnostic core with React and web-component adapters, plus an [APITable](https://aitable.ai) widget integration.

**Live demo:** [sliceboard.netlify.app](https://sliceboard.netlify.app)

## Packages

```mermaid
graph LR
  subgraph lib["lib"]
    core["core"]
    charts["bireactive"]
    vanilla["d3"]
    react["react-d3"]
  end
  subgraph app["app"]
    apitable["apitable"]
    hotbook["hotbook"]
  end

  vanilla --> core
  vanilla --> charts
  react --> vanilla
  apitable --> react
  hotbook --> vanilla
```

| Package | Description |
|---|---|
| [`core`](packages/core) | Core data structures and utilities. Framework-agnostic. |
| [`bireactive`](packages/bireactive) | Chart type definitions and metadata. |
| [`d3`](packages/d3) | Pure D3 + TypeScript visualization engine, zero framework deps. |
| [`react-d3`](packages/react-d3) | React adapter for d3 charts. |
| [`apitable`](packages/apitable) | APITable widget wrapping `react-d3`. |
| [`apps/hotbook`](apps/hotbook) | Multi-board demo: editable table + live viz with multiple chart types. |

## Visualization modes

**Flat** (single-level data): `treemap` · `radial` · `bands`

| treemap | radial | bands |
|---|---|---|
| ![treemap](docs/screenshots/treemap.png) | ![radial](docs/screenshots/radial.png) | ![bands](docs/screenshots/bands.png) |

**Hierarchical** (nested data): `h-treemap` · `h-icicle` · `h-radial`

| h-treemap | h-icicle | h-radial |
|---|---|---|
| ![h-treemap](docs/screenshots/h-treemap.png) | ![h-icicle](docs/screenshots/h-icicle.png) | ![h-radial](docs/screenshots/h-radial.png) |

## Quick start

```sh
npm install @winstonfassett/vizform-react @winstonfassett/vizform-core
```

```tsx
import { Viz } from '@winstonfassett/vizform-react'

const goals = [
  { id: 'a', name: 'Alpha', color: '#e06c75', measurements: { value: 40 }, archived: false, tags: [], urgent: false, important: false, createdAt: '', updatedAt: '' },
  { id: 'b', name: 'Beta',  color: '#61afef', measurements: { value: 60 }, archived: false, tags: [], urgent: false, important: false, createdAt: '', updatedAt: '' },
]

<Viz goals={goals} mode="treemap" activeUnit="value" unitKind="size" />
```

For hierarchical data, use `<HViz>` with a `GoalTree` — see [`vizform-react-d3`](packages/vizform-react-d3/README.md).

## Monorepo layout

```
packages/
  vizform-core/       # Core data structures
  vizform-charts/     # Chart definitions
  vizform-vanilla-d3/ # D3 rendering engine
  vizform-react-d3/   # React components
  vizform-apitable/   # APITable widget
apps/
  sliceboard/         # Demo app (Netlify)
  docs/               # Documentation site
inspo/                # gitignored — reference/scratch material
```

## Development

```sh
npm install
npm run build        # builds core → react → sliceboard in order
```

To develop a specific package:

```sh
npm run dev -w packages/vizform-vanilla-d3  # watch mode
npm run dev -w apps/sliceboard              # Vite dev server
npm run dev -w apps/docs                    # Docs site dev server
```

### Chart demos

The sliceboard app hosts a `/demos` surface (hash route: `#/demos`) that renders
each chart in isolation against a small checked-in fixture — no tile plumbing,
no persistence, no config UI. Use it as the canonical testing surface when
developing or debugging a single chart.

```sh
npm run dev -w apps/sliceboard
# then visit /#/demos
```

Fixtures live in [`apps/sliceboard/src/demos/fixtures/`](apps/sliceboard/src/demos/fixtures).

## License

MIT
