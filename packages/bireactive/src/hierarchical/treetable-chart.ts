// treetable-chart.ts — hierarchical treetable on HierarchicalChartBase.
//
// HTML-based (not SVG) scrollable table for hierarchical BiNode data. Extends
// HierarchicalChartBase with: HTML surface override (_createSurface returns a
// scrollable div), row rendering via bireactive effects (rows re-derive on
// tree/config/sort/drill changes), reactive value display (per-row effect reads
// ChartNode's value cell), and numberDrag editing with draft/commit flow.
//
// Supports: expand/collapse twisties (local state), column picker, sort=value,
// maxDepth, drill, row focus/keyboard-edit, and backward-compat with legacy
// BiNode API via the withBiCompat mixin.

import { cell, effect } from "bireactive";
import type { ChartConfig } from "./types";
import { setup } from "./gesture";
import type { ChartNode } from "./tree";
import { findNode } from "./tree";
import { numberDrag } from "../lib/number-drag";
import type { BiNode } from "../lib/tree";
import { keyboardEdit } from "./behaviors/keyboard-edit";
import { prefersReducedMotion, settleTransition } from "./behaviors/transition-on-updated";
import { motion } from "../lib/runtime-config";
import { HierarchicalChartBase } from "./hierarchical-chart-base";

const INDENT_WIDTH = 14;

interface VisibleRow {
  node: ChartNode;
  depth: number;
  hasKids: boolean;
}

function fmtNum(v: number): string {
  if (v === 0) return "";
  if (v < 10) return v.toFixed(1);
  return Math.round(v).toString();
}

// Subtree sum matching the old computeVisible semantics
function subtreeValue(n: ChartNode): number {
  const kids = n.children;
  if (kids.length === 0) return n.value.value;
  return kids.reduce((s, c) => s + subtreeValue(c), 0);
}

function computeVisible(
  root: ChartNode,
  collapsed: Set<string>,
  maxDepth?: number,
  sortBy?: "index" | "value",
  drillId?: string | null,
): VisibleRow[] {
  const out: VisibleRow[] = [];

  // When drilled, the effective root is the drilled node — only its
  // subtree is shown. Depth is relative to the drilled node.
  const effectiveRoot = drillId ? findNode(root, drillId) ?? root : root;

  function walk(node: ChartNode, depth: number) {
    let children = node.children;
    const hasKids = children.length > 0;
    if (hasKids && sortBy === "value") {
      children = children.slice().sort((a, b) => subtreeValue(b) - subtreeValue(a));
    }

    // Add node (skip effective root at depth 0)
    if (depth > 0) {
      out.push({ node, depth, hasKids });
    }

    // Add children if not collapsed and within maxDepth
    const withinDepth = maxDepth === undefined || depth < maxDepth;
    if (hasKids && !collapsed.has(node.id) && withinDepth) {
      for (const child of children) {
        walk(child, depth + 1);
      }
    }
  }

  walk(effectiveRoot, 0);
  return out;
}

export interface ColumnDef {
  key: string;
  label: string;
  width?: number;
  visible?: boolean;
}

export class TreetableChart extends HierarchicalChartBase {
  static tag = "v-treetable";

  private _collapsedCell = cell(new Set<string>());
  private _columnVisibility = new Map<string, boolean>();
  private _valueEffectDisposers = new Map<string, () => void>();
  private _numberDragDisposers = new Map<string, () => void>();
  private _renderListeners = new Set<(allNodeIds: string[]) => void>();
  private _root?: HTMLDivElement;
  private _body?: HTMLDivElement;
  /** Bumped by refresh()/columns writes to force a re-render. */
  private _renderTick = cell(0);

  // --- Legacy column API ---
  private _columns?: ColumnDef[];
  /** Explicit column set (legacy API). When unset, columns auto-detect from
   *  the compat BiNode root's measures; fallback is a single Value column. */
  get columns(): ColumnDef[] | undefined { return this._columns; }
  set columns(v: ColumnDef[] | undefined) {
    this._columns = v;
    this._renderTick.value++;
  }

