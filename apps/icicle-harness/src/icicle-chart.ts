// icicle-chart.ts — custom element rendering a hierarchical icicle using bireactive shapes.
// Host-sized SVG (no fixed viewBox), gesture-driven editing via the Gesture/Editor model.
// Shared input behaviors (wheelEdit, keyboardEdit) composed via setup().
// Edge handle drag via attachEdgeHandleDrag + GestureContext.
// Chart state (config, focus, hover, tree) stored as bireactive cells.

import { cell, derive, effect, forEach, group, type Cell } from "bireactive";
import type { ChartConfig, LayoutRect, RenderNode } from "./types";
import { Kernel, configKey } from "./kernel";
import { DataView } from "./data-view";
import { Gesture, setup, type Behavior } from "./gesture";
import {
  buildAllDescendants,
  buildEdges,
  buildTree,
  computeLayout,
  findNode,
  makeHandle,
  makeTile,
  restoreValues,
  snapshotValues,
  type ChartNode,
  type Edge,
} from "./hierarchy";
import {
  attachEdgeHandleDrag,
  type GestureContext,
} from "./gestures";
import { useHostSize } from "./host-size";
import { wheelEdit } from "./behaviors/wheel-edit";
import { keyboardEdit, type ConservationMode } from "./behaviors/keyboard-edit";
import { applyConservedDelta, effectiveMode, type ConservationContext } from "./behaviors/conservation";
import { tileBodyDrag } from "./behaviors/tile-body-drag";
import { tileBodyReorder } from "./behaviors/tile-body-reorder";
import { transitionOnUpdated } from "./behaviors/transition-on-updated";
import { previewFullRender, captureOrderFromWindow } from "./behaviors/preview-full-render";
import { membershipCell } from "./behaviors/mark-lifecycle";
import { bindChart, rebuildTree } from "./chart-binding";

const SVG_NS = "http://www.w3.org/2000/svg";
const FALLBACK_W = 720;
const FALLBACK_H = 360;

export class IcicleChart extends HTMLElement implements GestureContext {
  static tag = "v-icicle";

  private _kernelCell = cell<Kernel | null>(null);
  private _configCell = cell<ChartConfig | null>(null);
  private _queryKeyCell = cell<string>("");
  private _treeRoot = cell<ChartNode | null>(null);
  private _frozenOrder = cell<Map<string, string[]> | null>(null);
  private _focusCell = cell<string | null>(null);
  private _hoverCell = cell<string | null>(null);
  private _drillId = cell<string | null>(null);

  private _gesture: Gesture | null = null;
  private _dataView: DataView | null = null;
  private _svg?: SVGSVGElement;
  private _chromeLayer?: HTMLDivElement;
  private _breadcrumbBar?: HTMLElement;
  private _rootShape?: any;
  private _window?: Cell<RenderNode[]>;
  private _layout?: Cell<Map<string, LayoutRect>>;
  private _edges?: Cell<Edge[]>;
  private _hostSize?: ReturnType<typeof useHostSize>;

  private _setupDisposers: (() => void)[] = [];
  private _buildDisposers: (() => void)[] = [];
  private _behaviorDispose: (() => void) | null = null;
  private _unsubChart: (() => void) | null = null;

  // GestureContext fields
  get config() { return this._configCell.value!; }
  get conservationMode(): ConservationMode {
    return (this._configCell.value?.conservationMode as ConservationMode) ?? "additive";
  }
  altHeld() { return this._gesture?.store.altHeld ?? false; }
  get snapshot() { return this._gesture?.store.snapshot ?? null; }
  treeRoot() { return this._treeRoot.value; }
  layout() { return this._layout!.value; }
  get pairTotal() { return this._gesture?.store.pairTotal ?? 0; }
  setPairTotal(n: number) { if (this._gesture) this._gesture.store.pairTotal = n; }
  private _dragBoundary = 0; // pixel position of the boundary at gesture start
  private _dragPairSize = 0; // pixel size of the pair at gesture start
  private _dragGroupSize = 0; // pixel size of the entire sibling group at gesture start

