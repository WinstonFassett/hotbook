// icicle-chart.ts — custom element rendering a hierarchical icicle using bireactive shapes.
// Host-sized SVG (no fixed viewBox), gesture-driven editing via the Gesture/Editor model.
// Shared input behaviors (wheelEdit, keyboardEdit) composed via setup().
// Chart state (config, focus, hover, tree) stored as bireactive cells — living, subscribable,
// and participating in the reactive graph so derive()s re-run automatically.

import { cell, derive, effect, forEach, group, type Cell } from "bireactive";
import type { ChartConfig, LayoutRect, RenderNode } from "./types";
import { Kernel } from "./kernel";
import { DataView, type DataViewEvent } from "./data-view";
import { Gesture, setup } from "./gesture";
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
import { attachEdgeHandleDrag, computeReapportion, type GestureContext } from "./gestures";
import { useHostSize } from "./host-size";
import { wheelEdit } from "./behaviors/wheel-edit";
import { keyboardEdit, type ConservationMode } from "./behaviors/keyboard-edit";

const SVG_NS = "http://www.w3.org/2000/svg";
const FALLBACK_W = 720;
const FALLBACK_H = 360;

export class IcicleChart extends HTMLElement implements GestureContext {
  static tag = "v-icicle";

  private _kernelCell = cell<Kernel | null>(null);
  private _configCell = cell<ChartConfig | null>(null);
  private _treeRoot = cell<ChartNode | null>(null);
  private _frozenOrder = cell<Map<string, string[]> | null>(null);

  // Selection/focus/hover as bireactive cells — shared with the gesture store.
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

  set kernel(k: Kernel) {
    this._kernelCell.value = k;
  }

  set config(c: ChartConfig) {
    this._configCell.value = { ...c };
    if (this._gesture) this._gesture.store.config.value = { ...c };
  }

  get dataView() {
    return this._dataView;
  }

  get gesture() {
    return this._gesture;
  }

  get config() {
    return this._configCell.value;
  }

  // Selection = focus. Click selects. Tab navigates.
  setFocus(id: string | null) {
    this._focusCell.value = id;
  }

  setHover(id: string | null) {
    this._hoverCell.value = id;
  }

  get focusedId() {
    return this._focusCell.value;
  }

  get hoveredId() {
    return this._hoverCell.value;
  }

  // Expose cells for makeTile's derive()s to read reactively.
  get focusCell() {
    return this._focusCell;
  }

  get hoverCell() {
    return this._hoverCell;
  }

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
    this._behaviorDispose?.();
    this._gesture?.dispose();
    this._dataView?.dispose();

    this._gesture = new Gesture(undefined, config);
    this._gesture.store.host = this;
    // Share the chart's bireactive cells with the gesture store.
    this._gesture.store.focus = this._focusCell;
    this._gesture.store.hover = this._hoverCell;
    this._gesture.store.tree = this._treeRoot;
    // Provide snapshot function so behaviors can snapshot before first write.
    this._gesture.store.takeSnapshot = () => {
      const root = this._treeRoot.value;
      if (root && !this._gesture!.store.snapshot) {
        this._gesture!.store.snapshot = snapshotValues(root);
      }
    };
    // config is already seeded in the Gesture constructor; keep it in sync.

    this._dataView = new DataView(kernel, config, this._gesture.editor);
    this._dataView.subscribe((e) => this._onEvent(e));

