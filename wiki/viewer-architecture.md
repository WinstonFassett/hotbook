# hotbook Viewer Architecture — diagram / viewer / container

Status: **design** (no full implementation yet). The pure-function sankey
(`apps/demos/src/lib/sankey-layout.ts` +
`lib/sankey.ts`) is the first chart built on the geometry half of this model and
is the reference for the rest.

This doc is the *architecture* that realizes the interaction rules in
[interaction-principles.md](./interaction-principles.md). It does not restate the
rules; it names the objects and contracts that make Rules 2, 6, 7, 15, 16
fall out by construction instead of being patched in per chart.

---

## The core mistake we keep making

Coupling **"the data changed"** to **"everything re-lays-out / re-fits / re-scales."**

Every rubbery-feel bug traces to one object doing two jobs at once: a chart that
*sizes its own geometry to fit its container* will reflow the whole picture the
instant any value changes. d3-sankey is the worst offender (it's a solver that
re-runs on every edit), but auto-fit-to-height in any chart does the same thing.

The fix is not "freeze during the gesture" (that treats the symptom). The fix is
to **separate the three things that were tangled together** so they can't affect
each other:

1. **Diagram** — produces geometry in its own coordinate space at a *constant*
   ruler. Grows/shrinks honestly. Knows nothing about pixels or containers.
2. **Viewer** — a viewport over the diagram's data-space. Owns pan/zoom/viewBox,
   fitting, legibility thresholds. Maps data-space ⇄ its pixel box.
3. **Container** — the pixel box itself (a hotbook tile, or an auto-height
   region in the spike) and its resize gesture.

None of these recomputes another's work. The only couplings are two explicit,
one-directional contracts (below).

---

## Object 1 — Diagram (data-space geometry)

- Geometry is a **pure function of the editable values** at a **constant
  px-per-unit ruler**. No fit-to-container in the hot path. (Rule 2 by
  construction — the ruler literally cannot change mid-gesture because nothing
  recomputes it.)
- The diagram **grows and shrinks in its own space** as values change. That is
  correct and honest; a bigger total *is* a bigger picture.
- Every pixel⇄value conversion the diagram does (drag→value, wheel step,
  grip placement) uses the **same constant ruler**, so all manipulation happens
  at the scale the geometry was drawn at. (User ask, this session.)

### Contract OUT: the diagram announces its bounds
The diagram emits its current data-space bounding box (and, ideally, named
anchors: `itemId → bounds-in-data-space`). This is an **output it publishes, not
something it acts on.** It never reads the container to decide its own size.

```
SankeyLayout {
  nodes, links,
  pxPerUnit,        // the constant ruler
  bounds: {x,y,w,h} // ← the OUT contract
}
```

Today `sankey-layout.ts` emits `bounds`. Named anchors (`item → bounds`) are the
natural next addition, needed for `viewer.show(ids)`.

---

## Object 2 — Viewer (a viewport over data-space)

The **missing object**. Owns the mapping from data-space to its pixel box, and
all presentation policy. This is where pan/zoom/fit/legibility live. LayerChart
has no managed viewport-with-`show`; this is ours to own.

### Contract IN: the diagram (or app) commands the viewer
An interactive viz should be able to call *up* into its viewer with data-space
targets — the pan/zoom analogue of `element.scrollIntoView()`:

```
viewer.show(idsOrBounds, { zoomToContain?, panToContain?, animate? })
```

The viz says "bring *this* into view" in its own coordinates; the viewer decides
the viewBox/transform and animates it (settle rhythm, Rule 10; interruptible,
Rule 11). The viz never manipulates the viewBox directly.

### Viewer responsibilities
- **Fit** the announced bounds into its pixel box — a **viewBox transform, never a
  geometry recompute** (Rule 16, zoom-to-fit on commit). `preserveAspectRatio`
  keeps it uniform and centered.
- **Pan / zoom** — optional, enableable per tile. A viewer capability, not a per-
  chart reimplementation.
- **Legibility / em-equivalent zoom** — the viewer knows the current data→px
  scale, so "is this label ≥ N px right now" is a *viewer query*. Below
  threshold → hide/swap labels. (User ask, this session.)
