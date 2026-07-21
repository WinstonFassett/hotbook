// side-table.ts — bireactive treetable on the same Kernel as the icicle.
// All cells are editable (not just leaves). When a parent is edited, the delta
// is distributed proportionally to its leaf descendants. The bireactive tree
// (leaf = writable num, parent = total of children) cascades changes upward
// automatically, so every cell in the table updates live during a drag.
//
// Uses the Gesture/Editor model: cell drag → draft → commit/cancel.
// Shares the Kernel with the icicle; committed values propagate via "updated".

import { cell, derive, effect, type Cell } from "bireactive";
import type { ChartConfig, DataNode } from "./types";
import { Kernel } from "./kernel";
import { DataView } from "./data-view";
import { Gesture } from "./gesture";
import {
  buildTree,
  findNode,
  leafValues,
  snapshotValues,
  restoreValues,
  type ChartNode,
} from "./hierarchy";
import { bindChart, rebuildTree } from "./chart-binding";

const INDENT = 16;

interface Row {
  node: ChartNode;
  depth: number;
}

export class SideTable extends HTMLElement {
  private _kernel: Kernel | null = null;
  private _config: ChartConfig | null = null;
  private _treeRoot: Cell<ChartNode | null> = cell<ChartNode | null>(null);
  private _gesture: Gesture | null = null;
  private _dataView: DataView | null = null;
  private _unsub: (() => void) | null = null;
  private _disposers: (() => void)[] = [];
  private _container: HTMLDivElement | null = null;
  private _drillId: string | null = null;
  private _drillUnsub: (() => void) | null = null;

  /** Drill channel key — matches the icicle's drillKey to sync drill state. */
  drillKey = "default";

  set kernel(k: Kernel) {
    this._kernel = k;
    // Subscribe to drill changes on our channel.
    this._drillUnsub?.();
    this._drillUnsub = k.subscribeDrill((datasetId, drillKey, nodeId) => {
      if (!this._config || this._config.datasetId !== datasetId) return;
      if (drillKey !== this.drillKey) return;
      this._drillId = nodeId;
      this._render();
    });
    this._rebuild();
  }

  set config(c: ChartConfig) {
    this._config = c;
    this._rebuild();
  }

  get dataView() {
    return this._dataView;
  }

  private _rebuild(): void {
    if (!this._kernel || !this._config) return;

    this._disposers.forEach((d) => d());
    this._disposers = [];
    this._unsub?.();
    this._dataView?.dispose();
    this._gesture?.dispose();

    const cfg = this._config;
    this._gesture = new Gesture(undefined, cfg);
    this._gesture.store.host = this;
    this._gesture.store.tree = this._treeRoot;

    this._dataView = new DataView(this._kernel, cfg, this._gesture.editor);
    this._unsub = bindChart({
      treeRoot: this._treeRoot,
      gesture: this._gesture,
      dataView: this._dataView,
      rebuild: () => {
        rebuildTree(this._dataView!, this._treeRoot);
        this._render();
      },
    });

    rebuildTree(this._dataView, this._treeRoot);
    this._render();
  }

  connectedCallback(): void {
    if (!this._container) {
      this._container = document.createElement("div");
      this._container.style.cssText =
        "width:100%;height:100%;overflow-y:auto;font-size:12px;font-family:inherit;";
      this.appendChild(this._container);
    }
    this._render();
  }

  disconnectedCallback(): void {
    this._disposers.forEach((d) => d());
    this._disposers = [];
    this._unsub?.();
    this._drillUnsub?.();
    this._dataView?.dispose();
    this._gesture?.dispose();
  }

  private _render(): void {
    if (!this._container) return;
    const root = this._treeRoot.value;
    this._container.innerHTML = "";
    this._container.appendChild(header());

    if (!root) return;

    const rows = this._collectRows(root);
    for (const row of rows) {
      this._container.appendChild(this._buildRow(row));
    }
  }

  private _collectRows(root: ChartNode): Row[] {
    // If drilled into a node, filter to that node's subtree.
    let startNode: ChartNode = root;
    if (this._drillId) {
      const found = findNode(root, this._drillId);
      if (found) startNode = found;
    }
    const rows: Row[] = [];
    const walk = (node: ChartNode, depth: number) => {
      rows.push({ node, depth });
      for (const child of node.children) walk(child, depth + 1);
    };
    walk(startNode, 0);
    return rows;
  }

