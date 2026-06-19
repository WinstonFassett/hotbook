import {
  Anchor,
  Diagram,
  derive,
  label,
  type Mount,
  cell,
  rect,
  Vec,
} from "bireactive";
import { treemap, treemapSquarify, type HierarchyRectangularNode } from "d3-hierarchy";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode } from "../lib/tree";
import { portfolio, walkWithDepth } from "../lib/portfolio";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { useHostSize, FILL_STYLE } from "../lib/host-size";

const W = 720;
const H = 360;
const PAD_OUTER = 4;
const PAD_INNER = 2;
const PAD_TOP = 16;

export class MdTreemapLC extends Diagram {
  static styles = `text { pointer-events: none; }${FILL_STYLE}`
  externalRoot?: BiNode
  protected scene(s: Mount): void {
    const { w: Wc, h: Hc } = useHostSize(this, { width: W, height: H });
    const view = this.view(Wc, Hc);
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
    const hoverCell = cell<BiNode | null>(null);
    state.hoverCell = hoverCell;

    const layout = derive(() => {
      const h = buildHierarchy(root);
      treemap<BiNode>()
        .tile(treemapSquarify)
        .size([Wc.value, Hc.value])
        .paddingOuter(PAD_OUTER)
        .paddingInner(PAD_INNER)
        .paddingTop(PAD_TOP)
        .round(false)(h);
      const map = new Map<BiNode, HierarchyRectangularNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyRectangularNode<BiNode>));
      return map;
    });

    for (const { node, depth, isLeaf } of walkWithDepth(root)) {
      const x = derive(() => layout.value.get(node)?.x0 ?? 0);
      const y = derive(() => layout.value.get(node)?.y0 ?? 0);
      const w = derive(() => Math.max(0, (layout.value.get(node)?.x1 ?? 0) - (layout.value.get(node)?.x0 ?? 0)));
      const h = derive(() => Math.max(0, (layout.value.get(node)?.y1 ?? 0) - (layout.value.get(node)?.y0 ?? 0)));
      const stroke = derive(() =>
        state.focused.value === node ? "#fff"
        : hoverCell.value === node ? "#c8cdd6"
        : depth === 0 ? "#444" : "#0b0d12",
      );
      const strokeWidth = derive(() => (state.focused.value === node || hoverCell.value === node ? 2 : 1));

      const tile = s(rect(x, y, w, h, {
        fill: node.value.color,
        opacity: depth === 0 ? 0.12 : isLeaf ? 0.95 : 0.45,
        stroke,
        strokeWidth,
        corner: 3,
      }));
      tile.el.style.cursor = "pointer";
      tile.el.addEventListener("click", () => { state.focused.value = node; });
      tile.el.addEventListener("pointerenter", () => { state.hovered.current = node; hoverCell.value = node; state.emitHover?.(node); });
      tile.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) { state.hovered.current = null; hoverCell.value = null; state.emitHover?.(null); } });

      if (depth > 0) {
        const text = derive(() => {
          const w0 = w.value, h0 = h.value;
          if (w0 <= 28 || h0 <= 16) return "";
          return isLeaf
            ? `${node.value.label}\n${node.value.total.value.toFixed(0)}`
            : node.value.label;
        });
        s(label(
          Vec.derive(() => ({ x: x.value + w.value / 2, y: y.value + (isLeaf ? h.value / 2 : 10) })),
          text,
          { size: isLeaf ? 11 : 10, align: Anchor.Center, fill: "#fff", bold: !isLeaf },
        ));
      }
    }

    if (!this.hasAttribute('no-source')) s(label(view.bottom.up(10), derive(() => {
      const f = state.focused.value;
      return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));
  }
}
