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
import { boxInside, clampInside, pinAxis, rectMinimize, rectNonOverlap, rectsNonOverlap, separation, type SidePad } from "./cola-factories";
import { groupNode, leafNode, type LayoutNode } from "./layout-node";
import { CHIP_HEIGHT_TOTAL, nodeSize, renderEdge, renderHull, renderNode } from "./render";

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

    // ── Build LayoutNode tree ─────────────────────────────────────
    // Every layout participant — leaf or GROUP — gets a LayoutNode with
    // a `footprint` Box that includes ALL the pixels it consumes,
    // chrome included. The constraint system and the renderer both
    // read from the same footprint, so what you see is what was solved
    // for.
    //
    // Uniform leaf half-size approximation — fine for this fixture
    // where all leaves are similar size; the chrome (chipHeight, side,
    // bottom) is the same as renderHull uses (CHIP_HEIGHT_TOTAL).
    const leafHW = 32;
    const leafHH = 16;
    const SIDE_PAD = 12;
    const BOTTOM_PAD = 12;
    const groupChrome = {
      chipHeight: CHIP_HEIGHT_TOTAL,
      sidePad: SIDE_PAD,
      bottomPad: BOTTOM_PAD,
    };
    const inflateOfGroup: SidePad = {
      top: CHIP_HEIGHT_TOTAL,
      bottom: BOTTOM_PAD,
      left: SIDE_PAD,
      right: SIDE_PAD,
    };

    const buildLayoutTree = (treeNodes: TreeNode[]): LayoutNode[] => {
      return treeNodes.map((n) => {
        if (n.children.length === 0) {
          const sz = nodeSize(byId.get(n.id)?.name.value ?? n.id);
          return leafNode(n.id, this.#positions.get(n.id)!, sz);
        }
        return groupNode(n.id, buildLayoutTree(n.children), groupChrome);
      });
    };
    const layoutRoots = buildLayoutTree(containmentForest(sharedRows));

    // ── Rect as first-class solver variable ─────────────────────
    // Each GROUP owns a writable outer Box. The solver moves it
    // directly. Three constraints wire the hierarchy:
    //   1. Sibling outer Boxes can't overlap (rectsNonOverlap).
    //   2. Child outer Box must sit inside parent's content area
    //      (boxInside with chrome inset).
    //   3. Leaves must sit inside their direct parent's content area
    //      (clampInside with leaf half-size).
    // Plus a soft rectMinimize that pulls each outer toward a target
    // size so it doesn't inflate beyond what containment requires.
    const insetForBoxInside: SidePad = {
      top: CHIP_HEIGHT_TOTAL,
      bottom: BOTTOM_PAD,
      left: SIDE_PAD,
      right: SIDE_PAD,
    };
    // Walk and gather all GROUPs with their direct child-GROUPs and
    // direct leaf-children so we can attach the right constraints.
    const allGroups: LayoutNode[] = [];
    const collectGroups = (n: LayoutNode): void => {
      if (n.children.length === 0) return;
      allGroups.push(n);
      for (const c of n.children) collectGroups(c);
    };
    for (const r of layoutRoots) collectGroups(r);

    // (1) Sibling rectsNonOverlap: same-parent pairs at every depth,
    //     plus top-level pairs.
    const walkSibPairs = (nodes: LayoutNode[]): void => {
      const groups = nodes.filter((n) => n.children.length > 0);
      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          cluster.add(rectsNonOverlap(groups[i]!.outer!, groups[j]!.outer!, 8));
        }
      }
      for (const g of groups) walkSibPairs(g.children);
    };
    walkSibPairs(layoutRoots);

    // (2) Nested boxInside: child GROUP outer inside parent content.
    for (const g of allGroups) {
      for (const c of g.children) {
        if (c.outer) {
          cluster.add(boxInside(c.outer, g.outer!, insetForBoxInside));
        }
      }
    }

    // (3) clampInside: each leaf inside its direct-parent GROUP's
    //     content area. Find each leaf's parent GROUP.
    const parentGroupOf = new Map<string, LayoutNode>();
    for (const g of allGroups) {
      for (const c of g.children) parentGroupOf.set(c.id, g);
    }
    for (const id of ids) {
      const parent = parentGroupOf.get(id);
      if (!parent || !parent.outer) continue;
      cluster.add(
        clampInside(this.#positions.get(id)!, parent.outer, leafHW, leafHH),
      );
    }

    // (4) rectMinimize: pull each outer toward a minimal size. Target
    //     = chrome + a small content allowance, so the rect shrinks
    //     until containment pushes back.
    for (const g of allGroups) {
      const minW = 2 * SIDE_PAD + 60;
      const minH = CHIP_HEIGHT_TOTAL + BOTTOM_PAD + 40;
      cluster.add(rectMinimize(g.outer!, minW, minH, 2));
    }

    const collectLeafIdsLocal = (n: LayoutNode): string[] => {
      if (n.children.length === 0) return [n.id];
      const out: string[] = [];
      for (const c of n.children) out.push(...collectLeafIdsLocal(c));
      return out;
    };

    // Anchor top-level GROUPs (not individual leaves) toward viewport
    // centre. Pulling individual leaves to centre would fight the
    // rect-first-class hierarchy — leaves' positions are now determined
    // by their parent GROUP's content area via clampInside, so the
    // anchor must operate at the GROUP level. Using softTarget on the
    // outer Box's centre requires a position-from-Box adapter; instead
    // we just softly pull a representative leaf per top-level GROUP
    // and let the rest of the GROUP follow via spring/repel/clamp.
    for (const root of layoutRoots) {
      if (root.children.length === 0) continue;
      // Pull every leaf in the top-level GROUP toward viewport centre.
      // The GROUP rect follows (via clampInside) and stays anchored.
      // Stiffness matched to per-leaf scale so leaves don't all clump
      // at the centre point — repel + non-overlap balance the spread.
      const allLeaves = collectLeafIdsLocal(root);
      for (const id of allLeaves) {
        cluster.add(softTarget(this.#positions.get(id)!, [this.#cx, this.#cy], 6));
      }
    }

    // Topological source pinning: keep things with no incoming edges
    // near the top of their region. Lighter stiffness so it doesn't
    // override the GROUP hierarchy.
    const incoming = new Map<string, number>();
    for (const id of ids) incoming.set(id, 0);
    for (const [, t] of edges) incoming.set(t, (incoming.get(t) ?? 0) + 1);
    for (const id of ids) {
      if ((incoming.get(id) ?? 0) === 0) {
        cluster.add(pinAxis(this.#positions.get(id)!, "y", this.#cy - 160, 20));
      }
    }

    // ── render ────────────────────────────────────────────────────
    const hullMount = mount(this.#hullsGfx);
    const nodeMount = mount(this.#nodesGfx);
    const edgeMount = mount(this.#edgesGfx);

    // Hulls render directly from each GROUP LayoutNode's footprint.
    // Same Box the constraint system used → chip and body sit exactly
    // where the layout solved for them.
    const drawHulls = (nodes: LayoutNode[], depth: number): void => {
      for (const n of nodes) {
        if (n.children.length === 0) continue;
        renderHull(hullMount, n.footprint, depth, byId.get(n.id)?.name.value ?? n.id);
        drawHulls(n.children, depth + 1);
      }
    };
    drawHulls(layoutRoots, 0);

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
