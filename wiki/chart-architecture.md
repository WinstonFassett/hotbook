# Chart architecture — shared parts

Status: design (capture of current intent, not code).

Every chart spec in `wiki/specs/*.md` describes chart-specific behavior. This doc names the reusable parts all charts are built from, so specs do not repeat them. It is the entry point. Detail lives in:

- `wiki/gesture-architecture.md` — `Editor`/`DataView`/`Kernel.Drafts` contract and family effect contracts.
- `wiki/interaction-principles.md` — user-facing rules.
- `wiki/transitions-decision.md` — CSS transitions and gesture suppression.

Older architecture drafts that conflict with this doc are in `wiki/stale/`.

## Core stance

- Charts are **autonomous consumers**. The `Kernel` publishes data and pre-edit events; the chart subscribes and decides how to render. (`interaction-principles.md` #10)
- Charts are **components in control**. A chart creates its own `DataView` and `Editor`; the host does not push state into it.
- Prefer **functions and plain data** over classes and information hiding. State lives where it is used; utilities are just functions.
- Use the full public `bireactive` surface (`num`, `Num.lens`, `derive`, `effect`, `rect`, `forEach`, etc.), not just `cell/derive/effect`.
- CSS transitions for autonomous motion; immediate write-through for gesture feedback. (`transitions-decision.md`)

## The parts

| Part | Responsibility | Lifecycle |
|---|---|---|
| `Chart` | Custom element. Owns container, config, `DataView`, marks, gesture behaviors. | mount, config change, dispose |
| `DataView` | Query-keyed subscription into `Kernel`. Owns one `Editor`. | created when chart receives `config`; disposed on unmount/config change |
| `Editor` | Persistent per-chart session: `Idle` ↔ `Drafting`. Carries `currentDraft`. Broadcasts cross-tile. | lives as long as `DataView` |
| `Gesture behavior` | A function that attaches input listeners to a mark and calls callbacks (`start`/`update`/`end`). Manages its own active pointer state, like D3 drag. | created per mark on mount; callbacks fire per user input |
| `Mark` | Visual element(s) for one data item (rect, circle, label, group). Built with `bireactive` shapes. | created/removed by keyed list; updated by reactive cells |
| `Layout` | Pure function from data + config to geometry in data-space. | recomputed when values/config change |
| `Transition` | Visual settle. Prefer CSS transitions; `tween`/`Anim` only when CSS cannot express. | suppressed during gesture feedback |
| `Viewer` (optional) | Viewport over data-space for pan/zoom/fit/drill. | only when the chart needs it; see `viewer-architecture.md` |

## Editor vs gesture behavior

- `Editor` is the **session authority**. `Idle`/`Drafting`, `currentDraft`, cross-tile broadcast. It does not know about pointers or coordinates.
- A **gesture behavior** is an input utility, like `d3-drag`. It attaches listeners, tracks the active pointer(s), maps pointer coordinates to data-space, and calls the chart's callbacks. It does not broadcast or know about `Editor` state. The chart's callbacks call `dataView.draft/updateDraft/commit/cancel`.

The chart wires them together: it attaches a gesture behavior to a mark and supplies callbacks that talk to the `Editor`/cells. The behavior can support multiple concurrent pointers (one per identifier) or be configured for one-at-a-time.

## Gesture behavior model

Modeled on `d3-drag`. A behavior is a factory function that returns an `apply(element, callbacks)` function, plus config setters.

Example shape (not final API):

```ts
const divider = dividerDragBehavior({
  container: svgEl,                  // coordinate space for pointer unprojection
  subject: (el) => chartNodeFor(el), // data node(s) this gesture edits
  isHoriz: () => config.orientation === 'horizontal',
  pairSpan: (a, b) => ...,             // sibling-axis span of the two nodes
});

divider(handleEl, {
  onStart: (event) => dataView.draft({ ... }),
  onUpdate: (event) => dataView.updateDraft({ ... }),
  onEnd: (event) => { writeLeafValues(); dataView.commit(); },
  onCancel: () => { restoreSnapshot(); dataView.cancel(); },
});
```

The behavior internally tracks:
- active pointer identifier(s), so a second pointer/touch does not start a conflicting gesture,
- start and current pointer positions in container space,
- `subject` (the data being edited),
- `clickDistance` threshold, so a tap does not become a drag.

It does **not** track the draft value; the callback writes to `num` cells or calls `DataView`. It does **not** own the `Editor` session.

A chart attaches different behaviors to different marks:
- divider handle → `dividerDragBehavior`
- tile → `wheelBehavior` / `keyboardBehavior` / `reorderDragBehavior`

## Chart lifecycle

1. **Mount**
   - Chart receives `kernel` and `config`.
   - Creates `DataView(kernel, config)` and `Editor`.
   - Builds the reactive data model (e.g. `ChartNode` tree for hierarchical charts with `num()` leaves and `Num.lens()` parents).
   - Derives `window` from data + config + drill + `frozenOrder`.
   - Derives `layout` from `window`.
   - Renders `Mark`s via keyed shape list, binding shape attributes to `num`/`Vec` cells.
   - Attaches gesture behaviors to marks.

2. **Config change**
   - Create new `DataView`/`Editor` before disposing old ones.
   - Rebuild reactive model if dataset changed; update derived cells if only display config changed.
   - Re-derive `window`/`layout`, re-render marks.

3. **Data update (`updated` event from `DataView`)**
   - Sync committed values into the reactive data model.
   - If structure changed, rebuild the model.
   - `window`/`layout` `derive` re-runs; marks update via CSS transition (not gesture feedback).

4. **Draft / commit / cancel events**
   - `draft` / `updateDraft`: `Editor` broadcasts; cross-tile charts apply draft to their own models. The active chart's behavior callback already wrote the live value.
   - `commit`: behavior callback writes final leaf values to `Kernel`, then calls `dataView.commit()`. `Editor` returns to `Idle`. Cross-tile charts transition.
   - `cancel`: behavior callback restores snapshot, calls `dataView.cancel()`. Cross-tile charts revert.
   - The chart host has a `gesture-active` class while any behavior has an active pointer, suppressing CSS transitions for immediate feedback.

5. **Dispose**
   - Detach behaviors.
   - Dispose `DataView`.
   - Tear down reactive effects and shape list.

## Motion policy

Per `wiki/transitions-decision.md` and `wiki/interaction-principles.md`:

- **Reactive motion** — direct manipulation feedback during a gesture. Values update and render immediately; CSS transitions are suppressed by a `.gesture-active` class on the chart host.
- **Autonomous motion** — changes that happen after `commit`/`cancel`, or from `Kernel` `updated` events and config changes (reorder, drill, depth, orientation, enter/exit). These animate with CSS transitions if the chart chooses; they are interruptible and respect `prefers-reduced-motion`.

The `Editor` does not dictate which class a change belongs to; it only signals `draft`/`commit`/`cancel`/`updated`. The chart decides whether a given value change is reactive (no transition) or autonomous (transition).

## Module split for hierarchical charts

To avoid a 900-line file, split by concern:

- `src/hierarchy/tree.ts` — reactive `ChartNode` tree. `num()` leaves, `Num.lens()` parents. `build`, `sync`, `snapshotLeaves`, `restoreLeaves`, `findNode`, `findParent`, `leavesOf`.
- `src/hierarchy/window.ts` — `buildWindow(root, config, drillId, frozenOrder)`.
- `src/hierarchy/gestures.ts` — behavior factory functions (divider drag, wheel, keyboard, reorder). Family-agnostic core; geometry context and callbacks passed in.
- `src/hierarchy/render.ts` — keyed shape list with enter/exit fade and `gesture-active` transition suppression.
- `src/icicle/layout.ts` — d3 partition → `Map<id, LayoutRect>`.
- `src/icicle/chart.ts` — thin wiring. Creates tree, window, layout, marks, attaches behaviors.

Sunburst/treemap/pack/tree reuse `tree`, `window`, `gestures`, `render`; swap `layout.ts` and mark renderer.

## Reactive strategy

Use the public `bireactive` surface:

- `num()` for leaf and scalar values.
- `Num.lens()` for parent totals that scale children proportionally on write.
- `Vec` / `Vec.lens()` cells for positions/sizes.
- `derive()` for `window` and `layout`.
- `effect()` for applying layout to shapes.
- `rect` / `circle` / `label` / `group` shapes.
- `forEach` or custom keyed list for stable mark lifecycle.
- `draggable` or manual pointer listeners via behavior functions.

CSS transitions on shape elements. A `.gesture-active` class suppresses them during gesture feedback.

## Open questions

- Should we use `d3-drag` directly or write a small behavior factory that copies its model? `d3-drag` handles mouse/touch/pointer mapping, containers, subjects, and active counts well.
- How does the keyed shape list interact with `forEach` exit delay? Custom wrapper or accept immediate removal for the harness?
