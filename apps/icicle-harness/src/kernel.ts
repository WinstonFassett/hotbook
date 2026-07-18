// kernel.ts — central data service.
// Owns canonical Datasets by id, publishes data updates, brokers DataViews
// keyed by canonical config, tracks active Editors via Drafts.
//
// Pubsub: components subscribe. Kernel pushes nothing imperatively.
// The Kernel stores values; charts and tables project them.

import type { ChartConfig, DataNode, Dataset, DraftEvent } from "./types";
import { Drafts } from "./editor";

/** Recompute group values as sum of children (leaves are authoritative). */
function recomputeSums(node: DataNode): number {
  if (node.children.length === 0) return node.value;
  node.value = node.children.reduce((s, c) => s + recomputeSums(c), 0);
  return node.value;
}

/** Find a node by id in the tree. */
export function findNode(root: DataNode, id: string): DataNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** Find the parent of a node by id. */
export function findParent(root: DataNode, id: string): DataNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

/** Canonical config key — two charts with the same key share a DataView.
 *  Only query fields (datasetId, measure, depth) are hashed. Render fields
 *  (sort, orientation, conservationMode, canReorder) are chart-applied and
 *  do not affect the DataView key. A render-field change is an `updated`
 *  on the same DataView, not a rebuild. */
export function configKey(config: ChartConfig): string {
  return `${config.datasetId}:${config.measure}:${config.depth ?? "all"}`;
}

/** Listener for data updates from the Kernel. */
export type KernelListener = (datasetId: string) => void;

/** Listener for draft events broadcast to all DataViews on the same dataset. */
export type DraftBroadcastListener = (draft: DraftEvent, phase: "draft" | "commit" | "cancel") => void;

/** Listener for drill-state changes on a dataset+drillKey channel. */
export type DrillListener = (datasetId: string, drillKey: string, nodeId: string | null) => void;

export class Kernel {
  private _datasets = new Map<string, Dataset>();
  private _listeners = new Set<KernelListener>();
  private _draftListeners = new Set<DraftBroadcastListener>();
  private _drillState = new Map<string, string | null>(); // key: `${datasetId}:${drillKey}`
  private _drillListeners = new Set<DrillListener>();
  readonly drafts = new Drafts();

  /** Register a dataset by id. Computes group sums from leaves. */
  registerDataset(dataset: Dataset): void {
    recomputeSums(dataset.root);
    this._datasets.set(dataset.id, dataset);
  }

  /** Get a dataset by id. */
  getDataset(id: string): Dataset | undefined {
    return this._datasets.get(id);
  }

  /** Write a value to a node. This is a committed write (not a draft).
   *  Recomputes parent sums and publishes the update. */
  writeValue(datasetId: string, nodeId: string, value: number): void {
    const ds = this._datasets.get(datasetId);
    if (!ds) return;
    const node = findNode(ds.root, nodeId);
    if (!node) return;
    node.value = value;
    recomputeSums(ds.root);
    this._publish(datasetId);
  }

  /** Write multiple node values atomically (e.g. two-sibling reapportion:
   *  both siblings change, parent sum preserved). Recomputes sums once and
   *  publishes a single update. */
  writeValues(datasetId: string, writes: Array<{ nodeId: string; value: number }>): void {
    const ds = this._datasets.get(datasetId);
    if (!ds) return;
    for (const w of writes) {
      const node = findNode(ds.root, w.nodeId);
      if (node) node.value = w.value;
    }
    recomputeSums(ds.root);
    this._publish(datasetId);
  }

  /** Write a reorder: new children order for a parent. */
  writeReorder(datasetId: string, parentId: string, orderedIds: string[]): void {
    const ds = this._datasets.get(datasetId);
    if (!ds) return;
    const parent = findNode(ds.root, parentId);
    if (!parent) return;
    const byId = new Map(parent.children.map((c) => [c.id, c]));
    parent.children = orderedIds.map((id) => byId.get(id)).filter(Boolean) as DataNode[];
    this._publish(datasetId);
  }

  /** Broadcast a draft event to all subscribers (cross-tile).
   *  Charts that are not the active editor receive this and render the preview. */
  broadcastDraft(draft: DraftEvent, phase: "draft" | "commit" | "cancel"): void {
    for (const fn of this._draftListeners) fn(draft, phase);
  }

  /** Subscribe to committed data updates. */
  subscribe(fn: KernelListener): () => void {
    this._listeners.add(fn);
    return () => {
      this._listeners.delete(fn);
    };
  }

  /** Subscribe to draft broadcasts (cross-tile). */
  subscribeDrafts(fn: DraftBroadcastListener): () => void {
    this._draftListeners.add(fn);
    return () => {
      this._draftListeners.delete(fn);
    };
  }

  /** Set the drill focus for a dataset+drillKey channel. Publishes to all
   *  subscribers on that channel. `null` = drill out to root. */
  setDrill(datasetId: string, drillKey: string, nodeId: string | null): void {
    const key = `${datasetId}:${drillKey}`;
    this._drillState.set(key, nodeId);
    for (const fn of this._drillListeners) fn(datasetId, drillKey, nodeId);
  }

  /** Get the current drill focus for a dataset+drillKey channel. */
  getDrill(datasetId: string, drillKey: string): string | null {
    return this._drillState.get(`${datasetId}:${drillKey}`) ?? null;
  }

  /** Subscribe to drill-state changes. Listener fires for every channel;
   *  filter by datasetId + drillKey in the callback. */
  subscribeDrill(fn: DrillListener): () => void {
    this._drillListeners.add(fn);
    return () => {
      this._drillListeners.delete(fn);
    };
  }

  private _publish(datasetId: string): void {
    for (const fn of this._listeners) fn(datasetId);
  }

  /** Test-only: force publish without recomputing sums (to break conservation) */
  forcePublish(datasetId: string): void {
    this._publish(datasetId);
  }

  /** Test-only: set node value without recomputing sums (breaks conservation) */
  setNodeValueNoRecompute(datasetId: string, nodeId: string, value: number): void {
    const ds = this._datasets.get(datasetId);
    if (!ds) return;
    const node = findNode(ds.root, nodeId);
    if (node) node.value = value;
  }
}
