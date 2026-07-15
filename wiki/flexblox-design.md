# flexblox — Design Doc

NOTE: This doc is for exploring doing a complete rewrite in a new repo, building a new thing, considering this to be the POC repo.

> Bidirectional reactive blocks for editable data surfaces.
> Kernel-coordinated, backend-agnostic, built on the 2026 signal consensus.

Status: **design**. Supersedes `rebuild-tech-design.md` (which assumed bireactive as the
sole substrate). This doc reframes the product as a **coordination kernel** on top of
commodity reactive primitives, with bireactive as one backend among possible others.

---

## 1. What the product is

Not a chart library. Not a store. Not a signal engine.

**A coordination kernel for bidirectional editable datasets shared across multiple views.**

The kernel owns:
- One reactive dataset (the "kernel" — notebook parallel: one kernel per dataset)
- Cross-tile sync (hover, selection, drill)
- Gesture coordination (one gesture at a time, commit/cancel, scale stability)
- Conservation propagation (edit a leaf, siblings redistribute to preserve parent total)
- Tween gate (snap on direct edits, tween on structural changes)
- Reconcile (data settable at any time, patch by id)
- Render coordination (one rAF loop for all tiles, batching, throttling, priority)
- Lifecycle (active / parked / disposed, with disposers)

The kernel does NOT own:
- Reactive primitives (signals, effects, batches — commodity, from the backend)
- Chart rendering (charts are consumers of the kernel)
- Layout (dock is a consumer of the kernel)
- Persistence (surfaces own persistence, kernel is ephemeral)

### The notebook parallel

A code notebook has a kernel (shared mutable scope) and cells (chunks that read/write it).
flexblox has a kernel (one reactive dataset + coordination) and blocks (tiles that
observe and edit it). The difference: flexblox blocks are bidirectional — every block is
both a view and an editor. Closer to Observable's `viewof` generalized to every cell.

### Why this is novel

The unique value is the **coordination layer**: turning scattered reactive cells into a
coherent editable dataset shared across multiple views with sync, gestures, conservation,
and coordinated rendering. Nobody else builds this because nobody else's primary use case
is bidirectional direct-manipulation viz.

- Solid/Svelte/Preact give you reactive primitives. You still have to wire sync,
  gestures, conservation, and render coordination yourself.
- Zustand/nanostores give you a store. You still have to wire everything above.
- bireactive gives you multi-parent bidirectional lens. You still have to wire
  everything else.

flexblox wires the everything-else. That's the product.

---

## 2. Layers

```
surfaces (peers, not packages)
  fiddleviz · docs site · apitable · nextjs demo
  each is a host that mounts blocks + owns layout
        │
        ▼
flexblox-charts              flexblox-dock
  custom elements              layout engine
  bar/line/pie/sankey          split/group/tab/drag
  VizElement base              spring transitions
  gestures, transitions        events at boundary
        │                          │
        └──────────┬───────────────┘
                   ▼
flexblox (the kernel + coordination)
  Kernel          dataset + coordination state
                  render coordination (one rAF, batching)
                  lifecycle (active/parked/disposed)
  SyncHub         cross-tile hover/select/drill
  GestureCoord    one-gesture-at-a-time, commit/cancel
  TweenGate       snap vs tween classification
  Conservation    sum-redistribute policy (kernel-owned)
  Reconcile       patch cells by id
  Registry        Map<datasetId, Kernel>
  Disposer        setup(store, ...fns) → () => void

  Interfaces:
    Signal     get/set + effect + computed + batch
    Store      get/set/subscribe at paths
    (2026 consensus shape, not our invention)
                   │
                   ▼
backends (adapters, one per reactive ecosystem)
  flexblox-matchina      matchina atom + StoreMachine
                         state-machine lifecycle (premium)
  flexblox-bireactive    Cell/derive/effect/batch
                         multi-parent lens (conservation fast path)
  flexblox-solid         createSignal/createMemo/etc
  flexblox-preact        Preact Signals
  flexblox-nanostores    nanostores atom/computed
```

Dependency rules:
- **Down only.** Surfaces depend on charts + dock. Charts + dock depend on kernel.
  Kernel depends on interfaces. Backends implement interfaces. No upward deps.
  No sideways deps between surfaces.
