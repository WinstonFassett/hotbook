import {
  Anchor,
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
import { lineHandle } from "../lib/handles";
import { Diagram } from "../lib/diagram";
import { partition, type HierarchyRectangularNode } from "d3-hierarchy";
import { depthFill, labelInk } from "../lib/depth-color";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode, portfolio, walkWithDepth } from "../lib/tree";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import { mountDrillBreadcrumb } from "../lib/drill-breadcrumb";
import { dragCancelable } from "../lib/esc-contract";
import { GESTURE_SUPPRESSION_CSS } from "../lib/transitions";
import { withExitDelay, enterExitFade, membershipCell } from "../lib/mark-lifecycle";
import type { ElementWithBridge } from "../lib/hud-bridge";
import { attachReorderGesture } from "../lib/reorder-gesture";
import { REORDER_ELEVATION_CSS } from "../lib/transitions";
import { applyMultiWithTweenGate, SORT_SEC } from "../lib/tween-gate";

const W = 480;
const H = 480;
const DRILL_DURATION = 800; // ms — leave-timer / CSS settle window
const DRILL_SEC = DRILL_DURATION / 1000; // s — bireactive anim clock runs in seconds

export class MdSunburstLC extends Diagram {
  static styles = `:host { overflow: hidden; }text { pointer-events: none; }${FILL_STYLE}${GESTURE_SUPPRESSION_CSS}${REORDER_ELEVATION_CSS}:host(.vf-gesture-active) circle[r="5"] { opacity: 0; } circle[r="5"] { transition: opacity 0.3s ease; }[data-focusable]:focus { outline: 2px solid #4a9eff; outline-offset: 2px; } [data-focusable]:focus:not(:focus-visible) { outline: none; }`
  externalRoot?: BiNode
  drillKey?: string
  showBreadcrumb?: boolean

  // Reactive so the levels dropdown drives enter/exit fades instead of a remount.
  private _maxDepthCell = cell<number | undefined>(undefined)
  get maxDepth(): number | undefined { return this._maxDepthCell.value }
  set maxDepth(v: number | undefined) { this._maxDepthCell.value = v }

  private _drillIdCell = cell<string | null>(null)
  get drillNodeId(): string | null { return this._drillIdCell.value }
  set drillNodeId(id: string | null) { this._drillIdCell.value = id ?? null }

  private _sortByCell = cell<'index' | 'value'>('index')
  get sortBy(): 'index' | 'value' { return this._sortByCell.value }
  set sortBy(v: 'index' | 'value') { this._sortByCell.value = v }

  private _measureKeyCell = cell<string>('')
  get measureKey(): string { return this._measureKeyCell.value }
  set measureKey(v: string) { this._measureKeyCell.value = v }

  // Drag-to-reorder (WIN-262). Enabled by the caller when sort is by natural
  // order. Emits onReorder(parentId, orderedIds) at commit — hierarchical
  // reorder is scoped to the dragged arc's parent ring.
  private _canReorderCell = cell<boolean>(false)
  get canReorder(): boolean { return this._canReorderCell.value }
  set canReorder(v: boolean) { this._canReorderCell.value = v }
  onReorder?: (parentId: string | null, orderedIds: string[]) => void

  // Bumped when children are reordered so `layout` re-derives (buildHierarchy
  // walks children fresh but doesn't track array mutation). The per-arc tween
  // effect also watches this cell so it fires the sort-lane on commit even
  // though sortBy hasn't toggled.
  private _reorderTickCell = cell<number>(0)

