// data-view.ts — the chart's query-keyed subscription into the Kernel.
//
// Keyed by canonical config. Attaches on mount, detaches on dismount.
// Routes Kernel events to the Chart: committed data updates and cross-tile
// draft broadcasts. The Chart decides what to render.
//
// The DataView also owns the Editor lifecycle for this chart: it creates
// the Editor, registers it with Kernel.Drafts, and wires draft/commit/cancel
// to broadcast to other DataViews on the same dataset.

import type { ChartConfig, DataNode, DraftEvent, RenderNode } from "./types";
import { Kernel, configKey, findNode, findParent } from "./kernel";
import { Editor } from "./editor";

/** Event the Chart receives from the DataView. */
export interface DataViewEvent {
  type: "updated" | "draft" | "commit" | "cancel";
  /** The full rendered window (for updated/commit/cancel). */
  window?: RenderNode[];
  /** The draft (for draft events). */
  draft?: DraftEvent;
  /** Whether this chart is the active editor (vs receiving a cross-tile draft). */
  isActive: boolean;
}

export type DataViewListener = (event: DataViewEvent) => void;

/** Build the rendered window from the dataset + config + drill focus. */
function buildWindow(
  root: DataNode,
  config: ChartConfig,
  drillId: string | null,
): RenderNode[] {
  const result: RenderNode[] = [];
  const depthCap = config.depth;

  // Find focus node
  const focusNode = drillId ? findNode(root, drillId) : null;
  const startNode = focusNode ?? root;
  const baseDepth = focusNode ? getDepth(root, drillId!) : 0;

  // If drilled, include ancestors (for drill-out transitions)
  if (focusNode) {
    let ancestor: DataNode | null = focusNode;
    const ancestors: DataNode[] = [];
    while (ancestor && ancestor !== root) {
      ancestors.unshift(ancestor);
      ancestor = findParent(root, ancestor.id);
    }
    for (const a of ancestors) {
      const d = getDepth(root, a.id);
      result.push(toRenderNode(a, d, root, config));
    }
  }

  // Walk the subtree from startNode
  walk(startNode, baseDepth, root, config, depthCap, result);
  return result;
}

function walk(
  node: DataNode,
  depth: number,
  root: DataNode,
  config: ChartConfig,
  depthCap: number | undefined,
  out: RenderNode[],
): void {
  const children = node.children;
  const sorted = config.sort === "value"
    ? children.slice().sort((a, b) => b.value - a.value)
    : children;

  for (const child of sorted) {
    const childDepth = depth + 1;
    if (depthCap !== undefined && childDepth > baseDepthOf(root, config) + depthCap) {
      // Still walk to compute sums, but don't add to window
      if (child.children.length > 0) {
        walk(child, childDepth, root, config, depthCap, out);
      }
      continue;
    }
    out.push(toRenderNode(child, childDepth, root, config));
    if (child.children.length > 0) {
      walk(child, childDepth, root, config, depthCap, out);
    }
  }
}

function baseDepthOf(_root: DataNode, _config: ChartConfig): number {
  return 0; // simplified — depth is relative to focus
}

function getDepth(root: DataNode, id: string): number {
  function walk(node: DataNode, depth: number): number | null {
    if (node.id === id) return depth;
    for (const child of node.children) {
      const d = walk(child, depth + 1);
      if (d !== null) return d;
    }
    return null;
  }
  return walk(root, 0) ?? 0;
}

function toRenderNode(node: DataNode, depth: number, root: DataNode, _config: ChartConfig): RenderNode {
  const parent = findParent(root, node.id);
  const sortedChildren = _config.sort === "value"
    ? node.children.slice().sort((a, b) => b.value - a.value)
    : node.children;

  return {
    id: node.id,
    label: node.label,
    color: node.color ?? defaultColor(depth),
    value: node.value,
    depth,
    parentId: parent?.id ?? null,
    isLeaf: node.children.length === 0,
    children: sortedChildren.map((c) => toRenderNode(c, depth + 1, root, _config)),
  };
}

