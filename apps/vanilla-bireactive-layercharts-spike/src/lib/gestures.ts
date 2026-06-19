import { applyDelta, flatOrder, installGestureRelease } from "./interaction";
import { walkTree, effect as biEffect } from "bireactive";
import type { BiNode } from "./tree";
import type { Writable, Cell } from "bireactive";
import { makeBridge, type ElementWithBridge } from "./hud-bridge";

export interface SelectionState {
  focused: Writable<Cell<BiNode | null>>;
  hovered: { current: BiNode | null };
  wheelLocked: { current: BiNode | null };
  /** Reactive hover cell that drives the demo's hover stroke. When present,
   *  the cross-tile bridge writes inbound external hover here so it highlights;
   *  demos keep it in sync with `hovered.current` on their own pointer events. */
  hoverCell?: Writable<Cell<BiNode | null>>;
  /** Set by attachChartGestures: demos call this when hover changes so the
   *  cross-tile bridge can report it out. No-op until the bridge is installed. */
  emitHover?: (node: BiNode | null) => void;
}

export interface ChartGestureSetup {
  root: BiNode;
  parentOf: (n: BiNode) => BiNode | undefined;
  state: SelectionState;
}

export function attachChartGestures(host: HTMLElement | SVGElement, setup: ChartGestureSetup): () => void {
  const { root, parentOf, state } = setup;

  const onWheel = (e: WheelEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (!state.wheelLocked.current) state.wheelLocked.current = state.hovered.current ?? state.focused.value;
    const target = state.wheelLocked.current;
    if (!target || target === root) return;
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    applyDelta(target, parentOf(target), e.deltaY < 0 ? +step : -step);
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Tab") {
      const order = flatOrder(root);
      if (order.length === 0) return;
      const cur = state.focused.value;
      const i = cur ? order.indexOf(cur) : -1;
      state.focused.value = e.shiftKey
        ? order[(i <= 0 ? order.length : i) - 1]!
        : order[(i + 1) % order.length]!;
      e.preventDefault();
      return;
    }
    const f = state.focused.value;
    if (!f || f === root) return;
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      applyDelta(f, parentOf(f), +step);
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      applyDelta(f, parentOf(f), -step);
      e.preventDefault();
    }
  };

  host.addEventListener("wheel", onWheel as EventListener, { passive: false });
  host.addEventListener("keydown", onKeydown as EventListener);
  const releaseDispose = installGestureRelease(() => {
    state.wheelLocked.current = null;
  });

  // ── Cross-tile sync bridge ──────────────────────────────────────────────
  // Index nodes by PNode id so external ids resolve to BiNodes.
  const byId = new Map<string, BiNode>();
  walkTree(root, (n) => byId.set((n as BiNode).value.id, n as BiNode));

  // Guard so applying an external id doesn't echo back out as our own change.
  let applyingExternal = false;

  const bridge = makeBridge({
    setHover: (id) => {
      applyingExternal = true;
      const node = id ? byId.get(id) ?? null : null;
      state.hovered.current = node;
      if (state.hoverCell) state.hoverCell.value = node;
      applyingExternal = false;
    },
    setSelect: (id) => {
      applyingExternal = true;
      state.focused.value = id ? byId.get(id) ?? null : null;
      applyingExternal = false;
    },
  });
  (host as ElementWithBridge).brSync = bridge;

  // Demos call this from their pointer handlers; emit out unless it's an echo.
  state.emitHover = (node) => {
    if (applyingExternal) return;
    bridge.emitHover(node ? node.value.id : null);
  };

  // Focus is a cell — emit out whenever it changes (skip external echoes).
  const focusDispose = biEffect(() => {
    const f = state.focused.value;
    if (applyingExternal) return;
    bridge.emitSelect(f ? f.value.id : null);
  });

  return () => {
    host.removeEventListener("wheel", onWheel as EventListener);
    host.removeEventListener("keydown", onKeydown as EventListener);
    releaseDispose();
    focusDispose();
    state.emitHover = undefined;
    (host as ElementWithBridge).brSync = undefined;
  };
}
