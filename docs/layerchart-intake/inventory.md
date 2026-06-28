# LayerChart inventory — hierarchical slice

Phase A output. Per-file accounting of the components in scope for the
hierarchical port. Pure description; family analysis lives in
[families.md](families.md), spec in [spec.md](spec.md).

All paths are relative to `inspo/layerchart/packages/layerchart/`.

---

## 1. Layout components (d3-hierarchy wrappers)

### 1.1 `Pack`

- **Path**: `src/lib/components/Pack.svelte` (27 LOC)
- **d3 module**: `d3-hierarchy.pack`
- **Call shape**: `d3Pack().size(size ?? [$width, $height]).padding(padding?)`
- **Props**: `size?: [number, number]`, `padding?: number`
- **ChartContext fields read**: `data`, `width`, `height` (3 of ~50)
- **Slot output**: `{ nodes: packData.descendants() }` — `HierarchyCircularNode[]`
  (each carries `x`, `y`, `r`, `depth`, `parent`, `children`, `data`)
- **Svelte-isms**: classic Svelte 4 reactive blocks (`$:`), `<slot nodes={…} />`.
  No runes. No `bind:`. One `@ts-expect-error` over the layout call.
- **Complexity tier**: pure-d3-wrap (trivial)

### 1.2 `Treemap`

- **Path**: `src/lib/components/Treemap.svelte` (88 LOC)
- **d3 module**: `d3-hierarchy.treemap` + `treemapSquarify`/`treemapBinary`/
  `treemapResquarify`/`treemapDice`/`treemapSlice`/`treemapSliceDice`
- **Call shape**: `d3treemap().size([$width, $height]).tile(aspectTile(tileFunc, $width, $height)).padding…`
- **Props**: `tile: TileFunc | 'binary'|'squarify'|'resquarify'|'dice'|'slice'|'sliceDice'`
  (default `treemapSquarify`), plus `padding`, `paddingInner`, `paddingOuter`,
  `paddingTop`, `paddingBottom`, `paddingLeft?`, `paddingRight?`, and a
  `selected` two-way prop (marked TODO Remove)
- **ChartContext fields read**: `data`, `width`, `height`
- **Slot output**: `{ nodes: treemapData.descendants() }` — `HierarchyRectangularNode[]`
  (each carries `x0`, `y0`, `x1`, `y1`, `depth`, `parent`, `children`, `data`)
- **Notable**: wraps the chosen tile in `aspectTile` (see § 5.2) so zoom-in
  treemaps maintain correct aspect ratio. Tile-name resolution is a long
  nested ternary — straightforward switch in any port.
- **Svelte-isms**: `export let selected` is reassigned in a `$:` block — that
  pattern is one-way push (no real two-way), TODO comment confirms removal
  intent. Don't carry it forward.
- **Complexity tier**: pure-d3-wrap (mechanical) + one helper (`aspectTile`)

### 1.3 `Partition`

- **Path**: `src/lib/components/Partition.svelte` (42 LOC)
- **d3 module**: `d3-hierarchy.partition`
- **Call shape**: `d3Partition().size(size ?? (orientation === 'horizontal' ? [$height, $width] : [$width, $height])).padding?.round?`
- **Props**: `orientation: 'vertical'|'horizontal'` (default `'horizontal'`),
  `size?: [number, number]`, `padding?: number`, `round?: boolean`
- **ChartContext fields read**: `data`, `width`, `height`
- **Slot output**: `{ nodes: partitionData.descendants() }` —
  `HierarchyRectangularNode[]`
- **Notable**: `orientation === 'horizontal'` swaps the size tuple to
  `[$height, $width]`. Callers then read `x0/x1/y0/y1` and map them to the
  visual axis themselves; the swap is in layout coordinates, not render.
  This is the source of the Icicle (`vertical`) vs Sunburst-precursor
  (`horizontal`) split.
- **Complexity tier**: pure-d3-wrap

### 1.4 `Tree`

- **Path**: `src/lib/components/Tree.svelte` (41 LOC)
- **d3 module**: `d3-hierarchy.tree`
- **Call shape**: `d3Tree().size(orientation === 'horizontal' ? [$height, $width] : [$width, $height]).nodeSize?.separation?`
- **Props**: `nodeSize?: [number, number]`, `separation?: (a, b) => number`,
  `orientation: 'vertical'|'horizontal'` (default `'horizontal'`)
- **ChartContext fields read**: `data`, `width`, `height`
- **Slot output**: `{ nodes: treeData.descendants(), links: treeData.links() }`
  — note this is the **only** layout that yields `links` alongside `nodes`.
  `HierarchyPointNode[]` (carries `x`, `y`, `depth`, `parent`, `children`).
- **Notable**: same orientation-swap pattern as `Partition`.
- **Complexity tier**: pure-d3-wrap

---

## 2. Render primitives (carry the real translation cost)

