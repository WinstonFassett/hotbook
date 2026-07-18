// bi-adapter.ts — compatibility bridge between the legacy BiNode element API
// (data/externalRoot + maxDepth/sortBy/measureKey/... props, used by demos,
// hotbook, apitable, docs) and the new hierarchical architecture
// (Kernel + Dataset + ChartConfig).
//
// Model: once a BiNode root is handed to a chart, the Kernel dataset built
// from it is the chart's source of truth. The adapter keeps the BiNode tree
// and the Kernel dataset in two-way sync at the *leaf* level:
//   • BiNode → Kernel: a bireactive effect reads every leaf's `total` cell;
//     external writes (e.g. the legacy treetable editing a cell) push into
//     the Kernel via writeValues.
//   • Kernel → BiNode: on Kernel publish, changed leaf values are written
//     back into the BiNode `total` cells (groups re-derive via their lens),
//     and child-order changes are applied to the BiNode children arrays.
// An `applying` flag guards against echo loops.
//
// All compat charts share one module-level Kernel, so any two charts fed the
// same BiNode root share a dataset — cross-view sync (drafts + drill) works
// exactly like the harness.

import { effect } from "bireactive";
import type { BiNode } from "../lib/tree";
import type { ChartConfig, DataNode } from "./types";
import { Kernel, findNode } from "./kernel";
import { HierarchicalChartBase } from "./hierarchical-chart-base";

/** One Kernel for every compat-wired chart: same BiNode root → same dataset
 *  → shared DataView semantics + drill channel across views. */
export const sharedKernel = new Kernel();

interface RootEntry {
  datasetId: string;
  /** Number of charts currently retaining this root. When it drops to 0 the
   *  sync effect + kernel subscription are disposed (the dataset stays
   *  registered in the Kernel — harmless — but nothing watches it). */
  refs: number;
  dispose: () => void;
  reorderListeners: Set<(parentId: string, orderedIds: string[]) => void>;
}

const entries = new WeakMap<BiNode, RootEntry>();
let nextDatasetId = 0;

function leafValue(n: BiNode): number {
  return n.value.total.value;
}

function toDataNode(n: BiNode): DataNode {
  const isLeaf = n.children.length === 0;
  return {
    id: n.value.id,
    label: n.value.label,
    color: n.value.color,
    value: isLeaf ? leafValue(n) : 0, // groups: Kernel recomputes sums
    children: (n.children as BiNode[]).map(toDataNode),
  };
}

function forEachNode(n: BiNode, fn: (n: BiNode) => void): void {
  fn(n);
  for (const c of n.children as BiNode[]) forEachNode(c, fn);
}

/** Get (or create) the shared-Kernel dataset for a BiNode root, with two-way
 *  leaf sync installed. Returns the datasetId. */
export function adoptBiRoot(root: BiNode): string {
  const existing = entries.get(root);
  if (existing) return existing.datasetId;

  const datasetId = `bi-${nextDatasetId++}`;
  sharedKernel.registerDataset({
    id: datasetId,
    dataShape: "hierarchical",
    root: toDataNode(root),
  });

  const reorderListeners = new Set<(parentId: string, orderedIds: string[]) => void>();

  // Guard: true while one side is applying the other side's change.
  let applying = false;

  // BiNode → Kernel: watch every leaf total cell.
  const stopEffect = effect(() => {
    const writes: Array<{ nodeId: string; value: number }> = [];
    const ds = sharedKernel.getDataset(datasetId)!;
    forEachNode(root, (n) => {
      if (n.children.length > 0) return;
      const v = leafValue(n); // reactive read — effect re-runs on any leaf change
      if (applying) return;
      const dn = findNode(ds.root, n.value.id);
      if (dn && dn.value !== v) writes.push({ nodeId: n.value.id, value: v });
    });
    if (writes.length > 0) {
      applying = true;
      try {
        sharedKernel.writeValues(datasetId, writes);
      } finally {
        applying = false;
      }
    }
  });

  // Kernel → BiNode: on publish, write changed leaves back + apply reorders.
  const stopKernel = sharedKernel.subscribe((id) => {
    if (id !== datasetId || applying) return;
    const ds = sharedKernel.getDataset(datasetId);
    if (!ds) return;
    applying = true;
    try {
      // Leaf values.
      forEachNode(root, (n) => {
        if (n.children.length > 0) return;
        const dn = findNode(ds.root, n.value.id);
        if (dn && leafValue(n) !== dn.value) n.value.total.value = dn.value;
      });
      // Child order (reorder commits).
      const syncOrder = (dn: DataNode) => {
        const bn = findBiNode(root, dn.id);
        if (bn && bn.children.length > 1) {
          const currentOrder = (bn.children as BiNode[]).map((c) => c.value.id);
          const targetOrder = dn.children.map((c) => c.id);
          if (currentOrder.join(",") !== targetOrder.join(",")) {
            const byId = new Map((bn.children as BiNode[]).map((c) => [c.value.id, c]));
            const reordered = targetOrder.map((cid) => byId.get(cid)).filter(Boolean) as BiNode[];
            if (reordered.length === bn.children.length) {
              (bn.children as BiNode[]).splice(0, bn.children.length, ...reordered);
              for (const fn of reorderListeners) fn(dn.id, targetOrder);
            }
          }
        }
        for (const c of dn.children) syncOrder(c);
      };
      syncOrder(ds.root);
    } finally {
      applying = false;
    }
  });

  const entry: RootEntry = {
    datasetId,
    refs: 0,
    reorderListeners,
    dispose: () => {
      stopEffect();
      stopKernel();
      entries.delete(root);
    },
  };
  entries.set(root, entry);
  return datasetId;
}

