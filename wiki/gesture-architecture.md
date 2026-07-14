# Gesture Architecture — Global State Machine & Transition Contract (WIN-315)

Design doc. **Not code.** The goal is a single gesture contract every chart implements — pie, bar, sunburst, icicle, treemap, gantt, radar, sankey, tree, concentric-arc, gauge — so per-chart code owns *geometry*, not *gesture*.

Reference: `wiki/interaction-principles.md` (Rules 1–17). This doc is the mechanism that makes those rules operational.

Related: `wiki/cross-file-maintainability-audit.md` (WIN-288), `wiki/bireactive-surface-audit.md`, `wiki/rebuild-tech-design.md`.

---

## 1. Why this exists

Every chart re-derives the same gesture logic:

- `SORT_SEC = 0.35` is copy-pasted into 10 files (WIN-288 §1.1).
- Every chart hand-toggles `GESTURE_ACTIVE_CLASS` around its own drag handlers.
- Each chart re-invents a "freeze" flag (`gestureActive`, `dragOrderSnapshot`, `layoutMap`) that gates the reactive layout effect during a gesture.
- Each chart re-decides when to run `SORT_SEC` tweens vs. snap.
- Sort/scale freeze during gesture is enforced *by convention*, checked with `.classList.contains(GESTURE_ACTIVE_CLASS)` scattered through per-chart effects.
- Rule 6 (speculative) is documented but not exposed as an API — hotbook writes preview mutations straight into canonical state and relies on Esc-revert.

Consequences: WIN-288 (duplication), WIN-290/291/292/293/294 (chart-specific reorder fixes), WIN-310 (scale-snap regression), WIN-155 (window-freeze on exit). Every new chart pays this cost from scratch.

The infrastructure already exists (`dragController`, `wheelController`, `reorder-gesture`, `esc-contract`, `handles`, `number-drag`). What's missing is the **model on top**: a named state machine, a provisional/canonical split, and freeze flags addressed by name instead of by CSS class check.

---

## 2. Universal input model

Every value-changing surface produces the same event stream. Input device does not appear in the downstream contract.

| Surface | Where it lives today | Produced intent |
|---|---|---|
| Drag on shape handle | `esc-contract.ts` (`dragCancelable`) | value edit |
| Drag on data mark | per-chart pointerdown → `dragController.begin` | value edit |
| Drag to reorder | `reorder-gesture.ts` (`attachReorderGesture`) | reorder edit |
| Wheel / trackpad pinch | `interaction.ts` (`wheelController`) via `gestures.ts` | value edit |
| Table value drag (hotbook) | `number-drag.ts` (`attachNumberDrag`) | value edit |
| Keyboard nudge | `gestures.ts` (`onKeydown`) | value edit |
| Programmatic (`bireactive` cell write) | any consumer | value edit or reorder (depending on which cell) |

Two intent shapes:

- **Value edit** — a scalar (or vector of scalars) changes. Redistribution is `ScalingMode` (`additive`, `proportional-neighbor`, `proportional-siblings`, `proportional-selected`).
- **Reorder edit** — a permutation of stable ids changes.

Everything else — drill, focus, hover, mode change — is *not* a gesture in the sense this doc uses. Drill and mode-change are commit-only transitions (see §7).

---

## 3. Global gesture state machine

One state per host chart. The states are:

```
       ┌──────────────── cancel ──────────────┐
       ▼                                      │
     idle ──begin(intent)──▶ gesturing ──commit──▶ settle ──▶ idle
       ▲                        │
       │                        └─cancel──▶ (revert) ──▶ idle
       │
       └───────── programmatic edit (skip gesturing, straight to settle) ──────┘
```

### States

| State | Meaning | Invariants |
|---|---|---|
| `idle` | No live gesture. | Canonical model = displayed model. Sort/scale live. Autonomous transitions may be running. |
| `gesturing` | A speculative edit is live. | Provisional model diverges from canonical. Sort **frozen** (Rule 7). Scale **frozen** (Rule 15) with radial exception. Only reactive motion (Rules 3, 9). Snapshot retained. |
| `settle` | Commit applied; the visualization is animating to the new canonical state. | Canonical model = target. Autonomous transitions running (reorder, measure-swap, scale re-eval, zoom-to-fit). Interruptible (Rule 11). |

