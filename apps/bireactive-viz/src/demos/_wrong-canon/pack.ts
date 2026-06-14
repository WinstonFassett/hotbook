// Pack (hierarchical circle packing). Forward: d3-hierarchy `pack()` over a
// snapshot of the writable tree. Backward: same sum-redistribute lens as
// icicle / sunburst / treemap — nudge a circle to take share from its next
// sibling.

import {
  Anchor,
  Diagram,
  derive,
  label,
  type Mount,
  Num,
  num,
  circle,
  Vec,
  type Writable,
} from "bireactive";
import { hierarchy, pack as d3pack } from "d3-hierarchy";

const W = 760;
const H = 380;
const PAD = 2;

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

interface Disc { node: Node; cx: number; cy: number; r: number; depth: number }

const PX = 20;
const PY = 40;
const PW = W - 40;
const PH = H - 80;

function computeLayout(root: Node): Map<Node, Disc> {
  const h = hierarchy<Node>(root, n => n.children)
    .sum(n => (n.children ? 0 : n.total.value));
  d3pack<Node>().size([PW, PH]).padding(PAD)(h);
  const map = new Map<Node, Disc>();
  h.each(d => {
    map.set(d.data, {
      node: d.data,
      cx: PX + d.x,
      cy: PY + d.y,
      r: d.r,
      depth: d.depth,
    });
  });
  return map;
}

function attachNudge(el: SVGElement, cell: Writable<Num>, neighbor: Writable<Num>, step = 1, big = 5): void {
  el.setAttribute("tabindex", "0");
  el.style.outline = "none";
  el.style.cursor = "pointer";
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
  el.addEventListener("focus", () => {
    el.style.filter = "brightness(1.15) drop-shadow(0 0 6px rgba(255,255,255,0.5))";
  });
  el.addEventListener("blur", () => {
    el.style.filter = "";
  });
}

export class MdPack extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    const tree = makeTree();

    s(
      label(view.top.down(18), "pack · hierarchical circle packing over a writable Tree<Num>", { size: 11, bold: true, align: Anchor.Center }),
      label(view.bottom.up(20), "nudge any circle — next sibling absorbs the delta; parent totals invariant", { size: 10, align: Anchor.Center }),
      label(view.bottom.up(8), derive(() => `total: ${tree.total.value.toFixed(0)}`), { size: 10, align: Anchor.Center }),
    );

    const layout = derive(() => computeLayout(tree));
    const discFor = (node: Node) =>
      derive(() => layout.value.get(node) ?? { node, cx: 0, cy: 0, r: 0, depth: 0 });

    const allNodes: { node: Node; isLeaf: boolean; siblings: Node[]; depth: number }[] = [];
    const walk = (n: Node, depth: number, siblings: Node[]): void => {
      allNodes.push({ node: n, isLeaf: !n.children, siblings, depth });
      n.children?.forEach(c => walk(c, depth + 1, n.children!));
    };
    walk(tree, 0, [tree]);

    for (const { node, isLeaf, siblings, depth } of allNodes) {
      if (depth === 0) continue;
      const d = discFor(node);
      const cx = derive(() => d.value.cx);
      const cy = derive(() => d.value.cy);
      const r = derive(() => d.value.r);

      const disc = s(
        circle(
          Vec.derive(() => ({ x: cx.value, y: cy.value })),
          r,
          {
            fill: node.color,
            opacity: isLeaf ? 0.95 : 0.35,
            stroke: "#0b0d12",
            thin: true,
          },
        ),
      );
      const idx = siblings.indexOf(node);
      const neighbor = siblings[(idx + 1) % siblings.length]!;
      if (neighbor !== node) attachNudge(disc.el, node.total, neighbor.total);

      const labelText = isLeaf
        ? derive(() => `${node.label} ${node.total.value.toFixed(0)}`)
        : derive(() => node.label);
      s(
        label(
          Vec.derive(() => ({
            x: cx.value,
            y: isLeaf ? cy.value : cy.value - r.value + 10,
          })),
          labelText,
          {
            size: isLeaf ? 10 : 10,
            align: Anchor.Center,
            fill: "#fff",
            bold: !isLeaf,
            opacity: derive(() => (r.value > 18 ? 1 : 0)),
          },
        ),
      );
    }
  }
}
