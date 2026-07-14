import {
  Anchor,
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
import { DataViewController } from "../lib/data-view-controller";
import { createDataViewCell, type DataViewCellHandle } from "../lib/data-view-adapter";
import { withAnimSettle } from "../lib/with-settle";
import { attachReorderGesture } from "../lib/reorder-gesture";
import { GESTURE_SUPPRESSION_CSS, GESTURE_ACTIVE_CLASS, settleTransition, REORDER_ELEVATION_CSS } from "../lib/transitions";
import { withExitDelay, membershipCell } from "../lib/mark-lifecycle";
import type { ElementWithBridge } from "../lib/hud-bridge";

const W = 720;
const H = 360;
const DRILL_DURATION = 800; // ms — leave-timer / CSS settle window
const DRILL_SEC = DRILL_DURATION / 1000; // s — bireactive anim clock runs in seconds
const SORT_SEC = 0.35; // s — sort/reorder tween duration

export class MdIcicleLC extends Diagram {
  static styles = `
    text { pointer-events: none; }
    ${FILL_STYLE}
    ${GESTURE_SUPPRESSION_CSS}
    ${REORDER_ELEVATION_CSS}
    [data-focusable]:focus {
      outline: 2px solid #4a9eff;
      outline-offset: 2px;
    }
    [data-focusable]:focus:not(:focus-visible) {
      outline: none;
    }
  `
  drillKey?: string
  showBreadcrumb?: boolean

  // ── Constructor-scope state: every cell a host can set lives at element
  // lifetime, NOT scene lifetime. scene() is a pure projection of these, so
  // it can be set before or after mount, and disconnect/reconnect (dock moves,
  // tab reparents) rebuilds the identical chart with nothing lost.
  private _dataCell = cell<BiNode | null>(null)
  /** The reactive data tree. Settable at any time — before or after mount. */
  get data(): BiNode | null { return this._dataCell.value }
  set data(root: BiNode | null) { this._dataCell.value = root }
  /** @deprecated alias for `data` (legacy wiring name). */
  get externalRoot(): BiNode | undefined { return this._dataCell.value ?? undefined }
  set externalRoot(root: BiNode | undefined) { this._dataCell.value = root ?? null }

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

  private _orientationCell = cell<'horizontal' | 'vertical'>('horizontal')
  /** Icicle orientation. "horizontal" (default) stacks depth levels along the
   *  x-axis with siblings split vertically — a classic partition chart. "vertical"
   *  stacks depth along y with siblings split horizontally (the original icicle). */
  get orientation(): 'horizontal' | 'vertical' { return this._orientationCell.value }
  set orientation(v: 'horizontal' | 'vertical') { this._orientationCell.value = v }

  private _canReorderCell = cell<boolean>(false)
  /** Whether drag-to-reorder is enabled (only meaningful when sorted by index). */
  get canReorder(): boolean { return this._canReorderCell.value }
  set canReorder(v: boolean) { this._canReorderCell.value = v }

  /** Fired on a committed reorder. Chart only previews; owner mutates data. */
  onReorder?: (parentId: string | null, orderedIds: string[]) => void

  private _reorderTickCell = cell(0)

  dataView!: DataViewController;
  #dvCell?: DataViewCellHandle;

  connectedCallback(): void {
    this.dataView = new DataViewController();
    this.#dvCell = createDataViewCell(this.dataView);
    super.connectedCallback();
  }

  // Effects created in scene() must die with the scene: Diagram re-runs
  // scene() per connect, and without this the old scene's effects would pile
  // up across dock moves / tab reparents.
  private _sceneDisposers: Array<() => void> = []
  private _trackScene(d: () => void): void { this._sceneDisposers.push(d) }
  private _disposeScene(): void {
    for (const d of this._sceneDisposers.splice(0)) d()
  }
  disconnectedCallback(): void {
    this._disposeScene()
    super.disconnectedCallback()
    this.#dvCell?.dispose();
    this.#dvCell = undefined;
    this.dataView?.dispose();
  }

  protected scene(s: Mount): void {
    this._disposeScene() // reconnect: drop the previous scene's effects first
    const { w: Wc, h: Hc } = useHostSize(this, { width: W, height: H });
    const view = this.view(Wc, Hc);
    this.tabIndex = -1;
    this.style.outline = "none";

    const svgEl = (this as any).svg as SVGSVGElement;
    const localPoint = (e: PointerEvent) => {
      const r = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox?.baseVal;
      const sx = vb && vb.width ? vb.width / r.width : 1;
      const sy = vb && vb.height ? vb.height / r.height : 1;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    };
    const pointerToSibRaw = (e: PointerEvent): number => {
      const p = localPoint(e);
      const h = isHoriz.peek();
      const canvas = h ? p.y : p.x;
      const size = h ? Hc.peek() : Wc.peek();
      const v0 = vy0.peek();
      const v1 = vy1.peek();
      if (size === 0 || v1 === v0) return v0;
      return v0 + (canvas / size) * (v1 - v0);
    };

    const isHoriz = derive(() => this._orientationCell.value === 'horizontal');

    // Reactive root: scene is a pure projection of the data cell. A demo
    // fallback fills in when un-wired (kept for the spike apps; slated for
    // removal per the rebuild design's empty-is-empty rule).
    let fallbackRoot: BiNode | null = null;
    const rootCell = derive(() => this._dataCell.value ?? (fallbackRoot ??= portfolio()));

    // Structure maps derive from the root — a data swap rebuilds them and
    // everything downstream reacts; nothing is snapshotted at scene time.
    const structure = derive(() => {
      const root = rootCell.value;
      const nodeById = new Map<string, BiNode>();
      const nodeDepth = new Map<BiNode, number>();
      let totalDepth = 0;
      for (const { node, depth } of walkWithDepth(root)) {
        if (node.value.id) nodeById.set(node.value.id, node);
        nodeDepth.set(node, depth);
        if (depth > totalDepth) totalDepth = depth;
      }
      return { root, nodeById, nodeDepth, totalDepth, parentIdx: buildParentIndex(root) };
    });
    const parentOf = (n: BiNode) => structure.value.parentIdx.get(n);

    const state: SelectionState = {
      focused: cell<BiNode | null>(null),
      hovered: { current: null },
      wheelLocked: { current: null },
    };
    // Gestures bind to a concrete root, so re-attach when the data swaps.
    let gestureDispose: (() => void) | null = null;
    this._trackScene(biEffect(() => {
      const root = rootCell.value;
      gestureDispose?.();
      gestureDispose = attachChartGestures(this, { root, parentOf, state, scalingMode: "proportional-neighbor", dataView: this.dataView });
    }));
    this._trackScene(() => { gestureDispose?.(); gestureDispose = null; });
    const hoverCell = cell<BiNode | null>(null);
    state.hoverCell = hoverCell;

    // Partition layout — orientation-aware. The depth axis is scaled so one
    // extra row sits above the viewport, then coords are shifted so depth-1
    // tiles start at 0. For horizontal, partition's x (sibling) → canvas y and
    // partition's y (depth) → canvas x; for vertical, no swap needed.
    const layout = derive(() => {
      // Re-run when a user-driven reorder mutates the children arrays.
      void this._reorderTickCell.value;
      const rawMaxD = this._maxDepthCell.value;
      const maxD = rawMaxD !== undefined && rawMaxD > 0 ? rawMaxD : undefined;
      const h = buildHierarchy(rootCell.value, this._sortByCell.value);
      const td = h.height; // levels below root
      const visibleDepth = maxD !== undefined ? Math.min(maxD, td) : td;
      const sibAxis = isHoriz.value ? Hc.value : Wc.value;
      const depthCanvas = isHoriz.value ? Wc.value : Hc.value;
      const scaledDepth = visibleDepth > 0 ? depthCanvas * (td + 1) / visibleDepth : depthCanvas;
      partition<BiNode>().size([sibAxis, scaledDepth])(h);
      const rowDepth = visibleDepth > 0 ? depthCanvas / visibleDepth : 0;
      const map = new Map<BiNode, HierarchyRectangularNode<BiNode>>();
      h.each((d) => {
        const node = d as HierarchyRectangularNode<BiNode>;
        if (isHoriz.value) {
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

    // Hoisted per-tile cells so the reorder gesture can rewrite siblings'
    // sibling-axis positions imperatively during preview.
    interface TileCells {
      lx0: ReturnType<typeof num>;
      ly0: ReturnType<typeof num>;
      lx1: ReturnType<typeof num>;
      ly1: ReturnType<typeof num>;
      tileEl: SVGRectElement;
    }
    const tileCellsByNode = new Map<BiNode, TileCells>();

    // Viewport cells: map layout-space → canvas. vx = depth axis, vy = sibling
    // axis. For horizontal, depth axis = canvas x, sibling axis = canvas y;
    // for vertical, depth axis = canvas y, sibling axis = canvas x.
    const vx0 = num(0);
    const vy0 = num(0);
    const vx1 = num(isHoriz.value ? W : H);
    const vy1 = num(isHoriz.value ? H : W);

    // Focus depth (reactive).
    const focusDepth = derive(() => {
      const id = this._drillIdCell.value;
      if (!id) return 0;
      const { nodeById, nodeDepth } = structure.value;
      const n = nodeById.get(id);
      return n ? (nodeDepth.get(n) ?? 0) : 0;
    });

    // Window: at root show all nodes depth 1+; when drilled show focus node +
    // subtree. Always include ancestors of the focus node so their tiles remain
    // in renderedSet and geometry stays available for Esc-out tweens.
    const windowTarget = derive((): readonly BiNode[] => {
      const fd = focusDepth.value;
      const id = this._drillIdCell.value;
      const { root, nodeById, totalDepth } = structure.value;
      const rawMaxD = this._maxDepthCell.value;
      const maxD = rawMaxD !== undefined && rawMaxD > 0 ? rawMaxD : undefined;
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

    // Rendered set (WIN-155): current window + departing nodes held briefly so
    // the exit CSS fade can play — including on drill. Exiting tiles freeze
    // their tween cells so they don't ghost through the viewport tween.
    const renderedSet = withExitDelay(windowTarget, {
      key: (n) => n,
    });
    const windowMembership = membershipCell(windowTarget, (n) => n);

    // Drill viewport tween: compute target viewport from focus node bounds and
    // tween all 4 cells. Uses untracked for layout reads so value changes don't
    // re-run this effect (only drill-id and resize do).
    let drillInited = false;
    let lastDrillId: string | null = null;
    let drillCancel: (() => void) | null = null;
    let drillClassTimer: ReturnType<typeof setTimeout> | null = null;
    this._trackScene(() => {
      if (drillClassTimer) { clearTimeout(drillClassTimer); drillClassTimer = null; }
      drillCancel?.(); drillCancel = null;
    });
    this._trackScene(biEffect(() => {
      const id = this._drillIdCell.value;
      void Wc.value; void Hc.value; // track resize
      void isHoriz.value; // track orientation
      const { nodeById, nodeDepth, totalDepth } = structure.value; // track data swap
      const rawMaxD = this._maxDepthCell.value;
      const maxD = rawMaxD !== undefined && rawMaxD > 0 ? rawMaxD : undefined;
      const W0 = Wc.value, H0 = Hc.value;
      const depthCanvas = isHoriz.value ? W0 : H0;
      const sibCanvas = isHoriz.value ? H0 : W0;

      let tx0 = 0, ty0 = 0, tx1 = depthCanvas, ty1 = sibCanvas;
      const lmap = untracked(() => layout.value);
      if (id) {
        const biNode = nodeById.get(id);
        const lnode = biNode ? lmap.get(biNode) : null;
        if (lnode) {
          const fd = nodeDepth.get(biNode!) ?? 0;
          const maxWindow = maxD !== undefined ? fd + maxD : totalDepth;
          // Depth axis: from focus node's depth row to deepest descendant.
          // Horizontal: depth is layout x; vertical: depth is layout y.
          const d0 = isHoriz.value ? lnode.x0 : lnode.y0;
          const d1 = isHoriz.value ? lnode.x1 : lnode.y1;
          let maxD1 = d1;
          for (const { node, depth: relDepth } of walkWithDepth(biNode!)) {
            const absDepth = fd + relDepth;
            if (absDepth <= maxWindow) {
              const ln = lmap.get(node);
              if (ln) {
                const nd1 = isHoriz.value ? ln.x1 : ln.y1;
                if (nd1 > maxD1) maxD1 = nd1;
              }
            }
          }
          tx0 = d0; tx1 = maxD1;
          ty0 = isHoriz.value ? lnode.y0 : lnode.x0;
          ty1 = isHoriz.value ? lnode.y1 : lnode.x1;
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
    }));

    // Remap layout-space coords through viewport cells → canvas coords.
    // vx = depth axis, vy = sibling axis.
    const remapX = (raw: number) => {
      const v0 = isHoriz.value ? vx0.value : vy0.value;
      const v1 = isHoriz.value ? vx1.value : vy1.value;
      const span = v1 - v0;
      return span === 0 ? 0 : (raw - v0) / span * Wc.value;
    };
    const remapY = (raw: number) => {
      const v0 = isHoriz.value ? vy0.value : vx0.value;
      const v1 = isHoriz.value ? vy1.value : vx1.value;
      const span = v1 - v0;
      return span === 0 ? 0 : (raw - v0) / span * Hc.value;
    };

    // Windowed tile rendering via forEach (keyed by node id).
    const tileLayer = s(group());
    forEach(tileLayer, renderedSet, (node) => {
      // peek: a data swap creates new nodes → new tiles, so depth is stable
      // for this tile's lifetime.
      const depth = untracked(() => structure.value.nodeDepth.get(node)) ?? 0;
      const isLeaf = (node.children as BiNode[]).length === 0;

      // Per-tile raw layout-position cells. Tweened on sort change so tiles
      // slide to their new partition positions; snapped on value/resize changes
      // so drag editing stays real-time. x/y/w/h below derive from these tweened
      // cells + the viewport remap, so drill (viewport tween) and sort (layout
      // tween) compose without conflict.
      const lseed = untracked(() => layout.value.get(node)) ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
      const lx0 = num(lseed.x0), ly0 = num(lseed.y0), lx1 = num(lseed.x1), ly1 = num(lseed.y1);
      const ltarget = derive(() => {
        const ln = layout.value.get(node);
        return ln ? { x0: ln.x0, y0: ln.y0, x1: ln.x1, y1: ln.y1 } : { x0: 0, y0: 0, x1: 0, y1: 0 };
      });
      let lcancel: (() => void) | null = null;
      let lInited = false;
      let seenSortBy = untracked(() => this._sortByCell.value);
      let seenMeasureKey = untracked(() => this._measureKeyCell.value);
      let seenOrientation = untracked(() => this._orientationCell.value);
      let seenMaxDepth = untracked(() => this._maxDepthCell.value);
      let seenReorderTick = untracked(() => this._reorderTickCell.value);
      biEffect(() => {
        const t = ltarget.value; // track layout (reacts to sort + value + size + orientation + depth + reorder)
        const sortBy = this._sortByCell.value; // track sort key so a toggle re-fires this effect
        const measureKey = untracked(() => this._measureKeyCell.value); // read untracked — effect fires on layout change (leaf writes), by which point measureKey is already set
        const orientation = untracked(() => this._orientationCell.value); // read untracked — same reason
        const maxDepth = this._maxDepthCell.value; // WIN-155: track so a levels dropdown change tweens the surviving tiles into the reclaimed space instead of snapping.
        const reorderTick = this._reorderTickCell.value; // WIN-262: a user-driven reorder commits new children order.
        if (!lInited) { lInited = true; seenSortBy = sortBy; seenMeasureKey = measureKey; seenOrientation = orientation; seenMaxDepth = maxDepth; seenReorderTick = reorderTick; lx0.value = t.x0; ly0.value = t.y0; lx1.value = t.x1; ly1.value = t.y1; return; }
        // Two-lane split. TWEEN for a real reorder (sort key toggled), measure
        // swap, orientation toggle, depth change, or committed drag reorder —
        // partitions slide to new slots/axes/extents. SNAP for everything else:
        // active gesture (real-time drag), and — crucially — value edits /
        // commits / resize, including REMOTE cross-tile edits that carry no
        // gesture class (R2: value changes are write-through, no 250-350ms
        // settle-lag).
        const reordered = sortBy !== seenSortBy;
        const measureSwapped = measureKey !== seenMeasureKey;
        const orientationChanged = orientation !== seenOrientation;
        const depthChanged = maxDepth !== seenMaxDepth;
        const reorderCommitted = reorderTick !== seenReorderTick;
        seenSortBy = sortBy;
        seenMeasureKey = measureKey;
        seenOrientation = orientation;
        seenMaxDepth = maxDepth;
        seenReorderTick = reorderTick;
        if ((reordered || measureSwapped || orientationChanged || depthChanged || reorderCommitted) && this.dataView.getState().key !== 'Gesturing') {
          lcancel?.();
          lcancel = this.anim.start(
            tween(lx0, t.x0, SORT_SEC, easeOut),
            tween(ly0, t.y0, SORT_SEC, easeOut),
            tween(lx1, t.x1, SORT_SEC, easeOut),
            tween(ly1, t.y1, SORT_SEC, easeOut),
          );
        } else {
          lcancel?.(); lcancel = null;
          lx0.value = t.x0; ly0.value = t.y0; lx1.value = t.x1; ly1.value = t.y1;
        }
      });

      // WIN-155: freeze remapped geometry for exiting tiles so the fade plays
      // in place instead of ghosting through the drill viewport tween.
      let frozenGeom: { x: number; y: number; w: number; h: number } | null = null;
      const xRaw = derive(() => remapX(lx0.value));
      const yRaw = derive(() => remapY(ly0.value));
      const wRaw = derive(() => Math.max(0, remapX(lx1.value) - remapX(lx0.value)));
      const hRaw = derive(() => Math.max(0, remapY(ly1.value) - remapY(ly0.value)));
      const x = derive(() => {
        if (windowMembership.value.has(node)) { frozenGeom = null; return xRaw.value; }
        if (!frozenGeom) frozenGeom = { x: xRaw.peek(), y: yRaw.peek(), w: wRaw.peek(), h: hRaw.peek() };
        return frozenGeom.x;
      });
      const y = derive(() => (frozenGeom ? frozenGeom.y : yRaw.value));
      const w = derive(() => (frozenGeom ? frozenGeom.w : wRaw.value));
      const h = derive(() => (frozenGeom ? frozenGeom.h : hRaw.value));

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

      // Wrap tile + label in a per-row group so drag elevation raises both.
      const rowGroup = group();
      rowGroup.add(tile);
      tileCellsByNode.set(node, { lx0, ly0, lx1, ly1, tileEl: tile.el as SVGRectElement });

      // WIN-155: compose lifecycle (enter/exit) with context dim in a single
      // opacity effect so the two don't fight. Start at 0, RAF to lifecycle
      // opacity for the enter fade.
      const tilePresent = derive(() => windowMembership.value.has(node));
      tile.el.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        biEffect(() => {
          const present = tilePresent.value;
          const dim = isContextNode.value ? 0.35 : 1;
          tile.el.style.opacity = present ? String(dim) : '0';
        });
      }));
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
          const targetId = (parent && (structure.value.nodeDepth.get(parent) ?? 0) > 0)
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
      rowGroup.add(lbl);

      // ─── Drag-to-reorder (WIN-262) ────────────────────────────────────
      // Reorder scoped to the dragged tile's parent. Root children reorder at
      // depth 1; leaves reorder within their parent's children.
      let reorderDetach: (() => void) | null = null;
      biEffect(() => {
        const enabled = this._canReorderCell.value;
        reorderDetach?.();
        reorderDetach = null;
        if (!enabled) { tile.el.style.cursor = 'pointer'; return; }
        const parent = parentOf(node);
        if (!parent) { tile.el.style.cursor = 'pointer'; return; }
        const siblings = (parent.children as readonly BiNode[]);
        if (siblings.length < 2) { tile.el.style.cursor = 'pointer'; return; }
        tile.el.style.cursor = 'grab';

        const REORDER_SEC = 0.1;
        let startPointerSib = Number.NaN;
        let startSibMid = 0;
        let dragSpan = 0;
        const initialMids = new Map<string, number>();
        const siblingTweenCancels = new Map<string, () => void>();
        const lastAppliedIdx = new Map<string, number>();
        let parentSibStart = 0;
        let parentSibEnd = 0;
        const siblingById = new Map<string, BiNode>();

        const computeSlots = (order: readonly string[]): Map<string, { sib0: number; sib1: number }> => {
          const lmap = layout.peek();
          const totalVal = order.reduce((s, id) => {
            const c = siblingById.get(id);
            const ln = c ? lmap.get(c) : undefined;
            return s + (ln?.value ?? 0);
          }, 0) || 1;
          const map = new Map<string, { sib0: number; sib1: number }>();
          let cursor = parentSibStart;
          for (const id of order) {
            const c = siblingById.get(id);
            const ln = c ? lmap.get(c) : undefined;
            const v = ln?.value ?? 0;
            const span = (v / totalVal) * (parentSibEnd - parentSibStart);
            map.set(id, { sib0: cursor, sib1: cursor + span });
            cursor += span;
          }
          return map;
        };

        const getSibCells = (cells: TileCells) => {
          const h = isHoriz.peek();
          return {
            sib0: h ? cells.ly0 : cells.lx0,
            sib1: h ? cells.ly1 : cells.lx1,
          };
        };

        const detach = attachReorderGesture({
          hitEl: tile.el,
          // Raise the whole row group (tile + label) so the label is not occluded.
          dragEl: tile.el.parentElement as unknown as SVGGElement,
          itemId: node.value.id ?? '',
          dataView: this.dataView,
          intent: 'reorder' as const,
          origin: this,
          getInitialOrder: () => siblings.map(c => c.value.id ?? ''),
          computeTargetIndex: (e, order) => {
            if (Number.isNaN(startPointerSib)) return order.indexOf(node.value.id ?? '');
            const raw = pointerToSibRaw(e);
            const delta = raw - startPointerSib;
            const ghostMid = startSibMid + delta;
            const scored = order.map(id => ({
              id,
              mid: id === node.value.id ? ghostMid : (initialMids.get(id) ?? 0),
            }));
            scored.sort((a, b) => a.mid - b.mid);
            return scored.findIndex(s => s.id === node.value.id);
          },
          onActivate: () => {
            const lmap = layout.peek();
            const h = isHoriz.peek();
            const pln = lmap.get(parent);
            parentSibStart = h ? (pln?.y0 ?? 0) : (pln?.x0 ?? 0);
            parentSibEnd = h ? (pln?.y1 ?? 0) : (pln?.x1 ?? 0);
            initialMids.clear();
            siblingById.clear();
            for (const c of siblings) {
              if (c.value.id) siblingById.set(c.value.id, c);
              const ln = lmap.get(c);
              if (!ln || !c.value.id) continue;
              const mid = h ? (ln.y0 + ln.y1) / 2 : (ln.x0 + ln.x1) / 2;
              initialMids.set(c.value.id, mid);
            }
            const me = lmap.get(node);
            if (me) {
              startSibMid = h ? (me.y0 + me.y1) / 2 : (me.x0 + me.x1) / 2;
              dragSpan = h ? (me.y1 - me.y0) : (me.x1 - me.x0);
            }
            startPointerSib = Number.NaN;
            siblingTweenCancels.forEach(fn => fn());
            siblingTweenCancels.clear();
            lastAppliedIdx.clear();
            siblings.forEach((c, i) => { if (c.value.id) lastAppliedIdx.set(c.value.id, i); });
          },
          onPreview: (order, e) => {
            if (Number.isNaN(startPointerSib)) startPointerSib = pointerToSibRaw(e);
            const slots = computeSlots(order);
            for (let i = 0; i < order.length; i++) {
              const id = order[i]!;
              if (id === node.value.id) continue;
              if (lastAppliedIdx.get(id) === i) continue;
              lastAppliedIdx.set(id, i);
              const c = siblingById.get(id);
              if (!c) continue;
              const cells = tileCellsByNode.get(c);
              const slot = slots.get(id);
              if (!cells || !slot) continue;
              siblingTweenCancels.get(id)?.();
              const { sib0, sib1 } = getSibCells(cells);
              const cancelA = this.anim.start(tween(sib0, slot.sib0, REORDER_SEC, easeOut) as any);
              const cancelB = this.anim.start(tween(sib1, slot.sib1, REORDER_SEC, easeOut) as any);
              const cancel = () => { cancelA?.(); cancelB?.(); };
              siblingTweenCancels.set(id, cancel);
            }
            const raw = pointerToSibRaw(e);
            const delta = raw - startPointerSib;
            const ghostMid = startSibMid + delta;
            const meCells = tileCellsByNode.get(node);
            if (meCells) {
              const { sib0, sib1 } = getSibCells(meCells);
              sib0.value = ghostMid - dragSpan / 2;
              sib1.value = ghostMid + dragSpan / 2;
            }
          },
          onEnd: (finalOrder, canceled) => {
            siblingTweenCancels.forEach(fn => fn());
            siblingTweenCancels.clear();

            const initial = siblings.map(c => c.value.id ?? '');
            const changed = !canceled && finalOrder.some((id, i) => id !== initial[i]);
            if (changed) {
              const byId = new Map(siblings.map(c => [c.value.id ?? '', c]));
              const next = finalOrder.map(id => byId.get(id)).filter(Boolean) as BiNode[];
              if (next.length === siblings.length) {
                (parent.children as BiNode[]).splice(0, siblings.length, ...next);
                this._reorderTickCell.value = this._reorderTickCell.value + 1;
                this.onReorder?.(parent.value.id ?? null, finalOrder.slice());
              }
              // The view slides to the new order; settle when the animation finishes.
              withAnimSettle(this.anim, this.dataView, tween(num(0), 1, SORT_SEC, easeOut) as any);
              return;
            }
            // Cancel / no-op: tween each sibling back to its layout slot.
            const lmap = layout.peek();
            const h = isHoriz.peek();
            const tweens: any[] = [];
            for (const c of siblings) {
              const cells = tileCellsByNode.get(c);
              const ln = lmap.get(c);
              if (!cells || !ln) continue;
              const { sib0, sib1 } = getSibCells(cells);
              const sib0Target = h ? ln.y0 : ln.x0;
              const sib1Target = h ? ln.y1 : ln.x1;
              tweens.push(tween(sib0, sib0Target, SORT_SEC, easeOut) as any);
              tweens.push(tween(sib1, sib1Target, SORT_SEC, easeOut) as any);
            }
            if (tweens.length) withAnimSettle(this.anim, this.dataView, ...tweens);
            else this.dataView.settle();
          },
        });
        reorderDetach = detach;
      });

      return rowGroup;
    }, { key: (n) => n.value.id ?? "" });

    // Boundary-knob resize handles: for each parent with >=2 children, drop a
    // draggable pill on each interior sibling boundary. The two adjacent
    // siblings a,b share a contiguous span along the sibling axis; the boundary
    // sits where their widths split proportional to value. Dragging
    // reapportions a.total/b.total (sum preserved by the group's Num.lens) and
    // the partition layout re-derives reactively. Skip the synthetic root row
    // (depth 0). Orientation picks which canvas axis the boundary runs along.
    if (!this.hasAttribute("no-handles")) {
      type HandleItem = { aNode: BiNode; bNode: BiNode };
      const handleWindow = derive((): readonly HandleItem[] => {
        const fd = focusDepth.value;
        const { nodeDepth, totalDepth } = structure.value;
        const rawMaxD = this._maxDepthCell.value;
        const maxD = rawMaxD !== undefined && rawMaxD > 0 ? rawMaxD : undefined;
        const maxWindow = maxD !== undefined ? fd + maxD : totalDepth;

        // Group nodes by depth level
        const byDepth = new Map<number, BiNode[]>();
        for (const n of renderedSet.value) {
          const d = nodeDepth.get(n) ?? 0;
          if (d <= fd || d > maxWindow) continue;
          if (!byDepth.has(d)) byDepth.set(d, []);
          byDepth.get(d)!.push(n);
        }

        // For each depth level, sort nodes by sibling axis position and create handles
        const items: HandleItem[] = [];
        const lmap = layout.value;
        const h = isHoriz.value;

        for (const nodes of byDepth.values()) {
          // Sort by position along sibling axis
          nodes.sort((a, b) => {
            const aLayout = lmap.get(a);
            const bLayout = lmap.get(b);
            if (!aLayout || !bLayout) return 0;
            const aPos = h ? aLayout.y0 : aLayout.x0;
            const bPos = h ? bLayout.y0 : bLayout.x0;
            return aPos - bPos;
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
        // Live span geometry along the SIBLING axis: [spanA0, spanA1] covers
        // both siblings. The depth-axis band [rowA0, rowA1] comes from either
        // child's depth row. For vertical, sibling axis = x, depth axis = y;
        // for horizontal, sibling axis = y, depth axis = x.
        const spanA0 = derive(() => isHoriz.value ? (layout.value.get(aNode)?.y0 ?? 0) : (layout.value.get(aNode)?.x0 ?? 0));
        const spanA1 = derive(() => isHoriz.value ? (layout.value.get(bNode)?.y1 ?? 0) : (layout.value.get(bNode)?.x1 ?? 0));
        const rowA0 = derive(() => isHoriz.value ? (layout.value.get(aNode)?.x0 ?? 0) : (layout.value.get(aNode)?.y0 ?? 0));
        const rowA1 = derive(() => isHoriz.value ? (layout.value.get(aNode)?.x1 ?? 0) : (layout.value.get(aNode)?.y1 ?? 0));

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
            const h = isHoriz.peek();
            const lx = h ? across : along;
            const ly = h ? along : across;
            return { x: remapX(lx), y: remapY(ly) };
          },
          (target, vals) => {
            const [va, vb] = vals;
            const s0 = spanA0.peek();
            const s1 = spanA1.peek();
            const sum = va + vb;
            if (sum === 0 || s1 <= s0) return [va, vb];
            const h = isHoriz.peek();
            // Convert layout-space span to canvas space to match drag target.
            const cs0 = h ? remapY(s0) : remapX(s0);
            const cs1 = h ? remapY(s1) : remapX(s1);
            if (cs1 <= cs0) return [va, vb];
            const t = h ? target.y : target.x;
            let frac = (t - cs0) / (cs1 - cs0);
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
          const h = isHoriz.value;
          const lx = h ? across : along;
          const ly = h ? along : across;
          return { x: remapX(lx), y: remapY(ly) };
        });
        const active = cell(false);
        const orient = derive(() => isHoriz.value ? "horiz" : "vert");
        const handle = lineHandle(knobPos, orient, {
          kind: "divider",
          active,
        });
        const dispose = dragCancelable(handle, knob, [a, b], {
          dataView: this.dataView,
          intent: 'edit',
          origin: this,
          onStart: () => { active.value = true; handle.el.style.cursor = "grabbing"; },
          onEnd: () => { active.value = false; handle.el.style.cursor = "grab"; this.dataView.settle(); },
        });
        handle.track(dispose);
        biEffect(() => { handle.el.style.cursor = isHoriz.value ? "ns-resize" : "ew-resize"; });
        handle.el.addEventListener("pointerenter", () => { active.value = true; });
        handle.el.addEventListener("pointerleave", () => { active.value = false; });

        return handle;
      }, { key: ({ aNode, bNode }) => `${aNode.value.id ?? ""}:${bNode.value.id ?? ""}` });
    }

    if (!this.hasAttribute('no-source')) s(label(view.bottom.up(10), derive(() => {
      const f = state.focused.value;
      return `total: ${rootCell.value.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));

    if (this.showBreadcrumb !== false && this.chromeLayer) {
      mountDrillBreadcrumb({
        drillIdCell: this._drillIdCell,
        root: rootCell.value,
        chromeLayer: this.chromeLayer,
        onDrill: (id) => {
          this.drillNodeId = id;
          const drillKey = this.drillKey ?? 'default';
          (this as ElementWithBridge).brSync?.emitDrill?.(drillKey, id);
        },
      });
    }
  }
}
