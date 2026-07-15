# In-view transitions: approach decision

**Ticket:** WIN-42 / "In-view transitions: value change tween and reorder stagger across flat and hierarchical charts" — Part 1.

## Decision

**Use CSS transitions on the rendered SVG element.** Reach for a bireactive tween cell only for the narrow set of effects CSS cannot express (stagger, multi-property choreography, easing on non-CSS-animatable values).

Timing tokens, easing, the reduced-motion check, and the gesture-suppression class all live in one place: `packages/fiddleviz-charts/src/lib/transitions.ts`. Per Interaction Principle 10, every duration is a multiplier of `TRANSITION_BASE_MS` (100ms) — there is no hardcoded ms scattered through gesture handlers.

## Spike summary

### Option A — CSS transitions on SVG attributes

```ts
tile.el.style.transition = settleTransition(["y", "height", "fill"]);
```

Bireactive already drives SVG attributes as cells. When a value cell updates, the rendered `<rect>` `y`/`height` attribute changes — and modern browsers (Chrome 79+, Firefox 75+, Safari 16+) animate the SVG geometry attributes `x` / `y` / `width` / `height` / `rx` / `ry` / `cx` / `cy` / `r` as CSS properties. Path-`d` interpolation also works in Chrome and Safari.

**Pros:**
- Zero per-frame cost. The browser owns the timeline.
- No extra cells, no `requestAnimationFrame` plumbing, no teardown.
- Composes trivially with bireactive's reactive write model — the cell graph stays synchronous; only the visual settle is async.
- Already in use 4 places in the spike (`hlRect`, `valueEl` on concentric-arc, sankey grips, bar drag handle opacity) — the pattern is proven and idiomatic for this codebase.
- Interruptible by construction: a second CSS transition on the same property starts from the current computed value (Interaction Principle 11).
- `prefers-reduced-motion` collapses to `transition: none` in one place (the helper) — Principle 9 falls out for free.

**Cons:**
- Not all CSS engines tween every SVG attribute uniformly (path-`d` is the main gap — Firefox falls back to a step). Not a problem for the flat-chart bar/area/pie/radar value-change work in Parts 2-4.
- Stagger requires `transition-delay` per element — works, but you write the delay yourself rather than choreographing a single timeline.

### Option B — Bireactive tween cell

The bireactive package surface (`bireactive` 0.3.4) exposes `cell`, `derive`, `effect`, `batch` — no `@bireactive/animation`, no built-in tween primitive. A tween cell would have to be hand-rolled: a cell that on assignment starts a `requestAnimationFrame` loop interpolating from `current` to `target` over duration, writing intermediate values back into itself. Each chart element would derive its drawn value from the tween cell instead of the raw value cell.

**Pros:**
- Full programmatic control of the easing curve, mid-flight redirection, per-element timeline.
- Works for non-CSS-animatable values (e.g. a number you read inside `derive` to compute a path).
- A central tween cell can drive stagger by phase-offsetting per index without each element knowing its delay.

**Cons:**
- Significant net-new infrastructure (tween cell, scheduler, teardown, interruption semantics, reduced-motion plumbing) when the platform already gives you most of it for free.
- Doubles the cell graph for every animated property — one raw cell, one tween cell — which interacts subtly with the reactive flush in embeddings (fiddleviz). The existing `applyDelta` batching is carefully tuned to fire ONE flush per gesture step; tween cells would fire ~16 flushes/sec for the duration of every settle.
- Mid-gesture interruption (Principle 11) requires explicit "read current animated value, restart from there" handling at every call site. CSS transitions do this automatically.

### Why CSS wins for this codebase

The deciding factor is the synchronous reactive model. Bireactive's whole point is "value changes → render flushes instantly." CSS transitions slot in cleanly: the *value flush is still instant*, the *visual settle is the browser's job*, the two stay independent. Tween cells would re-introduce the "value updates over time" model that bireactive explicitly avoids.

Stagger (Part 3) is the only case where the CSS approach gets a little manual — `transition-delay: ${i * 30}ms` per item. That's worth the trade vs. owning a whole tween-cell layer.

## Gesture suppression contract

Cursor feedback is instant (Interaction Principle 3 / 4). Transitions only fire for *autonomous* settles — value changes outside an active gesture, reorder commits, drill morphs.

The chart host toggles a single class while a gesture is live:

```ts
const setGestureActive = (on: boolean) => this.classList.toggle(GESTURE_ACTIVE_CLASS, on);
```

The class is set in the `snapshot` callback of every `wheelController` / `dragController` config, cleared in `onEnd`. The chart's `static styles` includes:

```css
.vf-gesture-active * { transition: none !important; }
```

So during a drag or ctrl+wheel every descendant temporarily has no transition — the bar height *snaps* to the gesture's live value. On release, `onEnd` clears the class and the *next* autonomous mutation animates.

**Esc revert snaps for free.** The controller's cancel path runs `restore()` *before* `end()` — restore mutates the value while the class is still set, then end clears it. The user sees an instant snap-back, never a tween over the revert (Part 1's "Esc revert must snap instantly" constraint).

## What landed in this PR

- `packages/fiddleviz-charts/src/lib/transitions.ts` — timing tokens, easing, `settleTransition()` / `hoverTransition()`, `prefersReducedMotion()`, `GESTURE_ACTIVE_CLASS`, `GESTURE_SUPPRESSION_CSS`.
- `packages/fiddleviz-charts/src/demos/bar-chart.ts` — gesture-suppression CSS in `static styles`; `setGestureActive` wired into both wheel and drag configs (both orientations); settle transition on bar rect `y` / `height` / `fill` (vertical) and `width` / `fill` (horizontal); existing inline `opacity 0.1s` routed through `hoverTransition()`.
- This decision doc.

## What's NOT in this PR (split as sub-issues)

- **Part 3 — reorder stagger on bar chart.** Reorder needs a data-keyed render (each bar tracks its datum's identity across sorts) rather than the current slot-keyed render (`(data.value as Bar[])[idx]`), because position transitions only make sense when the *same DOM element* moves to a new x. With slot-keyed rendering each slot's value just changes — which animates cleanly through the height transition we just shipped, but doesn't *slide* items horizontally. Documented in the sub-issue.
- **Part 4 — apply the pattern to line / area / pie / radar / concentric-arc.** Now that the helper module exists, each chart needs ~6 lines (import, `static styles` += `GESTURE_SUPPRESSION_CSS`, `setGestureActive` hook in the controller configs, settle transition on the shape's animatable attributes).
- **Part 5 — drill transition placeholder (coordinated with feat/drilling).**

Sub-issues are created under WIN-42 with `--stage` set so the parent wakes per stage.
