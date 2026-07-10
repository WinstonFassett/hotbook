# Plan — de-React sliceboard's viz layer (collapse the React membrane)

> Handoff for an autonomous agent. **Execute in order. Do not ask questions.**
> **Prerequisite:** the charts extraction (`docs/plan-extract-vizform-charts.md`)
> must be landed first — this plan binds against the packaged `@hotbook/charts`.

## Goal

Kill the React membrane in `apps/sliceboard/src/viz/br/BrLcCharts.tsx`. Today
that file is ~650 lines bridging TWO reactive runtimes (React VDOM + bireactive
cells) + the `hudStore`. All of its accidental complexity — echo suppression,
`shapeKey` remount engineering, `gestureActive` freeze, `commitTick` nudge,
`queueMicrotask`/`onUpdateMany` flush-dodging, and two near-duplicate mega-hooks
(`useLiveFlatElement` / `useLiveHierElement`) — exists only because React
mediates a custom element that already owns its DOM + lifecycle.

**Replace it with one framework-agnostic `bindTile(el, source)` module.** React's
job shrinks to "render a `<div>`, mount the element once, push new data in." The
sync/echo/freeze logic moves OUT of React effects into plain imperative code that
a future vanilla/Svelte shell will reuse unchanged.

Charts must render and behave **identically**. This is a refactor of the *binding*,
not the charts and not the sort/data model.

## Scope guardrails (DO / DO NOT)

- **DO NOT** change chart visuals, gestures, or the edit/redistribute behavior.
- **DO NOT** move sort/group/identity out of sliceboard — `applyView`/`sortedNodes`
  in `App.tsx` stay. Charts stay dumb renderers ([sort/identity architecture]).
- **DO NOT** rewrite the whole sliceboard shell to vanilla/Svelte here. App.tsx,
  the grid layout, panels, and the `tile.kind` dispatch stay React **for now**.
  This plan only de-Reacts the chart *binding*. (Full-shell de-React is the next,
  separate plan — see "Follow-on".)
- **DO NOT** regress cross-tile hover/select sync or the gesture freeze/commit
  re-sort. Preserve exactly the behaviors the current comments describe.
- **Stash, never reset.** Work on a branch.
- Behavior parity is the acceptance bar — verify with real Playwright, not
  synthetic PointerEvents (per repo memory).

## The current membrane → where each piece goes

| Current (React) | After |
|---|---|
| `useLiveFlatElement` hook | `bindFlatTile(el, source)` — plain function, no React |
| `useLiveHierElement` hook | `bindHierTile(el, source)` — plain function, no React |
| `bindHudSync(el)` | unchanged in spirit — already framework-agnostic; move into `bindTile.ts` |
| `lastRef` echo maps, `near()` | plain closures inside `bindTile` |
| `shapeKey` strings controlling remount | a `source.shapeKey` value; `bindTile` rebuilds the element only when it changes — imperative, not a React dep |
| `gestureActive` freeze + `commitTick` state | `bindTile` listens to the element's `gesturecommit` directly and runs the commit re-sort itself — no React state bump |
| `queueMicrotask` + `onUpdateMany` batching | kept (still correct), but as plain code, not inside a React effect |
| 8 per-chart `BrLc*` components | one generic `<BrLcTile spec={…}/>` React host that just calls `bindTile` |

## Design: the `source` contract

`bindTile` is framework-agnostic. The host (React now, vanilla later) feeds it a
plain object — no hooks, no JSX:

```ts
// apps/sliceboard/src/viz/br/bindTile.ts
export interface TileSource {
  tag: string                      // 'v-br-bar' | 'v-br-icicle' | …
  shapeKey: string                 // rebuild element only when this changes
  mountProps?: (el: HTMLElement) => void   // props scene() reads on connect (orientation, maxBars…)
  // Push current display-ordered data into the element (flat datum[] or BiNode root):
  applyData: (el: HTMLElement, opts: { gestureActive: boolean }) => void
  // Wire the element's own edits OUT to the store (returns disposer):
  bindEditOut: (el: HTMLElement) => () => void
  hudStore: typeof hudStore        // for bindHudSync
}

// Mounts the element, wires hud sync + edit-out + gesturecommit, returns a
// controller. NO React. The host calls update() when its data changes and
// dispose() on unmount.
export function bindTile(container: HTMLElement, source: TileSource): {
  update: (nextSource: TileSource) => void   // re-applies data; rebuilds iff shapeKey changed
  dispose: () => void
}
```

`bindTile` internals (lifted verbatim in behavior from the two hooks):
- On first mount: `createElement(source.tag)`, set `no-source`, `mountProps`,
  initial `applyData({gestureActive:false})`, append, `bindHudSync`, `bindEditOut`,
  and `addEventListener('gesturecommit', …)` → re-run `applyData` with
  `gestureActive:false` (the single commit re-sort).
