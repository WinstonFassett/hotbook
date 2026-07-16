// side-table.ts — flat hierarchical table on the same DataView as the icicle.
// Cell drags on leaves produce draft events; the table writes on its own commit.

import type { ChartConfig, DraftEvent, RenderNode } from "./types";
import { Kernel } from "./kernel";
import { DataView, type DataViewEvent } from "./data-view";

const INDENT = 16;

export class SideTable extends HTMLElement {
  private _kernel: Kernel | null = null;
  private _dataView: DataView | null = null;
  private _unsub: (() => void) | null = null;
  private _container: HTMLDivElement | null = null;

  set kernel(k: Kernel) {
    this._kernel = k;
    this._connect();
  }

  set config(c: ChartConfig) {
    this._connect(c);
  }

  private _connect(nextConfig?: ChartConfig): void {
    if (!this._kernel) return;
    const cfg = nextConfig ?? this._dataView?.config;
    if (!cfg) return;
    this._dataView?.dispose();
    this._dataView = new DataView(this._kernel, cfg);
    this._unsub = this._dataView.subscribe((e) => this._onEvent(e));
    this._render();
  }

  connectedCallback(): void {
    if (!this._container) {
      this._container = document.createElement("div");
      this._container.style.cssText =
        "width:100%;height:100%;overflow-y:auto;font-size:12px;font-family:inherit;padding-top:28px;";
      this.appendChild(this._container);
    }
    this._render();
  }

  disconnectedCallback(): void {
    this._unsub?.();
    this._dataView?.dispose();
  }

  private _onEvent(event: DataViewEvent): void {
    if (event.type === "updated") {
      if (this._dataView?.editor.state === "Drafting") return;
      this._render();
      return;
    }

    if (event.type === "draft" && event.draft) {
      const draft = event.draft;
      this._updateCell(draft.nodeId, draft.value, event.isActive);
      if (draft.secondaryNodeId) {
        this._updateCell(draft.secondaryNodeId, draft.secondaryValue ?? 0, event.isActive);
      }
      return;
    }

    if (event.type === "commit") {
      if (event.isActive && event.draft && event.draft.intent === "edit") {
        this._commitValue(event.draft);
      }
      this._clearDraftHighlight();
      return;
    }

    if (event.type === "cancel") {
      this._clearDraftHighlight();
    }
  }

  private _commitValue(draft: DraftEvent): void {
    if (!this._kernel || !this._dataView) return;
    const dsId = this._dataView.config.datasetId;
    if (draft.secondaryNodeId) {
      this._kernel.writeValues(dsId, [
        { nodeId: draft.nodeId, value: draft.value },
        { nodeId: draft.secondaryNodeId, value: draft.secondaryValue ?? 0 },
      ]);
    } else {
      this._kernel.writeValue(dsId, draft.nodeId, draft.value);
    }
  }

  private _updateCell(nodeId: string, value: number, isActive: boolean): void {
    const cell = this._container?.querySelector(`.value[data-id="${nodeId}"]`) as HTMLDivElement | null;
    if (!cell) return;
    cell.textContent = fmtNum(value);
    cell.style.background = isActive ? "oklch(0.28 0.1 240)" : "oklch(0.22 0 0)";
  }

  private _clearDraftHighlight(): void {
    this._container?.querySelectorAll(".value").forEach((c) => {
      (c as HTMLElement).style.background = "";
    });
    this._render();
  }

  private _render(): void {
    if (!this._container || !this._dataView) return;
    const win = this._dataView.getWindow();

    this._container.innerHTML = "";
    this._container.appendChild(header());
    const rows = this._visibleRows(win);
    for (const node of rows) this._container.appendChild(this._buildRow(node));
  }

  private _visibleRows(win: RenderNode[]): RenderNode[] {
    const byId = new Map(win.map((n) => [n.id, n]));
    const result: RenderNode[] = [];
    const roots = win.filter((n) => !n.parentId || !byId.has(n.parentId));

    const walk = (node: RenderNode) => {
      result.push(node);
      for (const child of node.children) {
        const found = byId.get(child.id);
        if (found) walk(found);
      }
    };

    for (const root of roots) walk(root);
    return result;
  }

  private _buildRow(node: RenderNode): HTMLDivElement {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;padding:3px 8px;cursor:default;";

    const name = document.createElement("div");
    name.style.cssText = `flex:1;display:flex;align-items:center;gap:4px;padding-left:${node.depth * INDENT}px;min-width:0;`;

    const dot = document.createElement("span");
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${node.color};flex-shrink:0;`;
    name.appendChild(dot);

    const label = document.createElement("span");
    label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:oklch(0.88 0 0);";
    label.textContent = node.label;
    name.appendChild(label);
    row.appendChild(name);

    const valCell = document.createElement("div");
    valCell.dataset.id = node.id;
    valCell.className = "value";
    valCell.style.cssText =
      "width:80px;text-align:right;color:oklch(0.7 0 0);font-variant-numeric:tabular-nums;user-select:none;";
    valCell.textContent = fmtNum(node.value);

    if (node.children.length === 0) {
      valCell.style.cursor = "ns-resize";
      valCell.style.touchAction = "none";
      this._attachCellDrag(valCell, node);
    }

    row.appendChild(valCell);
    return row;
  }

  private _attachCellDrag(cell: HTMLDivElement, node: RenderNode): void {
    if (!this._dataView) return;
    const dv = this._dataView;
    let startY = 0;
    let startVal = 0;
    let dragging = false;

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      const newVal = Math.max(0, Math.round(startVal + dy * 0.5));
      if (dv.editor.state === "Idle") {
        dv.draft({ nodeId: node.id, value: newVal, source: "table-cell", intent: "edit" });
      } else {
        dv.updateDraft({ nodeId: node.id, value: newVal, source: "table-cell", intent: "edit" });
      }
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (dv.editor.state === "Drafting") dv.commit();
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      startVal = node.value;
      cell.style.background = "oklch(0.28 0.1 240)";
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
