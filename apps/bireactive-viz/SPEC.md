# bireactive-viz — Spec

Hierarchical direct-manipulation viz kit. Forward layout via d3, backward via bireactive lenses. Targets: treemap, sunburst, icicle, pack, tree, sankey.

This document has two parts:

1. **Meta-spec** — the contracts every viz in this kit must satisfy. The shared substrate.
2. **Per-viz specs** — for each of the six hierarchical vizs, the answers to the seven questions: data, lens, layout, drill, selection, rules, cross-link.

---

## Part 1 — Meta-spec

### M1. Data substrate

Every viz in the kit operates on a **writable hierarchy of `Num` cells**:

```
type Node = {
  label: string
  color: string
  total: Writable<Num>       // leaf: free; branch: lens over children's totals
  children?: Node[]
}
```

- **Leaves** own a free `Writable<Num>`.
- **Branches** own a `Num.lens` that aggregates children (default: sum-redistribute on write, proportional rescale).
- Source-child order is the canonical order. Never call `.sort()` on the d3 hierarchy. Stability under edit is non-negotiable (R2/R7).

For tree-with-topology (where the topology itself is writable), see per-viz spec for `tree`.

For sankey (where there are also writable link flows in addition to node values), see per-viz spec for `sankey`.

### M2. Forward layout

For each viz, forward layout is a single bireactive `derive` cell:

```
const layout = derive(() => d3Layout(snapshot(tree), focus, padding))
```

- The cell snapshots every writable value it reads (Num.value).
- It runs a pure d3 function with no `.sort()`.
- It returns a `Map<Node, Geometry>` keyed by node identity, where `Geometry` is layout-coords (not view-coords).
- View-coords come from projecting layout-coords through `ChartContext.focus` via `chart-context.project`. This is what enables drill-in (M4).

### M3. Backward write (the lens contract)

Every gesture on a node writes back through a lens. The kit standardizes three lens shapes — every viz uses one of them, or composes them.

- **Reapportion lens** (treemap/sunburst/icicle/pack default).
  Writing to a leaf's value triggers sum-redistribute among siblings: surplus is taken proportionally from siblings with capacity; deficit is returned proportionally. Parent sum stays invariant. Lives in `kit/lenses.ts`.
- **Free lens** (sankey link flow, tree node position when force-augmented).
  Writing to a value just sets it. No sibling cascade. Used when the user is editing an absolute property (a flow rate, a free position).
- **Topology lens** (tree with parent-change).
  Writing parent of node N to N' relocates N in the tree, preserving N's subtree. The forward layout recomputes from scratch; identity of N (and its descendants) persists across the move so the shape "migrates" rather than disappears/reappears (R13).

### M4. View transform — chart-context and Bounds

Every viz uses `kit/chart-context.ts`:

```
ChartContext = {
  width, height           : Writable<Num>      // viewport px
  focus                   : { x0, y0, x1, y1 } // current visible rect in layout-coords
  full                    : { x0, y0, x1, y1 } // identity (full domain)
  zoomTo(domain), reset() : ...
}
```

Layout-coords → view-coords: `project(v, focus.x0..x1, 0..width)`. Drill-in is **setting focus**, nothing else. Drill-out (Esc) pops the focus stack.

All vizs render identity-keyed nodes by walking the static tree structure once and deriving each node's geometry through `project`. Drill is therefore free — it costs zero per-tile bookkeeping. Nodes that fall outside focus stay rendered but off-screen; the viewport clip-rect hides them.

**M4.1** Drill animation. Focus transitions tween via `bireactive.spring` on each of focus.{x0,y0,x1,y1}. Default ~250ms. Esc tweens back.

**M4.2** Drill stack. Each `zoomTo` pushes the previous focus onto a stack. Esc pops one. `reset()` clears the stack.

