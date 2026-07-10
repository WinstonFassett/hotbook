# reorg-whiteboard

Architecture whiteboard for the `hotbook` reorg. Outline / bullets / diagrams only. This is a living doc for iteration.

---

## 1. Target layers

```mermaid
flowchart TB
    subgraph Host
      h["host (HTML / vanilla / React / Svelte / etc.)"]
    end

    subgraph Surfaces
      hotbook["apps/hotbook"]
      docs["apps/docs"]
      apitable["apps/apitable"]
    end

    subgraph Presentation
      charts["@hotbook/bireactive"]
      d3["@hotbook/d3"]
      dock["@hotbook/dock (future)"]
      layout["@hotbook/layout"]
      layercharts["@hotbook/layercharts (future)"]
    end

    subgraph Kernel
      core["@hotbook/core"]
      kernel["kernel / store (TBD)"]
    end

    subgraph Data
      sources["data sources (reactive cells, JSON, notebook imports)"]
    end

    h --> Surfaces
    Surfaces --> Presentation
    Presentation --> Kernel
    Kernel --> Data

    core --> kernel
    bireactive["bireactive substrate"] -.adapter.-> kernel
    d3direct["D3-direct substrate"] -.adapter.-> kernel
```

Dependency rule: **down only**. Surfaces depend on presentation packages. Presentation packages depend on the kernel interface. Backends (bireactive, D3-direct) are injected by the host, not imported by presentation packages.

---

## 2. Current package graph

```mermaid
flowchart LR
    subgraph hotbook-app
      hotbook["apps/hotbook"]
    end

    subgraph packages
      core["@hotbook/core"]
      bireactive["@hotbook/bireactive"]
      d3["@hotbook/d3"]
      reactd3["@hotbook/react-d3"]
      layout["@hotbook/layout"]
      apitable["@hotbook/apitable"]
    end

    hotbook --> core
    hotbook --> bireactive
    hotbook --> d3
    hotbook --> layout
    d3 --> core
    d3 --> bireactive
    bireactive --> core
    reactd3 --> core
    reactd3 --> bireactive
    apitable --> core
    apitable --> bireactive
```

Notes:
- `@hotbook/d3` depends on `@hotbook/bireactive` because the tile-binder uses `bireactive` primitives.
- `@hotbook/react-d3` may be dead (zero consumers) — needs verification.

---

## 3. Substrate spectrum

| Substrate | Where today | What changes | Who diffs | Conservation | Notes |
|---|---|---|---|---|---|
| **Fine-grained signals** | `@hotbook/bireactive` | cell values | substrate (bireactive) | native multi-parent lens | best for multi-view sync |
| **Coarse whole-value** | `Workspace` store in `apps/hotbook` | whole dataset | consumer diffs | manual fallback | simple mental model |
| **D3-direct** | `@hotbook/d3` / gen-0 | explicit `update(data)` | D3 enter/update/exit | manual | no substrate sync bugs |
| **Framework-native** | Svelte layerchart spike | Svelte runes | framework | manual fallback | not portable |
| **Observable runtime** | (research only) | named cells | runtime | manual | conceptually adjacent, not a substrate adapter |

```mermaid
flowchart LR
    dataset["dataset"]
    dataset --> bireactive["bireactive signal graph"]
    dataset --> store["coarse store"]
    dataset --> d3direct["D3-direct update()"]
    dataset --> observable["Observable runtime"]

    bireactive --> chart["chart element"]
    store --> chart
    d3direct --> chart
    observable --> chart
```

Open question: is `bireactive` the default, or do we support D3-direct as an equal path? Mixed is most likely.

---

## 3a. Substrate TS-type sketches

This is where the substrate discussion gets concrete. The kernel's job is to hold a `Dataset` and emit a change notification. Each substrate answers "what is the `Dataset` container and how do I subscribe?" differently.

### 1. Bireactive — fine-grained signals

The chart builds a live tree of `Cell`/`Num`/`Writable`.

```ts
import { type Cell, type Read, type Writable, type Num, derive, effect, batch } from 'bireactive'

interface NodeValue {
  id: string
  label: string
  color: string
  total: Writable<Num>                 // leaf value or parent sum lens
  measures?: Record<string, Writable<Num>>
}

type BiNode = TreeNode<NodeValue>

// The chart receives a TreeNode root. It reads `root.value.total.value` inside `derive()`.
// Conservation is a `Num.lens` with a backprop `put`.
// `effect(() => chart.update(root))` is the subscription.
// `batch(() => { ... })` coalesces writes.
```

Pros: multi-view sync for free; native conservation.  
Cons: every chart must speak the `Cell`/`derive` API; `bireactive` is the only vendor.

