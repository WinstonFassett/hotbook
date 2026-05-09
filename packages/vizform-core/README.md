# @winstonfassett/vizform-core

Pure D3 + TypeScript visualization engine. No framework dependencies. Renders proportional and hierarchical data as SVG into any container element.

## Install

```sh
npm install @winstonfassett/vizform-core
```

## Flat visualizations

`VizRenderer` handles single-level (flat) data across three modes: `treemap`, `radial`, and `bands`.

```ts
import { VizRenderer } from '@winstonfassett/vizform-core'
import type { Goal, ViewMode } from '@winstonfassett/vizform-core'

const goals: Goal[] = [
  { id: 'a', name: 'Alpha', color: '#e06c75', measurements: { value: 40 }, archived: false, tags: [], urgent: false, important: false, createdAt: '', updatedAt: '' },
  { id: 'b', name: 'Beta',  color: '#61afef', measurements: { value: 60 }, archived: false, tags: [], urgent: false, important: false, createdAt: '', updatedAt: '' },
]

const renderer = new VizRenderer(containerEl, {
  goals,
  mode: 'treemap',
  activeUnit: 'value',
  unitKind: 'size',
})

// update later
renderer.update({ mode: 'radial' })

// clean up
renderer.destroy()
```

## Hierarchical visualizations

Three mount functions for nested data: `mountTreemap`, `mountIcicle`, `mountSunburst`.

```ts
import { mountTreemap } from '@winstonfassett/vizform-core'
import type { GoalTree } from '@winstonfassett/vizform-core'

const tree: GoalTree = {
  id: '__root__', name: 'All', color: '#333', value: 0,
  children: [
    { id: 'g1', name: 'Group A', color: '#e06c75', value: 40 },
    { id: 'g2', name: 'Group B', color: '#61afef', value: 60 },
  ],
}

const mounted = mountTreemap(containerEl, tree)

// clean up
mounted.destroy()
```

## Exports

| Export | Kind | Description |
|---|---|---|
| `VizRenderer` | class | Flat viz renderer (treemap / radial / bands) |
| `mountTreemap` | function | Hierarchical treemap |
| `mountIcicle` | function | Hierarchical icicle |
| `mountSunburst` | function | Hierarchical sunburst |
| `pickColor` | function | Default color palette by index |
| `Goal` | type | Data record for flat viz |
| `GoalTree` | type | Nested data record for hierarchical viz |
| `ViewMode` | type | `'treemap' \| 'radial' \| 'bands' \| 'h-treemap' \| 'h-icicle' \| 'h-radial'` |

Most users will want [`vizform-react`](../vizform-react) or [`vizform-element`](../vizform-element) instead of calling this directly.
