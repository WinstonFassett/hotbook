import {
  Anchor,
  Diagram,
  derive,
  label,
  type Mount,
  cell,
  circle,
  Vec,
  num,
  play,
  tween,
  easeOut,
  effect as biEffect,
  untracked,
} from "bireactive";
import { pack as d3pack, type HierarchyCircularNode } from "d3-hierarchy";
import { depthFill, labelInk } from "../lib/depth-color";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode } from "../lib/tree";
import { portfolio, walkWithDepth } from "../lib/portfolio";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { useHostSize, FILL_STYLE } from "../lib/host-size";

const W = 480;
const H = 480;
const PAD = 2;
const DRILL_DURATION = 800;

export class MdPack extends Diagram {
  static styles = `text { pointer-events: none; }${FILL_STYLE}`
  externalRoot?: BiNode
  maxDepth?: number
  drillKey?: string

  // Internal reactive cell updated by the drillNodeId setter.
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
    attachChartGestures(this, { root, parentOf, state });
    const hoverCell = cell<BiNode | null>(null);
    state.hoverCell = hoverCell;

    const layout = derive(() => {
      const h = buildHierarchy(root);
      d3pack<BiNode>().size([Wc.value, Hc.value]).padding(PAD)(h);
      const map = new Map<BiNode, HierarchyCircularNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyCircularNode<BiNode>));
      return map;
    });

    // Build a flat id→BiNode index for drill lookup.
    const nodeById = new Map<string, BiNode>();
    for (const { node } of walkWithDepth(root)) {
      if (node.value.id) nodeById.set(node.value.id, node);
    }

    // Viewport cells: the region of layout-space currently mapped to canvas.
    // Default: full canvas (x in [0,W], y in [0,H]).
    const vx0 = num(0);
    const vy0 = num(0);
    const vx1 = num(W);
    const vy1 = num(H);

    // Watch drillNodeId; on change tween the viewport to the drilled node bounds.
    // Reads Wc/Hc (tracked) so viewport resets correctly on resize.
    // Reads layout via untracked so value edits don't re-fire the tween.
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
          tx0 = lnode.x - lnode.r;
          ty0 = lnode.y - lnode.r;
          tx1 = lnode.x + lnode.r;
          ty1 = lnode.y + lnode.r;
        } else {
          tx0 = 0; ty0 = 0; tx1 = W0; ty1 = H0;
        }
      } else {
        tx0 = 0; ty0 = 0; tx1 = W0; ty1 = H0;
      }
      // Animate only when drill id changes; snap for initial load and resize.
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
      // Remap layout coords through the animated viewport.
      const cx = derive(() => {
        const raw = layout.value.get(node)?.x ?? 0;
        const spanW = vx1.value - vx0.value;
        return spanW === 0 ? 0 : (raw - vx0.value) / spanW * Wc.value;
      });
      const cy = derive(() => {
        const raw = layout.value.get(node)?.y ?? 0;
        const spanH = vy1.value - vy0.value;
        return spanH === 0 ? 0 : (raw - vy0.value) / spanH * Hc.value;
      });
      const r = derive(() => {
        const raw = layout.value.get(node)?.r ?? 0;
        const spanW = vx1.value - vx0.value;
        return spanW === 0 ? 0 : raw / spanW * Wc.value;
      });
      const stroke = derive(() =>
        state.focused.value === node ? "#fff"
        : hoverCell.value === node ? "#c8cdd6"
        : depth === 0 ? "#444" : "#0b0d12",
      );
      const strokeWidth = derive(() => (state.focused.value === node || hoverCell.value === node ? 2 : 1));

      // Color-by-parent: brighten by depth (deeper circles wash out). Root is
      // kept as a faint backdrop. Replaces the uniform opacity dim.
      const nodeFill = depthFill(node.value.color, depth);
      const disc = s(
        circle(Vec.derive(() => ({ x: cx.value, y: cy.value })), r, {
          fill: depth === 0 ? node.value.color : nodeFill.toString(),
          opacity: depth === 0 ? 0.12 : 1,
          stroke,
          strokeWidth,
        }),
      );
      disc.el.style.cursor = "pointer";
      disc.el.addEventListener("click", () => { state.focused.value = node; });
      disc.el.addEventListener("pointerenter", () => { state.hovered.current = node; hoverCell.value = node; state.emitHover?.(node); });
      disc.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) { state.hovered.current = null; hoverCell.value = null; state.emitHover?.(null); } });

      if (isLeaf) {
        const text = derive(() => {
          if (r.value <= 14) return "";
          return `${node.value.label}\n${node.value.total.value.toFixed(0)}`;
        });
        s(label(Vec.derive(() => ({ x: cx.value, y: cy.value })), text, {
          size: 10, align: Anchor.Center, fill: labelInk(nodeFill),
        }));
      }
    }

    if (!this.hasAttribute('no-source')) s(label(view.bottom.up(10), derive(() => {
      const f = state.focused.value;
      return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));
  }
}
