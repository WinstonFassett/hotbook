# 2026-08-02 — Reactivity model: kernel bulk-write problem

## The problem

On every gesture commit, `chart-binding.ts` calls `leafValues(root)` to
collect ALL leaf values from the ChartNode tree, then calls
`kernel.writeValues(datasetId, writes)` which:

1. Walks the entire DataNode tree to find each leaf by id and set its value
2. Recomputes ALL parent sums via a full tree walk (`recomputeSums`)
3. Calls `_publish(datasetId)` which notifies ALL kernel subscribers

Each subscriber (`DataView._emitUpdated`) then:
4. Calls `getWindow()` → `buildWindow()` which walks the ENTIRE DataNode tree
   to produce a flat `RenderNode[]` array
5. The chart's `bindChart` handler receives `updated`, calls `rebuild()` →
   `rebuildTree()` which walks the DataNode tree AGAIN to build a new
   ChartNode tree with fresh `num()` cells
6. The chart re-derives layout from the new ChartNode tree

So a single value edit on one leaf triggers:
- 1 full tree walk to collect leaf values (`leafValues`)
- 1 full tree walk to write values + recompute sums (`writeValues`)
- N subscriber notifications (`_publish`)
- N full tree walks to build windows (`buildWindow`)
- N full tree walks to build ChartNode trees (`buildTree`)

For a 1000-node tree with 2 subscribed charts, that's ~6000 node visits
to commit a single value change. This is O(N) per edit, not O(1).

## Why this violates the codebase's own principles

`interaction-principles.md` Principle 4: "Minimize thrashing — preview and
edit with the smallest change to the current view." The kernel does the
opposite: it rebuilds everything from scratch on every commit.

The `transitions-decision.md` doc chose CSS transitions specifically because
"bireactive's whole point is value changes → render flushes instantly."
But the kernel's bulk-write + full-rebuild model means the "value change"
is the ENTIRE dataset, not the one leaf that changed. The fine-grained
reactivity that bireactive provides is short-circuited at the kernel boundary.

## History: how we got here

| Date | Commit | What happened | Reactivity impact |
|---|---|---|---|
| Jul 16 | `75ee93d7` | icicle-harness: first Kernel + DataView. Commit writes single value via `kernel.writeValue(datasetId, nodeId, value)` | O(1) write + O(N) sum recompute + O(N) publish. Acceptable — one value, one publish. |
| Jul 17 | `0bed7c27` | icicle-harness: gesture architecture with bireactive state, shared behaviors. Commit switches to `leafValues(root)` + `kernel.writeValues(datasetId, writes)` | O(N) leaf collection + O(N) write + O(N) publish. Regression from single-value write. Reason: needed atomic two-sibling reapportion (both siblings change, parent sum preserved). Used a sledgehammer: write ALL leaves instead of just the changed pair. |
| Jul 18 | `b65d5db8` | Port icicle + sunburst to bireactive package. Copies kernel.ts verbatim including `writeValues` bulk pattern. | Same O(N) bulk-write, now in the shared package. |
| Jul 18 | `709284f4` | Port treetable. Treetable's primary column `numberDrag` routes through `DataView.draft()` → kernel. | Treetable commits also trigger bulk-write. |
| Jul 21 | `24a0f1ba` | Chart architecture migration. Cartesian charts (bar/bands/radar/concentric arc/gantt) migrated to CartesianChartBase — they do NOT use the kernel at all. | Bifurcation: hierarchical charts use kernel (bulk-write), Cartesian charts use direct cell writes. Two different reactivity models in one codebase. |
| Aug 2 | `e3fb7ac8` | Treetable fix: primary column now also writes BiNode total cell directly. | Workaround for the bifurcation — but means the treetable writes to BOTH the kernel AND the BiNode tree, which is redundant for hierarchical charts and necessary for Cartesian charts. |

## The two reactivity models

### Model A: Kernel-mediated (hierarchical charts)

```
gesture draft → ChartNode.value cell (live preview)
         ↓ commit
leafValues(root) → ALL leaves collected
         ↓
kernel.writeValues → ALL leaves written + sums recomputed
         ↓
_publish → ALL subscribers notified
         ↓
buildWindow → full tree walk → RenderNode[]
         ↓
buildTree → full tree walk → new ChartNode tree (fresh cells)
         ↓
chart re-derives layout
```

