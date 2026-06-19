import {
  Anchor,
  Diagram,
  derive,
  label,
  type Mount,
  cell,
  annularSector,
  Vec,
} from "bireactive";
import { partition, type HierarchyRectangularNode } from "d3-hierarchy";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode } from "../lib/tree";
import { portfolio, walkWithDepth } from "../lib/portfolio";
import { attachChartGestures, type SelectionState } from "../lib/gestures";

const W = 480;
const H = 480;
const R = Math.min(W, H) / 2 - 4;

export class MdSunburstLC extends Diagram {
  static styles = `text { pointer-events: none; }`
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
      partition<BiNode>().size([2 * Math.PI, R])(h);
      const map = new Map<BiNode, HierarchyRectangularNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyRectangularNode<BiNode>));
      return map;
    });

    const center = Vec.derive(() => ({ x: W / 2, y: H / 2 }));

    for (const { node, depth, isLeaf } of walkWithDepth(root)) {
      if (depth === 0) continue;
      const a0 = derive(() => layout.value.get(node)?.x0 ?? 0);
      const a1 = derive(() => layout.value.get(node)?.x1 ?? 0);
      const rIn = derive(() => layout.value.get(node)?.y0 ?? 0);
      const rOut = derive(() => layout.value.get(node)?.y1 ?? 0);
      const stroke = derive(() => (state.focused.value === node ? "#fff" : "#0b0d12"));

      const arc = s(annularSector(center, rOut, rIn, a0, a1, {
        fill: node.value.color,
        opacity: isLeaf ? 0.95 : 0.5,
        stroke,
        thin: true,
      }));
      arc.el.style.cursor = "pointer";
      arc.el.addEventListener("click", () => { state.focused.value = node; });
      arc.el.addEventListener("pointerenter", () => { state.hovered.current = node; });
      arc.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) state.hovered.current = null; });
    }

    if (!this.hasAttribute('no-source')) s(label(view.bottom.up(10), derive(() => {
      const f = state.focused.value;
      return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));
  }
}
