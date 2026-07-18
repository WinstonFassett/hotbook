// icicle-chart.ts — custom element rendering a hierarchical icicle using bireactive shapes.
// Extends HierarchicalChartBase with rectilinear-geometry rendering (tiles + edge
// handles), icicle-specific behavior composition, and the edge-handle drag gesture
// (GestureContext.startGesture/updateGesture/endGesture).

import { derive, forEach, group, type Cell } from "bireactive";
import type { ChartConfig, LayoutRect, RenderNode } from "./types";
import {
  buildAllDescendants,
  buildEdges,
  computeLayout,
  findNode,
  makeHandle,
  makeTile,
  type ChartNode,
  type Edge,
} from "./hierarchy";
import {
  attachEdgeHandleDrag,
  type GestureContext,
} from "./gestures";
import type { Gesture } from "./gesture";
import { tileBodyDrag } from "./behaviors/tile-body-drag";
import { tileBodyReorder } from "./behaviors/tile-body-reorder";
import { membershipCell } from "./behaviors/mark-lifecycle";
import { HierarchicalChartBase } from "./hierarchical-chart-base";

export class IcicleChart extends HierarchicalChartBase implements GestureContext<LayoutRect> {
  static tag = "v-icicle";

  private _window?: Cell<RenderNode[]>;
  private _layout?: Cell<Map<string, LayoutRect>>;
  private _edges?: Cell<Edge[]>;
  private _dragBoundary = 0; // pixel position of the boundary at gesture start
  private _dragPairSize = 0; // pixel size of the pair at gesture start

  // GestureContext: layout accessor (icicle-specific — rectilinear layout).
  layout() { return this._layout!.value; }

  // --- Hook: chart-specific rendering ---

  protected _setupRendering(): void {
    const allNodes = this._deriveWindow(
      (root, config, frozen, drill) => buildAllDescendants(root, config, frozen, drill),
      [] as RenderNode[],
    );
    this._window = allNodes;

    this._layout = this._deriveLayout(
      (root, config, frozen, w, h, drill) => computeLayout(root, config, frozen, w, h, drill),
      new Map<string, LayoutRect>(),
    );

    // Present-filtered subset for membership (per-tile/per-handle visibility).
    const presentNodes = derive(() => allNodes.value.filter((n) => n.present));
    this._edges = derive(() => buildEdges(allNodes.value));
    const membership = membershipCell(presentNodes, (n) => n.id);

    const tilesLayer = group();
    const edgesLayer = group();
    this._rootShape!.add(tilesLayer, edgesLayer);

    // Tiles: forEach over ALL descendants. Keyed by id → stable DOM across
    // depth/sort/orientation changes. No mount/unmount, no exit delay.
    const isHorizCell = derive(() => this._configCell.value?.orientation === "horizontal");
    const tilesResult = forEach(tilesLayer, allNodes, (node) =>
      makeTile(node, this._layout!, this, derive(() => membership.value.has(node.id)), isHorizCell, this._defs, this._instanceId),
      { key: (node) => node.id },
    );

    // Edges: forEach over ALL adjacent sibling pairs. Handle visibility
    // gated by both siblings being present — no bleed-through during fade.
    // Spec §3: suppressed entirely when the `no-handles` attribute is
    // present (checked at mount time, matching the old implementation).
    const noHandles = this.hasAttribute("no-handles");
    const emptyEdges = derive(() => [] as Edge[]);
    const edgesResult = forEach(edgesLayer, noHandles ? emptyEdges : this._edges, (edge) => {
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
  }

  // --- Hook: chart-specific behavior composition ---

  protected _composeBehaviors(): void {
    const dragBehaviors = this._selectDragBehaviors(
      tileBodyDrag({
        target: (g: Gesture) => g.store.hover.value ?? g.store.focus.value,
        valueOf: (_g: Gesture) => this.valueOf,
        writeValue: this.writeValue,
        siblings: (_g: Gesture) => this.siblings,
        frozenOrder: () => this._frozenOrder.value,
        windowGetter: () => this._window?.value ?? null,
        frozenOrderCell: this._frozenOrder,
        deferSort: () => this.config.sort !== "index",
        focusTile: (id) => this.setFocus(id),
      }),
      tileBodyReorder({
        target: (g: Gesture) => g.store.hover.value ?? g.store.focus.value,
        treeRoot: (_g: Gesture) => this._treeRoot.value,
        layout: (_g: Gesture) => this._layout!.value,
        focusTile: (id) => this.setFocus(id),
        writeReorder: (parentId, orderedIds) => {
          const k = this._kernelCell.value;
          const cfg = this._configCell.value;
          if (k && cfg) k.writeReorder(cfg.datasetId, parentId, orderedIds);
        },
        bumpReorder: () => this.bumpReorder(),
        frozenOrderCell: this._frozenOrder,
      }),
    );
    this._behaviorDispose = this._composeStandardBehaviors(dragBehaviors);
  }

  // --- GestureContext: edge handle drag lifecycle (icicle-specific) ---

  startGesture(edge: Edge) {
    this._startGestureCommon(edge);

    // Capture boundary position and sizes at gesture start.
    const layout = this.layout();
    const lr = layout.get(edge.leftId)!;
    const rr = layout.get(edge.rightId)!;
    const isHoriz = this.config.orientation === "horizontal";
    this._dragBoundary = isHoriz ? lr.y + lr.height : lr.x + lr.width;
    this._dragPairSize = isHoriz ? lr.height + rr.height : lr.width + rr.width;
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
    this._endGestureCommon();
  }
}

