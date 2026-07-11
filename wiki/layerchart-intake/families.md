# LayerChart family analysis — hierarchical slice

Phase B output. Synthesis on top of [inventory.md](inventory.md). Updated
after discovering prior bireactive hierarchical work in
[apps/bireactive-viz/](../../apps/bireactive-viz/). The analysis below
reframes the port question against that prior art, not against a
green-field port of LayerChart.

---

## 1. Prior art (the load-bearing discovery)

The user already has a working bireactive hierarchical kit. Two files:

### 1.1 [`apps/bireactive-viz/src/kit/chart-context.ts`](../../apps/bireactive-viz/src/kit/chart-context.ts)

79 LOC. Self-documented intent:

> Minimal chart context. Mirrors the shape of LayerChart's `<Chart>`:
> reactive width/height + a "focus domain" used by Bounds to do drill-in.
> Unlike LayerCake we don't try to be a generic scale framework — for
> the hierarchical-DM kit, the only thing layouts and primitives need
> to agree on is the px viewport and the current focus rectangle in
> layout-space.

Public surface:

- `width: Writable<Num>`, `height: Writable<Num>`
- `focus: { x0, y0, x1, y1 }` — current drill-in domain in layout-space
- `full:  { x0, y0, x1, y1 }` — reset target
- `zoomTo({x0,y0,x1,y1})`, `reset()`
- `project(v, d0, d1, r0, r1)` — its own tiny scale function
- `xProject(ctx, vCell)`, `yProject(ctx, vCell)` — reactive projectors

What it deliberately omits, compared to LayerCake/ChartContext: scales,
domains, ranges, padding-as-border-box, channels (x/y/z/r/x1/y1/c),
accessors, extents, nice, reverse, percentRange. None of that is here.

### 1.2 [`apps/bireactive-viz/src/demos/treemap.ts`](../../apps/bireactive-viz/src/demos/treemap.ts)

340 LOC. A working bireactive treemap. Calls d3 directly:

```ts
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";

const h = hierarchy<Node>(root, n => n.children).sum(n => n.children ? 0 : n.total.value);
const laid = treemap<Node>().tile(treemapSquarify)
  .size([width, height])
  .paddingOuter(PAD_OUTER).paddingInner(PAD_INNER).paddingTop(PAD_TOP)
  .round(false)(h);
```

Rendering uses bireactive primitives (`rect`, `label`) directly. There
is no port of `Rect.svelte`/`Text.svelte` — those primitives already
exist in bireactive.

Direct-manipulation features built on top:

- Drag a leaf to reapportion (sum-redistribute lens preserving source order)
- Click branch to drill in; Esc pops; Shift/dbl-click drills parent
- Keyboard ↑↓ and Alt+wheel edit leaf values
- Drill-in tweens via the `focus` domain — chart-context's own zoom mechanism

### 1.3 What bireactive already provides as primitives

From [`inspo/bireactive/src/shapes/`](../../inspo/bireactive/src/shapes/):

| Bireactive primitive | Replaces LayerChart's          |
|----------------------|---------------------------------|
| `rect(x,y,w,h,opts)` | `Rect.svelte`                   |
| `circle(at, r, opts)`| (pack-leaf rendering)           |
| `annularSector(...)` | `Arc.svelte`                    |
| `label(at, text, opts)` | `Text.svelte`                |
| `curve(init, opts)`  | `Link.svelte` (Bezier paths)    |
| `group(opts, ...kids)` | `Group.svelte`                |
| (Bounds work is in `chart-context.ts:focus`/`project`) | `Bounds.svelte` |

**Every render primitive in inventory § 2 already has a bireactive
equivalent.** The whole 946-LOC "real translation cost" I was sweating
in v1 of this doc is already done.

Animation isn't `motionStore` either — it's bireactive's `Anim` system
(see `inspo/bireactive/src/animation/anim.ts`, which had a bug fix
yesterday — session `agent-ae9b153e`).

### 1.4 What this means

