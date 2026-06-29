import {
  Anchor,
  circle,
  Diagram,
  derive,
  effect as biEffect,
  label,
  type Mount,
  cell,
  Num,
  rect,
  Vec,
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

export class MdIcicleLC extends Diagram {
  static styles = `
    text { pointer-events: none; }
    ${FILL_STYLE}
    [data-focusable]:focus {
      outline: 2px solid #4a9eff;
      outline-offset: 2px;
    }
    [data-focusable]:focus:not(:focus-visible) {
      outline: none;
    }
  `
  externalRoot?: BiNode
  maxDepth?: number
  /** Icicle orientation. "horizontal" (default) stacks depth levels along the
   *  x-axis with siblings split vertically — a classic partition chart. "vertical"
   *  stacks depth along y with siblings split horizontally (the original icicle). */
  orientation?: "horizontal" | "vertical"
  protected scene(s: Mount): void {
    const { w: Wc, h: Hc } = useHostSize(this, { width: W, height: H });
    const view = this.view(Wc, Hc);
    this.tabIndex = -1;
    this.style.outline = "none";

    const isHoriz = (this.orientation ?? "horizontal") === "horizontal";

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

    const maxD = this.maxDepth
    const layout = derive(() => {
      const h = buildHierarchy(root);
      const totalDepth = h.height; // levels below root
      // partition distributes the depth-axis across (totalDepth+1) levels
      // (depth 0 through totalDepth). We skip depth 0 in rendering. To make
      // visible rows fill the depth canvas dimension exactly, scale the
      // partition depth extent so one extra row fits above the viewport, then
      // shift depth coords by one row so depth-1 tiles start at 0.
      const visibleDepth = maxD !== undefined ? Math.min(maxD, totalDepth) : totalDepth;
      // d3 partition.size([x, y]) divides siblings along x and stacks depth
      // along y. For horizontal we feed the sibling axis as the canvas height
      // and the depth axis as the canvas width, then swap coords in the map.
      const sibAxis = isHoriz ? Hc.value : Wc.value;
      const depthCanvas = isHoriz ? Wc.value : Hc.value;
      const scaledDepth = visibleDepth > 0 ? depthCanvas * (totalDepth + 1) / visibleDepth : depthCanvas;
      partition<BiNode>().size([sibAxis, scaledDepth])(h);
      const rowDepth = visibleDepth > 0 ? depthCanvas / visibleDepth : 0;
      const map = new Map<BiNode, HierarchyRectangularNode<BiNode>>();
      h.each((d) => {
        const node = d as HierarchyRectangularNode<BiNode>;
        if (isHoriz) {
          // Swap: partition x (sibling) → canvas y, partition y (depth) → canvas x.
          map.set(d.data, {
            ...node,
            x0: node.y0 - rowDepth,
            x1: node.y1 - rowDepth,
            y0: node.x0,
            y1: node.x1,
          } as HierarchyRectangularNode<BiNode>);
        } else {
          map.set(d.data, {
            ...node,
            y0: node.y0 - rowDepth,
            y1: node.y1 - rowDepth,
          } as HierarchyRectangularNode<BiNode>);
        }
      });
      return map;
    });
    const tileElements = new Map<BiNode, SVGRectElement>();
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
      tileElements.set(node, tile.el);
      tile.el.style.cursor = "pointer";
      tile.el.setAttribute('tabindex', '0');
      tile.el.setAttribute('data-focusable', 'tile');
      biEffect(() => {
        tile.el.setAttribute('aria-label', `${node.value.label}: ${node.value.total.value.toFixed(0)}`);
      });
      tile.el.addEventListener("click", () => { state.focused.value = node; });
      tile.el.addEventListener("focus", () => { state.focused.value = node; });
      tile.el.addEventListener("blur", () => { if (state.focused.value === node) state.focused.value = null; });
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
    // draggable pill on each interior sibling boundary. The two adjacent
    // siblings a,b share a contiguous span along the sibling axis; the boundary
    // sits where their widths split proportional to value. Dragging
    // reapportions a.total/b.total (sum preserved by the group's Num.lens) and
    // the partition layout re-derives reactively. Same lens as the Budget Tree
    // demo, positioned from the live layout map. Skip the synthetic root row
    // (depth 0). Orientation picks which canvas axis the boundary runs along:
    // vertical icicle → boundary is vertical, knob drags along x (ew-resize);
    // horizontal icicle → boundary is horizontal, knob drags along y (ns-resize).
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
          // Live span geometry along the SIBLING axis: [spanA0, spanA1] covers
          // both siblings. The depth-axis band [rowA0, rowA1] comes from either
          // child's depth row. For vertical, sibling axis = x, depth axis = y;
          // for horizontal, sibling axis = y, depth axis = x.
          const spanA0 = derive(() => isHoriz ? (layout.value.get(aNode)?.y0 ?? 0) : (layout.value.get(aNode)?.x0 ?? 0));
          const spanA1 = derive(() => isHoriz ? (layout.value.get(bNode)?.y1 ?? 0) : (layout.value.get(bNode)?.x1 ?? 0));
          const rowA0 = derive(() => isHoriz ? (layout.value.get(aNode)?.x0 ?? 0) : (layout.value.get(aNode)?.y0 ?? 0));
          const rowA1 = derive(() => isHoriz ? (layout.value.get(aNode)?.x1 ?? 0) : (layout.value.get(aNode)?.y1 ?? 0));

          // Drag target: a Vec lens whose ONLY writable sources are the two
          // value cells (a, b). Span geometry is read-only layout output, so it's
          // peeked inside the lens — never written back. Listing derived cells as
          // lens sources corrupts the backward-propagation graph (propagateBwd
          // reads `.parent` on them and throws). The read side here is only used
          // by drag() to seed the gesture; the *visual* position is a separate
          // reactive derive (knobPos) so the pill tracks layout changes live.
          const knob = Vec.lens(
            [a, b] as const,
            (vals: readonly [number, number]) => {
              const [va, vb] = vals;
              const s0 = spanA0.peek();
              const s1 = spanA1.peek();
              const sum = va + vb;
              const frac = sum === 0 ? 0.5 : va / sum;
              const along = s0 + frac * (s1 - s0);
              const across = (rowA0.peek() + rowA1.peek()) / 2;
              return isHoriz ? { x: across, y: along } : { x: along, y: across };
            },
            (target, vals) => {
              const [va, vb] = vals;
              const s0 = spanA0.peek();
              const s1 = spanA1.peek();
              const sum = va + vb;
              if (sum === 0 || s1 <= s0) return [va, vb];
              const t = isHoriz ? target.y : target.x;
              let frac = (t - s0) / (s1 - s0);
              frac = Math.max(0, Math.min(1, frac));
              const newA = frac * sum;
              return [newA, sum - newA];
            },
          );

          const knobPos = Vec.derive(() => {
            const va = a.value, vb = b.value;
            const s0 = spanA0.value, s1 = spanA1.value;
            const sum = va + vb;
            const frac = sum === 0 ? 0.5 : va / sum;
            const along = s0 + frac * (s1 - s0);
            const across = (rowA0.value + rowA1.value) / 2;
            return isHoriz ? { x: across, y: along } : { x: along, y: across };
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
          dot.el.style.cursor = isHoriz ? "ns-resize" : "ew-resize";
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
