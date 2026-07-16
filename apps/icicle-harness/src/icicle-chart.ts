// icicle-chart.ts — custom element rendering a hierarchical icicle using bireactive shapes.
// All gesture policy lives in the chart; geometry helpers are in hierarchy.ts and gestures.ts.

import { cell, derive, effect, forEach, group } from "bireactive";
import type { ChartConfig, LayoutRect } from "./types";
import { Kernel } from "./kernel";
import { DataView, type DataViewEvent } from "./data-view";
import {
  applyDraft,
  buildEdges,
  buildTree,
  buildWindow,
  computeLayout,
  findNode,
  leafValues,
  makeHandle,
  makeTile,
  restoreValues,
  snapshotValues,
  type ChartNode,
  type Edge,
} from "./hierarchy";
import { attachDividerDrag, computeReapportion, type GestureContext } from "./gestures";

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_W = 720;
const VIEW_H = 480;

export class IcicleChart extends HTMLElement implements GestureContext {
  static tag = "v-icicle";

  private _kernelCell = cell<Kernel | null>(null);
  private _configCell = cell<ChartConfig | null>(null);
  private _treeRoot = cell<ChartNode | null>(null);
  private _frozenOrder = cell<Map<string, string[]> | null>(null);

  private _dataView: DataView | null = null;
  private _svg?: SVGSVGElement;
  private _rootShape?: any;
  private _window?: any;
  private _layout?: any;
  private _edges?: any;

  private _snapshot: Map<string, number> | null = null;
  private _pairTotal = 0;
  private _activeEdge: Edge | null = null;

  private _setupDisposers: (() => void)[] = [];
  private _buildDisposers: (() => void)[] = [];

  set kernel(k: Kernel) {
    this._kernelCell.value = k;
  }

  set config(c: ChartConfig) {
    // Clone so object identity changes trigger reactive rebuilds.
    this._configCell.value = { ...c };
  }

  get dataView() {
    return this._dataView;
  }

  get _dataView() {
    return this._dataView;
  }

  get config() {
    return this._configCell.value;
  }

  connectedCallback() {
    if (this._svg) return;
    this._svg = document.createElementNS(SVG_NS, "svg");
    this._svg.setAttribute("width", "100%");
    this._svg.setAttribute("height", "100%");
    this._svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
    this._svg.setAttribute("preserveAspectRatio", "none");
    this.appendChild(this._svg);

    this._rootShape = group();
    this._svg.appendChild(this._rootShape.el);

    this._setupDisposers.push(
      effect(() => {
        const k = this._kernelCell.value;
        const c = this._configCell.value;
        if (k && c) this._build(k, c);
      }),
    );
  }

  disconnectedCallback() {
    this._buildDisposers.forEach((d) => d());
    this._setupDisposers.forEach((d) => d());
    this._rootShape?.dispose();
    this._dataView?.dispose();
    this._buildDisposers = [];
    this._setupDisposers = [];
  }

  private _build(kernel: Kernel, config: ChartConfig) {
    // Tear down previous chart wiring.
    this._buildDisposers.forEach((d) => d());
    this._buildDisposers = [];
    this._dataView?.dispose();

    this._dataView = new DataView(kernel, config);
    this._dataView.subscribe((e) => this._onEvent(e));

    const ds = kernel.getDataset(config.datasetId);
    if (ds) this._treeRoot.value = buildTree(ds.root);

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
      return computeLayout(root, config, frozen ?? undefined, VIEW_W, VIEW_H);
    });

    this._edges = derive(() => {
      const win = this._window.value;
      return buildEdges(win);
    });

    const tilesLayer = group();
    const edgesLayer = group();
    this._rootShape.add(tilesLayer, edgesLayer);

    const tilesResult = forEach(tilesLayer, this._window, (node) => makeTile(node, this._layout!), {
      key: (node) => node.id,
    });

    const edgesResult = forEach(edgesLayer, this._edges, (edge) => {
      const handle = makeHandle(edge, this._layout!, config);
      const off = attachDividerDrag(handle, this);
      handle.track(off);
      return handle;
    }, { key: (edge) => edge.id });

    this._buildDisposers.push(() => {
      tilesResult.dispose();
      edgesResult.dispose();
      tilesLayer.dispose();
      edgesLayer.dispose();
    });
  }

  private _onEvent(event: DataViewEvent) {
    const root = this._treeRoot.value;
    if (!root) return;

    if (event.type === "updated") {
      // Rebuild from committed data. Skip while we're drafting (draft overlay should remain).
      if (this._dataView!.editor.state === "Drafting") return;
      this._frozenOrder.value = null;
      this._snapshot = null;
      this._activeEdge = null;
      this._pairTotal = 0;
      const ds = this._dataView!.kernel.getDataset(this._dataView!.config.datasetId);
      if (ds) this._treeRoot.value = buildTree(ds.root);
      return;
    }

    if (event.type === "draft") {
      if (event.isActive) return; // we already wrote the cells in updateGesture
      const draft = event.draft!;
      if (!this._snapshot) this._snapshot = snapshotValues(root);
      applyDraft(root, draft);
      this._frozenOrder.value = draft.frozenOrder ? new Map(draft.frozenOrder.entries()) : null;
      return;
    }

    if (event.type === "commit") {
      if (event.isActive) {
        // Persist the current leaf values so parent totals and internal ratios are preserved.
        const writes = leafValues(root);
        this._dataView!.kernel.writeValues(this._dataView!.config.datasetId, writes);
      }
      this._frozenOrder.value = null;
      this._snapshot = null;
      this._activeEdge = null;
      this._pairTotal = 0;
      this.classList.remove("gesture-active");
      return;
    }

    if (event.type === "cancel") {
      if (this._snapshot) restoreValues(root, this._snapshot);
      this._frozenOrder.value = null;
      this._snapshot = null;
      this._activeEdge = null;
      this._pairTotal = 0;
      this.classList.remove("gesture-active");
      return;
    }
  }

  // GestureContext implementation

  startGesture(edge: Edge) {
    const root = this._treeRoot.value!;
    this._activeEdge = edge;
    this._snapshot = snapshotValues(root);
    this._frozenOrder.value = this._dataView!.captureOrder();

    const left = findNode(root, edge.leftId)!;
    const right = findNode(root, edge.rightId)!;
    this._pairTotal = left.value.value + right.value.value;

    this.classList.add("gesture-active");

    this._dataView!.draft({
      nodeId: edge.leftId,
      value: left.value.value,
      secondaryNodeId: edge.rightId,
      secondaryValue: right.value.value,
      source: "divider-handle",
      intent: "edit",
      frozenOrder: this._frozenOrder.value ?? undefined,
    });
  }

  updateGesture(edge: Edge, point: { x: number; y: number }) {
    const root = this._treeRoot.value!;
    const layout = this._layout!.value;
    const left = findNode(root, edge.leftId)!;
    const right = findNode(root, edge.rightId)!;
    const { left: newLeft, right: newRight } = computeReapportion(
      edge,
      layout,
      this._pairTotal,
      point,
      this._configCell.value!.orientation,
    );

    left.value.value = newLeft;
    right.value.value = newRight;

    this._dataView!.updateDraft({
      nodeId: edge.leftId,
      value: newLeft,
      secondaryNodeId: edge.rightId,
      secondaryValue: newRight,
      source: "divider-handle",
      intent: "edit",
      frozenOrder: this._frozenOrder.value ?? undefined,
    });
  }

  endGesture(_edge: Edge) {
    this.classList.remove("gesture-active");
    this._dataView!.commit();
  }
}

customElements.define(IcicleChart.tag, IcicleChart);
