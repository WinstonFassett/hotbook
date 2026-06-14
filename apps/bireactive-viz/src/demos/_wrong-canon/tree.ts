// Tree — bireactive port of LayerChart's <Tree> shape (d3-hierarchy tree
// layout). Node-link diagram: links rendered as cubic Beziers, nodes as
// small circles with labels. Click branch → toggle expand/collapse;
// Shift+click branch → drill in to subtree bounding box. Esc to pop.
//
// d3-shape isn't a workspace dep, so we inline the cubic-Bezier link path
// (same shape d3.linkHorizontal/linkVertical produces — mid-control points
// at the midpoint of the main axis).

import {
  Anchor,
  Diagram,
  derive,
  label,
  type Mount,
  num,
  circle,
  pathD,
  spring,
  untracked,
  vec,
  Vec,
} from "bireactive";
import { hierarchy, tree as d3tree } from "d3-hierarchy";
import { chartContext, project } from "../kit/chart-context";

const W = 760;
const H = 420;
const TX = 40;
const TY = 40;
const TW = W - 80;
const TH = H - 90;
const NODE_R = 5;
const ORIENTATION: "horizontal" | "vertical" = "horizontal";

interface Node {
  label: string;
  color: string;
  children?: Node[];
}

function makeTree(): Node {
  return {
    label: "Acme Inc",
    color: "#222",
    children: [
      {
        label: "Engineering",
        color: "#5b8def",
        children: [
          {
            label: "Platform",
            color: "#86acf5",
            children: [
              { label: "Ada", color: "#cfe0fb" },
              { label: "Brian", color: "#cfe0fb" },
              { label: "Chen", color: "#cfe0fb" },
            ],
          },
          {
            label: "Product",
            color: "#86acf5",
            children: [
              { label: "Diana", color: "#cfe0fb" },
              { label: "Eli", color: "#cfe0fb" },
            ],
          },
        ],
      },
      {
        label: "Design",
        color: "#7ed321",
        children: [
          { label: "Fran", color: "#a6df5e" },
          { label: "Gus", color: "#a6df5e" },
        ],
      },
      {
        label: "Sales",
        color: "#f5a623",
        children: [
          {
            label: "NA",
            color: "#f7be5a",
            children: [
              { label: "Hana", color: "#fbe1a8" },
              { label: "Ivan", color: "#fbe1a8" },
            ],
          },
          {
            label: "EMEA",
            color: "#f7be5a",
            children: [
              { label: "Jules", color: "#fbe1a8" },
            ],
          },
        ],
      },
      {
        label: "Ops",
        color: "#e25c5c",
        children: [
          { label: "Kai", color: "#ec8a8a" },
          { label: "Lin", color: "#ec8a8a" },
        ],
      },
    ],
  };
}

interface Placed {
  node: Node;
  x: number;
  y: number;
  depth: number;
  isLeaf: boolean;
  hasChildren: boolean;
  parent: Node | null;
}

interface Edge {
  source: Placed;
  target: Placed;
}

