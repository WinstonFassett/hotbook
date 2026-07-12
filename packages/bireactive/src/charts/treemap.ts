import {
  Anchor,
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
  type AnyShape,
} from "bireactive";
import { Diagram } from "../lib/diagram";
import type { ElementWithBridge } from "../lib/hud-bridge";
import { treemap, treemapSquarify, type HierarchyRectangularNode } from "d3-hierarchy";
import { depthFill, labelInk } from "../lib/depth-color";
import { buildHierarchy, globalGestureActive } from "../lib/interaction";
import { buildParentIndex, type BiNode, portfolio, walkWithDepth } from "../lib/tree";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import { mountDrillBreadcrumb } from "../lib/drill-breadcrumb";
import { GESTURE_SUPPRESSION_CSS, GESTURE_ACTIVE_CLASS, GESTURE_ACTIVE_GLOBAL_CLASS, ENTER_MS } from "../lib/transitions";
import { withExitDelay, membershipCell } from "../lib/mark-lifecycle";
import { numberDrag } from "../lib/number-drag";

const W = 720;
const H = 360;
const PAD_OUTER = 4;
const PAD_INNER = 2;
const PAD_TOP = 16;
const DRILL_DURATION = 800; // ms — leave-timer / CSS settle window
const DRILL_SEC = DRILL_DURATION / 1000; // s — bireactive anim clock runs in seconds

export class MdTreemapLC extends Diagram {
  static styles = `
    text { pointer-events: none; }
    ${FILL_STYLE}
    ${GESTURE_SUPPRESSION_CSS}
    :host { display: flex; flex-direction: column; }
    .chrome-layer { flex: 0 0 auto; }
    svg { height: auto; flex: 1 1 auto; }
    [data-focusable]:focus {
      outline: 2px solid #4a9eff;
      outline-offset: 2px;
    }
    [data-focusable]:focus:not(:focus-visible) {
      outline: none;
    }
  `
  externalRoot?: BiNode
  drillKey?: string
  showBreadcrumb?: boolean

  private breadcrumbDisposer?: () => void

  disconnectedCallback(): void {
    this.breadcrumbDisposer?.();
    this.breadcrumbDisposer = undefined;
    super.disconnectedCallback();
  }

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