function defaultColor(depth: number): string {
  const hues = [240, 200, 160, 120, 80, 40, 0, 300];
  const h = hues[depth % hues.length];
  return `oklch(0.6 0.12 ${h})`;
}

export class DataView {
  readonly kernel: Kernel;
  readonly config: ChartConfig;
  readonly editor: Editor;
  readonly key: string;

  private _listeners = new Set<DataViewListener>();
  private _drillId: string | null = null;
  private _unsubKernel: (() => void) | null = null;
  private _unsubDrafts: (() => void) | null = null;
  private _unsubEditor: (() => void) | null = null;
  private _disposed = false;

  constructor(kernel: Kernel, config: ChartConfig) {
    this.kernel = kernel;
    this.config = config;
    this.key = configKey(config);
    this.editor = new Editor();
    kernel.drafts.register(this.editor);

    // Subscribe to Kernel data updates
    this._unsubKernel = kernel.subscribe((datasetId) => {
      if (datasetId !== config.datasetId) return;
      this._emitUpdated();
    });

    // Subscribe to cross-tile draft broadcasts
    this._unsubDrafts = kernel.subscribeDrafts((draft, phase) => {
      if (this._disposed) return;
      // Only receive drafts from other charts (not our own)
      if (this.editor.state === "Drafting") return;
      for (const fn of this._listeners) {
        fn({
          type: phase,
          draft,
          isActive: false,
        });
      }
    });

    // Wire editor transitions to broadcast + emit
    this._unsubEditor = this.editor.subscribe((t) => {
      if (t.type === "draft") {
        kernel.drafts.onDraftStart(this.editor);
        kernel.broadcastDraft(t.draft!, "draft");
      } else if (t.type === "commit") {
        kernel.drafts.onDraftEnd(this.editor);
        // The chart's commit effect writes the value to the Kernel.
        // The Kernel publish triggers _emitUpdated for all subscribers.
        // Broadcast commit so other charts transition off the draft overlay.
        if (t.draft) kernel.broadcastDraft(t.draft, "commit");
      } else if (t.type === "cancel") {
        kernel.drafts.onDraftEnd(this.editor);
        if (t.draft) kernel.broadcastDraft(t.draft, "cancel");
      }
      // Emit to local listeners (the chart)
      this._emitLocal(t.type, t.draft);
    });
  }

  get drillId(): string | null {
    return this._drillId;
  }

  setDrill(id: string | null): void {
    this._drillId = id;
    this._emitUpdated();
  }

  /** Start a draft from this chart's control surface. */
  draft(event: DraftEvent): void {
    this.editor.draft(event);
  }

  /** Update an in-progress draft. */
  updateDraft(event: DraftEvent): void {
    this.editor.draft(event); // draft while Drafting = update
  }

  /** Commit the current draft. The chart should write the value to the
   *  Kernel in its commit effect. */
  commit(): void {
    this.editor.commit();
  }

  /** Cancel the current draft. */
  cancel(): void {
    this.editor.cancel();
  }

  /** Get the current rendered window. */
  getWindow(): RenderNode[] {
    const ds = this.kernel.getDataset(this.config.datasetId);
    if (!ds) return [];
    return buildWindow(ds.root, this.config, this._drillId);
  }

  subscribe(fn: DataViewListener): () => void {
    this._listeners.add(fn);
    return () => {
      this._listeners.delete(fn);
    };
  }

  dispose(): void {
    this._disposed = true;
    this._unsubKernel?.();
    this._unsubDrafts?.();
    this._unsubEditor?.();
    this.editor.dispose();
    this._listeners.clear();
  }

  private _emitUpdated(): void {
    if (this._disposed) return;
    const win = this.getWindow();
    for (const fn of this._listeners) {
      fn({ type: "updated", window: win, isActive: true });
    }
  }

  private _emitLocal(type: "draft" | "commit" | "cancel" | "updated", draft?: DraftEvent): void {
    if (this._disposed) return;
    const win = type === "updated" ? this.getWindow() : undefined;
    for (const fn of this._listeners) {
      fn({ type, window: win, draft, isActive: true });
    }
  }
}
