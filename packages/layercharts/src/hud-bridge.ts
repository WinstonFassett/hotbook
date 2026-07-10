// Cross-tile hover/select bridge for the Svelte LayerChart custom elements.
//
// Port of the vanilla BR-LC bridge
// (apps/vanilla-bireactive-layercharts-spike/src/lib/hud-bridge.ts). Sliceboard
// syncs hover + selection across every tile by PNode id via its `hudStore`. The
// Svelte components keep hover/focus as internal `$state`, so they can't
// participate on their own. This bridge exposes a tiny, id-based contract on the
// host element so the React wrapper can:
//   • push an external hover/select id INTO the chart (highlight a node), and
//   • be notified when the chart's own hover/select changes (push OUT to store).
//
// The component installs the bridge (via makeBridge, attached to $host().brSync)
// and drives emitHover/emitSelect from its own state. Ids are PNode ids
// (BiNode.value.id) — only present when sliceboard feeds an externalRoot.

export interface BrSyncBridge {
  /** Highlight the node with this id as hovered (null clears). Idempotent. */
  setExternalHover(id: string | null): void;
  /** Mark the node with this id as selected/focused (null clears). Idempotent. */
  setExternalSelect(id: string | null): void;
  /** Subscribe to the chart's own hover changes. Returns an unsubscribe. */
  onHover(cb: (id: string | null) => void): () => void;
  /** Subscribe to the chart's own select/focus changes. Returns an unsubscribe. */
  onSelect(cb: (id: string | null) => void): () => void;
  /** Subscribe to drill events (dblclick on node with children). Returns an unsubscribe. */
  onDrill?(cb: (drillKey: string, id: string | null) => void): () => void;
}

export interface ElementWithBridge extends HTMLElement {
  brSync?: BrSyncBridge;
}

/** Build a bridge from id-keyed setters + emitter registries. The component
 *  wires its internal $state to setHover/setSelect and calls emitHover/emitSelect
 *  whenever its own hover/focus changes. */
export function makeBridge(opts: {
  setHover: (id: string | null) => void;
  setSelect: (id: string | null) => void;
}): BrSyncBridge & {
  emitHover: (id: string | null) => void;
  emitSelect: (id: string | null) => void;
  emitDrill: (drillKey: string, id: string | null) => void;
} {
  const hoverCbs = new Set<(id: string | null) => void>();
  const selectCbs = new Set<(id: string | null) => void>();
  const drillCbs = new Set<(drillKey: string, id: string | null) => void>();
  return {
    setExternalHover: opts.setHover,
    setExternalSelect: opts.setSelect,
    onHover: (cb) => { hoverCbs.add(cb); return () => hoverCbs.delete(cb); },
    onSelect: (cb) => { selectCbs.add(cb); return () => selectCbs.delete(cb); },
    onDrill: (cb) => { drillCbs.add(cb); return () => drillCbs.delete(cb); },
    emitHover: (id) => hoverCbs.forEach((cb) => cb(id)),
    emitSelect: (id) => selectCbs.forEach((cb) => cb(id)),
    emitDrill: (drillKey, id) => drillCbs.forEach((cb) => cb(drillKey, id)),
  };
}
