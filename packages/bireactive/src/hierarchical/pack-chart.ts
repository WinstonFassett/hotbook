// pack-chart.ts — circle-packing chart using d3-hierarchy pack layout.
// Extends HierarchicalChartBase with all-descendants rendering:
// the rendered set is all descendants of the focus node (drilled subtree).
// Drill = re-run pack on the focused subtree, sized to the full canvas.
// No edge handles — resize via body drag (like treemap leaf tiles).

import { cell, derive, forEach, group, type Cell } from "bireactive";
import type { PackRect, RenderNode } from "./types";
import { type Behavior, type Gesture, noopBehavior } from "./gesture";
import { buildAllDescendants } from "./hierarchy";
import { computePackLayout, makeCircle } from "./pack-geometry";
import type { ChartAccessors } from "./gestures";
import { tileBodyDrag } from "./behaviors/tile-body-drag";
import { membershipCell } from "./behaviors/mark-lifecycle";
import { HierarchicalChartBase } from "./hierarchical-chart-base";

export class PackChart extends HierarchicalChartBase implements ChartAccessors<PackRect> {
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
    // Pack circles have no linear order — resize only, never reorder.
    // _selectDragBehaviors' "reorder" branch is never selected for pack (no
    // sort="index" reorder path applies to circles), so the reorder slot is
    // a placeholder that's never installed.
    const resizeBehavior = tileBodyDrag({ ...this._tileBodyDragDefaults(), mode: () => "additive", axis: "x" });
    const dragBehaviors = this._selectDragBehaviors(resizeBehavior, noopBehavior);
    this._behaviorDispose = this._composeStandardBehaviors(dragBehaviors, this._transitionOpts());
  }

  // Pack: transition opacity on circles (enter/exit fade).
  // No CSS transition on cx/cy/r — pack positions change on every layout
  // re-derivation, and CSS transitions would chase the layout derive.
  protected _transitionOpts() {
    return {
      attrs: ["opacity"] as const,
      selector: this.tagName.toLowerCase(),
      elements: "circle, text",
    };
  }

}
