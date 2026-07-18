// sunburst-chart.ts — custom element rendering a hierarchical sunburst.
// Mirrors icicle-chart.ts structure: extends HierarchicalChartBase, uses
// the same derive-layout → forEach → direct-layout-reads pattern. The only
// differences are radial geometry (computeRadialLayout, makeArc,
// makeAngularHandle) and no orientation config. Shared behaviors
// (wheelEdit, keyboardEdit, transitionOnUpdated, previewFullRender) are
// composed identically to the icicle.

import { derive, forEach, group, Vec, type Cell } from "bireactive";
import type { ChartConfig, RadialRect, RenderNode } from "./types";
import { Kernel } from "./kernel";
import { Gesture, setup, type Behavior } from "./gesture";
import {
  type ChartNode,
  type Edge,
  findNode,
  buildEdges,
  snapshotValues,
} from "./tree";
import {
  computeRadialLayout,
  buildAllDescendantsRadial,
  makeArc,
  makeAngularHandle,
  settleArcCells,
  type ArcCellsMap,
} from "./radial-geometry";
import {
  attachEdgeHandleDrag,
  type GestureContext,
} from "./gestures";
import { wheelEdit } from "./behaviors/wheel-edit";
import { keyboardEdit } from "./behaviors/keyboard-edit";
import { tileBodyDrag } from "./behaviors/tile-body-drag";
import { transitionOnUpdated } from "./behaviors/transition-on-updated";
import { previewFullRender, captureOrderFromWindow } from "./behaviors/preview-full-render";
import { membershipCell } from "./behaviors/mark-lifecycle";
import { HierarchicalChartBase } from "./hierarchical-chart-base";

export class SunburstChart extends HierarchicalChartBase implements GestureContext<RadialRect> {
  static tag = "v-sunburst";

  private _window?: Cell<RenderNode[]>;
  private _layout?: Cell<Map<string, RadialRect>>;
  private _edges?: Cell<Edge[]>;

  // Drag state for angular edge handle (two-sibling reapportion).
  private _dragBoundaryAngle = 0;
  private _dragPairSpan = 0;

  // GestureContext: layout accessor (radial layout).
  layout() { return this._layout!.value; }

  // --- Hook: chart-specific rendering (mirrors icicle _setupRendering) ---

  protected _setupRendering(): void {
    const { w: Wc, h: Hc } = this._hostSize!;

    // Center of the sunburst — reactive to host size.
    const center = Vec.derive(() => ({ x: Wc.value / 2, y: Hc.value / 2 }));

    // All descendants of the logical root (drill focus or tree root).
    // Sunburst discards ancestors (unlike icicle) — sunburst.md §2.
    const allNodes = derive(() => {
      const root = this._treeRoot.value;
      const frozen = this._frozenOrder.value;
      const config = this._configCell.value;
      const drill = this._drillId.value;
      this._reorderTick.value;
      if (!root || !config) return [];
      return buildAllDescendantsRadial(root, config, frozen ?? undefined, drill);
    });
    this._window = allNodes;

    // Radial layout — direct reactive derive, same pattern as icicle's
    // computeLayout. The drill transform is built into computeRadialLayout
    // (angular scaling + radial shift), same as the icicle's computeLayout.
    this._layout = derive(() => {
      const root = this._treeRoot.value;
      const frozen = this._frozenOrder.value;
      const config = this._configCell.value;
      const drill = this._drillId.value;
      this._reorderTick.value;
      if (!root || !config) return new Map<string, RadialRect>();
      return computeRadialLayout(root, config, frozen ?? undefined, Wc.value, Hc.value, drill);
    });

    // Present-filtered subset for membership.
    const presentNodes = derive(() => allNodes.value.filter((n) => n.present));
    this._edges = derive(() => buildEdges(allNodes.value));
    const membership = membershipCell(presentNodes, (n) => n.id);

    const tilesLayer = group();
    const edgesLayer = group();
    this._rootShape!.add(tilesLayer, edgesLayer);

    // Per-arc cells map — shared between makeArc (writer) and
    // makeAngularHandle (reader) so handles stay in sync with arcs.
    const arcCellsMap: ArcCellsMap = new Map();

    // Arcs: forEach over ALL descendants. Keyed by id → stable DOM.
    // makeArc creates per-arc num() cells, effect writes layout targets,
    // annularSector reads from cells (spec §5).
    const tilesResult = forEach(tilesLayer, allNodes, (node) =>
      makeArc(node, this._layout!, center, arcCellsMap, this, derive(() => membership.value.has(node.id)), this._defs),
      { key: (node) => node.id },
    );

    // Angular handles: forEach over ALL adjacent sibling pairs.
    // makeAngularHandle reads from per-arc cells (same source as arcs).
    const edgesResult = forEach(edgesLayer, this._edges, (edge) => {
      const handle = makeAngularHandle(
        edge,
        arcCellsMap,
        center,
        derive(() => membership.value.has(edge.leftId) && membership.value.has(edge.rightId)),
      );
      const off = attachEdgeHandleDrag(handle, this);
      handle.track(off);
      return handle;
    }, { key: (edge) => edge.id });

    // Chart-level settle effect: writes layout targets to per-arc cells.
    // Created OUTSIDE forEach's untracked context so it properly subscribes
    // to the layout cell. Snap mode for now (spec §5 tween wired later).
    const settleDispose = settleArcCells(this._layout!, arcCellsMap);

    this._setupDisposers.push(() => {
      settleDispose();
      tilesResult.dispose();
      edgesResult.dispose();
      tilesLayer.dispose();
      edgesLayer.dispose();
    });
  }