  /** Row enter animations on/off (legacy API). Default on. */
  enableTransitions?: boolean;

  // Override _createSurface to build HTML surface instead of SVG
  protected _createSurface(): void {
    this._root = document.createElement("div");
    this._root.style.cssText =
      "width:100%;height:100%;overflow-y:auto;font-size:12px;font-family:inherit;background:oklch(0.14 0 0);";
    this.appendChild(this._root);
  }

  // --- Hook: chart-specific rendering ---
  protected _setupRendering(): void {
    // Create the render effect that responds to tree/config/collapsed changes
    this._setupDisposers.push(
      effect(() => {
        const root = this._treeRoot.value;
        const config = this._configCell.value;
        const drillId = this._drillId.value;
        const collapsed = this._collapsedCell.value; // reactive dependency
        this._renderTick.value; // reactive: refresh()/columns writes

        if (!root || !config) {
          if (this._body) this._body.innerHTML = "";
          return;
        }

        this._render(root, config, drillId, collapsed);
      }),
    );
  }

  // --- Hook: chart-specific behavior composition ---
  protected _composeBehaviors(): void {
    const gesture = this._gesture!;

    this._behaviorDispose = setup(gesture)(
      keyboardEdit({
        target: () => this._focusCell.value,
        valueOf: () => this.valueOf,
        writeValue: this.writeValue,
        conservationMode: () => this.conservationMode,
        siblings: () => this.siblings,
        frozenOrder: () => this._frozenOrder.value,
      }),
    );
  }

  // --- Rendering logic ---

