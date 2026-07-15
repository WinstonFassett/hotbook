# Bireactive surface audit

Read of `inspo/bireactive/src/` to ground fiddleviz's diagram-kit plans in
prior art before designing further. Without this audit I'd been sketching
packages (`bireactive-coll`, `bireactive-tree`, etc.) that already exist
in bireactive itself.

## What bireactive ships

### Reactivity substrate (`src/core/`)
- `Cell<T>`, `cell()`, `Writable<T>`, `derive()`, `effect()`, `batch()`,
  `untracked()`, `readNow()`, `reader()`
- `lens()` (general), `fieldLens()` — lens factories
- Typed cell classes: `Num`, `Vec`, `Box`, `Str`, `Bool`, `Color`, `Pose`,
  `Transform`, `Matrix`, `Range`, `Spring`, `Tri`, `Field`, `Flags`,
  `Audio`, `Canvas`
- `Num.lens(children, fwd, back)` — used in our spike for sum-redistribute
- `network()` for structural mutations
- `cachedDerive`, `setCellWriteHook` (for instrumentation), `transitiveDeps`
- Traits: `requireEquals`, `requireLerp`, `requireLinear`, `requireMetric`,
  `requirePack`, `requirePivotal`

### Tree (`src/tree.ts`)
- `TreeNode<T>`, `node()` constructor
- `walkTree`, `leavesOf`, `allNodes`, `atPath`, `isLeaf`, `nodeCount`
- **Doc-comments name two layered patterns:**
  - **Aggregate (bottom-up)**: internal node lenses over leaves — merge on
    read, redistribute on write (sum-trees, mean-trees). *This is exactly
    what our spike's `BiNode`-with-`Num.lens` implements ad hoc.*
  - **Propagate (top-down)**: each node carries local + world value;
    scene-graph / armature shape.

### Coll (`src/coll.ts`)
- `Coll<E>` — writable source-of-truth collection with key function;
  `insert(e, at?)`, `removeFromSource(e)`, `assertContains(e)`
- `View<E>` base for read views
- `FilterView<E>` (via `FieldPred` + `is()` + `allPass()`)
- `SortView<E>` with `move(e, toIndex)` — writes the order field
  between drop neighbors using `between()` rank insertion
- `GroupView<K, E>` with `move(e, toKey, index?)` — writes both
  group field AND order field in ONE `batch()`, asserts upstream
  filters via the parent chain.
- The **md-kanban** demo is a consumer of all this — not a recipe to
  reimplement.

### Shapes (`src/shapes/`)
- `Shape<O>` base, `rect`, `circle`, `line`, `path`, `pathD`, `curve`,
  `ellipse`, `label`, `text`, `arrow`, `connect`, `annularSector`,
  `group`, `button`, `handle`
- `Anchor`, `Dir`, `tokens` (color tokens)
- `clipPath`, `clip` utilities
- `arrange`, `grid` shape arrangement helpers
- `centroid`, `meanRotation`, `meanScale` for compound shape geometry
- `bezier2`/`bezier3` curves
- `cursor` (live cursor signal), `hoverSignal`
- `drag`, `draggable`, `dragRotate`, `dragWithState` — gesture primitives
- Transitions: `fadeIn`, `fadeOut`, `fadeUp`, `fadeUpOut`, `slideIn`,
  `slideOut`, `zoomOut`, `spinIn`, `bounceIn`, `scaleIn`
- `forEach`, `each`, `when`, `network` — list/conditional/structural
  lifecycle
- `mount(root)` for diagram setup

### Constraints (`src/constraints/`) — the physics layer
- `constraints({iterations, ...})` cluster, `physics()` cluster
- Relations: `distance`, `bend`, `collinear`, `equalDist`, `rightAngle`,
  `onCircle`, `pin`, `inside`, `clamp`, `eq`, `geq`, `angle`, `lensNum`
- Forces: `spring`, `repel`, `gap`, `softTarget`, `bodyAnchor`
- Rigid bodies: `body()`, `joint()`, `bodyAnchor()`
- `dragBody`, `dragBodyAnchored` — physics-aware drag
- `exposeVec` — make a constraint cluster's solution available as a Vec
- `procrustes` — closed-form similarity (move/spin/size) lens
- `Solver`, `Constraints`, `Term` classes; `Strength` constants
- Pipeline: `prepare`, `snapshot`, `solve`, `writeback`, `reactivePipeline`

### Propagators (`src/propagators/`)
- `Graph<N>` interface; `Direction`, `Size`, `Placement`
- Layouts (return `Map<N, Placement>`):
  - `layered(g, opts)` — Sugiyama (TB/LR/BT/RL; layerGap; nodeGap)
  - `tree(g, opts)` — tidy tree
  - `radial(g, opts)` — radial tree
  - `recurrent(g, opts)` — cycle-as-ring
  - `lanes(g, opts)` — swim lanes
