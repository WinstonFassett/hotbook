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
} from "bireactive";
import { partition, type HierarchyRectangularNode } from "d3-hierarchy";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode } from "../lib/tree";
import { portfolio, walkWithDepth } from "../lib/portfolio";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import { dragCancelable } from "../lib/esc-contract";

const W = 720;
const H = 360;

export class MdIcicleLC extends Diagram {
  static styles = `text { pointer-events: none; }${FILL_STYLE}`
  externalRoot?: BiNode
  maxDepth?: number
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
    for (const { node, depth, isLeaf } of walkWithDepth(root)) {
      if (depth === 0) continue;
      if (maxD !== undefined && depth > maxD) continue;
      const x = derive(() => layout.value.get(node)?.x0 ?? 0);
      const y = derive(() => layout.value.get(node)?.y0 ?? 0);
      const w = derive(() => Math.max(0, (layout.value.get(node)?.x1 ?? 0) - (layout.value.get(node)?.x0 ?? 0)));
      const h = derive(() => Math.max(0, (layout.value.get(node)?.y1 ?? 0) - (layout.value.get(node)?.y0 ?? 0)));
      const stroke = derive(() =>
        state.focused.value === node ? "#fff"
        : hoverCell.value === node ? "#c8cdd6"
        : "#0b0d12"
      );
      const strokeWidth = derive(() => (state.focused.value === node || hoverCell.value === node ? 2 : 1));

      const tile = s(rect(x, y, w, h, {
        fill: node.value.color,
        opacity: isLeaf ? 0.95 : 0.5,
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
        { size: isLeaf ? 11 : 10, align: Anchor.Center, fill: "#fff", bold: !isLeaf },
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
              return { x: x0 + frac * (x1 - x0), y: (rowY0.peek() + rowY1.peek()) / 2 };
            },
            (target, vals) => {
              const [va, vb] = vals;
              const x0 = spanX0.peek();
              const x1 = spanX1.peek();
              const sum = va + vb;
              if (sum === 0 || x1 <= x0) return [va, vb];
              let frac = (target.x - x0) / (x1 - x0);
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
            return { x: x0 + frac * (x1 - x0), y: (rowY0.value + rowY1.value) / 2 };
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