### Transitions

| Event | Guard | Effect |
|---|---|---|
| `begin(intent)` | state == `idle` and no other gesture live (Rule 5) | Snapshot canonical values (for revert). Start provisional model = clone of canonical. `state = gesturing`. Set `GESTURE_ACTIVE_CLASS` on host. |
| `update(delta)` | state == `gesturing` | Mutate provisional model. Emit `preview` — chart draws from provisional. No sort/scale re-eval. |
| `commit` | state == `gesturing` | Copy provisional → canonical (single batched write). Drop snapshot. `state = settle`. Re-eval sort, scale, layout. Kick off autonomous transitions from current visual state (Rule 4). |
| `cancel` | state == `gesturing` | Restore snapshot into canonical. Drop provisional. `state = idle`. No sort/scale re-eval, no settle. |
| `settled` | state == `settle`, all tweens done | `state = idle`. |
| `interrupt(new-intent)` | state == `settle` | Autonomous transitions read current mid-tween positions as the new start (Rule 11). Enter `gesturing` on the new intent. |

### Rule mapping

| Rule | Enforcement point |
|---|---|
| 2 Scale stability | `gesturing` freezes scale domain — see §4 freeze flags. |
| 3 Real-time feedback | `preview` emits every `update`. |
| 4 Good mechanics | Autonomous transitions start from current visual state, not from snapshot. |
| 5 Atomicity | `begin` guard: only one gesture at a time (already enforced by `dragController`). |
| 6 Speculative | `provisional` is a separate object; `cancel` restores snapshot; canonical never mutates until `commit`. |
| 7 Derived reorders | Sort re-eval only inside `commit`. |
| 11 Interruptible | `interrupt` transition. Mid-tween positions are the new starting positions. |
| 15 Scale defers | Scale domain snapshot at `begin`; re-eval only at `commit`. Radial exception carried in the geometry layer, not the state machine. |
| 16 Zoom-to-fit | Runs during `settle`, not during `gesturing`. |

---

## 4. Provisional vs canonical model

The single biggest missing piece today. In current code the "provisional" state is *implicit* — chart-local variables (`dragOrderSnapshot`, `snap`, `layoutMap`) plus GESTURE_ACTIVE_CLASS as a "please don't reorder" flag.

Proposed formal shape:

```ts
// packages/bireactive/src/lib/gesture-model.ts (new)

export type GestureIntent =
  | { kind: "value-edit"; target: BiNode; mode: ScalingMode; fixedTotal?: number }
  | { kind: "reorder"; parent: BiNode }
  | { kind: "reorder-flat"; ids: readonly string[] };

export interface GestureSnapshot {
  values: Map<BiNode, number>;  // canonical value.total per touched node
  order: Map<BiNode, string[]>; // canonical child order per touched parent
  scaleDomain?: [number, number]; // for cartesian
  visualPositions?: unknown;      // reactive-motion snapshot the layout owns
}

export type GestureState = "idle" | "gesturing" | "settle";

export interface GestureController {
  readonly state: GestureState;
  readonly intent: GestureIntent | null;
  readonly snapshot: GestureSnapshot | null;
  readonly frozen: {
    readonly sort: boolean;
    readonly scale: boolean;
  };

  begin(intent: GestureIntent, snap: GestureSnapshot): void;
  update(mutate: (draft: ProvisionalDraft) => void): void; // batched
  commit(): void;
  cancel(): void;

  onEnter(fn: (state: GestureState) => void): () => void;
  onPreview(fn: (draft: ProvisionalDraft) => void): () => void;
  onCommit(fn: () => void): () => void;
  onCancel(fn: () => void): () => void;
}
```

