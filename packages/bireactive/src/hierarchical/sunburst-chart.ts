// sunburst-chart.ts — custom element rendering a hierarchical sunburst.
// Mirrors icicle-chart.ts structure: extends HierarchicalChartBase, uses
// the same derive-layout → forEach → direct-layout-reads pattern. The only
// differences are radial geometry (computeRadialLayout, makeArc,
// makeAngularHandle) and no orientation config. Shared behaviors
// (wheelEdit, keyboardEdit, transitionOnUpdated, previewFullRender) are
// composed identically to the icicle.

import { circle, derive, effect, forEach, group, readNow, type Cell } from "bireactive";
import type { ChartConfig, RadialRect, RenderNode } from "./types";
import { Kernel } from "./kernel";
import { Gesture, type Behavior } from "./gesture";
import {
  type ChartNode,
  type Edge,
  findNode,
  buildEdges,
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
  type EdgeDragHandler,
} from "./gestures";
import { tileBodyDrag } from "./behaviors/tile-body-drag";
import { arcBodyReorder } from "./behaviors/arc-body-reorder";
import { membershipCell, withExitDelay } from "./behaviors/mark-lifecycle";
import { HierarchicalChartBase } from "./hierarchical-chart-base";

export class SunburstChart extends HierarchicalChartBase implements EdgeDragHandler<RadialRect> {
  static tag = "v-sunburst";

  protected declare _window: Cell<RenderNode[]> | undefined;
  protected declare _layout: Cell<Map<string, RadialRect>> | undefined;
  private _edges?: Cell<Edge[]>;

  // Drag state for angular edge handle (two-sibling reapportion).
  private _dragBoundaryAngle = 0;
  private _dragPairSpan = 0;

  // GestureContext: layout accessor (radial layout).
  layout() { return this._layout!.value; }

  // --- Hook: chart-specific rendering (mirrors icicle _setupRendering) ---