- **Backends are injected.** The app imports one backend at startup. Everything
  else uses the kernel interface. Charts and dock never import a backend directly.
- **Conservation is kernel-owned.** The kernel implements sum-redistribute as
  coordination logic on top of the store. Backends with native multi-parent lens
  (bireactive) provide a fast path. Backends without it use the manual coordination
  fallback.

---

## 3. The signal interface (2026 consensus)

We do not invent a signal architecture. We use the shape that Solid, Preact Signals,
Angular signals, nanostores, and bireactive all converge on:

```ts
interface Signal<T> {
  get(): T;
  set(v: T): void;
}

function signal<T>(initial: T): Signal<T>;
function computed<T>(fn: () => T): Signal<T>;
function effect(fn: () => (() => void) | void): () => void;
function batch<T>(fn: () => T): T;
```

Disposers are universal:
- `effect(fn)` returns an unsub function. Calling it stops the effect.
- `fn` can return a cleanup function. It runs on stop or re-run.
- `subscribe(fn)` on stores returns an unsub function.

Every backend implements these. Adapters are ~50 lines of renaming.

---

## 4. The store interface

Above signals, a store for JSON-shaped data (datasets, dashboards, workspaces).
Path-addressed. Matches nanostores `mapstore`, Solid `createStore`, Zustand selectors,
matchina `atom` composed into maps.

```ts
interface Store<T> {
  get(): T;
  getAt<P>(path: Path): P;
  setAt(path: Path, value: unknown): void;
  subscribe(path: Path, listener: (change: Change) => void): () => void;
  subscribe(listener: (change: Change) => void): () => void;
}

type Path = (string | number)[];
interface Change<T = unknown> {
  path: Path;
  from: T;
  to: T;
}
```

The kernel holds a `Store<Dataset>` for the data. Sync hub cells are `Signal<T>`.
Conservation reads/writes through the store. Charts subscribe to paths.

---

## 5. The kernel

### 5.1 Kernel shape

```ts
class Kernel {
  readonly datasetId: string;
  readonly store: Store<Dataset>;
  readonly sync: SyncHub;
  readonly gestures: GestureCoordinator;
  readonly tweens: TweenGate;
  readonly conservation: Conservation;

  // Render coordination
  requestFrame(fn: () => void): () => void;  // returns unsub from frame queue

  // Lifecycle
  park(): void;     // pause rAF, observers, gesture listening
  resume(): void;   // resume
  dispose(): void;  // tear down everything

  // Reconcile
  reconcile(dataset: Dataset): void;  // patch cells by id
}
```

### 5.2 SyncHub

Cross-tile hover, selection, drill. Plain signals, shared across tiles on the same kernel.

```ts
interface SyncHub {
  hoverId: Signal<string | null>;
  selectIds: Signal<Set<string>>;
  drillId: Signal<string | null>;
}
```

A tile does: `effect(() => { const h = kernel.sync.hoverId.get(); /* highlight h */ })`.
The backend handles propagation. The kernel owns the shared signals.

### 5.3 GestureCoordinator

One gesture at a time across all tiles on the kernel. Atomic commits via `batch`.

```ts
class GestureCoordinator {
  begin(state: GestureState): boolean;  // false if another gesture active
  commit(): void;   // batch(() => { apply writes })
  cancel(): void;   // revert via snapshot
}
```

Uses `batch()` so all writes in one gesture commit as one flush. The lock is a
`Signal<GestureState | null>`. Tiles call `begin()` before a gesture; if it returns
false, they yield.

### 5.4 TweenGate

Classifies writes: snap (direct value edit, write-through, no tween) vs tween
(structural change — sort, measure swap, orientation — route through tween).

```ts
class TweenGate {
  onValueEdit(path: Path, value: number): void;    // write through, no tween
  onStructuralChange(change: StructuralChange): void;  // route through tween
}
```

Uses the backend's `tween()` / `Spring` (or equivalent — Solid has `createTween`,
Svelte has `tweened`/`spring`, nanostores has `lifecycle`). The classification logic
is ours; the tween primitive is the backend's.

### 5.5 Conservation

Sum-redistribute as kernel-owned coordination logic, not a store primitive.