  private _render(root: ChartNode, config: ChartConfig, drillId: string | null, collapsed: Set<string>): void {
    const visibleColumns = this._getVisibleColumns();
    const singleColumnMode = visibleColumns.length === 1;

    // Lazy-init body
    if (!this._body) {
      this._body = document.createElement("div");
      this._root!.appendChild(this._body);
    }

    // Rebuild header
    const existingHead = this._root!.querySelector("[data-table-header]") as HTMLElement;
    if (existingHead) existingHead.remove();

    const head = this._buildHeader(visibleColumns);
    this._root!.insertBefore(head, this._root!.firstChild);

    // Compute visible rows
    const visible = computeVisible(
      root,
      collapsed,
      config.depth,
      config.sort === "value" ? "value" : "index",
      drillId,
    );
    const allNodeIds: string[] = [];

    // Keyed row update
    const existing = new Map<string, HTMLElement>();
    for (const el of Array.from(this._body.children) as HTMLElement[]) {
      const id = el.dataset.id;
      if (id) existing.set(id, el);
    }

    const fragment = document.createDocumentFragment();
    const newRows: HTMLElement[] = [];
    const animate = this.enableTransitions !== false && !prefersReducedMotion();

    for (const { node, depth, hasKids } of visible) {
      const nodeId = node.id;
      allNodeIds.push(nodeId);

      let row = existing.get(nodeId);
      existing.delete(nodeId);

      if (!row) {
        row = document.createElement("div");
        row.dataset.id = nodeId;
        const baseTransition = animate
          ? `${settleTransition(["opacity", "transform"])}, background ${motion.motionMs.value}ms ease-out`
          : `background ${motion.motionMs.value}ms ease-out`;
        row.style.cssText = `display:flex;align-items:center;padding:3px 8px;cursor:default;transition:${baseTransition};`;
        // Listeners attach ONCE per row element (rows are keyed and reused
        // across renders — re-attaching per render leaks listeners). The
        // click handler delegates: twisty toggles collapse, else focus.
        const el = row;
        el.addEventListener("mouseenter", () => { el.style.background = "oklch(0.22 0 0)"; this.setHover(el.dataset.id!); });
        el.addEventListener("mouseleave", () => { el.style.background = ""; this.setHover(null); });
        el.addEventListener("click", (e) => {
          const twist = (e.target as HTMLElement).closest?.("[data-twist]");
          if (twist) {
            e.stopPropagation();
            const id = twist.getAttribute("data-twist")!;
            const next = new Set(this._collapsedCell.value);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            this._collapsedCell.value = next;
            return;
          }
          this.setFocus(el.dataset.id!);
        });
        // Enter animation: start faded/offset, settle after insertion.
        if (animate) {
          el.style.opacity = "0";
          el.style.transform = "translateX(-8px)";
          newRows.push(el);
        }
      }

      const indent = (depth - 1) * INDENT_WIDTH;
      const isCollapsed = collapsed.has(nodeId);

      // Clear and rebuild row content
      row.innerHTML = this._buildRowContent(node, nodeId, depth, hasKids, isCollapsed, indent, visibleColumns, singleColumnMode);

      // Set up reactive value display + editing for each column
      for (let ci = 0; ci < visibleColumns.length; ci++) {
        const col = visibleColumns[ci];
        const valueCell = row.querySelector<HTMLElement>(`[data-value-cell="${nodeId}:${col.key}"]`);
        if (!valueCell) continue;

        const effectKey = `${nodeId}:${col.key}`;
        this._valueEffectDisposers.get(effectKey)?.();
        this._numberDragDisposers.get(effectKey)?.();

        const isPrimary = ci === 0;
        const measureValue = this._valueSourceFor(node, col, isPrimary);
        if (!measureValue) continue;

        const dispose = effect(() => {
          valueCell.textContent = fmtNum(measureValue.value);
        });
        this._valueEffectDisposers.set(effectKey, dispose);

        // Primary column edits route through the DataView draft/commit flow
        // (cross-view previews); extra columns write BiNode measure cells
        // directly (legacy behavior — the kernel only carries one measure).
        const dragDispose = numberDrag(valueCell, {
          get: () => measureValue.value,
          set: (v: number) => { measureValue.value = v; },
          pxPerUnit: 4,
          ...(isPrimary
            ? {
                onStart: () => {
                  this._dataView?.draft({
                    nodeId,
                    value: measureValue.value,
                    source: "table-cell",
                    intent: "edit",
                  });
                },
                onEnd: (canceled: boolean) => {
                  if (canceled) this._dataView?.cancel();
                  else this._dataView?.commit();
                },
              }
            : {}),
        });
        this._numberDragDisposers.set(effectKey, dragDispose);
      }

      fragment.appendChild(row);
    }

    // Remove stale rows (disposers are keyed `${nodeId}:${col.key}`).
    for (const [id, el] of existing.entries()) {
      el.remove();
      for (const [key, dispose] of this._valueEffectDisposers) {
        if (key.startsWith(`${id}:`)) {
          dispose();
          this._valueEffectDisposers.delete(key);
        }
      }
      for (const [key, dispose] of this._numberDragDisposers) {
        if (key.startsWith(`${id}:`)) {
          dispose();
          this._numberDragDisposers.delete(key);
        }
      }
    }

    this._body.innerHTML = "";
    this._body.appendChild(fragment);

    // Trigger enter animations for newly created rows.
    if (newRows.length > 0) {
      newRows.forEach((r) => void r.offsetHeight); // flush initial state
      requestAnimationFrame(() => {
        newRows.forEach((r) => {
          r.style.opacity = "1";
          r.style.transform = "translateX(0)";
        });
      });
    }

    // Notify render listeners
    for (const listener of this._renderListeners) {
      listener(allNodeIds);
    }
  }

