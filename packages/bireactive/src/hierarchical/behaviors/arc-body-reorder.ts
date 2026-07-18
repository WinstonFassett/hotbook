// behaviors/arc-body-reorder.ts — drag an arc to reorder it among siblings.
// Radial variant of tile-body-reorder, adapted for angular geometry.
//
// Matches production's reorder mechanics (wiki/interaction-principles.md):
//   - Angular slot computation: pointer → angle → slot (with shortest-angular-delta
//     for wraparound). All siblings' angular midpoints are FROZEN at activation.
//   - Dragged arc (ghost) follows the pointer angle centered on it.
//   - Siblings slide to provisional slots via CSS transitions. Provisional
//     order lives in frozenOrder; layout re-derives, arc path transitions animate.
//   - Tree NOT mutated during drag. On commit, children array is reordered +
//     written to Kernel. On cancel, frozenOrder clears, siblings slide back.

import type { Gesture, Behavior, GestureGetter } from "../gesture";
import type { ChartNode } from "../tree";
import { motion } from "../../lib/runtime-config";

const DRAG_THRESHOLD_PX = 3;
const TWO_PI = Math.PI * 2;

export interface ArcBodyReorderOptions {
  target: GestureGetter<string | null>;
  treeRoot: GestureGetter<ChartNode | null>;
  layout: GestureGetter<Map<string, { a0: number; a1: number; rIn: number; rOut: number }>>;
  centerX: GestureGetter<number>;
  centerY: GestureGetter<number>;
  focusArc: (id: string) => void;
  writeReorder: (parentId: string, orderedIds: string[]) => void;
  bumpReorder: () => void;
  frozenOrderCell: { value: Map<string, string[]> | null };
}

