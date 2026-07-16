// side-table.ts — flat hierarchical table on the same DataView as the icicle.
//
// Subscribes to the DataView, renders rows with editable value cells.
// Cell edits produce draft events. Cross-tile: the icicle sees the same drafts.

import type { ChartConfig, DraftEvent, RenderNode } from "./types";
import { Kernel, findNode, findParent } from "./kernel";
import { DataView, type DataViewEvent } from "./data-view";

const INDENT = 16;

export class SideTable extends HTMLElement {
  private _kernel: Kernel | null = null;
  private _config: ChartConfig | null = null;
  private _dataView: DataView | null = null;
  private _unsub: (() => void) | null = null;
  private _collapsed = new Set<string>();
  private _container: HTMLDivElement | null = null;

  set kernel(k: Kernel) {
    this._kernel = k;
    this._connect();
  }

  set config(c: ChartConfig) {
    this._config = c;
    this._connect();
  }

  private _connect(): void {
    if (!this._kernel || !this._config) return;
    this._dataView?.dispose();
    this._dataView = new DataView(this._kernel, this._config);
    this._unsub = this._dataView.subscribe((event) => this._onEvent(event));
    this._render();
  }

  connectedCallback(): void {
    if (!this._container) {
      this._container = document.createElement("div");
      this._container.style.cssText =
        "width:100%;height:100%;overflow-y:auto;font-size:12px;font-family:inherit;padding-top:28px;";
      this.appendChild(this._container);
    }
    if (this._dataView) this._render();
  }

  disconnectedCallback(): void {
    this._unsub?.();
    this._dataView?.dispose();
  }

  private _onEvent(event: DataViewEvent): void {
    if (event.type === "updated" && event.window) {
      this._render();
    } else if (event.type === "draft" && event.draft) {
      // Highlight the drafted cell and update text
      this._highlightDraftCell(event.draft.nodeId, event.isActive, event.draft.value);
    } else if (event.type === "commit") {
      this._clearDraftHighlight();
      // The Kernel publish from commit triggers an updated → re-render
    } else if (event.type === "cancel") {
      this._clearDraftHighlight();
      // No Kernel write on cancel — re-render to revert cell text to committed
      this._render();
    }
  }

  private _render(): void {
    if (!this._container || !this._dataView) return;
    const win = this._dataView.getWindow();

    // Build visible rows (respect collapsed state)
    const rows = this._computeVisible(win);

    // Clear and rebuild
    this._container.innerHTML = "";

    // Header
    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;padding:4px 8px;border-bottom:1px solid oklch(0.25 0 0);position:sticky;top:0;background:oklch(0.18 0 0);z-index:1;";
    const nameH = document.createElement("div");
    nameH.style.cssText = "flex:1;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;";
    nameH.textContent = "Name";
    header.appendChild(nameH);
    const valH = document.createElement("div");
    valH.style.cssText = "width:80px;text-align:right;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;";
    valH.textContent = "Value";
    header.appendChild(valH);
    this._container.appendChild(header);

    for (const node of rows) {
      const row = this._buildRow(node);
      this._container.appendChild(row);
    }
  }

  private _computeVisible(win: RenderNode[]): RenderNode[] {
    const byId = new Map(win.map((n) => [n.id, n]));
    const result: RenderNode[] = [];
    const roots = win.filter((n) => !n.parentId || !byId.has(n.parentId));

    function walk(node: RenderNode) {
      result.push(node);
      if (node.children.length > 0 && !this._collapsed.has(node.id)) {
        for (const child of node.children) {
          const found = byId.get(child.id);
          if (found) walk.call(this, found);
          else walk.call(this, child);
        }
      }
    }

    for (const root of roots) walk.call(this, root);
    return result;
  }

