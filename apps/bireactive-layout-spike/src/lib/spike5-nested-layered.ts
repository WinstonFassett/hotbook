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
  type Shape,
  spring,
  vec,
  type Vec,
  type Writable,
} from "@bireactive";
import { extent, type Graph, type Placement } from "@bireactive/propagators";
import { layeredTight } from "./layered-tight";

import {
  containmentForest,
  descendantsOf,
  flatGraph,
  leafIds,
  rowsById,
  sharedEdges,
  sharedRows,
  type TreeNode,
} from "./data";
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
}

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
  // Hull box per group — written by the projection walk. Reactive so
  // renderHull repaints when the springs settle.
  #hullBox = new Map<string, Writable<BoxT>>();
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
        void sharedRows.items;
        void sharedEdges.items;
        void sharedSelection.value;
        void direction.value;
        this.#buildAll();
        this.#applyLayout();
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

  #buildAll(): void {
    for (const d of this.#teardown) d();
    this.#teardown = [];
    this.#hullsGfx.clear();
    this.#edgesGfx.clear();
    this.#nodesGfx.clear();

    const byId = rowsById(sharedRows);
    const leaves = leafIds(sharedRows);
    const live = new Set(leaves);

    for (const id of [...this.#nodes.keys()]) {
      if (!live.has(id)) this.#nodes.delete(id);
    }
    for (const id of leaves) {
      if (!this.#nodes.has(id)) {
        this.#nodes.set(id, { pos: vec(W / 2, H / 2), target: vec(W / 2, H / 2) });
      }
    }

    // Reactive hull boxes for each container.
    const allGroups = new Set<string>();
    for (const r of sharedRows.items) {
      const pid = r.parentId.value;
      if (pid != null) allGroups.add(pid);
    }
    for (const id of [...this.#hullBox.keys()]) {
      if (!allGroups.has(id)) this.#hullBox.delete(id);
    }
    for (const id of allGroups) {
      if (!this.#hullBox.has(id)) this.#hullBox.set(id, box(0, 0, 0, 0));
    }

    const sel = sharedSelection.value;

    // Render hulls outermost first so nested ones paint on top.
    const hullMount = mount(this.#hullsGfx);
    const forest = containmentForest(sharedRows);
    const drawHulls = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        if (n.children.length === 0) continue;
        const hb = this.#hullBox.get(n.id);
        if (!hb) continue;
        const shapes = renderHull(hullMount, hb, n.depth, byId.get(n.id)?.name.value ?? n.id);
        // Both the panel rect AND the chip rect select the group, so
        // clicking the label-chip works as expected.
        for (const sh of shapes) markSelectable(sh, "group", n.id, sel);
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
      });
      shapeOf.set(id, shape);
      markSelectable(shape, "node", id, sel);
      this.#teardown.push(
        this.anim.start(spring(nv.pos, nv.target, { omega: 9, zeta: 0.85, precision: 0 })),
      );
    }

    // Edges: render leaf-to-leaf; for endpoints that are containers,
    // route to the first descendant leaf (same projection as spikes 1/4).
    const edgeMount = mount(this.#edgesGfx);
    const resolveAnchor = (id: string): Shape | null => {
      if (shapeOf.has(id)) return shapeOf.get(id)!;
      const ds = [...descendantsOf(sharedRows, id)].filter((d) => shapeOf.has(d));
      return ds[0] ? shapeOf.get(ds[0])! : null;
    };
    for (const e of sharedEdges.items) {
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
    const byId = rowsById(sharedRows);
    const leaves = leafIds(sharedRows);
    if (leaves.length === 0) return;

    const measured: Measured = measure(sharedRows, sharedEdges);

    // Build child-id index from sharedRows.
    const childrenOf = new Map<string | null, string[]>();
    for (const r of sharedRows.items) {
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
    for (const e of sharedEdges.items) {
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
      const place = layeredTight(g, {
        direction: direction.value,
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

    // Write hull boxes (group rects) and leaf targets (centres).
    for (const [id, r] of absRect) {
      if (isGroup(id)) {
        const hb = this.#hullBox.get(id);
        if (hb) hb.value = { x: r.x, y: r.y, w: r.w, h: r.h };
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
