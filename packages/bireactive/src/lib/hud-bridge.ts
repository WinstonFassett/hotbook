// Cross-tile hover/select bridge for BR-LC custom elements.
//
// The hotbook syncs hover + selection across every tile by PNode id via its
// `hudStore`. First-gen d3 charts read/write that store directly. The BR-LC
// custom elements keep their hover/focus as internal bireactive cells with no
// outside access, so they can't participate. This bridge exposes a tiny,
// id-based contract on the element so the React wrapper can:
//   • push an external hover/select id INTO the chart (highlight a node), and
//   • be notified when the chart's own hover/select changes (push OUT to store).
//
// The element installs the bridge (via the gesture-attach helpers) and the
// wrapper drives it. Ids are PNode ids (BiNode.value.id / the flat `ids[]`).

export interface BrSyncBridge {
  /** Highlight the node with this id as hovered (null clears). Idempotent. */
  setExternalHover(id: string | null): void;
  /** Mark the node with this id as selected/focused (null clears). Idempotent. */
  setExternalSelect(id: string | null): void;
  /** Drill into the node with this id (null pops to root). Idempotent. */
  setExternalDrill?(id: string | null): void;
  /** Subscribe to the chart's own hover changes. Returns an unsubscribe. */
  onHover(cb: (id: string | null) => void): () => void;
  /** Subscribe to the chart's own select/focus changes. Returns an unsubscribe. */
  onSelect(cb: (id: string | null) => void): () => void;
  /** Subscribe to drill events (dblclick on a node with children). Returns an unsubscribe. */
  onDrill?(cb: (drillKey: string, id: string | null) => void): () => void;
  /** Emit a hover event to the chart's onHover subscribers. */
  emitHover(id: string | null): void;
  /** Emit a select event to the chart's onSelect subscribers. */
  emitSelect(id: string | null): void;
  /** Emit a drill event to the chart's onDrill subscribers. */
  emitDrill(drillKey: string, id: string | null): void;
}

export interface ElementWithBridge extends HTMLElement {
  brSync?: BrSyncBridge;
}

/** Build a bridge from id-keyed setters + emitter registries. The
 *  gesture-attach helpers wire the chart's internal cells to these. */
export function makeBridge(opts: {
  setHover: (id: string | null) => void;
  setSelect: (id: string | null) => void;
  setDrill?: (id: string | null) => void;
}): BrSyncBridge {
  const hoverCbs = new Set<(id: string | null) => void>();
  const selectCbs = new Set<(id: string | null) => void>();
  const drillCbs = new Set<(drillKey: string, id: string | null) => void>();
  return {
    setExternalHover: opts.setHover,
    setExternalSelect: opts.setSelect,
    setExternalDrill: opts.setDrill,
    onHover: cb => { hoverCbs.add(cb); return () => hoverCbs.delete(cb); },
    onSelect: cb => { selectCbs.add(cb); return () => selectCbs.delete(cb); },
    onDrill: cb => { drillCbs.add(cb); return () => drillCbs.delete(cb); },
    emitHover: id => hoverCbs.forEach(cb => cb(id)),
    emitSelect: id => selectCbs.forEach(cb => cb(id)),
    emitDrill: (drillKey, id) => drillCbs.forEach(cb => cb(drillKey, id)),
  };
}