Where `ProvisionalDraft` is a mutable view over the tree that reads live cells but *writes to an overlay*. During `gesturing`, chart layout effects read through the overlay; outside `gesturing`, they read canonical directly.

Two implementation strategies (pick one — likely (a) for its blast radius):

- **(a) Overlay reads.** Layout effects call `provisionalTotal(node)` instead of `node.value.total.value`. During `gesturing`, this returns the overlay value; during `idle`/`settle` it returns canonical. Cheapest change; touches every layout site once.
- **(b) Direct writes with snapshot.** Provisional writes go straight into canonical cells (current hotbook behavior). Snapshot is retained for revert. Requires no layout-site changes but keeps the "gestures are speculative" contract implicit and forces reactive consumers (hotbook table) to detect and ignore the mid-gesture writes. **This is what today does.**

Recommendation: start with (b) as the compatibility baseline (drop-in replacement for the current implicit contract) and offer (a) as an opt-in per chart. Full migration to (a) is a separate ticket.

---

## 5. Layer responsibilities

Each layer owns one concern and exposes exactly the surface the layer above needs. Nothing above the layer boundary should touch anything below.

| Layer | Owns | Exposes | Freeze semantics |
|---|---|---|---|
| **L1 Data / store** | Canonical `BiNode` tree, `value.total` cells, id identity, delete/insert. | `applyDelta`, `applyReorder`, cell subscriptions. | None — canonical is always current. |
| **L2 Provisional (new)** | Overlay values during `gesturing`. Snapshot for revert. Emits `preview`/`commit`/`cancel`. | `GestureController` (§4). | Owns freeze flags; other layers read `frozen.sort` / `frozen.scale` from here. |
| **L3 Hierarchy** | `BiNode.index`, `.total`, derived children, sort comparator, stable identity. | `sortBy`, `measureKey`, comparator; iteration helpers. | Comparator uses canonical (never provisional). Sort re-eval callback runs on `commit`, not on cell change. |
| **L4 Layout** | Geometry: pie slices, bar rects, icicle tiles, sunburst arcs, sankey paths. Cartesian scale domain. | `layout(state) → geometry`, `scaleDomain`. | Reads `frozen.sort` → uses canonical order. Reads `frozen.scale` → uses snapshotted domain. |
| **L5 Marks / lifecycle** | `windowedMarks`, `forEach`, `key`, enter/update/exit, drill lifecycle, elevated `[data-reordering]` DOM. | Mark handle refs; tweens keyed to visual position (not target). | Interrupts running tweens at `interrupt` and restarts from current position. |
| **L6 Chart surface** | Geometry-specific input mapping: which SVG element gets `dragCancelable`, where the reorder hit-zone is, radial vs linear coordinate math. Also: the *shape* of a handle (rectangle end vs. arc edge). | Chart-level API (`sortBy`, `data`, `onUpdate`, `onReorder`, drill events). | Never sets freeze flags directly — it dispatches `begin`/`commit`/`cancel` on the controller. |

**Rule of the layer contract:** a chart surface never toggles `GESTURE_ACTIVE_CLASS` itself, never freezes its own scale, never snapshots values into a local variable, and never checks `.classList.contains(GESTURE_ACTIVE_CLASS)` in a layout effect. All of that flows through the L2 controller.

---

## 6. Geometry taxonomy (not gesture taxonomy)

Every chart in this repo maps to one of four geometries. Geometry decides handle shape and coordinate math; it does **not** decide gesture behavior.

| Family | Charts | Value-edit handle | Reorder region | Coordinate |
|---|---|---|---|---|
| **Linear-cartesian** | bar-chart, area-chart, line-chart, scatter-chart, gantt, treetable | edge of bar / drag on rect | bar body (or dedicated grip) | (x, y) → domain |
| **Space-filling rectangular** | treemap, icicle, budget-tree, pack (rect nodes) | edge of tile | tile body | (x, y) → geometry |
| **Radial** | pie-chart, sunburst, concentric-arc, gauge, gauge-segmented, radar-chart | arc edge / handle at boundary | arc body | angle, radius |
| **Network / flow** | sankey, sankey-flow, tree-chart | node/link (currently no live resize) | node (row / column swap) | topology + layout |

