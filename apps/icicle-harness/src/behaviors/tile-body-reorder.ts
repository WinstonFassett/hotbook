// behaviors/tile-body-reorder.ts — drag a tile to reorder it among siblings.
//
// Drag along the sibling axis (x for vertical orientation, y for horizontal)
// to move a tile to a new position within its parent's children. The drag is
// live: as the pointer crosses each sibling's midpoint, the children array
// is reordered and the layout re-derives reactively. CSS transitions on the
// tiles animate the slide.
//
// Routes through the Gesture/Editor draft system so cross-tile sync, gesture-
// active class suppression, and Esc-revert all work. On commit, the new order
// is written to the Kernel via writeReorder. On cancel, the snapshot restores
// the original order.
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
  /** Bump the chart's reorder tick cell to force layout re-derivation
   *  after a children-array mutation. Called on every reorder move. */
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
    let startSiblingIds: string[] = [];
    let parentId: string | null = null;

    const unsubCancel = gesture.editor.subscribe((t) => {
      if (t.type === "cancel") {
        // Restore original children order (snapshot only covers leaf values).
        if (parentId && startSiblingIds.length > 0) {
          const root = opts.treeRoot(gesture);
          if (root) {
            const parent = findNodeById(root, parentId);
            if (parent) {
              const byId = new Map(parent.children.map((c) => [c.id, c]));
              const restored = startSiblingIds.map((id) => byId.get(id)).filter((c): c is ChartNode => !!c);
              parent.children.splice(0, parent.children.length, ...restored);
              opts.bumpReorder();
            }
          }
        }
        active = false;
        moved = false;
        pointerId = -1;
        targetId = null;
        startSiblingIds = [];
        parentId = null;
        gesture.store.activeTarget = null;
      }
    });

    const onMove = (e: PointerEvent) => {
      if (pointerId === -1 || e.pointerId !== pointerId) return;
      if (!targetId) return;

      const travel = isHoriz ? (startY - e.clientY) : (e.clientX - startX);

      if (!moved && Math.abs(travel) < DRAG_THRESHOLD_PX) return;

      if (!moved) {
        moved = true;
        gesture.store.activeTarget = targetId;
        gesture.store.takeSnapshot?.();
        gesture.draft({
          nodeId: targetId,
          value: 0,
          source: "reorder",
          intent: "reorder",
        });
      }

      // Compute target index from pointer position relative to sibling midpoints.
      const root = opts.treeRoot(gesture);
      if (!root || !parentId) return;
      const parent = findNodeById(root, parentId);
      if (!parent) return;

      const layout = opts.layout(gesture);
      const sibIds = parent.children.map((c) => c.id);

      // Pointer position along the sibling axis, in canvas coords.
      // For vertical: x-axis; for horizontal: y-axis.
      const svg = host.querySelector("svg");
      if (!svg) return;
      const svgRect = svg.getBoundingClientRect();
      const pointerAxis = isHoriz ? (e.clientY - svgRect.top) : (e.clientX - svgRect.left);

      // Sort siblings by their current midpoint along the sibling axis.
      const mids = sibIds.map((id) => {
        const r = layout.get(id);
        if (!r) return { id, mid: 0 };
        const mid = isHoriz ? (r.y + r.height / 2) : (r.x + r.width / 2);
        return { id, mid };
      });
      mids.sort((a, b) => a.mid - b.mid);

      // Find where the pointer falls among the sorted midpoints.
      let targetIdx = mids.findIndex((m) => pointerAxis < m.mid);
      if (targetIdx === -1) targetIdx = mids.length - 1; // past the last

      // The dragged tile's current position in the sorted order.
      const currentIdx = mids.findIndex((m) => m.id === targetId);
      if (currentIdx === -1 || currentIdx === targetIdx) return;

      // Reorder the children array to match the new position.
      const newOrder = mids.map((m) => m.id);
      // Remove dragged tile, insert at targetIdx.
      newOrder.splice(currentIdx, 1);
      newOrder.splice(targetIdx, 0, targetId);

      // Apply to the bireactive tree so layout re-derives.
      const byId = new Map(parent.children.map((c) => [c.id, c]));
      const newChildren = newOrder.map((id) => byId.get(id)).filter((c): c is ChartNode => !!c);
      parent.children.splice(0, parent.children.length, ...newChildren);
      opts.bumpReorder(); // force layout re-derivation

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
        gesture.commit();
      }
      active = false;
      moved = false;
      targetId = null;
      startSiblingIds = [];
      parentId = null;
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
      startSiblingIds = node.parent.children.map((c) => c.id);
      moved = false;
      active = true;

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