### 2. Coarse whole-value store

A plain `Workspace` object with snapshot + subscribe.

```ts
interface WorkspaceStore {
  getSnapshot(): Workspace
  subscribe(cb: () => void): () => void
  // mutations return next workspace and call render()
  commit(next: Workspace): void
}

interface Workspace {
  datasets: Dataset[]
  dashboards: Dashboard[]
  activeDatasetId: string
  activeDashboardId: string
}
```

In `apps/hotbook/src/main.ts` today:

```ts
let ws: Workspace = initWorkspace()
const listeners = new Set<() => void>()

function commit(next: Workspace) {
  ws = next
  saveWorkspace(next)
  render()
}
```

The chart is notified by `render()` and diffs the new `Dataset` itself. Conservation is manual.

Pros: dead simple, any renderer can consume it.  
Cons: every render is a full dataset diff; no fine-grained sync.

### 3. D3-direct / procedural

No signal. The element owns a chart instance and exposes `update`.

```ts
interface D3Chart {
  update(data: VizNode[]): void
  getRoot?(): HTMLElement | SVGElement
  onRender?(cb: (ids: string[]) => void): () => void
}

class PackChart implements D3Chart {
  update(nodes: VizNode[]) {
    const root = d3.stratify()(...)
    // d3 enter/update/exit
  }
}
```

`apps/hotbook/src/main.ts` would call `chart.update(activeDataset.nodes)` after every commit. The chart is the only source of truth for its own lifecycle.

Pros: no substrate sync failures; single chart owns cycle.  
Cons: no automatic cross-tile sync; conservation is manual.

### 4. Framework-native — Svelte runes

Svelte 5 runes are conceptually signals with a framework compiler.

```ts
// Svelte 5
let dataset = $state<Dataset>(initial)
let derived = $derived(computeLayout(dataset))

// Plain signal equivalent
interface SvelteSignal<T> {
  value: T
  subscribe(fn: (v: T) => void): () => void
}
```

The chart is a Svelte component, not a custom element. Sync is Svelte-level. Not portable across frameworks.

### 5. Observable runtime

`@observablehq/runtime` uses named cells and observers.

```ts
import { Runtime, Library } from '@observablehq/runtime'

const runtime = new Runtime()
const module = runtime.module()

module.variable().define('dataset', [], () => dataset)
module.variable().define('nodes', ['dataset'], (dataset) => dataset.nodes)

// Observing a cell is async/generator-based
for await (const value of module.value('nodes')) {
  chart.update(value)
}
```

The runtime is the substrate. Not a signal adapter; explicit named cells. Adapter cost is high because it is async and generator-based.

### 6. Matchina — state-machine store

Matchina is a state-machine-first library. Its `createStoreMachine` gives event-driven typed updates.

```ts
import { createStoreMachine } from 'matchina'

const store = createStoreMachine<Workspace, {
  setCell: (datasetId: string, rowId: string, measureKey: string, value: number) => Workspace
  setDataset: (dataset: Dataset) => Workspace
  // ...
}>(initialWorkspace, {
  setCell: (ws, datasetId, rowId, measureKey, value) => {
    // return next workspace
  },
  // ...
})

store.subscribe((change) => {
  chart.update(store.getState().datasets[0])
})

store.dispatch('setCell', 'ds-1', 'n1', 'value', 42)
```

`matchina` is about typed lifecycle and transitions, not a generic signal. It can hold a `Dataset` as state, but it is not a reactive graph like `bireactive`. For a kernel, it would need an adapter layer (event dispatch → dataset update → chart notification).

### What the kernel interface could look like

If we want a substrate-agnostic kernel, the smallest interface is:

```ts
interface Kernel<T = Dataset> {
  get(): T
  set(value: T): void
  subscribe(fn: (value: T) => void): () => void
  batch?: (fn: () => void) => void
}

// Bireactive adapter
const bireactiveKernel: Kernel<BiNode> = {
  get: () => root.peek(),
  set: (next) => /* reconcile into root */,
  subscribe: (fn) => effect(() => fn(root)),
  batch,
}

// Coarse store adapter
const coarseKernel: Kernel<Workspace> = {
  get: () => ws,
  set: (next) => commit(next),
  subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
}

// D3-direct adapter
const d3Kernel: Kernel<Dataset> = {
  get: () => dataset,
  set: (next) => { dataset = next; chart.update(next.nodes) },
  subscribe: () => () => {}, // updates are explicit
}
```

The real question is whether the kernel holds the **dataset** (rows/nodes) or a **live tree** (`BiNode`). If it holds a `Dataset`, the backend can convert it to a live tree. If it holds a `BiNode`, the backend is already `bireactive` and D3-direct is an afterthought.