Radial gets the Rule 15 exception (proportion is the coordinate). Otherwise the state machine is unchanged.

Handle shapes live in `handles.ts` (already exists — radial handles + linear handles). New chart = new geometry mapping + reuse of L2/L3/L4/L5.

---

## 7. Transition contract

Named transitions, one duration variable per name. All names are multipliers of a base rhythm (Rule 10). Base + role tokens live in `packages/bireactive/src/lib/transitions.ts`.

| Transition | Trigger | Speed | Notes |
|---|---|---|---|
| **preview** (reactive) | `gesturing.update` | 0 — immediate | Rule 3. |
| **reorder** | `commit` when comparator produced new order | `SORT_SEC × 1.0` | Rule 7. From current visual pos. |
| **value-settle** | `commit` when only values changed | 0 (snap) if same geometry, `SORT_SEC × 1.0` if measure-swap | Rule 15 causes scale to change once — animate it. |
| **scale-rescale** | `commit` when scale domain changed | `SORT_SEC × 1.0` | Rule 15. Live only in `settle`, never in `gesturing`. |
| **drill** | user double-click / programmatic drill | `DRILL_SEC × 1.0` | Rule 17. Identity-preserving morphs. |
| **enter** | new datum appears | `ENTER_SEC × 1.0` | Rule 12: label rides shape. |
| **exit** | datum removed / drilled past | `EXIT_SEC × 1.0` | Rule 12. |
| **mode-morph** | radial↔linear, linear↔rectangular | `MORPH_SEC × 1.0` | Rule 13. Colors tween, not snap. |
| **zoom-to-fit** | after `settle` if bounds changed | `SETTLE_SEC × 1.0` | Rule 16. |
| **hover** | pointer enter/leave | short | Not a gesture — hover is stateless. |

**All autonomous transitions are interruptible** (Rule 11). Interruption reads mid-tween state, not target. This is a property of the mark-lifecycle layer (L5), not the state machine — but the state machine mandates that L5 provide it.

---

## 8. Implementation matrix

Legend: ✅ implemented • ~ partial • ❌ missing • — n/a for this chart.

Cols: **Handle** = drag on shape handle; **Mark** = drag on data mark; **Wheel** = wheel/pinch; **Table** = hotbook table value drag (via `number-drag.ts`); **Keys** = keyboard nudge; **Reorder** = drag-to-reorder; **Esc** = Rule 6 cancel; **Sort-freeze** = Rule 7 during gesture; **Scale-freeze** = Rule 15 during gesture; **Drill** = animated drill; **Mode-morph** = animated cross-mode.

| Chart | Family | Handle | Mark | Wheel | Table | Keys | Reorder | Esc | Sort-freeze | Scale-freeze | Drill | Mode-morph |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pie-chart | radial | ✅ | ~ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — (Rule 15 exc.) | — | ✅ (arc↔rect) |
| sunburst | radial | ~ | ~ | ✅ | ✅ | ✅ | ~ | ~ | ✅ | — (Rule 15 exc.) | ~ | ~ |
| concentric-arc | radial | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | — (Rule 15 exc.) | — | ❌ |
| gauge / gauge-segmented | radial | ✅ | ❌ | ✅ | ✅ | ✅ | — | ✅ | — | — | — | — |
| radar-chart | radial | ~ | ❌ | ✅ | ✅ | ✅ | ❌ | ~ | ✅ | ~ | — | ❌ |
| bar-chart | linear | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (WIN-310) | — | ✅ (rect↔arc) |
| line-chart | linear | ❌ | ❌ | ❌ | ~ | ❌ | — | — | ✅ | ❌ | — | ❌ |
| area-chart | linear | ❌ | ❌ | ❌ | ~ | ❌ | — | — | ✅ | ❌ | — | ❌ |
| scatter-chart | linear | ❌ | ❌ | ❌ | ~ | ❌ | — | — | ✅ | ❌ | — | ❌ |
| gantt | linear | ✅ | ~ | ✅ | ✅ | ✅ | ~ | ~ | ✅ | ~ | — | — |
| treetable | linear | ❌ | ❌ | ❌ | ✅ | ✅ | ~ | — | ✅ | — | ~ | — |
| icicle | rect | ~ | ~ | ✅ | ✅ | ✅ | ~ | ~ | ✅ | ~ | ~ | ~ |
| treemap | rect | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | — | ~ | ✅ (rect↔rect) |
| budget-tree | rect | ~ | ~ | ✅ | ✅ | ✅ | ~ | ~ | ✅ | ~ | ~ | ~ |
| pack | rect | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | — | ~ | ❌ |
| sankey / sankey-flow | flow | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ~ | — | ❌ |
| tree-chart | flow | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | — | ~ | ❌ |