Hierarchical compositions render via these. They are not d3 wrappers — they
are Svelte components that bake in Spring/tweened motion, render-context
switching (SVG/Canvas/HTML), and pointer/tooltip wiring.

### 2.1 `Arc`

- **Path**: `src/lib/components/Arc.svelte` (242 LOC)
- **d3 module**: `d3-shape.arc`, `d3-scale.scaleLinear`
- **Purpose**: Render a single annular sector. Used as the leaf of Sunburst.
  Also used standalone for gauges / radial progress.
- **Layout-vs-render split**: pure render. The wedge geometry comes from
  caller-supplied `value`/`domain`/`range` (or explicit `startAngle`/
  `endAngle`), not from a layout.
- **ChartContext fields read**: `xRange`, `yRange` (for default radius)
- **Motion**: `motionStore(value, { spring, tweened })` — the wedge sweeps
  on value change.
- **Notable extras**: `track` (draw a background track behind the arc),
  `tooltip` integration, computed `centroid` exposed via slot,
  `innerRadius`/`outerRadius` with `<1` percent-of-chartRadius semantics.
- **Complexity tier**: heavy interaction

### 2.2 `Rect`

- **Path**: `src/lib/components/Rect.svelte` (147 LOC)
- **Purpose**: Render an axis-aligned rectangle. Treemap and Icicle leaf.
- **Layout-vs-render split**: pure render. `x`, `y`, `width`, `height`
  come from the caller (typically a treemap/partition node's
  `x0/x1/y0/y1`).
- **ChartContext fields read**: none directly — pulls render context via
  `getRenderContext()` and canvas context via `getCanvasContext()`.
- **Motion**: four `motionStore`s (`x`, `y`, `width`, `height`) — each can
  spring/tween independently. `resolveOptions(prop, { spring, tweened })`
  supports per-prop config.
- **Render context**: switches at runtime between SVG `<rect>` and a Canvas
  draw call (`renderRect`). HTML branch is absent — Rect is SVG/Canvas only.
- **Complexity tier**: heavy interaction (multi-prop motion + dual render)

### 2.3 `Group`

- **Path**: `src/lib/components/Group.svelte` (135 LOC)
- **Purpose**: Translate-only wrapper. Implements `center: boolean | 'x' | 'y'`
  for chart-origin convenience.
- **Layout-vs-render split**: pure render container.
- **ChartContext fields read**: `width`, `height` (for centering)
- **Motion**: `tweened_x`, `tweened_y` motion stores.
- **Render context**: SVG `<g>`, Canvas (`ctx.translate`), or HTML
  `<div style:transform>`. All three branches present — only primitive
  in the set with HTML support.
- **Complexity tier**: shell-dependent (touches render contexts)

### 2.4 `Text`

- **Path**: `src/lib/components/Text.svelte` (259 LOC)
- **Purpose**: Render a multi-line, optionally scale-to-fit text label.
- **Layout-vs-render split**: pure render, but contains its own word-wrap
  measurement (`getStringWidth`) and line layout — this is layout work
  done inside a render primitive.
- **ChartContext fields read**: none.
- **Motion**: `tweened_x`, `tweened_y`.
- **Render context**: SVG `<text>` and Canvas (`renderText`). No HTML branch.
- **Notable**: `verticalAnchor: 'start'|'middle'|'end'`, `scaleToFit`,
  rotation, `capHeight` magic number from d3.
- **Complexity tier**: heavy (built-in line layout + dual render)

### 2.5 `Link`

- **Path**: `src/lib/components/Link.svelte` (121 LOC)
- **d3 module**: `d3-shape.link`, `curveBumpX`/`curveBumpY`,
  `d3-interpolate-path.interpolatePath`
- **Purpose**: Render the curved connector between two nodes. Used for Tree
  links and (with `sankey={true}`) for Sankey ribbons.
- **Layout-vs-render split**: pure render. Data is a `{ source, target }`
  object; accessors `source(d)`, `target(d)`, `x(d)`, `y(d)` map to points.
- **ChartContext fields read**: none.
- **Motion**: `tweened_d` with `interpolatePath` interpolator (path morph).
- **Notable**: optional start/mid/end markers, sankey-mode source/target
  accessor overrides.
- **Complexity tier**: medium (path-string tween)

### 2.6 `Bounds`

- **Path**: `src/lib/components/Bounds.svelte` (42 LOC)
- **d3 module**: `d3-scale.scaleLinear` via `motionScale`
- **Purpose**: Project a `{ x0, y0, x1, y1 }` extent into chart pixel space
  via slot-exposed `xScale`/`yScale`. Used by zoomable treemap / partition
  examples to "zoom into" a selected node.
- **ChartContext fields read**: `width`, `height`
- **Motion**: scales themselves are motion-wrapped (`motionScale`) so the
  zoom transition tweens.