The port is **not** "fork LayerCake and bring all its components." The
port is **"extend the existing hierarchical kit with the remaining
layouts, following the patterns already established."** Working
treemap.ts is the canonical example to imitate.

---

## 2. Family graph (unchanged from v1)

```
                     d3-hierarchy
                          │
        ┌──────────┬──────┴──────┬──────────┐
        │          │             │          │
      Pack      Treemap      Partition    Tree
        │          │             │          │
    (Circle)    (Rect)       (Rect|Arc)   (Curve + node shape)
                                 │
                  ┌──────────────┴──────────────┐
                  │                             │
              Icicle pattern              Sunburst pattern
              (vertical + Rect)           (horizontal + Arc)
```

- Four layouts are siblings over d3-hierarchy. Treemap is already done.
  Pack/Partition/Tree are the remaining ports.
- Sunburst/Icicle are not separate ports — they are usage patterns over
  Partition (inventory § 5).
- Tree alone yields `links`; everything else is `nodes` only.

---

## 3. Shell-port question — resolved by prior art

The plan reserved this for an explicit user decision (steps 4-5 of plan
Part 9). The prior art has already answered it, deliberately, with the
comment in `chart-context.ts:5-7`:

> Unlike LayerCake we don't try to be a generic scale framework

The decision is **Option D — extend the existing minimal kit**:

- No LayerCake fork. No scale framework. No channel system.
- `chart-context.ts` is the shell. It carries `width`/`height`/`focus`
  and the `project` projector. New layouts that need new shell concerns
  extend it (e.g. Tree may want a `radial` projection helper for
  Sunburst; add `radialProject` then).
- d3-hierarchy is consumed directly inside each layout's demo/recipe,
  matching treemap.ts.
- Bireactive primitives (`rect`, `circle`, `annularSector`, `label`,
  `curve`, `group`) are the render layer. No primitive ports.
- Animation is bireactive's `Anim` system, not `motionStore`.
- Tooltip is whatever bireactive's interaction primitives provide
  (`interaction.ts`); no `TooltipContext` port.
- Drill-in / zoom is the existing `focus` domain mechanism in
  chart-context. Not `TransformContext`.

This collapses all three of my earlier Options (A/B/C) into "match the
shape the user already validated."

---

## 4. What the prior art does **not** yet have (the actual port targets)

### 4.1 Pack layout (new)

Following the treemap.ts pattern: a `MdPack extends Diagram` demo (or a
graduate-to-kit `pack()` function) that calls
`d3.hierarchy(...).sum(...)` then `d3pack().size([w,h]).padding(p)(h)`,
then renders via bireactive `circle(at, r, opts)`. Drill-in via
`ctx.zoomTo(node)`.

### 4.2 Partition layout (new)

Same shape as treemap.ts. Calls `d3partition().size([w,h]).padding(p)(h)`.
Renders via bireactive `rect(...)` for Icicle, or `annularSector(...)`
for Sunburst. The Sunburst case needs polar projection — likely add a
`radialProject` helper to chart-context.

### 4.3 Tree layout (new)

