// Spike 5 — nested-layered (recursive solveGroup).
//
// The bireactive "layered() applied to itself" pattern, from
// inspo/bireactive/site/elements/md-subgraphs.ts, generalized to arbitrary
// nesting depth. Each group runs its own `layered()` solve over its
// direct children; child groups appear to the parent solve as opaque
// rectangles sized by their (already-solved) inner extent + chrome.
//
// No compound engine. No post-process. The same primitive at every
// level. Containment is honest by construction — children's rects are
// laid out inside the parent's solve area; the chip-header pad is
// declared up front via `measured.groups[g].pad`, not patched in after.
//
// Cross-containment edges (e.g. auth → users where their LCA is the
// root) currently render leaf-to-leaf but DO NOT influence layout at
// any level except the LCA. A future iteration could add boundary-pull
// constraints per crossed layer.

import {
  box,
  type Box as BoxT,
  Diagram,
  effect,
  group,
  label,
  type Mount,
  mount,
  num,
  type Num,
  type Shape,
  spring,
  vec,
  type Vec,
  type Writable,
} from "bireactive";
import { extent, type Graph, type Placement } from "bireactive/propagators";
import { layeredTight } from "./layered-tight";

import {
  containmentForest,
  descendantsOf,
  flatGraph,
  leafIds,
  rowsById,
  items,
  type TreeNode,
} from "./data";
import { getLayoutRows, getLayoutEdges } from "./data-registry";
import { direction } from "./diagram-settings";
import { measure, type Measured } from "./measure";
import { FONT_PX, renderEdgeStyled, renderHull, renderNode } from "./render";
import { sharedSelection, select, clearSelection, type Selection } from "./selection";

const W = 760;
const H = 540;
const PADX = 24;
const TOP = 24;
const BOTTOM = 28;

interface NodeView {
  pos: Writable<Vec>;
  target: Writable<Vec>;
  /** 0..1 enter-scale. Springs from 0 → 1 on first appearance so leaves
   *  grow in place rather than fly from a fixed seed point. */
  scale: Writable<Num>;
}

interface HullView {
  /** Live (animated) hull rect. Read by renderHull. */
  box: Writable<BoxT>;
  /** Layout-computed target. #applyLayout writes here; a spring pulls
   *  `box` toward it for FLIP-like motion across re-layouts. */
  target: Writable<BoxT>;
  /** 0..1 entry fade — springs 0 → 1 on first appearance. */
  opacity: Writable<Num>;
}

// Spring tunings. Position spring matches the existing leaf-pos spring
// so FLIP-style hull motion feels consistent. Scale/opacity are snappier
// per user request — if grow-in reads too aggressive, swap to POS_SPRING.
const POS_SPRING = { omega: 9, zeta: 0.85, precision: 0 } as const;
const ENTRY_SPRING = { omega: 14, zeta: 0.9, precision: 0 } as const;

interface SolveResult {
  /** Placements of each direct child of g, in g's local frame.
   *  Local frame origin = (0, 0) at top-left of g's interior (after pad). */
  inner: Map<string, Placement>;
  /** Inner extent — width/height of the bounding box of `inner`. */
  innerSize: { w: number; h: number };
  /** Full size of g as a "fat node" to its parent = innerSize + chrome. */
  size: { w: number; h: number };
}

export class MdNestedLayered extends Diagram {
  #teardown: Array<() => void> = [];
  #persist: Array<() => void> = [];
  #nodes = new Map<string, NodeView>();
  // Hull state per group. `target` is what #applyLayout writes; `box`
  // animates toward it via a spring; `opacity` fades in on first appear.
  #hulls = new Map<string, HullView>();
  #gfx!: Shape;
  #hullsGfx!: Shape;
  #edgesGfx!: Shape;
  #nodesGfx!: Shape;
  #fitScale = vec(1, 1);
  #fitTranslate = vec(0, 0);
  #fitted = false;