  set kernel(k: Kernel) { this._kernelCell.value = k; }
  /** Drill channel key — components with the same datasetId + drillKey
   *  share drill state via the Kernel. Default: "default". */
  drillKey = "default";
  set config(c: ChartConfig) {
    const prev = this._configCell.value;
    const prevKey = prev ? configKey(prev) : "";
    const nextKey = configKey(c);
    const dragChanged = prev?.dragBehavior !== c.dragBehavior;
    this._configCell.value = { ...c };
    if (this._gesture) this._gesture.store.config.value = { ...c };
    // Query key change OR dragBehavior change → rebuild (behaviors are
    // composed in _build, so a dragBehavior switch needs a rebuild to
    // re-compose). Render-field-only change → same DataView, derivers
    // re-run on existing DOM → transition.
    if (prevKey !== nextKey || dragChanged) {
      this._queryKeyCell.value = nextKey + (dragChanged ? `:drag=${c.dragBehavior}` : "");
    } else if (this._dataView) {
      // Render field change: update the DataView's config in place and fire
      // an `updated` so the chart re-derives and transitions.
      this._dataView.config = { ...c };
      this._gesture?.editor.updated();
    }
  }
  get dataView() { return this._dataView; }
  get gesture() { return this._gesture; }

  setFocus(id: string | null) { this._focusCell.value = id; }
  setHover(id: string | null) { this._hoverCell.value = id; }
  get focusedId() { return this._focusCell.value; }
  get hoveredId() { return this._hoverCell.value; }
  get focusCell() { return this._focusCell; }
  get hoverCell() { return this._hoverCell; }

  // D3-style drill: dblclick a node to drill in; dblclick the current
  // focus to drill out to its parent. The layout transform re-roots at
  // the focus; CSS transitions animate the slide. Emits to the Kernel's
  // drill channel so subscribers (side table, etc.) can sync.
  drill = (id: string | null) => {
    let nextId: string | null;
    if (id === null) {
      nextId = null;
    } else if (this._drillId.value === id) {
      // Drilling to the current focus → drill out to parent.
      const root = this._treeRoot.value;
      if (root) {
        const node = findNode(root, id);
        const parentId = node?.parent?.id ?? null;
        // Drilling out to the tree root = no drill (show full tree).
        nextId = parentId === root.id ? null : parentId;
      } else {
        nextId = null;
      }
    } else {
      nextId = id;
    }
    this._drillId.value = nextId;
    // Emit to the Kernel's drill channel for cross-component sync.
    const k = this._kernelCell.value;
    const cfg = this._configCell.value;
    if (k && cfg) k.setDrill(cfg.datasetId, this.drillKey, nextId);
  };

  // GestureContext value accessors
  valueOf = (id: string) => {
    const root = this._treeRoot.value;
    if (!root) return 0;
    const node = findNode(root, id);
    return node ? node.value.value : 0;
  };
  writeValue = (id: string, value: number) => {
    const root = this._treeRoot.value;
    if (!root) return;
    const node = findNode(root, id);
    if (node) node.value.value = value;
  };
  siblings = (id: string) => {
    const root = this._treeRoot.value;
    if (!root) return [];
    const node = findNode(root, id);
    if (!node || !node.parent) return [];
    return node.parent.children.map((c) => c.id);
  };
  restore = () => {
    const root = this._treeRoot.value;
    if (root && this._gesture?.store.snapshot) restoreValues(root, this._gesture.store.snapshot);
  };

