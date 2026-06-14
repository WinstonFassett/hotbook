import { hierarchy } from "d3-hierarchy";
import { effect as biEffect } from "bireactive";
import { leaves, type BiNode } from "./tree";

export function applyDelta(node: BiNode, parent: BiNode | undefined, delta: number): void {
  if (!parent || parent.children.length === 0) return;
  const siblings = parent.children.filter((c) => c !== node) as BiNode[];
  const cur = node.value.total.value;
  const next = Math.max(0, cur + delta);
  const real = next - cur;
  if (real === 0) return;
  node.value.total.value = next;
  let remaining = real;
  if (real > 0) {
    const pool = siblings.filter((s) => s.value.total.value > 0);
    const poolSum = pool.reduce((a, b) => a + b.value.total.value, 0);
    if (poolSum > 0) {
      for (const sib of pool) {
        const share = (sib.value.total.value / poolSum) * real;
        const take = Math.min(sib.value.total.value, share);
        sib.value.total.value -= take;
        remaining -= take;
      }
      for (const sib of siblings) {
        if (remaining <= 0) break;
        const take = Math.min(sib.value.total.value, remaining);
        sib.value.total.value -= take;
        remaining -= take;
      }
    }
  } else if (siblings.length > 0) {
    const sibSum = siblings.reduce((a, b) => a + b.value.total.value, 0);
    if (sibSum > 0) {
      for (const sib of siblings) {
        const share = (sib.value.total.value / sibSum) * -real;
        sib.value.total.value += share;
      }
    } else {
      for (const sib of siblings) sib.value.total.value += -real / siblings.length;
    }
  }
}

export function flatOrder(root: BiNode): BiNode[] {
  const out: BiNode[] = [];
  const walk = (n: BiNode) => {
    if (n !== root) out.push(n);
    (n.children as BiNode[]).forEach(walk);
  };
  walk(root);
  return out;
}

export function buildHierarchy(root: BiNode) {
  return hierarchy<BiNode>(root, (n) => n.children as BiNode[])
    .sum((n) => (n.children.length > 0 ? 0 : n.value.total.value));
}

export function subscribeAllLeaves(root: BiNode, onChange: () => void): () => void {
  const allLeaves = leaves(root);
  return biEffect(() => {
    for (const l of allLeaves) void l.value.total.value;
    onChange();
  });
}

export function installGestureRelease(release: () => void): () => void {
  const onKeyup = (e: KeyboardEvent) => {
    if (e.key === "Meta" || e.key === "Control" || (!e.metaKey && !e.ctrlKey)) {
      release();
    }
  };
  const onBlur = () => release();
  window.addEventListener("keyup", onKeyup);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keyup", onKeyup);
    window.removeEventListener("blur", onBlur);
  };
}
