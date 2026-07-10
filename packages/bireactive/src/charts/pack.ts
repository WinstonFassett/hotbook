import {
  Anchor,
  derive,
  forEach,
  group,
  label,
  type Mount,
  cell,
  circle,
  Vec,
  num,
  tween,
  easeOut,
  effect as biEffect,
  untracked,
} from "bireactive";
import { Diagram } from "../lib/diagram";
import type { ElementWithBridge } from "../lib/hud-bridge";
import { pack as d3pack, type HierarchyCircularNode } from "d3-hierarchy";
import { depthFill, labelInk } from "../lib/depth-color";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode, portfolio, walkWithDepth } from "../lib/tree";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import { mountDrillBreadcrumb } from "../lib/drill-breadcrumb";
import { GESTURE_SUPPRESSION_CSS, GESTURE_ACTIVE_CLASS, ENTER_MS } from "../lib/transitions";
import { withExitDelay, membershipCell } from "../lib/mark-lifecycle";

const W = 480;
const H = 480;
const PAD = 2;
const DRILL_DURATION = 800; // ms — leave-timer / CSS settle window
const DRILL_SEC = DRILL_DURATION / 1000; // s — bireactive anim clock runs in seconds
const SORT_SEC = 0.35; // s — sort/reorder tween duration

export class MdPack extends Diagram {
  static styles = `:host { overflow: hidden; }text { pointer-events: none; }${FILL_STYLE}${GESTURE_SUPPRESSION_CSS}[data-focusable]:focus { outline: 2px solid #4a9eff; outline-offset: 2px; } [data-focusable]:focus:not(:focus-visible) { outline: none; }`
  externalRoot?: BiNode
  drillKey?: string

  // Reactive so the levels dropdown drives enter/exit fades instead of a remount.
  private _maxDepthCell = cell<number | undefined>(undefined)
  get maxDepth(): number | undefined { return this._maxDepthCell.value }
  set maxDepth(v: number | undefined) { this._maxDepthCell.value = v }

  // Internal reactive cell updated by the drillNodeId setter.
  private _drillIdCell = cell<string | null>(null)

  get drillNodeId(): string | null { return this._drillIdCell.value }
  set drillNodeId(id: string | null) { this._drillIdCell.value = id ?? null }

  private _sortByCell = cell<'index' | 'value'>('index')
  get sortBy(): 'index' | 'value' { return this._sortByCell.value }
  set sortBy(v: 'index' | 'value') { this._sortByCell.value = v }

  private _measureKeyCell = cell<string>('')
  get measureKey(): string { return this._measureKeyCell.value }
  set measureKey(v: string) { this._measureKeyCell.value = v }

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
    attachChartGestures(this, { root, parentOf, state });
    const hoverCell = cell<BiNode | null>(null);
    state.hoverCell = hoverCell;

