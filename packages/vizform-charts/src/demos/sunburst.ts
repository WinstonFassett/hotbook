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
  num,
  play,
  tween,
  easeOut,
  effect as biEffect,
  untracked,
} from "bireactive";
import { partition, type HierarchyRectangularNode } from "d3-hierarchy";
import { depthFill } from "../lib/depth-color";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode } from "../lib/tree";
import { portfolio, walkWithDepth } from "../lib/portfolio";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import { dragCancelable } from "../lib/esc-contract";
import { GESTURE_SUPPRESSION_CSS, settleTransition } from "../lib/transitions";

const W = 480;
const H = 480;
const DRILL_DURATION = 800;

export class MdSunburstLC extends Diagram {
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

    const maxD = this.maxDepth

    // Build id→BiNode index for drill lookup.
    const nodeById = new Map<string, BiNode>();
    for (const { node } of walkWithDepth(root)) {
      if (node.value.id) nodeById.set(node.value.id, node);
    }

    // Separate derive for Rfull so viewport can reference it.
    const Rfull = derive(() => Math.min(Wc.value, Hc.value) / 2 - 4);

    const layout = derive(() => {
      const rfull = Rfull.value;
      const h = buildHierarchy(root);
      const totalDepth = h.height;
      // Scale partition radius so visible rings fill Rfull exactly.
      const visibleDepth = maxD !== undefined ? Math.min(maxD, totalDepth) : totalDepth;
      const R = visibleDepth > 0 ? rfull * totalDepth / visibleDepth : rfull;
      partition<BiNode>().size([2 * Math.PI, R])(h);
      const map = new Map<BiNode, HierarchyRectangularNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyRectangularNode<BiNode>));
      return map;
    });

    // Viewport cells for angle (x) and radius (y) domains.
    // Default: full circle [0..2π] and full radius [0..Rfull].
    const va0 = num(0);
    const va1 = num(2 * Math.PI);
    const vr0 = num(0);
    const vr1 = num(Rfull.value);  // seeded from initial Rfull

    let drillInited = false;
    let lastDrillId: string | null = null;
    biEffect(() => {
      const id = this._drillIdCell.value;
      const rfull = Rfull.value; // track Rfull for resize
      let ta0: number, ta1: number, tr0: number, tr1: number;
      if (id) {
        const lmap = untracked(() => layout.value);
        const biNode = nodeById.get(id);
        const lnode = biNode ? lmap.get(biNode) : null;
        if (lnode) {
          ta0 = lnode.x0; ta1 = lnode.x1; tr0 = lnode.y0; tr1 = lnode.y1;
        } else {
          ta0 = 0; ta1 = 2 * Math.PI; tr0 = 0; tr1 = rfull;
        }
      } else {
        ta0 = 0; ta1 = 2 * Math.PI; tr0 = 0; tr1 = rfull;
      }
      const drillChanged = id !== lastDrillId;
      lastDrillId = id;
      if (!drillInited || !drillChanged) {
        va0.value = ta0; va1.value = ta1; vr0.value = tr0; vr1.value = tr1;
        drillInited = true;
        return;
      }
      play(tween(va0, ta0, DRILL_DURATION, easeOut));
      play(tween(va1, ta1, DRILL_DURATION, easeOut));
      play(tween(vr0, tr0, DRILL_DURATION, easeOut));
      play(tween(vr1, tr1, DRILL_DURATION, easeOut));
    });

    // Remap angle/radius from layout-space to display-space.
    const remapAngle = (rawA: number) => {
      const spanA = va1.value - va0.value;
      return spanA === 0 ? 0 : (rawA - va0.value) / spanA * 2 * Math.PI;
    };
    const remapRadius = (rawR: number) => {
      const spanR = vr1.value - vr0.value;
      return spanR === 0 ? 0 : (rawR - vr0.value) / spanR * Rfull.value;
    };

    const center = Vec.derive(() => ({ x: Wc.value / 2, y: Hc.value / 2 }));
    for (const { node, depth, isLeaf } of walkWithDepth(root)) {
      if (depth === 0) continue;
      if (maxD !== undefined && depth > maxD) continue;
      const a0 = derive(() => remapAngle(layout.value.get(node)?.x0 ?? 0));
      const a1 = derive(() => remapAngle(layout.value.get(node)?.x1 ?? 0));
      const rIn = derive(() => remapRadius(layout.value.get(node)?.y0 ?? 0));
      const rOut = derive(() => remapRadius(layout.value.get(node)?.y1 ?? 0));
      const stroke = derive(() =>
        state.focused.value === node ? "#fff"
        : hoverCell.value === node ? "#c8cdd6"
        : "#0b0d12"
      );
      const strokeWidth = derive(() => (state.focused.value === node || hoverCell.value === node ? 2 : 1));

      // Color-by-parent (mirrors LayerChart): every node keeps its group hue,
      // but each deeper ring is brightened so the center stays saturated and the
      // outer rings wash out toward the leaves. Replaces the old uniform opacity
      // dim, which darkened every inner ring to the same mud on the dark ground.
      const arc = s(annularSector(center, rOut, rIn, a0, a1, {
        fill: depthFill(node.value.color, depth).toString(),
        stroke,
        strokeWidth,
      }));
      arc.el.style.cursor = "pointer";
      arc.el.style.transition = settleTransition("d");
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
          // Shared angular span [angStart, angEnd] and radius band (raw layout-space).
          const angStart = derive(() => layout.value.get(aNode)?.x0 ?? 0);
          const angEnd = derive(() => layout.value.get(bNode)?.x1 ?? 0);
          const rInRaw = derive(() => layout.value.get(aNode)?.y0 ?? 0);
          const rOutRaw = derive(() => layout.value.get(aNode)?.y1 ?? 0);
          // Display-space mid radius (remapped).
          const midRDisplay = derive(() => (remapRadius(rInRaw.value) + remapRadius(rOutRaw.value)) / 2);

          // Boundary angle in display space (remapped).
          const boundaryAngDisplay = derive(() => {
            const va = a.value, vb = b.value;
            const sum = va + vb;
            const frac = sum === 0 ? 0.5 : va / sum;
            const rawAng = angStart.value + frac * (angEnd.value - angStart.value);
            return remapAngle(rawAng);
          });
          // annularSector convention: x = cx + r*cos(a), y = cy + r*sin(a)
          // (angle 0 at +X). Knob sits at the midpoint of the ring for this boundary.
          const knobPos = Vec.derive(() => {
            const ang = boundaryAngDisplay.value;
            const r = midRDisplay.value;
            const c = center.value;
            return { x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) };
          });

          // Drag target: writable lens over (a,b) only; geometry peeked. Converts
          // the dragged point back to a layout-space angle, clamps within the span.
          const knob = Vec.lens(
            [a, b] as const,
            (vals: readonly [number, number]) => {
              const [va, vb] = vals;
              const sum = va + vb;
              const frac = sum === 0 ? 0.5 : va / sum;
              const rawAng = angStart.peek() + frac * (angEnd.peek() - angStart.peek());
              const dispAng = remapAngle(rawAng);
              const r = midRDisplay.peek();
              const c = center.peek();
              return { x: c.x + r * Math.cos(dispAng), y: c.y + r * Math.sin(dispAng) };
            },
            (target, vals) => {
              const [va, vb] = vals;
              const sum = va + vb;
              const rawA0 = angStart.peek();
              const rawA1 = angEnd.peek();
              if (sum === 0 || rawA1 <= rawA0) return [va, vb];
              const c = center.peek();
              // pointer angle in display-space, then un-remap to layout-space
              let dispAng = Math.atan2(target.y - c.y, target.x - c.x);
              if (dispAng < 0) dispAng += 2 * Math.PI;
              // Convert display angle back to layout angle
              const spanA = va1.value - va0.value;
              const rawAng = spanA === 0 ? dispAng : va0.value + (dispAng / (2 * Math.PI)) * spanA;
              // unwrap into [rawA0, rawA1] neighborhood
              let ang = rawAng;
              while (ang < rawA0 - Math.PI) ang += 2 * Math.PI;
              while (ang > rawA1 + Math.PI) ang -= 2 * Math.PI;
              let frac = (ang - rawA0) / (rawA1 - rawA0);
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