// Inline cubic Bezier matching d3.linkHorizontal/linkVertical: two control
// points at the midpoint along the main axis (s and t share x or y
// depending on orientation).
function linkPath(
  sx: number, sy: number, tx: number, ty: number,
  orientation: "horizontal" | "vertical",
): string {
  if (orientation === "horizontal") {
    const mx = (sx + tx) / 2;
    return `M${sx},${sy}C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
  } else {
    const my = (sy + ty) / 2;
    return `M${sx},${sy}C${sx},${my} ${tx},${my} ${tx},${ty}`;
  }
}

export class MdTree extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    const tree = makeTree();

    const ctx = chartContext(TW, TH);

    // collapsed Set + version cell — version bump retriggers layout derive.
    const collapsed = new Set<Node>();
    const version = num(0);

    const drillStack: { x0: number; y0: number; x1: number; y1: number }[] = [];

    s(
      label(view.top.down(20), "tree · click a branch to expand/collapse · Shift+click to drill in · Esc to pop", { size: 11, bold: true, align: Anchor.Center }),
      label(view.bottom.up(28), derive(() => `collapsed: ${version.value >= 0 ? collapsed.size : 0} · drill depth: ${drillStack.length}`), { size: 10, align: Anchor.Center }),
      label(view.bottom.up(12), "horizontal orientation · cubic Bezier links (inline, no d3-shape dep)", { size: 9, fill: "#9aa0a8", align: Anchor.Center }),
    );

    // One reactive layout. Recomputes when collapsed Set version bumps.
    const layout = derive(() => {
      // touch version so derive re-runs on bump
      void version.value;

      const root = hierarchy<Node>(tree, n =>
        collapsed.has(n) ? undefined : n.children,
      );
      const laid = d3tree<Node>().size(
        ORIENTATION === "horizontal" ? [TH, TW] : [TW, TH],
      )(root);

      const placed: Placed[] = [];
      const byNode = new Map<Node, Placed>();
      // For horizontal: node.x is cross-axis (height), node.y is main (width).
      // Project node.y → layout x in [0,TW], node.x → layout y in [0,TH].
      laid.each(d => {
        const lx = ORIENTATION === "horizontal" ? d.y : d.x;
        const ly = ORIENTATION === "horizontal" ? d.x : d.y;
        const p: Placed = {
          node: d.data,
          x: lx,
          y: ly,
          depth: d.depth,
          isLeaf: !d.data.children || d.data.children.length === 0,
          hasChildren: !!(d.data.children && d.data.children.length > 0),
          parent: d.parent ? d.parent.data : null,
        };
        placed.push(p);
        byNode.set(d.data, p);
      });

      const edges: Edge[] = [];
      laid.links().forEach(l => {
        const src = byNode.get(l.source.data);
        const tgt = byNode.get(l.target.data);
        if (src && tgt) edges.push({ source: src, target: tgt });
      });

      return { placed, byNode, edges };
    });

    // Collect static node references — every node in the data tree gets a
    // record; placed-lookup is reactive (returns undefined when collapsed
    // hides this node, in which case we render at zero opacity).
    const allNodes: Node[] = [];
    const parentOf = new Map<Node, Node | null>();
    const walk = (n: Node, parent: Node | null): void => {
      allNodes.push(n);
      parentOf.set(n, parent);
      n.children?.forEach(c => walk(c, n));
    };
    walk(tree, null);

    // visible(n) = true iff none of n's ancestors are in `collapsed`.
    // Tracks `version` so it re-runs on toggle.
    const visibleOf = (n: Node) => {
      void version.value;
      let a = parentOf.get(n) ?? null;
      while (a) {
        if (collapsed.has(a)) return false;
        a = parentOf.get(a) ?? null;
      }
      return true;
    };

    // Highest collapsed ancestor — the branch root descendants should
    // animate into. Null if no ancestor is collapsed.
    const collapseAnchor = (n: Node): Node | null => {
      let a = parentOf.get(n) ?? null;
      let anchor: Node | null = null;
      while (a) {
        if (collapsed.has(a)) anchor = a;
        a = parentOf.get(a) ?? null;
      }
      return anchor;
    };

    // Per-node writable cells driven by springs that track derived targets.
    const POS_SPRING = { omega: 14, zeta: 0.95, precision: 0.01 };
    const OPACITY_SPRING = { omega: 18, zeta: 1, precision: 0.001 };

    interface NodeVis {
      pos: ReturnType<typeof vec>;
      opacity: ReturnType<typeof num>;
    }
    const visOf = new Map<Node, NodeVis>();

    // Project a Placed → screen coords (reads zoom focus).
    const screenOf = (p: Placed) => ({
      x: TX + project(p.x, ctx.focus.x0.value, ctx.focus.x1.value, 0, TW),
      y: TY + project(p.y, ctx.focus.y0.value, ctx.focus.y1.value, 0, TH),
    });

    const drillTo = (placedRoot: Placed) => {
      // Compute bounding box of subtree from current layout. Walk node's
      // children in the data tree, look up in byNode (skipped if collapsed).
      const lay = layout.value;
      let x0 = placedRoot.x, x1 = placedRoot.x, y0 = placedRoot.y, y1 = placedRoot.y;
      const visit = (n: Node) => {
        const p = lay.byNode.get(n);
        if (p) {
          if (p.x < x0) x0 = p.x;
          if (p.x > x1) x1 = p.x;
          if (p.y < y0) y0 = p.y;
          if (p.y > y1) y1 = p.y;
        }
        n.children?.forEach(visit);
      };
      visit(placedRoot.node);
      // Pad so nodes/labels don't sit right on the edge.
      const padX = Math.max(20, (x1 - x0) * 0.08);
      const padY = Math.max(20, (y1 - y0) * 0.12);
      drillStack.push({
        x0: ctx.focus.x0.value, y0: ctx.focus.y0.value,
        x1: ctx.focus.x1.value, y1: ctx.focus.y1.value,
      });
      ctx.zoomTo({ x0: x0 - padX, y0: y0 - padY, x1: x1 + padX, y1: y1 + padY });
    };
    const popDrill = () => {
      const prev = drillStack.pop();
      if (prev) ctx.zoomTo(prev);
      else ctx.reset();
    };

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && drillStack.length > 0) {
        popDrill();
        e.preventDefault();
      }
    });

    // --- Links pass first (paint under nodes) ---
    // Build a stable list of (source-node, target-node) pairs to iterate.
    // Because the visible link set changes when nodes collapse, we render a
    // link element per *potential* edge in the static data tree, and switch
    // opacity / path to empty when either endpoint isn't in the live layout.
    const allEdges: Array<{ source: Node; target: Node }> = [];
    const collectEdges = (n: Node) => {
      n.children?.forEach(c => {
        allEdges.push({ source: n, target: c });
        collectEdges(c);
      });
    };
    collectEdges(tree);

    // Initialize per-node writable cells. For positions, seed from the
    // initial layout so springs don't sweep in from (0,0) on first mount.
    untracked(() => {
      const lay = layout.value;
      for (const node of allNodes) {
        const p = lay.byNode.get(node);
        const init = p ? screenOf(p) : { x: TX, y: TY };
        visOf.set(node, { pos: vec(init.x, init.y), opacity: num(p ? 1 : 0) });
      }
    });

    // Drive each node's pos/opacity toward derived targets via springs.
    // Targets re-read `collapsed` (via version) and `ctx.focus`.
    for (const node of allNodes) {
      const v = visOf.get(node)!;
      const targetPos = Vec.derive(() => {
        const lay = layout.value;
        const p = lay.byNode.get(node);
        if (p) return screenOf(p);
        // Collapsed-away: collapse into the highest collapsed ancestor.
        const anchor = collapseAnchor(node);
        const ap = anchor ? lay.byNode.get(anchor) : null;
        if (ap) return screenOf(ap);
        return { x: TX, y: TY };
      });
      const targetOpacity = derive(() => (visibleOf(node) ? 1 : 0));
      this.anim.start(spring(v.pos, targetPos, POS_SPRING));
      this.anim.start(spring(v.opacity, targetOpacity, OPACITY_SPRING));
    }

    // --- Links pass first (paint under nodes) ---
    for (const e of allEdges) {
      const sv = visOf.get(e.source)!;
      const tv = visOf.get(e.target)!;
      const d = derive(() => {
        const sp = sv.pos.value;
        const tp = tv.pos.value;
        return linkPath(sp.x, sp.y, tp.x, tp.y, ORIENTATION);
      });
      // Link visible only when BOTH endpoints are visible.
      const linkOpacity = derive(() => Math.min(sv.opacity.value, tv.opacity.value));
      s(pathD(d, { stroke: "#666", thin: true, opacity: linkOpacity }));
    }

    // --- Nodes pass ---
    for (const node of allNodes) {
      const v = visOf.get(node)!;
      const hasChildren = !!(node.children && node.children.length > 0);

      const fillColor = derive(() => {
        if (!hasChildren) return node.color;
        return collapsed.has(node) && version.value >= 0 ? "#0b0d12" : node.color;
      });

      s(
        circle(v.pos, NODE_R, {
          fill: fillColor,
          stroke: "#0b0d12",
          thin: true,
          opacity: v.opacity,
        }),
      );

      // Label — horizontal: right of leaves, left of branches.
      const isLeaf = !hasChildren;
      const labelOffset = ORIENTATION === "horizontal"
        ? (isLeaf ? NODE_R + 4 : -(NODE_R + 4))
        : 0;
      const labelDy = ORIENTATION === "horizontal" ? 0 : NODE_R + 10;
      s(
        label(
          Vec.derive(() => {
            const p = v.pos.value;
            return { x: p.x + labelOffset, y: p.y + labelDy };
          }),
          node.label,
          {
            size: 10,
            align: ORIENTATION === "horizontal"
              ? (isLeaf ? Anchor.Left : Anchor.Right)
              : Anchor.Center,
            fill: "#e6e8ec",
            opacity: v.opacity,
          },
        ),
      );

      // Hit target for branches: click toggles collapse; shift-click drills.
      if (hasChildren) {
        const hit = s(
          circle(v.pos, NODE_R + 6, {
            fill: "transparent",
            stroke: "transparent",
            opacity: v.opacity,
          }),
        );
        hit.el.style.cursor = "pointer";
        hit.el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const me = ev as MouseEvent;
          const p = layout.value.byNode.get(node);
          if (!p) return;
          if (me.shiftKey) {
            drillTo(p);
            return;
          }
          if (collapsed.has(node)) collapsed.delete(node);
          else collapsed.add(node);
          version.value = version.value + 1;
        });
      }
    }
  }
}