```ts
interface Conservation {
  // Register a parent-child aggregate relationship
  aggregate(
    parentPath: Path,
    childPaths: Path[],
    policy: AggPolicy,
  ): () => void;  // disposer

  // On parent write: distribute delta to children per policy
  // On child write: recompute parent per policy
}

type AggPolicy =
  | "sum-redistribute"     // parent = sum(children); child writes redistribute delta proportionally
  | "sum-readonly"         // parent = sum(children); parent writes rejected
  | "mean"                 // parent = mean(children); writes distribute delta evenly
  | { custom: CustomLens }; // user-supplied fwd/bwd
```

**Fast path (bireactive only):** if the backend supports multi-parent lens
(`lens(children, sum, redistribute)`), conservation delegates to it. One line.

**Fallback (all other backends):** kernel subscribes to child paths, computes
the aggregate, writes the parent. On parent write, computes the delta, writes
children per policy. Manual coordination logic — ~100 lines, backend-agnostic.

### 5.6 Render coordination

One rAF loop for all tiles on the kernel. No per-chart rAF.

```ts
class Kernel {
  private frameQueue = new Set<() => void>();
  private rafId: number | null = null;

  requestFrame(fn: () => void): () => void {
    this.frameQueue.add(fn);
    this.scheduleFlush();
    return () => this.frameQueue.delete(fn);
  }

  private scheduleFlush() {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      const fns = [...this.frameQueue];
      this.frameQueue.clear();
      for (const fn of fns) fn();  // one frame, all tiles
    });
  }
}
```

Benefits:
- **One rAF for N tiles.** No torn updates between tiles sharing a dataset.
- **Throttling.** Kernel can cap frame rate. All tiles respect it.
- **Priority.** Active gesture tile renders first; sync followers after.
- **Batching.** Multiple cell writes in one gesture commit as one frame.
- **Park/resume.** Parked kernel pauses rAF. Resume restarts. No per-tile logic.
- **Backpressure.** If a frame overruns, kernel can defer low-priority tiles.

### 5.7 Reconcile

Patch cells by id when data changes. Data is settable at any time.

```ts
reconcile(dataset: Dataset): void {
  // Walk the new dataset, patch store paths by id.
  // New rows → insert. Missing rows → remove. Changed values → update cell.
  // Structure changes arrive as store writes; charts react via subscriptions.
}
```

This replaces the current `bindTile.applyData` (per-host glue). Written once,
in the kernel, not per-host.

### 5.8 Registry

Per-workspace kernel lookup. One registry per workspace (jsruntime scope).

```ts
class Registry {
  private kernels = new Map<string, Kernel>();  // datasetId → Kernel

  get(datasetId: string, source?: Dataset): Kernel {
    let k = this.kernels.get(datasetId);
    if (!k) {
      k = createKernel(datasetId, source);
      this.kernels.set(datasetId, k);
    }
    return k;
  }

  dispose(datasetId: string): void {
    this.kernels.get(datasetId)?.dispose();
    this.kernels.delete(datasetId);
  }
}
```

Datasets are scoped by workspace. Global ids are unreliable (collision across
workspaces). The registry is per-workspace; kernel ids are dataset ids within
that scope.

---

## 6. The disposer pattern

The composition primitive. Everything returns a disposer. Kernel is a disposer
of disposers. Setup functions compose by returning disposers.

```ts
// lib/disposer.ts
export function disposer(...fns: (() => void)[]): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    // run in reverse order (LIFO — like useEffect cleanup)
    for (let i = fns.length - 1; i >= 0; i--) fns[i]!();
  };
}

export function disposerBag() {
  const bag: (() => void)[] = [];
  return {
    add(fn: (() => void) | undefined): () => void {
      if (!fn) return () => {};
      bag.push(fn);
      return () => {
        const i = bag.indexOf(fn);
        if (i >= 0) { bag.splice(i, 1); fn(); }
      };
    },
    dispose: () => {
      while (bag.length) bag.pop()!();
    },
  };
}

// setup composition
export function setup<T>(store: T, ...fns: ((s: T) => (() => void) | undefined)[]): () => void {
  const disposers = fns.map(fn => fn(store));
  return disposer(...disposers.filter(Boolean) as (() => void)[]);
}
```

Kernel setup:

```ts
function createKernel(datasetId: string, source?: Dataset): Kernel {
  const store = backend.createStore<Dataset>(source ?? emptyDataset);
  const sync = createSyncHub(backend);
  const gestures = createGestureCoordinator(backend, store);
  const tweens = createTweenGate(backend);
  const conservation = createConservation(backend, store);

  const dispose = setup({ store, sync, gestures, tweens, conservation },
    sync.setup,
    gestures.setup,
    tweens.setup,
    conservation.setup,
    (ctx) => effect(() => { /* render coordination loop */ }),
  );

  return { datasetId, store, sync, gestures, tweens, conservation, dispose, ... };
}
```

---

## 7. Lifecycle

### Generic kernel

Simple: `active` → `disposed`. A boolean flag. `dispose()` runs all disposers.

### matchina kernel (premium)

Lifecycle as a typed state machine. States, transitions, guards, payloads.

```
init ──init──→ active
active ──park──→ parked
parked ──resume──→ active
active ──dispose──→ disposed
parked ──dispose──→ disposed
```

- **State payload:** kernel state (sync hover, gesture owner, frame queue, tween queue).
- **State-specific actions:** `active` allows gesture begin/commit; `parked` rejects
  gestures; `disposed` rejects everything.
- **Entry/exit effects:** `active` entry starts rAF + observers; `active` exit pauses
  them. `parked` entry disconnects observers. `disposed` entry runs all disposers.
- **Transition guards:** can't `resume` from `disposed`. Can't `park` from `parked`.
  Type-safe — the machine rejects invalid transitions at compile time.

This is the matchina premium: typed lifecycle with park/resume as first-class
transitions, not boolean flags. The generic kernel is simpler (active/disposed only).
Both use the same disposer pattern. Both work with the same charts/dock/surfaces.

---

## 8. Backends

Each backend is an adapter that implements the signal + store interfaces.

### flexblox-matchina (premium)

- `signal` → matchina `atom` (get/set/subscribe)
- `computed` → matchina `atom` + derived subscribe (or StoreMachine with computed transition)
- `effect` → matchina `atom.subscribe` + disposer
- `batch` → matchina batch (or manual flush)
- `store` → matchina `atom` composed into a map, or `StoreMachine` with path transitions
- **Conservation:** manual coordination (matchina has no multi-parent lens)
- **Lifecycle:** typed state machine (the premium — park/resume as guarded transitions)

### flexblox-bireactive

- `signal` → bireactive `cell` (`.value` get/set)
- `computed` → bireactive `derive`
- `effect` → bireactive `effect` (returns unsub, fn can return cleanup)
- `batch` → bireactive `batch`
- `store` → bireactive `store` (deep proxy over cell)
- **Conservation:** native fast path via `lens(children, sum, redistribute)`. This is
  the only backend with multi-parent bidirectional lens. Conservation delegates to it.
- **Lifecycle:** simple active/disposed (no typed state machine)

### flexblox-solid

- `signal` → Solid `createSignal`
- `computed` → Solid `createMemo`
- `effect` → Solid `createEffect` (returns unsub, fn can return cleanup)
- `batch` → Solid `batch`
- `store` → Solid `createStore` (deep proxy)
- **Conservation:** manual coordination (~100 lines, no native multi-parent lens)
- **Lifecycle:** simple active/disposed

### flexblox-preact

- `signal` → Preact `signal`
- `computed` → Preact `computed`
- `effect` → Preact `effect` (returns unsub, fn can return cleanup)
- `batch` → Preact `batch`
- `store` → Preact `deepSignal` or manual
- **Conservation:** manual coordination
- **Lifecycle:** simple active/disposed

### flexblox-nanostores

- `signal` → nanostores `atom`
- `computed` → nanostores `computed`
- `effect` → nanostores `effect` (returns disposer, fn can return cleanup)
- `batch` → nanostores `batch` (or manual)
- `store` → nanostores `mapstore`
- **Conservation:** manual coordination
- **Lifecycle:** simple active/disposed

### Adapter cost

~50 lines for the 4 signal functions (renaming). ~50-100 lines for the store adapter.
~100 lines for conservation fallback (if no native multi-parent lens). Total: ~200-300
lines per backend. The bireactive adapter is shorter because conservation is native.

---

## 9. Package shape