- **Label layer** — labels are placed in data-space but should render at
  **screen-constant size** (counter-scaled by current zoom) so they stay legible
  and don't overlap regardless of zoom. This implies labels live in a **separate
  layer** the viewer counter-transforms, distinct from the geometry layer that
  scales with the viewBox. (Rule 12 still holds: a label belongs to its mark and
  tracks it — counter-scaling is about *size*, not detachment.)

### Current partial implementation
`fitHostToBounds()` in `lib/sankey.ts` is a minimal viewer: a reactive effect
that writes the SVG viewBox from `layout.bounds`. That is the fit responsibility
only. The full Viewer (show/pan/zoom/legibility/label-layer) is unbuilt.

---

## Object 3 — Container (the pixel box) and resize

The tile owns its pixel dimensions and the resize gesture. Resizing changes the
**viewer's box**, which refits (a transform). But resize has the same two-phase
structure as a value edit, and the **two aspects of a resize differ**:

- **Dimensions / scale change** → pure viewBox change → cheap → do it **live**
  during the resize gesture (scale-in-place).
- **Aspect-ratio change** → *can* change layout (a sankey may re-column for a
  tall-vs-wide box; a treemap re-tiles). This is a **relayout**, which must NOT
  run mid-gesture (Rule 2/15).

So: **during a resize gesture, scale-in-place via viewBox only; on resize-end,
decide whether to relayout for the new aspect ratio.** Same defer-until-commit
rule as value edits — now applied to the resize gesture.

---

## The meta-ruleset (what ties it together)

> **Every gesture has a *live* phase and a *commit* phase.**
> During **live**, only cheap transforms run (viewBox, in-place scale, value
> preview) — never anything that triggers a layout cascade (refit, relayout,
> reorder, rescale).
> On **commit** (release, not cancel), the expensive settle runs **once**.
> **Cancel** (Esc) reverts to the exact pre-gesture state.

This already exists for **value edits** as Rules 2/6/7/15/16. The architecture
generalizes it to **resize** (Object 3) and makes it structural rather than
per-chart: with a constant-ruler diagram + a viewer that only transforms, the
live phase *can't* cascade because there's nothing in the live path that
recomputes layout.

| Gesture        | Live phase (cheap)              | Commit phase (settle once)             | Cancel        |
|----------------|---------------------------------|----------------------------------------|---------------|
| Edit a value   | preview value, geometry grows   | reorder (R7), zoom-to-fit (R16)        | revert (R6)   |
| Resize a tile  | viewBox scale-in-place          | relayout if aspect ratio demands it    | restore box   |
| Pan / zoom     | viewBox transform               | (none — continuous)                    | —             |

---

## Open questions / not yet decided

- **Viewer as a bireactive primitive?** If the Viewer is a bireactive
  `Diagram`-level construct, hotbook tiles could host bireactive viewers
  **natively** rather than through React wrappers — which lines up with the
  standing "replace React with Svelte in hotbook" direction
  ([[feedback_prefer_svelte_over_react]]). Worth a real evaluation as its own
  step; not assumed here.
- **Shared tile↔viz lens.** The data-space ⇄ tile-px mapping could be a single
  shared lens (forward = viewBox/fit; backward = pointer-unproject for grips),
  so charts stop hand-rolling `toSVG(e)`. A lens earns its keep here because the
  mapping is bidirectional and reactive against zoom; with a *constant* ruler the
  scalar value⇄px part is just multiplication and doesn't need a lens. Build the
  lens if/when zoom makes the mapping dynamic.
- **Named anchors** (`itemId → bounds`) on the diagram OUT contract, required for
  `viewer.show(ids)`.
- **Min-legibility policy** — exact thresholds and label hide/swap behavior.

---

## Sequencing

1. **Done / in flight:** pure-function sankey (constant ruler + `bounds` out +
   reactive viewBox fit). Proves the geometry+fit decoupling on one chart.
2. **Next:** extract the **Viewer** primitive (fit + `show()` + optional pan/zoom
   + legibility + label layer), with the sankey as its first real consumer.
3. **Then:** the resize live/commit phasing (Object 3) and retrofit other charts.
4. **Evaluate:** bireactive-native viewers in hotbook vs. React wrappers.