/** Retain a BiNode root: adopt (or re-adopt) it and bump the refcount.
 *  Every retain must be paired with a releaseBiRoot. */
export function retainBiRoot(root: BiNode): string {
  const datasetId = adoptBiRoot(root);
  entries.get(root)!.refs++;
  return datasetId;
}

/** Release a retained BiNode root. When the last retainer releases, the
 *  two-way sync (effect + kernel subscription) is disposed. */
export function releaseBiRoot(root: BiNode): void {
  const entry = entries.get(root);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) entry.dispose();
}

/** Subscribe to reorders applied back to a BiNode root (legacy onReorder). */
export function onBiReorder(
  root: BiNode,
  fn: (parentId: string, orderedIds: string[]) => void,
): () => void {
  adoptBiRoot(root);
  const entry = entries.get(root)!;
  entry.reorderListeners.add(fn);
  return () => entry.reorderListeners.delete(fn);
}

function findBiNode(root: BiNode, id: string): BiNode | null {
  if (root.value.id === id) return root;
  for (const c of root.children as BiNode[]) {
    const found = findBiNode(c, id);
    if (found) return found;
  }
  return null;
}

// ─── Legacy element-prop facade ────────────────────────────────────────────

type SortBy = "index" | "value";
type Orientation = "horizontal" | "vertical";
type Conservation = "additive" | "proportional-neighbor" | "proportional-siblings";
type ColorMode = "flat" | "depth" | "mono";
type DragBehavior = "none" | "resize" | "reorder";

/** Mixin adding the legacy MdXxxLC element API on top of a
 *  HierarchicalChartBase subclass. Every prop write recomputes the
 *  ChartConfig and (first time a root arrives) adopts the BiNode root into
 *  the shared Kernel. */
export function withBiCompat<
  T extends new (...args: any[]) => HierarchicalChartBase,
