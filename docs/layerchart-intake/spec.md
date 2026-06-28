# Headless hierarchical port — spec

Phase C output. Build-session contract. Cites [inventory.md](inventory.md)
for LayerChart source detail and [families.md](families.md) for rationale.
Does not restate them.

**Shell stance**: extend the existing bireactive hierarchical kit at
[`apps/bireactive-viz/`](../../apps/bireactive-viz/). No LayerCake fork,
no primitive ports — bireactive already provides those. The spec is
"three new layout recipes following the established pattern."

Build sessions read **spec.md + inventory.md + [`apps/bireactive-viz/src/demos/treemap.ts`](../../apps/bireactive-viz/src/demos/treemap.ts)**
(the canonical example). They do **not** re-read LayerChart source.

---

## 1. Where things live

```
apps/bireactive-viz/src/
  kit/
    chart-context.ts            (existing — extend per § 5 when needed)
  demos/
    treemap.ts                  (existing — canonical pattern)
    pack.ts                     (new — § 2)
    partition.ts                (new — § 3, both Icicle + Sunburst recipes)
    tree.ts                     (new — § 4)
```

Each new demo is a `class MdX extends Diagram` (matching `MdTreemap` in
treemap.ts) that:

1. Builds a `Node` tree of writable cells (per-demo data shape).
2. Creates a `chartContext(W, H)`.
3. Runs d3-hierarchy + the relevant d3 layout inside a `derive(() => …)`
   so the layout recomputes when inputs change.
4. Renders via bireactive primitives, projecting layout coords through
   `ctx.focus` so drill-in zooms in/out.
5. Wires DM gestures appropriate to the layout (per § 6).

Graduation to `kit/` happens when a recipe stabilises across two or
more demos — not in this spec.

---

## 2. Pack (`apps/bireactive-viz/src/demos/pack.ts`)

### 2.1 Source-of-truth references