Calls `d3tree().size(...).nodeSize(...).separation(...)(h)`. Renders
both nodes (as `circle` or `rect` depending on style) and links (as
`curve` segments — bireactive's `curve` already handles bezier).

### 4.4 Extensions to chart-context (incremental)

Today: `width`, `height`, `focus`, `project`. Likely additions as the
new layouts land:

- `radialProject` (Sunburst) — maps (angle, radius) to (x, y).
- Per-orientation projection helpers (Partition vertical vs horizontal,
  Tree orientation swap) — may be inlined per-layout rather than added
  to the shared context.

No additions to the shell that the slice doesn't earn.

---

## 5. What we **carry over** from LayerChart inventory

Inventory entries serve as **defaults reference** — when porting Pack,
read inventory § 1.1 to confirm LayerChart's `Pack.svelte` only uses
`size` and `padding`; that's the prop surface to match. Same for the
others. Inventory is the spec for "what props/defaults are reasonable,"
not for "what code to translate."

Specifically carry over per layout:

- **Pack** (inventory § 1.1): `size`, `padding`. Output `descendants()`.
- **Treemap** (already ported): `size`, `tile` (with name-resolution
  table from `Treemap.svelte:38-51`), `padding`/`paddingInner`/
  `paddingOuter`/`paddingTop`/`paddingBottom`/`paddingLeft`/
  `paddingRight`. The existing treemap.ts uses a subset
  (`paddingOuter`/`paddingInner`/`paddingTop`); future revisions can
  match LayerChart's fuller surface if needed.
- **Partition** (inventory § 1.3): `size`, `orientation`, `padding`,
  `round`. The orientation swap behavior is the load-bearing detail
  for Sunburst-vs-Icicle.
- **Tree** (inventory § 1.4): `size`, `orientation`, `nodeSize`,
  `separation`. Only layout that emits `links`.

Compositions:

- **Sunburst** (inventory § 5.1): Partition (horizontal) +
  `annularSector` per node.
- **Icicle** (inventory § 5.2): Partition (vertical) + `rect` per node.
- **Zoomable treemap** (treemap.ts demonstrates): `aspectTile` for
  zoom-stable layout. Inventory § 4.2 + `Treemap.svelte` reference.

Utilities to port if a recipe needs them:

- `aspectTile(tile, w, h)` (inventory § 4.2) — needed for zoomable
  treemap. May already be implicit in treemap.ts's drill-in approach;
  check.
- `findAncestor(node, filter)` (inventory § 4.1) — useful for "highlight
  ancestry path" interactions.
- `isNodeVisible(a, b)` (inventory § 4.2) — useful for zoomable treemap
  child-visibility filtering.

---

## 6. What we **don't** carry over (and why)

- **LayerCake** (610 LOC) — chart-context.ts explicitly rejects the
  scale-framework framing. Out.
- **Chart shell defaults** (`xDomainSort=false`, `xBaseline`, etc.) —
  these were Cartesian-layer concerns. Out for hierarchical slice.
- **Channels** (x/y/z/r/x1/y1/c) — accessor-and-scale system. Out for
  hierarchical slice (data goes straight to d3-hierarchy). User
  mentioned wanting to go past hierarchical eventually; channels
  would be a Cartesian-slice question then, not now.
- **`motionStore`** — bireactive's `Anim` is the equivalent.
- **`TooltipContext`** — bireactive's interaction primitives cover this.
- **`TransformContext`** — `focus` domain in chart-context already
  covers the hierarchical drill-in case (the only transform interaction
  the slice needs).
- **`GeoContext`, `BrushContext`** — not hierarchical.
- **Render-context switching (SVG/Canvas/HTML)** — bireactive's
  primitives already pick an output (SVG, per `inspo/bireactive/src/shapes/shape.ts`).
  No dual-target branching needed.

---

## 7. Open questions (for build phase, not blocking spec)

1. **`aspectTile` parity** — does treemap.ts's drill-in approach
   already give us zoom-stable behavior, or do we still want
   `aspectTile` wrapping? Check by inspecting how the existing
   demo behaves at deep drill levels.
2. **Sunburst polar projection** — add `radialProject` to
   chart-context, or inline per-recipe? Lean: add to context if
   Tree (radial tree) also wants it.
3. **Tree node rendering** — circles, rounded rects, or pluggable?
   LayerChart leaves this to the caller (the `<Tree>` slot exposes
   nodes; the caller writes the inner loop). We can mirror that:
   `tree()` returns `{ nodes, links }` and the recipe renders them.
4. **DM gestures per layout** — treemap.ts has drag-to-reapportion,
   click-to-drill, kb/wheel value editing. Which of those generalize
   to Pack/Partition/Tree, and which are treemap-specific? Defer to
   build session; each demo can experiment.

---

## 8. Summary

Prior art is the spec. We are **extending [`apps/bireactive-viz/`](../../apps/bireactive-viz/)**,
not porting LayerChart wholesale. The remaining work is three layout
recipes (Pack, Partition, Tree), two composition recipes (Sunburst,
Icicle as Partition variants), and incremental chart-context additions
when a new layout earns them.