- **Slot output**: `{ xScale, yScale }`.
- **Complexity tier**: shell-dependent

---

## 3. Chart shell (inventory only — port stance deferred to families.md)

### 3.1 `Chart` and `ChartContext`

- **Paths**: `src/lib/components/Chart.svelte` (497 LOC),
  `src/lib/components/ChartContext.svelte` (296 LOC)
- **Role**: `Chart` mounts LayerCake, then wraps its context with
  `ChartContext`, then renders the chosen layout target (`Svg`/`Canvas`/
  `Html`) and child slot. Also owns `renderContext` + tooltip context.
- **ChartContext surface** (full field list, from `ChartContext.svelte:11-86`):
  - sizing: `width`, `height`, `containerWidth`, `containerHeight`,
    `percentRange`, `aspectRatio`
  - accessors: `x`, `y`, `z`, `r`, `x1`, `y1`, `c`, `activeGetters`
  - data: `data`, `flatData`, `custom`
  - per-channel: `{x,y,z,r}{Nice,DomainSort,Reverse,Padding,Domain,Range,Scale,Get}`
    (8 properties × 4 channels = 32 fields)
  - extras: `x1{Domain,Range,Scale,Get}`, `y1{…}`, `c{…}`
  - layout: `padding` (object)
  - misc: `extents`, `config`, `radial`
- **Used by hierarchical slice**: `data`, `width`, `height` for layouts;
  `xRange`, `yRange` for `Arc`'s default radius computation.
  Net: **5 of ~50** ChartContext fields are load-bearing for this slice.
- **Complexity tier**: heavy (LayerCake + reactive plumbing); deferred

### 3.2 `layout/Svg`, `layout/Canvas`, `layout/Html`

- **Paths**: `src/lib/components/layout/{Svg,Canvas,Html}.svelte`
- **Role**: Render targets. `Chart` picks one based on its `renderContext`
  prop; primitives consult `getRenderContext()` and branch their output.
  Canvas additionally maintains a hit-canvas for pointer events.
- **Used by hierarchical slice**: all of Pack/Treemap/Partition/Tree are
  render-target-agnostic (they only emit data via slots). The primitives
  (Rect, Arc, Group, Text) are where the render-target switch matters.

---

## 4. Utilities

### 4.1 `utils/hierarchy.ts` (20 LOC)

- **Exports**: `findAncestor<T>(node, filter) -> HierarchyNode<T> | null`
- **Purpose**: walk upward from a node looking for an ancestor matching a
  predicate (cf. `node.find()` walks downward). Used by interactive
  hierarchical examples to highlight a path.

### 4.2 `utils/treemap.ts` (39 LOC)

- **Exports**:
  - `aspectTile(tile, width, height) -> TileFunc` — wraps a d3 tile function
    so a zoomed-in treemap maintains aspect ratio at full chart size before
    rescaling children to the visible rect. Cited from Observable
    `@d3/zoomable-treemap` / `@d3/stretched-treemap`.
  - `isNodeVisible(a, b) -> boolean` — true if `a` is a child of `b` or any
    ancestor of `b`. Used to filter which descendants render at a given
    zoom level.

### 4.3 `utils/graph.ts` (hierarchical-relevant exports)

- `graphFromHierarchy(hierarchy)` — converts `d3-hierarchy` output into
  `{ nodes, links }` with `value` propagated from `link.target.value`. The
  hierarchical-relevant entry point; other exports (`graphFromCsv`,
  `graphFromNode`, `nodesFromLinks`, `ancestors`, `descendants`) target
  Sankey/Dagre and are out of scope.

---

## 5. Compositions (not components — examples that combine the above)

### 5.1 Sunburst

- **Location**: `src/routes/docs/examples/Partition/+page.svelte`
- **Recipe**: `<Partition>` (default `horizontal`; treats `x0..x1` as angle,
  `y0..y1` as radius), then `{#each nodes as node}` render `<Arc>` with
  `innerRadius={node.y0}`, `outerRadius={node.y1}`,
  `startAngle={node.x0}`, `endAngle={node.x1}`.
- **Not a separate component.** Spec captures the pattern.

### 5.2 Icicle

- **Location**: same file
- **Recipe**: `<Partition orientation="vertical">` then `{#each nodes}`
  render `<Rect>` with `x={node.x0}`, `y={node.y0}`,
  `width={node.x1 - node.x0}`, `height={node.y1 - node.y0}`.
- **Not a separate component.** Spec captures the pattern.

---

## 6. Deferred (out of slice — listed for family-graph completeness)

`Sankey`, `Dagre`, `ForceSimulation`, `Hull`, `Pie` (d3-shape pie + arcs —
similar shape to Sunburst but flat data), `Voronoi`, `Calendar`, `Geo*`.
None feed the hierarchical slice; family analysis touches Pie only to
note its Arc-sibling relationship.
