import {
  Anchor,
  Diagram,
  derive,
  forEach,
  group,
  label,
  type Mount,
  cell,
  annularSector,
  circle,
  Vec,
  num,
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
import type { ElementWithBridge } from "../lib/hud-bridge";

const W = 480;
const H = 480;
const DRILL_DURATION = 800; // ms — leave-timer / CSS settle window
const DRILL_SEC = DRILL_DURATION / 1000; // s — bireactive anim clock runs in seconds

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

    const Rfull = derive(() => Math.min(Wc.value, Hc.value) / 2 - 4);

    // Natural partition layout — no pre-scaling. Viewport does all fitting.
    const layout = derive(() => {
      const rfull = Rfull.value;
      const h = buildHierarchy(root);
      partition<BiNode>().size([2 * Math.PI, rfull])(h);
      const map = new Map<BiNode, HierarchyRectangularNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyRectangularNode<BiNode>));
      return map;
    });

    // Viewport cells for angle (x) and radius (y) domains.
    const va0 = num(0);
    const va1 = num(2 * Math.PI);
    const vr0 = num(0);
    const vr1 = num(Rfull.value);

    // Focus depth (reactive).
    const focusDepth = derive(() => {
      const id = this._drillIdCell.value;
      if (!id) return 0;
      const n = nodeById.get(id);
      return n ? (nodeDepth.get(n) ?? 0) : 0;
    });

    // Window: children of the drilled node only (not full-tree siblings).
    // Walking the whole tree and including off-angle siblings produces slivers:
    // their remapped angles fall outside [0, 2π] causing degenerate arc paths.
    const windowTarget = derive((): readonly BiNode[] => {
      const fd = focusDepth.value;
      const id = this._drillIdCell.value;
      const maxWindow = maxD !== undefined ? fd + maxD : totalDepth;
      const result: BiNode[] = [];
      const focusNode = id ? nodeById.get(id) : null;
      for (const { node, depth: relDepth } of walkWithDepth(focusNode ?? root)) {
        const absDepth = (focusNode ? fd : 0) + relDepth;
        if (absDepth > fd && absDepth <= maxWindow) result.push(node);
      }
      return result;
    });

    // Rendered set: current window + departing nodes kept briefly for value-change animations.
    // On drill: discard leavers immediately — they remap to degenerate arcs outside the viewport.
    // On value-change: keep leavers for DRILL_DURATION so arcs animate out gracefully.
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

    let drillInited = false;
    let lastDrillId: string | null = null;
    let drillCancel: (() => void) | null = null;
    let drillClassTimer: ReturnType<typeof setTimeout> | null = null;
    biEffect(() => {
      const id = this._drillIdCell.value;
      const rfull = Rfull.value;
      let ta0: number, ta1: number, tr0: number, tr1: number;

      const lmap = untracked(() => layout.value);
      if (id) {
        const biNode = nodeById.get(id);
        const lnode = biNode ? lmap.get(biNode) : null;
        if (lnode) {
          const fd = nodeDepth.get(biNode!) ?? 0;
          const maxWindow = maxD !== undefined ? fd + maxD : totalDepth;
          // Walk only the focus subtree to find the deepest rendered ring.
          let maxR1 = lnode.y1;
          for (const { node, depth: relDepth } of walkWithDepth(biNode!)) {
            const absDepth = fd + relDepth;
            if (absDepth > fd && absDepth <= maxWindow) {
              const ln = lmap.get(node);
              if (ln && ln.y1 > maxR1) maxR1 = ln.y1;
            }
          }
          ta0 = lnode.x0; ta1 = lnode.x1; tr0 = lnode.y1; tr1 = maxR1;
        } else {
          ta0 = 0; ta1 = 2 * Math.PI; tr0 = 0; tr1 = rfull;
        }
      } else {
        // At root: map [root.y1, maxRendered.y1] → [0, Rfull].
        const rootLayout = lmap.get(root);
        tr0 = rootLayout ? rootLayout.y1 : 0;
        const maxWindow = maxD !== undefined ? maxD : totalDepth;
        let maxR1 = rfull;
        for (const { node, depth } of walkWithDepth(root)) {
          if (depth > 0 && depth <= maxWindow) {
            const ln = lmap.get(node);
            if (ln && ln.y1 > maxR1) maxR1 = ln.y1;
          }
        }
        ta0 = 0; ta1 = 2 * Math.PI; tr1 = maxR1;
      }

      const drillChanged = id !== lastDrillId;
      lastDrillId = id;
      // Cancel any in-flight drill tween before snapping or re-tweening.
      drillCancel?.();
      drillCancel = null;
      if (!drillInited || !drillChanged) {
        va0.value = ta0; va1.value = ta1; vr0.value = tr0; vr1.value = tr1;
        drillInited = true;
        return;
      }
      // Suppress CSS transitions on arc `d` attribute during drill (the bireactive
      // tween sets `d` every frame; CSS interpolation between consecutive frames
      // causes large-arc-flag flips → sliver/spoke artifacts).
      if (drillClassTimer) { clearTimeout(drillClassTimer); drillClassTimer = null; }
      this.classList.add('vf-gesture-active');
      drillClassTimer = setTimeout(() => {
        drillClassTimer = null;
        this.classList.remove('vf-gesture-active');
      }, DRILL_DURATION + 60);
      // Drive the viewport tween on this Diagram's anim clock — `tween()` alone
      // only builds a generator; it must be started to advance per frame.
      drillCancel = this.anim.start(
        tween(va0, ta0, DRILL_SEC, easeOut),
        tween(va1, ta1, DRILL_SEC, easeOut),
        tween(vr0, tr0, DRILL_SEC, easeOut),
        tween(vr1, tr1, DRILL_SEC, easeOut),
      );
    });

    const remapAngle = (rawA: number) => {
      const spanA = va1.value - va0.value;
      return spanA === 0 ? 0 : (rawA - va0.value) / spanA * 2 * Math.PI;
    };
    const remapRadius = (rawR: number) => {
      const spanR = vr1.value - vr0.value;
      return spanR === 0 ? 0 : (rawR - vr0.value) / spanR * Rfull.value;
    };

    const center = Vec.derive(() => ({ x: Wc.value / 2, y: Hc.value / 2 }));

    // Windowed arc rendering.
    const arcLayer = s(group());
    forEach(arcLayer, renderedSet, (node) => {
      const depth = nodeDepth.get(node) ?? 1;

      const a0 = derive(() => remapAngle(layout.value.get(node)?.x0 ?? 0));
      const a1 = derive(() => remapAngle(layout.value.get(node)?.x1 ?? 0));
      const rIn = derive(() => Math.max(0, remapRadius(layout.value.get(node)?.y0 ?? 0)));
      const rOut = derive(() => Math.max(0, remapRadius(layout.value.get(node)?.y1 ?? 0)));
      const stroke = derive(() =>
        state.focused.value === node ? "#fff"
        : hoverCell.value === node ? "#c8cdd6"
        : "#0b0d12"
      );
      const strokeWidth = derive(() => (state.focused.value === node || hoverCell.value === node ? 2 : 1));

      const arc = annularSector(center, rOut, rIn, a0, a1, {
        fill: depthFill(node.value.color, depth).toString(),
        stroke,
        strokeWidth,
      });
      arc.el.dataset.id = node.value.id ?? "";
      arc.el.style.cursor = "pointer";
      arc.el.style.transition = settleTransition("d");
      arc.el.addEventListener("click", () => { state.focused.value = node; });
      arc.el.addEventListener("pointerenter", () => { state.hovered.current = node; hoverCell.value = node; state.emitHover?.(node); });
      arc.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) { state.hovered.current = null; hoverCell.value = null; state.emitHover?.(null); } });

      return arc;
    }, { key: (n) => n.value.id });

    // Windowed handle rendering.
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

        const angStart = derive(() => layout.value.get(aNode)?.x0 ?? 0);
        const angEnd = derive(() => layout.value.get(bNode)?.x1 ?? 0);
        const rInRaw = derive(() => layout.value.get(aNode)?.y0 ?? 0);
        const rOutRaw = derive(() => layout.value.get(aNode)?.y1 ?? 0);
        const midRDisplay = derive(() => (remapRadius(rInRaw.value) + remapRadius(rOutRaw.value)) / 2);

        const boundaryAngDisplay = derive(() => {
          const va = a.value, vb = b.value;
          const sum = va + vb;
          const frac = sum === 0 ? 0.5 : va / sum;
          const rawAng = angStart.value + frac * (angEnd.value - angStart.value);
          return remapAngle(rawAng);
        });
        const knobPos = Vec.derive(() => {
          const ang = boundaryAngDisplay.value;
          const r = midRDisplay.value;
          const c = center.value;
          return { x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) };
        });

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
            let dispAng = Math.atan2(target.y - c.y, target.x - c.x);
            if (dispAng < 0) dispAng += 2 * Math.PI;
            const spanA = va1.value - va0.value;
            const rawAng = spanA === 0 ? dispAng : va0.value + (dispAng / (2 * Math.PI)) * spanA;
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
        dot.el.style.cursor = "grab";
        dot.el.addEventListener("pointerenter", () => { active.value = true; });
        dot.el.addEventListener("pointerleave", () => { active.value = false; });

        return dot;
      }, { key: ({ bNode }) => bNode.value.id });
    }

    // Center hub rendered LAST so it sits above arcLayer and receives pointer events.
    const hubVisible = derive(() => this._drillIdCell.value !== null);
    const hub = s(circle(center, derive(() => hubVisible.value ? 18 : 0), {
      fill: "#1a1d22",
      stroke: "#444",
      strokeWidth: 1,
    }));
    hub.el.style.cursor = "pointer";
    hub.el.style.transition = settleTransition("r");
    hub.el.addEventListener("click", () => {
      if (!this._drillIdCell.value) return;
      const biNode = nodeById.get(this._drillIdCell.value);
      const parent = biNode ? parentOf(biNode) : null;
      const drillKey = (this as any).drillKey ?? "default";
      const br = (this as ElementWithBridge).brSync;
      br?.emitDrill?.(drillKey, parent?.value.id ?? null);
    });

    if (!this.hasAttribute('no-source')) s(label(view.bottom.up(10), derive(() => {
      const f = state.focused.value;
      return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));
  }
}
