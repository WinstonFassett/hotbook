// Pack with drill-in via subtree re-layout.
//
// Instead of projecting through a focus rect (which mangles polar layouts and
// can look weird in cartesian too), we maintain a `currentRoot` Writable. The
// d3-pack layout re-runs over the subtree rooted at `currentRoot` and fills
// the full viewport. Click a branch → push old root, set currentRoot to it.
// Esc → pop. All nodes are mounted once; nodes outside the current subtree
// render with opacity 0.

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
const PX = 20;
const PY = 40;
const PW = W - 40;
const PH = H - 80;

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

export class MdPackDrill extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    const tree = makeTree();

    // bireactive's `num` is Num; we need reactivity for a non-Num "current
    // root" reference. Cheapest path: hold the Node in a plain JS ref and
    // use a Num as a version bumper that all derives subscribe to.
    let rootRef: Node = tree;
    const version = num(0);
    const drillStack: Node[] = [];

    const setRoot = (n: Node) => {
      rootRef = n;
      version.value = version.value + 1;
    };

    s(
      label(view.top.down(18), "pack-drill · click a branch to drill in (subtree re-layouts to fill viewport) · Esc pops", { size: 11, bold: true, align: Anchor.Center }),
      label(view.bottom.up(20), "no focus projection — d3-pack re-runs on the current subtree", { size: 10, align: Anchor.Center }),
      label(view.bottom.up(8), derive(() => {
        version.value; // subscribe
        return `current: ${rootRef.label} · depth: ${drillStack.length} · total: ${tree.total.value.toFixed(0)}`;
      }), { size: 10, align: Anchor.Center }),
    );

    const layout = derive(() => {
      version.value; // subscribe to drill changes
      return computeLayout(rootRef);
    });

    const discFor = (node: Node) =>
      derive(() => layout.value.get(node));

    const allNodes: { node: Node; isLeaf: boolean; depth: number }[] = [];
    const walk = (n: Node, depth: number): void => {
      allNodes.push({ node: n, isLeaf: !n.children, depth });
      n.children?.forEach(c => walk(c, depth + 1));
    };
    walk(tree, 0);

    const drillTo = (n: Node) => {
      drillStack.push(rootRef);
      setRoot(n);
    };
    const popDrill = () => {
      const prev = drillStack.pop();
      if (prev) setRoot(prev);
    };

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && drillStack.length > 0) {
        popDrill();
        e.preventDefault();
      }
    });

    for (const { node, isLeaf } of allNodes) {
      const d = discFor(node);
      const present = derive(() => d.value !== undefined);
      const cx = derive(() => d.value?.cx ?? 0);
      const cy = derive(() => d.value?.cy ?? 0);
      const r = derive(() => d.value?.r ?? 0);
      const dep = derive(() => d.value?.depth ?? 0);
      const isCurrentRoot = derive(() => dep.value === 0);

      const disc = s(
        circle(
          Vec.derive(() => ({ x: cx.value, y: cy.value })),
          r,
          {
            fill: node.color,
            opacity: derive(() => {
              if (!present.value) return 0;
              if (isCurrentRoot.value) return 0.15;
              return isLeaf ? 0.95 : 0.4;
            }),
            stroke: "#0b0d12",
            thin: true,
          },
        ),
      );

      // Click handler: branches (non-leaf) that are not the current root drill in.
      if (!isLeaf) {
        disc.el.addEventListener("click", (e) => {
          if (!present.value) return;
          if (isCurrentRoot.value) return;
          e.stopPropagation();
          drillTo(node);
        });
        const updateCursor = () => {
          disc.el.style.cursor = present.value && !isCurrentRoot.value ? "zoom-in" : "default";
        };
        // Initial + reactive update via a derive subscription side-effect:
        derive(() => {
          present.value; isCurrentRoot.value;
          queueMicrotask(updateCursor);
          return 0;
        });
      }

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
            size: 10,
            align: Anchor.Center,
            fill: "#fff",
            bold: !isLeaf,
            opacity: derive(() => {
              if (!present.value) return 0;
              if (isCurrentRoot.value) return 0;
              return r.value > 18 ? 1 : 0;
            }),
          },
        ),
      );
    }
  }
}