Wheel/keys/table are ✅ almost universally because `gestures.ts` (`attachChartGestures`) is a shared attachment — this is the closest thing to the target architecture that already exists.

Handle/mark/reorder are chart-local because each chart re-implements them. **This is the primary duplication to fix.**

---

## 9. Centralization plan

Concrete files. Non-negotiable: nothing here is a rewrite — this is refactoring the existing modules and re-routing chart code through them.

### 9.1 New module

`packages/bireactive/src/lib/gesture-model.ts`

- Exports `GestureIntent`, `GestureSnapshot`, `GestureState`, `GestureController`.
- Factory `makeGestureController(host: HTMLElement, options): GestureController`.
- Owns `GESTURE_ACTIVE_CLASS` toggling (no chart touches the class directly after migration).
- Owns freeze flags: `frozen.sort`, `frozen.scale`. Layout effects (L4) subscribe.
- Wires into `dragController` / `wheelController` under the hood — those stay as low-level event plumbing.

### 9.2 Modules to fold into the model (thin adapters after migration)

- `packages/bireactive/src/lib/esc-contract.ts` (`dragCancelable`) → still the pointer-in adapter for shape handles, but calls `gestureController.begin({kind:"value-edit",...})` instead of `dragController.begin` directly.
- `packages/bireactive/src/lib/reorder-gesture.ts` → same treatment for `{kind:"reorder"}`.
- `packages/bireactive/src/lib/number-drag.ts` (hotbook table) → same.
- `packages/bireactive/src/lib/gestures.ts` (`attachChartGestures`) → wheel/keys already central; wire through the controller so cross-tile sync and gesture state stay coherent.

### 9.3 Timing tokens (already scheduled by WIN-288)

Consolidate `SORT_SEC`, `DRILL_SEC`, `REORDER_SEC*`, `DUR_MOVE`, `DUR_ENTER`, `DUR_EXIT` into `transitions.ts` as **multipliers of one base** (Rule 10). Every chart imports names, not literals.

### 9.4 Freeze flag flip

Every chart layout effect currently guarded by `if (!this.classList.contains(GESTURE_ACTIVE_CLASS))` becomes `if (!gestureController.frozen.sort)` (or `.scale`, matching intent). Same semantics, named source of truth, and one place to change behavior.

### 9.5 Migration order

1. Land `gesture-model.ts` behind a feature flag. Zero chart changes.
2. Rewire `dragCancelable`, `attachReorderGesture`, `number-drag`, `attachChartGestures` to route through the controller. Charts still get the exact same behavior.
3. Migrate one chart end-to-end (recommend **pie-chart**: it has the most gesture surface already ✅, so it exercises every path) — replace class-check guards with `frozen.sort`/`frozen.scale` and use the provisional overlay. Verify no regressions.
4. Migrate remaining radial charts (sunburst, concentric-arc, gauge, gauge-segmented, radar).
5. Migrate linear charts (bar, gantt, treetable) — this is where WIN-310 gets closed structurally.
6. Migrate rect charts (icicle, treemap, budget-tree, pack).
7. Migrate flow charts (sankey, tree-chart) — mostly a no-op today; they gain the framework so they can add live edit later.
8. Delete the per-chart snapshot / freeze-flag / `GESTURE_ACTIVE_CLASS` scaffolding.

