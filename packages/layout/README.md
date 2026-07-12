# @hotbook/layout

Bireactive 2D graph layout primitives for nested, layered diagrams such as state machines and flow charts. It is experimental and shared by the `demos` app.

## What it does

- `MdNestedLayered` is a `bireactive` custom element that recursively lays out a compound graph: each group runs its own layered solve, and child groups appear as opaque rectangles to their parent.
- `makeRow` / `makeEdge` define the tabular data model (containment tree + edge graph).
- Shared cells (`edgeStyle`, `direction`) and `sharedSelection` let toolbars and side panels drive rendering and selection without props.
- `layered-tight` provides the core layered layout solver, and `render.ts` / `measure.ts` handle drawing and node sizing.

## High-level structure

```
src/
  lib/
    nested-layered.ts    # MdNestedLayered component
    data.ts              # Row, Edge, makeRow, makeEdge, tree helpers
    diagram-settings.ts  # edgeStyle, direction shared cells
    layered-tight.ts     # Layout solver
    measure.ts           # Node/group measurement
    render.ts            # Node/edge/hull rendering
    selection.ts         # sharedSelection helpers
  index.ts               # Public exports
```

## Build / develop scripts

This package has no build scripts. The workspace TypeScript configuration imports directly from `src/`. Type-check from the workspace root:

```sh
npm install
npx tsc -p packages/layout/tsconfig.json
```

## License

MIT
