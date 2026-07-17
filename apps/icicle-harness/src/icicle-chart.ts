// icicle-chart.ts — custom element rendering a hierarchical icicle using bireactive shapes.
// Host-sized SVG (no fixed viewBox), gesture-driven editing via the Gesture/Editor model.
// Shared input behaviors (wheelEdit, keyboardEdit) composed via setup().
// Edge handle drag via attachEdgeHandleDrag + GestureContext.
// Chart state (config, focus, hover, tree) stored as bireactive cells.

import { cell, derive, effect, forEach, group, type Cell } from "bireactive";
import type { ChartConfig, LayoutRect, RenderNode } from "./types";
import { Kernel, configKey } from "./kernel";
import { DataView } from "./data-view";
import { Gesture, setup } from "./gesture";
import {
  buildEdges,
  buildTree,
  buildWindow,
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
import { transitionOnUpdated } from "./behaviors/transition-on-updated";
import { previewFullRender, captureOrderFromWindow } from "./behaviors/preview-full-render";
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

  private _gesture: Gesture | null = null;
  private _dataView: DataView | null = null;
  private _svg?: SVGSVGElement;
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
  set config(c: ChartConfig) {
    const prev = this._configCell.value;
    const prevKey = prev ? configKey(prev) : "";
    const nextKey = configKey(c);
    this._configCell.value = { ...c };
    if (this._gesture) this._gesture.store.config.value = { ...c };
    // Query key change → rebuild data layer (new DataView). Render-field-only
    // change → same DataView, derivers re-run on existing DOM → transition.
    if (prevKey !== nextKey) {
      this._queryKeyCell.value = nextKey;
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
    this.style.display = "block";
    this.style.width = "100%";
    this.style.height = "100%";
    this.style.outline = "none";
    this.tabIndex = -1;

    this._svg = document.createElementNS(SVG_NS, "svg");
    this._svg.style.display = "block";
    this._svg.style.width = "100%";
    this._svg.style.height = "100%";
    this.appendChild(this._svg);

    this._rootShape = group();
    this._svg.appendChild(this._rootShape.el);

    this._hostSize = useHostSize(this, { width: FALLBACK_W, height: FALLBACK_H });

    // Rendering layer — created once, persists across config changes.
    // Derivers read config from _configCell, so render-field changes
    // (sort, orientation, etc.) re-derive on existing DOM → transition.
    const { w: Wc, h: Hc } = this._hostSize;

    this._window = derive(() => {
      const root = this._treeRoot.value;
      const frozen = this._frozenOrder.value;
      const config = this._configCell.value;
      if (!root || !config) return [];
      return buildWindow(root, config, frozen ?? undefined);
    });

    this._layout = derive(() => {
      const root = this._treeRoot.value;
      const frozen = this._frozenOrder.value;
      const config = this._configCell.value;
      if (!root || !config) return new Map<string, LayoutRect>();
      return computeLayout(root, config, frozen ?? undefined, Wc.value, Hc.value);
    });

    const windowCell = this._window;
    this._edges = derive(() => buildEdges(windowCell!.value));

    const tilesLayer = group();
    const edgesLayer = group();
    this._rootShape.add(tilesLayer, edgesLayer);

    const tilesResult = forEach(tilesLayer, this._window, (node) =>
      makeTile(node, this._layout!, this),
      { key: (node) => node.id },
    );

    const edgesResult = forEach(edgesLayer, this._edges, (edge) => {
      const handle = makeHandle(edge, this._layout!, this._configCell);
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
    if (left.parent) {
      const sibs = left.parent.children;
      const first = layout.get(sibs[0].id)!;
      const last = layout.get(sibs[sibs.length - 1].id)!;
      this._dragGroupSize = isHoriz
        ? (last.y + last.height) - first.y
        : (last.x + last.width) - first.x;
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

    const mode = effectiveMode(this.conservationMode, this.altHeld());

    // Delta from the captured boundary position at gesture start.
    const pos = isHoriz ? point.y : point.x;
    const deltaPx = pos - this._dragBoundary;

    // In proportional-siblings mode, the left tile's pixel width is its share
    // of the entire sibling group, so pixel→value must use group total/size.
    // In pair-only modes, it's the pair total/size.
    let valueScale: number;
    if (mode === "proportional-siblings" && left.parent) {
      const siblings = left.parent.children;
      const groupTotal = siblings.reduce((sum, c) =>
        sum + (this.snapshot?.get(c.id) ?? c.value.value), 0);
      valueScale = this._dragGroupSize > 0 ? groupTotal / this._dragGroupSize : 0;
    } else {
      valueScale = this._dragPairSize > 0 ? this.pairTotal / this._dragPairSize : 0;
    }
    const deltaValue = deltaPx * valueScale;

    const snapLeft = this.snapshot?.get(edge.leftId) ?? left.value.value;
    const newLeft = Math.max(0, snapLeft + deltaValue);

    if (mode === "proportional-siblings" && left.parent) {
      const ctx: ConservationContext = {
        valueOf: this.valueOf,
        writeValue: this.writeValue,
        siblings: this.siblings,
        snapshot: this.snapshot,
      };
      applyConservedDelta(ctx, edge.leftId, newLeft - snapLeft, "proportional-siblings");
    } else {
      const newRight = Math.max(0, this.pairTotal - newLeft);
      this.writeValue(edge.leftId, newLeft);
      this.writeValue(edge.rightId, newRight);
    }

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
