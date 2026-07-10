import {
  Num,
  num,
  treeNode,
  walkTree,
  leavesOf,
  type TreeNode,
  type Writable,
} from "bireactive";

export interface NodeValue {
  id: string;
  label: string;
  color: string;
  total: Writable<Num>;
  /** Optional: all measures keyed by name. For backward compat, may be undefined. */
  measures?: Record<string, Writable<Num>>;
}

export type BiNode = TreeNode<NodeValue>;

export function leaf(id: string, label: string, value: number, color: string): BiNode {
  const total = num(value);
  return treeNode({ id, label, color, total, measures: { total } });
}

export function group(id: string, label: string, color: string, children: BiNode[]): BiNode {
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
  return treeNode({ id, label, color, total, measures: { total } }, children);
}

export function leaves(root: BiNode): BiNode[] {
  return leavesOf(root);
}

export function buildParentIndex(root: BiNode): WeakMap<BiNode, BiNode> {
  const idx = new WeakMap<BiNode, BiNode>();
  walkTree(root, (n) => {
    for (const c of n.children) idx.set(c as BiNode, n as BiNode);
  });
  return idx;
}

export function walkWithDepth(root: BiNode): Array<{ node: BiNode; depth: number; isLeaf: boolean }> {
  const out: Array<{ node: BiNode; depth: number; isLeaf: boolean }> = [];
  const walk = (n: BiNode, depth: number) => {
    out.push({ node: n, depth, isLeaf: n.children.length === 0 });
    (n.children as BiNode[]).forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
  return out;
}

export function portfolio(): BiNode {
  return group("portfolio", "Portfolio", "#222", [
    group("tech", "Tech", "#5b8def", [
      leaf("aapl", "AAPL", 35, "#86acf5"),
      leaf("msft", "MSFT", 28, "#86acf5"),
      leaf("nvda", "NVDA", 22, "#86acf5"),
    ]),
    group("finance", "Finance", "#7ed321", [
      leaf("jpm", "JPM", 18, "#a6df5e"),
      leaf("brk", "BRK", 14, "#a6df5e"),
    ]),
    group("energy", "Energy", "#f5a623", [
      leaf("xom", "XOM", 10, "#f7be5a"),
      leaf("shel", "SHEL", 8, "#f7be5a"),
    ]),
    group("health", "Health", "#e25c5c", [
      leaf("jnj", "JNJ", 9, "#ec8a8a"),
      leaf("pfe", "PFE", 6, "#ec8a8a"),
    ]),
  ]);
}