```
flexblox                    — kernel + interfaces + coordination
                              (no backend — imports from an adapter at app startup)

flexblox-matchina           — matchina backend (premium lifecycle)
flexblox-bireactive         — bireactive backend (native conservation)
flexblox-solid              — Solid backend
flexblox-preact             — Preact Signals backend
flexblox-nanostores         — nanostores backend

flexblox-charts             — custom elements (bar, line, pie, sankey, ...)
flexblox-dock               — layout engine (split, group, tab, drag, spring transitions)

flexblox-react              — optional React shim (external consumers only)
flexblox-svelte             — optional Svelte shim (external consumers only)
```

### Naming

`flexblox` is the ecosystem name. Substrate-agnostic — doesn't reference bireactive
or any backend. Backends are `flexblox-<backend>`. The ecosystem works with any
reactive substrate.

`flexblox` is free on npm (verified 2026-07-05). `flexblox-bireactive`,
`flexblox-matchina`, `flexblox-solid`, `flexblox-preact`, `flexblox-nanostores` are
also free.

---

## 10. Data model

One model. Everything is a tree of nodes whose measures are signals.

```ts
interface NodeData {
  id: string;
  label: string;
  color?: string;
  measures: Record<string, Signal<number>>;  // all numeric values live here
  meta?: Record<string, unknown>;             // dates, tags — non-edited fields
}

interface VizNode {
  data: NodeData;
  children: VizNode[];  // flat chart = one-level tree
}

// Constructors
function leaf(id: string, label: string, measures: Record<string, number>): VizNode;
function group(id: string, label: string, children: VizNode[], agg?: AggPolicy): VizNode;
function list(id: string, rows: RowInit[]): VizNode;  // flat = one-level tree
```

Key decisions:
- **`measures` is the only edit surface.** Charts write `node.data.measures[key].set(v)`
  during gestures. Group measures are computed aggregates (sum-forward,
  redistribute-back) — owned by the kernel's conservation layer.
- **Children as array.** Reorder/insert/remove are store writes. Charts react via
  subscriptions. (Future: reactive collection if a backend supports it.)
- **`Dataset ⇄ VizNode` adapters.** `fromDataset(ds)` builds/updates a VizNode tree
  from a plain `Dataset`; `toDataset` snapshots back. `fromDataset` is incremental —
  called again with new data, it patches cells in place by id. This is the reconcile
  function, written once, in the kernel.

---

## 11. Element contract

```ts
abstract class VizElement extends HTMLElement {
  // Data — settable at any time, before or after mount. Element reconciles.
  data: VizNode | null;

  // Kernel — resolved from registry by datasetId. Settable pre-mount.
  kernel: Kernel | null;
  datasetId: string | null;  // if set, kernel resolved from registry on connect

  // Sync — defaults to kernel.sync
  sync: SyncHub | null;

  // Gestures — defaults to kernel.gestures
  gestures: GestureCoordinator | null;

  // Lifecycle
  connectedCallback(): void;   // mount DOM, start effects
  disconnectedCallback(): void; // PARK (retain state + cells, pause rAF/observers)
  dispose(): void;              // real teardown — run disposers, null out refs
}
```

Contract guarantees:
1. **Order of operations never matters.** `data` before or after `appendChild`,
   `kernel` before or after `data` — all valid.
2. **Edits are origin-tagged.** A host effect watching signals can distinguish
   "the user dragged this chart" from "someone else wrote the signal" via the
   gesture state. Echo suppression is built into the gesture coordinator.
3. **Park, don't die.** Tab switches and dock moves are disconnect/reconnect —
   element resumes with state intact. The dock host needs no `display:none` hacks.
4. **Gestures are internal.** Wheel/drag/Esc wiring happens inside the element
   via the kernel's gesture coordinator. One gesture at a time across all tiles.
5. **Render is coordinated.** Elements request frames from the kernel, not from
   their own rAF. One frame for all tiles.

---

## 12. Test surfaces (the substrate proof)

The kernel must be proven across multiple surface shapes, not just charts:

1. **Charts** — direct manipulation, cross-tile sync, conservation propagation.
   (Current fiddleviz use case.)
2. **Dock** — layout coordination, keep-alive across tab switches, spring
   transitions on resize/split. (WIN-111 scope.)
3. **Page/block layout** — document-shaped surfaces. Block-level editing, nested
   layout, focus routing. (New — not built yet.)
4. **Multi-view (supersplit-style)** — spring-animated view transitions, keyboard
   focus/move, no tabs. (Reference, not necessarily adopted.)