  protected scene(s: Mount): void {
    const { w: Wc, h: hostH } = useHostSize(this, { width: W, height: H });
    const chromeH = cell(0);
    const Hc = derive(() => Math.max(1, hostH.value - chromeH.value));
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

    // WIN-300: Watch global gesture state and apply GESTURE_ACTIVE_GLOBAL_CLASS
    // when table value drags or other cross-component gestures are active.
    // Uses separate class from local gestures to avoid conflicts.
    biEffect(() => {
      const active = globalGestureActive.value;
      this.classList.toggle(GESTURE_ACTIVE_GLOBAL_CLASS, active);
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

    // Re-layout from the drilled node so the focus subtree is computed at the
    // full canvas size. This keeps group headers (paddingTop) at fixed pixel
    // size instead of scaling them with the zoom factor.
    const drillLayout = derive(() => {
      const id = this._drillIdCell.value;
      const focusNode = id ? nodeById.get(id) : root;
      const effectiveRoot = focusNode ?? root;
      const h = buildHierarchy(effectiveRoot, this._sortByCell.value);
      treemap<BiNode>()
        .tile(treemapSquarify)
        .size([Wc.value, Hc.value])
        .paddingOuter(PAD_OUTER)
        .paddingInner(PAD_INNER)
        .paddingTop(PAD_TOP)
        .round(true)(h);
      const map = new Map<BiNode, HierarchyRectangularNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyRectangularNode<BiNode>));
      return map;
    });

    // ── Per-tile geometry model ────────────────────────────────────────
    // Treemap can't use the affine "viewport box" zoom that icicle/sunburst use:
    // a fixed-pixel group header cannot be expressed inside a single affine
    // scale (deep drill multiplies every nested header by the zoom factor → the
    // headers balloon, "layout doesn't match" + Esc-out strands the box).
    //
    // Instead each tile owns its own screen-space {x,y,w,h} `num` cells and we
    // TWEEN THOSE per-tile on drill (same `this.anim.start(tween(...))` primitive
    // icicle uses, applied to real tile rects). Group headers are fixed-pixel
    // labels pinned at the tile top, so they never scale with zoom. Per-tile
    // tweens are interrupt-safe by construction: re-drill cancels and re-targets
    // from each tile's CURRENT value, so Esc-out can never strand.

    // Focus = the drilled node (or root). Its layout-space box maps 1:1 onto the
    // canvas so the focus node's header (and title) is visible in the treemap area.
    const focusBoxOf = (id: string | null, lmap: Map<BiNode, HierarchyRectangularNode<BiNode>>) => {
      const W0 = Wc.value, H0 = Hc.value;
      if (id) {
        const biNode = nodeById.get(id);
        const lnode = biNode ? lmap.get(biNode) : null;
        if (lnode) return { fx0: lnode.x0, fy0: lnode.y0, fx1: lnode.x1, fy1: lnode.y1 };
      }
      return { fx0: 0, fy0: 0, fx1: W0, fy1: H0 };
    };

    // Target screen rect for `node` when focused on `id`. Pure affine off the
    // focus box — no PAD_TOP hack; group headers are fixed-pixel labels (below).
    const targetRect = (node: BiNode, id: string | null) => {
      const lmap = untracked(() => drillLayout.value);
      const { fx0, fy0, fx1, fy1 } = focusBoxOf(id, lmap);
      const sx = Wc.value / Math.max(1e-9, fx1 - fx0);
      const sy = Hc.value / Math.max(1e-9, fy1 - fy0);
      const ln = lmap.get(node);
      if (!ln) return { x: 0, y: 0, w: 0, h: 0 };
      return {
        x: (ln.x0 - fx0) * sx,
        y: (ln.y0 - fy0) * sy,
        w: Math.max(0, (ln.x1 - ln.x0) * sx),
        h: Math.max(0, (ln.y1 - ln.y0) * sy),
      };
    };

    // Live registry of each rendered tile's geometry cells, so the drill effect
    // can tween them. Populated in the forEach body, pruned on tile teardown.
    type TileGeo = { cx: ReturnType<typeof num>; cy: ReturnType<typeof num>; cw: ReturnType<typeof num>; ch: ReturnType<typeof num> };
    const tileGeo = new Map<BiNode, TileGeo>();
    // Live registry of each rendered tile shape (and its label, if any) so the
    // reorder effect can keep nodeLayer children in paint order.
    const tileMap = new Map<BiNode, { tile: AnyShape; label?: AnyShape }>();

    const maxDepthCell = this._maxDepthCell;

    // Drill effect: tween every live tile's geometry cells toward the new focus.
    let drillInited = false;
    let lastDrillId: string | null = null;
    let drillCancel: (() => void) | null = null;
    let drillClassTimer: ReturnType<typeof setTimeout> | null = null;
    let drillSnapTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingDrillId: string | null | undefined = undefined;
    let windowMembershipRef: { value: Set<unknown> } | null = null;
    const retargetTiles = (id: string | null, animate: boolean) => {
      drillCancel?.();
      drillCancel = null;
      if (drillSnapTimer) { clearTimeout(drillSnapTimer); drillSnapTimer = null; }
      const gens: ReturnType<typeof tween>[] = [];
      // WIN-155: only retarget tiles still in the drill window. Exiting tiles
      // are held by withExitDelay for their fade — leave their geometry frozen
      // at the last visible position so the fade plays in place. Guard against
      // TDZ on initial fire — windowMembership is declared below.
      const inWindow: Set<unknown> | null = windowMembershipRef
        ? untracked(() => windowMembershipRef!.value)
        : null;
      for (const [node, g] of tileGeo) {
        if (inWindow && !inWindow.has(node)) continue;
        const t = targetRect(node, id);
        if (animate) {
          gens.push(
            tween(g.cx, t.x, DRILL_SEC, easeOut),
            tween(g.cy, t.y, DRILL_SEC, easeOut),
            tween(g.cw, t.w, DRILL_SEC, easeOut),
            tween(g.ch, t.h, DRILL_SEC, easeOut),
          );
        } else {
          g.cx.value = t.x; g.cy.value = t.y; g.cw.value = t.w; g.ch.value = t.h;
        }
      }
      if (animate && gens.length) {
        drillCancel = this.anim.start(...gens);
        drillSnapTimer = setTimeout(() => {
          drillSnapTimer = null;
          drillCancel = null;
          // Snap to exact d3 layout — the tween may not land on exact
          // floating-point targets, and layout re-derives during the tween
          // were suppressed by the drillCancel guard.
          retargetTiles(id, false);
        }, DRILL_DURATION + 60);
      }
    };
    biEffect(() => {
      const id = this._drillIdCell.value;
      // Track size so a resize re-snaps geometry (handled by the per-tile derive
      // fallback below; here we only react to drill-id changes).
      void Wc.value; void Hc.value;
      const drillChanged = id !== lastDrillId;
      lastDrillId = id;
      if (!drillInited) { drillInited = true; retargetTiles(id, false); return; }
      if (!drillChanged) {
        // Resize-only: snap UNLESS a drill tween is in flight (the layout
        // re-derives during the tween, which re-triggers this biEffect with
        // the same drill id — we must not snap or it kills the animation).
        if (drillCancel) return;
        retargetTiles(id, false); return;
      }
      // Drill: animate — but if tileGeo is empty (forEach hasn't committed yet),
      // defer until tiles are populated.
      if (tileGeo.size === 0) { pendingDrillId = id; return; }
      retargetTiles(id, true); // drill: animate
      if (drillClassTimer) { clearTimeout(drillClassTimer); drillClassTimer = null; }
      this.classList.add(GESTURE_ACTIVE_CLASS);
      drillClassTimer = setTimeout(() => {
        drillClassTimer = null;
        this.classList.remove(GESTURE_ACTIVE_CLASS);
      }, DRILL_DURATION + 60);
    });

    // Layout-change effect: whenever the layout re-derives (sort, measure swap,
    // value-source change, value edit commit), re-target every live tile's
    // geometry cells toward the new layout. Two-lane split: TWEEN only for a
    // real reorder (sort key toggled index↔value) — tiles slide to new slots.
    // SNAP for everything else: active gesture (real-time drag), and — crucially
    // — value edits / commits / resize, including REMOTE cross-tile edits that
    // carry no gesture class (R2: value changes are write-through, no
    // 250-350ms settle-lag). Skips when a drill tween is in flight (the drill
    // effect owns that retarget).
    let layoutInited = false;
    let seenSortBy = untracked(() => this._sortByCell.value);
    let seenMeasureKey = untracked(() => this._measureKeyCell.value);
    biEffect(() => {
      void drillLayout.value; // track layout (reacts to sort + value + size + drill)
      const sortBy = this._sortByCell.value; // track sort key so a toggle re-fires this effect
      const measureKey = untracked(() => this._measureKeyCell.value); // read untracked — effect fires on layout change (leaf writes), by which point measureKey is already set
      if (!layoutInited) { layoutInited = true; seenSortBy = sortBy; seenMeasureKey = measureKey; return; }
      if (drillCancel) return; // drill tween in flight — it will retarget
      const reordered = sortBy !== seenSortBy;
      const measureSwapped = measureKey !== seenMeasureKey;
      seenSortBy = sortBy;
      seenMeasureKey = measureKey;
      const animate = (reordered || measureSwapped) && !this.classList.contains(GESTURE_ACTIVE_CLASS);
      // Defer past the forEach commit so tileGeo is fresh.
      requestAnimationFrame(() => {
        if (tileGeo.size > 0) {
          retargetTiles(untracked(() => this._drillIdCell.value), animate);
        }
      });
    });

    // Window: when drilled (fd > 0) include focus node as context header + descendants.
    // Walk focus subtree only so off-screen sibling rects don't leak into the canvas.
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
    // the exit CSS fade can play — including on drill. Exiting tiles freeze
    // their tile-geometry cells below so they don't ghost through the drill.
    const renderedSet = withExitDelay(windowTarget, {
      key: (n) => n,
    });
    const windowMembership = membershipCell(windowTarget, (n) => n);
    windowMembershipRef = windowMembership;

    // Flush a pending drill animation once forEach has populated tileGeo.
    // Uses requestAnimationFrame to defer past the forEach commit — the biEffect
    // fires when renderedSet changes, but forEach writes to tileGeo in a later
    // render cycle. rAF runs after the DOM has been updated.
    biEffect(() => {
      void renderedSet.value;
      void this._drillIdCell.value;
      if (pendingDrillId !== undefined) {
        const id = pendingDrillId;
        pendingDrillId = undefined;
        requestAnimationFrame(() => {
          if (tileGeo.size > 0) {
            retargetTiles(id, true);
            if (drillClassTimer) { clearTimeout(drillClassTimer); drillClassTimer = null; }
            this.classList.add(GESTURE_ACTIVE_CLASS);
            drillClassTimer = setTimeout(() => {
              drillClassTimer = null;
              this.classList.remove(GESTURE_ACTIVE_CLASS);
            }, DRILL_DURATION + 60);
          }
        });
      }
    });

    // Windowed node rendering.
    const nodeLayer = s(group());
    forEach(nodeLayer, renderedSet, (node) => {
      const nd = nodeDepth.get(node) ?? 0;
      const isLeaf = (node.children as BiNode[]).length === 0;

      // Per-tile screen geometry. Seed at the current drill target so new tiles
      // (entering the rendered set) appear at their correct destination. Existing
      // tiles keep their tileGeo cells from the previous render — the drill tween
      // animates those from their current position to the new target.
      const seed = targetRect(node, untracked(() => this._drillIdCell.value));
      const cx = num(seed.x), cy = num(seed.y), cw = num(seed.w), ch = num(seed.h);
      tileGeo.set(node, { cx, cy, cw, ch });
      const x = cx, y = cy, w = cw, h = ch;

      const stroke = derive(() =>
        state.focused.value === node ? "#fff"
        : hoverCell.value === node ? "#c8cdd6"
        : nd === 0 ? "#444" : "#0b0d12",
      );
      const strokeWidth = derive(() => (state.focused.value === node || hoverCell.value === node ? 2 : 1));

      const isContextNode = derive(() => nd > 0 && node.value.id === this._drillIdCell.value);
      const nodeFill = depthFill(node.value.color, nd);
      const tile = rect(x, y, w, h, {
        fill: nd === 0 ? node.value.color : nodeFill.toString(),
        stroke,
        strokeWidth,
        corner: 3,
      });
      tile.el.dataset.id = node.value.id ?? "";
      // WIN-155: compose lifecycle (enter/exit) with the context-dim opacity in
      // a single effect so they don't fight. Start at 0 pre-frame, then RAF to
      // the composed opacity so the enter fade plays over the CSS transition.
      const tilePresent = derive(() => windowMembership.value.has(node));
      tile.el.style.transition = `opacity ${ENTER_MS}ms cubic-bezier(0.4,0,0.2,1)`;
      tile.el.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        biEffect(() => {
          const present = tilePresent.value;
          const dim = (nd === 0 || isContextNode.value) ? 0.18 : 1;
          tile.el.style.opacity = present ? String(dim) : '0';
        });
      }));
      // WIN-260: drag-to-resize affordance — ew-resize cursor signals horizontal drag
      tile.el.style.cursor = "ew-resize";
      tile.el.setAttribute('tabindex', '0');
      tile.el.setAttribute('data-focusable', 'tile');
      biEffect(() => {
        tile.el.setAttribute('aria-label', `${node.value.label}: ${node.value.total.value.toFixed(0)}`);
      });
      // Geometry (x/y/w/h) is driven by the per-tile drill tween on this.anim —
      // NO CSS transition on those attrs (it would double-animate / lag the tween).
      // Prune the geometry/shape registries when this tile is torn down (left the window).
      tile.track(() => { if (tileGeo.get(node)?.cx === cx) { tileGeo.delete(node); tileMap.delete(node); } });
      tile.el.addEventListener("click", () => { state.focused.value = node; });
      tile.el.addEventListener("focus", () => { state.focused.value = node; });
      tile.el.addEventListener("blur", () => { if (state.focused.value === node) state.focused.value = null; });
      tile.el.addEventListener("dblclick", (e: MouseEvent) => {
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
      tile.el.addEventListener("pointerenter", () => { state.hovered.current = node; hoverCell.value = node; state.emitHover?.(node); });
      tile.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) { state.hovered.current = null; hoverCell.value = null; state.emitHover?.(null); } });

      // WIN-260: numberDrag for horizontal drag-to-resize (table column resize parity).
      // Routes through dragController for one-gesture-at-a-time + Esc-revert.
      // GESTURE_ACTIVE_CLASS suppresses layout scale updates (Rule 15).
      numberDrag(tile.el, {
        get: () => node.value.total.value,
        set: (v: number) => { node.value.total.value = v; },
        pxPerUnit: 4,
      });

      if (nd > 0) {
        const text = derive(() => {
          const w0 = w.value, h0 = h.value;
          if (w0 <= 28 || h0 <= 16) return "";
          return isLeaf
            ? `${node.value.label}\n${node.value.total.value.toFixed(0)}`
            : node.value.label;
        });
        // Fade the label in with the tile and out when the tile leaves the window.
        const labelOpacity = num(0);
        const labelFill = derive(() => isContextNode.value ? "#fff" : labelInk(nodeFill));
        const lbl = label(
          Vec.derive(() => ({ x: x.value + w.value / 2, y: y.value + (isLeaf ? h.value / 2 : 10) })),
          text,
          { size: isLeaf ? 11 : 10, align: Anchor.Center, fill: labelFill, bold: !isLeaf, opacity: labelOpacity },
        );
        lbl.el.style.transition = `opacity ${ENTER_MS}ms cubic-bezier(0.4,0,0.2,1)`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const disposeLabelOpacity = biEffect(() => {
            labelOpacity.value = tilePresent.value ? 1 : 0;
          });
          lbl.track(disposeLabelOpacity);
        }));
        tileMap.set(node, { tile, label: lbl });
        return [tile, lbl];
      }
      tileMap.set(node, { tile });
      return tile;
    }, { key: (n) => n.value.id ?? "" });

    // Keep the SVG paint order in sync with the tree view: leavers (which are
    // fading out) go behind, current-window nodes go in front, and within each
    // group we follow the pre-order set by the layout.
    biEffect(() => {
      const rendered = renderedSet.value;
      const members = windowMembership.value as unknown as Set<BiNode>;
      const nextSet = new Set<BiNode>(members);
      const leavers: BiNode[] = [];
      const current: BiNode[] = [];
      for (const n of rendered) {
        if (nextSet.has(n)) current.push(n); else leavers.push(n);
      }
      const ordered = [...leavers, ...current];
      for (const n of ordered) {
        const entry = tileMap.get(n);
        if (!entry) continue;
        nodeLayer.el.appendChild(entry.tile.el);
        if (entry.label) nodeLayer.el.appendChild(entry.label.el);
      }
    });

    if (!this.hasAttribute('no-source')) s(label(view.bottom.up(10), derive(() => {
      const f = state.focused.value;
      return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));

    // Drill breadcrumb in the chrome layer — chart-owned, reactive.
    if (this.showBreadcrumb !== false && this.chromeLayer) {
      this.breadcrumbDisposer?.();
      this.breadcrumbDisposer = mountDrillBreadcrumb({
        drillIdCell: this._drillIdCell,
        root,
        chromeLayer: this.chromeLayer,
        onDrill: (id) => {
          this.drillNodeId = id;
          const drillKey = (this as any).drillKey ?? "default";
          (this as ElementWithBridge).brSync?.emitDrill?.(drillKey, id);
        },
        onResize: (h) => { chromeH.value = h; },
      });
    }
  }
}