---

## 4. Kernel boundary

Two competing frames:

### A. Active plan (`reorg-2026-07.md`)
- Keep coordination inside `@hotbook/bireactive` for now.
- Extract a named kernel package only when a second surface (e.g. graph layout, dock) needs the interface.
- Path: lift existing code, not greenfield.

### B. Flexblox / matchina frame
- Build `@hotbook/core` as a substrate-agnostic kernel with `Signal`/`Store` interfaces.
- Add `matchina` state machine for lifecycle.
- Wire `@hotbook/bireactive` and `@hotbook/d3` as kernel adapters.
- Path: design then conform.

```mermaid
flowchart TB
    subgraph active
      a1["@hotbook/bireactive charts"] -->|owns coordination| a2["@hotbook/core<br/>types only"]
    end

    subgraph flexblox
      f1["@hotbook/core<br/>kernel + state machine"] --> f2["@hotbook/bireactive adapter"]
      f1 --> f3["@hotbook/d3 adapter"]
      f2 --> f4["chart elements"]
      f3 --> f4
    end
```

Decision needed: which frame? Mix? A first, then B later?

---

## 5. Open decisions (blocking DAG)

```mermaid
flowchart TD
    D1["1. Substrate strategy"] --> D2["2. Kernel boundary / extraction timing"]
    D2 --> D3["3. Dock strategy"]
    D2 --> D4["4. @hotbook/core scope"]
    D3 --> D5["5. Package list"]
    D4 --> D5
    D5 --> D6["6. Tile spec vocabulary"]
    D5 --> D7["7. Svelte/LayerChart fate"]
    D5 --> D8["8. APITable fate"]
    D6 --> T1["tile-sources refactor"]
    D6 --> T2["DockView picker refactor"]
    D7 --> T3["@hotbook/layercharts"]
    D8 --> T4["@hotbook/apitable"]
```

### Top decisions

1. **Substrate strategy** — bireactive first? D3-direct equal? matchina as lifecycle backend? Mixed?
2. **Kernel boundary** — keep coordination in `@hotbook/bireactive` or extract to `@hotbook/core` now?
3. **Dock strategy** — adopt `dockview-core` or build fresh? Single-page or stacked pages?
4. **Core scope** — types/colors only, or state machine + edit primitives?
5. **Package list** — which `@hotbook/*` packages exist? Do we need `@hotbook/dock`, `@hotbook/ui`, `@hotbook/layercharts`, `@hotbook/observable-runtime`?
6. **Tile spec vocabulary** — `measureKey`/`sortBy`/`xKey`/`yKey` vs `xField`/`valueField`/`sortDir`?
7. **Svelte/LayerChart fate** — keep alias, promote to package, or remove?
8. **APITable fate** — keep or drop?
9. **Package scope** — `@hotbook/*` vs `@vizform/*` vs `@winstonfassett/*`?
10. **Test infrastructure** — Vitest for kernel/charts, Playwright for gestures? When?

---

## 6. Plan DAG (high-level)

```mermaid
flowchart TB
    subgraph done
      R1["rename packages<br/>PNode → VizNode<br/>rows → nodes"]
    end

    subgraph phase1["Phase 1: stabilize"]
      P1["docs cleanup"]
      P2["naming pass"]
      P3["fix apitable peerDep"]
      P4["remove portfolio.ts"]
      P5["consolidate tree utils"]
    end

    subgraph phase2["Phase 2: substrate + kernel"]
      P6["substrate audit"]
      P7["kernel boundary decision"]
      P8["tile spec vocabulary"]
    end

    subgraph phase3["Phase 3: surfaces"]
      P9["dock strategy"]
      P10["svelte/layerchart fate"]
      P11["examples viewer"]
    end

    R1 --> phase1
    phase1 --> P6
    P6 --> P7
    P7 --> P8
    P8 --> P9
    P8 --> P10
    P9 --> P11
    P10 --> P11
```

This DAG is draft only. It depends on the substrate/kernel decision.

---

## 7. Notes / scratch

- `@hotbook/d3` currently depends on `@hotbook/bireactive` because the tile-binder uses `bireactive` primitives. If we want a pure D3-direct substrate, the tile-binder needs to be split or the dependency inverted.
- `apps/hotbook` has `persistence/` and `store/` — these are host-level, not kernel-level. The kernel should be ephemeral.
- `matchina` is a typed state-machine library. It is not installed yet. If we adopt it, it would be a backend adapter, not a hard dependency of `@hotbook/core`.
- The `bireactive` version in `package.json` is `^0.3.5` in root but `^0.3.4` in packages. Align.
