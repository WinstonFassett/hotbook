// Icicle (hierarchical bands). The cartesian sibling of sunburst.
// Forward layout: d3-hierarchy `partition()` over a snapshot of the
// writable tree, mapped to (x: width ∝ value, y: depth). Backward: same
// sum-redistribute lens as treemap / sunburst / budget-tree.
//
// Vertical orientation: depth grows downward, width = value share.

import {
  Anchor,
  Diagram,
  derive,
  label,
  type Mount,
  Num,
  num,
  rect,
  Vec,
  type Writable,
} from "bireactive";
import { hierarchy, partition } from "d3-hierarchy";

const W = 760;
const H = 360;
const PAD = 1;

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

interface Tile { node: Node; x: number; y: number; w: number; h: number; depth: number }

const PX = 20;
const PY = 40;
const PW = W - 40;
const PH = H - 80;

function computeLayout(root: Node): Map<Node, Tile> {
  const h = hierarchy<Node>(root, n => n.children)
    .sum(n => (n.children ? 0 : n.total.value));
  partition<Node>().size([PW, PH]).padding(PAD)(h);
  const map = new Map<Node, Tile>();
  h.each(d => {
    map.set(d.data, {
      node: d.data,
      x: PX + d.x0,
      y: PY + d.y0,
      w: Math.max(0, d.x1 - d.x0),
      h: Math.max(0, d.y1 - d.y0),
      depth: d.depth,
    });
  });
  return map;
}

function attachNudge(el: SVGElement, cell: Writable<Num>, neighbor: Writable<Num>, step = 1, big = 5): void {
  el.setAttribute("tabindex", "0");
  el.style.outline = "none";
  el.style.cursor = "ew-resize";
  const apply = (delta: number) => {
    const cur = cell.value;
    const next = Math.max(0, cur + delta);
    const real = next - cur;
    cell.value = next;
    neighbor.value = Math.max(0, neighbor.value - real);
  };
  el.addEventListener("keydown", (e: KeyboardEvent) => {
    const k = e.shiftKey ? big : step;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { apply(+k); e.preventDefault(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { apply(-k); e.preventDefault(); }
  });
  el.addEventListener("wheel", (e: WheelEvent) => {
    if (!e.altKey) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? +1 : -1;
    apply(dir * (e.shiftKey ? big : step));
  }, { passive: false });
}

export class MdIcicle extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    const tree = makeTree();

    s(
      label(view.top.down(18), "icicle · hierarchical bands over a writable Tree<Num>", { size: 11, bold: true, align: Anchor.Center }),
      label(view.bottom.up(14), derive(() => `total: ${tree.total.value.toFixed(0)} · drag/nudge any tile; next sibling absorbs the delta`), { size: 10, align: Anchor.Center }),
    );

    const layout = derive(() => computeLayout(tree));
    const tileFor = (node: Node) =>
      derive(() => layout.value.get(node) ?? { node, x: 0, y: 0, w: 0, h: 0, depth: 0 });

    const allNodes: { node: Node; isLeaf: boolean; siblings: Node[]; depth: number }[] = [];
    const walk = (n: Node, depth: number, siblings: Node[]): void => {
      allNodes.push({ node: n, isLeaf: !n.children, siblings, depth });
      n.children?.forEach(c => walk(c, depth + 1, n.children!));
    };
    walk(tree, 0, [tree]);

    for (const { node, isLeaf, siblings, depth } of allNodes) {
      if (depth === 0) continue;
      const t = tileFor(node);
      const x = derive(() => t.value.x);
      const y = derive(() => t.value.y);
      const w = derive(() => t.value.w);
      const h = derive(() => t.value.h);

      const tile = s(
        rect(x, y, w, h, {
          fill: node.color,
          opacity: isLeaf ? 0.95 : 0.7,
          stroke: "#0b0d12",
          thin: true,
          corner: 2,
        }),
      );
      const idx = siblings.indexOf(node);
      const neighbor = siblings[(idx + 1) % siblings.length]!;
      if (neighbor !== node) attachNudge(tile.el, node.total, neighbor.total);

      const labelText = isLeaf
        ? derive(() => `${node.label} ${node.total.value.toFixed(0)}`)
        : derive(() => node.label);
      s(
        label(
          Vec.derive(() => ({ x: x.value + w.value / 2, y: y.value + h.value / 2 })),
          labelText,
          {
            size: isLeaf ? 10 : 10,
            align: Anchor.Center,
            fill: "#fff",
            bold: !isLeaf,
            opacity: derive(() => (w.value > 28 ? 1 : 0)),
          },
        ),
      );
    }
  }
}
