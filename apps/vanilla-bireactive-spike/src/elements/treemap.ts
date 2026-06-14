// Squarified treemap (Bruls/Huijsen/van Wijk 2000) via d3-hierarchy.
// Forward geometry: d3.treemap().tile(d3.treemapSquarify) over a current
// snapshot of the writable tree values.
// Backward (drag-to-resize): bireactive sum-redistribute lens — same shape
// as budget-tree. The lens lives on the values, not the geometry.
//
// Drag a leaf's horizontal edge to grow/shrink it against its siblings;
// the sum at every ancestor stays invariant.

import {
  Anchor,
  Diagram,
  derive,
  drag,
  label,
  type Mount,
  Num,
  num,
  rect,
  Vec,
  type Writable,
} from "bireactive";
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";

const W = 760;
const H = 380;
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

interface Tile { node: Node; x: number; y: number; w: number; h: number; depth: number }

// Snapshot all leaf values, run d3 squarified, return one tile per node.
function computeLayout(root: Node, width: number, height: number): Tile[] {
  // No .sort() — preserve source child order so tiles don't jump when values
  // change (vizform Rule 2 / Rule 7: scale & sort stability during edits).
  // Squarified still produces a good aspect-ratio layout; it just walks
  // children in the order given instead of value-desc.
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
      x: d.x0,
      y: d.y0,
      w: Math.max(0, d.x1 - d.x0),
      h: Math.max(0, d.y1 - d.y0),
      depth: d.depth,
    });
  });
  return tiles;
}

export class MdTreemap extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    const tree = makeTree();

    s(
      label(view.top.down(20), "treemap · squarified (d3-hierarchy) over a writable Tree<Num> · drag a leaf to reapportion", { size: 11, bold: true, align: Anchor.Center }),
      label(view.bottom.up(12), derive(() => `total: ${tree.total.value.toFixed(0)} (sum aggregate)`), { size: 10 }),
    );

    const TX = 20, TY = 40, TW = W - 40, TH = H - 70;

    // Single reactive layout — recomputes any time any leaf cell changes.
    const layout = derive(() => {
      const tiles = computeLayout(tree, TW, TH);
      const byNode = new Map<Node, Tile>();
      for (const t of tiles) byNode.set(t.node, t);
      return byNode;
    });

    const tileFor = (node: Node) =>
      derive(() => layout.value.get(node) ?? { node, x: 0, y: 0, w: 0, h: 0, depth: 0 });

    // Walk the static structure once; each node gets reactive geometry derived
    // from the central layout cell.
    const allNodes: { node: Node; isLeaf: boolean; depth: number }[] = [];
    const walk = (n: Node, depth: number): void => {
      allNodes.push({ node: n, isLeaf: !n.children, depth });
      n.children?.forEach(c => walk(c, depth + 1));
    };
    walk(tree, 0);

    for (const { node, isLeaf, depth } of allNodes) {
      const t = tileFor(node);
      const x = derive(() => t.value.x + TX);
      const y = derive(() => t.value.y + TY);
      const w = derive(() => t.value.w);
      const h = derive(() => t.value.h);

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

      // Drag-to-resize on leaves: a transparent overlay catches drag/key/wheel
      // and pushes back through a sum-redistribute lens against the siblings.
      if (isLeaf) {
        const hit = s(
          rect(x, y, w, h, { fill: "transparent", stroke: "transparent" }),
        );
        hit.el.setAttribute("tabindex", "0");
        hit.el.style.outline = "none";
        hit.el.style.cursor = "move";

        const parent = parentOf(tree, node);
        const siblings = parent?.children?.filter(c => c !== node) ?? [];

        const apply = (delta: number) => {
          const cur = node.total.value;
          const next = Math.max(0, cur + delta);
          const real = next - cur;
          if (real === 0) return;
          node.total.value = next;
          let remaining = real;
          const pool = siblings.filter(s => s.total.value > 0);
          // Take proportionally from siblings with capacity.
          const poolSum = pool.reduce((a, b) => a + b.total.value, 0);
          if (real > 0 && poolSum > 0) {
            for (const sib of pool) {
              const share = (sib.total.value / poolSum) * real;
              const take = Math.min(sib.total.value, share);
              sib.total.value -= take;
              remaining -= take;
            }
            // Any leftover (rounding / capacity) — take greedily.
            for (const sib of siblings) {
              if (remaining <= 0) break;
              const take = Math.min(sib.total.value, remaining);
              sib.total.value -= take;
              remaining -= take;
            }
          } else if (real < 0 && siblings.length > 0) {
            // Give surplus back proportionally.
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

        // Pointer drag: vertical drag scales value linearly with the tile's
        // current pixel area (drag up = grow). Uses a Vec.lens to translate
        // pointer Y into a value delta.
        let dragStartValue = 0;
        let dragStartY = 0;
        const dragKnob = Vec.lens(
          [node.total] as const,
          () => ({ x: x.value + w.value / 2, y: y.value + h.value / 2 }),
          (target, [_v]) => {
            // Use a fixed pixels-per-unit derived from the tile's current
            // height at drag start (captured below). Falls back to 4 px/unit.
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

function parentOf(root: Node, target: Node): Node | undefined {
  if (!root.children) return undefined;
  if (root.children.includes(target)) return root;
  for (const c of root.children) {
    const found = parentOf(c, target);
    if (found) return found;
  }
  return undefined;
}