**M4.3** Breadcrumbs. The chart-context exposes the drill stack as a derived list of nodes (where the focus rect equals a known node's rect at push time). The kit renders a breadcrumb strip above the viewport showing the trail; clicking an entry pops to that level.

### M5. Gesture vocabulary (the DM contract)

Every viz wires the same five-gesture set. The viz only has to map each gesture to a lens action; the kit owns event handling.

| Gesture | Default semantic | Lens |
|---|---|---|
| Drag (pointer) | Resize/move the value | Reapportion or Free |
| Arrow keys (±1, shift ±5) | Nudge value | Reapportion or Free |
| Alt + wheel | Scrub value | Reapportion or Free |
| Double-click branch | Drill in (set focus) | n/a — chart-context.zoomTo |
| Escape | Pop drill / cancel speculative gesture | n/a |

**M5.1** Single-click on a branch selects it (M6). Double-click drills. Single-click on a leaf focuses it for keyboard.

**M5.2** Per R6, every drag is a *speculative* gesture: writes go through `batch()`. Esc during a drag reverts to the pre-drag snapshot. Release commits. This is the same Esc that pops drill — context-sensitive: if a drag is in-flight, Esc reverts the drag; otherwise Esc pops drill.

**M5.3** Per R3, all gestures are continuous: every pixel of pointer movement (or every key tap) re-derives the layout. No commit-only updates.

### M6. Selection

Persistent selection of one node. Survives drill. Drives keyboard target.

- Single-click on any tile → that node becomes selected.
- Selected tile gets a 2px outline in the kit's accent color.
- Selection is a `Writable<Node | null>` on chart-context.
- Cross-viz: selection is **shared** across all vizs that show the same tree (M7).

### M7. Cross-viz identity (R13)

The kit's reason for being. When two vizs (treemap and sunburst, say) show the same writable tree:

- The same `Writable<Num>` cell drives both. An edit in one updates the other live.
- Selection is shared (M6): selecting AAPL in treemap highlights it in sunburst.
- Drill is shared **optionally** — a `cross-drill` flag on the kit. Off by default (drilling a treemap shouldn't necessarily drill the sunburst beside it), but with morph transitions across vizs as a deeper goal (R13).

### M8. Rendering convention

- One `<svg>` per viz. Bireactive `Diagram` per viz.
- Tile order in SVG: branches first (back-to-front by depth), then leaves, then transparent hit overlays for leaves, then transparent hit overlays for branches. Hit overlays go on top in *reverse* DOM order from the visual rects so deeper hits win — but for treemap specifically branch hit zones need a different strategy (see Per-viz §1).
- Labels on top of everything. Label opacity = 1 iff tile dimensions exceed thresholds (per viz).

### M9. Vizform rule coverage (what this kit lands)

- **R2 (scale stability)** — no `.sort()`, source-order preserved. Universal.
- **R3 (real-time feedback)** — continuous gesture → derive → re-render. Universal.
- **R6 (speculative gestures, batch+Esc revert)** — wired via M5.2. Universal.
- **R7 (sort stability during gesture)** — falls out of R2.
- **R12 (label cohesion)** — labels follow tiles, fade below size threshold. Universal.
- **R13 (cross-view through shape)** — M7.
- **R15 (scale defers to commit, radial exception)** — per viz; radial vizs commit live.
- **R16 (zoom-to-fit on commit)** — M4. Universal.
- **R17 (hierarchical parity)** — falls out of using one writable tree across treemap/sunburst/icicle/pack.

Rules NOT addressed by this kit (out of scope for the hierarchical set): R1 framing, R4/R5 cursor semantics, R8–R11 sliceboard-specific rules, R14 timeline.

### M10. What this kit is NOT

- Not a generic chart library. No cartesian scatter, no Cartesian axes-as-primitives, no time series. Those are different rules.
- Not a Svelte port. Plain TS + custom elements + bireactive + d3 modules. LayerChart is the inspiration vocabulary, not a runtime dependency.
- Not a replacement for the existing bireactive-spike. Spike stays as an exploration ground; this is the production-shaped extraction.

---

## Part 2 — Per-viz specs

### §1. Treemap

**Data.** Writable tree per M1. Branch totals are sum-redistribute lenses.

**Lens.** Reapportion (M3). Drag a leaf vertically → leaf grows/shrinks, siblings absorb proportionally. Parent sum invariant.

**Layout.** `d3.treemap().tile(treemapSquarify).size([w,h]).padding(outer, inner, top).round(false)` over the writable tree snapshot. No `.sort()`. Squarified is the only tile option exposed initially (binary/dice/slice are mode flags for later).

**Drill.** Double-click any branch → focus tweens to that branch's rect. Esc pops. Breadcrumbs show the trail.

**Drill hit-zone problem (the real bug from milestone 1).** Branch tiles are visually beneath their leaves. Three options for the hit zone:
- **(a)** Render branch hit overlays ABOVE leaf hit overlays, but make them pointer-events-aware: pointer-events only on the *padding strip* (top 16px of the branch where the label is). Click in the padding = drill branch. Click in the body = drill the leaf you actually clicked.
- **(b)** Single-click selects, double-click on anything drills its nearest-ancestor branch. Leaves don't drill; doubled on a leaf, drill into its parent.
- **(c)** A "back/forward" button overlay in a corner and click-anywhere-in-branch only when in a special "navigate" mode.

**Decision: (b).** Selection is the primary single-click affordance. Drill is the primary double-click affordance. Always drills the nearest branch (parent if clicked a leaf, self if clicked a branch). This is also what LayerChart's example does via `selectedNested`.

**Selection.** Single-click anywhere selects that node (leaf OR branch).

**Rules.** R2, R3, R6, R12, R13, R16, R17.

**Cross-link.** Shares tree with sunburst, icicle, pack. Selection shared. Drill not auto-shared.

**Open questions.**
- Treemap-specific: should single-click on the focused-branch's padding strip *zoom out one level* (anti-drill)? Currently Esc handles this. Probably skip; Esc + breadcrumbs is enough.
- Padding inside drilled view: should padding scale with focus, or stay fixed in view-coords? **Decision: padding stays fixed in view-coords** (recompute layout with current focus's apparent size). Otherwise drilled tiles get visually crammed.

---

### §2. Sunburst

**Data.** Same writable tree as treemap (M7 shared).

**Lens.** Reapportion (M3) per ring. Drag a wedge tangentially → wedge angle grows/shrinks, sibling wedges in the same ring absorb. Radial drag does nothing on sunburst (the radius is determined by depth, not value).

**Layout.** `d3.partition().size([2π, radius])` then map `(x0,x1) → angle`, `(y0,y1) → r0,r1`. No `.sort()`.

**Drill.** Double-click a wedge → focus tweens that wedge's angular range to the full circle AND its radial range to the full radius. This is the standard zoomable-sunburst behavior. Esc pops. Sunburst's drill is special: the focus domain is *polar*, not cartesian.

**Drill, refined.** Chart-context's focus is rectangular `(x0,y0,x1,y1)`. For sunburst, we interpret `x` as angle and `y` as radius. The kit needs a `coords: "cartesian" | "polar"` flag on chart-context, and `project` becomes coord-aware.

**Selection.** Per M6.

**Rules.** R2, R3, R6, R12, R13, R15 (radial), R16, R17.

**Cross-link.** Shares tree with treemap/icicle/pack. Edit a wedge → treemap tile resizes live.

**Open questions.**
- Sunburst-specific: tangential drag direction → which sibling absorbs? Two choices: (i) clockwise neighbor always absorbs the delta; (ii) all siblings absorb proportionally. **Decision: (ii)** for consistency with treemap. (i) is more "physical" but couples to gesture direction in a way that breaks keyboard equivalence.
- Per R15 radial exception: commit happens live (no commit-on-release rescale of the ring's outer radius). The ring radius is fixed by depth; the only thing the gesture changes is angle. So R15 is satisfied by construction.

---

### §3. Icicle

**Data.** Same writable tree.

**Lens.** Reapportion (M3) per row. Drag a tile horizontally → width grows/shrinks, siblings in the same row absorb.

**Layout.** `d3.partition().size([w, h])` cartesian. `orientation: "horizontal" | "vertical"`. No `.sort()`. Rows = depth, row width ∝ value.

**Drill.** Double-click → focus tweens to that subtree's rect (cartesian, same as treemap).

**Relationship to sunburst.** Icicle is partition-cartesian; sunburst is partition-polar. **They should be the same component**, parameterized by `coords` on chart-context. This is the cleanest abstraction win in the kit:

```
<v-partition coords="cartesian" orientation="horizontal">  // = icicle
<v-partition coords="cartesian" orientation="vertical">    // = vertical icicle
<v-partition coords="polar">                                // = sunburst
```

**Selection.** Per M6.

**Rules.** Same as sunburst minus R15 (cartesian, so commit defers normally — but icicle's gesture doesn't change scale, only proportion within a fixed row, so R15 is N/A either way).

**Cross-link.** Same shared tree.

**Open questions.** None new.

---

### §4. Pack (circle packing)

**Data.** Same writable tree.

**Lens.** Reapportion (M3). Drag a leaf radially outward → radius grows, siblings shrink proportionally to absorb. Drag inward → shrinks, siblings grow.

**Layout.** `d3.pack().size([w, h]).padding(p)` over snapshot. No `.sort()`. Returns `(x, y, r)` per node.

**Drill.** Double-click → focus tweens to that subtree's bounding circle. The bounding rect of the circle is the focus domain. Same chart-context.zoomTo mechanism.

**Selection.** Per M6.

**Rules.** R2, R3, R6, R12, R13, R16, R17. R15 partly applies: dragging radially is *geometrically* radial, but the data write is value-of-leaf-against-sibling-pool — not a polar coordinate. So R15 is more weakly engaged here than in sunburst.

**Cross-link.** Same shared tree.

**Open questions.**
- Pack lays out circles where children are packed *inside* parents. Drilling a parent reveals its children at higher resolution — that's the whole interaction. So pack drill is even more central than treemap drill.
- Drag direction on a leaf inside a parent circle: which axis encodes value? Pure radial change is geometrically meaningful (resize the circle). **Decision: drag distance from circle center scales the leaf's value (and via reapportion, siblings rebalance and the parent's packing reflows).** This is unusual but matches the geometry.
- Does the parent circle resize during the drag, or stay fixed? Parent is a branch lens whose value is the sum — sum is invariant under reapportion — so parent radius is invariant. Good.

---

### §5. Tree (Reingold-Tilford)

**Data.** Now the topology matters. Writable tree, but ALSO writable parent pointers:

```
type TreeNode = {
  ...Node fields,
  parent: Writable<TreeNode | null>   // for topology DM
}
```

Or equivalently: keep parent implicit but make `children` arrays mutable through a topology lens.

**Lens.** Two lenses, depending on gesture:
- **Free lens** for node value (drag a node's "weight" → leaf's value changes; only used if the tree visualization shows value as a size attribute).
- **Topology lens** (M3): drag a node onto another node → re-parent. The dragged node's subtree moves with it. Identity preserved across the move (R13).

**Layout.** `d3.tree().size([w, h]).separation(...)` cartesian. Optional `radial: true` flag mapping `(x → angle, y → radius)` for radial tree. No `.sort()`.

**Drill.** Double-click a subtree's root → focus tweens to its bounding rect. Esc pops.

**Selection.** Per M6.

**Rules.** R2, R3, R6, R12, R13, R16, R17. Tree-with-topology is the strongest test of R13: identity must survive a re-parent across the same render. R15 applies in radial mode.

**Cross-link.** If shown alongside treemap/sunburst with the *same* tree, a re-parent in tree should propagate — but reapportionment only sees values, not topology. So a re-parent shows up as: the dragged subtree's value now contributes to a different parent's sum. The reapportion lens needs to handle this without rebalancing the *whole* tree.

**Open questions.**
- This is the most ambitious viz in the kit. Topology DM is genuinely new. Defer to a later milestone.
- Drag-to-reparent UX: drag a node, drop on another node. Need clear hover-target affordance. Tree-specific.

---

### §6. Sankey (hierarchical)

**Data.** Two options:
- **(a)** Derive sankey input from the writable tree: walk it, emit `(parent, child, child.total)` as links. Pure adapter; no new writable state. Editing a leaf in the treemap edits the sankey link width too.
- **(b)** Build sankey directly from `nodes + links` where each link has a `Writable<Num>` flow. More general (handles non-tree DAGs, joins, splits) but no longer "hierarchical."

**Decision for this kit: (a).** Sankey *of the same tree* is the goal. The R17 hierarchical parity story is "the tree shows up as five different shapes."

**Lens.** Reapportion on link flows. Dragging a link's width changes the corresponding leaf value; siblings of that leaf absorb proportionally (just like treemap). Identical semantics, different visual.

**Layout.** `d3-sankey` with the adapter from (a). `nodeAlign: "justify"`, `nodeWidth`, `nodePadding`.

**Drill.** Double-click a node → focus tweens to a smaller domain centered on that node and its immediate ancestors/descendants. Sankey drill is less standard than treemap; deferred to a second iteration.

**Selection.** Per M6.

**Rules.** R2, R3, R6, R12, R13, R17. R15 N/A (cartesian). R16 partial (drill is fuzzy).

**Cross-link.** Same tree as treemap/sunburst/icicle/pack. The strongest R17 story: same writable tree → five hierarchical shapes.

**Open questions.**
- d3-sankey assumes a DAG, not a tree. Trees are degenerate DAGs (every node has one parent). The adapter is trivial.
- Sankey crossings: a tree has no crossings. So d3-sankey will lay it out as a clean left-to-right tree with no overlapping links. Good — that's the desired look.

---

## Part 3 — Build order

Proposed sequence (subject to your redline):

1. **Substrate first.** `kit/chart-context.ts` with polar/cartesian coords, focus-domain spring tween, drill stack, selection. `kit/lenses.ts` factoring reapportion out of the spike. `kit/gestures.ts` factoring the drag/keyboard/wheel boilerplate.
2. **Treemap, properly.** Apply the substrate. Single-click selects, double-click drills nearest branch, Esc pops, breadcrumbs at top, tween on drill.
3. **Partition** (sunburst + icicle as one component with `coords` + `orientation` flags).
4. **Pack.**
5. **Cross-link demo.** Treemap + sunburst + icicle side-by-side, same tree, shared selection. Proves M7.
6. **Sankey** (hierarchical adapter).
7. **Tree** with topology DM (the stretch goal — deferred).

---

## Part 4 — Open meta questions (need your redline)

These are the ones I genuinely don't know your answer on:

1. **Is the writable-tree model right?** Or would you rather the data substrate be flat (a list of nodes, each with a parent-id) — making topology mutations trivial but reapportionment more verbose? I assumed nested-tree throughout; sankey/tree might push us flat.

2. **Cross-drill: off by default, opt-in?** Or always on? I went off-by-default because drilling all vizs in sync is jarring on first encounter. You may disagree.

3. **Esc semantics — drag-revert vs drill-pop.** I made it context-sensitive (drag-revert wins if a drag is in-flight). But that's invisible to the user. Should there be separate keys, or is context-sensitive fine?

4. **Selection — one global or per-viz?** I said global (shared across all vizs showing the same tree). But maybe each viz should have its own, with an opt-in "link selection" flag.

5. **Tree-with-topology — in scope or out?** I included it but flagged as stretch. If it's out of scope, we drop §5 entirely and ship just treemap/partition/pack/sankey.

6. **Breadcrumbs UI — kit-owned or viz-owned?** I assumed kit-owned (rendered above the SVG as DOM, not inside SVG). Could go either way.

7. **Animation library — bireactive `spring` / `tween` or hand-roll?** I lean bireactive's, since we already depend on it.