  protected _setupRendering(): void {
    // Center of the sunburst — reactive to host size (shared from base).
    const center = this._center!;

    // All descendants of the logical root (drill focus or tree root).
    // Sunburst discards ancestors (unlike icicle) — sunburst.md §2.
    const allNodes = this._deriveWindow(
      (root, config, frozen, drill) => buildAllDescendantsRadial(root, config, frozen, drill),
      [] as RenderNode[],
    );
    this._window = allNodes;

    // Radial layout — direct reactive derive, same pattern as icicle's
    // computeLayout. The drill transform is built into computeRadialLayout
    // (angular scaling + radial shift), same as the icicle's computeLayout.
    this._layout = this._deriveLayout(
      (root, config, frozen, w, h, drill) => computeRadialLayout(root, config, frozen, w, h, drill),
      new Map<string, RadialRect>(),
    );

    // Present-filtered subset for membership. Membership is computed from the
    // FRESH node list, while the forEach below renders the exit-DELAYED list:
    // a node dropped on drill stays mounted for the exit window with
    // membership=false, so it freezes geometry (makeArc) and fades out in
    // place (spec §5 exit freeze) before its DOM is disposed.
    const presentNodes = derive(() => allNodes.value.filter((n) => n.present));
    this._edges = derive(() => buildEdges(allNodes.value));
    const membership = membershipCell(presentNodes, (n) => n.id);
    // exitFade (config): when true, exiting arcs linger and fade out. When
    // false, arcs are evicted immediately (same as icicle/treemap/pack).
    // Default: true for sunburst (radial — items fade in place on level
    // changes rather than moving off-screen).
    const exitFade = this._configCell.value?.exitFade ?? true;
    const renderedNodes = exitFade
      ? withExitDelay(allNodes, { key: (n: RenderNode) => n.id })
      : allNodes;

    const tilesLayer = group();
    const edgesLayer = group();
    this._rootShape!.add(tilesLayer, edgesLayer);

    // Background disc: fills the center with the logical root's color so the
    // center is never transparent during drill transitions. Without this, the
    // old root arc fades out (withExitDelay) while the new root slides in,
    // leaving the center transparent → black SVG background shows through.
    // The disc sits behind all arcs (added first = painted first in SVG).
    // It reads the root's rOut from the layout so it matches the root band.
    const bgDisc = circle(
      { x: derive(() => center.x.value), y: derive(() => center.y.value) },
      derive(() => {
        // Root is the first node in allNodes (logical root). Its rOut is the
        // innermost band's outer radius.
        const root = allNodes.value[0];
        if (!root) return 0;
        const r = this._layout!.value.get(root.id);
        return r?.rOut ?? 0;
      }),
      {
        fill: derive(() => {
          const root = allNodes.value[0];
          return root?.color ?? "#1a1d24";
        }),
        stroke: "none",
      },
    );
    bgDisc.el.style.pointerEvents = "none";
    tilesLayer.add(bgDisc);

    // Per-arc cells map — shared between makeArc (writer) and
    // makeAngularHandle (reader) so handles stay in sync with arcs.
    const arcCellsMap: ArcCellsMap = new Map();

    // Arcs: forEach over ALL descendants. Keyed by id → stable DOM.
    // makeArc creates per-arc num() cells, effect writes layout targets,
    // annularSector reads from cells (spec §5).
    // `withExitDelay` returns `Read<readonly RenderNode[]>`, which satisfies
    // forEach's `Val<readonly T[]>` source — no cast needed.
    const tilesResult = forEach(tilesLayer, renderedNodes, (node) =>
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
        this._layout!,
      );
      const off = attachEdgeHandleDrag(handle, this, "grabbing");
      handle.track(off);
      return handle;
    }, { key: (edge) => edge.id });

    // Chart-level settle effect: writes layout targets to per-arc cells.
    // Created OUTSIDE forEach's untracked context so it properly subscribes
    // to the layout cell. Spec §5: snap during draft (gesture-active), tween
    // on commit/cancel/updated. Interruptible: new layout changes cancel
    // in-flight tweens and restart from current cell values.
    // isDrafting is a live getter: _gesture is assigned in _build(), which
    // runs after _setupRendering — capturing it by value here would pin it
    // to null forever (the exact bug that broke the snap-during-draft
    // contract in the first pass of this port).
    const settleDispose = settleArcCells(
      this._layout!,
      arcCellsMap,
      () => this._gesture?.state === "Drafting",
    );

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
    const dragBehaviors = this._selectDragBehaviors(
      tileBodyDrag(this._tileBodyDragDefaults()),
      arcBodyReorder({
        target: (g: Gesture) => g.store.hover.value ?? g.store.focus.value,
        treeRoot: (g: Gesture) => this._treeRoot.value,
        layout: (g: Gesture) => this._layout!.value,
        centerX: (_g: Gesture) => this._center!.value.x,
        centerY: (_g: Gesture) => this._center!.value.y,
        focusArc: (id) => this.setFocus(id),
        writeReorder: (parentId, orderedIds) => this._writeReorder(parentId, orderedIds),
        bumpReorder: () => this.bumpReorder(),
        frozenOrderCell: this._frozenOrder,
      }),
    );
    this._behaviorDispose = this._composeStandardBehaviors(dragBehaviors, this._transitionOpts());
  }

  // Sunburst: transition opacity on paths (enter/exit fade) + transform
  // on text (label movement). Path `d` can't CSS-transition (large-arc-flag
  // flips mid-tween), so geometry settles via per-arc tween cells (spec §5).
  protected _transitionOpts() {
    return {
      attrs: ["opacity"] as const,
      selector: this.tagName.toLowerCase(),
      elements: "g[data-id], text",
    };
  }

  // --- GestureContext: angular edge handle drag lifecycle ---
  // Mirrors icicle's startGesture/updateGesture/endGesture, adapted for
  // angular geometry (pointer → angle → value delta).

  startGesture(edge: Edge) {
    this._startGestureCommon(edge);

    // Capture boundary angle and pair angular span at gesture start.
    const layout = this._layout!.value;
    const lr = layout.get(edge.leftId)!;
    const rr = layout.get(edge.rightId)!;
    this._dragBoundaryAngle = lr.a1;
    this._dragPairSpan = (lr.a1 - lr.a0) + (rr.a1 - rr.a0);
  }

  updateGesture(edge: Edge, point: { x: number; y: number }) {
    const g = this._gesture!;
    if (g.state !== "Drafting") return;

    this.restore();

    const root = this._treeRoot.value!;
    const left = findNode(root, edge.leftId)!;

    // Convert pointer to angle relative to the SVG center.
    // The SVG center = half the host size (shared _center cell from base).
    const c = this._center!.value;
    const cx = c.x;
    const cy = c.y;
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
    this._endGestureCommon();
  }
}

const TWO_PI = Math.PI * 2;