Each surface tests different kernel guarantees:
- Charts test bidirectional binding + conservation + sync.
- Dock tests keep-alive + layout coordination + render coordination.
- Page/block tests nested structure + focus routing.
- Multi-view tests spring transitions + view routing.

If the kernel can't serve all four, it's not a coordination kernel — it's a chart
library with ideas above its station.

---

## 13. What gets ported vs rewritten (from current fiddleviz)

**Port (knowledge, not code):**
- `docs/interaction-principles.md` — the 17 rules. The product's behavioral spec.
- `docs/viewer-architecture.md` — Diagram/Viewer/Container split.
- `docs/transitions-decision.md` — CSS transitions for in-view, tween cells for cross-view.
- The two-lane gate (snap vs tween) — port the pattern.
- The gesture lifecycle (speculative/atomic/commit/escape) — port the pattern.
- The axis-binding model (`xBinding`/`valueBinding` + tween layer) — port the design.
- The dock tree model (`DockGroup`/`DockSplit`/`DockPanel`) — port the spec.

**Rewrite:**
- Every chart component. Fresh code, same behavior, deep element contract.
- `bindTile.ts` — gone. The element contract makes it unnecessary.
- `DockView.ts` — fresh, events at boundary, spring transitions.
- The tile spec — `xField` + `sortDir` + `valueField` vocabulary from the start.
- The kernel — new. Extracted from the patterns, not the code.

**Drop:**
- Gen-0 everything (`vanilla-d3`, `react-d3`, retired tile kinds).
- The React membrane (`BrLcCharts.tsx`, `store-react.ts`).
- The `@svelte-lc` alias and the Svelte spike.
- `lib/portfolio.ts` (fixture data in the wrong package).
- Backward-compat aliases (`measureKey` → `valueBinding`, etc.).

---

## 14. Open decisions

1. **First backend: bireactive or matchina?** bireactive has native conservation
   (multi-parent lens). matchina has typed lifecycle (premium kernel). Could ship
   both on day one, or pick one. My read: ship bireactive first (conservation is
   load-bearing for half the charts), add matchina as the premium lifecycle backend.

2. **Dock: adopt `dockview-core` or build fresh?** WIN-111's open question.
   `dockview-core` solves keep-alive cleanly. Building fresh means owning the hard
   parts but getting spring transitions. Spring transitions are the actual feature
   gap — neither dockview-core nor the current DockView has them.

3. **Conservation fallback: ship it on day one?** If the first backend is bireactive
   (native conservation), the fallback isn't needed immediately. But if we want
   `flexblox-solid` to support treemap/sankey, the fallback is required. My read:
   ship bireactive-only first, write the fallback when a second backend is actually
   requested.

4. **Store interface: deep proxy or path map?** Solid `createStore` uses a deep
   proxy (field access = signal). nanostores `mapstore` uses a flat map with path
   keys. matchina could go either way. The interface should support both — the
   `getAt(path)` / `setAt(path, value)` / `subscribe(path, fn)` shape works for
   both implementations.

5. **APITable: keep or drop?** AGPL leaf, React 17. If the product is the kernel +
   charts, APITable is one surface among many. Winston's call.

6. **Test infrastructure: when?** A rewrite is the moment to add tests. Vitest for
   kernel/charts, Playwright for gestures. Without tests, the kernel claims aren't
   proven, they're asserted.

---

## 15. Recommended build order

1. **`flexblox` package skeleton** — interfaces (Signal, Store), disposer utils,
   kernel shape (no backend yet).
2. **`flexblox-bireactive` adapter** — first backend. Conservation via native
   multi-parent lens.
3. **Kernel implementation** — SyncHub, GestureCoordinator, TweenGate, Conservation,
   Reconcile, Registry, render coordination. Tests for each.
4. **`flexblox-charts` — one chart (bar)** end-to-end against the kernel, with the
   deep element contract. Then breadth.
5. **`flexblox-dock`** — layout engine, events at boundary, spring transitions.
6. **`flexblox-matchina` adapter** — premium lifecycle backend.
7. **fiddleviz** — integration test harness. Dock + charts + persistence.
8. **Other backends** (Solid, Preact, nanostores) — on demand.

The order matters: kernel before charts, charts before dock, dock before fiddleviz.
Each layer proves the one below it.