export function arcBodyReorder(opts: ArcBodyReorderOptions): Behavior {
  return (gesture: Gesture) => {
    const host = gesture.store.host;
    if (!host) return () => {};

    let active = false;
    let pointerId = -1;
    let moved = false;
    let targetId: string | null = null;
    let parentId: string | null = null;
    let initialOrder: string[] = [];
    let currentOrder: string[] = [];
    let startPointerAngle = 0;
    let startArcMidAngle = 0;
    let startClientX = 0;
    let startClientY = 0;
    let initialMidAngles = new Map<string, number>();
    /** Parent span start angle — ring order is computed relative to this
     *  anchor so a parent whose span crosses 0/2π still sorts correctly. */
    let anchorAngle = 0;
    let ghostEl: SVGGraphicsElement | null = null;
    let prevGhostTransition = "";

    const normalizeAngle = (a: number): number => ((a % TWO_PI) + TWO_PI) % TWO_PI;

    const setFrozenOrder = (order: string[]) => {
      const map = new Map<string, string[]>();
      map.set(parentId!, order.slice());
      opts.frozenOrderCell.value = map;
      gesture.store.frozenOrder = map;
      opts.bumpReorder();
    };

    const clearFrozenOrder = () => {
      opts.frozenOrderCell.value = null;
      gesture.store.frozenOrder = null;
      opts.bumpReorder();
    };

    const restoreGhost = () => {
      if (ghostEl) {
        ghostEl.style.transform = "";
        ghostEl.style.transition = prevGhostTransition;
        ghostEl.removeAttribute("data-reordering");
      }
    };

    // Convert a CLIENT (viewport) point to an angle around the sunburst
    // center. centerX/centerY are SVG-local; offset them by the SVG's
    // viewport position before comparing against clientX/clientY.
    const pointToAngle = (x: number, y: number): number => {
      const svg = host.querySelector("svg");
      const b = svg?.getBoundingClientRect();
      const cx = (b?.left ?? 0) + opts.centerX(gesture);
      const cy = (b?.top ?? 0) + opts.centerY(gesture);
      let ang = Math.atan2(y - cy, x - cx);
      if (ang < 0) ang += TWO_PI;
      return ang;
    };

    // Shortest angular delta (handle wraparound at 0/2π).
    const shortestAngularDelta = (from: number, to: number): number => {
      let delta = to - from;
      if (delta > Math.PI) delta -= TWO_PI;
      if (delta < -Math.PI) delta += TWO_PI;
      return delta;
    };

    const unsubCancel = gesture.editor.subscribe((t) => {
      if (t.type === "cancel") {
        clearFrozenOrder();
        restoreGhost();
        active = false;
        moved = false;
        pointerId = -1;
        targetId = null;
        initialOrder = [];
        currentOrder = [];
        parentId = null;
        initialMidAngles.clear();
        ghostEl = null;
        gesture.store.activeTarget = null;
      }
    });

    const onMove = (e: PointerEvent) => {
      if (pointerId === -1 || e.pointerId !== pointerId) return;
      if (!targetId) return;

      const svg = host.querySelector("svg");
      if (!svg) return;

      if (!moved) {
        const travel = Math.hypot(e.clientX - startClientX, e.clientY - startClientY);
        if (travel < DRAG_THRESHOLD_PX) return;

        moved = true;
        gesture.store.activeTarget = targetId;
        gesture.store.takeSnapshot?.();
        gesture.draft({
          nodeId: targetId,
          value: 0,
          source: "reorder",
          intent: "reorder",
        });

        // Freeze initial order + capture sibling mid-angles (FROZEN).
        setFrozenOrder(initialOrder);
        const layout = opts.layout(gesture);
        initialMidAngles.clear();
        for (const id of initialOrder) {
          if (id === targetId) continue;
          const r = layout.get(id);
          if (!r) continue;
          const midAngle = (r.a0 + r.a1) / 2;
          initialMidAngles.set(id, midAngle);
        }

        // Elevate the ghost: the outer <g> makeArc returns (arc + label).
        // data-id lives on the annularSector's group; its parent is the
        // outer wrapper that carries both the arc and its label.
        const arcG = host.querySelector(`g[data-id="${targetId}"]`);
        ghostEl = (arcG?.parentNode as SVGGraphicsElement | null) ?? null;
        if (ghostEl) {
          prevGhostTransition = ghostEl.style.transition;
          ghostEl.style.transition = "none";
          ghostEl.setAttribute("data-reordering", "");
          ghostEl.parentElement?.appendChild(ghostEl);
        }
      }

      // Production center-crossing: sort ALL items by mid-angle.
      // Ghost mid-angle = startArcMidAngle + pointerDelta (follows pointer).
      // Sibling mid-angles = FROZEN initial values (don't change as they slide).
      const pointerAngle = pointToAngle(e.clientX, e.clientY);
      const ghostDelta = shortestAngularDelta(startPointerAngle, pointerAngle);
      const ghostMidAngle = startArcMidAngle + ghostDelta;

      // Ghost visual: rotate the dragged arc (+label) about the center so it
      // follows the pointer's angle.
      if (ghostEl) {
        const cx = opts.centerX(gesture);
        const cy = opts.centerY(gesture);
        ghostEl.style.transformOrigin = `${cx}px ${cy}px`;
        ghostEl.style.transform = `rotate(${(ghostDelta * 180) / Math.PI}deg)`;
      }

      // Ring order: normalize each mid-angle relative to the parent span's
      // start and sort ascending. (Sorting by signed delta from 0 — the
      // previous approach — breaks for angles past π: it puts the second
      // half of the ring before the first.)
      const scored = initialOrder.map((id) => ({
        id,
        angle: normalizeAngle(
          (id === targetId ? ghostMidAngle : (initialMidAngles.get(id) ?? 0)) - anchorAngle,
        ),
      }));
      scored.sort((a, b) => a.angle - b.angle);

      // Build new order from sorted positions.
      const next = scored.map((s) => s.id);
      let changed = next.length !== currentOrder.length;
      for (let i = 0; !changed && i < next.length; i++) if (next[i] !== currentOrder[i]) changed = true;

      if (changed) {
        currentOrder = next;
        setFrozenOrder(currentOrder);
        // forEach re-orders DOM elements after the re-derive (microtask).
        // Re-raise the ghost after that flush so it stays on top.
        requestAnimationFrame(() => {
          if (ghostEl && ghostEl.parentElement) {
            ghostEl.parentElement.appendChild(ghostEl);
          }
        });
      }

      gesture.updateDraft({
        nodeId: targetId,
        value: 0,
        source: "reorder",
        intent: "reorder",
        reorderOrder: currentOrder,
        parentId: parentId ?? undefined,
      });
    };

    const onUp = (e: PointerEvent) => {
      if (pointerId === -1 || e.pointerId !== pointerId) return;
      const wasClick = !moved;

      try { (host as any).releasePointerCapture?.(pointerId); } catch { /* ok */ }
      pointerId = -1;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);

      if (wasClick && targetId) {
        opts.focusArc(targetId);
        clearFrozenOrder();
      } else if (active && gesture.state === "Drafting") {
        // Commit: mutate the tree to match the provisional order.
        const root = opts.treeRoot(gesture);
        if (root && parentId) {
          const parent = findNodeById(root, parentId);
          if (parent) {
            const byId = new Map(parent.children.map((c) => [c.id, c]));
            const newChildren = currentOrder.map((id) => byId.get(id)).filter((c): c is ChartNode => !!c);
            parent.children.splice(0, parent.children.length, ...newChildren);
            opts.writeReorder(parentId, currentOrder.slice());
          }
        }
        // Clear frozenOrder so layout re-derives from the real tree order.
        clearFrozenOrder();
        // Capture the ghost element + transition before state is reset.
        const ghost = ghostEl;
        const prevTrans = prevGhostTransition;
        // Let the layout re-derive (microtask), then animate the ghost
        // from its dragged position back to zero offset. The arc path
        // will have updated to the final layout position; the <g> transform
        // transitions from the dragged offset to 0 — one smooth motion.
        requestAnimationFrame(() => {
          if (ghost) {
            ghost.style.transition = prevTrans || `transform ${motion.hoverMs.value}ms ease-out`;
            void (ghost as unknown as HTMLElement).offsetWidth;
            ghost.style.transform = "";
            ghost.removeAttribute("data-reordering");
          }
        });
        gesture.commit();
      }
      active = false;
      moved = false;
      targetId = null;
      initialOrder = [];
      currentOrder = [];
      parentId = null;
      initialMidAngles.clear();
      ghostEl = null;
      gesture.store.activeTarget = null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (gesture.state === "Drafting") return;
      if (!(e.target as Element)?.closest?.("svg")) return;

      const id = opts.target(gesture);
      if (!id) return;

      const root = opts.treeRoot(gesture);
      if (!root) return;
      const node = findNodeById(root, id);
      if (!node || !node.parent) return;
      if (node.parent.children.length < 2) return;

      pointerId = e.pointerId;
      targetId = id;
      parentId = node.parent.id;
      initialOrder = node.parent.children.map((c) => c.id);
      currentOrder = initialOrder.slice();
      moved = false;
      active = true;

      const layout = opts.layout(gesture);
      const r = layout.get(id);
      if (r) {
        startArcMidAngle = (r.a0 + r.a1) / 2;
      }
      const pr = parentId ? layout.get(parentId) : undefined;
      anchorAngle = pr ? pr.a0 : 0;

      startPointerAngle = pointToAngle(e.clientX, e.clientY);
      startClientX = e.clientX;
      startClientY = e.clientY;

      try { (host as any).setPointerCapture?.(pointerId); } catch { /* ok */ }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };

    host.addEventListener("pointerdown", onDown);

    return () => {
      unsubCancel();
      host.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  };
}

function findNodeById(root: ChartNode, id: string): ChartNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const found = findNodeById(c, id);
    if (found) return found;
  }
  return null;
}
