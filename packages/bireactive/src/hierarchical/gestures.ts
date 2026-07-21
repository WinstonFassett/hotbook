// gestures.ts — edge handle drag for hierarchical charts (icicle, sunburst).
// Uses bireactive's `draggable` for pointer capture. The local coordinate
// from draggable is already in SVG root coordinates (handle has no transform).
// The chart implements EdgeDragHandler with start/update/end hooks.
//
// EdgeDragHandler is generic on the layout type (LayoutRect for icicle,
// RadialRect for sunburst) so both charts can share the same drag attachment.
// Charts without edge handles (treemap, pack) implement only ChartAccessors.

import { draggable } from "bireactive";
import type { ChartConfig, LayoutRect, RadialRect } from "./types";
import type { Edge, ChartNode } from "./hierarchy";
import type { ConservationMode } from "./behaviors/keyboard-edit";

/** Chart accessors shared by all hierarchical charts (edge-handle and
 *  body-drag alike). Provided by HierarchicalChartBase; charts without edge
 *  handles implement only this. */
export interface ChartAccessors<L = LayoutRect> {
  config: ChartConfig;
  conservationMode: ConservationMode;
  altHeld: () => boolean;
  snapshot: Map<string, number> | null;
  treeRoot: () => ChartNode | null;
  layout: () => Map<string, L>;
  valueOf: (id: string) => number;
  writeValue: (id: string, value: number) => void;
  siblings: (id: string) => string[];
  restore: () => void;
  pairTotal: number;
  setPairTotal: (n: number) => void;
}

/** Edge-handle drag lifecycle — only charts with edge handles (icicle,
 *  sunburst) implement this. Extends ChartAccessors with the start/update/
 *  end hooks that attachEdgeHandleDrag calls. */
export interface EdgeDragHandler<L = LayoutRect> extends ChartAccessors<L> {
  startGesture(edge: Edge): void;
  updateGesture(edge: Edge, point: { x: number; y: number }): void;
  endGesture(edge: Edge): void;
}

/** Legacy alias — prefer ChartAccessors / EdgeDragHandler. Kept for
 *  compatibility with code that references GestureContext generically. */
export type GestureContext<L = LayoutRect> = EdgeDragHandler<L>;

export function attachEdgeHandleDrag(handle: any, ctx: EdgeDragHandler<any>, activeCursor?: string): () => void {
  const edge: Edge = handle._edge;
  if (!edge) return () => {};

  return draggable(handle, (local) => {
    ctx.updateGesture(edge, { x: local.x, y: local.y });
  }, (active) => {
    if (active) {
      ctx.startGesture(edge);
      if (activeCursor) handle.el.style.cursor = activeCursor;
    } else {
      ctx.endGesture(edge);
      if (activeCursor) handle.el.style.cursor = "";
    }
  });
}
