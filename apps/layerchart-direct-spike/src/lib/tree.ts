// The writable hierarchy used by all demos. Same shape as the bireactive
// spike's treemap — Num.lens at branches gives automatic sum aggregation
// AND a sum-redistribute inverse for writes.
//
// Cells live module-scope so multiple component instances see the same
// writable tree. This is the "shared cells = shared updates" property
// that bireactive uniquely gives us — no event plumbing required.

import { Num, num, type Writable } from "bireactive";

export interface BiNode {
  label: string;
  color: string;
  total: Writable<Num>;
  children?: BiNode[];
}

function leaf(label: string, value: number, color: string): BiNode {
  return { label, color, total: num(value) };
}

function group(label: string, color: string, children: BiNode[]): BiNode {
  const total = Num.lens(
    children.map((c) => c.total),
    (vs: readonly number[]) => vs.reduce((a, b) => a + b, 0),
    (target, vs) => {
      const arr = vs as readonly number[];
      const cur = arr.reduce((a, b) => a + b, 0);
      if (cur === 0) return arr.map(() => target / arr.length) as never;
      const scale = target / cur;
      return arr.map((v) => v * scale) as never;
    },
  );
  return { label, color, total, children };
}

/** Build the shared portfolio tree once. */
export const sharedTree: BiNode = group("Portfolio", "#222", [
  group("Tech", "#5b8def", [
    leaf("AAPL", 35, "#86acf5"),
    leaf("MSFT", 28, "#86acf5"),
    leaf("NVDA", 22, "#86acf5"),
  ]),
  group("Finance", "#7ed321", [
    leaf("JPM", 18, "#a6df5e"),
    leaf("BRK", 14, "#a6df5e"),
  ]),
  group("Energy", "#f5a623", [
    leaf("XOM", 10, "#f7be5a"),
    leaf("SHEL", 8, "#f7be5a"),
  ]),
  group("Health", "#e25c5c", [
    leaf("JNJ", 9, "#ec8a8a"),
    leaf("PFE", 6, "#ec8a8a"),
  ]),
]);

/** All leaves, in source order. Useful for cmd+wheel scrub on focused leaf. */
export function leaves(root: BiNode): BiNode[] {
  const out: BiNode[] = [];
  const walk = (n: BiNode) => {
    if (!n.children) out.push(n);
    else n.children.forEach(walk);
  };
  walk(root);
  return out;
}

export function parentOf(root: BiNode, target: BiNode): BiNode | undefined {
  if (!root.children) return undefined;
  if (root.children.includes(target)) return root;
  for (const c of root.children) {
    const p = parentOf(c, target);
    if (p) return p;
  }
  return undefined;
}
