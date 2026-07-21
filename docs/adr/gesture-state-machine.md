# ADR: Chart Editor, DataView, and Base Chart Family Effect Contract

**Status:** Proposed  
**Amends:** `wiki/interaction-principles.md` (pre-edit preview, deferred reorder/relayout, consumer-driven reactive subscription).  
**Grounded in:** `UBIQUITOUS_LANGUAGE.md`

## Context

There is no single contract for how gestures, pre-edits, transitions, and live data updates interleave. This ADR defines that contract from `UBIQUITOUS_LANGUAGE.md`: a `Chart` is a first-class consumer, it owns an `Editor` state machine, it subscribes to a `DataView`, and it implements a small set of conditional render/transition effects.

## Core model

The app gives a `Chart` a `Kernel`. The `Chart` connects itself to a `DataView` and, if it is editable, an `Editor`.

- **`Kernel`** — the central data service. It publishes committed data updates and pre-edit events.
- **`DataView`** — the chart's query-keyed subscription into the `Kernel`, similar to TanStack Query. It routes relevant `Kernel` events to the `Chart`.
- **`Editor`** — per-chart state machine. Two states: `Idle` and `Drafting`. Events: `draft`, `commit`, `cancel`, `updated`.
- **`Kernel.Drafts`** — the part of `Kernel` that tracks active `Editor`s and reports a global `Idle`/`Drafting` state.
- **`Chart`** — the visual element. It attaches effects to `Editor` events and decides how to render.
- **`BaseChart`** — abstract base for interactive charts. Its family subclasses (`BaseCartesianChart`, `BaseRadialChart`, `BaseHierarchicalChart`, `BaseNetworkChart`, `BaseTableChart`) provide common effect-hook implementations.

The architecture is consumer-driven reactive subscription: the `Kernel` publishes; the `Chart` subscribes and decides what to render.

## Editor state machine

`Editor` has two states:

- `Idle`
- `Drafting`

Transitions:

| type | from → to | purpose |
|---|---|---|
| `draft` | `Idle` → `Drafting` | A pre-edit has started. |
| `draft` | `Drafting` → `Drafting` | A pre-edit value has changed. |
| `commit` | `Drafting` → `Idle` | The pre-edit is finalized. |
| `cancel` | `Drafting` → `Idle` | The pre-edit is discarded. |
| `updated` | `Idle` → `Idle` | Committed data changed while `Idle`. |
| `updated` | `Drafting` → `Drafting` | Committed data changed while a draft is active. |

`draft` carries `intent` (`'pre-edit'` | `'reorder'`) and `origin` (the data key). `updated` does not change `Editor` state.

`updated` while `Drafting` updates the committed-data layer but **does not reapply the draft**. The draft overlay stays as the user last set it until `commit` or `cancel`.

## Effects are conditional

`Editor` events are not commands. The `Chart` decides whether to run an effect, which effect to run, and whether it is a render or a transition. The decision can depend on:

- the `Editor` state and transition type,
- the `DataView` event (committed data vs. pre-edit),
- whether the order/structure changed,
- `prefers-reduced-motion`,
- and chart-family-specific conditions.

The `BaseChart` event handler dispatches to the family-specific hooks below.

## Effect hooks

`BaseChart` defines the lifecycle hooks. Each family overrides them to implement its own rendering strategy.

- `snapshot()` — capture the committed data and the current computed layout at the start of a draft.
- `applyPreview()` — render a draft preview on top of the committed snapshot.
- `computeLayout()` — run the layout algorithm (`d3`/`partition`/`pack`/`treemap`/bandscales) and produce a new layout.
- `applyLayout()` — immediately set mark positions.
- `transitionLayout()` — animate marks to a new layout. Interruptible and disposable.
- `revertLayout()` — restore the committed data and apply the saved committed layout.
- `applySort()` — write the new sorted order to the data source before recomputing layout.

`applyLayout` and `transitionLayout` are mutually exclusive for the same update. The chart chooses which one to run.

## Public contract

```ts
interface EditorState {
  key: 'Idle' | 'Drafting';
  intent: 'pre-edit' | 'reorder' | null;
  origin: unknown | null;
}

interface Editor {
  getState(): EditorState;
  draft(intent: 'pre-edit' | 'reorder', origin: unknown): void;
  updated(): void;
  commit(): void;
  cancel(): void;
  subscribe(
    fn: (transition: {
      from: 'Idle' | 'Drafting';
      to: 'Idle' | 'Drafting';
      type: 'draft' | 'updated' | 'commit' | 'cancel';
      origin: unknown;
    }) => void,
  ): () => void;
  dispose(): void;
}

interface Drafts {
  register(editor: Editor): () => void;
  isDrafting(): boolean;
  subscribe(fn: (isDrafting: boolean) => void): () => void;
}
```

`Editor` core does not import the reactive runtime.

## BaseChart integration

```ts
abstract class BaseChart extends HTMLElement {
  kernel: Kernel;
  dataView: DataView;
  editor: Editor | null = null;
  snapshot: LayoutSnapshot | null = null;

  connectedCallback() {
    this.dataView = this.kernel.query(this.queryKey);
    this.dataView.subscribe((event) => this.onDataView(event));

    if (this.editable) {
      this.editor = new Editor();
      this.kernel.drafts.register(this.editor);
      this.editor.subscribe((transition) => this.onEditorTransition(transition));
    }
  }

  disconnectedCallback() {
    this.editor?.dispose();
    this.dataView?.unsubscribe();
  }

  onEditorTransition(t: EditorTransition) {
    switch (t.type) {
      case 'draft':
        this.snapshot();
        this.applyPreview();
        break;
      case 'commit':
        this.commit();
        break;
      case 'cancel':
        this.cancel();
        break;
      case 'updated':
        this.updated();
        break;
    }
  }

  abstract snapshot(): void;
  abstract applyPreview(): void;
  abstract commit(): void;
  abstract cancel(): void;
  abstract updated(): void;
}
```

