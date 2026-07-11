# Graph Layout, 2026 — taxonomy + a bireactive bet

Research/positioning doc. Inventory the layout-algorithm landscape, name the
dimensions that actually matter for what we're building (compound, edge-aware,
direct-manipulation, live), then take a position on the bireactive approach
the spikes have been circling.

This is not a plan. It's the map you use to decide where to spike next and
what to stop spiking on.

---

## 0 · The questions driving this

1. **How best to do hierarchical (compound) layout?** Native, bolt-on, or
   recursive composition of a flat algorithm?
2. **Does hierarchy compose into other layout classes** (force, orthogonal,
   radial, treemap)? Or is it an axis the algorithm has to be designed
   around from day one?
3. **Are there meta-patterns?** Multipass? Constraint vs imperative?
   Solver-as-substrate vs algorithm-as-function?
4. **What other layout classes exist** beyond hierarchical that we care
   about (or might care about) — and how do they interact with the box
   model, edges, labels?
5. **What fits direct-manipulation, live, bireactive workflows** — where
   the layout must keep solving while the user drags, reparents, edits,
   and the surface stays coherent?

The TL;DR is at §7. The rest is the work.

---

## 1 · The dimensions that actually matter

Layout taxonomies usually sort by *algorithm family* (force, hierarchical,
orthogonal, radial). That's the wrong primary key for our problem. The
primary keys are these dimensions, because they decide which families
compose and which don't.

### 1.1 Hierarchy support

- **None.** Flat node set, flat edge set. d3-force, ngraph, vanilla
  fdp/sfdp. Compound layout is the caller's problem.
- **Bolt-on, soft.** Groups exist as a constraint or a hint but the
  solver is still flat. WebCoLa groups, d3-force with custom
  cluster-attraction forces. Group rects are derived post-hoc from
  member positions (a *hull*).
- **Bolt-on, hard.** Groups exist as opaque rectangles the layout
  respects but doesn't recurse into. Dagre-compound (one extra pass).
  Better than soft, still single-level.
- **Native, recursive.** The algorithm runs at every level of the
  containment tree. ELK (algorithms compose by level), yFiles
  (hierarchical layout has a "group node mode"), Graphviz cluster
  layouts, and — the spike5 pattern — `layered()` applied to itself.

**Insight:** native-recursive is the only one where containers carry
size and chrome honestly without a separate "fit the parent to its
children" post-process. Spike5 demonstrates this with ~80 lines.

### 1.2 Edges as first-class

- **No edges.** Treemap, pack, sunburst, icicle. The "graph" is just
  the containment tree.
- **Edges as decoration.** d3-force, ngraph — edges are springs but the
  router is "straight line between centres." Crossings happen.
- **Edges as routes.** Sugiyama, Graphviz, orthogonal layouts. Routing
  is a phase, not a render-time afterthought. Polyline / spline / ortho.
- **Edges as boxes.** ELK and yFiles model edge labels as
  bounded shapes that participate in non-overlap. The router reserves
  space for them.

**Insight:** edge labels are the silent killer of "looks clean."
Anything that doesn't model them as boxes will eventually overlap.
We don't have them yet. We will.

### 1.3 Box model

- **Point nodes.** Centre + radius. d3-force defaults.
- **Rect nodes, uniform.** Dagre with default sizes.
- **Rect nodes, measured.** Each node has its own measured w/h
  (text length, content). Spike4 + spike5.
- **Rect + pad + chrome.** Each node has interior measured size *and*
  exterior chrome (header bar, border, label-above). Groups especially.
  Spike5 does this via `measured.groups[g].pad`.
- **Polygonal / convex hull.** WebCoLa group boundaries. Hard to
  compose with edge routing.

**Insight:** the moment you model groups as rects-with-chrome rather
than hulls, hierarchy stops being a special case. A group is a node
that happens to also be a container. That's spike5's whole bet.

### 1.4 Composition regime

- **Single-pass solve.** One function: graph → positions. Dagre,
  Graphviz dot. Fast, deterministic, no animation story.
- **Iterative solver.** Tick a constraint system until it stabilises.
  d3-force, WebCoLa, ELK's layered with constraints. Animates for free.