  protected scene(s: Mount): void {
    const { w: Wc, h: Hc } = useHostSize(this, { width: W, height: H });
    const view = this.view(Wc, Hc);
    this.tabIndex = -1;
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

    const maxDepthCell = this._maxDepthCell;

    const Rfull = derive(() => Math.min(Wc.value, Hc.value) / 2 - 4);

    // Natural partition layout — no pre-scaling. Viewport does all fitting.
    const layout = derive(() => {
      const rfull = Rfull.value;
      // Track the reorder tick so children[] mutations force a re-derive
      // (buildHierarchy walks children fresh but reads array-position, so we
      // need an explicit invalidation signal — bireactive doesn't observe
      // array mutations on their own).
      void this._reorderTickCell.value;
      const h = buildHierarchy(root, this._sortByCell.value);
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
      const maxD = maxDepthCell.value;
      const maxWindow = maxD !== undefined && maxD > 0 ? fd + maxD : totalDepth;
      const result: BiNode[] = [];
      const focusNode = id ? nodeById.get(id) : null;
      for (const { node, depth: relDepth } of walkWithDepth(focusNode ?? root)) {
        const absDepth = (focusNode ? fd : 0) + relDepth;
        if (absDepth > fd && absDepth <= maxWindow) result.push(node);
      }
      return result;
    });

    // Rendered set (WIN-155): current window + departing nodes held briefly so
    // the exit CSS fade can play — including on drill. Exiting arcs freeze
    // their layout cells below so they don't remap to degenerate geometry as
    // the viewport tweens.
    const renderedSet = withExitDelay(windowTarget, {
      key: (n) => n,
    });
    const windowMembership = membershipCell(windowTarget, (n) => n);

    let drillInited = false;
    let lastDrillId: string | null = null;
    let drillCancel: (() => void) | null = null;
    let drillClassTimer: ReturnType<typeof setTimeout> | null = null;
    biEffect(() => {
      const id = this._drillIdCell.value;
      const rfull = Rfull.value;
      // Track maxDepth so the levels dropdown re-tweens the viewport — inner
      // rings expand to fill the space vacated by the outer rings, and vice
      // versa when levels are added back (WIN-155 relayout).
      const maxDTracked = maxDepthCell.value;
      let ta0: number, ta1: number, tr0: number, tr1: number;

      const lmap = untracked(() => layout.value);
      if (id) {
        const biNode = nodeById.get(id);
        const lnode = biNode ? lmap.get(biNode) : null;
        if (lnode) {
          const fd = nodeDepth.get(biNode!) ?? 0;
          const maxD = maxDTracked;
          const maxWindow = maxD !== undefined && maxD > 0 ? fd + maxD : totalDepth;
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
        const maxD = maxDTracked;
        // WIN-155: when depth is capped, walk the tree to find the outer y1
        // of the deepest RENDERED ring, so the viewport tween shrinks vr1 and
        // the surviving inner rings expand radially. Without a cap we use the
        // full natural radius. Prior code initialized maxR1 = rfull and only
        // expanded via `>`, so depth caps never shrank the viewport.
        let maxR1: number;
        if (maxD !== undefined && maxD > 0) {
          const maxWindow = maxD;
          maxR1 = 0;
          for (const { node, depth } of walkWithDepth(root)) {
            if (depth > 0 && depth <= maxWindow) {
              const ln = lmap.get(node);
              if (ln && ln.y1 > maxR1) maxR1 = ln.y1;
            }
          }
          if (maxR1 === 0) maxR1 = rfull; // fallback if walk found nothing
        } else {
          maxR1 = rfull;
        }
        ta0 = 0; ta1 = 2 * Math.PI; tr1 = maxR1;
      }

      const drillChanged = id !== lastDrillId;
      lastDrillId = id;
      if (!drillInited) {
        va0.value = ta0; va1.value = ta1; vr0.value = tr0; vr1.value = tr1;
        drillInited = true;
        return;
      }
      if (!drillChanged) {
        // Resize or depth-only change: re-tween from current to new target.
        // WIN-155 relayout — when the levels dropdown drops or adds rings, the
        // inner rings expand or contract to fill the space via this tween.
        drillCancel?.();
        drillCancel = this.anim.start(
          tween(va0, ta0, DRILL_SEC, easeOut),
          tween(va1, ta1, DRILL_SEC, easeOut),
          tween(vr0, tr0, DRILL_SEC, easeOut),
          tween(vr1, tr1, DRILL_SEC, easeOut),
        );
        // Note: depth changes intentionally do NOT toggle GESTURE_ACTIVE_CLASS
        // — that suppresses ALL descendant transitions, which would kill the
        // per-arc enter/exit opacity fade this ticket adds.
        return;
      }
      // Cancel any in-flight drill tween before starting a new one.
      drillCancel?.();
      drillCancel = null;
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

    // Per-arc cells hoisted so the reorder gesture can rewrite siblings' angles
    // imperatively during preview. Populated inside the forEach callback below.
    interface ArcCells {
      la0: ReturnType<typeof num>;
      la1: ReturnType<typeof num>;
      lr0: ReturnType<typeof num>;
      lr1: ReturnType<typeof num>;
      arcEl: SVGGElement;
    }
    const arcCellsByNode = new Map<BiNode, ArcCells>();
    const REORDER_SEC_LOCAL = SORT_SEC;

    // Windowed arc rendering.
    const arcLayer = s(group());
    forEach(arcLayer, renderedSet, (node) => {
      const depth = nodeDepth.get(node) ?? 1;

      // Per-arc raw layout-position cells. Tweened on sort change so arcs sweep
      // to their new angular positions; snapped on value/resize changes so drag
      // editing stays real-time. a0/a1/rIn/rOut below derive from these tweened
      // cells + the viewport remap, so drill (viewport tween) and sort (layout
      // tween) compose without conflict.
      const lseed = untracked(() => layout.value.get(node)) ?? { x0: 0, x1: 0, y0: 0, y1: 0 };
      const la0 = num(lseed.x0), la1 = num(lseed.x1), lr0 = num(lseed.y0), lr1 = num(lseed.y1);
      const ltarget = derive(() => {
        const ln = layout.value.get(node);
        return ln ? { x0: ln.x0, x1: ln.x1, y0: ln.y0, y1: ln.y1 } : { x0: 0, x1: 0, y0: 0, y1: 0 };
      });
      let lcancel: (() => void) | null = null;
      let lInited = false;
      let seenSortBy = untracked(() => this._sortByCell.value);
      let seenMeasureKey = untracked(() => this._measureKeyCell.value);
      let seenReorderTick = untracked(() => this._reorderTickCell.value);
      biEffect(() => {
        const t = ltarget.value;
        const sortBy = this._sortByCell.value;
        const reorderTick = this._reorderTickCell.value;
        const measureKey = untracked(() => this._measureKeyCell.value);
        if (lInited && !untracked(() => windowMembership.value.has(node))) return;
        if (!lInited) { lInited = true; seenSortBy = sortBy; seenMeasureKey = measureKey; seenReorderTick = reorderTick; la0.value = t.x0; la1.value = t.x1; lr0.value = t.y0; lr1.value = t.y1; return; }
        const reordered = sortBy !== seenSortBy;
        const measureSwapped = measureKey !== seenMeasureKey;
        const reorderCommitted = reorderTick !== seenReorderTick;
        seenSortBy = sortBy;
        seenMeasureKey = measureKey;
        seenReorderTick = reorderTick;
        const structural = reordered || measureSwapped || reorderCommitted;
        lcancel?.();
        lcancel = applyMultiWithTweenGate({
          updates: [
            { cell: la0, target: t.x0 },
            { cell: la1, target: t.x1 },
            { cell: lr0, target: t.y0 },
            { cell: lr1, target: t.y1 },
          ],
          structural,
          host: this,
          anim: this.anim,
        });
      });

      // WIN-155: while an arc is exiting, freeze its remapped geometry to the
      // last visible snapshot so the fade-out plays in place instead of
      // sliding through the drill viewport tween.
      let frozenGeom: { a0: number; a1: number; rIn: number; rOut: number } | null = null;
      const a0Raw = derive(() => remapAngle(la0.value));
      const a1Raw = derive(() => remapAngle(la1.value));
      const rInRaw = derive(() => Math.max(0, remapRadius(lr0.value)));
      const rOutRaw = derive(() => Math.max(0, remapRadius(lr1.value)));
      const a0 = derive(() => {
        if (windowMembership.value.has(node)) { frozenGeom = null; return a0Raw.value; }
        if (!frozenGeom) frozenGeom = { a0: a0Raw.peek(), a1: a1Raw.peek(), rIn: rInRaw.peek(), rOut: rOutRaw.peek() };
        return frozenGeom.a0;
      });
      const a1 = derive(() => (frozenGeom ? frozenGeom.a1 : a1Raw.value));
      const rIn = derive(() => (frozenGeom ? frozenGeom.rIn : rInRaw.value));
      const rOut = derive(() => (frozenGeom ? frozenGeom.rOut : rOutRaw.value));
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
      arc.el.setAttribute('tabindex', '0');
      arc.el.setAttribute('data-focusable', 'arc');

      // Register this arc's cells so the reorder gesture (attached below) can
      // rewrite any sibling's angles imperatively during preview.
      arcCellsByNode.set(node, { la0, la1, lr0, lr1, arcEl: arc.el as SVGGElement });

      // Wrap the arc and its label in a per-row group so the drag-elevate
      // raises the label with the arc (no label occlusion during drag).
      const rowGroup = group();
      rowGroup.add(arc);

      // ─── Drag-to-reorder (WIN-262) ────────────────────────────────────
      // Reorder scoped to the dragged arc's parent ring. Root children are
      // reorderable when dragged at depth 1. Leaves reorder within their
      // parent's children ring.
      let reorderDetach: (() => void) | null = null;
      biEffect(() => {
        const enabled = this._canReorderCell.value;
        reorderDetach?.();
        reorderDetach = null;
        if (!enabled) { arc.el.style.cursor = 'pointer'; return; }
        const parent = parentOf(node);
        // Root itself never reorders (it has no siblings). Nodes without a
        // parent (shouldn't happen for rendered arcs) skip too.
        if (!parent) { arc.el.style.cursor = 'pointer'; return; }
        const siblings = (parent.children as readonly BiNode[]);
        if (siblings.length < 2) { arc.el.style.cursor = 'pointer'; return; }
        arc.el.style.cursor = 'grab';

        let startMouseAngle = Number.NaN;
        let startMidAngle = 0;
        let dragSpan = 0;
        const initialMidById = new Map<string, number>();
        const siblingTweenCancels = new Map<string, () => void>();
        const lastAppliedIdx = new Map<string, number>();
        // Raw angular range of the parent (in unremapped layout coords).
        let parentA0 = 0;
        let parentA1 = 2 * Math.PI;
        let parentValue = 1;

        const pointerAngle = (e: PointerEvent): number => {
          const svg = arc.el.ownerSVGElement;
          let px = e.clientX, py = e.clientY;
          if (svg) {
            const pt = svg.createSVGPoint();
            pt.x = e.clientX; pt.y = e.clientY;
            const ctm = svg.getScreenCTM();
            if (ctm) { const p = pt.matrixTransform(ctm.inverse()); px = p.x; py = p.y; }
          }
          const c = center.peek();
          const dispAng = Math.atan2(py - c.y, px - c.x);
          // Convert display angle back into raw layout angle via the viewport.
          const spanA = va1.peek() - va0.peek();
          const rawAng = spanA === 0 ? dispAng : va0.peek() + ((dispAng + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * spanA;
          return rawAng;
        };

        const shortestDelta = (from: number, to: number): number => {
          let d = to - from;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          return d;
        };

        // Compute new angular slots for siblings in a provisional order, given
        // the parent's raw angular range and each child's value.
        const computeSlots = (order: readonly string[]): Map<string, { x0: number; x1: number }> => {
          const totalVal = siblings.reduce((s, c) => {
            const ln = layout.peek().get(c);
            return s + (ln?.value ?? 0);
          }, 0) || 1;
          const map = new Map<string, { x0: number; x1: number }>();
          let cursor = parentA0;
          for (const id of order) {
            const c = siblings.find(x => x.value.id === id);
            if (!c) continue;
            const ln = layout.peek().get(c);
            const v = ln?.value ?? 0;
            const span = (v / totalVal) * (parentA1 - parentA0);
            const x0 = cursor;
            const x1 = cursor + span;
            map.set(id, { x0, x1 });
            cursor = x1;
          }
          return map;
        };

        const detach = attachReorderGesture({
          hitEl: arc.el,
          // Raise the whole forEach group (arc + label) so the label stays on
          // top of the arc and is not occluded when the arc is re-appended.
          dragEl: arc.el.parentElement as unknown as SVGGElement,
          itemId: node.value.id ?? '',
          host: this,
          getInitialOrder: () => siblings.map(x => x.value.id ?? ''),
          computeTargetIndex: (e, order) => {
            if (Number.isNaN(startMouseAngle)) return order.indexOf(node.value.id ?? '');
            const cur = pointerAngle(e);
            const delta = shortestDelta(startMouseAngle, cur);
            const ghostMid = startMidAngle + delta;
            const scored = order.map(id => ({
              id,
              mid: id === node.value.id ? ghostMid : (initialMidById.get(id) ?? 0),
            }));
            scored.sort((a, b) => a.mid - b.mid);
            return scored.findIndex(s => s.id === node.value.id);
          },
          onActivate: () => {
            const lmap = layout.peek();
            // Parent range (in raw layout coords).
            const pln = lmap.get(parent);
            parentA0 = pln?.x0 ?? 0;
            parentA1 = pln?.x1 ?? 2 * Math.PI;
            parentValue = pln?.value ?? 1;
            void parentValue;
            initialMidById.clear();
            for (const c of siblings) {
              const ln = lmap.get(c);
              if (!ln || !c.value.id) continue;
              initialMidById.set(c.value.id, (ln.x0 + ln.x1) / 2);
            }
            const me = lmap.get(node);
            startMidAngle = me ? (me.x0 + me.x1) / 2 : 0;
            dragSpan = me ? (me.x1 - me.x0) : 0;
            startMouseAngle = Number.NaN;
            siblingTweenCancels.forEach(fn => fn());
            siblingTweenCancels.clear();
            lastAppliedIdx.clear();
            siblings.forEach((c, i) => { if (c.value.id) lastAppliedIdx.set(c.value.id, i); });
          },
          onPreview: (order, e) => {
            if (Number.isNaN(startMouseAngle)) startMouseAngle = pointerAngle(e);
            const slots = computeSlots(order);
            // Siblings tween to their new angular slots when their index flips.
            for (let i = 0; i < order.length; i++) {
              const id = order[i]!;
              if (id === node.value.id) continue;
              if (lastAppliedIdx.get(id) === i) continue;
              lastAppliedIdx.set(id, i);
              const c = siblings.find(x => x.value.id === id);
              if (!c) continue;
              const cells = arcCellsByNode.get(c);
              const slot = slots.get(id);
              if (!cells || !slot) continue;
              siblingTweenCancels.get(id)?.();
              const cancelA = this.anim.start(tween(cells.la0, slot.x0, REORDER_SEC_LOCAL, easeOut) as any);
              const cancelB = this.anim.start(tween(cells.la1, slot.x1, REORDER_SEC_LOCAL, easeOut) as any);
              const cancel = () => { cancelA?.(); cancelB?.(); };
              siblingTweenCancels.set(id, cancel);
            }
            // Dragged arc: ghost centered on pointer's raw angle, keep original span.
            const cur = pointerAngle(e);
            const delta = shortestDelta(startMouseAngle, cur);
            const ghostMid = startMidAngle + delta;
            const meCells = arcCellsByNode.get(node);
            if (meCells) {
              meCells.la0.value = ghostMid - dragSpan / 2;
              meCells.la1.value = ghostMid + dragSpan / 2;
            }
          },
          onEnd: (finalOrder, canceled) => {
            siblingTweenCancels.forEach(fn => fn());
            siblingTweenCancels.clear();

            const initial = siblings.map(x => x.value.id ?? '');
            const changed = !canceled && finalOrder.some((id, i) => id !== initial[i]);
            if (changed) {
              // Mutate parent.children to match the committed order.
              const byId = new Map(siblings.map(c => [c.value.id ?? '', c]));
              const next = finalOrder.map(id => byId.get(id)).filter(Boolean) as BiNode[];
              if (next.length === siblings.length) {
                (parent.children as BiNode[]).splice(0, siblings.length, ...next);
                // Force layout re-derive; the per-arc effect will tween each
                // arc from its current (imperative) position to the new target
                // via the reorderCommitted lane.
                this._reorderTickCell.value = this._reorderTickCell.value + 1;
                this.onReorder?.(parent.value.id ?? null, finalOrder.slice());
              }
              this.dispatchEvent(new CustomEvent('gesturecommit', { detail: { canceled: false, reorder: true } }));
              return;
            }
            // Cancel or no-op: tween each sibling back to its initial slot.
            const lmap = layout.peek();
            for (const c of siblings) {
              const cells = arcCellsByNode.get(c);
              const ln = lmap.get(c);
              if (!cells || !ln) continue;
              this.anim.start(tween(cells.la0, ln.x0, REORDER_SEC_LOCAL, easeOut) as any);
              this.anim.start(tween(cells.la1, ln.x1, REORDER_SEC_LOCAL, easeOut) as any);
            }
            this.dispatchEvent(new CustomEvent('gesturecommit', { detail: { canceled } }));
          },
        });
        reorderDetach = detach;
      });

      // WIN-155 enter/exit fade — arc fades in on mount, fades out when the
      // node leaves the drill window (held in renderedSet by withExitDelay).
      const arcPresent = derive(() => windowMembership.value.has(node));
      enterExitFade(arc.el, { present: arcPresent });
      biEffect(() => {
        arc.el.setAttribute('aria-label', `${node.value.label}: ${node.value.total.value.toFixed(0)}`);
      });
      arc.el.addEventListener("click", () => { state.focused.value = node; });
      arc.el.addEventListener("focus", () => { state.focused.value = node; });
      arc.el.addEventListener("blur", () => { if (state.focused.value === node) state.focused.value = null; });
      arc.el.addEventListener("pointerenter", () => { state.hovered.current = node; hoverCell.value = node; state.emitHover?.(node); });
      arc.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) { state.hovered.current = null; hoverCell.value = null; state.emitHover?.(null); } });

      // Label rendering — only show for arcs large enough to fit text
      const isLeaf = !node.children || node.children.length === 0;
      const arcAngleSpan = derive(() => Math.abs(a1.value - a0.value));
      const arcRadialThickness = derive(() => rOut.value - rIn.value);
      const showLabel = derive(() => {
        // Only show label if arc is large enough: at least 0.15 radians (~8.6°) and 20px thick
        return arcAngleSpan.value >= 0.15 && arcRadialThickness.value >= 20;
      });

      const labelPos = Vec.derive(() => {
        const midAngle = (a0.value + a1.value) / 2;
        const midRadius = (rIn.value + rOut.value) / 2;
        const c = center.value;
        return { x: c.x + midRadius * Math.cos(midAngle), y: c.y + midRadius * Math.sin(midAngle) };
      });

      const labelText = derive(() => {
        if (!showLabel.value) return '';
        return isLeaf
          ? `${node.value.label}\n${node.value.total.value.toFixed(0)}`
          : node.value.label;
      });

      const nodeFill = depthFill(node.value.color, depth);
      const lbl = label(labelPos, labelText, {
        size: isLeaf ? 11 : 10,
        align: Anchor.Center,
        fill: labelInk(nodeFill),
        bold: !isLeaf,
      });

      // group(opts, ...children): first arg is OPTS — passing the arc there
      // silently swallowed it (labels-only sunburst). Wrap both in a group.
      rowGroup.add(lbl);
      return rowGroup;
    }, { key: (n) => n.value.id });

    // Windowed handle rendering.
    if (!this.hasAttribute("no-handles")) {
      type HandleItem = { aNode: BiNode; bNode: BiNode };
      const handleWindow = derive((): readonly HandleItem[] => {
        const fd = focusDepth.value;
        const maxD = maxDepthCell.value;
        const maxWindow = maxD !== undefined && maxD > 0 ? fd + maxD : totalDepth;

        // Group nodes by depth level
        const byDepth = new Map<number, BiNode[]>();
        for (const n of renderedSet.value) {
          const d = nodeDepth.get(n) ?? 0;
          if (d <= fd || d > maxWindow) continue;
          if (!byDepth.has(d)) byDepth.set(d, []);
          byDepth.get(d)!.push(n);
        }

        // For each depth level, sort nodes by angle and create handles
        const items: HandleItem[] = [];
        const lmap = layout.value;

        for (const nodes of byDepth.values()) {
          // Sort by angular position
          nodes.sort((a, b) => {
            const aLayout = lmap.get(a);
            const bLayout = lmap.get(b);
            if (!aLayout || !bLayout) return 0;
            return aLayout.x0 - bLayout.x0;
          });

          // Create handles between all adjacent pairs at this depth
          for (let i = 1; i < nodes.length; i++) {
            items.push({ aNode: nodes[i - 1]!, bNode: nodes[i]! });
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
        // For radial dividers, the handle aligns with the radial divider line.
        const tangentAngle = derive(() => boundaryAngDisplay.value);
        const handle = lineHandle(knobPos, tangentAngle, {
          kind: "divider",
          active,
        });
        const dispose = dragCancelable(handle, knob, [a, b], {
          host: this,
          onStart: () => { active.value = true; handle.el.style.cursor = "grabbing"; },
          onEnd: () => { active.value = false; handle.el.style.cursor = "grab"; },
        });
        handle.track(dispose);
        handle.el.style.cursor = "grab";
        handle.el.addEventListener("pointerenter", () => { active.value = true; });
        handle.el.addEventListener("pointerleave", () => { active.value = false; });

        return handle;
      }, { key: ({ aNode, bNode }) => `${aNode.value.id}:${bNode.value.id}` });
    }

    // Center hub rendered LAST so it sits above arcLayer and receives pointer events.
    // When drilled, the hub becomes the center and retains the drilled node's color.
    const hubVisible = derive(() => this._drillIdCell.value !== null);
    const hubFill = derive(() => {
      const id = this._drillIdCell.value;
      if (!id) return "#1a1d22";
      const n = nodeById.get(id);
      return n ? n.value.color : "#1a1d22";
    });
    const hub = s(circle(center, derive(() => hubVisible.value ? 18 : 0), {
      fill: hubFill,
      stroke: "#444",
      strokeWidth: 1,
    }));
    hub.el.style.cursor = "pointer";
    hub.el.addEventListener("dblclick", (e: MouseEvent) => {
      e.stopPropagation();
      if (!this._drillIdCell.value) return;
      const biNode = nodeById.get(this._drillIdCell.value);
      const parent = biNode ? parentOf(biNode) : null;
      const targetId = (parent && (nodeDepth.get(parent) ?? 0) > 0)
        ? (parent.value.id ?? null)
        : null;
      // Drill directly — don't wait for a round-trip.
      this.drillNodeId = targetId;
      const drillKey = (this as any).drillKey ?? "default";
      const br = (this as ElementWithBridge).brSync;
      br?.emitDrill?.(drillKey, targetId);
    });

    if (!this.hasAttribute('no-source')) s(label(view.bottom.up(10), derive(() => {
      const f = state.focused.value;
      return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));

    if (this.showBreadcrumb !== false && this.chromeLayer) {
      mountDrillBreadcrumb({
        drillIdCell: this._drillIdCell,
        root,
        chromeLayer: this.chromeLayer,
        onDrill: (id) => {
          this.drillNodeId = id;
          const drillKey = (this as any).drillKey ?? "default";
          (this as ElementWithBridge).brSync?.emitDrill?.(drillKey, id);
        },
      });
    }
  }
}