    const ds = kernel.getDataset(config.datasetId);
    if (ds) this._treeRoot.value = buildTree(ds.root);

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
    this._edges = derive(() => {
      const win = windowCell!.value;
      return buildEdges(win);
    });

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
        valueOf: (g) => (id: string) => {
          const root = g.store.tree.value;
          if (!root) return 0;
          const node = findNode(root, id);
          return node ? node.value.value : 0;
        },
        writeValue: (id, value) => {
          const root = this._treeRoot.value;
          if (!root) return;
          const node = findNode(root, id);
          if (node) node.value.value = value;
        },
        frozenOrder: () => this._frozenOrder.value,
      }),
      keyboardEdit({
        target: (g) => g.store.focus.value,
        valueOf: (g) => (id: string) => {
          const root = g.store.tree.value;
          if (!root) return 0;
          const node = findNode(root, id);
          return node ? node.value.value : 0;
        },
        writeValue: (id, value) => {
          const root = this._treeRoot.value;
          if (!root) return;
          const node = findNode(root, id);
          if (node) node.value.value = value;
        },
        conservationMode: (g) =>
          (g.store.config.value?.conservationMode as ConservationMode) ?? "additive",
        siblings: (g) => (id: string) => {
          const root = g.store.tree.value;
          if (!root) return [];
          const node = findNode(root, id);
          if (!node || !node.parent) return [];
          return node.parent.children.map((c) => c.id);
        },
        frozenOrder: () => this._frozenOrder.value,
      }),
    );
  }

  private _onEvent(event: DataViewEvent) {
    const root = this._treeRoot.value;
    if (!root) return;
    const g = this._gesture!;

    if (event.type === "updated") {
      if (g.state === "Drafting") return;
      this._frozenOrder.value = null;
      g.resetStore();
      const ds = this._dataView!.kernel.getDataset(this._dataView!.config.datasetId);
      if (ds) this._treeRoot.value = buildTree(ds.root);
      return;
    }

    if (event.type === "draft") {
      if (event.isActive) {
        // Active draft (from our own gesture) — snapshot on first draft if not yet taken.
        if (!g.store.snapshot) g.store.snapshot = snapshotValues(root);
        return;
      }
      // Cross-tile draft from another chart — snapshot + apply.
      const draft = event.draft!;
      if (!g.store.snapshot) g.store.snapshot = snapshotValues(root);
      applyDraft(root, draft);
      this._frozenOrder.value = draft.frozenOrder ? new Map(draft.frozenOrder.entries()) : null;
      return;
    }

    if (event.type === "commit") {
      if (event.isActive) {
        const writes = leafValues(root);
        this._dataView!.kernel.writeValues(this._dataView!.config.datasetId, writes);
      }
      this._frozenOrder.value = null;
      g.resetStore();
      this.classList.remove("gesture-active");
      return;
    }

    if (event.type === "cancel") {
      if (g.store.snapshot) restoreValues(root, g.store.snapshot);
      this._frozenOrder.value = null;
      g.resetStore();
      this.classList.remove("gesture-active");
      return;
    }
  }

  // --- GestureContext implementation (edge handle drag) ---

  startGesture(edge: Edge) {
    const root = this._treeRoot.value!;
    const g = this._gesture!;
    g.store.activeEdge = edge;
    g.store.snapshot = snapshotValues(root);
    g.store.frozenOrder = this._dataView!.captureOrder();

    const left = findNode(root, edge.leftId)!;
    const right = findNode(root, edge.rightId)!;
    g.store.pairTotal = left.value.value + right.value.value;

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
    // Ignore drag updates after cancel — the draggable is still active
    // until pointerup, but the editor is Idle.
    if (g.state !== "Drafting") return;
    const root = this._treeRoot.value!;
    const layout = this._layout!.value;
    const left = findNode(root, edge.leftId)!;
    const right = findNode(root, edge.rightId)!;
    const { left: newLeft, right: newRight } = computeReapportion(
      edge,
      layout,
      g.store.pairTotal,
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
      frozenOrder: g.store.frozenOrder ?? undefined,
    });
  }

  endGesture(_edge: Edge) {
    const g = this._gesture!;
    // If the gesture was cancelled (Escape), don't commit — values were restored.
    if (g.state !== "Drafting") {
      this.classList.remove("gesture-active");
      return;
    }
    this.classList.remove("gesture-active");
    this._dataView!.commit();
  }
}

customElements.define(IcicleChart.tag, IcicleChart);