  private _buildRow(row: Row): HTMLDivElement {
    const { node, depth } = row;

    const el = document.createElement("div");
    el.style.cssText = "display:flex;align-items:center;padding:3px 8px;cursor:default;";

    // Name cell
    const name = document.createElement("div");
    name.style.cssText = `flex:1;display:flex;align-items:center;gap:4px;padding-left:${depth * INDENT}px;min-width:0;`;

    const dot = document.createElement("span");
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${node.color};flex-shrink:0;`;
    name.appendChild(dot);

    const label = document.createElement("span");
    label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:oklch(0.88 0 0);";
    label.textContent = node.label;
    name.appendChild(label);
    el.appendChild(name);

    // Value cell — bireactive: effect updates textContent when tree value changes.
    const valCell = document.createElement("div");
    valCell.dataset.id = node.id;
    valCell.className = "value";
    valCell.style.cssText =
      "width:80px;text-align:right;color:oklch(0.7 0 0);font-variant-numeric:tabular-nums;user-select:none;cursor:ns-resize;touch-action:none;";
    valCell.textContent = fmtNum(node.value.value);

    // Live update: when the node's value changes (via bireactive cascade), update the cell.
    const disposer = effect(() => {
      valCell.textContent = fmtNum(node.value.value);
    });
    this._disposers.push(disposer);

    this._attachCellDrag(valCell, node);
    el.appendChild(valCell);
    return el;
  }

  /** Distribute a delta across a node's leaf descendants proportionally. */
  private _distributeDelta(node: ChartNode, delta: number): void {
    const leaves = this._collectLeaves(node);
    if (leaves.length === 0) return;
    const total = leaves.reduce((sum, l) => sum + l.value.value, 0);
    if (total <= 0) {
      // Even split if all zeros
      const each = delta / leaves.length;
      for (const l of leaves) l.value.value = Math.max(0, l.value.value + each);
      return;
    }
    for (const l of leaves) {
      const share = (l.value.value / total) * delta;
      l.value.value = Math.max(0, l.value.value + share);
    }
  }

  private _collectLeaves(node: ChartNode): ChartNode[] {
    const leaves: ChartNode[] = [];
    const walk = (n: ChartNode) => {
      if (n.children.length === 0) leaves.push(n);
      else for (const c of n.children) walk(c);
    };
    walk(node);
    return leaves;
  }

  private _attachCellDrag(cell: HTMLDivElement, node: ChartNode): void {
    if (!this._dataView || !this._gesture) return;
    const dv = this._dataView;
    const g = this._gesture;
    let startY = 0;
    let startVal = 0;
    let dragging = false;

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      const newVal = Math.max(0, startVal + dy * 0.5);

      if (g.state !== "Drafting") return; // cancelled

      // Write to the tree: if leaf, write directly; if parent, distribute.
      const delta = newVal - startVal;
      if (node.children.length === 0) {
        node.value.value = newVal;
      } else {
        // Reset to start, then distribute the full delta
        // (since previous drag moves already modified leaves)
        if (g.store.snapshot) restoreValues(this._treeRoot.value!, g.store.snapshot);
        this._distributeDelta(node, delta);
      }

      dv.updateDraft({
        nodeId: node.id,
        value: newVal,
        source: "table-cell",
        intent: "edit",
      });
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      cell.style.background = "";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (g.state === "Drafting") dv.commit();
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      startVal = node.value.value;
      cell.style.background = "oklch(0.28 0.1 240)";

      // Snapshot before first write
      const root = this._treeRoot.value!;
      g.store.snapshot = snapshotValues(root);

      // Initial draft
      const delta = 0; // no movement yet
      if (node.children.length > 0) {
        this._distributeDelta(node, delta);
      }
      dv.draft({
        nodeId: node.id,
        value: startVal,
        source: "table-cell",
        intent: "edit",
      });

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    };

    cell.addEventListener("pointerdown", onDown);
  }
}

function header(): HTMLDivElement {
  const h = document.createElement("div");
  h.style.cssText =
    "display:flex;padding:4px 8px;border-bottom:1px solid oklch(0.25 0 0);position:sticky;top:0;background:oklch(0.18 0 0);z-index:1;";
  const name = document.createElement("div");
  name.style.cssText = "flex:1;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;";
  name.textContent = "Name";
  h.appendChild(name);
  const val = document.createElement("div");
  val.style.cssText =
    "width:80px;text-align:right;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;";
  val.textContent = "Value";
  h.appendChild(val);
  return h;
}

function fmtNum(v: number): string {
  if (v === 0) return "";
  if (v < 10) return v.toFixed(1);
  return Math.round(v).toString();
}

customElements.define("v-side-table", SideTable);
