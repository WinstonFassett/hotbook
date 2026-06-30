import {
  Anchor,
  circle,
  Diagram,
  derive,
  effect as biEffect,
  forEach,
  group,
  label,
  type Mount,
  cell,
  num,
  tween,
  easeOut,
  untracked,
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
import { GESTURE_SUPPRESSION_CSS, GESTURE_ACTIVE_CLASS, settleTransition } from "../lib/transitions";
import type { ElementWithBridge } from "../lib/hud-bridge";

const W = 720;
const H = 360;
const DRILL_DURATION = 800; // ms — leave-timer / CSS settle window
const DRILL_SEC = DRILL_DURATION / 1000; // s — bireactive anim clock runs in seconds

export class MdIcicleLC extends Diagram {
  static styles = `
    text { pointer-events: none; }
    ${FILL_STYLE}
    ${GESTURE_SUPPRESSION_CSS}
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
  drillKey?: string
  /** Icicle orientation. "horizontal" (default) stacks depth levels along the
   *  x-axis with siblings split vertically — a classic partition chart. "vertical"
   *  stacks depth along y with siblings split horizontally (the original icicle). */
  orientation?: "horizontal" | "vertical"

  private _drillIdCell = cell<string | null>(null)
  get drillNodeId(): string | null { return this._drillIdCell.value }
  set drillNodeId(id: string | null) { this._drillIdCell.value = id ?? null }

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

    // Partition layout — orientation-aware. The depth axis is scaled so one
    // extra row sits above the viewport, then coords are shifted so depth-1
    // tiles start at 0. For horizontal, partition's x (sibling) → canvas y and
    // partition's y (depth) → canvas x; for vertical, no swap needed.
    const layout = derive(() => {
      const h = buildHierarchy(root);
      const td = h.height; // levels below root
      const visibleDepth = maxD !== undefined ? Math.min(maxD, td) : td;
      const sibAxis = isHoriz ? Hc.value : Wc.value;
      const depthCanvas = isHoriz ? Wc.value : Hc.value;
      const scaledDepth = visibleDepth > 0 ? depthCanvas * (td + 1) / visibleDepth : depthCanvas;
      partition<BiNode>().size([sibAxis, scaledDepth])(h);
      const rowDepth = visibleDepth > 0 ? depthCanvas / visibleDepth : 0;
      const map = new Map<BiNode, HierarchyRectangularNode<BiNode>>();
      h.each((d) => {
        const node = d as HierarchyRectangularNode<BiNode>;
        if (isHoriz) {
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

    // Viewport cells: map layout-space → canvas. vx = depth axis, vy = sibling
    // axis. For horizontal, depth axis = canvas x, sibling axis = canvas y;
    // for vertical, depth axis = canvas y, sibling axis = canvas x.
    const vx0 = num(0);
    const vy0 = num(0);
    const vx1 = num(isHoriz ? W : H);
    const vy1 = num(isHoriz ? H : W);

    // Focus depth (reactive).
    const focusDepth = derive(() => {
      const id = this._drillIdCell.value;
      if (!id) return 0;
      const n = nodeById.get(id);
      return n ? (nodeDepth.get(n) ?? 0) : 0;
    });

    // Window: at root show all nodes depth 1+; when drilled show focus node +
    // subtree. Always include ancestors of the focus node so their tiles remain
    // in renderedSet and geometry stays available for Esc-out tweens.
    const windowTarget = derive((): readonly BiNode[] => {
      const fd = focusDepth.value;
      const id = this._drillIdCell.value;
      const maxWindow = maxD !== undefined ? fd + maxD : totalDepth;
      const result: BiNode[] = [];
      const focusNode = id ? nodeById.get(id) : null;
      const startNode = focusNode ?? root;
      const baseDepth = focusNode ? fd : 0;
      for (const { node, depth: relDepth } of walkWithDepth(startNode)) {
        const absDepth = baseDepth + relDepth;
        if ((fd > 0 ? absDepth >= fd : absDepth > 0) && absDepth <= maxWindow) result.push(node);
      }
      return result;
    });

    // Rendered set: current window + departing nodes kept briefly for
    // value-change animations. On drill: discard leavers immediately — they
    // remap through the viewport tween and would ghost at wrong positions.
    const renderedSet = cell<readonly BiNode[]>([]);
    let leaveTimer: ReturnType<typeof setTimeout> | null = null;
    let lastDrillId_rs: string | null = null;
    biEffect(() => {
      const newTarget = windowTarget.value;
      const currentDrillId = untracked(() => this._drillIdCell.value);
      const drillChanged = currentDrillId !== lastDrillId_rs;
      lastDrillId_rs = currentDrillId;
      const prevRendered = untracked(() => renderedSet.value);
      const targetSet = new Set(newTarget);
      const leavers = prevRendered.filter(n => !targetSet.has(n));
      if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
      if (leavers.length > 0 && !drillChanged) {
        renderedSet.value = [...newTarget, ...leavers];
        leaveTimer = setTimeout(() => {
          leaveTimer = null;
          renderedSet.value = windowTarget.value;
        }, DRILL_DURATION + 50);
      } else {
        renderedSet.value = newTarget;
      }
    });

    // Drill viewport tween: compute target viewport from focus node bounds and
    // tween all 4 cells. Uses untracked for layout reads so value changes don't
    // re-run this effect (only drill-id and resize do).
    let drillInited = false;
    let lastDrillId: string | null = null;
    let drillCancel: (() => void) | null = null;
    let drillClassTimer: ReturnType<typeof setTimeout> | null = null;
    biEffect(() => {
      const id = this._drillIdCell.value;
      void Wc.value; void Hc.value; // track resize
      const W0 = Wc.value, H0 = Hc.value;
      const depthCanvas = isHoriz ? W0 : H0;
      const sibCanvas = isHoriz ? H0 : W0;

      let tx0 = 0, ty0 = 0, tx1 = depthCanvas, ty1 = sibCanvas;
      const lmap = untracked(() => layout.value);
      if (id) {
        const biNode = nodeById.get(id);
        const lnode = biNode ? lmap.get(biNode) : null;
        if (lnode) {
          const fd = nodeDepth.get(biNode!) ?? 0;
          const maxWindow = maxD !== undefined ? fd + maxD : totalDepth;
          // Depth axis: from focus node's depth row to deepest descendant.
          let maxX1 = lnode.x1;
          for (const { node, depth: relDepth } of walkWithDepth(biNode!)) {
            const absDepth = fd + relDepth;
            if (absDepth <= maxWindow) {
              const ln = lmap.get(node);
              if (ln && ln.x1 > maxX1) maxX1 = ln.x1;
            }
          }
          tx0 = lnode.x0; tx1 = maxX1;
          ty0 = lnode.y0; ty1 = lnode.y1;
        }
      } else {
        // At root: depth axis = full canvas, sibling axis = full canvas.
        tx0 = 0; tx1 = depthCanvas; ty0 = 0; ty1 = sibCanvas;
      }

      const drillChanged = id !== lastDrillId;
      lastDrillId = id;
      if (!drillInited) {
        vx0.value = tx0; vy0.value = ty0; vx1.value = tx1; vy1.value = ty1;
        drillInited = true;
        return;
      }
      drillCancel?.();
      drillCancel = null;
      if (!drillChanged) {
        // Resize-only: re-tween to new target.
        drillCancel = this.anim.start(
          tween(vx0, tx0, DRILL_SEC, easeOut),
          tween(vy0, ty0, DRILL_SEC, easeOut),
          tween(vx1, tx1, DRILL_SEC, easeOut),
          tween(vy1, ty1, DRILL_SEC, easeOut),
        );
        return;
      }
      // Drill in/out: tween viewport + flash gesture-active class.
      if (drillClassTimer) { clearTimeout(drillClassTimer); drillClassTimer = null; }
      this.classList.add(GESTURE_ACTIVE_CLASS);
      drillClassTimer = setTimeout(() => {
        drillClassTimer = null;
        this.classList.remove(GESTURE_ACTIVE_CLASS);
      }, DRILL_DURATION + 60);
      drillCancel = this.anim.start(
        tween(vx0, tx0, DRILL_SEC, easeOut),
        tween(vy0, ty0, DRILL_SEC, easeOut),
        tween(vx1, tx1, DRILL_SEC, easeOut),
        tween(vy1, ty1, DRILL_SEC, easeOut),
      );
    });

    // Remap layout-space coords through viewport cells → canvas coords.
    // vx = depth axis, vy = sibling axis.
    const remapX = (raw: number) => {
      const span = vx1.value - vx0.value;
      return span === 0 ? 0 : (raw - vx0.value) / span * Wc.value;
    };
    const remapY = (raw: number) => {
      const span = vy1.value - vy0.value;
      return span === 0 ? 0 : (raw - vy0.value) / span * Hc.value;
    };

    // Windowed tile rendering via forEach (keyed by node id).
    const tileLayer = s(group());
    forEach(tileLayer, renderedSet, (node) => {
      const depth = nodeDepth.get(node) ?? 0;
      const isLeaf = (node.children as BiNode[]).length === 0;

      const x = derive(() => remapX(layout.value.get(node)?.x0 ?? 0));
      const y = derive(() => remapY(layout.value.get(node)?.y0 ?? 0));
      const w = derive(() => {
        const ln = layout.value.get(node);
        if (!ln) return 0;
        return Math.max(0, remapX(ln.x1) - remapX(ln.x0));
      });
      const h = derive(() => {
        const ln = layout.value.get(node);
        if (!ln) return 0;
        return Math.max(0, remapY(ln.y1) - remapY(ln.y0));
      });

      const stroke = derive(() =>
        state.focused.value === node ? "#fff"
        : hoverCell.value === node ? "#c8cdd6"
        : "#0b0d12"
      );
      const strokeWidth = derive(() => (state.focused.value === node || hoverCell.value === node ? 2 : 1));

      const nodeFill = depthFill(node.value.color, depth);
      const isContextNode = derive(() => depth > 0 && node.value.id === this._drillIdCell.value);

      const tile = rect(x, y, w, h, {
        fill: nodeFill.toString(),
        stroke,
        strokeWidth,
        corner: 2,
      });
      tile.el.dataset.id = node.value.id ?? "";
      tile.el.style.transition = settleTransition(["fill", "stroke", "stroke-width", "opacity"]);
      tile.el.style.cursor = "pointer";
      tile.el.setAttribute('tabindex', '0');
      tile.el.setAttribute('data-focusable', 'tile');
      biEffect(() => {
        tile.el.style.opacity = isContextNode.value ? '0.35' : '1';
      });
      biEffect(() => {
        tile.el.setAttribute('aria-label', `${node.value.label}: ${node.value.total.value.toFixed(0)}`);
      });
      tile.el.addEventListener("click", () => { state.focused.value = node; });
      tile.el.addEventListener("focus", () => { state.focused.value = node; });
      tile.el.addEventListener("blur", () => { if (state.focused.value === node) state.focused.value = null; });
      tile.el.addEventListener("dblclick", (e: MouseEvent) => {
        // Drill out if clicking the context (focus) tile — read live, not stale.
        if (isContextNode.value) {
          e.stopPropagation();
          const parent = parentOf(node);
          const targetId = (parent && (nodeDepth.get(parent) ?? 0) > 0)
            ? (parent.value.id ?? null)
            : null;
          // Drill directly — don't wait for a round-trip.
          this.drillNodeId = targetId;
          const drillKey = this.drillKey ?? 'default';
          (this as ElementWithBridge).brSync?.emitDrill?.(drillKey, targetId);
        }
      });
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
    }, { key: (n) => n.value.id ?? "" });

    // Boundary-knob resize handles: for each parent with >=2 children, drop a
    // draggable pill on each interior sibling boundary. The two adjacent
    // siblings a,b share a contiguous span along the sibling axis; the boundary
    // sits where their widths split proportional to value. Dragging
    // reapportions a.total/b.total (sum preserved by the group's Num.lens) and
    // the partition layout re-derives reactively. Skip the synthetic root row
    // (depth 0). Orientation picks which canvas axis the boundary runs along.
    if (!this.hasAttribute("no-handles")) {
      type HandleItem = { parent: BiNode; i: number; aNode: BiNode; bNode: BiNode };
      const handleWindow = derive((): readonly HandleItem[] => {
        const fd = focusDepth.value;
        const maxWindow = maxD !== undefined ? fd + maxD : totalDepth;
        const items: HandleItem[] = [];
        for (const n of renderedSet.value) {
          const d = nodeDepth.get(n) ?? 0;
          if (d <= fd || d >= maxWindow) continue;
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
        // peeked inside the lens — never written back.
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
        const dot = circle(knobPos, 5, {
          fill: aNode.value.color,
          stroke: derive(() => active.value ? "#fff" : "#000"),
          strokeWidth: 1.5,
        });
        const dispose = dragCancelable(dot, knob, [a, b], {
          host: this,
          onStart: () => { active.value = true; dot.el.style.cursor = "grabbing"; },
          onEnd: () => { active.value = false; dot.el.style.cursor = "grab"; },
        });
        dot.track(dispose);
        dot.el.style.cursor = isHoriz ? "ns-resize" : "ew-resize";
        dot.el.addEventListener("pointerenter", () => { active.value = true; });
        dot.el.addEventListener("pointerleave", () => { active.value = false; });

        return dot;
      }, { key: ({ bNode }) => bNode.value.id ?? "" });
    }

    if (!this.hasAttribute('no-source')) s(label(view.bottom.up(10), derive(() => {
      const f = state.focused.value;
      return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));
  }
}