- Graph utilities: `rank` (longest-path), `scc` (Tarjan),
  `crossings`, `extent`
- Flex: `row`, `col`, `grid` (box-tree solved by narrowing)
- Box layout: `inset`, `attach`, `centerInside`, `pinEdge`, `lockSize`,
  `follow`
- CSP: `allDifferent`, `restrict`, `same`
- Numeric atoms: `add`, `bound`, `equal`, `fix`, `order`, `total`
- General solver: `Propagator`, `Solver`, `solve()`

### Animation (`src/animation/`)
- `Spring` class, `tween()`, `loop()`, `play()`
- `sequential`, `timeline` (timeline-of-clips)
- Easings: `linear`, `easeIn`, `easeOut`, `easeInOut`
- `untilChange`, `untilEvent`, `untilPromise`, `when` (animation predicates)
- `every(sec, fn)` interval play
- `orbit` helper

### Web (`src/web/`)
- `Diagram` web component base class — what custom elements extend
- `EventBus`
- `MdMarker`, `MdTex` — markdown helpers
- `viewport`, `inView`, `scrollProgress`, `viewProgress` — scroll/viewport
- `attr`, `observedAttributesOf`, `syncAttrSignal` — attribute helpers
- `attachRaf` — raf integration

### Ext (`src/ext/`)
- `snapshot()` — read a cell graph as plain data
- `timeline()` — timeline animator
- waapi integration

### Code (`src/code/`)
- `code`, `codeStyles`, `tokenize` — code-rendering shapes (for the
  `md-code` demos)

### Tex (`src/tex/`)
- LaTeX-style equation rendering

## What's actually new in fiddleviz's spike code

Mapping `apps/bireactive-spike/`, `apps/bireactive-viz/`,
`apps/layerchart-direct-spike/` against the above. Truly new is much
narrower than I'd been planning:

### Genuinely new to fiddleviz

