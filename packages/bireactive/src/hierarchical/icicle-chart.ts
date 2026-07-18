// icicle-chart.ts — custom element rendering a hierarchical icicle using bireactive shapes.
// Extends HierarchicalChartBase with rectilinear-geometry rendering (tiles + edge
// handles), icicle-specific behavior composition, and the edge-handle drag gesture
// (GestureContext.startGesture/updateGesture/endGesture).

import { derive, forEach, group, type Cell } from "bireactive";
import type { ChartConfig, LayoutRect, RenderNode } from "./types";
import { Kernel } from "./kernel";
import { Gesture, type Behavior } from "./gesture";
import {
  buildAllDescendants,
  buildEdges,
  computeLayout,
  findNode,
  makeHandle,
  makeTile,
  snapshotValues,
  type ChartNode,
  type Edge,
} from "./hierarchy";
import {
  attachEdgeHandleDrag,
  type GestureContext,
} from "./gestures";
import { useHostSize } from "./host-size";
import { tileBodyDrag } from "./behaviors/tile-body-drag";
import { tileBodyReorder } from "./behaviors/tile-body-reorder";
import { membershipCell } from "./behaviors/mark-lifecycle";
import { HierarchicalChartBase } from "./hierarchical-chart-base";

const FALLBACK_W = 720;
const FALLBACK_H = 360;

export class IcicleChart extends HierarchicalChartBase implements GestureContext<LayoutRect> {
  static tag = "v-icicle";

  private _window?: Cell<RenderNode[]>;
  private _layout?: Cell<Map<string, LayoutRect>>;
  private _edges?: Cell<Edge[]>;
  private _dragBoundary = 0; // pixel position of the boundary at gesture start
  private _dragPairSize = 0; // pixel size of the pair at gesture start
  private _dragGroupSize = 0; // pixel size of the entire sibling group at gesture start

  // GestureContext: layout accessor (icicle-specific — rectilinear layout).
  layout() { return this._layout!.value; }

  // --- Hook: chart-specific rendering ---

  protected _setupRendering(): void {
    const { w: Wc, h: Hc } = this._hostSize!;

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
        target: (g: any) => g.store.hover.value ?? g.store.focus.value,
        valueOf: (g: any) => this.valueOf,
        writeValue: this.writeValue,
        siblings: (g: any) => this.siblings,
        frozenOrder: () => this._frozenOrder.value,
        windowGetter: () => this._window?.value ?? null,
        frozenOrderCell: this._frozenOrder,
        deferSort: () => this.config.sort !== "index",
        focusTile: (id) => this.setFocus(id),
      }),
      tileBodyReorder({
        target: (g: any) => g.store.hover.value ?? g.store.focus.value,
        treeRoot: (g: any) => this._treeRoot.value,
        layout: (g: any) => this._layout!.value,
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