Each step ships independently. The feature flag exists only for steps 1–2; from step 3 onward the controller is always live and per-chart adoption is what varies.

---

## 10. Sub-tickets to open

The parent (WIN-315) tracks design agreement. Implementation lands as sub-tickets under a parent WIN-3XX "gesture-model migration" epic (to be created).

- **[gesture-model-core]** Introduce `packages/bireactive/src/lib/gesture-model.ts` with `GestureController`, freeze flags, wire it up in tests. No chart changes. **Blocks: everything below.**
- **[gesture-model-adapters]** Rewire `dragCancelable`, `attachReorderGesture`, `number-drag`, `attachChartGestures` to route through the controller. No chart-facing API change.
- **[gesture-model-tokens]** Fold `SORT_SEC`, `DRILL_SEC`, `REORDER_SEC*`, `DUR_MOVE`, `DUR_ENTER`, `DUR_EXIT` into `transitions.ts` as multipliers of one base. Merge with WIN-288 remediation if still open.
- **[gesture-model-pie]** Migrate pie-chart to controller + provisional overlay. Reference chart.
- **[gesture-model-radial]** Migrate sunburst, concentric-arc, gauge, gauge-segmented, radar-chart.
- **[gesture-model-linear]** Migrate bar-chart (closes WIN-310 structurally), gantt, treetable.
- **[gesture-model-rect]** Migrate icicle, treemap, budget-tree, pack.
- **[gesture-model-flow]** Migrate sankey, sankey-flow, tree-chart.
- **[gesture-model-cleanup]** Delete per-chart snapshot/freeze scaffolding and the `GESTURE_ACTIVE_CLASS` direct toggles. `grep` should return zero hits outside `gesture-model.ts` / `transitions.ts`.
- **[gesture-model-provisional-overlay]** Optional: switch strategy (b) → (a) per §4. Deferred until strategy (b) is fully migrated and its limits are hit.

Each sub-ticket's Definition of Done includes: (1) no regressions in the affected charts' live demos, (2) `wiki/interaction-principles.md` audit rows updated where applicable, (3) the implementation matrix (§8) updated.

---

## 11. Non-goals

- Not changing any chart's visible behavior beyond fixing the freeze/regression gaps this exposes.
- Not touching `interaction-principles.md` unless the design uncovers a missing or wrong principle (none found so far).
- Not designing flat↔hierarchical cross-mode transitions (Rule 17 tail) — the architecture leaves the door open, but that work is a separate ticket.
- Not introducing a runtime dependency on a third-party state-machine library. `GestureController` is ~200 lines of plain code.

---

## 12. How this closes the confusion behind WIN-288 and WIN-310

- **WIN-288 (duplication)**: `SORT_SEC` and friends stop being per-file. Every "should I tween or snap?" branch becomes a named-transition call (`preview`, `settle`, `reorder`) whose duration comes from one token. Per-chart code loses ~30 lines of freeze/snapshot bookkeeping each.
- **WIN-310 (scale-snap regression)**: Rule 15 is *enforced by the state machine* — `frozen.scale` is true during `gesturing` and no layout effect can see live domain changes until `commit`. The bar-chart bug happens because today's code has to remember to check `GESTURE_ACTIVE_CLASS` at the *scale* effect specifically. In the new model, the scale layer (L4) reads `frozen.scale` unconditionally.
- **WIN-155 (window freeze on exit)**: exit-tile freeze is a mark-lifecycle (L5) concern layered on top of the state machine — the machine says "settle transitions run from current visual state," and L5 provides the mid-tween-anchored positions. Chart code stops re-implementing window freeze.
- **WIN-290..294 (per-chart reorder fixes)**: reorder becomes a single code path with per-geometry `computeTargetIndex`. New chart adds a `computeTargetIndex` and gets everything else for free.
