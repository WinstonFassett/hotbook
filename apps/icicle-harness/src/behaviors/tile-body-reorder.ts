// behaviors/tile-body-reorder.ts — drag a tile to reorder it among siblings.
//
// Production-style reorder (wiki/interaction-principles.md rules 2, 5, 6, 7):
//   - Dragged tile follows the pointer (ghost) via an imperative CSS transform
//     override on its <g> element. It does NOT snap to a slot.
//   - Siblings slide to their provisional slots via CSS transitions — the
//     layout re-derives with a provisional frozenOrder, and the rect
//     transitions animate the slide.
//   - Data is NOT mutated during the drag. The provisional order lives in
//     frozenOrder (the same mechanism used for sort-freeze). On commit, the
//     tree's children array is reordered + written to the Kernel. On cancel,
//     frozenOrder is cleared and siblings slide back.
//
// Click-vs-drag: a pointerdown that doesn't move past a 3px threshold is a
// click (focus the tile), not a drag — same as tileBodyDrag.

import type { Gesture, Behavior, GestureGetter } from "../gesture";
import type { ChartNode } from "../hierarchy";

const DRAG_THRESHOLD_PX = 3;

export interface TileBodyReorderOptions {
  /** Getter for the hovered or focused node id (drag target). */
  target: GestureGetter<string | null>;
  /** Getter for the tree root (to find nodes + parents). */
  treeRoot: GestureGetter<ChartNode | null>;
  /** Getter for the layout map (to read sibling positions). */
  layout: GestureGetter<Map<string, { x: number; y: number; width: number; height: number }>>;
  /** Focus the tile on click (no-drag pointerup). */
  focusTile: (id: string) => void;
  /** Write the reorder to the Kernel on commit. */
  writeReorder: (parentId: string, orderedIds: string[]) => void;
  /** Bump the chart's reorder tick — forces layout re-derivation. */
  bumpReorder: () => void;
  /** The frozen-order cell. Set to provisional order during drag, cleared
   *  on commit/cancel. Same cell that previewFullRender uses for sort-freeze. */
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
    let startTilePos = 0; // rect x (vertical) or y (horizontal) at gesture start
    let startTileSize = 0;
    let ghostEl: SVGGraphicsElement | null = null;
    let ghostLabelWrap: HTMLElement | null = null;
    let prevGhostTransition = "";

    const unsubCancel = gesture.editor.subscribe((t) => {
      if (t.type === "cancel") {
        // Clear provisional order — siblings slide back via CSS transitions.
        opts.frozenOrderCell.value = null;
        gesture.store.frozenOrder = null;
        // Remove ghost override.
        restoreGhost();
        active = false;
        moved = false;
        pointerId = -1;
        targetId = null;
        initialOrder = [];
        currentOrder = [];
        parentId = null;
        ghostEl = null;
        ghostLabelWrap = null;
        gesture.store.activeTarget = null;
      }
    });

    const restoreGhost = () => {
      if (ghostEl) {
        ghostEl.style.transform = "";
        ghostEl.style.transition = prevGhostTransition;
        ghostEl.removeAttribute("data-reordering");
      }
      if (ghostLabelWrap) {
        ghostLabelWrap.style.opacity = "";
      }
    };

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

        // Activation — start the gesture.
        moved = true;
        gesture.store.activeTarget = targetId;
        gesture.store.takeSnapshot?.();

        // Don't set frozenOrder yet — only when the order actually changes
        // (on the first real reorder). Setting it to the initial order here
        // would be a no-op for sort=index but causes a re-derive for sort=value.

        gesture.draft({
          nodeId: targetId,
          value: 0,
          source: "reorder",
          intent: "reorder",
        });

