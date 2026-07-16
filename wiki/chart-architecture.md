# Chart architecture — shared parts

Status: design (capture of current intent, not code).

Every chart spec in `wiki/specs/*.md` describes chart-specific behavior. This doc names the reusable parts all charts are built from, so specs do not repeat them. It is the entry point. Detail lives in:

- `wiki/gesture-architecture.md` — `Editor`/`DataView`/`Kernel.Drafts` contract and family effect contracts.
- `wiki/interaction-principles.md` — user-facing rules.
- `wiki/transitions-decision.md` — CSS transitions and gesture suppression.
- `wiki/specs/icicle.md` — reference hierarchical chart spec.

Older architecture drafts that conflict with this doc are in `wiki/stale/`.

## Core stance

- **Charts are autonomous consumers.** The `Kernel` publishes data and pre-edit events; the chart subscribes and decides how to render. (`interaction-principles.md` #10)
- **Charts are components in control.** A chart creates its own `DataView`; the `DataView` creates its `Editor`. The host gives the chart a `Kernel` and a `config`.
- **Prefer functions and plain data over classes and information hiding.** The current harness uses `Editor`/`DataView`/`Kernel` classes for expediency, but the architecture does not require classes. Gesture behaviors are functions or closures; state lives where it is used.
- **Use the full public `bireactive` surface** (`num`, `total`/`lens`, `derive`, `effect`, `rect`, `forEach`, `group`, `label`, `drag`/`dragModel`/`d`), not just `cell/derive/effect`.
- **CSS transitions for autonomous motion; immediate write-through for reactive motion.** (`transitions-decision.md`)
- **No overflow.** A mark must never render outside the chart bounds. If a pre-edit exceeds the domain, scale the domain or re-render. (`interaction-principles.md`)

## The parts

| Part | Responsibility | Lifecycle |
|---|---|---|
| `Chart` | Custom element. Owns container, config, `DataView`, reactive tree, marks, gesture behaviors. | mount, config change, dispose |
| `Kernel` | Owns canonical `Dataset`s, publishes updates, brokers `DataView`s, tracks `Editor`s via `Kernel.Drafts`. | app lifetime |
| `DataView` | Query-keyed subscription into `Kernel`. Owns one `Editor` and local chart state (drill). Routes events to the chart. | created when chart receives `config`; disposed on unmount/config change |
| `Editor` | Per-chart session: `Idle` ↔ `Drafting`. Carries `currentDraft`. Emits to `DataView` only. | lives as long as `DataView` |
| `Kernel.Drafts` | Global view of active `Editor`s. Publishes `isDrafting` / `activeEditor`. | app lifetime |
| `Gesture behavior` | Input utility (e.g. `bireactive` `drag`/`dragModel`/`d`, or D3-style functions). Attaches listeners, maps input to data-space, calls chart callbacks. | attached per mark on mount; returns a `detach` function |
| `Mark` | Visual element(s) for one data item (rect, circle, label, group). Built with `bireactive` shapes. | created/removed by keyed list; updated by reactive cells |
| `Layout` | Pure function from reactive tree + config + drill + `frozenOrder` to geometry in data-space. | recomputed when deps change |
| `Transition` | Visual settle. Prefer CSS transitions; `tween`/`Anim` only when CSS cannot express. | suppressed during active gesture |

## Editor, DataView, and gesture behavior

- `Editor` is the **local session authority**. `Idle`/`Drafting`, `currentDraft`. It emits transitions to the `DataView`; it does **not** broadcast cross-tile.
- `DataView` is the chart's interface to `Kernel` and `Editor`. It creates the `Editor`, wires it to `Kernel.Drafts`, and publishes cross-tile draft/commit/cancel events through `Kernel`.
- A **gesture behavior** is an input utility. It attaches listeners to a mark, tracks active pointer(s), maps pointer coordinates to data-space, and calls the chart's callbacks. It does not know about `Editor` state or broadcasting. The chart's callbacks write to reactive cells and call `dataView.draft` / `updateDraft` / `commit` / `cancel`.

The chart wires them together: it attaches a behavior to a mark and supplies callbacks that update the reactive tree and call the `DataView`. It stores the `detach` function each behavior returns and calls it on dispose.

## DataViewEvent contract

```ts
type DataViewEvent = {
  type: "updated" | "draft" | "commit" | "cancel";
  window?: RenderNode[];
  draft?: DraftEvent;
  isActive: boolean;
};
```

- `isActive === true`: the event originated from this chart's own `Editor`. The chart's own gesture already wrote the reactive cells; it can use the event for status/overlay but should not re-apply the draft.
- `isActive === false`: the event came from cross-tile (`draft`/`commit`/`cancel`) or from the `Kernel` (`updated`). The chart applies the draft to its own reactive cells or transitions to the new committed state.

## Motion policy

Per `wiki/transitions-decision.md` and `wiki/interaction-principles.md`:

- **Reactive motion** — local `draft`/`updateDraft` from the chart's own gesture. The chart writes the reactive cells directly; a `.gesture-active` class on the host suppresses CSS transitions. No reorder, no relayout, no sibling movement.
- **Autonomous motion** — `commit`, `cancel`, `updated`, and cross-tile `draft`/`commit`/`cancel`. These animate with CSS transitions where the chart chooses; they are interruptible, start from the current visual position, and respect `prefers-reduced-motion`. Reorder, relayout, drill, orientation, depth, measure, and enter/exit transitions happen here.

The chart decides reactive vs autonomous by `event.isActive` and `event.type`: reactive only for local `draft`/`updateDraft`; everything else is autonomous.

## Gesture behavior model

Modeled on `bireactive` `drag`/`dragModel`/`d` and on D3 drag. A behavior is a factory function that returns an `attach(element, callbacks)` function; `attach` returns a `detach()` function.

Example shape (not final API):

```ts
const attachDivider = dividerDragBehavior({
  container: svgEl,                  // coordinate space for pointer unprojection
  subject: (el) => chartNodeFor(el), // data node(s) this gesture edits
  isHoriz: () => config.orientation === 'horizontal',
  pairSpan: (a, b) => ...,           // sibling-axis span of the two nodes
});

const detach = attachDivider(handleEl, {
  onStart: (event) => {
    chart.setGestureActive(true);
    chart.captureFrozenOrder();
    dataView.draft({ ... });
  },
  onUpdate: (event) => {
    chart.writeDraftValues(event);
    dataView.updateDraft({ ... });
  },
  onEnd: (event) => {
    chart.clearGestureActive();
    dataView.commit();              // commit handler writes to Kernel
  },
  onCancel: () => {
    chart.restoreSnapshot();
    chart.clearGestureActive();
    dataView.cancel();
  },
});
```

The behavior internally tracks:
- active pointer identifier(s),
- start and current pointer positions in container space,
- `subject` (the data being edited),
- `clickDistance` threshold, so a tap does not become a drag.

It does **not** track the draft value; the callback writes to `num` cells or calls `DataView`. It does **not** own the `Editor` session.

Different marks get different behaviors:
- divider handle → `dividerDragBehavior`
- tile body → `wheelBehavior` / `keyboardBehavior` / `reorderDragBehavior`

## Cross-tile flow

1. Chart A starts a gesture. Its behavior writes A's reactive tree and calls `dataView.draft(...)`.
2. `DataView` A transitions the `Editor` to `Drafting` and broadcasts the `draft` through `Kernel`.
3. Chart B receives the `draft` (`isActive: false`) and writes the proposed value into B's reactive tree. B uses the `frozenOrder` snapshot to keep siblings in place.
4. Chart A continues the gesture; each `updateDraft` broadcasts to B, which updates its preview.
5. On release, Chart A's behavior calls `dataView.commit()`. `DataView` A emits a `commit` event (`isActive: true`); Chart A's `commit` handler writes the final leaf values to `Kernel`.
6. `Kernel` publishes `updated`; all charts receive it and transition to the committed layout. Cross-tile charts also receive the `commit` event to clear the draft overlay.
7. On `Esc`, Chart A calls `dataView.cancel()`. `DataView` broadcasts `cancel`; charts restore their snapshots and transition back.

## Chart lifecycle

1. **Mount**
   - Chart receives `kernel` and `config`.
   - Creates `DataView(kernel, config)`; `DataView` creates an `Editor`.
   - Builds the reactive data model. For hierarchical charts this is a tree of `treeNode`s whose `value` fields are `num()` cells; parent totals are derived with `total()` or a custom `lens()`.
   - Derives `window` from tree + config + drill + `frozenOrder`.
   - Derives `layout` from `window`.
   - Renders `Mark`s via a keyed shape list (`forEach` over `window`, binding shape attributes to reactive cells).
   - Attaches gesture behaviors and stores their `detach` functions.

2. **Config change**
   - Create new `DataView`/`Editor` before disposing old ones.
   - Rebuild the reactive tree if the dataset changed; update derived cells if only display config changed.
   - Re-derive `window`/`layout`; marks transition.

3. **DataView events**
   - `updated` (`isActive: false`): sync committed values into the reactive tree, rebuild if structure changed, re-derive `window`/`layout`; marks transition.
   - `draft` (`isActive: false`): write the proposed value into the reactive tree with `frozenOrder` applied; suppress CSS transitions.
   - `draft` (`isActive: true`): own gesture already wrote cells; update status/overlay only.
   - `commit` (`isActive: true`): write final leaf values to `Kernel` (using `event.draft`), clear `.gesture-active`, remove draft overlay. The subsequent `updated` transitions marks to the committed layout.
   - `commit` (`isActive: false`): clear draft overlay; wait for `updated` to transition.
   - `cancel` (`isActive: true`): restore snapshot, call `dataView.cancel`, clear `.gesture-active`; transition back.
   - `cancel` (`isActive: false`): restore snapshot; transition back.

4. **Dispose**
   - Detach all behaviors.
   - Dispose `DataView`.
   - Tear down reactive effects and the keyed shape list.

## Reactive strategy

Use the public `bireactive` surface:

- `num()` for leaf and scalar values.
- `total(parts)` (or `lens()` for custom relationships) for parent totals that update on child writes and redistribute on parent writes.
- `derive()` for `window` and `layout`.
- `effect()` for applying layout to shapes, or bind shape attributes directly to cells.
- `forEach` for the keyed shape list.
- `rect` / `circle` / `label` / `group` shapes.
- `drag` / `dragModel` / `d` / `draggable` for pointer gestures, or manual listeners when geometry is custom.

CSS transitions live on shape elements. A `.gesture-active` class on the chart host suppresses them during reactive motion.

## Module split for hierarchical charts

To avoid a 900-line file, split by concern:

- `src/hierarchy/tree.ts` — reactive `ChartNode` tree. `build` from `DataView`, `sync`, `snapshotLeaves`, `restoreLeaves`, `findNode`, `findParent`, `leavesOf`.
- `src/hierarchy/window.ts` — `buildWindow(root, config, drillId, frozenOrder)`.
- `src/hierarchy/gestures.ts` — behavior factory functions (divider drag, wheel, keyboard, reorder). Family-agnostic core; geometry context and callbacks passed in.
- `src/hierarchy/render.ts` — keyed shape list with enter/exit fade and `gesture-active` transition suppression.
- `src/icicle/layout.ts` — d3 partition → `Map<id, LayoutRect>`.
- `src/icicle/chart.ts` — thin wiring. Creates `DataView`, tree, window, layout, marks, attaches behaviors.

Sunburst/treemap/pack/tree reuse `tree`, `window`, `gestures`, `render`; swap `layout.ts` and the mark renderer.

## Open questions

- Should we use `bireactive` `dragModel`/`d` for gestures, or write D3-style manual behavior factories? `dragModel`/`d` is public and designed for this.
- Does `bireactive` `forEach` support exit delay, or do we need a custom keyed-list wrapper?
- How exactly does `total()`/`lens()` express the difference between two-sibling reapportion, additive, and proportional-neighbor policies?
- What is the drill transition mechanics? Viewport tween or mark tween?
