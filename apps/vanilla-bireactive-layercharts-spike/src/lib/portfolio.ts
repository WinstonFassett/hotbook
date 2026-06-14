import { group, leaf, type BiNode } from "./tree";

export function portfolio(): BiNode {
  return group("Portfolio", "#222", [
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
