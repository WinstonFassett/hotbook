import { group, leaf, type BiNode } from "@hotbook/bireactive";

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

export function walkWithDepth(root: BiNode): Array<{ node: BiNode; depth: number; isLeaf: boolean }> {
  const out: Array<{ node: BiNode; depth: number; isLeaf: boolean }> = [];
  const walk = (n: BiNode, depth: number) => {
    out.push({ node: n, depth, isLeaf: n.children.length === 0 });
    (n.children as BiNode[]).forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
  return out;
}
