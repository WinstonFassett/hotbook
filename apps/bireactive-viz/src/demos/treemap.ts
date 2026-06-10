// Treemap — bireactive port of LayerChart's <Treemap> shape, with two
// additions LayerChart doesn't have:
//   1. DM: drag a leaf to reapportion (sum-redistribute lens, source-order
//      preserved so tiles don't reorder during gestures).
//   2. Drill-in via the chart-context "focus domain". Click a branch to zoom
//      its rectangle to fill the viewport; Esc to pop back out. Lands
//      vizform R16 (zoom-to-fit on commit) for the hierarchical case.
//
// Forward layout is d3-treemap over a snapshot of writable Num leaves.
// Backward write is bireactive lens onto those same leaves. Geometry is
// derived, never authoritative — same split as the spike's treemap.ts.

import {
  Anchor,
  Diagram,
  derive,
  drag,
  label,
  type Mount,
  num,
  rect,
  Vec,
  Num,
  type Writable,
} from "bireactive";
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { chartContext, project } from "../kit/chart-context";

const W = 760;
const H = 420;
const PAD_OUTER = 4;
const PAD_INNER = 2;
const PAD_TOP = 16;

interface Node {
  label: string;
  color: string;
  total: Writable<Num>;
  children?: Node[];
}

function leaf(label: string, value: number, color: string): Node {
  return { label, color, total: num(value) };
}

function groupNode(label: string, color: string, children: Node[]): Node {
  const total = Num.lens(
    children.map(c => c.total),
    (vs: readonly number[]) => vs.reduce((a, b) => a + b, 0),
    (target, vs) => {
      const arr = vs as readonly number[];
      const cur = arr.reduce((a, b) => a + b, 0);
      if (cur === 0) return arr.map(() => target / arr.length) as never;
      const scale = target / cur;
      return arr.map(v => v * scale) as never;
    },
  );
  return { label, color, total, children };
}

function makeTree(): Node {
  return groupNode("Portfolio", "#222", [
    groupNode("Tech", "#5b8def", [
      leaf("AAPL", 35, "#86acf5"),
      leaf("MSFT", 28, "#86acf5"),
      leaf("NVDA", 22, "#86acf5"),
    ]),
    groupNode("Finance", "#7ed321", [
      leaf("JPM", 18, "#a6df5e"),
      leaf("BRK", 14, "#a6df5e"),
    ]),
    groupNode("Energy", "#f5a623", [
      leaf("XOM", 10, "#f7be5a"),
      leaf("SHEL", 8, "#f7be5a"),
    ]),
    groupNode("Health", "#e25c5c", [
      leaf("JNJ", 9, "#ec8a8a"),
      leaf("PFE", 6, "#ec8a8a"),
    ]),
  ]);
}

interface Tile { node: Node; x0: number; y0: number; x1: number; y1: number; depth: number }

function computeLayout(root: Node, width: number, height: number): Tile[] {
  const h = hierarchy<Node>(root, n => n.children)
    .sum(n => (n.children ? 0 : n.total.value));

  const laid = treemap<Node>()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingOuter(PAD_OUTER)
    .paddingInner(PAD_INNER)
    .paddingTop(PAD_TOP)
    .round(false)(h);

  const tiles: Tile[] = [];
  laid.each(d => {
    tiles.push({
      node: d.data,
      x0: d.x0,
      y0: d.y0,
      x1: d.x1,
      y1: d.y1,
      depth: d.depth,
    });
  });
  return tiles;
}

function parentOf(root: Node, target: Node): Node | undefined {
  if (!root.children) return undefined;
  if (root.children.includes(target)) return root;
  for (const c of root.children) {
    const found = parentOf(c, target);
    if (found) return found;
  }
  return undefined;
}

