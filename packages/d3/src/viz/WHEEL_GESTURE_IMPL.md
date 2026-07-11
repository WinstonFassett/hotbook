# Gen-1 VizRenderer wheel-edit cancel — implementation notes

Scope: `packages/hotbook-d3/src/viz/VizRenderer.ts`. Brings the gen-1
flat charts (bands / radial / treemap) up to the same Ctrl+wheel-edit +
Ctrl+Esc-revert contract the spike's 7 BR-LC charts already have.

## What the feature is

Ctrl+wheel over a goal atom edits its value. Hold Ctrl across multiple ticks =
one gesture, all editing the SAME goal (locked at the first tick). Release Ctrl
(or window blur) = **commit**, keep the edits. **Ctrl+Esc while Ctrl is still
held = cancel**, revert the goal to the value it had before the gesture began.

Mirrors Blender's held-button scrub: modifier held = gesture; first tick locks
and snapshots one target; release = commit; Esc = cancel→revert; no mid-hold
target switch.

## Why the chosen approach (reuse, not lift, not inline-fresh)

VizRenderer is a **publishable package**. It already owns a gesture-scoped,
capture-phase Esc-cancel primitive used by the pointer-drag paths:

- `_startResizeDrag(atoms, onCancel)` — installs a capture-phase `keydown`
  handler on `document`; Esc → `_cancelResizeDrag()`. Also freezes sort order
  via `dragOrderSnapshot`.
- `_endResizeDrag()` — removes that handler, clears snapshot/cancelCallback.
- `_cancelResizeDrag()` — runs `_endResizeDrag()` then the `onCancel` revert.

The spike's `makeWheelGesture<T>` is the same shape but lives in the app. So:

- **Lifting** `makeWheelGesture` into the package = a second redundant primitive
  when the package already has one.
- **Importing** from the spike = backwards (package can't depend on the app).
- **Inlining a fresh** copy = the scatter-the-pattern anti-pattern, a third time.

→ **Reuse `_startResizeDrag`/`_endResizeDrag`.** The wheel path just wasn't
wired through them before. The only piece they don't provide is the *commit*
trigger (pointer drags commit on d3's `end` event; wheel has no natural end), so
the wheel gesture adds its own Ctrl-up/blur release listener.

## The two original gaps (both now closed)

1. **Modifier was `metaKey || ctrlKey`** (line ~136) → now **`ctrlKey` only**.
   Reason (empirical, from the prior session's browser traces): mid-wheel on
   macOS, **Cmd+Esc never reaches the page**, so a Cmd gesture is uncancellable;
   **Ctrl+Esc does** reach it. Ctrl+wheel does not trigger browser zoom here.
2. **Wheel had no Esc-cancel at all** — it committed every tick straight to
   `onUpdate` and never armed the Esc handler. Now it's a real gesture.

## How it works now (control flow)

State added to the class:

```ts
private wheelDrag: { goalId: string; snapshotValue: number; unit: string } | null = null
private wheelReleaseTeardown: (() => void) | null = null
```

- **`_setupWheelHandler` (wheel listener)**
  - `unitKind === 'order'` → ignore (no resize in order mode).
  - **not `ctrlKey`** → if a gesture is live, `_commitWheelDrag()` (Ctrl was let
    go between ticks without a keyup we saw) then return; else return.
  - hit-test `document.elementFromPoint` → `g.goal-atom`, skip phantom, read
    `data-id`. `preventDefault` + `stopPropagation`.
  - if no live gesture → `_beginWheelDrag(id)`. Then **stay locked** to
    `wheelDrag.goalId` even if the cursor drifts to a sibling.
  - compute step (`shift` = 5 else 1) × dir, clamp `≥1`, `onUpdate`.

- **`_beginWheelDrag(id)`**
  - snapshot `snapshotValue` = the goal's current value; store `goalId` + `unit`
    (unit fixed at begin).
  - `_startResizeDrag(atoms, () => this._restoreWheelSnapshot())` — arms
    Ctrl+Esc revert and freezes sort order. `atoms` come from `prevAtoms`.
  - install **capture-phase** `keyup` (Control/Meta → `_commitWheelDrag`) and
    `blur` (→ commit) on `window`; remember teardown in `wheelReleaseTeardown`.

- **Ctrl+Esc** → `_startResizeDrag`'s handler → `_cancelResizeDrag()` →
  `_endResizeDrag()` (removes Esc handler) → `revert()` = `_restoreWheelSnapshot()`
  → `onUpdate(goalId, snapshotValue)`, clear release listeners, null `wheelDrag`.

- **Ctrl release / blur** → `_commitWheelDrag()` → null `wheelDrag`, clear
  release listeners, `_endResizeDrag()`. Edits kept.

- **`destroy()`** mid-gesture → clears release listeners + `_endResizeDrag()` so
  nothing leaks.

## The rules this preserves (from the prior session — these are facts)

1. Modifier MUST be Ctrl, not Cmd (Cmd+Esc doesn't reach the page mid-wheel).
2. Ctrl+wheel does not zoom the page on this setup.
3. Esc / release listeners on `window`/`document` (capture phase) — the chart
   element isn't focused during ctrl+wheel, so per-element keydown never fires.
4. Listeners are gesture-scoped: armed at begin, removed at commit/cancel. No
   global handler while idle, so idle Esc still falls through to selection-clear.
5. snapshot/restore is per-shape; here gen-1 flat = one goal's measurement value.
6. One hold edits exactly one goal — locked at first tick, stays locked.
7. Idle Esc falls through; cancel only preventDefault/stopPropagation when it
   actually reverted (handled inside `_startResizeDrag`'s handler).

## What to shred / verify (NOT yet live-verified)

- **Verification is the one thing not done.** Per the prior session: drive a
  REAL Ctrl+wheel-then-Ctrl+Esc-while-held over a bands/radial/treemap atom in
  sliceboard and read the value back. Synthetic WheelEvents are unreliable on
  these elements. Do not assert it works until traced.
- Does `_cancelResizeDrag` nulling `radialResizeDrag`/`bandsResizeDrag` and
  resetting body styles cause any surprise during a wheel gesture? (Believed
  harmless — they're already null, styles weren't set — but confirm.)
- The "Ctrl let go between ticks" commit branch: is there a case where a
  non-Ctrl wheel tick should NOT commit (e.g. a stray wheel after commit)?
  Currently any non-Ctrl wheel with a live gesture commits — intended.
- treemap has no pointer-resize-drag path; confirm Ctrl+wheel on treemap atoms
  still hits a `g.goal-atom[data-id]` and edits correctly.
