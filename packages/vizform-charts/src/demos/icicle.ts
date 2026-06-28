import {
  Anchor,
  circle,
  Diagram,
  derive,
  label,
  type Mount,
  cell,
  Num,
  rect,
  Vec,
  num,
  play,
  tween,
  easeOut,
  effect as biEffect,
  untracked,
} from "bireactive";
import { partition, type HierarchyRectangularNode } from "d3-hierarchy";
import { depthFill, labelInk } from "../lib/depth-color";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode } from "../lib/tree";
import { portfolio, walkWithDepth } from "../lib/portfolio";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import { dragCancelable } from "../lib/esc-contract";

const W = 720;
const H = 360;
const DRILL_DURATION = 800;

export class MdIcicleLC extends Diagram {
  static styles = `text { pointer-events: none; }${FILL_STYLE}`
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

    // Build id→BiNode index for drill lookup.
    const nodeById = new Map<string, BiNode>();
    for (const { node } of walkWithDepth(root)) {
      if (node.value.id) nodeById.set(node.value.id, node);
    }

    const maxD = this.maxDepth
    const layout = derive(() => {
      const h = buildHierarchy(root);
      const totalDepth = h.height; // levels below root
      // partition distributes H across (totalDepth+1) levels (depth 0 through totalDepth).
      // We skip depth 0 in rendering. To make visible rows fill Hc exactly, scale partition
      // height so one extra row fits above the viewport, then offset y by rowH to shift
      // visible rows up to y=0.
      const visibleDepth = maxD !== undefined ? Math.min(maxD, totalDepth) : totalDepth;
      const scaledH = visibleDepth > 0 ? Hc.value * (totalDepth + 1) / visibleDepth : Hc.value;
      partition<BiNode>().size([Wc.value, scaledH])(h);
      const rowH = visibleDepth > 0 ? Hc.value / visibleDepth : 0;
      const map = new Map<BiNode, HierarchyRectangularNode<BiNode>>();
      h.each((d) => {
        const node = d as HierarchyRectangularNode<BiNode>;
        // Shift all y coords up by one row so depth-1 tiles start at y=0.
        map.set(d.data, {
          ...node,
          y0: node.y0 - rowH,
          y1: node.y1 - rowH,
        } as HierarchyRectangularNode<BiNode>);
      });
      return map;
    });
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

    // Helper: remap raw layout coordinate through animated viewport.
    const remapX = (rawX: number) => {
      const spanW = vx1.value - vx0.value;
      return spanW === 0 ? 0 : (rawX - vx0.value) / spanW * Wc.value;
    };
    const remapY = (rawY: number) => {
      const spanH = vy1.value - vy0.value;
      return spanH === 0 ? 0 : (rawY - vy0.value) / spanH * Hc.value;
    };

    for (const { node, depth, isLeaf } of walkWithDepth(root)) {
      if (depth === 0) continue;
      if (maxD !== undefined && depth > maxD) continue;
      const x = derive(() => remapX(layout.value.get(node)?.x0 ?? 0));
      const y = derive(() => remapY(layout.value.get(node)?.y0 ?? 0));
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
        : "#0b0d12"
      );
      const strokeWidth = derive(() => (state.focused.value === node || hoverCell.value === node ? 2 : 1));