- **Multipass with phases.** Sugiyama is the canonical example: rank,
  crossing-minimisation, x-coordinate-assignment, edge-routing.
  Phases are pure functions; intermediate state is data.
- **Recursive composition.** Run the layout per group; child group's
  *output* is the parent's *input* as an opaque node. Spike5.
- **Incremental / propagator.** Each move re-narrows only the cells
  that depend on what changed. Spike1's bet. The propagator solver
  is the substrate; layout primitives (rank, layered) write into it
  and re-narrow on edit.

**Insight:** these regimes are not exclusive but they don't all mix.
You can wrap a single-pass algorithm inside a recursive composer
(spike5 wraps `layered()`). You cannot wrap an iterative solver
inside a recursive composer without ugly nested ticking loops.

### 1.5 Determinism + animation story

- **Deterministic, snapshot.** Same input → same output every time.
  No animation. Dagre, Graphviz. You animate yourself by springing
  from old positions to new.
- **Deterministic, incremental.** Same input + same prior state →
  same output. Affected nodes move; others stay. Spike1's claim.
- **Stochastic.** Force layouts with random init. Looks different
  every run. Bad for direct manipulation — the canvas reshuffles
  out from under the user's pointer.

**Insight:** for direct-manipulation live editing, "deterministic +
incremental" is the only acceptable cell. Deterministic snapshot is
acceptable if springs absorb the jumps.

### 1.6 Constraints exposed to the caller

- **Closed.** Algorithm is a black box. Dagre, Graphviz, d3-hierarchy.
  You get what you get.
- **Constraint-shaped API.** Caller passes constraints (alignment,
  separation, non-overlap, fixed positions, groups). WebCoLa, ELK.
- **Open substrate.** The solver itself is the API; layout primitives
  are written in the same vocabulary as user constraints. Bireactive's
  propagators. You can mix `layered()` with `pin()`, `inset()`,
  `nonOverlap()` because they all narrow the same cells.

**Insight:** open substrate is the only model where domain-specific
constraints (this node is the org root and must be top-left;
authentication must be physically near the data layer) compose
cleanly with the layout algorithm. In every other model these are
patches.

### 1.7 Overlap classes the algorithm prevents

Inventory of what can intersect. Not all algorithms model all of these:

- node ↔ node (basic non-overlap)
- node ↔ group rect
- group ↔ group (sibling groups)
- node ↔ edge (edge crossing through a node)
- edge ↔ edge (edge crossings — separate from edge↔node)
- label ↔ anything (node labels, edge labels, group labels)
- hull/border ↔ anything (when groups are drawn with chrome)

**Insight:** every algorithm handles the first 1–3 of these.
Almost none handle the last 3. ELK and yFiles do. That's most of
why they look better than dagre.

---

## 2 · The library / algorithm field, sorted by what they actually do

### 2.1 Hierarchical (Sugiyama family)

| Library | Hierarchy | Edges | Box model | Regime | Notes |
|---|---|---|---|---|---|
| **dagre** | Bolt-on, hard (compound) | Polyline routes | Rect | Single-pass, multiphase | The reference Sugiyama in JS. Static, deterministic, no incremental story. |
| **dagre-d3** | Same as dagre | Same | Same | Same | Just a renderer. |
| **ELK.js** | Native recursive | Orthogonal + boxes | Rect+pad+chrome | Multipass per level | Closest to "professional" hierarchical in JS. Slow on big graphs. |
| **bireactive `layered()`** | Recursive via composition (spike5) | Straight + projection | Rect+pad+chrome | Single-pass per level, propagator-backed | Composes because it's a function, not a system. |
| **Graphviz (WASM)** | Native (clusters) | Spline / ortho | Rect | Single-pass | Beautiful output; foreign object. Hard to mix with our substrate. |

### 2.2 Force / physics