  disconnectedCallback(): void {
    for (const d of [...this.#teardown, ...this.#persist]) d();
    this.#teardown = [];
    this.#persist = [];
    super.disconnectedCallback();
  }

  protected scene(s: Mount): void {
    this.view(W, H);
    this.#gfx = s(group());
    this.#persist.push(
      this.anim.start(
        spring(this.#gfx.scale, this.#fitScale, { omega: 8, zeta: 0.9, precision: 0 }),
      ),
      this.anim.start(
        spring(this.#gfx.translate, this.#fitTranslate, { omega: 8, zeta: 0.9, precision: 0 }),
      ),
    );
    this.#hullsGfx = group();
    this.#edgesGfx = group();
    this.#nodesGfx = group();
    this.#gfx.add(this.#hullsGfx, this.#edgesGfx, this.#nodesGfx);

    this.#persist.push(
      effect(() => {
        const rows = items(getLayoutRows());
        void getLayoutEdges().cells;
        void sharedSelection.value;
        void direction.value;
        // Subscribe to per-row direction so layout reflows when the
        // sidebar toggles a group's direction override.
        for (const r of rows) void r.direction.value;
        this.#syncMaps();
        this.#applyLayout();
        this.#buildAll();
      }),
    );

    s(
      label(
        vec(PADX, H - 14),
        "layered() solved per group, recursively · child groups appear as fat nodes to parent solve · same primitive at every level",
        { size: 10, fill: "var(--text-secondary)" },
      ),
    );

    // Click on empty diagram surface = deselect. Handlers on shapes
    // call stopPropagation so this only fires when nothing was hit.
    const onBgClick = (): void => clearSelection();
    this.addEventListener("click", onBgClick);
    this.#persist.push(() => this.removeEventListener("click", onBgClick));
  }

  /** Track ids that are newly inserted this re-build, so #buildAll can
   *  seed their visible pos/box from the freshly-computed target after
   *  #applyLayout runs. Cleared at the end of #buildAll. */
  #newLeaves = new Set<string>();
  #newHulls = new Set<string>();

  /** Phase 1: reconcile the node/hull maps to match the live row set.
   *  Runs BEFORE #applyLayout so layout can read every leaf's target
   *  cell. New entries get placeholder targets — #buildAll seeds the
   *  visible pos/box from those targets after layout writes them. */
  #syncMaps(): void {
    const leaves = leafIds(getLayoutRows());
    const live = new Set(leaves);
    for (const id of [...this.#nodes.keys()]) {
      if (!live.has(id)) this.#nodes.delete(id);
    }
    this.#newLeaves.clear();
    for (const id of leaves) {
      if (!this.#nodes.has(id)) {
        // Placeholder pos; #buildAll will rewrite it to the target
        // computed by #applyLayout so the node grows in place.
        this.#nodes.set(id, {
          pos: vec(0, 0),
          target: vec(0, 0),
          scale: num(0),
        });
        this.#newLeaves.add(id);
      }
    }

    const allGroups = new Set<string>();
    for (const r of items(getLayoutRows())) {
      const pid = r.parentId.value;
      if (pid != null) allGroups.add(pid);
    }
    for (const id of [...this.#hulls.keys()]) {
      if (!allGroups.has(id)) this.#hulls.delete(id);
    }
    this.#newHulls.clear();
    for (const id of allGroups) {
      if (!this.#hulls.has(id)) {
        this.#hulls.set(id, {
          box: box(0, 0, 0, 0),
          target: box(0, 0, 0, 0),
          opacity: num(0),
        });
        this.#newHulls.add(id);
      }
    }
  }

  #buildAll(): void {
    for (const d of this.#teardown) d();
    this.#teardown = [];
    this.#hullsGfx.clear();
    this.#edgesGfx.clear();
    this.#nodesGfx.clear();

    const byId = rowsById(getLayoutRows());
    const leaves = leafIds(getLayoutRows());

    // Seed entering leaves: visible pos starts AT the target so the
    // rect grows in place via the scale spring (instead of flying in
    // from a fixed seed point). For existing leaves, pos stays where
    // the position spring last left it so re-layout keeps animating
    // smoothly from the prior position.
    for (const id of this.#newLeaves) {
      const nv = this.#nodes.get(id);
      if (nv) nv.pos.value = nv.target.peek();
    }
    // Same for entering hulls: snap visible box to target so the panel
    // fades in at its final position (no FLIP from origin).
    for (const id of this.#newHulls) {
      const hv = this.#hulls.get(id);
      if (hv) hv.box.value = hv.target.peek();
    }

    const sel = sharedSelection.value;

    // Render hulls outermost first so nested ones paint on top.
    const hullMount = mount(this.#hullsGfx);
    const forest = containmentForest(getLayoutRows());
    const drawHulls = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        if (n.children.length === 0) continue;
        const hv = this.#hulls.get(n.id);
        if (!hv) continue;
        const shapes = renderHull(
          hullMount,
          hv.box,
          n.depth,
          byId.get(n.id)?.name.value ?? n.id,
          hv.opacity,
        );
        // Both the panel rect AND the chip rect select the group, so
        // clicking the label-chip works as expected.
        for (const sh of shapes) markSelectable(sh, "group", n.id, sel);
        // FLIP-like: spring `box` toward `target` so re-layouts animate.
        this.#teardown.push(
          this.anim.start(spring(hv.box, hv.target, POS_SPRING)),
        );
        // Entry fade — pulls toward 1. For existing hulls opacity is
        // already 1 so this is a no-op spring; cheap.
        this.#teardown.push(
          this.anim.start(spring(hv.opacity, 1, ENTRY_SPRING)),
        );
        drawHulls(n.children);
      }
    };
    drawHulls(forest);

    // Leaf nodes via the shared renderer + spring.
    const nodeMount = mount(this.#nodesGfx);
    const shapeOf = new Map<string, Shape>();
    for (const id of leaves) {
      const nv = this.#nodes.get(id)!;
      const { shape } = renderNode(nodeMount, nv.pos, {
        label: byId.get(id)?.name.value ?? id,
        draggable: false,
        scale: nv.scale,
      });
      shapeOf.set(id, shape);
      markSelectable(shape, "node", id, sel);
      this.#teardown.push(
        this.anim.start(spring(nv.pos, nv.target, POS_SPRING)),
        this.anim.start(spring(nv.scale, 1, ENTRY_SPRING)),
      );
    }

    this.#newLeaves.clear();
    this.#newHulls.clear();

    // Edges: render leaf-to-leaf; for endpoints that are containers,
    // route to the first descendant leaf (same projection as spikes 1/4).
    const edgeMount = mount(this.#edgesGfx);
    const resolveAnchor = (id: string): Shape | null => {
      if (shapeOf.has(id)) return shapeOf.get(id)!;
      const ds = [...descendantsOf(getLayoutRows(), id)].filter((d) => shapeOf.has(d));
      return ds[0] ? shapeOf.get(ds[0])! : null;
    };
    for (const e of items(getLayoutEdges())) {
      const u = e.from.value;
      const v = e.to.value;
      const su = resolveAnchor(u);
      const sv = resolveAnchor(v);
      if (su && sv) {
        const a = renderEdgeStyled(edgeMount, su, sv, e.label);
        markSelectable(a, "edge", e.id, sel);
      }
    }
  }

  #applyLayout(): void {
    const byId = rowsById(getLayoutRows());
    const leaves = leafIds(getLayoutRows());
    if (leaves.length === 0) return;

    const measured: Measured = measure(getLayoutRows(), getLayoutEdges());

    // Build child-id index from getLayoutRows().
    const childrenOf = new Map<string | null, string[]>();
    for (const r of items(getLayoutRows())) {
      const pid = r.parentId.value;
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid)!.push(r.id);
    }
    const isGroup = (id: string): boolean => measured.groups.has(id);

    // edgesWithinGroup[g] = all edges whose endpoints' LCA is exactly g.
    // For nesting, we lift each edge to the LCA's level: the edge between
    // u and v contributes an edge at LCA(u,v), routed between the direct
    // children of LCA that contain u and v respectively.
    //
    // Example: edge (auth in frontend, users in services in backend) →
    //   LCA = root (null). Edge contributes at root level between
    //   "frontend" and "backend" (the direct children of root carrying
    //   each endpoint).
    const parentOf = (id: string): string | null =>
      byId.get(id)?.parentId.value ?? null;
    const ancestorsOf = (id: string): string[] => {
      const chain: string[] = [];
      let cur: string | null = id;
      while (cur != null) {
        chain.push(cur);
        cur = parentOf(cur);
      }
      return chain;
    };
    const lca = (a: string, b: string): string | null => {
      const A = new Set(ancestorsOf(a));
      for (const x of ancestorsOf(b)) if (A.has(x)) return x;
      return null;
    };
    // Find which direct child of `g` contains `id` (could be `id` itself).
    const childOfAt = (g: string | null, id: string): string | null => {
      let cur: string | null = id;
      while (cur != null && parentOf(cur) !== g) cur = parentOf(cur);
      return cur;
    };

    const edgesAtLevel = new Map<string | null, Array<[string, string]>>();
    for (const e of items(getLayoutEdges())) {
      const u = e.from.value;
      const v = e.to.value;
      const L = lca(u, v); // null = root
      const cu = childOfAt(L, u);
      const cv = childOfAt(L, v);
      if (cu == null || cv == null || cu === cv) continue;
      if (!edgesAtLevel.has(L)) edgesAtLevel.set(L, []);
      edgesAtLevel.get(L)!.push([cu, cv]);
    }

    // Recursive solve. `groupId === null` means the synthetic root level
    // (top-level rows treated as siblings under no parent).
    const solveResult = new Map<string | null, SolveResult>();
    const solveGroup = (groupId: string | null): SolveResult => {
      if (solveResult.has(groupId)) return solveResult.get(groupId)!;
      const kids = childrenOf.get(groupId) ?? [];
      // Recurse into child groups first so their `size` is known when we
      // hand them to layered() as opaque nodes.
      for (const k of kids) if (isGroup(k)) solveGroup(k);

      const sizeOf = (id: string): { w: number; h: number } => {
        if (isGroup(id)) {
          const sr = solveResult.get(id)!;
          return sr.size;
        }
        const fp = measured.leaves.get(id);
        return fp ? { w: fp.w, h: fp.h } : { w: 56, h: 28 };
      };

      const g: Graph<string> = {
        nodes: kids,
        edges: edgesAtLevel.get(groupId) ?? [],
      };
      // `layeredTight` is our local fork of inspo's `layered()` with
      // per-pair layer spacing. A giant solved-group rect next to a
      // single leaf would otherwise force every pair of layers in this
      // group apart by the giant's height; tight spacing only does
      // that for the one pair that actually needs it.
      // Resolve direction for this group: walk up parent chain to find
      // the nearest explicit per-group direction; fall back to the
      // diagram-level default. Root (null groupId) always uses default.
      const resolveDir = (id: string | null): "TB" | "LR" => {
        let cur: string | null = id;
        while (cur != null) {
          const explicit = byId.get(cur)?.direction.value;
          if (explicit != null) return explicit;
          cur = byId.get(cur)?.parentId.value ?? null;
        }
        return direction.value;
      };
      const place = layeredTight(g, {
        direction: resolveDir(groupId),
        sizeOf,
        layerPad: 40,
        nodeGap: 28,
      });
      const innerSize = extent(place);

      // Wrap with this group's chrome (chip pad). The root has no chrome.
      let size: { w: number; h: number };
      if (groupId == null) {
        size = innerSize;
      } else {
        const fp = measured.groups.get(groupId)!;
        size = {
          w: Math.max(fp.minInner.w, innerSize.w) + fp.pad.left + fp.pad.right,
          h: Math.max(fp.minInner.h, innerSize.h) + fp.pad.top + fp.pad.bottom,
        };
      }

      const result: SolveResult = { inner: place, innerSize, size };
      solveResult.set(groupId, result);
      return result;
    };
    solveGroup(null);

    // Project absolutely. Root solve's `inner` positions are already in
    // root's local frame (0..size). Walk top-down: a child's absolute
    // origin = parent's absolute origin + parent's pad-top-left + child's
    // local placement.x/y from parent's inner solve.
    const absRect = new Map<string, { x: number; y: number; w: number; h: number }>();
    const placeChildren = (groupId: string | null, originX: number, originY: number): void => {
      const sr = solveResult.get(groupId);
      if (!sr) return;
      let interiorX = originX;
      let interiorY = originY;
      if (groupId != null) {
        const fp = measured.groups.get(groupId)!;
        interiorX = originX + fp.pad.left;
        interiorY = originY + fp.pad.top;
      }
      for (const [childId, p] of sr.inner) {
        const cx = interiorX + p.x;
        const cy = interiorY + p.y;
        absRect.set(childId, { x: cx, y: cy, w: p.w, h: p.h });
        if (isGroup(childId)) placeChildren(childId, cx, cy);
      }
    };
    placeChildren(null, 0, 0);

    // Write hull targets (group rects) and leaf targets (centres).
    // The visible `hv.box` is a separate signal that the spring in
    // #buildAll pulls toward `hv.target` — FLIP across re-layouts.
    for (const [id, r] of absRect) {
      if (isGroup(id)) {
        const hv = this.#hulls.get(id);
        if (hv) hv.target.value = { x: r.x, y: r.y, w: r.w, h: r.h };
      } else {
        const nv = this.#nodes.get(id);
        if (nv) nv.target.value = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      }
    }

    // Fit-to-view: scale + translate so the whole compound layout fits.
    // Em-based max-zoom: cap so that the leaf font (FONT_PX) never renders
    // larger than MAX_READABLE_PX on screen. Small graphs zoom up to
    // readable; larger ones stay <=1.0 and fit.
    const rootSize = solveResult.get(null)!.size;
    const margin = 16;
    const availW = W - 2 * margin;
    const availH = H - 2 * margin - 24;
    const MAX_READABLE_PX = 24;
    const MAX_ZOOM = MAX_READABLE_PX / FONT_PX;
    const scale = Math.min(
      MAX_ZOOM,
      availW / Math.max(1, rootSize.w),
      availH / Math.max(1, rootSize.h),
    );
    this.#fitScale.value = { x: scale, y: scale };
    this.#fitTranslate.value = {
      x: margin + (availW - rootSize.w * scale) / 2,
      y: margin + (availH - rootSize.h * scale) / 2,
    };
    if (!this.#fitted) {
      this.#gfx.scale.value = this.#fitScale.peek();
      this.#gfx.translate.value = this.#fitTranslate.peek();
      this.#fitted = true;
    }
  }
}