The host provides the `Kernel` and `queryKey`; the `Chart` creates and owns the `DataView` and `Editor`.

## Pre-edit semantics

A chart drafts at most one live value at a time. The preview updates the affected mark(s) and any dependent scale or domain so the value stays under the pointer and readable.

- **Linear marks** resize the edited mark and scale the matching axis/domain to fit the pre-edit value. This is the default for bar, area, scatter, and similar Cartesian marks.
- **Fixed-total marks** rebalance the edited mark and its siblings. The coordinate is a fixed total (360° for a full pie, or a parent value for a sunburst ring), so previewing a change inherently moves others.
- **Hierarchical marks** can preview by scaling the edited node around its center, optionally rendering it as a puzzle-piece "atop" the original layout, and optionally fading out or relayouting children. The chart should not re-sort siblings or run a global layout during the gesture.

A chart may expose settings to tweak preview behavior (e.g. whether children are relaid out, whether the preview is overlaid or in-place).

The shared rule: reorder and full layout recomputes that move sibling marks are deferred until `commit`.

## Cross-tile synchronization

The `Kernel` publishes pre-edit events to every `DataView` subscribed to the same data. A chart that receives a pre-edit event while it is not the active drafter (per `kernel.drafts`) should still update the underlying values/scale, but it must defer reorder and full layout relayout until the active `Editor` commits or cancels.

## Family effect contracts

Each family overrides the same hooks. The event handlers are the public contract; the implementation is family-specific.

### `BaseCartesianChart`

Uses `chartContext` (x/y scales, tween layer). Gestures attach via `attachCartesianGestures`.

- `applyPreview`: resize the edited mark and scale the matching axis/domain to fit the pre-edit value.
- `commit`: `applySort` + `computeLayout` + `transitionLayout` (reorder/slide).
- `cancel`: restore committed `snapshot`, `applyLayout`.
- `updated`: `computeLayout`; use `transitionLayout` if order/structure changed, else `applyLayout`.

Charts: `BarChart`, `Bands`, `LineChart`, `AreaChart`, `ScatterChart`, `Gantt`.

### `BaseRadialChart`

Angle/radius coordinates. Fixed total (360° or parent value).

- `applyPreview`: rebalance the edited mark and its siblings around the new value.
- `commit`: `applySort` + `computeLayout` + `transitionLayout`.
- `cancel`: restore committed `snapshot`, `applyLayout`.
- `updated`: `computeLayout`; use `transitionLayout` if order/structure changed, else `applyLayout`.
- Gestures are wheel/drag on the mark/handle.

Charts: `PieChart`, `RadarChart`, `ConcentricArc`, `Gauge`, `GaugeSegmented`.

### `BaseHierarchicalChart`

Uses `BiNode` tree, `buildParentIndex`, portfolio, `walkTree`. Gestures attach via `attachChartGestures` + `attachReorderGesture`.

- `applyPreview`: scale the edited node around its center, freeze sibling order, optionally overlay children.
- `commit`: `applySort` + recompute `d3` layout (`partition`/`pack`/`treemap`) + `transitionLayout`.
- `cancel`: revert `snapshot` + `applyLayout`.
- `updated`: `computeLayout` + `applyLayout` or `transitionLayout`.
- Drill-in/out is a separate transition with its own duration role.

Charts: `Sunburst`, `Icicle`, `Treemap`, `Pack`, `TreeChart`, `BudgetTree`.

### `BaseNetworkChart`

Node/link layout.

- `applyPreview`: adjust the edited node/link value locally, possibly re-scaling flows.
- `commit`: recompute sankey-layout + `transitionLayout`.
- `cancel`: revert `snapshot` + `applyLayout`.
- `updated`: `computeLayout` + `applyLayout` or `transitionLayout`.

Charts: `SankeySimple`, `SankeyComplex`, `SankeyFlow`.

### `BaseTableChart`

Treetable is HTML, not SVG. Row/cell gesture layer.

- `applyPreview`: update cell value or row position preview.
- `commit`: apply row order + transition (CSS row slide) or render.
- `cancel`: revert.
- `updated`: re-render rows with transition if order changed.

Chart: `Treetable`.

## Input handling

`DragConfig`, `WheelConfig`, and keyboard configs carry `intent` and `origin`. Input handlers call:

- `editor.draft(intent, origin)` on gesture start,
- `editor.draft(intent, origin)` on each pre-edit value change,
- `editor.commit()` on end,
- `editor.cancel()` on abort.

For continuous pre-edits (drag, wheel, held arrow keys), `editor.draft()` is called on each delta. For discrete pre-edits (single arrow key press, step button), `editor.draft()` starts, each key press calls `editor.draft()`, and a debounce timer calls `editor.commit()`. `Escape` calls `editor.cancel()`. There is no implicit commit.

Config changes are not continuous gestures, so they are applied as committed data updates.

## Consequences

- The `Chart` is the owner of the `Editor` and `DataView`. The host supplies the `Kernel` and `queryKey`.
- Effects are chart-owned and conditional. The `Editor` only notifies; the `Chart` decides.
- Families consolidate gesture/transition logic into a single set of effect hooks.
- Cross-tile freeze is a global `Kernel.Drafts` signal combined with `DataView` pre-edit events.
- Hierarchical charts stop recomputing `d3` layout on every pointer move; `applyPreview` runs until `commit`/`cancel`.
- All transitions are interruptible and disposable. Transition completion is an internal chart concern.
