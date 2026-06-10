// Sunburst (hierarchical radial). Forward geometry: d3-hierarchy
// `partition()` over a snapshot of the writable tree. Rings = depth, wedge
// angle ∝ value. Backward: same sum-redistribute lens as treemap / budget-
// tree — drag or nudge a wedge to take share from its next sibling.
//
// Per vizform Rule 15 (radial exception): live rebalancing of other slices
// during a gesture is acceptable for radial layouts because the proportion
// IS the coordinate.

import {
  Anchor,
  annularSector,
  Diagram,
  derive,
  label,
  type Mount,
  Num,
  num,
  Vec,
  type Writable,
} from "bireactive";
import { hierarchy, partition } from "d3-hierarchy";

const W = 540;
const H = 540;

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

interface Wedge { node: Node; a0: number; a1: number; r0: number; r1: number; depth: number }

const RADIUS = 220;
const CENTER_X = W / 2;
const CENTER_Y = H / 2;

function computeLayout(root: Node): Map<Node, Wedge> {
  // No .sort() — preserve source child order (vizform R2/R7).
  const h = hierarchy<Node>(root, n => n.children)
    .sum(n => (n.children ? 0 : n.total.value));

  partition<Node>()
    .size([2 * Math.PI, RADIUS * RADIUS])(h);

  const map = new Map<Node, Wedge>();
  h.each(d => {
    // d.x0/x1 are in [0, 2π]; d.y0/y1 are area-mapped; convert to radius.
    map.set(d.data, {
      node: d.data,
      a0: d.x0 - Math.PI / 2, // rotate so 0 is at 12 o'clock
      a1: d.x1 - Math.PI / 2,
      r0: Math.sqrt(d.y0),
      r1: Math.sqrt(d.y1),
      depth: d.depth,
    });
  });
  return map;
}

function attachNudge(
  el: SVGElement,
  cell: Writable<Num>,
  neighbor: Writable<Num>,
  step = 1,
  big = 5,
): void {
  el.setAttribute("tabindex", "0");
  el.style.outline = "none";
  el.style.cursor = "pointer";
  const apply = (delta: number) => {
    const cur = cell.value;
    const next = Math.max(0, cur + delta);
    const realDelta = next - cur;
    cell.value = next;
    neighbor.value = Math.max(0, neighbor.value - realDelta);
  };
  el.addEventListener("keydown", (e: KeyboardEvent) => {
    const k = e.shiftKey ? big : step;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      apply(+k); e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      apply(-k); e.preventDefault();
    }
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

export class MdSunburst extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    const tree = makeTree();

    s(
      label(view.top.down(16), "sunburst · hierarchical radial over a writable Tree<Num>", { size: 11, bold: true, align: Anchor.Center }),
      label(view.bottom.up(20), "drag/nudge any wedge — siblings absorb the delta; parent totals invariant", { size: 10, align: Anchor.Center }),
      label(view.bottom.up(8), derive(() => `total: ${tree.total.value.toFixed(0)}`), { size: 10, align: Anchor.Center }),
    );

    const layout = derive(() => computeLayout(tree));
    const wedgeFor = (node: Node) =>
      derive(() => layout.value.get(node) ?? { node, a0: 0, a1: 0, r0: 0, r1: 0, depth: 0 });

    // Walk the static tree to register every node's wedge as a reactive shape.
    const allNodes: { node: Node; isLeaf: boolean; siblings: Node[]; depth: number }[] = [];
    const walk = (n: Node, depth: number, siblings: Node[]): void => {
      allNodes.push({ node: n, isLeaf: !n.children, siblings, depth });
      n.children?.forEach(c => walk(c, depth + 1, n.children!));
    };
    walk(tree, 0, [tree]);

    const center = Vec.derive(() => ({ x: CENTER_X, y: CENTER_Y }));

    for (const { node, isLeaf, siblings, depth } of allNodes) {
      if (depth === 0) continue; // root has no visible wedge
      const w = wedgeFor(node);
      const r0 = derive(() => w.value.r0);
      const r1 = derive(() => w.value.r1);
      const a0 = derive(() => w.value.a0);
      const a1 = derive(() => w.value.a1);

      const wedge = s(
        annularSector(center, r1, r0, a0, a1, {
          fill: node.color,
          opacity: isLeaf ? 0.95 : 0.7,
          stroke: "#0b0d12",
          thin: true,
        }),
      );

      // Neighbor = next sibling, with wrap-around inside the same level.
      const idx = siblings.indexOf(node);
      const neighbor = siblings[(idx + 1) % siblings.length]!;
      if (neighbor !== node) {
        attachNudge(wedge.el, node.total, neighbor.total, 1, 5);
      }

      // Label: along the angular midpoint, midway between r0 and r1.
      const labelText = isLeaf
        ? derive(() => `${node.label}\n${node.total.value.toFixed(0)}`)
        : derive(() => node.label);
      const labelPos = Vec.derive(() => {
        const mid = (w.value.a0 + w.value.a1) / 2;
        const r = (w.value.r0 + w.value.r1) / 2;
        return { x: CENTER_X + Math.cos(mid) * r, y: CENTER_Y + Math.sin(mid) * r };
      });
      s(
        label(labelPos, labelText, {
          size: isLeaf ? 10 : 9,
          align: Anchor.Center,
          fill: "#fff",
          bold: !isLeaf,
          opacity: derive(() => {
            const sweep = w.value.a1 - w.value.a0;
            const r = (w.value.r0 + w.value.r1) / 2;
            const arcLen = sweep * r;
            return arcLen > 26 ? 1 : 0;
          }),
        }),
      );
    }
  }
}
