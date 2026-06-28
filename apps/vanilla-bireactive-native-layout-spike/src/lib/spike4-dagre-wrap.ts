// Spike 4 — Dagre wrap regime.
//
// Same compound graph as Spikes 1/2/3 (sharedRows + sharedEdges).
// Same renderer. Only the layout algorithm differs: dagre lays out the
// leaves; containers become derived hulls around their members.
//
// Regime under test: PURE WRAP. The layout library knows nothing about
// bireactive; we feed it a snapshot, take positions out, and animate
// the leaf position cells toward them via softTarget.

import dagre from "@dagrejs/dagre";
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
import { renderEdge, renderHull, renderNode } from "./render";
import { measure } from "./measure";
import { applyGroupChrome, type NodeRect } from "./project";

const W = 760;
const H = 500;
const PAD = 24;

interface NodeView {
  pos: Writable<Vec>;
  target: Writable<Vec>;
}

export class MdDagreWrap extends Diagram {
  #teardown: Array<() => void> = [];
  #persist: Array<() => void> = [];
  #nodes = new Map<string, NodeView>();
  // Reactive box per container, written from dagre's compound-subgraph
  // rect output. renderHull reads these; updating them re-paints the
  // panel + chip without re-running #buildAll.
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
      this.anim.start(spring(this.#gfx.scale, this.#fitScale, { omega: 8, zeta: 0.9, precision: 0 })),
      this.anim.start(spring(this.#gfx.translate, this.#fitTranslate, { omega: 8, zeta: 0.9, precision: 0 })),
    );
    this.#hullsGfx = group();
    this.#edgesGfx = group();
    this.#nodesGfx = group();
    this.#gfx.add(this.#hullsGfx);
    this.#gfx.add(this.#edgesGfx);
    this.#gfx.add(this.#nodesGfx);

    this.#persist.push(
      effect(() => {
        void sharedRows.items;
        void sharedEdges.items;
        this.#buildAll();
        this.#applyLayout();
      }),
    );

    s(
      label(
        vec(PAD, H - 14),
        "dagre TB over leaf-induced subgraph · containers derived as hulls · shared renderer",
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
        const p = vec(W / 2, H / 2);
        this.#nodes.set(id, { pos: p, target: vec(W / 2, H / 2) });
      }
    }

    const hullMount = mount(this.#hullsGfx);
    const nodeMount = mount(this.#nodesGfx);
    const edgeMount = mount(this.#edgesGfx);

    // Hulls from #hullBox cells (written by #applyLayout from dagre's
    // compound-subgraph rects, so they don't overlap by construction).
    // Drop any hull boxes for containers that no longer exist.
    const allContainers = new Set<string>();
    for (const r of sharedRows.items) {
      const pid = r.parentId.value;
      if (pid != null) allContainers.add(pid);
    }
    for (const id of [...this.#hullBox.keys()]) {
      if (!allContainers.has(id)) this.#hullBox.delete(id);
    }
    for (const id of allContainers) {
      if (!this.#hullBox.has(id)) this.#hullBox.set(id, box(0, 0, 0, 0));
    }

    const forest = containmentForest(sharedRows);
    const drawHulls = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        if (n.children.length === 0) continue;
        const hullBox = this.#hullBox.get(n.id);
        if (!hullBox) continue;
        renderHull(hullMount, hullBox, n.depth, byId.get(n.id)?.name.value ?? n.id);
        drawHulls(n.children);
      }
    };
    drawHulls(forest);

    // Leaf nodes via shared renderer.
    const shapeOf = new Map<string, Shape>();
    for (const id of leaves) {
      const nv = this.#nodes.get(id)!;
      const row = byId.get(id);
      const { shape } = renderNode(nodeMount, nv.pos, {
        label: row?.name.value ?? id,
        draggable: false,
      });
      shapeOf.set(id, shape);
      this.#teardown.push(
        this.anim.start(spring(nv.pos, nv.target, { omega: 9, zeta: 0.85, precision: 0 })),
      );
    }

    // Edges — same projection as Spike 1: edges to a container route to
    // its first descendant leaf.
    const resolveAnchor = (id: string): Shape | null => {
      if (shapeOf.has(id)) return shapeOf.get(id)!;
      const ds = [...descendantsOf(sharedRows, id)].filter((d) => shapeOf.has(d));
      return ds[0] ? shapeOf.get(ds[0])! : null;
    };
    for (const [u, v] of flatGraph(sharedRows, sharedEdges).edges) {
      const su = resolveAnchor(u);
      const sv = resolveAnchor(v);
      if (su && sv) renderEdge(edgeMount, su, sv);
    }
  }

  #applyLayout(): void {
    const byId = rowsById(sharedRows);
    const leaves = leafIds(sharedRows);
    if (leaves.length === 0) return;

    // Shared footprint snapshot — every engine in this app reads from
    // the same source of truth. Dagre is chrome-blind (no per-subgraph
    // padding), so we declare ONLY leaf sizes here and let `applyGroupChrome`
    // (the project phase) stamp in chip+pad later.
    const measured = measure(sharedRows, sharedEdges);

    // Compound dagre: register every container with setParent so dagre
    // lays out subgraph boxes natively. Edges still go between leaves
    // (cross-containment edges are projected to a descendant leaf so
    // dagre has something to rank against). Compound mode keeps sibling
    // subgraphs disjoint by construction — the visual non-overlap we
    // were faking with hullOf is now a property of the layout itself.
    const leafSet = new Set(leaves);
    const projectTo = (id: string): string | null => {
      if (leafSet.has(id)) return id;
      const ds = [...descendantsOf(sharedRows, id)].filter((d) => leafSet.has(d));
      return ds[0] ?? null;
    };

    const g = new dagre.graphlib.Graph({ compound: true });
    // Tight spacing — compound mode adds its own subgraph padding on top,
    // so keep these small or the whole layout balloons past the viewport.
    g.setGraph({
      rankdir: "TB",
      nodesep: 18,
      ranksep: 30,
      marginx: 8,
      marginy: 8,
      ranker: "tight-tree",
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Register leaves with their measured size (from shared `measure()`).
    for (const id of leaves) {
      const fp = measured.leaves.get(id);
      if (!fp) continue;
      g.setNode(id, { width: fp.w, height: fp.h });
    }
    // Register containers — dagre allocates subgraph rect for these.
    // We give them a small placeholder size; dagre expands to fit kids.
    const containers = new Set<string>();
    for (const r of sharedRows.items) {
      const pid = r.parentId.value;
      if (pid != null) containers.add(pid);
    }
    for (const cid of containers) {
      g.setNode(cid, {});
    }
    // Parent relationships drive subgraph nesting.
    for (const r of sharedRows.items) {
      const pid = r.parentId.value;
      if (pid != null) g.setParent(r.id, pid);
    }
    // Edges (projected onto leaves so endpoints have layout coords).
    for (const e of sharedEdges.items) {
      const f = projectTo(e.from.value);
      const t = projectTo(e.to.value);
      if (f && t && f !== t) g.setEdge(f, t);
    }
    dagre.layout(g);

    // Dagre returns tight subgraph rects (no per-container padding) — it
    // doesn't know about chip headers. Hand the raw rects to the shared
    // project phase, which walks groups deepest-first and stamps in the
    // chrome declared by `measure()`. All constants (chip height, side
    // pad) live in measure.ts — not duplicated here.
    const rectOf: Map<string, NodeRect> = new Map();
    for (const id of leaves) {
      const n = g.node(id);
      if (n) rectOf.set(id, { x: n.x - n.width / 2, y: n.y - n.height / 2, w: n.width, h: n.height });
    }
    for (const cid of containers) {
      const n = g.node(cid);
      if (n) rectOf.set(cid, { x: n.x - n.width / 2, y: n.y - n.height / 2, w: n.width, h: n.height });
    }

    // Child-id index from sharedRows, passed to project phase.
    const childrenOf = new Map<string, string[]>();
    for (const r of sharedRows.items) {
      const pid = r.parentId.value;
      if (pid == null) continue;
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid)!.push(r.id);
    }

    applyGroupChrome({ rectOf, childrenOf, groupIds: containers, measured });

    // Leaf target positions = centre of the (now padded) rect.
    for (const id of leaves) {
      const r = rectOf.get(id);
      const nv = this.#nodes.get(id);
      if (r && nv) nv.target.value = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }
    // Container hull boxes.
    let xmin = Number.POSITIVE_INFINITY;
    let ymin = Number.POSITIVE_INFINITY;
    let xmax = Number.NEGATIVE_INFINITY;
    let ymax = Number.NEGATIVE_INFINITY;
    for (const cid of containers) {
      const r = rectOf.get(cid);
      if (!r) continue;
      const b = this.#hullBox.get(cid);
      if (b) b.value = { ...r };
      xmin = Math.min(xmin, r.x);
      ymin = Math.min(ymin, r.y);
      xmax = Math.max(xmax, r.x + r.w);
      ymax = Math.max(ymax, r.y + r.h);
    }
    for (const id of leaves) {
      const r = rectOf.get(id);
      if (!r) continue;
      xmin = Math.min(xmin, r.x);
      ymin = Math.min(ymin, r.y);
      xmax = Math.max(xmax, r.x + r.w);
      ymax = Math.max(ymax, r.y + r.h);
    }

    // Fit-to-view: scale + translate so the whole compound layout fits
    // inside the viewport with a small margin. Springs animate the
    // transform so adding/removing rows feels continuous.
    const margin = 16;
    const availW = W - 2 * margin;
    const availH = H - 2 * margin - 24;
    const extW = Math.max(1, xmax - xmin);
    const extH = Math.max(1, ymax - ymin);
    const scale = Math.min(1.0, availW / extW, availH / extH);
    this.#fitScale.value = { x: scale, y: scale };
    this.#fitTranslate.value = {
      x: margin + (availW - extW * scale) / 2 - xmin * scale,
      y: margin + (availH - extH * scale) / 2 - ymin * scale,
    };
    if (!this.#fitted) {
      this.#gfx.scale.value = this.#fitScale.peek();
      this.#gfx.translate.value = this.#fitTranslate.peek();
      this.#fitted = true;
    }
  }
}