  // --- Hook: chart-specific behavior composition (mirrors icicle _build) ---

  protected _composeBehaviors(): void {
    const config = this._configCell.value!;
    const gesture = this._gesture!;

    // Tile-body drag behavior: resize only for now. Reorder needs angular
    // slot computation (pointer → angle → slot) — a follow-up.
    const dragBehavior = config.dragBehavior
      ?? (config.sort === "index" ? "reorder" : "resize");
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
    }
    // TODO: arc-body-reorder with angular slot computation.

    this._behaviorDispose = setup(gesture)(
      // Sunburst: transition opacity on paths (enter/exit fade) + transform
      // on text (label movement). Path `d` can't CSS-transition (large-arc-flag
      // flips mid-tween), so geometry settles via per-arc tween cells (spec §5).
      transitionOnUpdated({
        attrs: ["opacity"],
        selector: "v-sunburst",
        elements: "path, text",
      }),
      previewFullRender({
        deferSort: () => this.config.sort !== "index",
        frozenOrder: this._frozenOrder,
        captureOrder: () => captureOrderFromWindow(this._window?.value ?? null),
      }),
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

  // --- GestureContext: angular edge handle drag lifecycle ---
  // Mirrors icicle's startGesture/updateGesture/endGesture, adapted for
  // angular geometry (pointer → angle → value delta).

  startGesture(edge: Edge) {
    const root = this._treeRoot.value!;
    const g = this._gesture!;
    g.store.activeEdge = edge;
    g.store.snapshot = snapshotValues(root);

    const left = findNode(root, edge.leftId)!;
    const right = findNode(root, edge.rightId)!;
    this.setPairTotal(left.value.value + right.value.value);

    // Capture boundary angle and pair angular span at gesture start.
    const layout = this._layout!.value;
    const lr = layout.get(edge.leftId)!;
    const rr = layout.get(edge.rightId)!;
    this._dragBoundaryAngle = lr.a1;
    this._dragPairSpan = (lr.a1 - lr.a0) + (rr.a1 - rr.a0);

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

    this.restore();

    const root = this._treeRoot.value!;
    const left = findNode(root, edge.leftId)!;

    // Convert pointer to angle relative to the SVG center.
    // The SVG center = half the host size (set in _setupRendering).
    const { w: Wc, h: Hc } = this._hostSize!;
    const cx = Wc.value / 2;
    const cy = Hc.value / 2;
    const ang = Math.atan2(point.y - cy, point.x - cx);
    const normAng = ang < 0 ? ang + TWO_PI : ang;

    // Angular delta from the boundary angle.
    const deltaAng = normAng - this._dragBoundaryAngle;
    // Shortest angular delta (handle wraparound).
    const wrappedDelta = ((deltaAng + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;

    // Convert angular delta to value delta.
    const valueScale = this._dragPairSpan > 0 ? this.pairTotal / this._dragPairSpan : 0;
    const deltaValue = wrappedDelta * valueScale;

    const snapLeft = this.snapshot?.get(edge.leftId) ?? left.value.value;
    const snapRight = this.snapshot?.get(edge.rightId) ?? this.pairTotal - snapLeft;
    const cappedDelta = deltaValue > 0
      ? Math.min(deltaValue, snapRight)
      : Math.max(deltaValue, -snapLeft);
    this.writeValue(edge.leftId, snapLeft + cappedDelta);
    this.writeValue(edge.rightId, snapRight - cappedDelta);

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

const TWO_PI = Math.PI * 2;