| Library | Hierarchy | Edges | Box model | Regime | Notes |
|---|---|---|---|---|---|
| **d3-force** | None | Springs | Points | Iterative | The "graphs that look like graphs" default. No incremental story for big edits. |
| **ngraph.forcelayout** | None | Springs | Points | Iterative | Fast Barnes-Hut. Same shape as d3-force. |
| **vis-network** | Bolt-on soft (clusters) | Springs | Rects | Iterative | Closed, hard to extend. |
| **WebCoLa** | Bolt-on (groups w/ hulls) | Springs + ortho | Rects | Iterative + projection | Constraint-shaped API. Mathematically rigorous (SCG). Animation is iteration. |
| **bireactive force (spike3)** | Bolt-on via groups-as-constraints | Springs | Rects | Iterative on propagator solver | The constraints *are* the API. Composes with `pin`, `gap`, `separation`. |

### 2.3 Tree / containment

| Library | Hierarchy | Edges | Box model | Notes |
|---|---|---|---|---|
| **d3-hierarchy tree** | Native | Implicit parent→child | Rect | The reference tidy-tree. No cross-edges. |
| **d3-hierarchy treemap** | Native | None | Rect (filled) | Area-encoded containment. |
| **d3-hierarchy pack** | Native | None | Circles | Same, with circles. |
| **d3-hierarchy partition** | Native | None | Rect (icicle / sunburst) | Same, with band/radial framing. |

These are all *pure tree* — no cross-containment edges. They're the
"containment-only" corner of the space. Where we are with the
sliceboard work.

### 2.4 Orthogonal / wiring

| Library | Notes |
|---|---|
| **yFiles (commercial)** | The gold standard for hierarchical + orthogonal + edge labels. Recursive groups, edge labels as boxes, the works. Reference for "what good looks like." Not OSS. |
| **mxGraph / draw.io** | Orthogonal routing + manual placement. Direct-manipulation diagram editor. Layout is mostly manual + helpers. |
| **ELK.js (already listed)** | The OSS closest equivalent to yFiles for hierarchical. |

### 2.5 Radial / circular

`d3-hierarchy.tree.radial()`, ngraph radial, bireactive
`radial()` propagator. Trees, mostly. Cross-edges look bad on
radial unless you bundle them (D3 hierarchical edge bundling).

### 2.6 Constraint solvers (substrate, not algorithm)

- **WebCoLa** ships its own constraint solver but it's hidden behind
  the layout API.
- **Kiwi.js / Cassowary** — linear constraint solver. Used by GTK,
  Auto Layout. Algorithm-agnostic. You'd write your own layout on
  top.
- **bireactive propagators** — interval narrowing + AVBD constraint
  cluster + spring/repel/gap/separation/nonOverlap factories. Layout
  primitives (`layered`, `tree`, `radial`, `lanes`) are functions
  that compute positions; the solver animates between snapshots
  with springs.

---

## 3 · Meta-patterns (recurring shapes across algorithms)

These are the patterns that show up repeatedly. Naming them helps decide
what we're using and what we're avoiding.

### 3.1 Phases as pure functions (Sugiyama-style multipass)

`rank → orderingPerLayer → assignX → routeEdges → labelPlacement`.
Each phase is a pure function; intermediate state is data on the
graph. Composes with anything that respects the phase outputs.
This is what `inspo/bireactive/src/propagators/graph.ts` does
internally for `layered()`.

**When to reach for it:** static, deterministic, multipass needs
that benefit from intermediate inspection (e.g. debug overlays for
"why is this edge routed here").

### 3.2 Iterative constraint relaxation

System of constraints + an integrator. Tick to stabilise.
d3-force, WebCoLa, AVBD. Naturally animates.

**When to reach for it:** when constraints aren't fully expressible
as a closed-form ordering (overlap avoidance with arbitrary group
shapes; physical proximity preferences that aren't a strict layer).

### 3.3 Recursive composition of a single-level algorithm

"Solve the level. Each child group is a fat node whose size is its
own solved extent. Recurse." Spike5. Same primitive everywhere.

**When to reach for it:** any time the algorithm has a clean
"layout this flat graph with these node sizes" interface and the
hierarchy is honest containment (not implied semantic grouping).

### 3.4 Two-stage: structure then aesthetics

Sugiyama is structure-then-aesthetics: phase 1–3 commit to topology,
phase 4 is decoration. Spike5 is the same: solve positions first,
hulls and edges fall out projectively.

**When to reach for it:** always, basically. The decoration layer is
where you absorb things the structure phase couldn't see (label
overflow, animation, hover).

