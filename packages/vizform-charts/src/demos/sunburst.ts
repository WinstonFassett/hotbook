import {
  Anchor,
  Diagram,
  derive,
  label,
  type Mount,
  cell,
  annularSector,
  circle,
  Vec,
} from "bireactive";
import { partition, type HierarchyRectangularNode } from "d3-hierarchy";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode } from "../lib/tree";
import { portfolio, walkWithDepth } from "../lib/portfolio";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import { dragCancelable } from "../lib/esc-contract";

const W = 480;
const H = 480;

export class MdSunburstLC extends Diagram {
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
      const Rfull = Math.min(Wc.value, Hc.value) / 2 - 4;
      const h = buildHierarchy(root);
      const totalDepth = h.height;
      // Scale partition radius so visible rings fill Rfull exactly.
      const visibleDepth = maxD !== undefined ? Math.min(maxD, totalDepth) : totalDepth;
      const R = visibleDepth > 0 ? Rfull * totalDepth / visibleDepth : Rfull;
      partition<BiNode>().size([2 * Math.PI, R])(h);
      const map = new Map<BiNode, HierarchyRectangularNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyRectangularNode<BiNode>));
      return map;
    });

    const center = Vec.derive(() => ({ x: Wc.value / 2, y: Hc.value / 2 }));
    for (const { node, depth, isLeaf } of walkWithDepth(root)) {
      if (depth === 0) continue;
      if (maxD !== undefined && depth > maxD) continue;
      const a0 = derive(() => layout.value.get(node)?.x0 ?? 0);
      const a1 = derive(() => layout.value.get(node)?.x1 ?? 0);
      const rIn = derive(() => layout.value.get(node)?.y0 ?? 0);
      const rOut = derive(() => layout.value.get(node)?.y1 ?? 0);
      const stroke = derive(() =>
        state.focused.value === node ? "#fff"
        : hoverCell.value === node ? "#c8cdd6"
        : "#0b0d12"
      );
      const strokeWidth = derive(() => (state.focused.value === node || hoverCell.value === node ? 2 : 1));

      const arc = s(annularSector(center, rOut, rIn, a0, a1, {
        fill: node.value.color,
        opacity: isLeaf ? 0.95 : 0.5,
        stroke,
        strokeWidth,
      }));
      arc.el.style.cursor = "pointer";
      arc.el.addEventListener("click", () => { state.focused.value = node; });
      arc.el.addEventListener("pointerenter", () => { state.hovered.current = node; hoverCell.value = node; state.emitHover?.(node); });
      arc.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) { state.hovered.current = null; hoverCell.value = null; state.emitHover?.(null); } });
    }

    // Angular boundary handles: same conservation lens as the icicle, but the
    // shared edge between two adjacent wedges is an ANGLE (polar partition: x0/x1
    // are angles, y0/y1 radii). A round knob sits at the boundary angle, mid
    // radius. Dragging it converts pointer->angle about the center, recomputes
    // the split fraction, and reapportions a.total/b.total (sum preserved by the
    // group Num.lens). Lens sources = writable cells (a,b) only; geometry peeked.
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
          // Shared angular span [angStart, angEnd] and radius band of these wedges.
          const angStart = derive(() => layout.value.get(aNode)?.x0 ?? 0);
          const angEnd = derive(() => layout.value.get(bNode)?.x1 ?? 0);
          const rIn = derive(() => layout.value.get(aNode)?.y0 ?? 0);
          const rOut = derive(() => layout.value.get(aNode)?.y1 ?? 0);
          const midR = derive(() => (rIn.value + rOut.value) / 2);

          // Boundary angle reactive read (used for visual position).
          const boundaryAng = derive(() => {
            const va = a.value, vb = b.value;
            const sum = va + vb;
            const frac = sum === 0 ? 0.5 : va / sum;
            return angStart.value + frac * (angEnd.value - angStart.value);
          });
          // annularSector convention: x = cx + r*cos(a), y = cy + r*sin(a)
          // (angle 0 at +X). Knob sits at the midpoint of the ring for this boundary.
          const knobPos = Vec.derive(() => {
            const ang = boundaryAng.value;
            const r = midR.value;
            const c = center.value;
            return { x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) };
          });

          // Drag target: writable lens over (a,b) only; geometry peeked. Converts
          // the dragged point back to an angle, clamps within the shared span.
          const knob = Vec.lens(
            [a, b] as const,
            (vals: readonly [number, number]) => {
              const [va, vb] = vals;
              const sum = va + vb;
              const frac = sum === 0 ? 0.5 : va / sum;
              const ang = angStart.peek() + frac * (angEnd.peek() - angStart.peek());
              const r = midR.peek();
              const c = center.peek();
              return { x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) };
            },
            (target, vals) => {
              const [va, vb] = vals;
              const sum = va + vb;
              const a0 = angStart.peek();
              const a1 = angEnd.peek();
              if (sum === 0 || a1 <= a0) return [va, vb];
              const c = center.peek();
              // pointer angle in annularSector convention: atan2(dy, dx), 0 at +X
              let ang = Math.atan2(target.y - c.y, target.x - c.x);
              if (ang < 0) ang += 2 * Math.PI;
              // unwrap into [a0, a1] neighborhood
              while (ang < a0 - Math.PI) ang += 2 * Math.PI;
              while (ang > a1 + Math.PI) ang -= 2 * Math.PI;
              let frac = (ang - a0) / (a1 - a0);
              frac = Math.max(0, Math.min(1, frac));
              const newA = frac * sum;
              return [newA, sum - newA];
            },
          );

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
          dot.el.style.cursor = "grab";
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
