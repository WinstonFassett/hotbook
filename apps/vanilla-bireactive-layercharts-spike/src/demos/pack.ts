import {
  Anchor,
  Diagram,
  derive,
  label,
  type Mount,
  cell,
  circle,
  Vec,
} from "bireactive";
import { pack as d3pack, type HierarchyCircularNode } from "d3-hierarchy";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode } from "../lib/tree";
import { portfolio, walkWithDepth } from "../lib/portfolio";
import { attachChartGestures, type SelectionState } from "../lib/gestures";

const W = 480;
const H = 480;
const PAD = 2;

export class MdPack extends Diagram {
  externalRoot?: BiNode
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    this.tabIndex = 0;
    this.style.outline = "none";

    const root = this.externalRoot ?? portfolio();
    const parentIdx = buildParentIndex(root);
    const parentOf = (n: BiNode) => parentIdx.get(n);

    const state: SelectionState = {
      focused: cell<BiNode | null>(null),
      hovered: { current: null },
      wheelLocked: { current: null },
    };
    attachChartGestures(this, { root, parentOf, state });

    const layout = derive(() => {
      const h = buildHierarchy(root);
      d3pack<BiNode>().size([W, H]).padding(PAD)(h);
      const map = new Map<BiNode, HierarchyCircularNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyCircularNode<BiNode>));
      return map;
    });

    for (const { node, depth, isLeaf } of walkWithDepth(root)) {
      const cx = derive(() => layout.value.get(node)?.x ?? 0);
      const cy = derive(() => layout.value.get(node)?.y ?? 0);
      const r = derive(() => layout.value.get(node)?.r ?? 0);
      const stroke = derive(() =>
        state.focused.value === node ? "#fff" : depth === 0 ? "#444" : "#0b0d12",
      );

      const disc = s(
        circle(Vec.derive(() => ({ x: cx.value, y: cy.value })), r, {
          fill: node.value.color,
          opacity: depth === 0 ? 0.12 : isLeaf ? 0.95 : 0.4,
          stroke,
          thin: true,
        }),
      );
      disc.el.style.cursor = "pointer";
      disc.el.addEventListener("click", () => { state.focused.value = node; });
      disc.el.addEventListener("pointerenter", () => { state.hovered.current = node; });
      disc.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) state.hovered.current = null; });

      if (isLeaf) {
        const text = derive(() => {
          const r0 = layout.value.get(node)?.r ?? 0;
          if (r0 <= 14) return "";
          return `${node.value.label}\n${node.value.total.value.toFixed(0)}`;
        });
        s(label(Vec.derive(() => ({ x: cx.value, y: cy.value })), text, {
          size: 10, align: Anchor.Center, fill: "#fff",
        }));
      }
    }

    if (!this.hasAttribute('no-source')) s(label(view.bottom.up(10), derive(() => {
      const f = state.focused.value;
      return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));
  }
}