### 3.5 Propagator / incremental solving

Cells narrow as constraints get added. Removal-and-readd narrows
only what depends on the change. The bireactive bet.

**When to reach for it:** direct manipulation. The user's drag is
the constraint; the substrate re-narrows.

### 3.6 Snapshot-spring projection

The escape hatch. Wrap any pure-function layout (dagre, ELK) by
calling it on each change, then springing positions from old to new.
Spike4. Gives you "looks animated" without an iterative layout.

**When to reach for it:** when the underlying algorithm is great
(dagre, ELK) and you're willing to give up incremental locality —
the whole graph reshuffles per change, springs absorb the visual
discontinuity.

---

## 4 · Composition: which classes mix with which

A small matrix. "Does hierarchy compose into layout class X?"

| Class | Hierarchical via … | Notes |
|---|---|---|
| Layered (Sugiyama) | Native (ELK), recursive (spike5), bolt-on (dagre-compound) | Cleanest fit. Levels and layers are both "axes." |
| Force | Bolt-on (groups as soft constraints, hulls) | Group rect is *derived*, not solved. Group-vs-group non-overlap is hard. |
| Tree (tidy) | Native — it IS hierarchy | But no cross-edges. |
| Treemap / pack / partition | Native | But edges are foreign. |
| Radial | Native for trees; ad-hoc otherwise | Cross-containment edges look ugly without bundling. |
| Orthogonal | Native (yFiles, ELK) | Hardest. Routing through group boundaries needs careful gap reservation. |
| Lanes / swimlanes | Native (`lanes()` propagator) | Lanes ARE a flavour of one-deep hierarchy. |

**Insight:** hierarchy composes cleanly into layered and trees because
they already have an axial structure. Force admits hierarchy only as
soft hints; the math doesn't really know about groups. Orthogonal +
hierarchy is a research-grade problem; yFiles/ELK have spent years on it.

---

## 5 · What direct manipulation demands

Live editing — drag a node, reparent a row, add an edge — has constraints
the static-layout literature doesn't dwell on.

### 5.1 Locality of update

When the user drags one node, the rest should not reshuffle. This is
the *opposite* of what most layouts do — they re-solve globally on
every change. Three escape hatches:

