// icicle-chart.ts — custom element rendering a hierarchical icicle using bireactive shapes.
// Host-sized SVG (no fixed viewBox), gesture-driven editing via the Gesture/Editor model.
// Shared input behaviors (wheelEdit, keyboardEdit) composed via setup().
// Edge handle drag via attachEdgeHandleDrag + GestureContext.
// Chart state (config, focus, hover, tree) stored as bireactive cells.

import { cell, derive, effect, forEach, group, type Cell } from "bireactive";
import type { ChartConfig, LayoutRect, RenderNode } from "./types";
import { Kernel } from "./kernel";
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
  computeReapportion,
  computeGroupReapportion,
  type GestureContext,
} from "./gestures";
import { useHostSize } from "./host-size";
import { wheelEdit } from "./behaviors/wheel-edit";
import { keyboardEdit, type ConservationMode } from "./behaviors/keyboard-edit";
import { applyConservedDelta, effectiveMode, type ConservationContext } from "./behaviors/conservation";
import { bindChart, rebuildTree } from "./chart-binding";

const SVG_NS = "http://www.w3.org/2000/svg";
const FALLBACK_W = 720;
const FALLBACK_H = 360;

export class IcicleChart extends HTMLElement implements GestureContext {
  static tag = "v-icicle";

  private _kernelCell = cell<Kernel | null>(null);
  private _configCell = cell<ChartConfig | null>(null);
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

  set kernel(k: Kernel) { this._kernelCell.value = k; }
  set config(c: ChartConfig) {
    this._configCell.value = { ...c };
    if (this._gesture) this._gesture.store.config.value = { ...c };
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

    this._setupDisposers.push(
      effect(() => {
        const k = this._kernelCell.value;
        const c = this._configCell.value;
        if (k && c) this._build(k, c);
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
      onActiveChange: (active) => this.classList.toggle("gesture-active", active),
      frozenOrder: this._frozenOrder,
    });

    rebuildTree(this._dataView, this._treeRoot);

    const { w: Wc, h: Hc } = this._hostSize!;

    this._window = derive(() => {
      const root = this._treeRoot.value;
      const frozen = this._frozenOrder.value;
      if (!root) return [];
      return buildWindow(root, config, frozen ?? undefined);
    });

    this._layout = derive(() => {
      const root = this._treeRoot.value;
      const frozen = this._frozenOrder.value;
      if (!root) return new Map<string, LayoutRect>();
      return computeLayout(root, config, frozen ?? undefined, Wc.value, Hc.value);
    });

    const windowCell = this._window;
    this._edges = derive(() => buildEdges(windowCell!.value));

    const tilesLayer = group();
    const edgesLayer = group();
    this._rootShape.add(tilesLayer, edgesLayer);

    const tilesResult = forEach(tilesLayer, this._window, (node) => makeTile(node, this._layout!, this), {
      key: (node) => node.id,
    });

    const edgesResult = forEach(edgesLayer, this._edges, (edge) => {
      const handle = makeHandle(edge, this._layout!, config);
      const off = attachEdgeHandleDrag(handle, this);
      handle.track(off);
      return handle;
    }, { key: (edge) => edge.id });

    this._buildDisposers.push(() => {
      tilesResult.dispose();
      edgesResult.dispose();
      tilesLayer.dispose();
      edgesLayer.dispose();
    });

    // Compose shared input behaviors onto the gesture.
    this._behaviorDispose = setup(this._gesture)(
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
    g.store.frozenOrder = this._dataView!.captureOrder();

    const left = findNode(root, edge.leftId)!;
    const right = findNode(root, edge.rightId)!;
    this.setPairTotal(left.value.value + right.value.value);

    this.classList.add("gesture-active");

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
    const root = this._treeRoot.value!;
    const layout = this.layout();
    const config = this.config;
    const left = findNode(root, edge.leftId)!;
    const right = findNode(root, edge.rightId)!;

    // Restore from snapshot so each frame computes from clean baseline.
    this.restore();

    const mode = effectiveMode(this.conservationMode, this.altHeld());

    if (mode === "proportional-siblings" && left.parent) {
      const siblings = left.parent.children;
      const groupTotal = siblings.reduce((sum, c) =>
        sum + (this.snapshot?.get(c.id) ?? c.value.value), 0);
      const newLeftVal = computeGroupReapportion(
        edge, layout, groupTotal, siblings, point, config.orientation,
      );
      const snapLeft = this.snapshot?.get(edge.leftId) ?? left.value.value;
      const delta = newLeftVal - snapLeft;

      const ctx: ConservationContext = {
        valueOf: this.valueOf,
        writeValue: this.writeValue,
        siblings: this.siblings,
        snapshot: this.snapshot,
      };
      applyConservedDelta(ctx, edge.leftId, delta, "proportional-siblings");
    } else {
      const { left: newLeft, right: newRight } = computeReapportion(
        edge, layout, this.pairTotal, point, config.orientation,
      );
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
    this.classList.remove("gesture-active");
    this._dataView!.commit();
  }
}

customElements.define(IcicleChart.tag, IcicleChart);
