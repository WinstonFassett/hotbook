// Partition with drill-in via subtree re-layout (icicle + sunburst).
//
// Instead of projecting through a focus rect/window, we maintain a mutable
// `rootRef` and a `version` Num bumper. The d3-partition layout re-runs on
// the current subtree, filling the full viewport (rect for icicle, full disc
// for sunburst). Click a branch → push, set rootRef. Esc → pop.
//
// This avoids the polar-focus-projection weirdness entirely: the sunburst
// drills by recomputing partition over the subtree with size=[2π, R²].

import {
  Anchor,
  annularSector,
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

// ────────────────────────────────────────────────────────────────────────────
// Shared model
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// MdIcicleDrill
// ────────────────────────────────────────────────────────────────────────────

const IC_W = 760;
const IC_H = 360;
const IC_PAD = 1;
const IC_PX = 20;
const IC_PY = 40;
const IC_PW = IC_W - 40;
const IC_PH = IC_H - 80;

interface Tile { node: Node; x: number; y: number; w: number; h: number; depth: number }

function computeIcicleLayout(root: Node): Map<Node, Tile> {
  const h = hierarchy<Node>(root, n => n.children)
    .sum(n => (n.children ? 0 : n.total.value));
  partition<Node>().size([IC_PW, IC_PH]).padding(IC_PAD)(h);
  const map = new Map<Node, Tile>();
  h.each(d => {
    map.set(d.data, {
      node: d.data,
      x: IC_PX + d.x0,
      y: IC_PY + d.y0,
      w: Math.max(0, d.x1 - d.x0),
      h: Math.max(0, d.y1 - d.y0),
      depth: d.depth,
    });
  });
  return map;
}

export class MdIcicleDrill extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(IC_W, IC_H);
    const tree = makeTree();

    let rootRef: Node = tree;
    const version = num(0);
    const drillStack: Node[] = [];

    const setRoot = (n: Node) => {
      rootRef = n;
      version.value = version.value + 1;
    };

    s(
      label(view.top.down(18), "icicle-drill · click a branch to drill in (subtree re-layouts) · Esc pops", { size: 11, bold: true, align: Anchor.Center }),
      label(view.bottom.up(14), derive(() => {
        version.value;
        return `current: ${rootRef.label} · depth: ${drillStack.length} · total: ${tree.total.value.toFixed(0)}`;
      }), { size: 10, align: Anchor.Center }),
    );

    const layout = derive(() => {
      version.value;
      return computeIcicleLayout(rootRef);
    });

    const tileFor = (node: Node) =>
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
      const t = tileFor(node);
      const present = derive(() => t.value !== undefined);
      const x = derive(() => t.value?.x ?? 0);
      const y = derive(() => t.value?.y ?? 0);
      const w = derive(() => t.value?.w ?? 0);
      const h = derive(() => t.value?.h ?? 0);
      const dep = derive(() => t.value?.depth ?? 0);
      const isCurrentRoot = derive(() => dep.value === 0);

      const tile = s(
        rect(x, y, w, h, {
          fill: node.color,
          opacity: derive(() => {
            if (!present.value) return 0;
            if (isCurrentRoot.value) return 0.15;
            return isLeaf ? 0.95 : 0.7;
          }),
          stroke: "#0b0d12",
          thin: true,
          corner: 2,
        }),
      );

      if (!isLeaf) {
        tile.el.addEventListener("click", (e) => {
          if (!present.value) return;
          if (isCurrentRoot.value) return;
          e.stopPropagation();
          drillTo(node);
        });
        derive(() => {
          present.value; isCurrentRoot.value;
          queueMicrotask(() => {
            tile.el.style.cursor = present.value && !isCurrentRoot.value ? "zoom-in" : "default";
          });
          return 0;
        });
      }

      const labelText = isLeaf
        ? derive(() => `${node.label} ${node.total.value.toFixed(0)}`)
        : derive(() => node.label);
      s(
        label(
          Vec.derive(() => ({ x: x.value + w.value / 2, y: y.value + h.value / 2 })),
          labelText,
          {
            size: 10,
            align: Anchor.Center,
            fill: "#fff",
            bold: !isLeaf,
            opacity: derive(() => {
              if (!present.value) return 0;
              if (isCurrentRoot.value) return 0;
              return w.value > 28 ? 1 : 0;
            }),
          },
        ),
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MdSunburstDrill
// ────────────────────────────────────────────────────────────────────────────

const SB_W = 540;
const SB_H = 540;
const SB_RADIUS = 220;
const SB_CENTER_X = SB_W / 2;
const SB_CENTER_Y = SB_H / 2;

interface Wedge { node: Node; a0: number; a1: number; r0: number; r1: number; depth: number }

function computeSunburstLayout(root: Node): Map<Node, Wedge> {
  const h = hierarchy<Node>(root, n => n.children)
    .sum(n => (n.children ? 0 : n.total.value));

  partition<Node>()
    .size([2 * Math.PI, SB_RADIUS * SB_RADIUS])(h);

  const map = new Map<Node, Wedge>();
  h.each(d => {
    map.set(d.data, {
      node: d.data,
      a0: d.x0 - Math.PI / 2,
      a1: d.x1 - Math.PI / 2,
      r0: Math.sqrt(d.y0),
      r1: Math.sqrt(d.y1),
      depth: d.depth,
    });
  });
  return map;
}

export class MdSunburstDrill extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(SB_W, SB_H);
    const tree = makeTree();

    let rootRef: Node = tree;
    const version = num(0);
    const drillStack: Node[] = [];

    const setRoot = (n: Node) => {
      rootRef = n;
      version.value = version.value + 1;
    };

    s(
      label(view.top.down(16), "sunburst-drill · click a branch to drill in (subtree fills the disc) · Esc pops", { size: 11, bold: true, align: Anchor.Center }),
      label(view.bottom.up(20), "no polar focus projection — d3-partition re-runs on the subtree with size=[2π, R²]", { size: 10, align: Anchor.Center }),
      label(view.bottom.up(8), derive(() => {
        version.value;
        return `current: ${rootRef.label} · depth: ${drillStack.length} · total: ${tree.total.value.toFixed(0)}`;
      }), { size: 10, align: Anchor.Center }),
    );

    const layout = derive(() => {
      version.value;
      return computeSunburstLayout(rootRef);
    });

    const wedgeFor = (node: Node) =>
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

    const center = Vec.derive(() => ({ x: SB_CENTER_X, y: SB_CENTER_Y }));

    for (const { node, isLeaf } of allNodes) {
      const w = wedgeFor(node);
      const present = derive(() => w.value !== undefined);
      const r0 = derive(() => w.value?.r0 ?? 0);
      const r1 = derive(() => w.value?.r1 ?? 0);
      const a0 = derive(() => w.value?.a0 ?? 0);
      const a1 = derive(() => w.value?.a1 ?? 0);
      const dep = derive(() => w.value?.depth ?? 0);
      const isCurrentRoot = derive(() => dep.value === 0);

      const wedge = s(
        annularSector(center, r1, r0, a0, a1, {
          fill: node.color,
          opacity: derive(() => {
            if (!present.value) return 0;
            if (isCurrentRoot.value) return 0; // root has r0=r1=0 anyway
            return isLeaf ? 0.95 : 0.7;
          }),
          stroke: "#0b0d12",
          thin: true,
        }),
      );

      if (!isLeaf) {
        wedge.el.addEventListener("click", (e) => {
          if (!present.value) return;
          if (isCurrentRoot.value) return;
          e.stopPropagation();
          drillTo(node);
        });
        derive(() => {
          present.value; isCurrentRoot.value;
          queueMicrotask(() => {
            wedge.el.style.cursor = present.value && !isCurrentRoot.value ? "zoom-in" : "default";
          });
          return 0;
        });
      }

      const labelText = isLeaf
        ? derive(() => `${node.label}\n${node.total.value.toFixed(0)}`)
        : derive(() => node.label);
      const labelPos = Vec.derive(() => {
        const mid = (a0.value + a1.value) / 2;
        const r = (r0.value + r1.value) / 2;
        return { x: SB_CENTER_X + Math.cos(mid) * r, y: SB_CENTER_Y + Math.sin(mid) * r };
      });
      s(
        label(labelPos, labelText, {
          size: isLeaf ? 10 : 9,
          align: Anchor.Center,
          fill: "#fff",
          bold: !isLeaf,
          opacity: derive(() => {
            if (!present.value) return 0;
            if (isCurrentRoot.value) return 0;
            const sweep = a1.value - a0.value;
            const r = (r0.value + r1.value) / 2;
            const arcLen = sweep * r;
            return arcLen > 26 ? 1 : 0;
          }),
        }),
      );
    }
  }
}
