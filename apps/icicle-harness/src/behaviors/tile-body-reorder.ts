// behaviors/tile-body-reorder.ts — drag a tile to reorder it among siblings.
//
// Matches production's approach: imperative preview via CSS transforms.
// The layout is NOT re-derived during the drag. Instead:
//   - Dragged tile: CSS transform on its <g> follows the pointer directly.
//   - Siblings: CSS transform on their <g> slides them to provisional slots.
//   - No frozenOrder, no bumpReorder, no layout re-derivation.
//   - On commit: mutate the tree's children array + write to Kernel.
//   - On cancel: clear all transforms → tiles snap back to layout positions.
//
// Center-crossing: sibling midpoints frozen at activation. Ghost midpoint
// = startMid + pointerDelta. All items sorted by midpoint; ghost's index
// in sorted array = target slot. When ghost center crosses a sibling's
// frozen center, they swap.

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
    let startTilePos = 0;
    let startTileSize = 0;
    let initialMids = new Map<string, number>();
    let initialSlots = new Map<string, { pos: number; size: number }>();
    let ghostEl: SVGGraphicsElement | null = null;
    let prevGhostTransition = "";
    let siblingEls = new Map<string, SVGGraphicsElement>();
    let prevSiblingTransitions = new Map<string, string>();

    const restoreAll = () => {
      if (ghostEl) {
        ghostEl.style.transform = "";
        ghostEl.style.transition = prevGhostTransition;
        ghostEl.removeAttribute("data-reordering");
      }
      for (const [id, el] of siblingEls) {
        el.style.transform = "";
        el.style.transition = prevSiblingTransitions.get(id) ?? "";
      }
    };

    const unsubCancel = gesture.editor.subscribe((t) => {
      if (t.type === "cancel") {
        restoreAll();
        active = false;
        moved = false;
        pointerId = -1;
        targetId = null;
        initialOrder = [];
        currentOrder = [];
        parentId = null;
        initialMids.clear();
        initialSlots.clear();
        siblingEls.clear();
        prevSiblingTransitions.clear();
        ghostEl = null;
        gesture.store.activeTarget = null;
      }
    });

    const getTileG = (id: string): SVGGraphicsElement | null => {
      const r = host.querySelector(`rect[data-id="${id}"]`);
      return (r?.parentElement as SVGGraphicsElement) ?? null;
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

        moved = true;
        gesture.store.activeTarget = targetId;
        gesture.store.takeSnapshot?.();
        gesture.draft({
          nodeId: targetId,
          value: 0,
          source: "reorder",
          intent: "reorder",
        });

        // Capture frozen sibling midpoints + slots.
        const layout = opts.layout(gesture);
        initialMids.clear();
        initialSlots.clear();
        siblingEls.clear();
        prevSiblingTransitions.clear();
        for (const id of initialOrder) {
          const r = layout.get(id);
          if (!r) continue;
          const pos = isHoriz ? r.y : r.x;
          const size = isHoriz ? r.height : r.width;
          initialSlots.set(id, { pos, size });
          if (id !== targetId) {
            initialMids.set(id, pos + size / 2);
            const el = getTileG(id);
            if (el) {
              siblingEls.set(id, el);
              prevSiblingTransitions.set(id, el.style.transition);
              // Smooth transition for siblings sliding to new slots.
              el.style.transition = "transform 100ms ease-out";
            }
          }
        }

        // Elevate the ghost.
        ghostEl = getTileG(targetId);
        if (ghostEl) {
          prevGhostTransition = ghostEl.style.transition;
          ghostEl.style.transition = "none";
          ghostEl.setAttribute("data-reordering", "");
          ghostEl.parentElement?.appendChild(ghostEl);
        }
      }

      // Center-crossing: sort all items by midpoint.
      const ghostMid = startTileMid + (pointerAxis - startPointer);
      const scored = initialOrder.map((id) => ({
        id,
        mid: id === targetId ? ghostMid : (initialMids.get(id) ?? 0),
      }));
      scored.sort((a, b) => a.mid - b.mid);
      const targetIdx = scored.findIndex((s) => s.id === targetId);
      const next = scored.map((s) => s.id);

      let changed = next.length !== currentOrder.length;
      for (let i = 0; !changed && i < next.length; i++) if (next[i] !== currentOrder[i]) changed = true;

      if (changed) {
        currentOrder = next;
        // Compute provisional slots: partition the parent's span proportionally.
        const layout = opts.layout(gesture);
        const parentSlot = initialSlots.get(targetId);
        if (parentSlot) {
          // Parent span = sum of all sibling sizes (including dragged tile).
          let totalVal = 0;
          for (const id of initialOrder) {
            const s = initialSlots.get(id);
            if (s) totalVal += s.size;
          }
          // The parent's full span along the sibling axis.
          const parentStart = Math.min(...[...initialSlots.values()].map((s) => s.pos));
          const parentEnd = Math.max(...[...initialSlots.values()].map((s) => s.pos + s.size));
          const parentSpan = parentEnd - parentStart;

          // Assign slots in the new order.
          let cursor = parentStart;
          for (const id of currentOrder) {
            const s = initialSlots.get(id);
            if (!s) continue;
            const proportion = totalVal > 0 ? s.size / totalVal : 0;
            const newSize = proportion * parentSpan;
            if (id !== targetId) {
              const el = siblingEls.get(id);
              if (el) {
                const offset = cursor - s.pos;
                const dx = isHoriz ? 0 : offset;
                const dy = isHoriz ? offset : 0;
                el.style.transform = `translate(${dx}px, ${dy}px)`;
              }
            }
            cursor += newSize;
          }
        }
      }

      // Ghost: follow pointer. Transform = pointerDelta from start.
      if (ghostEl) {
        const offset = pointerAxis - startPointer;
        const dx = isHoriz ? 0 : offset;
        const dy = isHoriz ? offset : 0;
        ghostEl.style.transform = `translate(${dx}px, ${dy}px)`;
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
        // Commit: mutate the tree to match the provisional order.
        const root = opts.treeRoot(gesture);
        if (root && parentId && currentOrder.length > 0) {
          const parent = findNodeById(root, parentId);
          if (parent) {
            const byId = new Map(parent.children.map((c) => [c.id, c]));
            const newChildren = currentOrder.map((id) => byId.get(id)).filter((c): c is ChartNode => !!c);
            parent.children.splice(0, parent.children.length, ...newChildren);
            opts.writeReorder(parentId, currentOrder.slice());
            opts.bumpReorder();
          }
        }
        // Clear transforms BEFORE commit so the layout (now matching the
        // provisional order) takes over. The tiles are already in the right
        // visual positions, so clearing transforms is seamless.
        restoreAll();
        gesture.commit();
      }
      active = false;
      moved = false;
      targetId = null;
      initialOrder = [];
      currentOrder = [];
      parentId = null;
      initialMids.clear();
      initialSlots.clear();
      siblingEls.clear();
      prevSiblingTransitions.clear();
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
        startTilePos = isHoriz ? r.y : r.x;
        startTileSize = isHoriz ? r.height : r.width;
        startTileMid = startTilePos + startTileSize / 2;
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
