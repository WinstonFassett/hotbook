// behaviors/tile-body-reorder.ts — drag a tile to reorder it among siblings.
//
// Production-style reorder (wiki/interaction-principles.md):
//   - Dragged tile follows the pointer (ghost) via an imperative CSS transform.
//     Its transition is disabled so it tracks instantly. Elevated with
//     drop-shadow via [data-reordering]. Re-raised in the DOM on every move
//     so it paints above siblings (SVG paint order = document order).
//   - Siblings slide to their new slots via CSS transitions. The children
//     array is mutated directly (the bireactive tree IS the preview — the
//     Kernel data is only touched on commit). The layout re-derives, and
//     rect transitions animate the slide. The `reorder-active` class on the
//     host allows transitions during the gesture (unlike `gesture-active`
//     which suppresses them for value edits).
//   - On commit, the final order is written to the Kernel. On cancel, the
//     original order is restored and siblings slide back.
//
// Click-vs-drag: a pointerdown that doesn't move past a 3px threshold is a
// click (focus the tile), not a drag.

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
    let startPointer = 0;
    let ghostEl: SVGGraphicsElement | null = null;
    let ghostLabelWrap: HTMLElement | null = null;
    let prevGhostTransition = "";

    const unsubCancel = gesture.editor.subscribe((t) => {
      if (t.type === "cancel") {
        // Restore original children order.
        if (parentId && initialOrder.length > 0) {
          const root = opts.treeRoot(gesture);
          if (root) {
            const parent = findNodeById(root, parentId);
            if (parent) {
              const byId = new Map(parent.children.map((c) => [c.id, c]));
              const restored = initialOrder.map((id) => byId.get(id)).filter((c): c is ChartNode => !!c);
              parent.children.splice(0, parent.children.length, ...restored);
              opts.bumpReorder();
            }
          }
        }
        restoreGhost();
        active = false;
        moved = false;
        pointerId = -1;
        targetId = null;
        initialOrder = [];
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
        gesture.draft({
          nodeId: targetId,
          value: 0,
          source: "reorder",
          intent: "reorder",
        });

        // Elevate the dragged tile.
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

      const root = opts.treeRoot(gesture);
      if (!root || !parentId) return;
      const parent = findNodeById(root, parentId);
      if (!parent) return;

      // Current order of siblings (including dragged tile).
      const currentSibIds = parent.children.map((c) => c.id);
      const without = currentSibIds.filter((id) => id !== targetId);

      // Target index: count siblings whose center is before the ghost center.
      // This is the insertion point for the dragged tile.
      const layout = opts.layout(gesture);
      const ghostCenter = startTileMid + (pointerAxis - startPointer);

      let targetIdx = 0;
      for (const id of without) {
        const r = layout.get(id);
        if (!r) continue;
        const mid = isHoriz ? (r.y + r.height / 2) : (r.x + r.width / 2);
        if (mid < ghostCenter) targetIdx++;
      }

      // Build the new order.
      const newOrder = [...without.slice(0, targetIdx), targetId, ...without.slice(targetIdx)];

      // Check if order changed.
      let changed = newOrder.length !== currentSibIds.length;
      for (let i = 0; !changed && i < newOrder.length; i++) {
        if (newOrder[i] !== currentSibIds[i]) changed = true;
      }

      if (changed) {
        // Mutate the children array directly — the tree IS the preview.
        const byId = new Map(parent.children.map((c) => [c.id, c]));
        const newChildren = newOrder.map((id) => byId.get(id)).filter((c): c is ChartNode => !!c);
        parent.children.splice(0, parent.children.length, ...newChildren);
        opts.bumpReorder();
      }

      // Re-raise ghost in DOM (forEach may have re-ordered elements).
      if (ghostEl && ghostEl.parentElement) {
        ghostEl.parentElement.appendChild(ghostEl);
      }

      // Ghost: position so the tile's visual center is under the pointer.
      // Transform = pointerPos - currentLayoutMid (along sibling axis).
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
        reorderOrder: newOrder,
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
        // Commit: write the final order to the Kernel.
        const root = opts.treeRoot(gesture);
        if (root && parentId) {
          const parent = findNodeById(root, parentId);
          if (parent) {
            opts.writeReorder(parentId, parent.children.map((c) => c.id));
          }
        }
        restoreGhost();
        gesture.commit();
      }
      active = false;
      moved = false;
      targetId = null;
      initialOrder = [];
      parentId = null;
      ghostEl = null;
      ghostLabelWrap = null;
      gesture.store.activeTarget = null;
    };

    let startX = 0;
    let startY = 0;
    let startTileMid = 0;

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
      moved = false;
      active = true;

      // Capture the dragged tile's starting midpoint.
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
