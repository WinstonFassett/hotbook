// behaviors/tile-body-reorder.ts — drag a tile to reorder it among siblings.
//
// Production-style reorder (wiki/interaction-principles.md):
//   - Dragged tile follows the pointer (ghost) via an imperative CSS transform.
//     Its transition is disabled so it tracks instantly. Elevated with
//     drop-shadow via [data-reordering]. Raised in the DOM once on activation
//     so it paints above siblings (SVG paint order = document order).
//   - Siblings slide to their new slots via CSS transitions. The provisional
//     order lives in frozenOrder — the layout re-derives with it, rect
//     transitions animate the slide. The `reorder-active` class on the host
//     allows transitions during the gesture (unlike `gesture-active` which
//     suppresses them for value edits). The tree's children array is NOT
//     mutated during the drag — forEach DOM order stays stable, so the ghost
//     stays raised.
//   - On commit, the tree's children array is reordered + written to the
//     Kernel. On cancel, frozenOrder is cleared and siblings slide back.

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

        // Freeze initial order so siblings don't re-sort (for sort=value).
        setFrozenOrder(initialOrder);

        // Elevate the ghost: disable transition, raise in DOM, mark.
        ghostEl = host.querySelector(`g[data-id="${targetId}"]`) as SVGGraphicsElement | null;
        if (ghostEl) {
          prevGhostTransition = ghostEl.style.transition;
          ghostEl.style.transition = "none";
          ghostEl.setAttribute("data-reordering", "");
          ghostEl.parentElement?.appendChild(ghostEl);
        }
      }

      // Compute target index: count siblings whose center is before the ghost.
      const layout = opts.layout(gesture);
      const ghostCenter = startTileMid + (pointerAxis - startPointer);
      const without = initialOrder.filter((id) => id !== targetId);

      let targetIdx = 0;
      for (const id of without) {
        const r = layout.get(id);
        if (!r) continue;
        const mid = isHoriz ? (r.y + r.height / 2) : (r.x + r.width / 2);
        if (mid < ghostCenter) targetIdx++;
      }

      const next = [...without.slice(0, targetIdx), targetId, ...without.slice(targetIdx)];
      let changed = next.length !== currentOrder.length;
      for (let i = 0; !changed && i < next.length; i++) if (next[i] !== currentOrder[i]) changed = true;

      if (changed) {
        currentOrder = next;
        setFrozenOrder(currentOrder);
      }

      // Ghost: transform so visual center tracks pointer.
      // transform = pointerPos - currentLayoutMid (along sibling axis).
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
        // Clear frozenOrder + restore ghost, then commit. The tree mutation
        // + frozenOrder clear happen together; the layout re-derives from
        // the real tree order (which now matches the provisional order).
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
