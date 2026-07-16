# Handoff — icicle-harness clean rewrite

**Date:** 2026-07-16
**Branch:** feat/gesture-transition-contract

## What we're doing

Building the icicle chart from specs (not from old code) in a clean new app to validate the gesture/transition architecture before scaling to all 16 chart types. No patching, no cargo-culting the old `bireactive` fork or `BiNode` tree.

## Where it lives

`apps/icicle-harness/` — standalone vite app, depends on `bireactive` (primitives only: cell/derive/effect) and `d3-hierarchy` (partition layout). No old chart infra.

## What's built

| File | What |
|---|---|
| `src/types.ts` | Domain model: DataNode, Dataset, ChartConfig, DraftEvent, RenderNode, LayoutRect |
| `src/editor.ts` | Editor (Idle/Drafting state machine); used by `DataView` |
| `src/kernel.ts` | Kernel: owns Datasets, publishes updates (pubsub), recomputes sums, broadcasts drafts cross-tile |
| `src/data-view.ts` | DataView: query-keyed subscription; owns Editor, routes Kernel events and Editor transitions to Chart, broadcasts draft/commit/cancel via Kernel |
| `src/icicle-chart.ts` | Icicle: custom element, subscribes DataView, renders D3 partition, wheel+keyboard edit surfaces, drill on dblclick |
| `src/side-table.ts` | Side table: custom element, subscribes same DataView, editable value cells via pointer drag, expand/collapse |
| `src/main.ts` | Wires Kernel + config to both components, global Esc handler, status display |
| `index.html` | Two-panel layout: icicle (left) + side table (right), dark theme |

## What's tested and passing

`scripts/smoke-cross-tile.mjs` — uses Playwright `page.mouse` (no synthetic events needed):

1. **Cross-tile drag edit:** drag rent value in table → status "drafting", icicle shows draft overlay, value updates live, siblings frozen (positions don't move during gesture), commit writes to Kernel, status back to "idle", draft overlay cleared.
2. **Esc revert:** start drag, press Esc → value reverts to committed, status "idle".

`scripts/capture.mjs` — saves screenshot + video to `captures.local/latest.png` and `captures.local/latest.webm`.

`scripts/inspect.mjs` — dumps all icicle rect positions and table rows for verification.

## Key testing learnings

- Playwright `page.mouse` fires `pointerdown`/`pointermove`/`pointerup` with `pointerId=1` — works fine.
- DON'T use `setPointerCapture` — doesn't work with Playwright's mouse. Use document-level listeners instead (already done in side-table.ts).
- Gesture doesn't start on `pointerdown` — it starts on first `pointermove`. Tests must move before checking drafting state.
- Video recording is built into Playwright (`recordVideo` option) — no extra deps.
- `*.local/` is already gitignored by global config — don't add to .gitignore.

## Esc architecture

Two layers:
1. **Per-component:** table's `onUp` checks `if (editor.state !== "Drafting") return` — no commit if already cancelled. Table re-renders on cancel to revert cell text.
2. **Global fallback** (main.ts): document Esc listener finds active editor via `kernel.drafts.activeEditor`, calls `cancel()` on the owning DataView.

## What's NOT done yet

1. **Icicle edit surfaces not wired/tested:** wheel handler exists in icicle-chart.ts but the event listener isn't attached to the SVG. Keyboard handler exists but focus management is incomplete. main.ts tries to delegate `_onWheel`/`_onKeyDown`/`_onKeyUp` but these are private methods on the chart class — needs proper public API or internal listeners.
2. **Boundary knob:** not implemented (two-sibling reapportion drag handle).
3. **Drag-to-reorder:** not implemented.
4. **Drill transition:** dblclick triggers `dataView.setDrill()` which re-windows and re-renders, but no animated transition — it snaps.
5. **Siblings-frozen invariant for icicle's own edits:** tested for table→icicle cross-tile, but not for icicle→icicle (wheel/keyboard on icicle).
6. **Config toggles:** orientation, sort, depth, measure — no UI controls, not tested.
7. **14 scenarios from handoff-icicle-impl.md:** only scenario 7 (cross-tile table→icicle) and 9 (cross-tile Esc) are tested.

## Dev server

```bash
cd apps/icicle-harness && npx vite --port 8765
```

Or it may already be running. Check with `curl -s http://localhost:8765/ | head -5`.

## Next steps (in order)

1. Wire icicle's wheel + keyboard edit surfaces properly (attach listeners inside the chart, not via main.ts delegation). Test icicle→icicle editing with siblings-frozen check.
2. Implement boundary knob (two-sibling reapportion).
3. Implement animated drill transition (viewport tween, enter/exit).
4. Add config toggle UI (orientation, sort) and test as `updated` transitions.
5. Run all 14 scenarios from the handoff doc.
6. Once icicle is complete, the architecture is proven — scale to other chart families.
