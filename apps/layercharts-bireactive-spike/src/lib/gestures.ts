import { applyDelta, flatOrder, installGestureRelease } from "./interaction";
import type { BiNode } from "./tree";
import type { Writable, Cell } from "bireactive";

export interface SelectionState {
  focused: Writable<Cell<BiNode | null>>;
  hovered: { current: BiNode | null };
  wheelLocked: { current: BiNode | null };
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

  return () => {
    host.removeEventListener("wheel", onWheel as EventListener);
    host.removeEventListener("keydown", onKeydown as EventListener);
    releaseDispose();
  };
}
