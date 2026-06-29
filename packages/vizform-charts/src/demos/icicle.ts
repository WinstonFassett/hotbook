import {
  Anchor,
  circle,
  Diagram,
  derive,
  forEach,
  group,
  label,
  type Mount,
  cell,
  rect,
  Vec,
  num,
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
import { GESTURE_SUPPRESSION_CSS, settleTransition } from "../lib/transitions";
import { dragCancelable } from "../lib/esc-contract";

const W = 720;
const H = 360;
const DRILL_DURATION = 800; // ms — leave-timer / CSS settle window
const DRILL_SEC = DRILL_DURATION / 1000; // s — bireactive anim clock runs in seconds

export class MdIcicleLC extends Diagram {
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

    // Pre-build static maps (tree structure is immutable).
    const nodeById = new Map<string, BiNode>();
    const nodeDepth = new Map<BiNode, number>();
    let totalDepth = 0;
    for (const { node, depth } of walkWithDepth(root)) {
      if (node.value.id) nodeById.set(node.value.id, node);
      nodeDepth.set(node, depth);
      if (depth > totalDepth) totalDepth = depth;
    }

    const maxD = this.maxDepth;

    // Natural partition layout — no pre-scaling. Viewport does all fitting.
    const layout = derive(() => {
      const h = buildHierarchy(root);
      partition<BiNode>().size([Wc.value, Hc.value])(h);
      const map = new Map<BiNode, HierarchyRectangularNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyRectangularNode<BiNode>));
      return map;
    });

    // Viewport cells: region of layout-space mapped to canvas.
    const vx0 = num(0);
    const vy0 = num(0);
    const vx1 = num(W);
    const vy1 = num(H);

    // Focus depth (reactive, used by window + handles).
    const focusDepth = derive(() => {
      const id = this._drillIdCell.value;
      if (!id) return 0;
      const n = nodeById.get(id);
      return n ? (nodeDepth.get(n) ?? 0) : 0;
    });

    // Window: nodes in [focusDepth < depth <= focusDepth + maxD].
    const windowTarget = derive((): readonly BiNode[] => {
      const fd = focusDepth.value;
      const maxWindow = maxD !== undefined ? fd + maxD : totalDepth;
      const result: BiNode[] = [];
      for (const { node, depth } of walkWithDepth(root)) {
        if (depth > fd && depth <= maxWindow) result.push(node);
      }
      return result;
    });

    // Rendered set: current window + departing nodes (kept alive through tween).
    const renderedSet = cell<readonly BiNode[]>([]);
    let leaveTimer: ReturnType<typeof setTimeout> | null = null;
    biEffect(() => {
      const newTarget = windowTarget.value;
      const prevRendered = untracked(() => renderedSet.value);
      const targetSet = new Set(newTarget);
      const leavers = prevRendered.filter(n => !targetSet.has(n));
      if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
      renderedSet.value = leavers.length > 0 ? [...newTarget, ...leavers] : newTarget;
      if (leavers.length > 0) {
        leaveTimer = setTimeout(() => {
          leaveTimer = null;
          renderedSet.value = windowTarget.value;
        }, DRILL_DURATION + 50);
      }
    });

    let drillInited = false;
    let lastDrillId: string | null = null;
    let drillCancel: (() => void) | null = null;
    biEffect(() => {
      const id = this._drillIdCell.value;
      const W0 = Wc.value, H0 = Hc.value;
      let tx0: number, ty0: number, tx1: number, ty1: number;

      const lmap = untracked(() => layout.value);
      if (id) {
        const biNode = nodeById.get(id);
        const lnode = biNode ? lmap.get(biNode) : null;
        if (lnode) {
          const fd = nodeDepth.get(biNode!) ?? 0;
          const maxWindow = maxD !== undefined ? fd + maxD : totalDepth;
          // ty0 = focus's outer edge (where children start); ty1 = deepest rendered row bottom.
          let maxY1 = lnode.y1;
          for (const { node, depth } of walkWithDepth(root)) {
            if (depth > fd && depth <= maxWindow) {
              const ln = lmap.get(node);
              if (ln && ln.y1 > maxY1) maxY1 = ln.y1;
            }
          }
          tx0 = lnode.x0; ty0 = lnode.y1; tx1 = lnode.x1; ty1 = maxY1;
        } else {
          tx0 = 0; ty0 = 0; tx1 = W0; ty1 = H0;
        }
      } else {
        // At root: map [root.y1, maxRendered.y1] → canvas so depth-1 starts at y=0.
        const rootLayout = lmap.get(root);
        ty0 = rootLayout ? rootLayout.y1 : 0;
        const maxWindow = maxD !== undefined ? maxD : totalDepth;
        let maxY1 = H0;
        for (const { node, depth } of walkWithDepth(root)) {
          if (depth > 0 && depth <= maxWindow) {
            const ln = lmap.get(node);
            if (ln && ln.y1 > maxY1) maxY1 = ln.y1;
          }
        }
        tx0 = 0; tx1 = W0; ty1 = maxY1;
      }

      const drillChanged = id !== lastDrillId;
      lastDrillId = id;
      // Cancel any in-flight drill tween before snapping or re-tweening.
      drillCancel?.();
      drillCancel = null;
      if (!drillInited || !drillChanged) {
        vx0.value = tx0; vy0.value = ty0; vx1.value = tx1; vy1.value = ty1;
        drillInited = true;
        return;
      }
      // Drive the viewport tween on this Diagram's anim clock — `tween()` alone
      // only builds a generator; it must be started to advance per frame.
      drillCancel = this.anim.start(
        tween(vx0, tx0, DRILL_SEC, easeOut),
        tween(vy0, ty0, DRILL_SEC, easeOut),
        tween(vx1, tx1, DRILL_SEC, easeOut),
        tween(vy1, ty1, DRILL_SEC, easeOut),
      );
    });

    const remapX = (rawX: number) => {
      const spanW = vx1.value - vx0.value;
      return spanW === 0 ? 0 : (rawX - vx0.value) / spanW * Wc.value;
    };
    const remapY = (rawY: number) => {
      const spanH = vy1.value - vy0.value;
      return spanH === 0 ? 0 : (rawY - vy0.value) / spanH * Hc.value;
    };

    // Windowed node rendering.
    const nodeLayer = s(group());
    forEach(nodeLayer, renderedSet, (node) => {
      const depth = nodeDepth.get(node) ?? 1;
      const isLeaf = (node.children as BiNode[]).length === 0;

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

      const nodeFill = depthFill(node.value.color, depth);
      const tile = rect(x, y, w, h, {
        fill: nodeFill.toString(),
        stroke,
        strokeWidth,
        corner: 2,
      });
      tile.el.dataset.id = node.value.id ?? "";
      tile.el.style.cursor = "pointer";
      tile.el.style.transition = settleTransition(["x", "y", "width", "height"]);
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
      const lbl = label(
        Vec.derive(() => ({ x: x.value + w.value / 2, y: y.value + h.value / 2 })),
        text,
        { size: isLeaf ? 11 : 10, align: Anchor.Center, fill: labelInk(nodeFill), bold: !isLeaf },
      );
      return [tile, lbl];
    }, { key: (n) => n.value.id });

    // Windowed handle rendering: one entry per sibling boundary (bNode identifies the boundary).
    if (!this.hasAttribute("no-handles")) {
      // Handle source: (parent, siblingIndex) pairs for in-window parents that are not the deepest level.
      type HandleItem = { parent: BiNode; i: number; aNode: BiNode; bNode: BiNode };
      const handleWindow = derive((): readonly HandleItem[] => {
        const fd = focusDepth.value;
        const maxWindow = maxD !== undefined ? fd + maxD : totalDepth;
        const items: HandleItem[] = [];
        for (const n of renderedSet.value) {
          const d = nodeDepth.get(n) ?? 0;
          if (d <= fd || d >= maxWindow) continue; // skip focus-level and deepest-rendered
          const kids = n.children as BiNode[];
          if (kids.length < 2) continue;
          for (let i = 1; i < kids.length; i++) {
            items.push({ parent: n, i, aNode: kids[i - 1]!, bNode: kids[i]! });
          }
        }
        return items;
      });

      const handleLayer = s(group());
      forEach(handleLayer, handleWindow, ({ aNode, bNode }) => {
        const a = aNode.value.total;
        const b = bNode.value.total;

        const spanX0 = derive(() => layout.value.get(aNode)?.x0 ?? 0);
        const spanX1 = derive(() => layout.value.get(bNode)?.x1 ?? 0);
        const rowY0 = derive(() => layout.value.get(aNode)?.y0 ?? 0);
        const rowY1 = derive(() => layout.value.get(aNode)?.y1 ?? 0);

        const knob = Vec.lens(
          [a, b] as const,
          (vals: readonly [number, number]) => {
            const [va, vb] = vals;
            const x0 = spanX0.peek();
            const x1 = spanX1.peek();
            const sum = va + vb;
            const frac = sum === 0 ? 0.5 : va / sum;
            const lx = x0 + frac * (x1 - x0);
            const ly = (rowY0.peek() + rowY1.peek()) / 2;
            return { x: remapX(lx), y: remapY(ly) };
          },
          (target, vals) => {
            const [va, vb] = vals;
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
        const dot = circle(knobPos, 5, {
          fill: aNode.value.color,
          stroke: derive(() => active.value ? "#fff" : "#000"),
          strokeWidth: 1.5,
        });
        const dispose = dragCancelable(dot, knob, [a, b], {
          host: this,
          onStart: () => { active.value = true; },
          onEnd: () => { active.value = false; },
        });
        dot.track(dispose);
        dot.el.style.cursor = "ew-resize";
        dot.el.addEventListener("pointerenter", () => { active.value = true; });
        dot.el.addEventListener("pointerleave", () => { active.value = false; });

        return dot;
      }, { key: ({ bNode }) => bNode.value.id });
    }

    if (!this.hasAttribute('no-source')) s(label(view.bottom.up(10), derive(() => {
      const f = state.focused.value;
      return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));
  }
}
