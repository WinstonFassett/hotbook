# @winstonfassett/vizform-react

React adapter for [vizform-core](../vizform-core). Exports `<Viz>` for flat data and `<HViz>` for hierarchical data.

## Install

```sh
npm install @winstonfassett/vizform-react @winstonfassett/vizform-core
```

Requires React ≥ 17 as a peer dependency.

## `<Viz>` — flat data

```tsx
import { Viz, pickColor } from '@winstonfassett/vizform-react'
import type { Goal } from '@winstonfassett/vizform-react'

const goals: Goal[] = [
  { id: 'a', name: 'Alpha', color: pickColor(0), measurements: { value: 40 }, archived: false, tags: [], urgent: false, important: false, createdAt: '', updatedAt: '' },
  { id: 'b', name: 'Beta',  color: pickColor(1), measurements: { value: 60 }, archived: false, tags: [], urgent: false, important: false, createdAt: '', updatedAt: '' },
]

<Viz
  goals={goals}
  mode="treemap"          // 'treemap' | 'radial' | 'bands'
  activeUnit="value"
  unitKind="size"
/>
```

The component fills its parent container. Give the parent a defined height.

## `<HViz>` — hierarchical data

```tsx
import { HViz } from '@winstonfassett/vizform-react'
import type { GoalTree } from '@winstonfassett/vizform-react'

const tree: GoalTree = {
  id: '__root__', name: 'All', color: '#333', value: 0,
  children: [
    {
      id: 'g1', name: 'Group A', color: '#e06c75', value: 0,
      children: [
        { id: 'a1', name: 'Item 1', color: '#e06c75', value: 30 },
        { id: 'a2', name: 'Item 2', color: '#c678dd', value: 20 },
      ],
    },
  ],
}

<HViz
  tree={tree}
  mode="h-treemap"        // 'h-treemap' | 'h-icicle' | 'h-radial'
/>
```

## Exports

| Export | Kind | Description |
|---|---|---|
| `Viz` | component | Flat visualization |
| `HViz` | component | Hierarchical visualization |
| `pickColor` | function | Default palette by index |
| `Goal` | type | re-export from vizform-core |
| `GoalTree` | type | re-export from vizform-core |
| `ViewMode` | type | re-export from vizform-core |
