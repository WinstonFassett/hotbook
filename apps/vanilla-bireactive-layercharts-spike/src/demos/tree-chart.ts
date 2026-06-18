import {
  Anchor,
  Diagram,
  derive,
  label,
  type Mount,
  cell,
  circle,
  line,
  Vec,
} from "bireactive";
import { tree, type HierarchyPointNode } from "d3-hierarchy";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode } from "../lib/tree";
import { portfolio, walkWithDepth } from "../lib/portfolio";
import { attachChartGestures, type SelectionState } from "../lib/gestures";

const W = 560;
const H = 400;
const PAD_TOP = 40;
const PAD_BOTTOM = 40;
const PAD_LEFT = 60;
const PAD_RIGHT = 60;

export class MdTreeChart extends Diagram {
  externalRoot?: BiNode;
  protected scene(s: Mount): void {
    const root = this.externalRoot ?? portfolio();

    // Scale canvas to data size
    const allNodes = [...walkWithDepth(root)];
    const leafCount = allNodes.filter(n => n.isLeaf).length;
    const maxDepth = allNodes.reduce((m, n) => Math.max(m, n.depth), 0);
    const cW = Math.max(W, leafCount * 20 + PAD_LEFT + PAD_RIGHT);
    const cH = Math.max(H, maxDepth * 80 + PAD_TOP + PAD_BOTTOM);

    const view = this.view(cW, cH);
    this.tabIndex = 0;
    this.style.outline = "none";

    const parentIdx = buildParentIndex(root);
    const parentOf = (n: BiNode) => parentIdx.get(n);

    const state: SelectionState = {
      focused: cell<BiNode | null>(null),
      hovered: { current: null },
      wheelLocked: { current: null },
    };
    attachChartGestures(this, { root, parentOf, state });

    // tree() layout: assigns .x (0..1) and .y (depth) per node
    const layout = derive(() => {
      const h = buildHierarchy(root);
      tree<BiNode>().size([
        cW - PAD_LEFT - PAD_RIGHT,
        cH - PAD_TOP - PAD_BOTTOM,
      ])(h);
      const map = new Map<BiNode, HierarchyPointNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyPointNode<BiNode>));
      return map;
    });

    // Draw edges first (under nodes)
    for (const { node, depth } of walkWithDepth(root)) {
      if (depth === 0) continue;
      const parent = parentOf(node);
      if (!parent) continue;

      const from = Vec.derive(() => {
        const p = layout.value.get(parent);
        return { x: PAD_LEFT + (p?.x ?? 0), y: PAD_TOP + (p?.y ?? 0) };
      });
      const to = Vec.derive(() => {
        const nd = layout.value.get(node);
        return { x: PAD_LEFT + (nd?.x ?? 0), y: PAD_TOP + (nd?.y ?? 0) };
      });

      s(line(from, to, { stroke: "#3a3f4a", thin: true }));
    }

    // Draw nodes (circles + labels)
    for (const { node, depth, isLeaf } of walkWithDepth(root)) {
      const cx = Vec.derive(() => {
        const nd = layout.value.get(node);
        return { x: PAD_LEFT + (nd?.x ?? 0), y: PAD_TOP + (nd?.y ?? 0) };
      });

      const r = isLeaf ? 6 : 5;
      const stroke = derive(() =>
        state.focused.value === node ? "#fff" : node.value.color,
      );

      const circ = s(
        circle(cx, r, {
          fill: node.value.color,
          opacity: isLeaf ? 0.95 : 0.7,
          stroke,
          thin: true,
        }),
      );
      circ.el.style.cursor = "pointer";
      circ.el.addEventListener("click", () => {
        state.focused.value = node;
      });
      circ.el.addEventListener("pointerenter", () => {
        state.hovered.current = node;
      });
      circ.el.addEventListener("pointerleave", () => {
        if (state.hovered.current === node) state.hovered.current = null;
      });

      // Label: leaves get value appended; root gets label only
      const text = derive(() => {
        if (depth === 0) return node.value.label;
        return isLeaf
          ? `${node.value.label}\n${node.value.total.value.toFixed(0)}`
          : node.value.label;
      });

      // Alternate label placement: leaves to the right, inner nodes above
      const labelPos = Vec.derive(() => {
        const nd = layout.value.get(node);
        const nx = PAD_LEFT + (nd?.x ?? 0);
        const ny = PAD_TOP + (nd?.y ?? 0);
        return isLeaf
          ? { x: nx, y: ny + 16 }
          : { x: nx, y: ny - 12 };
      });

      s(
        label(labelPos, text, {
          size: isLeaf ? 10 : 9,
          align: Anchor.Center,
          fill: "#c8cdd6",
          bold: !isLeaf,
        }),
      );
    }

    if (!this.hasAttribute('no-source')) s(
      label(
        view.bottom.up(10),
        derive(() => {
          const f = state.focused.value;
          return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab`;
        }),
        { size: 10, align: Anchor.Center, fill: "#9aa0a8" },
      ),
    );
  }
}
