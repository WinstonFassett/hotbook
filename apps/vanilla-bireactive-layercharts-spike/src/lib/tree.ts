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
  label: string;
  color: string;
  total: Writable<Num>;
}

export type BiNode = TreeNode<NodeValue>;

export function leaf(label: string, value: number, color: string): BiNode {
  return treeNode({ label, color, total: num(value) });
}

export function group(label: string, color: string, children: BiNode[]): BiNode {
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
