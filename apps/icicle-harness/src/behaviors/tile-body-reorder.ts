// behaviors/tile-body-reorder.ts — drag a tile to reorder it among siblings.
//
// Matches production's reorder mechanics (wiki/interaction-principles.md):
//   - Center-crossing: sibling midpoints are FROZEN at activation. The ghost's
//     midpoint = startMid + pointerDelta. All items (ghost + frozen siblings)
//     are sorted by midpoint; the ghost's index in that sorted array is its
//     target slot. When the ghost center crosses a sibling's FROZEN center,
//     they swap — exactly like production.
//   - Dragged tile follows the pointer (ghost) via imperative CSS transform.
//     Transition disabled, elevated with drop-shadow, raised in DOM.
//   - Siblings slide to provisional slots via CSS transitions. Provisional
//     order lives in frozenOrder; layout re-derives, rect transitions animate.
//   - Tree NOT mutated during drag. On commit, children array is reordered +
//     written to Kernel. On cancel, frozenOrder clears, siblings slide back.

import type { Gesture, Behavior, GestureGetter } from "../gesture";
import type { ChartNode } from "../hierarchy";

const DRAG_THRESHOLD_PX = 3;

export interface TileBodyReorderOptions {
  target: GestureGetter<string | null>;
  treeRoot: GestureGetter<ChartNode | null>;
  layout: GestureGetter<Map<string, { x: number; y: number; width: number; height: number }>>;
  focusTile: (id: string) => void;
  writeReorder: (parentId: string, orderedIds: string[]) => void;
  bumpReorder: () => void;
  frozenOrderCell: { value: Map<string, string[]> | null };
}

export function tileBodyReorder(opts: TileBodyReorderOptions): Behavior {
  return (gesture: Gesture) => {
    const host = gesture.store.host;
    if (!host) return () => {};

    let active = false;
    let pointerId = -1;
    let moved = false;
    let targetId: string | null = null;
    let isHoriz = false;
    let parentId: string | null = null;
    let initialOrder: string[] = [];
    let currentOrder: string[] = [];
    let startPointer = 0;
    let startTileMid = 0;
    let initialMids = new Map<string, number>();
    let ghostEl: SVGGraphicsElement | null = null;
    let prevGhostTransition = "";

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
        initialMids.clear();
        ghostEl = null;
        gesture.store.activeTarget = null;
      }
    });

    const onMove = (e: PointerEvent) => {
      if (pointerId === -1 || e.pointerId !== pointerId) return;
      if (!targetId) return;

      const svg = host.querySelector("svg");
      if (!svg) return;
      const svgRect = svg.getBoundingClientRect();
      const pointerAxis = isHoriz ? (e.clientY - svgRect.top) : (e.clientX - svgRect.left);

      if (!moved) {
        const travel = Math.abs(pointerAxis - startPointer);
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

        // Freeze initial order + capture sibling midpoints (FROZEN — don't
        // re-read as siblings move; that's circular and causes jank).
        setFrozenOrder(initialOrder);
        const layout = opts.layout(gesture);
        initialMids.clear();
        for (const id of initialOrder) {
          if (id === targetId) continue;
          const r = layout.get(id);
          if (!r) continue;
          initialMids.set(id, isHoriz ? (r.y + r.height / 2) : (r.x + r.width / 2));
        }

        // Elevate the ghost.
        ghostEl = host.querySelector(`g[data-id="${targetId}"]`) as SVGGraphicsElement | null;
        if (ghostEl) {
          prevGhostTransition = ghostEl.style.transition;
          ghostEl.style.transition = "none";
          ghostEl.setAttribute("data-reordering", "");
          ghostEl.parentElement?.appendChild(ghostEl);
        }
      }

      // Production center-crossing: sort ALL items by midpoint.
      // Ghost midpoint = startTileMid + pointerDelta (follows pointer).
      // Sibling midpoints = FROZEN initial values (don't change as they slide).
      const ghostMid = startTileMid + (pointerAxis - startPointer);
      const scored = initialOrder.map((id) => ({
        id,
        mid: id === targetId ? ghostMid : (initialMids.get(id) ?? 0),
      }));
      scored.sort((a, b) => a.mid - b.mid);
      const targetIdx = scored.findIndex((s) => s.id === targetId);

      // Build new order from sorted positions.
      const next = scored.map((s) => s.id);
      let changed = next.length !== currentOrder.length;
      for (let i = 0; !changed && i < next.length; i++) if (next[i] !== currentOrder[i]) changed = true;

      if (changed) {
        currentOrder = next;
        setFrozenOrder(currentOrder);
      }

      // Ghost: transform so visual center tracks pointer.
      if (ghostEl) {
        const freshLayout = opts.layout(gesture);
        const r = freshLayout.get(targetId);
        if (r) {
          const slotMid = isHoriz ? (r.y + r.height / 2) : (r.x + r.width / 2);
          const offset = pointerAxis - slotMid;
          const dx = isHoriz ? 0 : offset;
          const dy = isHoriz ? offset : 0;
          ghostEl.style.transform = `translate(${dx}px, ${dy}px)`;
        }
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
        opts.focusTile(targetId);
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
        clearFrozenOrder();
        restoreGhost();
        gesture.commit();
      }
      active = false;
      moved = false;
      targetId = null;
      initialOrder = [];
      currentOrder = [];
      parentId = null;
      initialMids.clear();
      ghostEl = null;
      gesture.store.activeTarget = null;
    };

    let startX = 0;
    let startY = 0;

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

      const config = gesture.store.config.value;
      isHoriz = config.orientation === "horizontal";

      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      targetId = id;
      parentId = node.parent.id;
      initialOrder = node.parent.children.map((c) => c.id);
      currentOrder = initialOrder.slice();
      moved = false;
      active = true;

      const layout = opts.layout(gesture);
      const r = layout.get(id);
      if (r) {
        startTileMid = isHoriz ? (r.y + r.height / 2) : (r.x + r.width / 2);
      }

      const svg = host.querySelector("svg");
      if (svg) {
        const svgRect = svg.getBoundingClientRect();
        startPointer = isHoriz ? (e.clientY - svgRect.top) : (e.clientX - svgRect.left);
      }

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
