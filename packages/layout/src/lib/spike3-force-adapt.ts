// Spike 3 — force-directed layout via bireactive's constraint cluster.
//
// Same compound graph + same shared renderer as every other tab. Layout:
// spring per edge + repel per pair + gap per pair + softTarget to centre.
// Hulls track their members reactively (Box.derive in hullOf).
//
// Mutations on sharedRows/sharedEdges trigger a full rebuild via effect()
// so the shared toolbar drives this tab too.

import {
  cell,
  type Cell,
  Diagram,
  effect,
  group,
  label,
  type Mount,
  mount,
  type Shape,
  vec,
  type Vec,
  type Writable,
} from "bireactive";
import { animate, gap, physics, pin, repel, softTarget, spring } from "bireactive/constraints";

import {
  containmentForest,
  descendantsOf,
  leafIds,
  rowsById,
  sharedEdges,
  sharedRows,
  items,
  type TreeNode,
} from "./data";
import { hullOf } from "./hull";
import { hullPad, nodeSize, renderEdge, renderHull, renderNode } from "./render";

const W = 720;
const H = 480;
const REST = 100;
const SPRING_K = 600;
const MIN_GAP = 60;
const REPEL_RANGE = 200;
const REPEL_K = 35;
const CENTER_K = 10;

export class MdForceAdapt extends Diagram {
  #teardown: Array<() => void> = [];
  #persist: Array<() => void> = [];
  #positions = new Map<string, Writable<Vec>>();
  #dragging = new Map<string, Writable<Cell<boolean>>>();
  #gfx!: Shape;
  #hullsGfx!: Shape;
  #edgesGfx!: Shape;
  #nodesGfx!: Shape;
  #cx = 0;
  #cy = 0;

  disconnectedCallback(): void {
    for (const d of [...this.#teardown, ...this.#persist]) d();
    this.#teardown = [];
    this.#persist = [];
    super.disconnectedCallback();
  }

  protected scene(s: Mount): void {
    const view = this.view(W, H);
    this.#cx = view.center.value.x;
    this.#cy = view.center.value.y;

    this.#gfx = s(group());
    this.#hullsGfx = group();
    this.#edgesGfx = group();
    this.#nodesGfx = group();
    this.#gfx.add(this.#hullsGfx);
    this.#gfx.add(this.#edgesGfx);
    this.#gfx.add(this.#nodesGfx);

    this.#persist.push(
      effect(() => {
        void sharedRows.cells;
        void sharedEdges.cells;
        this.#buildAll();
      }),
    );

    s(
      label(
        view.bottom.up(10),
        "force via constraints · spring + repel + gap + softTarget",
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

    // Drop positions for removed leaves; seed new ones around the centre.
    for (const id of [...this.#positions.keys()]) {
      if (!live.has(id)) {
        this.#positions.delete(id);
        this.#dragging.delete(id);
      }
    }
    leaves.forEach((id, i) => {
      if (!this.#positions.has(id)) {
        const a = (i / Math.max(1, leaves.length)) * Math.PI * 2;
        const r = 90 + ((i * 13) % 40);
        this.#positions.set(id, vec(this.#cx + r * Math.cos(a), this.#cy + r * Math.sin(a)));
        this.#dragging.set(id, cell(false));
      }
    });

    // Project edges to leaves.
    const leafSet = new Set(leaves);
    const projectTo = (id: string): string | null => {
      if (leafSet.has(id)) return id;
      const ds = [...descendantsOf(sharedRows, id)].filter((d) => leafSet.has(d));
      return ds[0] ?? null;
    };
    const edges: Array<[string, string]> = [];
    for (const e of items(sharedEdges)) {
      const f = projectTo(e.from.value);
      const t = projectTo(e.to.value);
      if (f && t && f !== t) edges.push([f, t]);
    }

    const hullMount = mount(this.#hullsGfx);
    const nodeMount = mount(this.#nodesGfx);
    const edgeMount = mount(this.#edgesGfx);

    // Hulls
    const drawHulls = (nodes: readonly TreeNode[]): void => {
      for (const n of nodes) {
        if (n.children.length === 0) continue;
        const descLeaves = [...descendantsOf(sharedRows, n.id)].filter((id) => leafSet.has(id));
        if (descLeaves.length === 0) continue;
        const positions = descLeaves.map((id) => this.#positions.get(id)!);
        const sizes = descLeaves.map((id) => nodeSize(byId.get(id)?.name.value ?? id));
        const box = hullOf(positions, sizes, hullPad(n.depth));
        renderHull(hullMount, box, n.depth, byId.get(n.id)?.name.value ?? n.id);
        drawHulls(n.children);
      }
    };
    drawHulls(containmentForest(sharedRows));

    // Nodes
    const shapeOf = new Map<string, Shape>();
    for (const id of leaves) {
      const pos = this.#positions.get(id)!;
      const drag = this.#dragging.get(id)!;
      const { shape } = renderNode(nodeMount, pos, {
        label: byId.get(id)?.name.value ?? id,
        draggable: true,
        dragging: drag,
      });
      shapeOf.set(id, shape);
    }

    // Edges
    for (const [a, b] of edges) {
      const sa = shapeOf.get(a);
      const sb = shapeOf.get(b);
      if (sa && sb) renderEdge(edgeMount, sa, sb);
    }

    // Force cluster
    const cluster = physics({ iterations: 12, postStabilize: true, damping: 0.95 });
    for (const [a, b] of edges) {
      cluster.add(spring(this.#positions.get(a)!, this.#positions.get(b)!, REST, SPRING_K));
    }
    const ids = [...leaves];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pi = this.#positions.get(ids[i]!)!;
        const pj = this.#positions.get(ids[j]!)!;
        cluster.add(repel(pi, pj, REPEL_RANGE, REPEL_K));
        cluster.add(gap(pi, pj, MIN_GAP));
      }
    }
    for (const id of ids) {
      cluster.add(softTarget(this.#positions.get(id)!, [this.#cx, this.#cy], CENTER_K));
    }
    for (const id of ids) {
      const drag = this.#dragging.get(id)!;
      cluster.addWhile(drag, pin(this.#positions.get(id)!));
    }

    this.#teardown.push(this.anim.start(animate(cluster)));
  }
}