- **d3-hierarchy adapters under bireactive cells**: `derive(() =>
  d3.treemap()(snapshot(tree)))`-style backends for treemap, sunburst,
  icicle, pack. Bireactive's propagators don't include these. ELK doesn't
  either (those are d3's specialty).
- **Chart context**: `chart-context.ts`'s focus/project/zoom utilities.
  Bireactive's primitives don't include a viewport/projection convention.
- **DM gesture kit**: `applyDelta`, alt-wheel scrub, sticky modifier locks,
  Tab navigation across nodes, depth-based drill. Bireactive ships
  `drag`/`handle`/`draggable` but not these higher-level gesture
  compositions.
- **Cross-view morph**: `elements/cross-view.ts` — sprung morphs between
  treemap/sunburst/icicle for the same writable tree. Bireactive has the
  shapes and springs; the morph orchestration is ours.
- **Svelte/LayerChart bridge**: `bireactiveStore.ts` —
  `writableFromCell`/`readableFromCell`. Bireactive doesn't ship Svelte
  store adapters.
- **The spike's `BiNode`-with-`Num.lens` portfolio**: a *use* of
  bireactive's aggregate-tree pattern. Could/should be expressed via
  `bireactive/tree`'s vocabulary rather than ad-hoc — likely a refactor
  opportunity.

### Already in bireactive — stop reinventing

- ❌ `bireactive-coll` package (proposed) — **already exists as `bireactive/coll`** with
  Coll/FilterView/SortView/GroupView, including `move(e, toKey, index)`
  rank-insertion semantics. The kanban pattern is ready off-the-shelf.
- ❌ `bireactive-tree` package (proposed) — **already exists as `bireactive/tree`**
  with TreeNode/walk/leaves/path utilities AND documented aggregate +
  propagate patterns.
- ❌ Sum-redistribute lens (the heart of our spike's treemap) — **already
  expressible via `Num.lens(children, sumFwd, redistributeBack)`**, which is
  what the spike's `tree.ts` actually uses. The pattern is bireactive's.
- ❌ A graph model + Sugiyama layout (was planning native package) —
  **already in `bireactive/propagators`** as `Graph<N>` +
  `layered`/`tree`/`radial`/`recurrent`/`lanes` + `rank`/`scc`/`crossings`.
- ❌ Force-directed layout (was planning) — **already viable via
  `bireactive/constraints`** with `spring`+`repel`+`gap`+`softTarget`+
  `physics()` cluster, as the `md-graph` demo shows.

### Backend gaps that ARE worth real packages

- `bireactive-d3` — d3-hierarchy + d3-shape adapters under bireactive
  `derive`. Treemap/partition/pack/sankey not in bireactive's propagators.
  Most of our spike work lives here.
- `bireactive-elkjs` — elkjs adapter for layered graphs with port
  constraints, orthogonal routing, and hierarchical containment. Not in
  bireactive's propagators.
- `bireactive-native` (open question) — *extensions* to bireactive's
  existing `layered`/`tree`/`radial` with phases (port attachment,
  orthogonal routing, hierarchy). Possibly upstream-contributable to
  bireactive itself rather than its own package.

## Revised scope for "the diagram kit"

The kit is much smaller than I'd been framing:

```
                ┌─ bireactive (existing) ───────────────────────────┐
                │  cell, derive, batch, Num.lens, tree, coll,       │
                │  propagators (graph + layered/tree/radial/lanes), │
                │  constraints (spring/repel/gap/physics),          │
                │  shapes (rect/circle/line/path/label/handle),     │
                │  Diagram, drag/draggable/handle, animation        │
                └──────────────────────┬────────────────────────────┘
                                       │ build ON TOP of:
                                       ▼
        ┌─ fiddleviz-diagram kit ─────────────────────────────────────┐
        │  chart-context (focus, project, drill, breadcrumbs)       │
        │  gesture vocabulary (drag-resize, scrub, marquee, multi,  │
        │    ghost, undo/redo, update policies)                     │
        │  view components (Treemap, Sugiyama, Mindmap, ForceGraph, │
        │    ForceClusters, …) using bireactive primitives          │
        │  source adapters (APITable, matchina, JSON tree, …)       │
        │  optional renderer alternatives (Solid wrapper,           │
        │    LayerChart bridge)                                     │
        └───────────────────────────────────────────────────────────┘
                                       │ uses
                                       ▼
        ┌─ layout backends (where bireactive doesn't cover) ────────┐
        │  bireactive-d3   — d3-hierarchy + d3-shape adapters       │
        │  bireactive-elkjs — elkjs adapter (worker, sprung morphs) │
        │  (bireactive-native — extensions to propagators)          │
        └───────────────────────────────────────────────────────────┘
```

## What this means for plans / publishing

Plans need to be rewritten to consume bireactive's surface, not parallel
it:

- The "shapes" layer I'd been calling `bireactive-coll` / `bireactive-tree`
  doesn't need new packages; the shapes are *uses* of bireactive's
  existing types.
- Posts framed as "I made a writable Coll" are wrong — the post is "look
  at what bireactive's Coll lets you do with views and drag."
- The kit's contribution is the **view-component layer**, the **gesture
  vocabulary**, and **backend adapters** for things bireactive doesn't
  already cover (d3 hierarchy layouts, elkjs).

## Refactor opportunity in current spike

`apps/layerchart-direct-spike/src/lib/tree.ts` builds `BiNode` with
`Num.lens(children, sumFwd, redistribute)`. That's the right pattern but
it sits OUTSIDE bireactive's `TreeNode<T>` shape. Worth refactoring to:

```ts
import { node, type TreeNode } from "bireactive"

type Portfolio = { label: string; color: string; total: Writable<Num> }
const portfolio: TreeNode<Portfolio> = node(
  { label: "Portfolio", color: "#222", total: aggregate(...) },
  [ node({ label: "Tech", ... }, [ ... ]) ],
)
```

…where `aggregate(...)` is `Num.lens(...)` over children's totals. This
makes the spike code an *honest* use of bireactive's tree primitive and
opens the door to using `walkTree`/`leavesOf`/`atPath` directly instead of
the spike's hand-rolled `leaves()`/`parentOf()` walkers.

## Open questions raised by the audit

1. Should `fiddleviz-diagram` (or whatever it's named) live in the same
   monorepo as bireactive, separately, or as a published consumer? Given
   how tightly it'll integrate, separate-package-in-this-monorepo is
   probably right.
2. Where do d3 adapters live — `bireactive-d3` as a peer to bireactive, or
   `fiddleviz-diagram/backends/d3` as an internal? Lean toward peer
   package, since "d3 layouts under bireactive cells" is a generally
   useful pattern beyond fiddleviz.
3. Should we engage with the bireactive author about contributing the
   extensions we'd otherwise build in `bireactive-native` (port
   attachment, orthogonal routing, hierarchy) back upstream?
4. The `cross-view.ts` morph between hierarchical viz types is one of
   the most evocative things in the spike. It's fiddleviz-original but
   uses bireactive primitives end-to-end. Worth understanding whether
   bireactive's `transitions` module already provides a more idiomatic
   way to express it.