  private _buildRow(node: RenderNode): HTMLDivElement {
    const row = document.createElement("div");
    row.dataset.id = node.id;
    row.style.cssText =
      "display:flex;align-items:center;padding:3px 8px;cursor:default;transition:background 80ms;";
    row.addEventListener("mouseenter", () => (row.style.background = "oklch(0.22 0 0)"));
    row.addEventListener("mouseleave", () => (row.style.background = ""));

    const indent = (node.depth - 1) * INDENT;

    // Name cell
    const nameCell = document.createElement("div");
    nameCell.style.cssText = `flex:1;display:flex;align-items:center;gap:4px;padding-left:${indent}px;min-width:0;`;
    if (node.children.length > 0) {
      const twist = document.createElement("button");
      twist.style.cssText =
        "all:unset;cursor:pointer;width:14px;text-align:center;color:oklch(0.5 0 0);font-size:10px;flex-shrink:0;";
      twist.textContent = this._collapsed.has(node.id) ? "▸" : "▾";
      twist.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this._collapsed.has(node.id)) this._collapsed.delete(node.id);
        else this._collapsed.add(node.id);
        this._render();
      });
      nameCell.appendChild(twist);
    } else {
      const spacer = document.createElement("span");
      spacer.style.cssText = "width:14px;flex-shrink:0;";
      nameCell.appendChild(spacer);
    }
    const dot = document.createElement("span");
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${node.color};flex-shrink:0;`;
    nameCell.appendChild(dot);
    const label = document.createElement("span");
    label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:oklch(0.88 0 0);";
    label.textContent = node.label;
    nameCell.appendChild(label);
    row.appendChild(nameCell);

    // Value cell (editable)
    const valCell = document.createElement("div");
    valCell.dataset.id = node.id;
    valCell.className = "value";
    valCell.style.cssText =
      "width:80px;text-align:right;color:oklch(0.7 0 0);font-variant-numeric:tabular-nums;cursor:ew-resize;touch-action:none;user-select:none;";
    valCell.textContent = fmtNum(node.value);
    this._attachCellDrag(valCell, node);
    row.appendChild(valCell);

    return row;
  }

  private _attachCellDrag(cell: HTMLDivElement, node: RenderNode): void {
    let startY = 0;
    let startVal = 0;
    let dragging = false;
    let pointerId = 0;

    const onMove = (e: PointerEvent) => {
      if (!dragging || !this._dataView) return;
      const dy = startY - e.clientY;
      // Reduce sensitivity for smoother drag
      const newVal = Math.max(0, Math.round(startVal + dy * 0.5));
      cell.textContent = fmtNum(newVal);

      if (this._dataView.editor.state === "Idle") {
        this._dataView.draft({ nodeId: node.id, value: newVal, source: "table-cell", intent: "edit" });
      } else {
        this._dataView.updateDraft({ nodeId: node.id, value: newVal, source: "table-cell", intent: "edit" });
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      cell.style.background = "";
      if (!this._dataView) return;
      // If the editor was cancelled (e.g. by Esc), don't commit
      if (this._dataView.editor.state !== "Drafting") return;
      // Commit: write to Kernel
      const draft = this._dataView.editor.currentDraft;
      if (draft && draft.intent === "edit") {
        this._kernel!.writeValue(this._config!.datasetId, draft.nodeId, draft.value);
      }
      this._dataView.commit();
    };

    const onDown = (e: PointerEvent) => {
      if (!this._dataView) return;
      e.preventDefault();
      dragging = true;
      pointerId = e.pointerId;
      startY = e.clientY;
      startVal = node.value;
      cell.style.background = "oklch(0.25 0 0)";
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    };

    cell.addEventListener("pointerdown", onDown);
  }

  private _highlightDraftCell(nodeId: string, isActive: boolean, draftValue?: number): void {
    this._clearDraftHighlight();
    const cell = this._container?.querySelector(`.value[data-id="${nodeId}"]`) as HTMLDivElement | null;
    if (cell) {
      cell.style.background = isActive ? "oklch(0.28 0 0.1 240)" : "oklch(0.22 0 0)";
      // Update cell text to show draft value
      if (draftValue !== undefined) {
        cell.textContent = fmtNum(draftValue);
      }
    }
  }

  private _clearDraftHighlight(): void {
    const cells = this._container?.querySelectorAll(".value");
    cells?.forEach((c) => {
      (c as HTMLElement).style.background = "";
    });
    // Re-render to show committed values
    this._render();
  }
}

function fmtNum(v: number): string {
  if (v === 0) return "";
  if (v < 10) return v.toFixed(1);
  return Math.round(v).toString();
}

customElements.define("v-side-table", SideTable);