  connectedCallback() {
    if (this._svg) return;
    this.style.display = "flex";
    this.style.flexDirection = "column";
    this.style.width = "100%";
    this.style.height = "100%";
    this.style.outline = "none";
    this.style.userSelect = "none";
    this.tabIndex = -1;

    // Chrome layer: HTML bar above the SVG for breadcrumb etc.
    // Flex: 0 0 auto — takes its content height, SVG fills the rest.
    this._chromeLayer = document.createElement("div");
    this._chromeLayer.style.flex = "0 0 auto";
    this._chromeLayer.style.pointerEvents = "none";
    this.appendChild(this._chromeLayer);

    this._svg = document.createElementNS(SVG_NS, "svg");
    this._svg.style.display = "block";
    this._svg.style.flex = "1 1 0";
    this._svg.style.width = "100%";
    this._svg.style.overflow = "hidden"; // clip off-canvas tiles during drill
    this.appendChild(this._svg);

    this._rootShape = group();
    this._svg.appendChild(this._rootShape.el);

    this._hostSize = useHostSize(this, { width: FALLBACK_W, height: FALLBACK_H }, this._svg);

    // Rendering layer — created once, persists across config changes.
    // D3-style: ALL descendants mount once via forEach over _allNodes
    // (stable list, never mounts/unmounts on depth/sort/orientation change).
    // _window is the present-filtered subset, used for edges + membership.
    // Off-window nodes stay mounted, gate visibility via opacity.
    const { w: Wc, h: Hc } = this._hostSize;

    const allNodes = derive(() => {
      const root = this._treeRoot.value;
      const frozen = this._frozenOrder.value;
      const config = this._configCell.value;
      const drill = this._drillId.value;
      if (!root || !config) return [];
      return buildAllDescendants(root, config, frozen ?? undefined, drill);
    });
    this._window = allNodes;

    this._layout = derive(() => {
      const root = this._treeRoot.value;
      const frozen = this._frozenOrder.value;
      const config = this._configCell.value;
      const drill = this._drillId.value;
      if (!root || !config) return new Map<string, LayoutRect>();
      // Hc is the SVG's actual size (measured by ResizeObserver on the SVG),
      // which already excludes the breadcrumb height because of flexbox.
      return computeLayout(root, config, frozen ?? undefined, Wc.value, Hc.value, drill);
    });

    // Present-filtered subset for membership (per-tile/per-handle visibility).
    const presentNodes = derive(() => allNodes.value.filter((n) => n.present));
    this._edges = derive(() => buildEdges(allNodes.value));
    const membership = membershipCell(presentNodes, (n) => n.id);

    const tilesLayer = group();
    const edgesLayer = group();
    this._rootShape.add(tilesLayer, edgesLayer);

    // Tiles: forEach over ALL descendants. Keyed by id → stable DOM across
    // depth/sort/orientation changes. No mount/unmount, no exit delay.
    const tilesResult = forEach(tilesLayer, allNodes, (node) =>
      makeTile(node, this._layout!, this, derive(() => membership.value.has(node.id))),
      { key: (node) => node.id },
    );

    // Edges: forEach over ALL adjacent sibling pairs. Handle visibility
    // gated by both siblings being present — no bleed-through during fade.
    const edgesResult = forEach(edgesLayer, this._edges, (edge) => {
      const handle = makeHandle(
        edge,
        this._layout!,
        this._configCell,
        derive(() => membership.value.has(edge.leftId) && membership.value.has(edge.rightId)),
      );
      const off = attachEdgeHandleDrag(handle, this);
      handle.track(off);
      return handle;
    }, { key: (edge) => edge.id });

    this._setupDisposers.push(() => {
      tilesResult.dispose();
      edgesResult.dispose();
      tilesLayer.dispose();
      edgesLayer.dispose();
    });

    // D3-style drill via host-level dblclick. Attached to the host (not
    // individual tiles) because setPointerCapture in tileBodyDrag can
    // prevent dblclick from reaching tile elements. Reads hovered/focused
    // node like production gestures.ts does.
    const onDblClick = () => {
      const id = this._hoverCell.value ?? this._focusCell.value;
      if (!id) return;
      // Don't drill into leaves — they have no children to show.
      const root = this._treeRoot.value;
      if (root) {
        const node = findNode(root, id);
        if (node && node.children.length === 0) return;
      }
      this.drill(id);
      // Keep focus on the chart host so Escape can drill out. The dblclick
      // target (a tile) may be torn down by the re-render, losing focus.
      this.focus({ preventScroll: true });
    };
    this.addEventListener("dblclick", onDblClick);
    this._setupDisposers.push(() => this.removeEventListener("dblclick", onDblClick));

    // Escape → drill out one level. Only when idle (a drafting gesture's
    // Escape is handled by the Gesture's document-level handler → cancel).
    // Scoped to the host (tabIndex = -1) so it only fires when the chart
    // has focus — matches production's document.activeElement.drillKey check.
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (this._gesture?.state === "Drafting") return; // let Gesture cancel
      const drillId = this._drillId.value;
      if (!drillId) return;
      e.preventDefault();
      this.drill(drillId); // drill(currentFocus) → drill out to parent
    };
    this.addEventListener("keydown", onKeydown);
    this._setupDisposers.push(() => this.removeEventListener("keydown", onKeydown));

