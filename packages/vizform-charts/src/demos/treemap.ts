import {
  Anchor,
  Diagram,
  derive,
  label,
  type Mount,
  cell,
  rect,
  Vec,
  num,
  play,
  tween,
  easeOut,
  effect as biEffect,
  untracked,
} from "bireactive";
import { treemap, treemapSquarify, type HierarchyRectangularNode } from "d3-hierarchy";
import { depthFill, labelInk } from "../lib/depth-color";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode } from "../lib/tree";
import { portfolio, walkWithDepth } from "../lib/portfolio";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import { GESTURE_SUPPRESSION_CSS, settleTransition } from "../lib/transitions";

const W = 720;
const H = 360;
const PAD_OUTER = 4;
const PAD_INNER = 2;
const PAD_TOP = 16;
const DRILL_DURATION = 800;

export class MdTreemapLC extends Diagram {
  static styles = `text { pointer-events: none; }${FILL_STYLE}${GESTURE_SUPPRESSION_CSS}`
  externalRoot?: BiNode
  maxDepth?: number
  drillKey?: string

  private _drillIdCell = cell<string | null>(null)
  get drillNodeId(): string | null { return this._drillIdCell.value }
  set drillNodeId(id: string | null) { this._drillIdCell.value = id ?? null }

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
    attachChartGestures(this, { root, parentOf, state, scalingMode: "proportional-neighbor" });
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

    // Build id→BiNode index for drill lookup.
    const nodeById = new Map<string, BiNode>();
    for (const { node } of walkWithDepth(root)) {
      if (node.value.id) nodeById.set(node.value.id, node);
    }

    // Viewport cells: region of layout-space mapped to canvas. Default: full canvas.
    const vx0 = num(0);
    const vy0 = num(0);
    const vx1 = num(W);
    const vy1 = num(H);

    let drillInited = false;
    let lastDrillId: string | null = null;
    biEffect(() => {
      const id = this._drillIdCell.value;
      const W0 = Wc.value, H0 = Hc.value;
      let tx0: number, ty0: number, tx1: number, ty1: number;
      if (id) {
        const lmap = untracked(() => layout.value);
        const biNode = nodeById.get(id);
        const lnode = biNode ? lmap.get(biNode) : null;
        if (lnode) {
          tx0 = lnode.x0; ty0 = lnode.y0; tx1 = lnode.x1; ty1 = lnode.y1;
        } else {
          tx0 = 0; ty0 = 0; tx1 = W0; ty1 = H0;
        }
      } else {
        tx0 = 0; ty0 = 0; tx1 = W0; ty1 = H0;
      }
      const drillChanged = id !== lastDrillId;
      lastDrillId = id;
      if (!drillInited || !drillChanged) {
        vx0.value = tx0; vy0.value = ty0; vx1.value = tx1; vy1.value = ty1;
        drillInited = true;
        return;
      }
      play(tween(vx0, tx0, DRILL_DURATION, easeOut));
      play(tween(vy0, ty0, DRILL_DURATION, easeOut));
      play(tween(vx1, tx1, DRILL_DURATION, easeOut));
      play(tween(vy1, ty1, DRILL_DURATION, easeOut));
    });

    const maxD = this.maxDepth
    for (const { node, depth, isLeaf } of walkWithDepth(root)) {
      if (maxD !== undefined && depth > maxD) continue;
      const x = derive(() => {
        const raw = layout.value.get(node)?.x0 ?? 0;
        const spanW = vx1.value - vx0.value;
        return spanW === 0 ? 0 : (raw - vx0.value) / spanW * Wc.value;
      });
      const y = derive(() => {
        const raw = layout.value.get(node)?.y0 ?? 0;
        const spanH = vy1.value - vy0.value;
        return spanH === 0 ? 0 : (raw - vy0.value) / spanH * Hc.value;
      });
      const w = derive(() => {
        const lnode = layout.value.get(node);
        const rawW = Math.max(0, (lnode?.x1 ?? 0) - (lnode?.x0 ?? 0));
        const spanW = vx1.value - vx0.value;
        return spanW === 0 ? 0 : rawW / spanW * Wc.value;
      });
      const h = derive(() => {
        const lnode = layout.value.get(node);
        const rawH = Math.max(0, (lnode?.y1 ?? 0) - (lnode?.y0 ?? 0));
        const spanH = vy1.value - vy0.value;
        return spanH === 0 ? 0 : rawH / spanH * Hc.value;
      });
      const stroke = derive(() =>
        state.focused.value === node ? "#fff"
        : hoverCell.value === node ? "#c8cdd6"
        : depth === 0 ? "#444" : "#0b0d12",
      );
      const strokeWidth = derive(() => (state.focused.value === node || hoverCell.value === node ? 2 : 1));

      // Color-by-parent: brighten by depth (deeper tiles wash out). Root kept as
      // a faint backdrop. Replaces the uniform opacity dim.
      const nodeFill = depthFill(node.value.color, depth);
      const tile = s(rect(x, y, w, h, {
        fill: depth === 0 ? node.value.color : nodeFill.toString(),
        opacity: depth === 0 ? 0.12 : 1,
        stroke,
        strokeWidth,
        corner: 3,
      }));
      tile.el.style.cursor = "pointer";
      tile.el.style.transition = settleTransition(["x", "y", "width", "height"]);
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
          { size: isLeaf ? 11 : 10, align: Anchor.Center, fill: labelInk(nodeFill), bold: !isLeaf },
        ));
      }
    }

    if (!this.hasAttribute('no-source')) s(label(view.bottom.up(10), derive(() => {
      const f = state.focused.value;
      return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));
  }
}
