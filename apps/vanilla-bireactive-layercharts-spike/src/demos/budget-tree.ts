// Reference demo (ported from upstream bireactive site/elements/md-budget-tree.ts).
// Proves the drag + Num.lens + Vec.lens boundary-knob pattern resolves from the
// published bireactive@0.3.4 package, and serves as the canonical reference for
// the icicle/sunburst/radial resize handles.
//
// Nested budget as a stacked-bar treemap over a Tree<Num>: each internal node is
// a sum aggregate, so dragging a boundary redistributes and parent totals update.

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
  type TreeNode,
  treeNode,
  Vec,
  type Writable,
} from "bireactive";

interface Category {
  label: string;
  total: Writable<Num>;
  leaves: { label: string; cell: Writable<Num> }[];
}

interface Budget {
  rootTotal: Writable<Num>;
  categories: Category[];
}

function redistribute(target: number, vs: readonly number[]): number[] {
  const cur = vs.reduce((a, b) => a + b, 0);
  if (cur === 0) {
    const even = target / vs.length;
    return vs.map(() => even);
  }
  const scale = target / cur;
  return vs.map((v) => v * scale);
}

function makeBudget(): Budget {
  const data: Array<[string, Array<[string, number]>]> = [
    ["Housing", [["Rent", 300], ["Utilities", 100]]],
    ["Food", [["Groceries", 150], ["Dining", 150]]],
    ["Entertainment", [["Subscriptions", 200], ["Events", 100]]],
  ];

  const categories: Category[] = data.map(([catLabel, leafSpecs]) => {
    const leaves = leafSpecs.map(([label, v]) => ({ label, cell: num(v) }));
    const total = Num.lens(
      leaves.map((l) => l.cell),
      (vs: readonly number[]) => vs.reduce((a, b) => a + b, 0),
      redistribute,
    );
    return { label: catLabel, total, leaves };
  });

  const rootTotal = Num.lens(
    categories.map((c) => c.total),
    (vs: readonly number[]) => vs.reduce((a, b) => a + b, 0),
    redistribute,
  );

  return { rootTotal, categories };
}

function asTree(budget: Budget): TreeNode<Writable<Num>> {
  return treeNode(
    budget.rootTotal,
    budget.categories.map((c) =>
      treeNode(c.total, c.leaves.map((l) => treeNode(l.cell))),
    ),
  );
}

const W = 700;
const H = 280;
const PAD_X = 20;
const ROW_H = 56;
const ROW_GAP = 12;
const Y_ROOT = 60;
const Y_CAT = Y_ROOT + ROW_H + ROW_GAP;
const Y_LEAF = Y_CAT + ROW_H + ROW_GAP;
const BAR_X0 = PAD_X;
const BAR_W = W - 2 * PAD_X;

const CAT_FILLS = ["#5b8def", "#7ed321", "#e25c5c"];
const LEAF_FILLS = ["#a8c5f7", "#d0eea1", "#f3a4a4", "#bdd5f9", "#bce096", "#f2b8b8"];

export class MdBudgetTree extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    const budget = makeBudget();
    void asTree(budget);

    s(
      label(
        view.top.down(20),
        "drag any boundary — adjacent rectangles redistribute; parent totals update via sum",
      ),
    );

    this.renderRow(s, Y_ROOT, BAR_X0, BAR_W, [budget.rootTotal], ["TOTAL"], ["#222"], true);

    const catCells = budget.categories.map((c) => c.total);
    const catLabels = budget.categories.map((c) => c.label);
    this.renderRow(s, Y_CAT, BAR_X0, BAR_W, catCells, catLabels, CAT_FILLS, false);

    const leafCells: Writable<Num>[] = [];
    const leafLabels: string[] = [];
    const leafFills: string[] = [];
    let f = 0;
    for (const c of budget.categories) {
      for (const l of c.leaves) {
        leafCells.push(l.cell);
        leafLabels.push(l.label);
        leafFills.push(LEAF_FILLS[f % LEAF_FILLS.length]!);
        f++;
      }
    }
    this.renderRow(s, Y_LEAF, BAR_X0, BAR_W, leafCells, leafLabels, leafFills, false);

    s(
      label(
        view.bottom.up(14),
        "sum aggregate at each non-leaf: read = Σchildren; write = redistribute proportionally · invariant: every row's total width is equal",
        { size: 10 },
      ),
    );
  }

  private renderRow(
    s: Mount,
    y: number,
    x0: number,
    w: number,
    cells: readonly Writable<Num>[],
    labels: readonly string[],
    fills: readonly string[],
    isTotalRow: boolean,
  ): void {
    const total = derive(() => cells.reduce((a, c) => a + c.value, 0));
    const widthOf = (i: number) =>
      derive(() => (cells[i]!.value / Math.max(total.value, 1e-9)) * w);
    const leftX = (i: number): Num =>
      Num.derive(() => {
        let acc = x0;
        for (let j = 0; j < i; j++) {
          acc += (cells[j]!.value / Math.max(total.value, 1e-9)) * w;
        }
        return acc;
      });

    for (let i = 0; i < cells.length; i++) {
      const lx = leftX(i);
      const wd = widthOf(i);
      const opacity = isTotalRow ? 0.85 : 1;
      s(rect(lx, y, wd, ROW_H, { fill: fills[i]!, opacity, stroke: "#222", thin: true }));
      const cyTop = y + 16;
      const cyMid = y + ROW_H - 14;
      const labelTop = Vec.derive(() => ({ x: lx.value + wd.value / 2, y: cyTop }));
      const labelMid = Vec.derive(() => ({ x: lx.value + wd.value / 2, y: cyMid }));
      s(
        label(labelTop, labels[i]!, {
          size: 11,
          bold: true,
          align: Anchor.Center,
          fill: isTotalRow ? "#fff" : "#111",
          opacity: derive(() => (wd.value > 50 ? 1 : 0)),
        }),
        label(labelMid, derive(() => `$${Math.round(cells[i]!.value)}`), {
          size: 11,
          align: Anchor.Center,
          fill: isTotalRow ? "#fff" : "#222",
          opacity: derive(() => (wd.value > 40 ? 0.95 : 0)),
        }),
      );
    }

    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1]!;
      const b = cells[i]!;
      const knob = Vec.lens(
        [a, b, leftX(i - 1)] as const,
        (vals: readonly [number, number, number]) => {
          const [va, vb, leftI1] = vals;
          const sumAB = va + vb;
          return { x: leftI1 + (va / sumAB) * (sumAB / total.peek()) * w, y: y + ROW_H / 2 };
        },
        (target, vals) => {
          const [va, vb, leftI1] = vals;
          const sumAB = va + vb;
          if (sumAB === 0) return [0, 0];
          const totalRow = total.peek();
          const widthAB = (sumAB / totalRow) * w;
          const newAWPx = Math.max(0, Math.min(widthAB, target.x - leftI1));
          const newAValue = (newAWPx / widthAB) * sumAB;
          return [newAValue, sumAB - newAValue];
        },
      );
      const PILL_W = 6;
      const PILL_H = Math.round(ROW_H * (2 / 3));
      const PILL_Y = y + (ROW_H - PILL_H) / 2;
      const pillX = Num.derive(() => knob.value.x - PILL_W / 2);
      const pillShape = s(
        rect(pillX, PILL_Y, PILL_W, PILL_H, {
          fill: "black",
          stroke: "black",
          thin: true,
          corner: PILL_W / 2,
          opacity: 0.85,
        }),
      );
      drag(pillShape, knob);
      pillShape.el.style.cursor = "ew-resize";
    }
  }
}