    // Drill breadcrumb: reactive HTML overlay in the chrome layer.
    // D3-style enter/exit on individual crumbs — each crumb fades in
    // when it appears (drill deeper) and fades out when it disappears
    // (drill out). The bar itself stays mounted while any crumb is
    // visible; only the whole bar fades when the last crumb exits.
    const CRUMB_FADE_MS = 160;

    const fadeOutEl = (el: HTMLElement) => {
      el.style.opacity = "0";
      el.addEventListener("transitionend", function onEnd(e: TransitionEvent) {
        if (e.propertyName !== "opacity") return;
        el.removeEventListener("transitionend", onEnd);
        el.remove();
      });
      setTimeout(() => el.remove(), CRUMB_FADE_MS + 60); // fallback
    };

    // Build a crumb segment: optional separator + button, keyed by node id.
    // Wrapped in a span so the separator fades with the crumb.
    const buildSegment = (node: ChartNode, isLast: boolean): HTMLElement => {
      const seg = document.createElement("span");
      seg.className = "drill-segment";
      seg.dataset.crumbId = node.id;
      seg.style.transition = `opacity ${CRUMB_FADE_MS}ms ease`;
      seg.style.opacity = "0";

      const sep = document.createElement("span");
      sep.className = "drill-sep";
      sep.textContent = "›";
      seg.appendChild(sep);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = isLast ? "drill-crumb drill-crumb--current" : "drill-crumb";
      btn.textContent = node.label;
      if (!isLast) {
        btn.addEventListener("click", () => this.drill(node.id));
      }
      seg.appendChild(btn);
      return seg;
    };

    // Root crumb — no separator, always first.
    const buildRootSegment = (node: ChartNode): HTMLElement => {
      const seg = document.createElement("span");
      seg.className = "drill-segment";
      seg.dataset.crumbId = node.id;
      seg.style.transition = `opacity ${CRUMB_FADE_MS}ms ease`;
      seg.style.opacity = "0";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "drill-crumb";
      btn.textContent = node.label;
      btn.addEventListener("click", () => this.drill(null));
      seg.appendChild(btn);
      return seg;
    };

    // Track mounted crumb segments by node id for D3-style join.
    const crumbEls = new Map<string, HTMLElement>();

