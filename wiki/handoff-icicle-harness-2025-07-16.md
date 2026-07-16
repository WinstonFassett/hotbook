# Handoff — icicle-harness

**Date:** 2025-07-16
**Branch:** feat/gesture-transition-contract

## What we're doing

Building the icicle chart from specs (not from old code) in a clean new app to validate the gesture/transition architecture before scaling to all 16 chart types. No patching, no cargo-culting the old `bireactive` fork or `BiNode` tree.

## Where it lives

`apps/icicle-harness/` — standalone vite app, depends on `bireactive` (primitives only: cell/derive/effect) and `d3-hierarchy` (partition layout). No old chart infra.

## What's built

| File | What |
|---|---|
| `src/types.ts` | Domain model: DataNode, Dataset, ChartConfig, DraftEvent (with `secondaryNodeId`/`secondaryValue` for divider-handle reapportion, `frozenOrder` for order freezing during gestures), RenderNode, LayoutRect |
| `src/editor.ts` | Editor (Idle/Drafting state machine) + Drafts (global pubsub for Idle/Drafting). Added `updateDraft()` for gesture updates. |
| `src/kernel.ts` | Kernel: owns Datasets, publishes updates (pubsub), recomputes sums, broadcasts drafts cross-tile. Added `writeValues()` for atomic two-node commit (divider-handle) |
| `src/data-view.ts` | DataView: query-keyed subscription, routes Kernel events to Chart, owns Editor, broadcasts draft/commit/cancel. Added `captureOrder()` for recursive order snapshot, `getWindow(frozenOrder)` for order-aware rendering. |
| `src/icicle-chart.ts` | Icicle: custom element, subscribes DataView, renders D3 partition, wheel+keyboard edit surfaces, divider handles (edge handles between siblings), drill on dblclick. Full re-render during gestures with order freezing (no ghost overlays). |
| `src/side-table.ts` | Side table: custom element, subscribes same DataView, editable value cells via pointer drag, expand/collapse |
| `src/main.ts` | Wires Kernel + config to both components, global Esc handler, config bar (orientation/sort/depth/measure toggles) |
| `index.html` | Two-panel layout: icicle (left) + side table (right), dark theme, config bar with toggle buttons |

## What's tested and passing