  private _buildHeader(visibleColumns: ColumnDef[]): HTMLElement {
    const head = document.createElement("div");
    head.dataset.tableHeader = "true";
    head.style.cssText =
      "display:flex;align-items:center;padding:4px 8px;border-bottom:1px solid oklch(0.25 0 0);position:sticky;top:0;background:oklch(0.14 0 0);z-index:1;gap:4px;";

    const nameHeader = document.createElement("div");
    nameHeader.style.cssText =
      "flex:1;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;";
    nameHeader.textContent = "Name";
    head.appendChild(nameHeader);

    // Column picker button
    const allColumns = this._getAvailableColumns();
    if (allColumns.length > 0) {
      const pickerBtn = document.createElement("button");
      pickerBtn.style.cssText =
        `all:unset;cursor:pointer;padding:2px 6px;font-size:10px;color:oklch(0.5 0 0);background:oklch(0.18 0 0);border-radius:3px;transition:background ${motion.hoverMs.value}ms ease-out;`;
      pickerBtn.textContent = "⚙";
      pickerBtn.title = "Column picker";

      pickerBtn.addEventListener("mouseenter", () => {
        pickerBtn.style.background = "oklch(0.25 0 0)";
      });
      pickerBtn.addEventListener("mouseleave", () => {
        pickerBtn.style.background = "oklch(0.18 0 0)";
      });

      pickerBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._showColumnPicker(pickerBtn, allColumns);
      });

