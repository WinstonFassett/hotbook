// Spike 1 — compound graph via propagator-Sugiyama.
//
// Two tables: sharedRows (containment, arbitrarily nested) + sharedEdges
// (cross-containment graph edges). Layout strategy: rank() + layered()
// position only the LEAF nodes from the row table; containers are
// derived as reactive hulls around the bounding box of their descendant
// leaves. Edges connect any two rows regardless of containment depth.
//
// Drag-to-reparent (the button) writes row.parentId — the layout
// re-derives, hulls shift to track membership, springs animate.

import {
  arrow,
  Diagram,
  effect,
  group,
  label,
  type Mount,
  mount,
  rect,
  type Shape,
  spring,
  vec,
} from "@bireactive";
import { extent, type Graph, layered, type Placement, rank } from "@bireactive/propagators";

import {
  containmentForest,
  descendantsOf,
  flatGraph,
  leafIds,
  type Row,
  rowsById,
  sharedEdges,
  sharedRows,
  type TreeNode,
} from "./data";
import { hullOf, type Size } from "./hull";
import { hullPad, renderHull } from "./render";

const sizeOf = (id: string, byId: Map<string, Row>): Size => {
  const name = byId.get(id)?.name.value ?? id;
  return { w: Math.max(58, name.length * 8 + 22), h: 28 };
};

const W = 760;
const H = 500;
const TOP = 60;
const PADX = 24;
const BOTTOM = 28;

interface NodeView {
  pos: ReturnType<typeof vec>;
  target: ReturnType<typeof vec>;
}

export class MdPropSugiyama extends Diagram {
  #teardown: Array<() => void> = [];
  #persist: Array<() => void> = [];
  #nodes = new Map<string, NodeView>();
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

    // Rebuild whenever the shared Colls change. effect() tracks
    // sharedRows.items / sharedEdges.items reads inside #buildAll +
    // #applyLayout — any mutation from the shared toolbar fires here.
    this.#persist.push(
      effect(() => {
        // touch both so the effect tracks both
        void sharedRows.items;
        void sharedEdges.items;
        this.#buildAll();
        this.#applyLayout();
      }),
    );

    s(
      label(
        vec(PADX, H - BOTTOM + 8),
        "compound graph: parentId column → nested hulls · sharedEdges → cross-containment arrows · rank() lays out leaves",
        { size: 10, fill: "var(--text-secondary)" },
      ),
    );
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
        const pos = vec(W / 2 + (Math.random() - 0.5) * 20, H / 2 + (Math.random() - 0.5) * 20);
        this.#nodes.set(id, { pos, target: vec(W / 2, H / 2) });
      }
    }

    // Containers (rows with children) get derived hulls. Render hulls in
    // depth order so outer containers sit beneath inner ones.
    const forest = containmentForest(sharedRows);
    const drawHulls = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        if (n.children.length === 0) continue;
        const descendantLeaves = [...descendantsOf(sharedRows, n.id)].filter((id) =>
          live.has(id),
        );
        if (descendantLeaves.length === 0) continue;
        const hullBox = hullOf(
          descendantLeaves.map((id) => this.#nodes.get(id)!.pos),
          descendantLeaves.map((id) => sizeOf(id, byId)),
          hullPad(n.depth),
        );
        renderHull(mount(this.#hullsGfx), hullBox, n.depth, byId.get(n.id)?.name.value ?? n.id);
        drawHulls(n.children);
      }
    };
    drawHulls(forest);

    // Leaf node shapes — fresh every rebuild so we never bind to a
    // stale pos cell after a node was removed-then-recreated.
    const shapeOf = new Map<string, Shape>();
    for (const id of leaves) {
      const nv = this.#nodes.get(id)!;
      const sz = sizeOf(id, byId);
      shapeOf.set(
        id,
        rect(nv.pos, sz.w, sz.h, {
          fill: "var(--accent)",
          stroke: "var(--text-color)",
          thin: true,
          corner: 6,
          opacity: 0.9,
        }),
      );
    }

    // Edges connect ANY two nodes by id. If the endpoint is a container
    // (non-leaf), edge goes to its hull center — approximated by routing
    // to the first descendant leaf with a position. (Better: anchor on
    // the hull boundary; that's a follow-up.)
    const resolveAnchor = (id: string): Shape | null => {
      if (shapeOf.has(id)) return shapeOf.get(id)!;
      const descLeaves = [...descendantsOf(sharedRows, id)].filter((d) => shapeOf.has(d));
      if (descLeaves.length === 0) return null;
      return shapeOf.get(descLeaves[0]!) ?? null;
    };
    for (const [u, v] of flatGraph(sharedRows, sharedEdges).edges) {
      const su = resolveAnchor(u);
      const sv = resolveAnchor(v);
      if (su && sv) this.#edgesGfx.add(arrow(su, sv, { thin: true, opacity: 0.65 }));
    }

    // Leaf rendering: rect + label, position-spring.
    for (const id of leaves) {
      const nv = this.#nodes.get(id)!;
      this.#nodesGfx.add(
        shapeOf.get(id)!,
        label(nv.pos, byId.get(id)?.name.value ?? id, { size: 11, bold: true, fill: "white" }),
      );
      this.#teardown.push(
        this.anim.start(spring(nv.pos, nv.target, { omega: 9, zeta: 0.85, precision: 0 })),
      );
    }
  }

  #applyLayout(): void {
    const byId = rowsById(sharedRows);
    const leaves = leafIds(sharedRows);
    if (leaves.length === 0) return;
    // Sugiyama on the leaf-induced subgraph. Edges that target a
    // container are projected to that container's first descendant leaf
    // (same as #buildAll's resolveAnchor). For more idiomatic compound
    // layered layout we'd do per-container rank, then nest; out of
    // scope for the spike.
    const leafSet = new Set(leaves);
    const projectedEdges: Array<[string, string]> = [];
    const projectTo = (id: string): string | null => {
      if (leafSet.has(id)) return id;
      const ds = [...descendantsOf(sharedRows, id)].filter((d) => leafSet.has(d));
      return ds[0] ?? null;
    };
    for (const e of sharedEdges.items) {
      const f = projectTo(e.from.value);
      const t = projectTo(e.to.value);
      if (f && t && f !== t) projectedEdges.push([f, t]);
    }
    const g: Graph<string> = { nodes: leaves, edges: projectedEdges };
    rank(g);
    const place: Map<string, Placement> = layered(g, {
      direction: "TB",
      sizeOf: (id) => sizeOf(id, byId),
      layerGap: 80,
      nodeGap: 32,
    });
    const ext = extent(place);
    const availW = W - 2 * PADX;
    const availH = H - TOP - BOTTOM;
    const scale = Math.min(1.0, availW / Math.max(1, ext.w), availH / Math.max(1, ext.h));
    this.#fitScale.value = { x: scale, y: scale };
    this.#fitTranslate.value = {
      x: PADX + (availW - ext.w * scale) / 2,
      y: TOP + (availH - ext.h * scale) / 2,
    };
    if (!this.#fitted) {
      this.#gfx.scale.value = this.#fitScale.peek();
      this.#gfx.translate.value = this.#fitTranslate.peek();
      this.#fitted = true;
    }
    for (const [n, p] of place) {
      const nv = this.#nodes.get(n);
      if (nv) nv.target.value = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
    }
  }
}