- **Propagator narrowing** (spike1's claim): only re-narrow what
  depends on the change. The most principled.
- **Pinning + soft layout** (spike3 with force + pins): the dragged
  node is a hard constraint; the rest relaxes. Local-ish.
- **Snapshot-spring** (spike4): the layout re-solves globally but
  springs absorb the visual jump. Looks local; isn't.

### 5.2 Reversibility and continuity

The user's mental model: "this node was here, now it's there."
Algorithms that move *unrelated* nodes during an edit (force layouts
re-stabilising, dagre layer reassignment cascading) break the model.
Layouts whose output is a *continuous function of input* are easier
to learn.

Spike5's recursive `layered()` is *not* continuous in this sense —
reparenting a node can flip the layer order. But the spring layer
hides it.

### 5.3 The "while dragging" constraint

What happens while the finger is down? Three regimes:

- **Frozen:** layout doesn't run; only the dragged thing moves.
  Snap to new layout on release. Easiest.
- **Live with pinning:** layout runs every frame; the dragged node
  is pinned. Iterative algorithms (force, cola) do this natively.
  Sugiyama-style doesn't.
- **Predictive:** show where things *would* end up if released now
  (ghost). LayerChart spike's "drag-to-reparent" prototype.

For our work, **live with pinning** is the bireactive-native answer
where the algorithm supports it; **frozen + spring** is the fallback
for snapshot algorithms.

### 5.4 Edit operations beyond drag

- Reparent (drag-to-reparent) — recompute hierarchy, re-solve, spring.
- Add edge — re-solve (or, with propagators, narrow).
- Delete — same.
- Resize — only matters if box sizes are caller-supplied. They are
  for us.
- Edit label text — measured size changes, layout must reflow.

**Insight:** measured-size changes are the under-appreciated edit op.
A node whose label grew needs its layer gap to grow too. Spike5
handles this by computing `layerGap = maxAlong + 40` from the
*current* measured sizes each solve.

---

## 6 · Where the spikes land in the taxonomy

| Spike | Hierarchy | Composition | Box model | Edges | Animation | What it proves |
|---|---|---|---|---|---|---|
| 1 — prop-Sugiyama | Hulls (bolt-on soft) | Single-pass `layered()` + derived hulls | Rect, measured | Straight, projected | Spring | Incremental Sugiyama on the propagator substrate. Hulls are post-hoc, not constraints. |
| 2 — cola adapt | Bolt-on soft (groups) | Iterative on propagator | Rect | Springs | Native iteration | Constraint factories (separation, nonOverlap) on bireactive's solver. Foundation. |
| 3 — force adapt | Bolt-on soft | Iterative | Rect | Springs | Native iteration | The substrate can do force without d3-force. |
| 4 — dagre wrap | Bolt-on hard | Snapshot-spring | Rect | Polyline | Snapshot+spring | Wrap regime: pure-fn layout, springs absorb. |
| 5 — nested-layered | Native recursive | Recursive composition of `layered()` | Rect + pad + chrome | Straight, lifted-to-LCA | Spring | Same primitive every level. Group rect is a first-class solver variable. |

**The two that "work cleanly" are almost certainly 4 and 5.** Both
treat groups as honest rectangles. 1 fakes it with hulls; 2 and 3
fake it with soft attraction.

**The bet:** spike5's pattern is the architecturally strongest because
it does not require the layout algorithm to know about hierarchy. Any
new flat-graph algorithm we add (orthogonal router, alternative
ranker) inherits hierarchy for free by being run per group.

---

## 7 · The position

Answering §0 directly.

### 7.1 How best to do hierarchical layout?

**Recursive composition of a flat algorithm**, where the algorithm has
a clean `(graph, sizeOf) → positions` interface and the box model
includes chrome. Spike5 is the prototype.

Native-recursive (ELK, yFiles) is theoretically equivalent but
embedded in monolithic libraries. We get it by composition because
the layout primitives are functions, not systems.

### 7.2 Does hierarchy compose into other layout classes?

**Yes for layered, tree, lanes, radial.** Same `(graph, sizeOf) →
positions` shape. Each can be the per-level engine in spike5's
recursion.

**Yes-but-soft for force.** Groups can pull members together; group
non-overlap can be a constraint. But group sizes aren't naturally
known to the solver; you'd compute them per tick from hulls. Less
clean.

**Hard for orthogonal.** Routing through nested group boundaries
needs gap reservation that's a global property. This is why ELK and
yFiles do this and nobody else does.

**Not really for treemap/pack/partition.** They ARE hierarchy; edges
don't fit.

### 7.3 Meta-patterns

The seven from §3. The two we're betting on:

- **Phases as pure functions** for the algorithm interior.
- **Recursive composition** for hierarchy.

The one we should keep as an escape hatch:

- **Snapshot-spring** (spike4 regime) for libraries we want to
  borrow (dagre, ELK) without inheriting their internal model.

### 7.4 Constraint-based vs imperative

For our work: **constraint-substrate underneath, pure-function
algorithms on top**. The propagator solver is the substrate. Layout
primitives (`layered`, `tree`, `radial`, `lanes`) are pure functions
that compute `Map<id, Placement>`. The substrate handles animation
(springs to targets) and incremental narrowing for direct manipulation.

This is the same shape as React's "render is a function, reconciler
is the runtime." Layout is a function; bireactive is the runtime.

### 7.5 What fits direct manipulation

- **Recursive `layered()`** for compound graph topology. Honest
  containment, deterministic, fast.
- **Springs to absorb** every solve as animation.
- **Pinning during drag** at the level the drag affects; re-solve
  on release where the propagator can't narrow incrementally.
- **Snapshot regime** for whatever we don't have a propagator-native
  algorithm for yet (ELK orthogonal routing, e.g.) — wrap, spring.

---

## 8 · What's missing — open dimensions worth a spike

In rough order of "would change the picture the most":

1. **Edges influence layout (not just decoration).** The biggest
   architectural gap between us and yFiles/ELK. Currently spike5
   solves children inside each group, then draws edges on top —
   edges have zero effect on positions. yFiles/ELK use edges as
   inputs in four specific ways we should steal:
   - **Directional rank pressure across groups.** Edge `auth → users`
     where `auth ∈ frontend` and `users ∈ backend` says "frontend
     should rank above backend" in TB. Lift the direction to each
     ancestor level, not just the LCA.
   - **Endpoint attraction.** Bias `auth`'s x-position inside
     `frontend` toward `users`'s x-position inside `backend`, so
     the cross-edge is short and roughly straight.
   - **Cross-group crossing minimisation.** When ordering siblings
     within a layer, count crossings including cross-group edges
     lifted to that level (today we only count edges *at* the LCA).
   - **Group-port awareness (later).** Optional: declare that an
     edge enters a group from a side; the group's internal layout
     pulls the connecting node to that side.

   This is the thing that will stop diagrams looking like spaghetti
   even when group separation is perfect.

2. **Separate `groupGap` from `nodeGap`.** Spike5 uses one gap value
   for both sibling leaves and sibling groups. yFiles treats group-
   to-group minimum distance as its own knob. Sibling groups should
   breathe more than sibling leaves. One-line addition to the
   `layered()` call per level.

3. **Aesthetics inside `layered()`.** What dagre/ELK call the
   "x-coordinate assignment" phase — minimising bends, centring
   parents over children, vertical alignment of chains
   (Brandes-Köpf-style). Touches the algorithm's internals, not a
   post-pass. The propagator `layered()` does a basic version;
   audit + extend.

4. **Nudging / post-passes (new architectural slot).** Take the
   layout's output and improve it on one dimension. ELK ships a
   family of these as full "layouts" (`sporeOverlap`,
   `sporeCompaction`, `rectpacking`, `box`, `force`, `stress`,
   `fixed`) that compose with the main algorithm. We want the same
   shape, named explicitly:

   - **Compaction** — pull layers/siblings together along an axis
     where the structural solve left slack, without introducing
     overlap. Directly relevant to the vertical-airiness problem:
     instead of (or alongside) removing the scale cap, compact the
     slack out. Different fix, complementary to fit-to-fill.
   - **Overlap removal** (spore-style) — push overlapping rects
     apart with minimum displacement. Cheap insurance against
     label/chrome overhangs the structural solve didn't model.
   - **Label placement** (later) — treat each label as a small rect
     with soft attachment to its anchor; nudge to resolve overlaps.
     Same machinery as overlap removal applied to labels.
   - **Component packing** (probably never for us) — for
     disconnected graphs. Our diagrams are connected.

   These run **per level** inside the recursion, not globally — a
   leaf can't be nudged outside its group's rect; a group can't be
   nudged outside its parent's rect. The architecture becomes:

   ```
   solve → project → nudge* → render
   ```

   where `nudge*` is zero-or-more composable passes. Edge routing
   (#10) and edge labels (#11) eventually live here too.

5. **Fit-to-fill behaviour.** The current `Math.min(1.0, ...)` cap
   in `#applyLayout()` forbids zoom-in, which is why the second
   screenshot has so much vertical air. Drop the cap → fill the
   binding axis, slack the other. Complementary to #4 compaction:
   compaction tightens the layout itself; fit-to-fill scales the
   tightened result to the viewport.

6. **User zoom + pan on top of fit.** Once fit-to-fill works, layer
   a pan/zoom gesture on `#gfx.scale` / `#gfx.translate`. Independent
   piece, easy to add.

7. **Lanes / swimlanes inside the recursion.** `lanes()` exists as a
   propagator. Spike5 uses `layered()`; the same pattern with
   `lanes()` would give nested swimlanes. Interesting because lanes
   are a flavour of one-deep hierarchy already.

8. **Mixed per-level algorithms.** Spike5 uses `layered()` at every
   level. Nothing says it has to. The architecture admits "layered
   at top level, radial inside this group, treemap inside that
   one" — same recursion, different per-level engine.

9. **Memoised `solveGroup`.** Today every edit re-solves every
   level (see §10). Key the solve on (children of g, edges-at-g-level,
   sizes of children); only re-solve groups whose inputs changed.
   Real win at scale (~hundreds of nodes); unnecessary at current
   sizes.

10. **Interactive reparenting integration.** LayerChart spike has the
    drag-to-reparent ghost; spike5 has the recursive solve. Marry
    them: while dragging, show the target solve as a ghost; commit
    on release. Worth it once the static quality is solid.

11. **Edge routing (orthogonal / polyline) as a nudging pass.**
    Deferred. Currently edges are straight lines. Worth doing
    eventually but is *decoration* on top of a good layout, not a
    cause of bad layout. Lives in the `nudge*` slot from #4 once
    we get to it. Do not prioritise until #1–#5 are solid.

12. **Edge labels as boxes.** Deferred. Follows #11. Same nudging
    slot — label placement is itself a nudging pass.

---

## 9 · Invariants (load-bearing)

These are not configurable. They're properties of the data model that
the layout exploits without checking. Naming them so we don't lose
them by accident.

### 9.1 Single-parent node membership

Each row has exactly one `parentId`. A leaf node belongs to exactly
one container. Type-enforced by `parentId: string | null` (not
`parentIds: string[]`). The whole layout is built on this.

**What it buys:**
- **Container topology is a tree by construction.** Sibling groups
  have disjoint membership.
- **Sibling group rects are disjoint by construction.** `layered()`
  separates siblings on its axis; with disjoint membership, the
  rects cannot overlap. No explicit non-overlap constraint between
  group rects is needed.
- **Cross-edges have a unique LCA.** Edge lifting (spike5 line 252)
  is unambiguous — one LCA per edge, one lift policy.
- **`childrenOf` partitioning is a one-pass bucket** (spike5 lines
  213–217). Each row lands in exactly one bucket. The recursion
  sees disjoint sibling sets at every level for free.

**What we give up:** Euler-diagram-style overlapping groups
("`alice` is in both `admins` and `engineers`"). If we ever need
that, it's a *different layout class*, not a flag on this one.
yFiles treats set visualisation as a separate primitive too.

### 9.2 No flag, no auto-detect

We do not offer `containmentMode: "tree" | "dag"` and we do not
detect-and-switch at runtime. There is no "dag path" to switch to —
the optimisations *are* the architecture. The invariant is enforced
by the data model. If a future feature requires multi-parent, that
feature changes the data model, which is a deliberate breaking
change, not a flag flip.

## 10 · Open questions (with current answers where I have them)

### Is recursive `layered()` incremental in any meaningful sense?

**No, today.** [spike5-nested-layered.ts:114](../packages/vizform-layout/src/lib/spike5-nested-layered.ts#L114)'s `effect()` calls
`#buildAll()` and `#applyLayout()` on any change. `solveGroup()`
recurses from the root and re-solves every level. Springs absorb
the visual jump.

Can it be incremental? Yes, two levels:
- **Memoise `solveGroup(g)`** keyed on (children of g, edges-at-g,
  sizes of children). Only re-solve groups whose inputs changed.
  Reparent affects source group + destination group + ancestors;
  edge add affects one LCA. Cheap and high-leverage.
- **Propagator-narrow** (spike1's claim) — the constraint cells
  re-narrow only when dependencies change. Stronger; requires
  `layered()` to write into the solver instead of computing
  positions as a pure function. Bigger lift.

Memoisation first. Propagator narrowing is interesting but not
necessary at current sizes.

### How expensive is per-frame re-solve at realistic sizes?

Don't know yet. Worth benchmarking before spending on memoisation.
At ~10–30 nodes (current spike data) it's clearly fine. At 200+
with deep nesting, probably not.

### Can ELK's orthogonal router be borrowed via snapshot-spring?

Probably yes — wrap ELK as the per-level engine inside spike5's
recursion. The interface match is good: ELK takes a flat graph
with sizes, returns positions + routes. Worth trying before
writing one.

### Do we ever need multi-parent containment?

**No.** See §9.1. Single-parent is load-bearing. Multi-parent is
a different layout class entirely.

### Group size as solver variable vs derived hull?

For the recursive `layered()` line of work: **derived from inner
solve.** A group's size is `extent(inner) + chrome`. No reason to
make it a solver variable.

For a hypothetical force-with-groups line of work (not where we're
betting): WebCoLa's group-as-rect-variable model is the right
reference. Not relevant to spike5.

---

## 11 · The next move — priority order

Winston's explicit priority order for the diagrams. Strict
sequence, not buckets.

1. **Layout-level overlap correctness.** Node rects, group rects,
   swimlane rects, AND their label rects all participate in
   non-overlap. Sibling groups (single-container membership) never
   intersect. The geometric rule is "group rects do not overlap" —
   independent of whether the node-graph itself is a DAG. Labels
   are first-class participants from day one, not deferred. Group
   chip-headers and node labels are already in `measured`; audit
   that the solver actually respects them, and add explicit
   non-overlap where it doesn't.
2. **Zoom / pan / scale-to-fit with em-based max zoom.** Drop the
   `Math.min(1.0, …)` cap; replace with a sane max based on font
   em-size so small graphs zoom up to readable, not infinite. Layer
   a pan/zoom gesture on `#gfx.scale` / `#gfx.translate`.
3. **Edge labels modeled as rects.** Every edge label participates
   in the no-overlap constraint with every other label rect (node,
   group, swimlane, edge). Edge *routing* (orthogonal/polyline)
   stays deferred — straight-line edges with placed labels first.
4. **Aesthetic + nudging passes.** The `nudge*` slot from §8 #4
   becomes load-bearing here. Compaction, overlap-removal, label
   placement, x-assignment polish (Brandes-Köpf-style). Run per
   level inside the recursion.
5. **Baseline performance at low scale.** Make the 20–50 node case
   feel instant before chasing big-graph optimisation. Profile the
   per-edit re-solve; cheap memoisation only if it shows up hot.
6. **Drag-to-reparent.** Once static layout is solid: LayerChart
   spike's ghost preview married to spike5's recursive solve.
   Commit on release.
7. **In-place label editing UX** (maybe). Click a label, edit,
   layout reflows on measured-size change. The reflow already
   works (effect tracks `name.value`); the UX is the work.
8. **Mixed per-level algorithms.** `layered()` at one level,
   `radial()` or `tree()` inside a specific group, etc. The
   architecture admits it; pick when a real diagram needs it.
9. **Additional data bindings.** Node/group size driven by a
   measure, colour by a dimension, etc. — sliceboard-style bindings
   extended to the graph layout.
10. **Edge routing.** Polyline / orthogonal routing as a nudging
    pass. Straight edges with placed labels (P3) hold us until
    here. Worth doing eventually; not a cause of bad layout, just
    a polish lift once everything above is solid.
11. **Scale optimisations.** Memoised `solveGroup`; propagator
    narrowing for true incremental; whatever profiling at real
    sizes shows is needed. Last.

**What this priority order changes vs. earlier drafts of this doc:**

- Label correctness (P1, P3) is no longer deferred behind edge
  routing. Label rects are first-class non-overlap participants
  from the start.
- "Edges influence layout" (yFiles-style endpoint attraction,
  directional rank pressure) is **not** in the top eleven. It's
  interesting, possibly worth doing later, but Winston would rather
  have label correctness and zoom than shorter cross-edges.
- Edge routing (polyline / orthogonal) is in at #10 — after data
  bindings, before scale optimisations.
- Performance work is explicitly low-scale-first.
- Compaction, overlap-removal, label-placement collapse into the
  same P4 nudging-passes bucket — they're variations of the same
  architectural slot.

**Reference worth gathering when convenient:** yFiles' demo web app
exposes their compaction / layout-quality settings in a UI. Worth
screenshotting their option panel later as a checklist of knobs we
might want — not now, just when next looking at the demo.