The ChartNode tree is **disposable** — rebuilt from scratch on every
commit. The `num()` cells in the ChartNode are not the source of truth;
the DataNode tree in the kernel is. Writing to a ChartNode cell during
draft is a temporary preview; the commit overwrites everything.

### Model B: Direct cell writes (Cartesian charts)

```
gesture → dataCell.value = [...] (new array with changed value)
         ↓
bireactive re-derives layout from dataCell
         ↓
CSS transitions animate the settle
```

No kernel, no DataView, no rebuild. The `dataCell` IS the source of truth.
Writing to it triggers fine-grained reactivity — only the derived cells
that read the changed item re-evaluate. This is the model the
`transitions-decision.md` doc describes.

### Model C: BiNode bridge (demos data model)

```
BiNode tree (with Num.lens cells) ← data model builds this
         ↓ adoptBiRoot
Kernel dataset (snapshot copy, two-way leaf sync)
         ↓
hierarchical chart: Model A
         ↓
Cartesian chart: reads from dataCell, which is synced from BiNode via Num.lens
```

The `bi-adapter.ts` installs a two-way sync: a bireactive `effect` watches
every BiNode leaf cell and pushes changes to the kernel; a kernel
subscription writes changes back to BiNode cells. This means EVERY BiNode
leaf change triggers the kernel bulk-write path, even for Cartesian charts
that don't use the kernel.

## What the kernel should do (design intent vs reality)

### Design intent (from gesture-architecture.md)

> "The Kernel stores values; charts and tables project them."

> "Pubsub: components subscribe. Kernel pushes nothing imperatively."

The kernel was designed as a **pubsub data store**: charts subscribe to
dataset changes, the kernel publishes when data changes. The Editor/Draft
system was layered on top for gesture lifecycle (draft → commit → cancel).

### Reality

The kernel is a **batch-rebuild orchestrator**: on every commit, it
triggers a full tree rebuild for every subscriber. The "pubsub" is really
"broadcast: rebuild everything." The fine-grained reactivity that
bireactive provides (cell-level dependency tracking) is bypassed at the
kernel boundary — the kernel doesn't know what changed, it just knows
"something changed, rebuild all."

The `DataNode` type uses plain `number` for `value`, not a cell. The
kernel mutates these directly. There's no reactive connection between a
`DataNode.value` and the `ChartNode.value` cell that reads it — the
connection is rebuilt from scratch on every `buildTree` call.

## What the right fix looks like

The kernel should be **cell-aware**: instead of storing `DataNode` with
plain `number` values, it should store cells (or the BiNode tree itself
should BE the kernel's data store, since it already has cells).

Two options:

### Option 1: Make DataNode values reactive (minimal change)

Change `DataNode.value` from `number` to `Writable<number>`. The kernel
writes to the cell; `buildTree` reads from it. `recomputeSums` writes to
parent cells. Subscribers don't need `_publish` — they derive from the
cells directly via bireactive's dependency tracking.

- `writeValue` → just set the leaf cell; sums re-derive via `derive`
- `writeValues` → set the changed cells only (no need to write ALL leaves)
- No `_publish` needed — charts derive from cells, not from notifications
- `buildTree` becomes a one-time construction, not a per-commit rebuild

### Option 2: Make the BiNode tree the kernel's data store (deeper change)

Drop the separate `DataNode` tree. The kernel stores BiNode trees
directly. `buildTree` reads from BiNode cells. No snapshot copy, no
two-way sync, no `applying` guard. The BiNode tree IS the dataset.

This eliminates the entire `bi-adapter.ts` sync layer and the dual-tree
redundancy. But it couples the kernel to the bireactive `Cell` type,
which the current `DataNode` type deliberately avoids ("No bireactive
here. These are the domain model.").

## Assessment

The bulk-write pattern is a **regression from the original design**. The
first version (`75ee93d7`, Jul 16) used `writeValue` (single value). The
switch to `writeValues` + `leafValues` (`0bed7c27`, Jul 17) was a
convenience for two-sibling reapportion that threw away the O(1) write
property. It has been cargo-culted through every port since.

The fix is not trivial but is tractable: make the kernel cell-aware so
it writes only changed values and subscribers derive reactively instead
of rebuilding. This aligns the kernel with bireactive's model and with
the codebase's own Principle 4.