        // Elevate the dragged tile: disable its CSS transition so it follows
        // the pointer instantly, and raise it in the DOM so it paints above.
        ghostEl = host.querySelector(`g[data-id="${targetId}"]`) as SVGGraphicsElement | null;
        if (ghostEl) {
          prevGhostTransition = ghostEl.style.transition;
          ghostEl.style.transition = "none";
          ghostEl.setAttribute("data-reordering", "");
          ghostEl.parentElement?.appendChild(ghostEl);
          ghostLabelWrap = ghostEl.querySelector("g[style*='transform']") as HTMLElement | null;
          if (ghostLabelWrap) ghostLabelWrap.style.opacity = "0.5";
        }
      }

      // Compute provisional order: where should the dragged tile go?
      const layout = opts.layout(gesture);
      const without = initialOrder.filter((id) => id !== targetId);

      // Find target slot by comparing pointer to sibling midpoints.
      const scored = without.map((id) => {
        const r = layout.get(id);
        if (!r) return { id, mid: 0 };
        const mid = isHoriz ? (r.y + r.height / 2) : (r.x + r.width / 2);
        return { id, mid };
      });

      // Insert target into the slot nearest to the ghost center.
      const ghostMid = startTileMid + (pointerAxis - startPointer);
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i <= scored.length; i++) {
        // Slot i is between scored[i-1] and scored[i].
        const leftMid = i > 0 ? scored[i - 1]!.mid : -Infinity;
        const rightMid = i < scored.length ? scored[i]!.mid : Infinity;
        const slotMid = (leftMid + rightMid) / 2;
        const dist = Math.abs(ghostMid - slotMid);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }

      const next = [...without.slice(0, bestIdx), targetId, ...without.slice(bestIdx)];
      let changed = next.length !== currentOrder.length;
      for (let i = 0; !changed && i < next.length; i++) if (next[i] !== currentOrder[i]) changed = true;

      if (changed) {
        currentOrder = next;
        // Update frozenOrder so siblings slide to their new slots.
        const order = new Map<string, string[]>();
        order.set(parentId!, currentOrder.slice());
        opts.frozenOrderCell.value = order;
        gesture.store.frozenOrder = order;
        opts.bumpReorder();
      }

      // Ghost: position so the tile's visual center is under the pointer.
      // The layout puts the tile's rect at a provisional slot; we compensate
      // with a transform so the visual position = pointer, not slot + delta.
      // transform = pointerPos - currentLayoutPos (along sibling axis).
      if (ghostEl) {
        const freshLayout = opts.layout(gesture);
        const r = freshLayout.get(targetId);
        if (r) {
          const slotPos = isHoriz ? r.y : r.x;
          const slotSize = isHoriz ? r.height : r.width;
          const slotMid = slotPos + slotSize / 2;
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
      } else if (active && gesture.state === "Drafting") {
        // Commit: mutate the tree to match the provisional order, then
        // clear frozenOrder so the layout reflects the real tree.
        const root = opts.treeRoot(gesture);
        if (root && parentId) {
          const parent = findNodeById(root, parentId);
          if (parent) {
            const byId = new Map(parent.children.map((c) => [c.id, c]));
            const newChildren = currentOrder.map((id) => byId.get(id)).filter((c): c is ChartNode => !!c);
            parent.children.splice(0, parent.children.length, ...newChildren);
            opts.writeReorder(parentId, currentOrder.slice());
            opts.bumpReorder();
          }
        }
        // Clear frozenOrder + restore ghost before commit so the layout
        // transitions from the provisional positions to the committed ones.
        opts.frozenOrderCell.value = null;
        gesture.store.frozenOrder = null;
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
      ghostLabelWrap = null;
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
      if (!node || !node.parent) return; // root can't be reordered
      if (node.parent.children.length < 2) return; // nothing to reorder

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

      // Capture the dragged tile's starting position + midpoint.
      const layout = opts.layout(gesture);
      const r = layout.get(id);
      if (r) {
        startTilePos = isHoriz ? r.y : r.x;
        startTileSize = isHoriz ? r.height : r.width;
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