    const breadcrumbDispose = effect(() => {
      const drillId = this._drillId.value;
      const root = this._treeRoot.value;
      const showBc = this._configCell.value?.showBreadcrumb === true;

      // Resolve the path — empty if no drill, no root, or just root.
      let path: ChartNode[] = [];
      if (showBc && drillId && root) {
        let cur: ChartNode | null = findNode(root, drillId);
        while (cur) {
          path.unshift(cur);
          cur = cur.parent;
        }
        if (path.length <= 1) path = []; // just root, no breadcrumb needed
      }

      const newPathIds = new Set(path.map((n) => n.id));

      // Exit: crumbs no longer in path → fade out + remove.
      for (const [id, el] of crumbEls) {
        if (!newPathIds.has(id)) {
          fadeOutEl(el);
          crumbEls.delete(id);
        }
      }

      if (path.length === 0) {
        // No crumbs to show. If the bar is empty, remove it.
        const bar = this._breadcrumbBar;
        if (bar && crumbEls.size === 0) {
          fadeOutEl(bar);
          this._breadcrumbBar = undefined;
        }
        return;
      }

      // Ensure the bar exists.
      let bar = this._breadcrumbBar;
      if (!bar) {
        bar = document.createElement("nav");
        bar.className = "drill-breadcrumb";
        bar.setAttribute("role", "navigation");
        bar.setAttribute("aria-label", "Drill path");
        bar.style.opacity = "1"; // bar itself stays opaque; crumbs fade
        this._chromeLayer!.appendChild(bar);
        this._breadcrumbBar = bar;
      }

      // Enter + update: walk path in order, create missing crumbs,
      // and ensure DOM order matches path order.
      for (let i = 0; i < path.length; i++) {
        const node = path[i];
        const id = node.id;
        const isLast = i === path.length - 1;
        let seg = crumbEls.get(id);

        if (!seg) {
          // Enter: build new segment, insert at the right DOM position.
          seg = i === 0 ? buildRootSegment(node) : buildSegment(node, isLast);
          crumbEls.set(id, seg);
          // Insert before the first segment whose path index > i.
          let insertBefore: Node | null = null;
          for (let j = i + 1; j < path.length; j++) {
            const after = crumbEls.get(path[j].id);
            if (after) { insertBefore = after; break; }
          }
          bar.insertBefore(seg, insertBefore);
          // Force reflow so opacity:0 takes effect, then fade in.
          void seg.offsetHeight;
          seg.style.opacity = "1";
        } else {
          // Update: refresh the current-marker class (last crumb changes
          // when drilling deeper/out).
          const btn = seg.querySelector("button");
          if (btn) {
            btn.className = isLast ? "drill-crumb drill-crumb--current" : "drill-crumb";
            // Rebind click: last crumb is non-clickable; others drill to id.
            const clone = btn.cloneNode(true) as HTMLButtonElement;
            if (!isLast) {
              clone.addEventListener("click", () => this.drill(node.id));
            }
            btn.replaceWith(clone);
          }
        }
      }
    });
    this._setupDisposers.push(breadcrumbDispose);