      // Color-by-parent: brighten by depth so the root band stays saturated and
      // deeper bands wash out toward the leaves (mirrors LayerChart; replaces the
      // uniform opacity dim that muddied every non-leaf band identically).
      const nodeFill = depthFill(node.value.color, depth);
      const tile = s(rect(x, y, w, h, {
        fill: nodeFill.toString(),
        stroke,
        strokeWidth,
        corner: 2,
      }));
      tile.el.style.cursor = "pointer";
      tile.el.addEventListener("click", () => { state.focused.value = node; });
      tile.el.addEventListener("pointerenter", () => { state.hovered.current = node; hoverCell.value = node; state.emitHover?.(node); });
      tile.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) { state.hovered.current = null; hoverCell.value = null; state.emitHover?.(null); } });

      const text = derive(() => {
        const w0 = w.value, h0 = h.value;
        if (w0 <= 28 || h0 <= 12) return "";
        return isLeaf
          ? `${node.value.label}\n${node.value.total.value.toFixed(0)}`
          : node.value.label;
      });
      s(label(
        Vec.derive(() => ({ x: x.value + w.value / 2, y: y.value + h.value / 2 })),
        text,
        { size: isLeaf ? 11 : 10, align: Anchor.Center, fill: labelInk(nodeFill), bold: !isLeaf },
      ));
    }

    // Boundary-knob resize handles: for each parent with >=2 children, drop a
    // draggable pill on each interior x-boundary. The two adjacent siblings a,b
    // share a contiguous x-span [a.x0, b.x1]; the boundary sits where their
    // widths split proportional to value. Dragging reapportions a.total/b.total
    // (sum preserved by the group's Num.lens) and the partition layout
    // re-derives reactively. Same lens as the Budget Tree demo, positioned from
    // the live layout map. Skip the synthetic root row (depth 0).
    if (!this.hasAttribute("no-handles")) {
      for (const { node: parent, depth } of walkWithDepth(root)) {
        if (maxD !== undefined && depth >= maxD) continue;
        const kids = parent.children as BiNode[];
        if (kids.length < 2) continue;
        for (let i = 1; i < kids.length; i++) {
          const aNode = kids[i - 1]!;
          const bNode = kids[i]!;
          const a = aNode.value.total;
          const b = bNode.value.total;
          // Live span geometry: [spanX0, spanX1] covers both siblings; row Y band
          // comes from either child's depth row (same y0/y1).
          const spanX0 = derive(() => layout.value.get(aNode)?.x0 ?? 0);
          const spanX1 = derive(() => layout.value.get(bNode)?.x1 ?? 0);
          const rowY0 = derive(() => layout.value.get(aNode)?.y0 ?? 0);
          const rowY1 = derive(() => layout.value.get(aNode)?.y1 ?? 0);

          // Drag target: a Vec lens whose ONLY writable sources are the two
          // value cells (a, b). Span geometry is read-only layout output, so it's
          // peeked inside the lens — never written back. Listing derived cells as
          // lens sources corrupts the backward-propagation graph (propagateBwd
          // reads `.parent` on them and throws). The read side here is only used
          // by drag() to seed the gesture; the *visual* position is a separate
          // reactive derive (knobX) so the pill tracks layout changes live.
          const knob = Vec.lens(
            [a, b] as const,
            (vals: readonly [number, number]) => {
              const [va, vb] = vals;
              const x0 = spanX0.peek();
              const x1 = spanX1.peek();
              const sum = va + vb;
              const frac = sum === 0 ? 0.5 : va / sum;
              // Return screen-space coords so drag() uses consistent space.
              const lx = x0 + frac * (x1 - x0);
              const ly = (rowY0.peek() + rowY1.peek()) / 2;
              return { x: remapX(lx), y: remapY(ly) };
            },
            (target, vals) => {
              const [va, vb] = vals;
              // Convert screen-space target back to layout-space for fraction math.
              const svxSpan = vx1.value - vx0.value;
              const layoutX = svxSpan === 0 ? 0 : vx0.value + (target.x / Wc.value) * svxSpan;
              const x0 = spanX0.peek();
              const x1 = spanX1.peek();
              const sum = va + vb;
              if (sum === 0 || x1 <= x0) return [va, vb];
              let frac = (layoutX - x0) / (x1 - x0);
              frac = Math.max(0, Math.min(1, frac));
              const newA = frac * sum;
              return [newA, sum - newA];
            },
          );

          const knobPos = Vec.derive(() => {
            const va = a.value, vb = b.value;
            const x0 = spanX0.value, x1 = spanX1.value;
            const sum = va + vb;
            const frac = sum === 0 ? 0.5 : va / sum;
            const lx = x0 + frac * (x1 - x0);
            const ly = (rowY0.value + rowY1.value) / 2;
            return { x: remapX(lx), y: remapY(ly) };
          });
          const active = cell(false);
          const dot = s(
            circle(knobPos, 5, {
              fill: aNode.value.color,
              stroke: derive(() => active.value ? "#fff" : "#000"),
              strokeWidth: 1.5,
            }),
          );
          // Cancelable drag: snapshots [a,b] on down; the gesture owns its Esc
          // listener and reverts on Esc.
          dragCancelable(dot, knob, [a, b], {
            host: this,
            onStart: () => { active.value = true; },
            onEnd: () => { active.value = false; },
          });
          dot.el.style.cursor = "ew-resize";
          dot.el.addEventListener("pointerenter", () => { active.value = true; });
          dot.el.addEventListener("pointerleave", () => { active.value = false; });
        }
      }
    }

    if (!this.hasAttribute('no-source')) s(label(view.bottom.up(10), derive(() => {
      const f = state.focused.value;
      return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));
  }
}