- LayerChart shape: [inventory § 1.1](inventory.md#11-pack)
  — `d3Pack().size(size ?? [w,h]).padding(p?)`
- Pattern to follow: `treemap.ts` end-to-end.
- Bireactive primitive for leaves: `circle(at, r, opts)`
  ([shapes/circle.ts:70](../../inspo/bireactive/src/shapes/circle.ts)).

### 2.2 Layout call

```ts
import { hierarchy, pack as d3pack } from "d3-hierarchy";

const root = hierarchy<Node>(data, n => n.children).sum(n => n.children ? 0 : n.value.value);
const laid = d3pack<Node>().size([W, H]).padding(PAD)(root);
```

Each laid node carries `x`, `y`, `r`, `depth`, `parent`, `children`,
`data`.

### 2.3 Render

For each descendant, project center through `ctx.focus`:

```ts
const cx = derive(() => TX + project(node.x, ctx.focus.x0.value, ctx.focus.x1.value, 0, TW));
const cy = derive(() => TY + project(node.y, ctx.focus.y0.value, ctx.focus.y1.value, 0, TH));
const r  = derive(() => {
  const sx = TW / (ctx.focus.x1.value - ctx.focus.x0.value);
  return node.r * sx;
});
s(circle(Vec.derive(() => ({ x: cx.value, y: cy.value })), r, { fill, stroke, opacity }));
```

Note: `r` scales with `sx` only (Pack circles are isotropic; sx/sy
should be equal anyway since Pack uses square layout). If sx≠sy in
focus zoom, accept the visual ambiguity or constrain focus to
preserve aspect.

### 2.4 DM gestures (treemap.ts parity where applicable)

- **Click branch → drill in**: `drillTo({ x0: cx-r, y0: cy-r, x1: cx+r, y1: cy+r })`.
- **Esc / pop stack**: same as treemap.ts.
- **Drag leaf to resize value**: same sum-redistribute lens shape as
  treemap.ts. Visual feedback differs (radius vs rect dimension); the
  lens math is identical.

### 2.5 Defaults

Per inventory § 1.1: `padding` defaults to `undefined` (d3's default
is 1). `size` defaults to viewport. No other config.

---

## 3. Partition (`apps/bireactive-viz/src/demos/partition.ts`)

One demo file, two recipes (Sunburst and Icicle). Reason: they share
the layout call; only the render differs.

### 3.1 Source-of-truth references

- LayerChart: [inventory § 1.3](inventory.md#13-partition)
- Sunburst recipe: [inventory § 5.1](inventory.md#51-sunburst)
- Icicle recipe: [inventory § 5.2](inventory.md#52-icicle)
- Bireactive primitives: `rect`, `annularSector`
  ([shapes/annular-sector.ts:87](../../inspo/bireactive/src/shapes/annular-sector.ts)).

### 3.2 Layout call

```ts
import { hierarchy, partition as d3partition } from "d3-hierarchy";

const root = hierarchy<Node>(data, n => n.children).sum(n => n.children ? 0 : n.value.value);

// Icicle (vertical): size as [width, height], natural axes
const icicle = d3partition<Node>().size([W, H]).padding(P).round(R)(root);

// Sunburst (horizontal): size as [height, width], coords mean (angle, radius)
const sunburst = d3partition<Node>().size([H, W]).padding(P).round(R)(root);
//                                    ↑ swap per inventory § 1.3 / Partition.svelte:27-29
```

The horizontal/vertical swap matches `Partition.svelte:27`. Caller
chooses orientation by recipe; no need for a runtime `orientation`
prop unless we want both in one demo.

### 3.3 Icicle render

For each descendant, project rect through `ctx.focus` (same shape as
treemap.ts):

```ts
const x  = derive(() => TX + project(node.x0, ctx.focus.x0.value, ctx.focus.x1.value, 0, TW));
const y  = derive(() => TY + project(node.y0, ctx.focus.y0.value, ctx.focus.y1.value, 0, TH));
const x1 = derive(() => TX + project(node.x1, ctx.focus.x0.value, ctx.focus.x1.value, 0, TW));
const y1 = derive(() => TY + project(node.y1, ctx.focus.y0.value, ctx.focus.y1.value, 0, TH));
s(rect(x, y, derive(() => x1.value - x.value), derive(() => y1.value - y.value), { fill, stroke }));
```

### 3.4 Sunburst render

Sunburst maps `x0..x1` to angle and `y0..y1` to radius. This is the
case that may want chart-context to grow a polar projector — see
[families.md § 7 q2](families.md#7-open-questions-for-build-phase-not-blocking-spec).

For now, inline the polar mapping in the recipe:

```ts
const cx = W / 2, cy = H / 2;
for (const node of descendants) {
  const startAngle = derive(() => /* node.x0 → radians via focus */);
  const endAngle   = derive(() => /* node.x1 → radians via focus */);
  const innerR     = derive(() => /* node.y0 → px via focus */);
  const outerR     = derive(() => /* node.y1 → px via focus */);
  s(annularSector({ cx, cy, innerR, outerR, startAngle, endAngle }, { fill, stroke }));
}
```

Exact `annularSector` signature: confirm against
[`shapes/annular-sector.ts:87`](../../inspo/bireactive/src/shapes/annular-sector.ts)
during build session — the signature shape above is illustrative.

### 3.5 DM gestures

- **Click branch → drill in**: zoom focus to that node's `(x0,y0,x1,y1)`.
- **Esc pops**.
- **Drag leaf to resize**: same lens pattern.

For Sunburst, drill-in tweens the polar focus — visually a rotation +
radius animation. Acceptable to ship as a snap first; spring later
(matching treemap.ts's "R16: snap for now; spring next iteration"
comment at treemap.ts:135).

### 3.6 Defaults

- `padding`: `undefined` (d3 default 0).
- `round`: `undefined` (d3 default false).
- `orientation`: per recipe.

---

## 4. Tree (`apps/bireactive-viz/src/demos/tree.ts`)

### 4.1 Source-of-truth references

- LayerChart: [inventory § 1.4](inventory.md#14-tree)
- Bireactive primitives: `circle` or `rect` for nodes; `curve` for
  links ([shapes/curve.ts:322](../../inspo/bireactive/src/shapes/curve.ts)).

### 4.2 Layout call

```ts
import { hierarchy, tree as d3tree } from "d3-hierarchy";

const root = hierarchy<Node>(data, n => n.children);  // no .sum() — tree doesn't need values

const laid = d3tree<Node>()
  .size(orientation === "horizontal" ? [H, W] : [W, H])   // swap per inventory § 1.4
  .nodeSize(nodeSize)
  .separation(separation)(root);

const nodes = laid.descendants();
const links = laid.links();
```

### 4.3 Render

Two passes: links first (so nodes paint over link endpoints), then nodes.

```ts
// Links — d3-shape's linkHorizontal/linkVertical produces a cubic Bezier path
// string; bireactive can render via curve or pathD.
import { linkHorizontal, linkVertical } from "d3-shape";
const linkPath = orientation === "horizontal" ? linkHorizontal() : linkVertical();
for (const link of links) {
  const d = derive(() => linkPath({ source: [link.source.x, link.source.y], target: [link.target.x, link.target.y] }));
  s(pathD(d, { stroke, strokeWidth }));   // pathD from shapes/path.ts
}

// Nodes
for (const node of nodes) {
  const cx = derive(() => TX + project(node.x, ...));
  const cy = derive(() => TY + project(node.y, ...));
  s(circle(Vec.derive(() => ({ x: cx.value, y: cy.value })), NODE_R, { fill, stroke }));
  s(label(Vec.derive(() => ({ x: cx.value, y: cy.value + LABEL_DY })), node.data.label, { ... }));
}
```

For the orientation swap (`[H, W]` size in horizontal mode), the
projection logic must thread the swap correctly: in horizontal,
node.x is the cross-axis (height) and node.y is the main axis (width).
Match inventory § 1.4 / `Tree.svelte:27` exactly.

### 4.4 DM gestures (Tree-specific possibilities; defer detail to build)

- **Click branch → drill in** to subtree bounding box (compute from
  `descendants`).
- **Drag leaf** has no obvious DM semantic for trees (no value to
  redistribute). Possible: drag to reparent (move subtree under a
  different parent). Defer — not in scope for first port.
- **Expand/collapse**: toggle `children` on click (a tree-specific
  interaction LayerChart doesn't bake in). Probably worth adding.

### 4.5 Defaults

- `nodeSize`: `undefined` (use layout `.size()`).
- `separation`: `undefined` (d3 default `(a, b) => a.parent === b.parent ? 1 : 2`).
- `orientation`: `"horizontal"` (matches LayerChart default).

---

## 5. chart-context extensions (added on demand)

Today's chart-context provides `width`, `height`, `focus`, `full`,
`zoomTo`, `reset`, `project`, `xProject`, `yProject`. Likely
additions, only when the recipe earns them:

### 5.1 `radialProject(angle, radius, cx, cy)` — added by Sunburst

Pure function: `{ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }`.
Add to chart-context if Tree also wants radial layout; otherwise keep
in the Sunburst recipe.

### 5.2 No other extensions anticipated

Pack/Partition/Tree use only `width`/`height`/`focus`/`project` from
the existing context. If a recipe ends up wanting padding, scales, or
channels, that's a signal to revisit families.md § 6 and decide
whether to grow the shell — not to silently add fields.

---

## 6. DM gesture patterns (carry from treemap.ts)

Lifted from treemap.ts; reuse where the recipe permits:

| Gesture                              | Implementation pattern (treemap.ts ref) |
|--------------------------------------|------------------------------------------|
| Click branch → drill in              | `drillTo(t)` + `drillStack.push(...)` (treemap.ts:158-166) |
| Esc → pop drill                      | `window.addEventListener("keydown", ...)` (treemap.ts:176-181) |
| Shift+click on leaf → drill parent   | `drillParent(e)` (treemap.ts:259-264) |
| Drag leaf → reapportion value        | `Vec.lens(...)` + sum-redistribute (treemap.ts:269-337) |
| ↑↓ keys → edit leaf value (±1, ±5)   | `keydown` handler (treemap.ts:306-311) |
| Alt+wheel → edit leaf value          | `wheel` handler (treemap.ts:312-318) |

When a recipe needs the same gesture, copy the pattern. When a recipe
needs a new gesture, the build session decides whether to factor it
into a kit helper or keep it per-demo. Default to per-demo for first
implementation; factor on second use.

---

## 7. Verification (per plan Part 5)

Existing rig: `apps/layerchart-direct-spike/` has the LayerChart-Svelte
versions running for comparison. Use `webapp-testing` with
`scripts/with_server.py` (the spike app is Vite-based per the plan).

Per recipe, assert:

- Correct number of rendered nodes at each depth (≤ d3 descendants count).
- Root fills viewport.
- Drill-in zooms `focus` to the clicked node's rect.
- Esc pops `focus` to previous drill or `full`.
- Drag-to-reapportion (where applicable) preserves total within
  numerical epsilon and preserves source order of siblings.

Same fixture data can drive parallel tests against the LayerChart-Svelte
demos and the new bireactive demos for behavioural parity.

---

## 8. Out of scope (explicit)

- Cartesian charts (Bar/Line/Area). Channels and scale framework will
  be a separate slice with its own intake.
- Sankey, Dagre, ForceSimulation, Hull, Pie, Voronoi, Geo, Calendar
  (inventory § 6).
- Render-target switching (SVG/Canvas/HTML). Bireactive is SVG.
- LayerChart's `selected` two-way prop on Treemap (inventory § 1.2
  flagged for removal).
- `xBaseline`/`yBaseline` (not hierarchical).
- TransformContext (covered by `focus`), TooltipContext (bireactive
  interaction), GeoContext, BrushContext.

---

## 9. Build order (suggested)

1. **Pack** — closest to treemap.ts in shape (size + padding only).
   Best first port; validates the pattern transfers.
2. **Partition** — adds the orientation question and the
   Icicle/Sunburst split. Sunburst flushes out the polar projection
   question (§ 5.1).
3. **Tree** — adds links rendering and the orientation swap nuance.
   Likely needs `pathD`/`curve` integration; expect more iteration.

Each is a separate session. Pack and Partition are likely Sonnet-tier;
Tree may need more.