>(Base: T, defaults: Partial<ChartConfig> = {}) {
  class BiCompat extends Base {
    private _c = {
      root: null as BiNode | null,
      maxDepth: undefined as number | undefined,
      sortBy: "index" as SortBy,
      measureKey: "" as string,
      orientation: (defaults.orientation ?? "horizontal") as Orientation,
      canReorder: false,
      conservationMode: (defaults.conservationMode ?? "additive") as Conservation,
      showBreadcrumb: defaults.showBreadcrumb ?? false,
      showRoot: defaults.showRoot ?? true,
      colorMode: defaults.colorMode as ColorMode | undefined,
      dragBehavior: defaults.dragBehavior as DragBehavior | undefined,
      exitFade: defaults.exitFade as boolean | undefined,
    };
    private _kernelSet = false;
    private _offReorder: (() => void) | null = null;

    /** Fired on a committed reorder (legacy contract). */
    onReorder?: (parentId: string | null, orderedIds: string[]) => void;

    get data(): BiNode | null { return this._c.root; }
    set data(root: BiNode | null) { this._setRoot(root); }
    get externalRoot(): BiNode | undefined { return this._c.root ?? undefined; }
    set externalRoot(root: BiNode | undefined) { this._setRoot(root ?? null); }

    get maxDepth(): number | undefined { return this._c.maxDepth; }
    set maxDepth(v: number | undefined) { this._c.maxDepth = v; this._push(); }

    get sortBy(): SortBy { return this._c.sortBy; }
    set sortBy(v: SortBy) { this._c.sortBy = v; this._push(); }

    get measureKey(): string { return this._c.measureKey; }
    set measureKey(v: string) { this._c.measureKey = v; this._push(); }

    get orientation(): Orientation { return this._c.orientation; }
    set orientation(v: Orientation) { this._c.orientation = v; this._push(); }

    get canReorder(): boolean { return this._c.canReorder; }
    set canReorder(v: boolean) { this._c.canReorder = v; this._push(); }

    get conservationMode(): Conservation { return this._c.conservationMode; }
    set conservationMode(v: Conservation) { this._c.conservationMode = v; this._push(); }

    get colorMode(): ColorMode | undefined { return this._c.colorMode; }
    set colorMode(v: ColorMode | undefined) { this._c.colorMode = v; this._push(); }

    get dragBehavior(): DragBehavior | undefined { return this._c.dragBehavior; }
    set dragBehavior(v: DragBehavior | undefined) { this._c.dragBehavior = v; this._push(); }

    get exitFade(): boolean | undefined { return this._c.exitFade; }
    set exitFade(v: boolean | undefined) { this._c.exitFade = v; this._push(); }

    get showBreadcrumb(): boolean { return this._c.showBreadcrumb; }
    set showBreadcrumb(v: boolean) { this._c.showBreadcrumb = v; this._push(); }

    get showRoot(): boolean { return this._c.showRoot; }
    set showRoot(v: boolean) { this._c.showRoot = v; this._push(); }

    get drillNodeId(): string | null { return (this as any)._drillId?.value ?? null; }
    set drillNodeId(id: string | null) { this.drill(id); }

    /** The root currently retained (refcounted) by this element. */
    private _retained: BiNode | null = null;

    /** Retain `root` (release any previously retained root) and (re)attach
     *  the reorder listener. Called on root set and on reconnect. */
    private _retain(root: BiNode | null) {
      if (root === this._retained) return;
      this._offReorder?.();
      this._offReorder = null;
      if (this._retained) releaseBiRoot(this._retained);
      this._retained = root;
      if (root) {
        retainBiRoot(root);
        this._offReorder = onBiReorder(root, (parentId, ids) => {
          this.onReorder?.(parentId, ids);
        });
      }
    }

    private _setRoot(root: BiNode | null) {
      if (root === this._c.root) return;
      this._c.root = root;
      this._push();
    }

    /** Map legacy props → ChartConfig and hand it to the base. */
    private _push() {
      const c = this._c;
      if (!c.root) return;
      this._retain(c.root);
      const datasetId = adoptBiRoot(c.root);
      if (!this._kernelSet) {
        this.kernel = sharedKernel;
        this._kernelSet = true;
      }
      const depth = c.maxDepth && c.maxDepth > 0 ? c.maxDepth : undefined;
      this.config = {
        datasetId,
        measure: "total",
        sort: c.sortBy,
        depth,
        // Radial charts (sunburst) simply ignore orientation; it is not part
        // of the DataView query key, so passing it is harmless.
        orientation: c.orientation,
        canReorder: c.canReorder,
        // If dragBehavior is explicitly set, use it; otherwise derive from
        // canReorder + sortBy (legacy default).
        dragBehavior: c.dragBehavior
          ?? (c.canReorder && c.sortBy === "index" ? "reorder" : "resize"),
        conservationMode: c.conservationMode,
        showRoot: c.showRoot,
        showBreadcrumb: c.showBreadcrumb,
        colorMode: c.colorMode,
        exitFade: c.exitFade,
      };
    }

    connectedCallback() {
      super.connectedCallback();
      // Reconnect (dock move, tab reparent): re-retain the root that the
      // disconnect released so the two-way sync is live again.
      if (this._c.root) this._push();
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this._retain(null);
    }
  }
  return BiCompat;
}
