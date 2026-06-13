// Partition — bireactive port of LayerChart's <Partition> shape. One layout
// call (d3-partition), two recipes: MdIcicle (vertical rectangles) and
// MdSunburst (polar arcs via annularSector). Both follow the treemap.ts /
// pack.ts pattern: forward layout over a snapshot of writable Num leaves;
// backward write via the same sum-redistribute lens; drill-in via chart-context
// focus.

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
  annularSector,
  vec,
} from "bireactive";
import { hierarchy, partition as d3partition } from "d3-hierarchy";
import { chartContext, project } from "../kit/chart-context";

const W = 760;
const H = 420;
const TX = 20;
const TY = 40;
const TW = W - 40;
const TH = H - 90;
const RADIUS = Math.min(TW, TH) / 2 - 20;

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

interface Cell { node: Node; x0: number; y0: number; x1: number; y1: number; depth: number }

function computeLayout(
  root: Node,
  sizeX: number,
  sizeY: number,
  padding: number,
): Cell[] {
  const h = hierarchy<Node>(root, n => n.children)
    .sum(n => (n.children ? 0 : n.total.value));

  const laid = d3partition<Node>()
    .size([sizeX, sizeY])
    .padding(padding)(h);

  const cells: Cell[] = [];
  laid.each(d => {
    cells.push({
      node: d.data,
      x0: d.x0,
      y0: d.y0,
      x1: d.x1,
      y1: d.y1,
      depth: d.depth,
    });
  });
  return cells;
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

function walkAll(tree: Node): { node: Node; isLeaf: boolean; depth: number }[] {
  const out: { node: Node; isLeaf: boolean; depth: number }[] = [];
  const walk = (n: Node, depth: number): void => {
    out.push({ node: n, isLeaf: !n.children, depth });
    n.children?.forEach(c => walk(c, depth + 1));
  };
  walk(tree, 0);
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// MdIcicle — vertical rectangles
// ────────────────────────────────────────────────────────────────────────────

export class MdIcicle extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    const tree = makeTree();

    const ctx = chartContext(TW, TH);
    const drillStack: { x0: number; y0: number; x1: number; y1: number }[] = [];

    s(
      label(view.top.down(20), "icicle · click a branch to drill in · Esc to pop · drag a leaf to reapportion", { size: 11, bold: true, align: Anchor.Center }),
      label(view.bottom.up(28), derive(() => `total: ${tree.total.value.toFixed(0)} · drill depth: ${drillStack.length}`), { size: 10, align: Anchor.Center }),
      label(view.bottom.up(12), "R16: focus domain tweens on commit (snap for now; spring next iteration)", { size: 9, fill: "#9aa0a8", align: Anchor.Center }),
    );

    const layout = derive(() => {
      const cells = computeLayout(tree, TW, TH, 1);
      const byNode = new Map<Node, Cell>();
      for (const c of cells) byNode.set(c.node, c);
      return byNode;
    });

    const cellFor = (node: Node) =>
      derive(() => layout.value.get(node) ?? { node, x0: 0, y0: 0, x1: 0, y1: 0, depth: 0 });

    const allNodes = walkAll(tree);

    const drillTo = (c: Cell) => {
      drillStack.push({
        x0: ctx.focus.x0.value,
        y0: ctx.focus.y0.value,
        x1: ctx.focus.x1.value,
        y1: ctx.focus.y1.value,
      });
      ctx.zoomTo({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
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

    for (const { node, isLeaf, depth } of allNodes) {
      const c = cellFor(node);
      const x = derive(() =>
        TX + project(c.value.x0, ctx.focus.x0.value, ctx.focus.x1.value, 0, TW),
      );
      const y = derive(() =>
        TY + project(c.value.y0, ctx.focus.y0.value, ctx.focus.y1.value, 0, TH),
      );
      const x1 = derive(() =>
        TX + project(c.value.x1, ctx.focus.x0.value, ctx.focus.x1.value, 0, TW),
      );
      const y1 = derive(() =>
        TY + project(c.value.y1, ctx.focus.y0.value, ctx.focus.y1.value, 0, TH),
      );
      const w = derive(() => Math.max(0, x1.value - x.value));
      const h = derive(() => Math.max(0, y1.value - y.value));

      s(
        rect(x, y, w, h, {
          fill: node.color,
          opacity: depth === 0 ? 0.12 : isLeaf ? 0.95 : 0.45,
          stroke: depth === 0 ? "#444" : "#0b0d12",
          thin: true,
          corner: 2,
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
              y: y.value + h.value / 2,
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

      if (!isLeaf && depth > 0) {
        const branchHit = s(
          rect(x, y, w, h, { fill: "transparent", stroke: "transparent" }),
        );
        branchHit.el.style.cursor = "zoom-in";
        branchHit.el.addEventListener("click", (e) => {
          e.stopPropagation();
          drillTo(c.value);
        });
      }

      if (isLeaf) {
        const hit = s(
          rect(x, y, w, h, { fill: "transparent", stroke: "transparent" }),
        );
        hit.el.setAttribute("tabindex", "0");
        hit.el.style.outline = "none";
        hit.el.style.cursor = "move";

        const parent = parentOf(tree, node);

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

// ────────────────────────────────────────────────────────────────────────────
// MdSunburst — polar arcs via annularSector
//
// Layout uses size=[2π, RADIUS] so x0/x1 come back as radians directly and
// y0/y1 as pixel radii. Focus is reused as a polar window: focus.x is angle,
// focus.y is radius. Inline polar projection per spec § 5.1.
//
// Drag-to-reapportion: skipped for first iteration (polar drag math is
// non-trivial). Arrow keys / Alt+wheel still wired for leaf value editing.
// ────────────────────────────────────────────────────────────────────────────

export class MdSunburst extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    const tree = makeTree();

    // ctx.focus uses [angle, radius] domain space.
    const ctx = chartContext(2 * Math.PI, RADIUS);
    const drillStack: { x0: number; y0: number; x1: number; y1: number }[] = [];

    s(
      label(view.top.down(20), "sunburst · click a branch to drill in · Esc to pop · arrows/Alt+wheel on a leaf to edit", { size: 11, bold: true, align: Anchor.Center }),
      label(view.bottom.up(28), derive(() => `total: ${tree.total.value.toFixed(0)} · drill depth: ${drillStack.length}`), { size: 10, align: Anchor.Center }),
      label(view.bottom.up(12), "R16: focus domain tweens on commit (snap for now; spring next iteration)", { size: 9, fill: "#9aa0a8", align: Anchor.Center }),
    );

    const cx = TX + TW / 2;
    const cy = TY + TH / 2;
    const center = vec(cx, cy);

    const layout = derive(() => {
      // size=[2π, RADIUS] → x is angle (radians), y is radius (px).
      const cells = computeLayout(tree, 2 * Math.PI, RADIUS, 0.005);
      const byNode = new Map<Node, Cell>();
      for (const c of cells) byNode.set(c.node, c);
      return byNode;
    });

    const cellFor = (node: Node) =>
      derive(() => layout.value.get(node) ?? { node, x0: 0, y0: 0, x1: 0, y1: 0, depth: 0 });

    const allNodes = walkAll(tree);

    const drillTo = (c: Cell) => {
      drillStack.push({
        x0: ctx.focus.x0.value,
        y0: ctx.focus.y0.value,
        x1: ctx.focus.x1.value,
        y1: ctx.focus.y1.value,
      });
      ctx.zoomTo({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
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

    for (const { node, isLeaf, depth } of allNodes) {
      if (depth === 0) continue; // skip root disc

      const c = cellFor(node);

      // Project angle/radius bounds through ctx.focus into rendered space.
      // Angle domain is focus.x; radius domain is focus.y → mapped to [0, RADIUS].
      const a0 = derive(() =>
        project(c.value.x0, ctx.focus.x0.value, ctx.focus.x1.value, 0, 2 * Math.PI) - Math.PI / 2,
      );
      const a1 = derive(() =>
        project(c.value.x1, ctx.focus.x0.value, ctx.focus.x1.value, 0, 2 * Math.PI) - Math.PI / 2,
      );
      const rInner = derive(() =>
        Math.max(0, project(c.value.y0, ctx.focus.y0.value, ctx.focus.y1.value, 0, RADIUS)),
      );
      const rOuter = derive(() =>
        Math.max(0, project(c.value.y1, ctx.focus.y0.value, ctx.focus.y1.value, 0, RADIUS)),
      );

      s(
        annularSector(center, rOuter, rInner, a0, a1, {
          fill: node.color,
          opacity: isLeaf ? 0.95 : 0.5,
          stroke: "#0b0d12",
          thin: true,
        }),
      );

      // Label at arc midpoint if arc is big enough.
      const labelText = isLeaf
        ? derive(() => `${node.label} ${node.total.value.toFixed(0)}`)
        : derive(() => node.label);
      s(
        label(
          Vec.derive(() => {
            const aMid = (a0.value + a1.value) / 2;
            const rMid = (rInner.value + rOuter.value) / 2;
            return { x: cx + Math.cos(aMid) * rMid, y: cy + Math.sin(aMid) * rMid };
          }),
          labelText,
          {
            size: isLeaf ? 10 : 10,
            align: Anchor.Center,
            fill: "#fff",
            bold: !isLeaf,
            opacity: derive(() => {
              const aSpan = Math.abs(a1.value - a0.value);
              const rSpan = Math.abs(rOuter.value - rInner.value);
              return aSpan > 0.1 && rSpan > 20 ? 1 : 0;
            }),
          },
        ),
      );

      // Branch hit: clickable to drill in. We layer a transparent annular
      // sector on top to catch clicks (and supply cursor styling).
      if (!isLeaf) {
        const branchHit = s(
          annularSector(center, rOuter, rInner, a0, a1, {
            fill: "transparent",
            stroke: "transparent",
          }),
        );
        branchHit.el.style.cursor = "zoom-in";
        branchHit.el.addEventListener("click", (e) => {
          e.stopPropagation();
          drillTo(c.value);
        });
      }

      if (isLeaf) {
        const hit = s(
          annularSector(center, rOuter, rInner, a0, a1, {
            fill: "transparent",
            stroke: "transparent",
          }),
        );
        hit.el.setAttribute("tabindex", "0");
        hit.el.style.outline = "none";
        hit.el.style.cursor = "pointer";

        const parent = parentOf(tree, node);
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
        const siblings = parent?.children?.filter(s => s !== node) ?? [];

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
      }
    }
  }
}
