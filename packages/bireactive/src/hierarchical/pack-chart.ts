// pack-chart.ts — circle-packing chart using d3-hierarchy pack layout.
// Extends HierarchicalChartBase with all-descendants rendering:
// the rendered set is all descendants of the focus node (drilled subtree).
// Drill = re-run pack on the focused subtree, sized to the full canvas.
// No edge handles — resize via body drag (like treemap leaf tiles).

import { cell, derive, forEach, group, type Cell } from "bireactive";
import type { PackRect, RenderNode } from "./types";
import { type Behavior } from "./gesture";
import { buildAllDescendants, type Edge } from "./hierarchy";
import { computePackLayout, makeCircle } from "./pack-geometry";
import type { GestureContext } from "./gestures";
import { tileBodyDrag } from "./behaviors/tile-body-drag";
import { tileBodyReorder } from "./behaviors/tile-body-reorder";
import { membershipCell } from "./behaviors/mark-lifecycle";
import { HierarchicalChartBase } from "./hierarchical-chart-base";

export class PackChart extends HierarchicalChartBase implements GestureContext<PackRect> {
  static tag = "v-pack";

  private _window?: Cell<RenderNode[]>;
  private _layout?: Cell<Map<string, PackRect>>;

  // GestureContext: layout accessor.
  layout() {
    return this._layout!.value;
  }

  // --- Hook: chart-specific rendering ---

  protected _setupRendering(): void {
    // Rendered set: ALL descendants of the focus node (excluding the focus
    // node itself — it is the invisible container). When not drilled,
    // focus = root, so we render root's descendants (not root).
    const allNodes = this._deriveWindow(
      (root, config, frozen, drill) => buildAllDescendants(root, config, frozen, drill),
      [] as RenderNode[],
    );
    this._window = allNodes;

    // Pack layout: d3-pack on the focus subtree.
    this._layout = this._deriveLayout(
      (root, config, frozen, w, h, drill) => computePackLayout(root, config, frozen, w, h, drill),
      new Map<string, PackRect>(),
    );

    // Present-filtered subset for membership.
    const presentNodes = derive(() => allNodes.value.filter((n) => n.present));
    const membership = membershipCell(presentNodes, (n) => n.id);

    const tilesLayer = group();
    this._rootShape!.add(tilesLayer);

    // Circles: forEach over ALL descendants. Keyed by id → stable DOM.
    const tilesResult = forEach(
      tilesLayer,
      allNodes,
      (node) =>
        makeCircle(
          node,
          this._layout!,
          this,
          derive(() => membership.value.has(node.id)),
          this._defs,
        ),
      { key: (node) => node.id },
    );

    this._setupDisposers.push(() => {
      tilesResult.dispose();
      tilesLayer.dispose();
    });
  }

  // Pack circles have no linear order — always resize, never reorder.
  protected _selectDragBehaviors(
    resizeBehavior: Behavior,
    _reorderBehavior: Behavior,
  ): Behavior[] {
    return [resizeBehavior];
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
        mode: () => "additive",
        axis: "x",
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

    // Pack: transition opacity on circles (enter/exit fade).
    // No CSS transition on cx/cy/r — pack positions change on every layout
    // re-derivation, and CSS transitions would chase the layout derive.
    this._behaviorDispose = this._composeStandardBehaviors(dragBehaviors, {
      attrs: ["opacity"],
      selector: this.tagName.toLowerCase(),
      elements: "circle, text",
    });
  }

  // --- GestureContext: no edge handles (pack has no handles) ---

  startGesture(_edge: Edge) {
    // Pack has no edge handles; this is a no-op.
  }

  updateGesture(_edge: Edge, _point: { x: number; y: number }) {
    // Pack has no edge handles; this is a no-op.
  }

  endGesture(_edge: Edge) {
    // Pack has no edge handles; this is a no-op.
  }
}