    // Data layer — rebuilds only when the query key changes (datasetId,
    // measure, depth). Render-field changes update the config cell in place
    // and fire `updated` via the config setter; the derivers above re-run.
    this._setupDisposers.push(
      effect(() => {
        const k = this._kernelCell.value;
        const _key = this._queryKeyCell.value; // re-run on query key change
        const c = this._configCell.value;
        if (k && c && _key) this._build(k, c);
      }),
    );
  }

  disconnectedCallback() {
    this._unsubChart?.();
    this._behaviorDispose?.();
    this._buildDisposers.forEach((d) => d());
    this._setupDisposers.forEach((d) => d());
    this._rootShape?.dispose();
    this._gesture?.dispose();
    this._dataView?.dispose();
    (this as any)._roDispose?.();
    this._buildDisposers = [];
    this._setupDisposers = [];
  }

  private _build(kernel: Kernel, config: ChartConfig) {
    this._buildDisposers.forEach((d) => d());
    this._buildDisposers = [];
    this._unsubChart?.();
    this._behaviorDispose?.();
    this._gesture?.dispose();
    this._dataView?.dispose();

    this._gesture = new Gesture(undefined, config);
    this._gesture.store.host = this;
    this._gesture.store.focus = this._focusCell;
    this._gesture.store.hover = this._hoverCell;
    this._gesture.store.tree = this._treeRoot;
    this._gesture.store.takeSnapshot = () => {
      const root = this._treeRoot.value;
      if (root && !this._gesture!.store.snapshot) {
        this._gesture!.store.snapshot = snapshotValues(root);
      }
    };

    this._dataView = new DataView(kernel, config, this._gesture.editor);
    this._unsubChart = bindChart({
      treeRoot: this._treeRoot,
      gesture: this._gesture,
      dataView: this._dataView,
      rebuild: () => {
        rebuildTree(this._dataView!, this._treeRoot);
      },
      frozenOrder: this._frozenOrder,
    });

    rebuildTree(this._dataView, this._treeRoot);

    // Compose shared input + render behaviors onto the gesture.
    // Tile-body drag behavior: resize, reorder, or none, per config.
    // Default is "resize" (drag tile body to change its value).
    const dragBehavior = config.dragBehavior ?? "resize";
    const dragBehaviors: Behavior[] = [];
    if (dragBehavior === "resize") {
      dragBehaviors.push(tileBodyDrag({
        target: (g) => g.store.hover.value ?? g.store.focus.value,
        valueOf: (g) => this.valueOf,
        writeValue: this.writeValue,
        siblings: (g) => this.siblings,
        frozenOrder: () => this._frozenOrder.value,
        windowGetter: () => this._window?.value ?? null,
        frozenOrderCell: this._frozenOrder,
        deferSort: () => this.config.sort !== "index",
        focusTile: (id) => this.setFocus(id),
      }));
    } else if (dragBehavior === "reorder") {
      dragBehaviors.push(tileBodyReorder({
        target: (g) => g.store.hover.value ?? g.store.focus.value,
        treeRoot: (g) => this._treeRoot.value,
        layout: (g) => this._layout!.value,
        focusTile: (id) => this.setFocus(id),
        writeReorder: (parentId, orderedIds) => {
          const k = this._kernelCell.value;
          const cfg = this._configCell.value;
          if (k && cfg) k.writeReorder(cfg.datasetId, parentId, orderedIds);
        },
      }));
    }

    this._behaviorDispose = setup(this._gesture)(
      // Render behaviors.
      // Settle CSS on commit/cancel/updated; suppression class toggled
      // by this behavior via Editor subscription (single owner).
      transitionOnUpdated(),
      // Freeze sibling order during own gestures when sort !== 'index'.
      // Reads deferSort once at gesture start; captures and holds order
      // for the gesture's duration; clears on commit/cancel.
      previewFullRender({
        deferSort: () => this.config.sort !== "index",
        frozenOrder: this._frozenOrder,
        captureOrder: () => captureOrderFromWindow(this._window?.value ?? null),
      }),
      // Input behaviors.
      wheelEdit({
        target: (g) => g.store.hover.value ?? g.store.focus.value,
        valueOf: (g) => this.valueOf,
        writeValue: this.writeValue,
        frozenOrder: () => this._frozenOrder.value,
        conservationMode: (g) => this.conservationMode,
        siblings: (g) => this.siblings,
      }),
      keyboardEdit({
        target: (g) => g.store.focus.value,
        valueOf: (g) => this.valueOf,
        writeValue: this.writeValue,
        conservationMode: (g) => this.conservationMode,
        siblings: (g) => this.siblings,
        frozenOrder: () => this._frozenOrder.value,
      }),
      ...dragBehaviors,
    );
  }

  // --- GestureContext: edge handle drag lifecycle ---

  startGesture(edge: Edge) {
    const root = this._treeRoot.value!;
    const g = this._gesture!;
    g.store.activeEdge = edge;
    g.store.snapshot = snapshotValues(root);

    const left = findNode(root, edge.leftId)!;
    const right = findNode(root, edge.rightId)!;
    this.setPairTotal(left.value.value + right.value.value);

    // Capture boundary position and sizes at gesture start.
    const layout = this.layout();
    const lr = layout.get(edge.leftId)!;
    const rr = layout.get(edge.rightId)!;
    const isHoriz = this.config.orientation === "horizontal";
    this._dragBoundary = isHoriz ? lr.y + lr.height : lr.x + lr.width;
    this._dragPairSize = isHoriz ? lr.height + rr.height : lr.width + rr.width;

    // Group size = full span of all siblings (for proportional-siblings mode).
    // Siblings may be in any order (sort="value" reorders them), so compute
    // the span from min/max positions, not first/last index.
    if (left.parent) {
      const sibs = left.parent.children;
      let minStart = Infinity;
      let maxEnd = -Infinity;
      for (const s of sibs) {
        const r = layout.get(s.id);
        if (!r) continue;
        if (isHoriz) {
          minStart = Math.min(minStart, r.y);
          maxEnd = Math.max(maxEnd, r.y + r.height);
        } else {
          minStart = Math.min(minStart, r.x);
          maxEnd = Math.max(maxEnd, r.x + r.width);
        }
      }
      this._dragGroupSize = maxEnd > minStart ? maxEnd - minStart : this._dragPairSize;
    } else {
      this._dragGroupSize = this._dragPairSize;
    }

    // Capture frozen order BEFORE draft(). The previewFullRender behavior
    // subscribes to the Editor AFTER the DataView, so its capture would fire
    // after chart-binding has already applied the draft without frozenOrder
    // — causing siblings to jump to their natural sorted position on the
    // first frame. Capturing here ensures the draft event carries the
    // frozenOrder so chart-binding applies it correctly on the first frame.
    if (this.config.sort !== "index" && !g.store.frozenOrder) {
      const order = captureOrderFromWindow(this._window?.value ?? null);
      this._frozenOrder.value = order;
      g.store.frozenOrder = order;
    }

    this._dataView!.draft({
      nodeId: edge.leftId,
      value: left.value.value,
      secondaryNodeId: edge.rightId,
      secondaryValue: right.value.value,
      source: "divider-handle",
      intent: "edit",
      frozenOrder: g.store.frozenOrder ?? undefined,
    });
  }

  updateGesture(edge: Edge, point: { x: number; y: number }) {
    const g = this._gesture!;
    if (g.state !== "Drafting") return;

    // Restore from snapshot so each frame starts from clean baseline.
    this.restore();

    const root = this._treeRoot.value!;
    const config = this.config;
    const left = findNode(root, edge.leftId)!;
    const isHoriz = config.orientation === "horizontal";

    // Edge handle drag is ALWAYS two-sibling reapportion (spec §3): only the
    // two adjacent siblings change, by the drag fraction. conservationMode
    // governs per-item gestures (keyboard, wheel, tile-body drag) — not the
    // splitter. The handle lives between A and B; it has no relationship to
    // C, D, E. Making it redistribute across all siblings is a category error
    // (pair-affordance doing single-item work) and produces the asymmetric
    // rightmost-splitter bug.
    const pos = isHoriz ? point.y : point.x;
    const deltaPx = pos - this._dragBoundary;
    const valueScale = this._dragPairSize > 0 ? this.pairTotal / this._dragPairSize : 0;
    const deltaValue = deltaPx * valueScale;

    const snapLeft = this.snapshot?.get(edge.leftId) ?? left.value.value;
    const snapRight = this.snapshot?.get(edge.rightId) ?? this.pairTotal - snapLeft;
    // Cap delta to preserve the pair sum exactly — no value lost to the floor.
    // Growing left: can't take more than right has. Shrinking left: can't go below 0.
    const cappedDelta = deltaValue > 0
      ? Math.min(deltaValue, snapRight)
      : Math.max(deltaValue, -snapLeft);
    const newLeft = snapLeft + cappedDelta;
    const newRight = snapRight - cappedDelta;
    this.writeValue(edge.leftId, newLeft);
    this.writeValue(edge.rightId, newRight);

    this._dataView!.updateDraft({
      nodeId: edge.leftId,
      value: this.valueOf(edge.leftId),
      secondaryNodeId: edge.rightId,
      secondaryValue: this.valueOf(edge.rightId),
      source: "divider-handle",
      intent: "edit",
      frozenOrder: g.store.frozenOrder ?? undefined,
    });
  }

  endGesture(_edge: Edge) {
    const g = this._gesture!;
    if (g.state !== "Drafting") return;
    this.setPairTotal(0);
    g.store.activeEdge = null;
    this._dataView!.commit();
  }
}

customElements.define(IcicleChart.tag, IcicleChart);
