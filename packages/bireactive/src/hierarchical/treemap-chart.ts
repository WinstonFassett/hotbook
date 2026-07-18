// treemap-chart.ts — zoomable treemap using d3-hierarchy squarify layout.
// Extends HierarchicalChartBase with one-level-at-a-time rendering:
// the rendered set is focus.children (NOT all descendants). Root is never
// a tile. Drill = click a group tile → it becomes the new focus.
// Spec: wiki/specs/treemap.md

import { cell, derive, forEach, group, type Cell } from "bireactive";
import type { LayoutRect, RenderNode } from "./types";
import { type Behavior, type Gesture } from "./gesture";
import { buildAllDescendants, type Edge } from "./hierarchy";
import { computeTreemapLayout, makeTreemapTile } from "./treemap-geometry";
import type { GestureContext } from "./gestures";
import { tileBodyDrag } from "./behaviors/tile-body-drag";
import { tileBodyReorder } from "./behaviors/tile-body-reorder";
import { membershipCell } from "./behaviors/mark-lifecycle";
import { HierarchicalChartBase } from "./hierarchical-chart-base";
import { findNode, sortedChildren, type ChartNode } from "./tree";

export class TreemapChart extends HierarchicalChartBase implements GestureContext<LayoutRect> {
  static tag = "v-treemap";

  private _window?: Cell<RenderNode[]>;
  private _layout?: Cell<Map<string, LayoutRect>>;
  private _liveLayout?: Cell<Map<string, LayoutRect>>;
  /** Layout snapshot captured at edit-gesture start (spec §5 draft freeze). */
  private _frozenLayout = cell<Map<string, LayoutRect> | null>(null);
  /** Node id being edited by the current own edit-draft, or null. */
  private _draftId = cell<string | null>(null);

  // GestureContext: layout accessor (treemap — rectilinear layout, no handles).
  layout() {
    return this._layout!.value;
  }

  // --- Hook: chart-specific rendering ---

  protected _setupRendering(): void {
    // Rendered set: ALL descendants of the focus node (excluding the focus
    // node itself — it is the invisible container). This is the classic
    // nested treemap: groups contain their children, recursively.
    // When not drilled, focus = root, so we render root's descendants (not root).
    const allNodes = this._deriveWindow(
      (root, config, frozen, drill) => buildAllDescendants(root, config, frozen, drill),
      [] as RenderNode[],
    );
    this._window = allNodes;

    // Live layout: d3 squarify on focus.children.
    const liveLayout = this._deriveLayout(
      (root, config, frozen, w, h, drill) => computeTreemapLayout(root, config, frozen, w, h, drill),
      new Map<string, LayoutRect>(),
    );
    this._liveLayout = liveLayout;

    // Draft mechanism (spec §5): during an own edit-draft, freeze siblings
    // and scale only the edited tile in place (area ∝ value).
    this._layout = derive(() => {
      const frozenLayout = this._frozenLayout.value;
      const draftId = this._draftId.value;
      if (!frozenLayout || !draftId) return liveLayout.value;

      const map = new Map(frozenLayout);
      const r0 = frozenLayout.get(draftId);
      const v0 = this._gesture?.store.snapshot?.get(draftId);
      const v = this.valueOf(draftId);
      if (r0 && v0 && v0 > 0 && v >= 0) {
        const s = Math.sqrt(v / v0);
        const w = r0.width * s;
        const h = r0.height * s;
        map.set(draftId, {
          x: r0.x + (r0.width - w) / 2,
          y: r0.y + (r0.height - h) / 2,
          width: w,
          height: h,
        });
      }
      return map;
    });

    // Present-filtered subset for membership (per-tile visibility).
    const presentNodes = derive(() => allNodes.value.filter((n) => n.present));
    const membership = membershipCell(presentNodes, (n) => n.id);

    const tilesLayer = group();
    this._rootShape!.add(tilesLayer);

    // Tiles: forEach over ALL descendants. Keyed by id → stable DOM.
    const tilesResult = forEach(
      tilesLayer,
      allNodes,
      (node) =>
        makeTreemapTile(
          node,
          this._layout!,
          this, // chart (has setHover, setFocus, drill, focusCell, hoverCell)
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

  // --- Hook: chart-specific behavior composition ---

  protected _composeBehaviors(): void {
    const dragBehaviors = this._selectDragBehaviors(
      tileBodyDrag({
        target: (g: Gesture) => g.store.hover.value ?? g.store.focus.value,
        valueOf: (g: Gesture) => this.valueOf,
        writeValue: this.writeValue,
        siblings: (g: Gesture) => this.siblings,
        frozenOrder: () => this._frozenOrder.value,
        windowGetter: () => this._window?.value ?? null,
        frozenOrderCell: this._frozenOrder,
        deferSort: () => this.config.sort !== "index",
        focusTile: (id) => this.setFocus(id),
        mode: () => "additive",
        axis: "x",
      }),
      tileBodyReorder({
        target: (g: Gesture) => g.store.hover.value ?? g.store.focus.value,
        treeRoot: (g: Gesture) => this._treeRoot.value,
        layout: (g: Gesture) => this._layout!.value,
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

    // Treemap-specific: freeze sibling layout during own edit-drafts so
    // only the edited tile scales in place (spec §5 draft freeze).
    const draftFreeze: Behavior = (g: Gesture) =>
      g.editor.subscribe((t) => {
        if (t.type === "draft" && t.draft?.intent === "edit") {
          if (!this._frozenLayout.value) {
            this._frozenLayout.value = new Map(this._liveLayout!.value);
          }
          this._draftId.value = t.draft.nodeId;
        } else if (t.type === "commit" || t.type === "cancel") {
          this._frozenLayout.value = null;
          this._draftId.value = null;
        }
      });

    this._behaviorDispose = this._composeStandardBehaviors(dragBehaviors, undefined, [draftFreeze]);
  }

  // --- GestureContext: minimal stubs (treemap has no edge handles) ---

  startGesture(_edge: Edge) {
    // Treemap has no edge handles; this is a no-op.
  }

  updateGesture(_edge: Edge, _point: { x: number; y: number }) {
    // Treemap has no edge handles; this is a no-op.
  }

  endGesture(_edge: Edge) {
    // Treemap has no edge handles; this is a no-op.
  }
}
