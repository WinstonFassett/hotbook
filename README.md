# vizform

D3-based proportional and hierarchical visualization library — framework-agnostic core with React and web-component adapters, plus an [APITable](https://aitable.ai) widget integration.

**Live demo:** [sliceboard.netlify.app](https://sliceboard.netlify.app)

## Packages

```mermaid
graph LR
  subgraph lib["lib"]
    core["vizform-core"]
    charts["vizform-charts"]
    vanilla["hotbook-d3"]
  end
  subgraph app["app"]
    apitable["vizform-apitable"]
    sliceboard["sliceboard"]
  end

  vanilla --> core
  vanilla --> charts
  react --> vanilla
  apitable --> react
  sliceboard --> vanilla
```

| Package | Description |
|---|---|
| [`vizform-core`](packages/vizform-core) | Core data structures and utilities. Framework-agnostic. |
| [`vizform-charts`](packages/vizform-charts) | Chart type definitions and metadata. |
| [`hotbook-d3`](packages/hotbook-d3) | Pure D3 + TypeScript visualization engine, zero framework deps. |
| [`vizform-apitable`](packages/vizform-apitable) | APITable widget wrapping `vizform-react-d3`. |
| [`apps/sliceboard`](apps/sliceboard) | Multi-board demo: editable table + live viz with multiple chart types. |

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
npm install @hotbook/react @hotbook/core
```

```tsx
import { Viz } from '@hotbook/react'

const goals = [
  { id: 'a', name: 'Alpha', color: '#e06c75', measurements: { value: 40 }, archived: false, tags: [], urgent: false, important: false, createdAt: '', updatedAt: '' },
  { id: 'b', name: 'Beta',  color: '#61afef', measurements: { value: 60 }, archived: false, tags: [], urgent: false, important: false, createdAt: '', updatedAt: '' },
]

<Viz goals={goals} mode="treemap" activeUnit="value" unitKind="size" />
```

## Monorepo layout

```
packages/
  vizform-core/       # Core data structures
  vizform-charts/     # Chart definitions
  hotbook-d3/ # D3 rendering engine
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
npm run dev -w packages/hotbook-d3  # watch mode
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
