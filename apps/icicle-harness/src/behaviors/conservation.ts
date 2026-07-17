// behaviors/conservation.ts — shared value-distribution helpers.
// All three edit gestures (wheel, keyboard, edge handle) use these to
// distribute a delta across siblings according to the conservation mode.

import type { GestureGetter } from "../gesture";
import type { ConservationMode } from "./keyboard-edit";

export type ValueOf = (id: string) => number;
export type WriteValue = (id: string, value: number) => void;
export type SiblingsOf = (id: string) => string[];

export interface ConservationContext {
  valueOf: ValueOf;
  writeValue: WriteValue;
  siblings: SiblingsOf;
  snapshot: Map<string, number> | null;
}

/** Flip to the inverse conservation mode. */
export function invertMode(mode: ConservationMode): ConservationMode {
  if (mode === "proportional-siblings") return "proportional-neighbor";
  if (mode === "proportional-neighbor") return "proportional-siblings";
  return "additive";
}

/** Resolve the effective mode, accounting for alt flip. */
export function effectiveMode(
  defaultMode: ConservationMode,
  altHeld: boolean,
): ConservationMode {
  return altHeld ? invertMode(defaultMode) : defaultMode;
}

/** Apply a delta to a target node, distributing to siblings per conservation mode.
 *  Returns optional secondary info for draft events.
 *
 *  Conservation is strict: the pair/group sum is always preserved. When a
 *  sibling hits 0, the delta is capped to what's available — the target
 *  absorbs only as much as the siblings can give (on shrink) or gives only as
 *  much as it has (on grow past 0). No value is lost to the floor. */
export function applyConservedDelta(
  ctx: ConservationContext,
  targetId: string,
  delta: number,
  mode: ConservationMode,
): { secondaryId?: string; secondaryValue?: number } {
  const { valueOf, writeValue, siblings } = ctx;
  const sibs = siblings(targetId);

  if (mode === "proportional-neighbor" && sibs.length > 1) {
    const idx = sibs.indexOf(targetId);
    // Prefer next sibling; fall back to previous.
    const neighborIdx = idx + 1 < sibs.length ? idx + 1 : (idx - 1 >= 0 ? idx - 1 : -1);
    const neighborId = neighborIdx >= 0 ? sibs[neighborIdx] : null;
    if (neighborId) {
      const cur = valueOf(targetId);
      const neighborCur = valueOf(neighborId);
      // Cap delta to what the neighbor can absorb (grow) or self can give (shrink).
      // This preserves the pair sum exactly — no value lost to the floor.
      const cappedDelta = capDelta(delta, cur, neighborCur);
      const newSelf = cur + cappedDelta;
      const newNeighbor = neighborCur - cappedDelta;
      writeValue(targetId, newSelf);
      writeValue(neighborId, newNeighbor);
      return { secondaryId: neighborId, secondaryValue: newNeighbor };
    }
    // No neighbor — fall through to additive
  }

  if (mode === "proportional-siblings" && sibs.length > 1) {
    const cur = valueOf(targetId);
    const others = sibs.filter((s) => s !== targetId);
    const otherTotal = others.reduce((sum, s) => sum + valueOf(s), 0);
    // Cap delta to what others can give (grow) or self can give (shrink).
    const cappedDelta = capDelta(delta, cur, otherTotal);
    const newSelf = cur + cappedDelta;
    if (otherTotal > 0) {
      for (const s of others) {
        const sCur = valueOf(s);
        const share = (sCur / otherTotal) * cappedDelta;
        writeValue(s, sCur - share);
      }
    }
    writeValue(targetId, newSelf);
    return {};
  }

  // Additive — no conservation, just clamp to 0.
  const cur = valueOf(targetId);
  writeValue(targetId, Math.max(0, cur + delta));
  return {};
}

/** Cap a delta so neither the target nor the absorber goes below 0.
 *  - Growing (delta > 0): cap to absorberTotal (can't take more than they have).
 *  - Shrinking (delta < 0): cap to -targetVal (can't go below 0).
 *  This preserves the pair/group sum exactly. */
function capDelta(delta: number, targetVal: number, absorberTotal: number): number {
  if (delta > 0) return Math.min(delta, absorberTotal);
  if (delta < 0) return Math.max(delta, -targetVal);
  return 0;
}

/** Restore all leaf values from a snapshot. */
export function restoreFromSnapshot(
  ctx: ConservationContext,
  root: { id: string; value: { value: number }; children: any[]; parent: any } | null,
): void {
  if (!root || !ctx.snapshot) return;
  function walk(n: typeof root) {
    if (!n) return;
    if (n.children.length === 0) {
      const v = ctx.snapshot!.get(n.id);
      if (v !== undefined) n.value.value = v;
    } else {
      for (const c of n.children) walk(c);
    }
  }
  walk(root);
}
