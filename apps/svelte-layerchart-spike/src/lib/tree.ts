// The writable hierarchy used by all demos. Now expressed via bireactive's
// TreeNode<T> + node() constructor (see inspo/bireactive/src/tree.ts), with
// our payload (label/color/total) living in `value`. The Num.lens at each
// branch gives sum aggregation AND a sum-redistribute inverse for writes —
// the AGGREGATE pattern documented in bireactive/tree.

import { Num, num, treeNode, walkTree, leavesOf, type TreeNode, type Writable } from "bireactive";

export interface NodeValue {
  label: string;
  color: string;
  total: Writable<Num>;
}

export type BiNode = TreeNode<NodeValue>;

function leaf(label: string, value: number, color: string): BiNode {
  return treeNode({ label, color, total: num(value) });
}

function group(label: string, color: string, children: BiNode[]): BiNode {
  const total = Num.lens(
    children.map((c) => c.value.total),
    (vs: readonly number[]) => vs.reduce((a, b) => a + b, 0),
    (target, vs) => {
      const arr = vs as readonly number[];
      const cur = arr.reduce((a, b) => a + b, 0);
      if (cur === 0) return arr.map(() => target / arr.length) as never;
      const scale = target / cur;
      return arr.map((v) => v * scale) as never;
    },
  );
  return treeNode({ label, color, total }, children);
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
  return leavesOf(root);
}

// WeakMap parent index. Built lazily from the current tree shape. Bireactive's
// TreeNode is structurally immutable; if the topology is rebuilt (network()),
// rebuild the index. For now sharedTree is fixed-shape so a one-shot index is fine.
const parentIndex = new WeakMap<BiNode, BiNode>();
{
  const indexFrom = (root: BiNode) => {
    walkTree(root, (n) => {
      for (const c of n.children) parentIndex.set(c as BiNode, n as BiNode);
    });
  };
  indexFrom(sharedTree);
}

export function parentOf(_root: BiNode, target: BiNode): BiNode | undefined {
  return parentIndex.get(target);
}
