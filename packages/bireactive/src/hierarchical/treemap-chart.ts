// treemap-chart.ts — hierarchical squarified treemap using bireactive shapes.
// Extends HierarchicalChartBase with squarified-treemap geometry (rectilinear
// tiles, no edge handles), treemap-specific behavior composition, and the
// tile-body drag gesture for additive resize-only (no reorder).

import { cell, derive, forEach, group, type Cell } from "bireactive";
import type { LayoutRect, RenderNode } from "./types";
import { setup, type Behavior } from "./gesture";
import {
  buildAllDescendants,
  type Edge,
} from "./hierarchy";
import { computeTreemapLayout, makeTreemapTile } from "./treemap-geometry";
import type { GestureContext } from "./gestures";
import { wheelEdit } from "./behaviors/wheel-edit";
import { keyboardEdit } from "./behaviors/keyboard-edit";
import { tileBodyDrag } from "./behaviors/tile-body-drag";
import { tileBodyReorder } from "./behaviors/tile-body-reorder";
import { transitionOnUpdated } from "./behaviors/transition-on-updated";
import { previewFullRender, captureOrderFromWindow } from "./behaviors/preview-full-render";
import { membershipCell } from "./behaviors/mark-lifecycle";
import { HierarchicalChartBase } from "./hierarchical-chart-base";

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
    const { w: Wc, h: Hc } = this._hostSize!;

    const allNodes = derive(() => {
      const root = this._treeRoot.value;
      const frozen = this._frozenOrder.value;
      const config = this._configCell.value;
      const drill = this._drillId.value;
      this._reorderTick.value; // re-derive on reorder mutations
      if (!root || !config) return [];
      return buildAllDescendants(root, config, frozen ?? undefined, drill);
    });
    this._window = allNodes;

    // Treemap draft mechanism (spec §5, scale-against-frozen-siblings):
    // during an own edit-draft, every tile keeps its gesture-start rect
    // (frozen) EXCEPT the edited tile, whose rect area-scales in place with
    // its live value (area ∝ value ⇒ each side scales by sqrt(v/v0), anchored
    // at the rect center). The full squarify relayout is deferred to
    // commit/cancel, where the gesture-active class is gone and CSS
    // transitions animate frozen → live.
    const liveLayout = derive(() => {
      const root = this._treeRoot.value;
      const frozen = this._frozenOrder.value;
      const config = this._configCell.value;
      const drill = this._drillId.value;
      this._reorderTick.value; // re-derive on reorder mutations
      if (!root || !config) return new Map<string, LayoutRect>();
      return computeTreemapLayout(root, config, frozen ?? undefined, Wc.value, Hc.value, drill);
    });
    this._liveLayout = liveLayout;

    this._layout = derive(() => {
      const frozenLayout = this._frozenLayout.value;
      const draftId = this._draftId.value;
      if (!frozenLayout || !draftId) return liveLayout.value;

      const map = new Map(frozenLayout);
      const r0 = frozenLayout.get(draftId);
      const v0 = this._gesture?.store.snapshot?.get(draftId);
      const v = this.valueOf(draftId); // reactive: reads the node's value cell
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

    // Tiles: forEach over ALL descendants. Keyed by id → stable DOM across
    // depth/sort/drill changes. No mount/unmount, no exit delay.
    const tilesResult = forEach(
      tilesLayer,
      allNodes,
      (node) =>
        makeTreemapTile(
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

  // --- Hook: chart-specific behavior composition ---

  protected _composeBehaviors(): void {
    const config = this._configCell.value!;
    const gesture = this._gesture!;

    // Treemap drag behavior: resize or reorder, per config.
    // dragBehavior auto-derives from sort: sort=index → reorder (if canReorder),
    // else → resize.
    const dragBehavior = config.dragBehavior ?? (config.sort === "index" ? "reorder" : "resize");
    const dragBehaviors: Behavior[] = [];

    if (dragBehavior === "resize") {
      dragBehaviors.push(
        tileBodyDrag({
          target: (g) => g.store.hover.value ?? g.store.focus.value,
          valueOf: (g) => this.valueOf,
          writeValue: this.writeValue,
          siblings: (g) => this.siblings,
          frozenOrder: () => this._frozenOrder.value,
          windowGetter: () => this._window?.value ?? null,
          frozenOrderCell: this._frozenOrder,
          deferSort: () => this.config.sort !== "index",
          focusTile: (id) => this.setFocus(id),
          // Spec §3: treemap drag-mark-resize is ADDITIVE (only the dragged
          // tile changes) and scrubs HORIZONTALLY (right = +).
          mode: () => "additive",
          axis: "x",
        }),
      );
    } else if (dragBehavior === "reorder") {
      dragBehaviors.push(
        tileBodyReorder({
          target: (g) => g.store.hover.value ?? g.store.focus.value,
          treeRoot: (g) => this._treeRoot.value,
          layout: (g) => this._layout!.value,
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
    }

    // Cursor affordance (legacy WIN-260): ew-resize signals the horizontal
    // drag-to-resize; reorder mode gets grab cursors from the chrome CSS.
    this.style.cursor = dragBehavior === "resize" ? "ew-resize" : "";

    this._behaviorDispose = setup(gesture)(
      // Render behaviors.
      // Settle CSS on commit/cancel/updated.
      transitionOnUpdated(),
      // Draft freeze (spec §5): capture the layout at edit-draft start and
      // track the edited node; the hybrid _layout derive holds siblings at
      // their frozen rects while only the edited tile scales.
      (g) =>
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
        }),
      // Freeze sibling order during own gestures when sort !== 'index'.
      previewFullRender({
        deferSort: () => this.config.sort !== "index",
        frozenOrder: this._frozenOrder,
        captureOrder: () => captureOrderFromWindow(this._window?.value ?? null),
      }),
      // Input behaviors.
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
