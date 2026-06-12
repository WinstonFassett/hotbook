// Spike 2 — IPSepCoLa-style adapt skeleton.
//
// Same compound graph + shared renderer as every other tab. Layout: AVBD
// constraint cluster with two CoLa-specific factories from
// lib/cola-factories.ts:
//
//   separation(a, b, axis, gap) — axis-aligned hard inequality
//   rectNonOverlap(a, b, hw, hh) — AABB hard non-overlap
//
// Plus spring per graph edge, repel for cluster spread, softTarget to
// keep the blob centred, and pinAxis(y) on topological sources so the
// cluster has a global up direction.
//
// Mutations on sharedRows/sharedEdges trigger a full rebuild via effect().

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
} from "@bireactive";
import { animate, physics, pin, repel, softTarget, spring } from "@bireactive/constraints";

import {
  containmentForest,
  descendantsOf,
  leafIds,
  rowsById,
  sharedEdges,
  sharedRows,
  type TreeNode,
} from "./data";
import { pinAxis, rectNonOverlap, separation } from "./cola-factories";
import { hullOf } from "./hull";
import { hullPad, nodeSize, renderEdge, renderHull, renderNode } from "./render";

const W = 760;
const H = 500;

export class MdColaAdapt extends Diagram {
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
        void sharedRows.items;
        void sharedEdges.items;
        this.#buildAll();
      }),
    );

    s(
      label(
        view.bottom.up(10),
        "spring + repel + separation(y) + rectNonOverlap + softTarget — IPSepCoLa vocabulary on AVBD",
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

    for (const id of [...this.#positions.keys()]) {
      if (!live.has(id)) {
        this.#positions.delete(id);
        this.#dragging.delete(id);
      }
    }
    for (const id of leaves) {
      if (!this.#positions.has(id)) {
        const depth = depthOfRow(id);
        const jitter = ((id.charCodeAt(0) * 53) % 80) - 40;
        this.#positions.set(id, vec(this.#cx + jitter, this.#cy - 140 + depth * 70));
        this.#dragging.set(id, cell(false));
      }
    }

    // Project edges to leaves.
    const leafSet = new Set(leaves);
    const projectTo = (id: string): string | null => {
      if (leafSet.has(id)) return id;
      const ds = [...descendantsOf(sharedRows, id)].filter((d) => leafSet.has(d));
      return ds[0] ?? null;
    };
    const edges: Array<[string, string]> = [];
    for (const e of sharedEdges.items) {
      const f = projectTo(e.from.value);
      const t = projectTo(e.to.value);
      if (f && t && f !== t) edges.push([f, t]);
    }

    const cluster = physics({ iterations: 12, postStabilize: true, damping: 0.93 });

    for (const [a, b] of edges) {
      cluster.add(spring(this.#positions.get(a)!, this.#positions.get(b)!, 80, 500));
    }

    const ids = [...leaves];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        cluster.add(
          repel(this.#positions.get(ids[i]!)!, this.#positions.get(ids[j]!)!, 160, 22),
        );
      }
    }

    for (const [a, b] of edges) {
      cluster.add(separation(this.#positions.get(a)!, this.#positions.get(b)!, "y", 50));
    }

    for (let i = 0; i < ids.length; i++) {
      const sa = nodeSize(byId.get(ids[i]!)?.name.value ?? ids[i]!);
      for (let j = i + 1; j < ids.length; j++) {
        const sb = nodeSize(byId.get(ids[j]!)?.name.value ?? ids[j]!);
        const hw = Math.max(sa.w, sb.w) / 2 + 2;
        const hh = Math.max(sa.h, sb.h) / 2 + 2;
        cluster.add(
          rectNonOverlap(this.#positions.get(ids[i]!)!, this.#positions.get(ids[j]!)!, hw, hh),
        );
      }
    }

    for (const id of ids) {
      cluster.add(softTarget(this.#positions.get(id)!, [this.#cx, this.#cy], 6));
    }

    const incoming = new Map<string, number>();
    for (const id of ids) incoming.set(id, 0);
    for (const [, t] of edges) incoming.set(t, (incoming.get(t) ?? 0) + 1);
    for (const id of ids) {
      if ((incoming.get(id) ?? 0) === 0) {
        cluster.add(pinAxis(this.#positions.get(id)!, "y", this.#cy - 160, 80));
      }
    }

    // ── render ────────────────────────────────────────────────────
    const hullMount = mount(this.#hullsGfx);
    const nodeMount = mount(this.#nodesGfx);
    const edgeMount = mount(this.#edgesGfx);

    const drawHulls = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        if (n.children.length === 0) continue;
        const descLeaves = [...descendantsOf(sharedRows, n.id)].filter((id) => leafSet.has(id));
        if (descLeaves.length === 0) continue;
        const positions = descLeaves.map((id) => this.#positions.get(id)!);
        const sizes = descLeaves.map((id) => nodeSize(byId.get(id)?.name.value ?? id));
        const hullBox = hullOf(positions, sizes, hullPad(n.depth));
        renderHull(hullMount, hullBox, n.depth, byId.get(n.id)?.name.value ?? n.id);
        drawHulls(n.children);
      }
    };
    drawHulls(containmentForest(sharedRows));

    const shapeOf = new Map<string, Shape>();
    for (const id of ids) {
      const pos = this.#positions.get(id)!;
      const drag = this.#dragging.get(id)!;
      const { shape } = renderNode(nodeMount, pos, {
        label: byId.get(id)?.name.value ?? id,
        draggable: true,
        dragging: drag,
      });
      shapeOf.set(id, shape);
      cluster.addWhile(drag, pin(pos));
    }

    for (const [a, b] of edges) {
      const sa = shapeOf.get(a);
      const sb = shapeOf.get(b);
      if (sa && sb) renderEdge(edgeMount, sa, sb);
    }

    this.#teardown.push(this.anim.start(animate(cluster)));
  }
}

function depthOfRow(id: string): number {
  let cur: string | null = id;
  let d = 0;
  const byId = rowsById(sharedRows);
  while (cur != null && d < 32) {
    const row = byId.get(cur);
    if (!row) break;
    const pid = row.parentId.value;
    if (pid == null) return d;
    d++;
    cur = pid;
  }
  return d;
}