// Wire a shape as a click-to-select target. Sets the cursor, calls
// `select(kind,id)` and stops propagation so the diagram-level
// background-click handler doesn't immediately clear. When the shape
// is currently selected, paint a stroke ring via CSS-var overrides
// (refined later via theme.css).
function markSelectable(
  shape: Shape,
  kind: Selection["kind"],
  id: string,
  current: Selection | null,
): void {
  const el = (shape as unknown as { el?: SVGElement }).el;
  if (!el) return;
  el.style.cursor = "pointer";
  el.dataset.selectable = kind;
  el.dataset.selectId = id;
  const isSelected = current && current.kind === kind && current.id === id;
  if (isSelected) {
    el.dataset.selected = "true";
    // Provisional visual: bold accent ring + glow. Refine via theme later.
    el.setAttribute("stroke", "#f59e0b");
    el.setAttribute("stroke-width", "2.5");
    el.style.filter = "drop-shadow(0 0 4px rgba(245,158,11,0.6))";
  } else {
    // Hover affordance. CSS inside shadow root can't reach here from
    // the global theme.css, so wire it inline.
    const origStroke = el.getAttribute("stroke");
    const origWidth = el.getAttribute("stroke-width");
    const origFilter = el.style.filter;
    el.addEventListener("mouseenter", () => {
      el.setAttribute("stroke", "#fbbf24");
      el.setAttribute("stroke-width", "1.5");
      el.style.filter = "drop-shadow(0 0 2px rgba(251,191,36,0.6))";
    });
    el.addEventListener("mouseleave", () => {
      if (origStroke != null) el.setAttribute("stroke", origStroke);
      else el.removeAttribute("stroke");
      if (origWidth != null) el.setAttribute("stroke-width", origWidth);
      else el.removeAttribute("stroke-width");
      el.style.filter = origFilter;
    });
  }
  el.addEventListener("click", (e: Event) => {
    e.stopPropagation();
    select(kind, id);
  });
}