    const layout = derive(() => {
      const h = buildHierarchy(root, this._sortByCell.value);
      d3pack<BiNode>().size([Wc.value, Hc.value]).padding(PAD)(h);
      const map = new Map<BiNode, HierarchyCircularNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyCircularNode<BiNode>));
      return map;
    });

    // Pre-build static maps (tree structure is immutable).
    const nodeById = new Map<string, BiNode>();
    const nodeDepth = new Map<BiNode, number>();
    let totalDepth = 0;
    for (const { node, depth } of walkWithDepth(root)) {
      if (node.value.id) nodeById.set(node.value.id, node);
      nodeDepth.set(node, depth);
      if (depth > totalDepth) totalDepth = depth;
    }

    const focusDepth = derive(() => {
      const id = this._drillIdCell.value;
      if (!id) return 0;
      const n = nodeById.get(id);
      return n ? (nodeDepth.get(n) ?? 0) : 0;
    });

    // Viewport cells: the region of layout-space currently mapped to canvas.
    // Default: full canvas (x in [0,W], y in [0,H]).
    const vx0 = num(0);
    const vy0 = num(0);
    const vx1 = num(W);
    const vy1 = num(H);

    // Watch drillNodeId; on change tween the viewport to the drilled node bounds.
    // Reads Wc/Hc (tracked) so viewport resets correctly on resize.
    // Reads layout via untracked so value edits don't re-fire the tween.
    const maxDepthCell = this._maxDepthCell;
    let drillInited = false;
    let lastDrillId: string | null = null;
    let drillCancel: (() => void) | null = null;
    let drillClassTimer: ReturnType<typeof setTimeout> | null = null;
    biEffect(() => {
      const id = this._drillIdCell.value;
      const W0 = Wc.value, H0 = Hc.value;
      let tx0: number, ty0: number, tx1: number, ty1: number;
      if (id) {
        const lmap = untracked(() => layout.value);
        const biNode = nodeById.get(id);
        const lnode = biNode ? lmap.get(biNode) : null;
        if (lnode) {
          // Viewport = union bounding box of all descendants of the drilled node.
          const fd = nodeDepth.get(biNode!) ?? 0;
          const maxD = untracked(() => maxDepthCell.value);
          const maxWindow = maxD !== undefined && maxD > 0 ? fd + maxD : totalDepth;
          let minX0 = Infinity, minY0 = Infinity, maxX1 = -Infinity, maxY1 = -Infinity;
          for (const { node, depth: relDepth } of walkWithDepth(biNode!)) {
            const absDepth = fd + relDepth;
            if (absDepth > fd && absDepth <= maxWindow) {
              const ln = lmap.get(node);
              if (ln) {
                const x0 = ln.x - ln.r, y0 = ln.y - ln.r;
                const x1 = ln.x + ln.r, y1 = ln.y + ln.r;
                if (x0 < minX0) minX0 = x0;
                if (y0 < minY0) minY0 = y0;
                if (x1 > maxX1) maxX1 = x1;
                if (y1 > maxY1) maxY1 = y1;
              }
            }
          }
          if (maxX1 === -Infinity) { tx0 = 0; ty0 = 0; tx1 = W0; ty1 = H0; }
          else { tx0 = minX0; ty0 = minY0; tx1 = maxX1; ty1 = maxY1; }
        } else {
          tx0 = 0; ty0 = 0; tx1 = W0; ty1 = H0;
        }
      } else {
        tx0 = 0; ty0 = 0; tx1 = W0; ty1 = H0;
      }
      // Animate only when drill id changes; snap for initial load and resize.
      const drillChanged = id !== lastDrillId;
      lastDrillId = id;
      if (!drillInited) {
        vx0.value = tx0; vy0.value = ty0; vx1.value = tx1; vy1.value = ty1;
        drillInited = true;
        return;
      }
      if (!drillChanged) {
        // Resize-only (e.g. breadcrumb appeared): re-tween from current to new target.
        drillCancel?.();
        drillCancel = this.anim.start(
          tween(vx0, tx0, DRILL_SEC, easeOut),
          tween(vy0, ty0, DRILL_SEC, easeOut),
          tween(vx1, tx1, DRILL_SEC, easeOut),
          tween(vy1, ty1, DRILL_SEC, easeOut),
        );
        return;
      }
      // Cancel any in-flight drill tween before starting a new one.
      drillCancel?.();
      drillCancel = null;
      // Drive the viewport tween on this Diagram's anim clock — `tween()` alone
      // only builds a generator; it must be started to advance per frame.
      drillCancel = this.anim.start(
        tween(vx0, tx0, DRILL_SEC, easeOut),
        tween(vy0, ty0, DRILL_SEC, easeOut),
        tween(vx1, tx1, DRILL_SEC, easeOut),
        tween(vy1, ty1, DRILL_SEC, easeOut),
      );
      if (drillClassTimer) { clearTimeout(drillClassTimer); drillClassTimer = null; }
      this.classList.add(GESTURE_ACTIVE_CLASS);
      drillClassTimer = setTimeout(() => {
        drillClassTimer = null;
        this.classList.remove(GESTURE_ACTIVE_CLASS);
      }, DRILL_DURATION + 60);
    });

    // Window: when drilled (fd > 0) include focus node as context circle + descendants.
    // Walk focus subtree only so off-screen sibling circles don't leak into the canvas.
    // At root (fd = 0) walk full tree, exclude root itself.
    const windowTarget = derive((): readonly BiNode[] => {
      const fd = focusDepth.value;
      const id = this._drillIdCell.value;
      const maxD = maxDepthCell.value;
      const maxWindow = maxD !== undefined && maxD > 0 ? fd + maxD : totalDepth;
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

    // Rendered set (WIN-155): current window + departing nodes held briefly so
    // the exit CSS fade can play — including on drill. Exiting circles freeze
    // their remapped geometry below so they don't ghost through the drill zoom.
    const renderedSet = withExitDelay(windowTarget, {
      key: (n) => n,
    });
    const windowMembership = membershipCell(windowTarget, (n) => n);

    // Windowed node rendering.
    const nodeLayer = s(group());
    forEach(nodeLayer, renderedSet, (node) => {
      const nd = nodeDepth.get(node) ?? 0;
      const isLeaf = (node.children as BiNode[]).length === 0;

      // Per-circle raw layout-position cells. Tweened on sort change so circles
      // slide to their new pack positions; snapped on value/resize changes so
      // drag editing stays real-time. cx/cy/r below derive from these tweened
      // cells + the viewport cells, so drill (viewport tween) and sort (layout
      // tween) compose without conflict.
      const lseed = untracked(() => layout.value.get(node)) ?? { x: 0, y: 0, r: 0 };
      const lx = num(lseed.x), ly = num(lseed.y), lr = num(lseed.r);
      const ltarget = derive(() => {
        const ln = layout.value.get(node);
        return ln ? { x: ln.x, y: ln.y, r: ln.r } : { x: 0, y: 0, r: 0 };
      });
      let lcancel: (() => void) | null = null;
      let lInited = false;
      let seenSortBy = untracked(() => this._sortByCell.value);
      let seenMeasureKey = untracked(() => this._measureKeyCell.value);
      biEffect(() => {
        const t = ltarget.value; // track layout (reacts to sort + value + size)
        const sortBy = this._sortByCell.value; // track sort key so a toggle re-fires this effect
        const measureKey = untracked(() => this._measureKeyCell.value); // read untracked — effect fires on layout change (leaf writes), by which point measureKey is already set
        if (!lInited) { lInited = true; seenSortBy = sortBy; seenMeasureKey = measureKey; lx.value = t.x; ly.value = t.y; lr.value = t.r; return; }
        // Two-lane split. TWEEN for a real reorder (sort key toggled) or measure
        // swap — circles slide to new pack positions. SNAP for everything else:
        // active gesture (real-time drag), and — crucially — value edits / commits
        // / resize, including REMOTE cross-tile edits that carry no gesture class
        // (R2: value changes are write-through, no 250-350ms settle-lag).
        const reordered = sortBy !== seenSortBy;
        const measureSwapped = measureKey !== seenMeasureKey;
        seenSortBy = sortBy;
        seenMeasureKey = measureKey;
        if ((reordered || measureSwapped) && !this.classList.contains(GESTURE_ACTIVE_CLASS)) {
          lcancel?.();
          lcancel = this.anim.start(
            tween(lx, t.x, SORT_SEC, easeOut),
            tween(ly, t.y, SORT_SEC, easeOut),
            tween(lr, t.r, SORT_SEC, easeOut),
          );
        } else {
          lcancel?.(); lcancel = null;
          lx.value = t.x; ly.value = t.y; lr.value = t.r;
        }
      });

      // Uniform scale — pack circles must stay circular or they overlap.
      // Use min(Wc/spanW, Hc/spanH) so the content fits and stays proportional.
      const cxRaw = derive(() => {
        const spanW = vx1.value - vx0.value;
        const spanH = vy1.value - vy0.value;
        if (spanW === 0 || spanH === 0) return 0;
        const scale = Math.min(Wc.value / spanW, Hc.value / spanH);
        return (lx.value - vx0.value) * scale + (Wc.value - spanW * scale) / 2;
      });
      const cyRaw = derive(() => {
        const spanW = vx1.value - vx0.value;
        const spanH = vy1.value - vy0.value;
        if (spanW === 0 || spanH === 0) return 0;
        const scale = Math.min(Wc.value / spanW, Hc.value / spanH);
        return (ly.value - vy0.value) * scale + (Hc.value - spanH * scale) / 2;
      });
      const rRaw = derive(() => {
        const spanW = vx1.value - vx0.value;
        const spanH = vy1.value - vy0.value;
        if (spanW === 0 || spanH === 0) return 0;
        const scale = Math.min(Wc.value / spanW, Hc.value / spanH);
        return lr.value * scale;
      });
      // WIN-155: freeze remapped geometry for exiting circles so the fade
      // plays in place instead of ghosting through the drill viewport tween.
      let frozenGeom: { cx: number; cy: number; r: number } | null = null;
      const cx = derive(() => {
        if (windowMembership.value.has(node)) { frozenGeom = null; return cxRaw.value; }
        if (!frozenGeom) frozenGeom = { cx: cxRaw.peek(), cy: cyRaw.peek(), r: rRaw.peek() };
        return frozenGeom.cx;
      });
      const cy = derive(() => (frozenGeom ? frozenGeom.cy : cyRaw.value));
      const r = derive(() => (frozenGeom ? frozenGeom.r : rRaw.value));
      const stroke = derive(() =>
        state.focused.value === node ? "#fff"
        : hoverCell.value === node ? "#c8cdd6"
        : nd === 0 ? "#444" : "#0b0d12",
      );
      const strokeWidth = derive(() => (state.focused.value === node || hoverCell.value === node ? 2 : 1));

      const isContextNode = derive(() => nd > 0 && node.value.id === this._drillIdCell.value);
      const nodeFill = depthFill(node.value.color, nd);
      const disc = circle(Vec.derive(() => ({ x: cx.value, y: cy.value })), r, {
        fill: nd === 0 ? node.value.color : nodeFill.toString(),
        stroke,
        strokeWidth,
      });
      disc.el.dataset.id = node.value.id ?? "";
      // WIN-155: compose lifecycle (enter/exit) with context-dim opacity in a
      // single effect. Start at 0 pre-frame, then RAF to composed opacity so
      // the enter fade plays over the CSS transition.
      const discPresent = derive(() => windowMembership.value.has(node));
      disc.el.style.transition = `opacity ${ENTER_MS}ms cubic-bezier(0.4,0,0.2,1)`;
      disc.el.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        biEffect(() => {
          const present = discPresent.value;
          const dim = (nd === 0 || isContextNode.value) ? 0.18 : 1;
          disc.el.style.opacity = present ? String(dim) : '0';
        });
      }));
      disc.el.style.cursor = "pointer";
      // No CSS transition on cx/cy/r — the viewport tween (vx0..vy1) drives
      // these via derive(), and a CSS transition would double-animate, chasing
      // the tween and causing overlapping circles on zoom-out.
      disc.el.setAttribute('tabindex', '0');
      disc.el.setAttribute('data-focusable', 'circle');
      biEffect(() => {
        disc.el.setAttribute('aria-label', `${node.value.label}: ${node.value.total.value.toFixed(0)}`);
      });
      disc.el.addEventListener("click", () => { state.focused.value = node; });
      disc.el.addEventListener("focus", () => { state.focused.value = node; });
      disc.el.addEventListener("blur", () => { if (state.focused.value === node) state.focused.value = null; });
      disc.el.addEventListener("dblclick", (e: MouseEvent) => {
        const fd = focusDepth.value;
        if (fd > 0 && node.value.id === this._drillIdCell.value) {
          e.stopPropagation();
          const parent = parentOf(node);
          const targetId = (parent && (nodeDepth.get(parent) ?? 0) > 0)
            ? (parent.value.id ?? null)
            : null;
          // Drill directly — don't wait for a round-trip.
          this.drillNodeId = targetId;
          const drillKey = (this as any).drillKey ?? "default";
          (this as ElementWithBridge).brSync?.emitDrill?.(drillKey, targetId);
        }
      });
      disc.el.addEventListener("pointerenter", () => { state.hovered.current = node; hoverCell.value = node; state.emitHover?.(node); });
      disc.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) { state.hovered.current = null; hoverCell.value = null; state.emitHover?.(null); } });

      if (isLeaf) {
        const text = derive(() => {
          if (r.value <= 14) return "";
          return `${node.value.label}\n${node.value.total.value.toFixed(0)}`;
        });
        const lbl = label(Vec.derive(() => ({ x: cx.value, y: cy.value })), text, {
          size: 10, align: Anchor.Center, fill: labelInk(nodeFill),
        });
        return [disc, lbl];
      }
      return disc;
    }, { key: (n) => n.value.id ?? "" });

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
