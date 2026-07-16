// gestures.ts — input-to-intent bridges for the icicle chart.
// The chart provides a context with hooks for start/drag/end/cancel.

import { draggable } from "bireactive";
import type { ChartConfig, LayoutRect } from "./types";
import type { Edge } from "./hierarchy";

export interface GestureContext {
  config: ChartConfig;
  startGesture(edge: Edge): void;
  updateGesture(edge: Edge, point: { x: number; y: number }): void;
  endGesture(edge: Edge): void;
}

export function attachDividerDrag(handle: any, ctx: GestureContext): () => void {
  const edge: Edge = handle._edge;
  if (!edge) return () => {};

  return draggable(handle, (local) => {
    ctx.updateGesture(edge, local);
  }, (active) => {
    if (active) ctx.startGesture(edge);
    else ctx.endGesture(edge);
  });
}

export function computeReapportion(
  edge: Edge,
  layout: Map<string, LayoutRect>,
  pairTotal: number,
  point: { x: number; y: number },
  orientation: ChartConfig["orientation"],
): { left: number; right: number } {
  const left = layout.get(edge.leftId)!;
  const right = layout.get(edge.rightId)!;
  const isHoriz = orientation === "horizontal";

  const pairStart = isHoriz ? left.y : left.x;
  const pairSize = isHoriz
    ? left.height + right.height
    : left.width + right.width;

  const pos = isHoriz ? point.y : point.x;
  const raw = pairSize > 0 ? (pos - pairStart) / pairSize : 0.5;
  const fraction = Math.max(0, Math.min(1, raw));
  const leftValue = fraction * pairTotal;
  return { left: leftValue, right: pairTotal - leftValue };
}
