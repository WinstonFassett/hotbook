import {
  applyDelta,
  dynamicWheelStep,
  wheelController,
  realModifierDown,
  type ScalingMode,
} from "./interaction";
import { walkTree, effect as biEffect, batch } from "bireactive";
import type { BiNode } from "./tree";
import type { Writable, Cell } from "bireactive";
import { makeBridge, type ElementWithBridge } from "./hud-bridge";
import { GESTURE_ACTIVE_CLASS } from "./transitions";

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
  /** Default scaling mode for keyboard/arrow edits on this chart. Wheel is
   *  always additive (per WIN-38 spec); drag mode lives on the per-handle
   *  callsite. Alt held during arrow keys forces additive regardless. */
  scalingMode?: ScalingMode;
}

export function attachChartGestures(host: HTMLElement | SVGElement, setup: ChartGestureSetup): () => void {
  const { root, parentOf, state } = setup;
  const defaultMode: ScalingMode = setup.scalingMode ?? "proportional-siblings";

  // applyDelta redistributes a node's change across its siblings, so a revert
  // must restore the target AND every sibling — snapshot all their totals.
  // Per-gesture value-mapping handed to the SHARED wheel controller.
  const setGestureActive = (on: boolean) => (host as HTMLElement).classList?.toggle(GESTURE_ACTIVE_CLASS, on);
  const wheelConfig = {
    snapshot: (node: BiNode) => {
      setGestureActive(true);
      const parent = parentOf(node);
      const group = parent ? (parent.children as BiNode[]) : [node];
      return group.map((n) => ({ node: n, value: n.value.total.value }));
    },
    restore: (_node: BiNode, snap: Array<{ node: BiNode; value: number }>) => {
      batch(() => { for (const s of snap) s.node.value.total.value = s.value; });
    },
    onEnd: () => { setGestureActive(false); state.wheelLocked.current = null; },
  };

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    // Distinguish trackpad pinch (synthetic ctrlKey, no real key) from a real
    // Cmd/Ctrl+wheel. Pinch needs a different commit strategy (no keyup fires).
    const isPinch = !realModifierDown();
    if (!wheelController.active) {
      const t = state.hovered.current ?? state.focused.value;
      if (!t || t === root) return;
      wheelController.begin(t, wheelConfig, { pinch: isPinch });
      state.wheelLocked.current = wheelController.target as BiNode | null;
    }
    const target = wheelController.target as BiNode | null;
    if (!target || target === root) return;
    e.preventDefault();
    // Wheel is always additive (per WIN-38 spec) with dynamic step scaled to
    // current value, so a tick feels the same at value 5 and value 5000.
    // Shift = fine grain (1% vs 10%).
    const step = dynamicWheelStep(target.value.total.value, e.shiftKey);
    applyDelta(target, parentOf(target), e.deltaY < 0 ? +step : -step, { mode: "additive" });
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // Drag-Esc is owned by the gesture (dragCancelable). Here: clear focus.
      if (state.focused.value != null) { state.focused.value = null; e.preventDefault(); }
      return;
    }
    const f = state.focused.value;
    if (!f || f === root) return;
    const step = e.shiftKey ? 5 : 1;
    // Alt forces additive override (only target moves) regardless of the
    // chart's configured scalingMode.
    const mode: ScalingMode = e.altKey ? "additive" : defaultMode;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      applyDelta(f, parentOf(f), +step, { mode });
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      applyDelta(f, parentOf(f), -step, { mode });
      e.preventDefault();
    }
  };

  // Rule 14: touch is a first-class gesture surface. Claim the touch gesture
  // from the browser so drag-edit on atoms doesn't lose to page scroll on
  // mobile. Restored on dispose.
  const hostStyle = (host as HTMLElement).style;
  const prevTouchAction = hostStyle?.touchAction ?? "";
  if (hostStyle) hostStyle.touchAction = "none";

  host.addEventListener("wheel", onWheel as EventListener, { passive: false });
  host.addEventListener("keydown", onKeydown as EventListener);

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
      if (state.hoverCell) state.hoverCell.value = node;
      applyingExternal = false;
    },
    setSelect: (id) => {
      applyingExternal = true;
      state.focused.value = id ? byId.get(id) ?? null : null;
      applyingExternal = false;
    },
    setDrill: (id) => {
      (host as any).drillNodeId = id;
    },
  });
  (host as ElementWithBridge).brSync = bridge;

  const onDblClick = () => {
    const node = state.hovered.current ?? state.focused.value;
    if (!node || node === root) return;
    if ((node.children as BiNode[]).length === 0) return;
    // Drill directly — the chart owns its drill state. Emit for hotbook's
    // benefit (breadcrumb, persistence, sibling-tile propagation) but don't
    // wait for a round-trip to actually drill.
    const host2 = host as any;
    if (host2.drillNodeId !== undefined) host2.drillNodeId = node.value.id;
    const drillKey = host2.drillKey ?? 'default';
    bridge.emitDrill(drillKey, node.value.id);
    // Keep focus on the chart host so Escape can drill out. The dblclick
    // target (a tile) may be torn down by the re-render, losing focus.
    host.focus({ preventScroll: true });
  };
  host.addEventListener("dblclick", onDblClick);

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
    if (hostStyle) hostStyle.touchAction = prevTouchAction;
    host.removeEventListener("wheel", onWheel as EventListener);
    host.removeEventListener("keydown", onKeydown as EventListener);
    host.removeEventListener("dblclick", onDblClick);
    focusDispose();
    state.emitHover = undefined;
    (host as ElementWithBridge).brSync = undefined;
  };
}
