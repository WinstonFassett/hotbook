// gestures.ts — edge handle drag for the icicle chart.
// Uses the shared conservation helper for proportional-siblings / proportional-neighbor.
// The chart provides a context with hooks for start/drag/end + value accessors.

import { draggable } from "bireactive";
import type { ChartConfig, LayoutRect } from "./types";
import type { Edge, ChartNode } from "./hierarchy";
import { applyConservedDelta, effectiveMode, type ConservationContext } from "./behaviors/conservation";
import type { ConservationMode } from "./behaviors/keyboard-edit";

export interface GestureContext {
  config: ChartConfig;
  conservationMode: ConservationMode;
  altHeld: () => boolean;
  snapshot: Map<string, number> | null;
  treeRoot: () => ChartNode | null;
  layout: () => Map<string, LayoutRect>;
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

export function attachEdgeHandleDrag(handle: any, ctx: GestureContext): () => void {
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

/** Compute the new left value when dragging in proportional-siblings mode.
 *  Maps the drag position to a fraction of the entire sibling group. */
export function computeGroupReapportion(
  edge: Edge,
  layout: Map<string, LayoutRect>,
  groupTotal: number,
  siblings: ChartNode[],
  point: { x: number; y: number },
  orientation: ChartConfig["orientation"],
): number {
  const isHoriz = orientation === "horizontal";
  const firstRect = layout.get(siblings[0].id)!;
  const lastRect = layout.get(siblings[siblings.length - 1].id)!;
  const groupStart = isHoriz ? firstRect.y : firstRect.x;
  const groupSpan = isHoriz
    ? (lastRect.y + lastRect.height) - firstRect.y
    : (lastRect.x + lastRect.width) - firstRect.x;
  const pos = isHoriz ? point.y : point.x;
  const raw = groupSpan > 0 ? (pos - groupStart) / groupSpan : 0.5;
  const fraction = Math.max(0, Math.min(1, raw));
  return fraction * groupTotal;
}
