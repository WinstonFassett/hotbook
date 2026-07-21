// gestures.ts — edge handle drag for hierarchical charts (icicle, sunburst).
// Uses bireactive's `draggable` for pointer capture. The local coordinate
// from draggable is already in SVG root coordinates (handle has no transform).
// The chart implements GestureContext with start/update/end hooks.
//
// GestureContext is generic on the layout type (LayoutRect for icicle,
// RadialRect for sunburst) so both charts can share the same drag attachment.

import { draggable } from "bireactive";
import type { ChartConfig, LayoutRect, RadialRect } from "./types";
import type { Edge, ChartNode } from "./hierarchy";
import type { ConservationMode } from "./behaviors/keyboard-edit";

export interface GestureContext<L = LayoutRect> {
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
  startGesture(edge: Edge): void;
  updateGesture(edge: Edge, point: { x: number; y: number }): void;
  endGesture(edge: Edge): void;
}

export function attachEdgeHandleDrag(handle: any, ctx: GestureContext<any>): () => void {
  const edge: Edge = handle._edge;
  if (!edge) return () => {};

  return draggable(handle, (local) => {
    ctx.updateGesture(edge, { x: local.x, y: local.y });
  }, (active) => {
    if (active) ctx.startGesture(edge);
    else ctx.endGesture(edge);
  });
}