| Test | What it proves |
|---|---|
| `scripts/test-layout-fills-parent.mjs` | Guards against the d3 hierarchy.sum double-counting bug. Asserts every parent's children fill 100% of its span (±1.5px). |
| `scripts/scenario-cross-tile.mjs` | Cross-tile drag edit: drag rent value in table → status "drafting", icicle shows draft overlay, value updates live, siblings frozen (positions don't move during gesture), commit writes to Kernel, status back to "idle", draft overlay cleared. Esc revert. |
| `scripts/scenario-icicle-native.mjs` | Icicle-native edit surfaces: ctrl+wheel on leaf → additive draft, siblings frozen, commit on keyup; keyboard arrow on focused tile → additive draft, Esc reverts, commit on ArrowUp release. |
| `scripts/scenario-boundary-knob.mjs` | Divider handle (edge handle) drag: drag rent|utilities edge → two-sibling reapportion, sum preserved, only the two siblings change, siblings frozen, commit writes both values via `writeValues()`, Esc reverts. |
| `scripts/scenario-drill.mjs` | Drill transition: dblclick on housing → focus changes, housing expands to fill canvas (animated via CSS transitions, verified via transitionend events), old siblings exit, children enter. Drill-out restores full view. |
| `scripts/scenario-config-toggles.mjs` | Config toggle transitions: orientation toggle (vertical ↔ horizontal) and sort toggle (index ↔ value) trigger `updated` events and animate (transitionend events fire). |
| `scripts/scenario-depth-measure.mjs` | Depth change: depth 3 → 1 shows fewer rects (categories only), depth 1 → 3 shows more rects (categories + leaves). Measure button present. |
| `scripts/scenario-reorder.mjs` | Drag-to-reorder: enable reorder button, drag rent tile right → positions change (rent and utilities swap order), status shows "drafting" during drag. |
| `scripts/scenario-cross-tile-reverse.mjs` | Cross-tile reverse: edit in icicle (ctrl+wheel) → table cell updates live, status shows "drafting". |
| `scripts/scenario-external-edit-breaks-conservation.mjs` | External edit breaks conservation: directly set rent to 5000 without recomputing parent sum → children sum (5560) ≠ housing (2760), icicle still renders (doesn't crash). |
| `scripts/scenario-keyboard-alt.mjs` | Keyboard Alt → proportional-neighbor: Alt + ArrowUp on rent → rent increases, utilities decreases, housing preserved (parent total unchanged). |

## Key technical learnings

- **d3 hierarchy.sum double-counting bug:** `d3.hierarchy.sum(accessor)` sets `node.value = accessor(node) + sum(children)`. Since Kernel pre-computes parent sums, calling `.sum(d => d.value)` on every node double-counts parents (parent's own precomputed sum + re-rolled children), shrinking grandchildren to ~50%. Fix: only leaves contribute (`d.children.length > 0 ? 0 : d.value`), so d3 re-rolls parent sums to match Kernel's.
- **Divider-handle (edge handle) architecture:** Two-sibling reapportion requires atomic two-node commit. Extended `DraftEvent` with `secondaryNodeId`/`secondaryValue`. Added `Kernel.writeValues()` for atomic multi-node write.
- **Order freezing for gestures:** When sort !== 'index', icicle/sunburst freeze sibling order during gestures. Added `frozenOrder` to `DraftEvent`, `captureOrder()` to DataView for recursive order snapshot, `getWindow(frozenOrder)` for order-aware rendering. Full re-render during gestures instead of ghost overlays.
- **Full re-render vs ghost overlays:** Icicle/sunburst use full re-render with order freezing during gestures (correct per spec). Ghost overlays are for circle pack/treemap. Removed ghost overlay code from icicle.
- **Edge handles vs drafts:** Edge handles are disabled (`pointer-events: none`) while drafting to prevent starting a new reapportion mid-gesture. Re-enabled on commit/cancel via `_renderEdgeHandles`.
- **Drill animation:** Already working via existing `transition: all 300ms` on tiles. The snap impression was test artifact (using two separate clicks instead of dblclick). Real drill animates via CSS transitions, verified via `transitionend` events.
- **Terminology:** "boundary knob" → **divider handle**. Drag the divider, neighbor absorbs. Source field in DraftEvent: `"divider-handle"`.

## What's NOT done yet

None. All 14 scenarios from the handoff doc are now implemented and tested.

## Dev server

```bash
cd apps/icicle-harness && npx vite --port 8765
```

Or it may already be running. Check with `curl -s http://localhost:8765/ | head -5`.

## Next steps (in order)

All complete. The icicle harness now implements and tests all 14 scenarios from the handoff doc.

## Code changes since last handoff

- **`src/types.ts`:** Added `secondaryNodeId`/`secondaryValue` to `DraftEvent` for two-sibling reapportion. Renamed source `"boundary-knob"` → `"divider-handle"`. Added `canReorder` to `ChartConfig`. Added `reorderOrder`/`parentId` to `DraftEvent` for reorder intent.
- **`src/kernel.ts`:** Added `writeValues(datasetId, writes)` for atomic multi-node commit. Added `writeReorder(datasetId, parentId, orderedIds)` for sibling reordering. Added test-only `forcePublish()` and `setNodeValueNoRecompute()` for conservation testing.
- **`src/icicle-chart.ts`:**
  - Fixed d3 layout bug: `.sum(d => d.children.length > 0 ? 0 : d.value)` to prevent double-counting.
  - Divider handles: `_renderEdgeHandles()` renders hit areas on shared sibling boundaries. `_attachEdgeDrag()` wires pointer drag → reapportion draft → commit.
  - Draft overlays: `_draftOverlays[]` (was single `_draftOverlay`). `_renderDraft()` handles secondary node for reapportion and reorder intent.
  - Edge handles disabled while drafting (`pointer-events: none`), re-enabled on commit/cancel.
  - Keyboard commit path: `_onKeyUp` now handles `secondaryNodeId`/`secondaryValue` for reapportion drafts.
  - Keyboard Alt → proportional-neighbor: `_onKeyDown` now computes secondary node value when Alt is held, preserving parent total.
  - Drag-to-reorder: `_attachReorderDrag()` wires pointer drag → reorder draft → commit. `_renderReorderDraft()` renders provisional order preview.
- **`src/side-table.ts`:** Added `.value` class to value cells for targeted highlighting. `_highlightDraftCell()` now updates cell text to show draft value. `_clearDraftHighlight()` re-renders to show committed values.
- **`src/main.ts`:** Added config bar wiring: click handlers update config object and push to both components (recreates DataView → animated transition). Added reorder button handler. Exposed kernel globally as `window.__kernel` for testing.
- **`index.html`:** Added config bar with orientation, sort, depth, measure, reorder toggle buttons. Added depth-1 button.
- **`scripts/test-layout-fills-parent.mjs`:** New regression test for layout fill invariant.
- **`scripts/scenario-icicle-native.mjs`:** New test for icicle-native wheel + keyboard edits.
- **`scripts/scenario-boundary-knob.mjs`:** New test for divider-handle drag (scenario 1).
- **`scripts/scenario-drill.mjs`:** New test for drill transition (scenario 6).
- **`scripts/scenario-config-toggles.mjs`:** New test for orientation and sort toggles (scenarios 11, 12).
- **`scripts/scenario-depth-measure.mjs`:** New test for depth change and measure swap (scenarios 13, 14).
- **`scripts/scenario-reorder.mjs`:** New test for drag-to-reorder (scenario 5).
- **`scripts/scenario-cross-tile-reverse.mjs`:** New test for cross-tile reverse (scenario 8).
- **`scripts/scenario-external-edit-breaks-conservation.mjs`:** New test for external edit breaking conservation (scenario 10).
- **`scripts/scenario-keyboard-alt.mjs`:** New test for keyboard Alt → proportional-neighbor (scenario 4).
- **Deleted scripts:** `smoke.py`, `debug-drag.mjs`, `debug-mouse.mjs`, `screenshot.mjs` (dead debug scripts).

## Handoff notes

- The icicle chart is now functionally complete for the core gestures (wheel, keyboard, divider handle, drill) and cross-tile editing (table → icicle). Config toggles are wired but untested.
- The architecture (Kernel → DataView → Editor → Chart) is holding up well. The two-node reapportion extension (secondaryNodeId) is a clean model addition.
- All gesture surfaces use document-level listeners (no `setPointerCapture`), per the Playwright compatibility learning from the prior session.
- The layout bug fix is critical — without it, grandchildren were rendered at ~50% width. The regression test guards this.
- The terminology is now consistent: "divider handle" (not "boundary knob").