      head.appendChild(pickerBtn);
    }

    // Column headers for visible columns
    for (const col of visibleColumns) {
      const colHeader = document.createElement("div");
      colHeader.style.cssText = `width:${col.width ?? 80}px;text-align:right;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;`;
      colHeader.textContent = col.label;
      head.appendChild(colHeader);
    }

    return head;
  }

  private _buildRowContent(
    node: ChartNode,
    nodeId: string,
    depth: number,
    hasKids: boolean,
    isCollapsed: boolean,
    indent: number,
    visibleColumns: ColumnDef[],
    singleColumnMode: boolean,
  ): string {
    const twisty = hasKids
      ? `<button data-twist="${nodeId}" style="all:unset;cursor:pointer;width:14px;text-align:center;color:oklch(0.5 0 0);font-size:10px;flex-shrink:0;">${
          isCollapsed ? "▸" : "▾"
        }</button>`
      : `<span style="width:14px;flex-shrink:0;"></span>`;

    const nameCell = `
      <div style="flex:1;display:flex;align-items:center;gap:4px;padding-left:${indent}px;min-width:0;">
        ${twisty}
        <span style="width:8px;height:8px;border-radius:50%;background:${node.color};flex-shrink:0;"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:oklch(0.88 0 0);">${node.label}</span>
      </div>
    `;

    const cellCursor = "ew-resize";
    const valueCells = visibleColumns
      .map(
        (col) =>
          `<div data-value-cell="${nodeId}:${col.key}" data-editable-value="${nodeId}:${col.key}" data-measure-key="${col.key}" style="width:${
            col.width ?? 80
          }px;text-align:right;color:oklch(0.7 0 0);font-variant-numeric:tabular-nums;cursor:${cellCursor};touch-action:none;"></div>`,
      )
      .join("");

    return nameCell + valueCells;
  }

  private _showColumnPicker(anchorEl: HTMLElement, columns: ColumnDef[]): void {
    const existingPicker = document.querySelector("[data-column-picker]");
    if (existingPicker) {
      existingPicker.remove();
      return;
    }

    const picker = document.createElement("div");
    picker.dataset.columnPicker = "true";
    picker.style.cssText =
      "position:absolute;background:oklch(0.18 0 0);border:1px solid oklch(0.25 0 0);border-radius:4px;padding:8px;font-size:11px;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.3);min-width:150px;";

    const rect = anchorEl.getBoundingClientRect();
    picker.style.left = `${rect.left}px`;
    picker.style.top = `${rect.bottom + 4}px`;

    for (const col of columns) {
      const isVisible = this._columnVisibility.get(col.key) !== false;
      const visibleCount = this._getVisibleColumns().length;
      const isOnlyVisible = isVisible && visibleCount === 1;

      const item = document.createElement("label");
      item.style.cssText =
        `display:flex;align-items:center;gap:6px;padding:4px;cursor:pointer;color:oklch(0.8 0 0);transition:background ${motion.hoverMs.value}ms ease-out;`;
      if (isOnlyVisible) {
        item.style.opacity = "0.5";
        item.style.cursor = "not-allowed";
        item.title = "At least one column must be visible";
      }

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isVisible;
      checkbox.disabled = isOnlyVisible;
      checkbox.style.cssText = "cursor:pointer;";

      checkbox.addEventListener("change", (e) => {
        e.stopPropagation();
        if (!isOnlyVisible) {
          this._toggleColumnVisibility(col.key);
        }
      });

      const label = document.createElement("span");
      label.textContent = col.label;

      item.addEventListener("mouseenter", () => {
        if (!isOnlyVisible) item.style.background = "oklch(0.22 0 0)";
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = "";
      });

      item.appendChild(checkbox);
      item.appendChild(label);
      picker.appendChild(item);
    }

    document.body.appendChild(picker);

    const closeHandler = (e: MouseEvent) => {
      if (!picker.contains(e.target as Node) && e.target !== anchorEl) {
        picker.remove();
        document.removeEventListener("click", closeHandler);
      }
    };
    setTimeout(() => document.addEventListener("click", closeHandler), 0);
  }

  protected _getAvailableColumns(): ColumnDef[] {
    // Explicit columns (legacy API) win.
    if (this._columns && this._columns.length > 0) return this._columns;
    // Auto-detect from the compat BiNode root's measures (old behavior).
    const biRoot = (this as any).data as BiNode | null | undefined;
    if (biRoot) {
      const keys = new Set<string>();
      const walk = (n: BiNode) => {
        if (n.value.measures) for (const k of Object.keys(n.value.measures)) keys.add(k);
        for (const c of n.children as BiNode[]) walk(c);
      };
      walk(biRoot);
      if (keys.size > 0) {
        return Array.from(keys).map((key) => ({
          key,
          label: key.charAt(0).toUpperCase() + key.slice(1),
          width: 80,
          visible: true,
        }));
      }
    }
    return [{ key: "total", label: "Value", width: 80, visible: true }];
  }

  /** Resolve the reactive value source for a row+column. The FIRST visible
   *  column is the primary measure and reads the shared ChartNode value cell
   *  (kernel-backed → live cross-view draft previews). Extra columns read
   *  the compat BiNode's measure cells directly (old behavior). */
  private _valueSourceFor(node: ChartNode, col: ColumnDef, isPrimary: boolean): { value: number } | null {
    if (isPrimary || col.key === "total") return node.value;
    const biRoot = (this as any).data as BiNode | null | undefined;
    if (!biRoot) return null;
    const find = (n: BiNode): BiNode | null => {
      if (n.value.id === node.id) return n;
      for (const c of n.children as BiNode[]) {
        const f = find(c);
        if (f) return f;
      }
      return null;
    };
    const bn = find(biRoot);
    return (bn?.value.measures?.[col.key] as { value: number } | undefined) ?? null;
  }

  private _getVisibleColumns(): ColumnDef[] {
    const allColumns = this._getAvailableColumns();
    return allColumns.filter((col) => this._columnVisibility.get(col.key) !== false && col.visible !== false);
  }

  private _toggleColumnVisibility(key: string): void {
    const current = this._columnVisibility.get(key) !== false;
    this._columnVisibility.set(key, !current);
    // Force re-render by pushing to trigger effect
    const root = this._treeRoot.value;
    const config = this._configCell.value;
    const drillId = this._drillId.value;
    const collapsed = this._collapsedCell.value;
    if (root && config) {
      this._render(root, config, drillId, collapsed);
    }
  }

  // --- Legacy API ---

  /** Re-render against the current root (legacy API). The reactive effects
   *  make this largely redundant, but external mutations to the BiNode tree
   *  structure (row adds/removes) aren't tracked — refresh() covers those. */
  refresh(): void {
    this._renderTick.value++;
  }

  /** Root scroll container (legacy API, used by React wrappers). */
  getRoot(): HTMLElement {
    return this._root!;
  }

  onRender(listener: (allNodeIds: string[]) => void): () => void {
    this._renderListeners.add(listener);
    return () => {
      this._renderListeners.delete(listener);
    };
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Clean up all effects
    for (const dispose of this._valueEffectDisposers.values()) {
      dispose();
    }
    this._valueEffectDisposers.clear();
    this._renderListeners.clear();
  }
}