- On `update(next)`: if `next.shapeKey !== current.shapeKey` → dispose + re-mount;
  else just `applyData(el, { gestureActive: el.gestureActive })` (freeze-aware:
  values-in-place while gesturing, reorder when idle — same logic as today's
  apply-in effect).
- Echo suppression (`lastRef`/`near`) and microtask edit-out batching live inside
  `bindEditOut` / `applyData` closures.

The flat vs hier difference is entirely inside `applyData`/`bindEditOut`
(datum-array reorder vs BiNode leaf-cell writes) — provide `makeFlatSource(spec)`
and `makeHierSource(spec)` factories that build a `TileSource`, replacing the two
hooks' bodies. Reuse the existing spec fields (`build`/`readValue`/`writeValue`/
`idOf`/`reindex`/`values`/`ids`/`measureKey`).

## Steps

1. **Add `apps/sliceboard/src/viz/br/bindTile.ts`** with `bindTile`,
   `bindHudSync` (moved from BrLcCharts.tsx), `makeFlatSource`, `makeHierSource`.
   Port the exact logic from `useLiveFlatElement` / `useLiveHierElement` — same
   echo suppression, freeze, commit re-sort, batching. No React imports in this file.
2. **Add one generic React host** `BrLcTile.tsx`:
   ```tsx
   export function BrLcTile({ source }: { source: TileSource }) {
     const ref = useRef<HTMLDivElement>(null)
     const ctrl = useRef<ReturnType<typeof bindTile>>()
     useEffect(() => {
       if (!ref.current) return
       ctrl.current = bindTile(ref.current, source)
       return () => ctrl.current?.dispose()
     }, [])                                  // mount once — NOT keyed on shapeKey
     useEffect(() => { ctrl.current?.update(source) })  // push data every render; bindTile decides rebuild
     return <div ref={ref} style={{ width: '100%', height: '100%' }} />
   }
   ```
   Note: the mount effect has an EMPTY dep array — no more `shapeKey` remount
   churn in React; `bindTile.update` owns rebuild-on-shape-change.
3. **Rewrite the `BrLc*` exports** as thin wrappers that build a source and render
   `<BrLcTile>`. Keep their prop signatures identical so `App.tsx` is untouched.
   (Or, if cleaner, have `App.tsx`'s dispatch build sources directly — but keeping
   the `BrLc*` component boundary minimizes the App.tsx diff; prefer that.)
4. **Delete** from `BrLcCharts.tsx`: `useLiveFlatElement`, `useLiveHierElement`,
   the `lastRef`/`commitTick`/`gestureActive` React machinery, the `vkey`/shapeKey
   helpers that only existed to drive React deps (move any still-needed key
   computation into the `make*Source` factories). `BrLcSankey`/`BrLcSankeyFlow`
   (which use the simpler `useBrElement`) can stay as-is or also route through
   `bindTile` — keep them working, don't gold-plate.
5. **Re-evaluate `dedupe: ['react','react-dom']`** in `apps/sliceboard/vite.config.ts`:
   keep it (App is still React). Leave `bireactive` dedupe in place.

## Verify (must pass)
```bash
npx vite build apps/sliceboard
```
Then real-browser parity smoke (per repo memory — Playwright, pierce shadow DOM):
- Flat (bar) + hier (icicle): hover highlights cross-tile, wheel-edit changes a
  value, drag-resize redistributes, Esc reverts, sort-by-value reorders on commit
  (not mid-gesture). No console errors.
- Pie divider drag still edits two adjacent slices atomically (the `onUpdateMany`
  batch path).
- Parent (group) resize in icicle/treemap still redistributes proportionally to
  children without snapping.

## Done when
- `BrLcCharts.tsx` no longer contains `useLiveFlatElement`/`useLiveHierElement`,
  `shapeKey` remount keys, `commitTick`, or `gestureActive` React state.
- All sync/freeze/echo/batch logic lives in framework-agnostic `bindTile.ts`.
- The only React in the viz path is `BrLcTile`'s two trivial effects (mount-once
  + push-data). React is now a dumb host.
- sliceboard builds; behavior is identical to pre-refactor.

## Follow-on (next plan, not here)
- Replace the React app shell (App.tsx, grid layout, panels, dispatch, hudStore
  consumption) with vanilla + Svelte-when-needed. `bindTile.ts` is reused
  verbatim — that's the payoff of making it framework-agnostic now.
- Lift `applyView`/sort/group/color into `@vizform/core` so both surfaces share it.