export class MdTreemap extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    const tree = makeTree();

    const TX = 20, TY = 40, TW = W - 40, TH = H - 90;
    const ctx = chartContext(TW, TH);

    // Track drill stack for Esc-pop. Each entry is a layout-coords rect.
    const drillStack: { x0: number; y0: number; x1: number; y1: number }[] = [];

    s(
      label(view.top.down(20), "treemap · click a branch to drill in · Esc to pop · drag a leaf to reapportion", { size: 11, bold: true, align: Anchor.Center }),
      label(view.bottom.up(28), derive(() => `total: ${tree.total.value.toFixed(0)} · drill depth: ${drillStack.length}`), { size: 10, align: Anchor.Center }),
      label(view.bottom.up(12), "R16: focus domain tweens on commit (snap for now; spring next iteration)", { size: 9, fill: "#9aa0a8", align: Anchor.Center }),
    );

    // One reactive layout over the full tree, computed in layout-space.
    const layout = derive(() => {
      const tiles = computeLayout(tree, TW, TH);
      const byNode = new Map<Node, Tile>();
      for (const t of tiles) byNode.set(t.node, t);
      return byNode;
    });

    const tileFor = (node: Node) =>
      derive(() => layout.value.get(node) ?? { node, x0: 0, y0: 0, x1: 0, y1: 0, depth: 0 });

    // Walk static structure.
    const allNodes: { node: Node; isLeaf: boolean; depth: number }[] = [];
    const walk = (n: Node, depth: number): void => {
      allNodes.push({ node: n, isLeaf: !n.children, depth });
      n.children?.forEach(c => walk(c, depth + 1));
    };
    walk(tree, 0);

    // Drill-in: click any branch tile (non-leaf, depth>0) to zoom focus to its rect.
    const drillTo = (t: Tile) => {
      drillStack.push({
        x0: ctx.focus.x0.value,
        y0: ctx.focus.y0.value,
        x1: ctx.focus.x1.value,
        y1: ctx.focus.y1.value,
      });
      ctx.zoomTo({ x0: t.x0, y0: t.y0, x1: t.x1, y1: t.y1 });
    };
    const popDrill = () => {
      const prev = drillStack.pop();
      if (prev) ctx.zoomTo(prev);
      else ctx.reset();
    };

    // Esc handler at the document level — bireactive elements don't get focus
    // unless tabindex'd, and we want Esc to work globally while pointer is over
    // the diagram.
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && drillStack.length > 0) {
        popDrill();
        e.preventDefault();
      }
    });

    for (const { node, isLeaf, depth } of allNodes) {
      const t = tileFor(node);
      // Project layout-coords through ctx.focus → view-coords (px in TX/TY origin).
      const x = derive(() =>
        TX + project(t.value.x0, ctx.focus.x0.value, ctx.focus.x1.value, 0, TW),
      );
      const y = derive(() =>
        TY + project(t.value.y0, ctx.focus.y0.value, ctx.focus.y1.value, 0, TH),
      );
      const x1 = derive(() =>
        TX + project(t.value.x1, ctx.focus.x0.value, ctx.focus.x1.value, 0, TW),
      );
      const y1 = derive(() =>
        TY + project(t.value.y1, ctx.focus.y0.value, ctx.focus.y1.value, 0, TH),
      );
      const w = derive(() => Math.max(0, x1.value - x.value));
      const h = derive(() => Math.max(0, y1.value - y.value));

      s(
        rect(x, y, w, h, {
          fill: node.color,
          opacity: depth === 0 ? 0.12 : isLeaf ? 0.95 : 0.45,
          stroke: depth === 0 ? "#444" : "#0b0d12",
          thin: true,
          corner: 3,
        }),
      );

      if (depth > 0) {
        const labelText = isLeaf
          ? derive(() => `${node.label}\n${node.total.value.toFixed(0)}`)
          : derive(() => node.label);
        s(
          label(
            Vec.derive(() => ({
              x: x.value + w.value / 2,
              y: y.value + (isLeaf ? h.value / 2 : 10),
            })),
            labelText,
            {
              size: isLeaf ? 11 : 10,
              align: Anchor.Center,
              fill: "#fff",
              bold: !isLeaf,
              opacity: derive(() => (w.value > 28 && h.value > 16 ? 1 : 0)),
            },
          ),
        );
      }

      // Branch (non-leaf, depth>0): clickable to drill in.
      if (!isLeaf && depth > 0) {
        const branchHit = s(
          rect(x, y, w, h, { fill: "transparent", stroke: "transparent" }),
        );
        branchHit.el.style.cursor = "zoom-in";
        branchHit.el.addEventListener("click", (e) => {
          e.stopPropagation();
          drillTo(t.value);
        });
      }

      // Leaf: drag-to-reapportion (same sum-redistribute lens as spike).
      if (isLeaf) {
        const hit = s(
          rect(x, y, w, h, { fill: "transparent", stroke: "transparent" }),
        );
        hit.el.setAttribute("tabindex", "0");
        hit.el.style.outline = "none";
        hit.el.style.cursor = "move";

        const parent = parentOf(tree, node);

        // Shift+click on a leaf drills into its parent branch (you can't drill
        // INTO a leaf, but you can scope the view to its siblings). Double-click
        // also drills. Plain click stays for drag/focus.
        const drillParent = (e: Event) => {
          e.stopPropagation();
          if (!parent) return;
          const pt = layout.value.get(parent);
          if (pt) drillTo(pt);
        };
        hit.el.addEventListener("click", (e) => {
          if ((e as MouseEvent).shiftKey) drillParent(e);
        });
        hit.el.addEventListener("dblclick", drillParent);
        const siblings = parent?.children?.filter(c => c !== node) ?? [];

        const apply = (delta: number) => {
          const cur = node.total.value;
          const next = Math.max(0, cur + delta);
          const real = next - cur;
          if (real === 0) return;
          node.total.value = next;
          let remaining = real;
          const pool = siblings.filter(s => s.total.value > 0);
          const poolSum = pool.reduce((a, b) => a + b.total.value, 0);
          if (real > 0 && poolSum > 0) {
            for (const sib of pool) {
              const share = (sib.total.value / poolSum) * real;
              const take = Math.min(sib.total.value, share);
              sib.total.value -= take;
              remaining -= take;
            }
            for (const sib of siblings) {
              if (remaining <= 0) break;
              const take = Math.min(sib.total.value, remaining);
              sib.total.value -= take;
              remaining -= take;
            }
          } else if (real < 0 && siblings.length > 0) {
            const sibSum = siblings.reduce((a, b) => a + b.total.value, 0);
            if (sibSum > 0) {
              for (const sib of siblings) {
                const share = (sib.total.value / sibSum) * (-real);
                sib.total.value += share;
              }
            } else {
              for (const sib of siblings) sib.total.value += -real / siblings.length;
            }
          }
        };

        hit.el.addEventListener("keydown", (ev: Event) => {
          const e = ev as KeyboardEvent;
          const step = e.shiftKey ? 5 : 1;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") { apply(+step); e.preventDefault(); }
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { apply(-step); e.preventDefault(); }
        });
        hit.el.addEventListener("wheel", (ev: Event) => {
          const e = ev as WheelEvent;
          if (!e.altKey) return;
          e.preventDefault();
          const step = e.shiftKey ? 5 : 1;
          apply(e.deltaY < 0 ? +step : -step);
        }, { passive: false });

        let dragStartValue = 0;
        let dragStartY = 0;
        const dragKnob = Vec.lens(
          [node.total] as const,
          () => ({ x: x.value + w.value / 2, y: y.value + h.value / 2 }),
          (target, [_v]) => {
            const dy = dragStartY - target.y;
            const pxPerUnit = Math.max(0.5, (h.value || 4) / Math.max(1, dragStartValue));
            const delta = dy / pxPerUnit;
            const next = Math.max(0, dragStartValue + delta);
            return [next] as never;
          },
        );
        hit.el.addEventListener("pointerdown", () => {
          dragStartValue = node.total.value;
          dragStartY = y.value + h.value / 2;
        }, true);
        drag(hit, dragKnob);
      }
    }
  }
}
