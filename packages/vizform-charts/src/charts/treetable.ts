import { leavesOf, effect } from "bireactive";
import { type BiNode, portfolio } from "../lib/tree";
import { prefersReducedMotion, settleTransition } from "../lib/transitions";
import { numberDrag } from "../lib/number-drag";

const ROW_HEIGHT = 24;
const INDENT_WIDTH = 14;

interface VisibleRow {
  node: BiNode;
  depth: number;
  hasKids: boolean;
}

function fmtNum(v: number): string {
  if (v === 0) return '';
  if (v < 10) return v.toFixed(1);
  return Math.round(v).toString();
}

function computeVisible(root: BiNode, collapsed: Set<string>, maxDepth?: number): VisibleRow[] {
  const out: VisibleRow[] = [];

  function walk(node: BiNode, depth: number) {
    const children = node.children as BiNode[];
    const hasKids = children.length > 0;

    // Add node (skip root at depth 0)
    if (depth > 0) {
      out.push({ node, depth, hasKids });
    }

    // Add children if not collapsed and within maxDepth
    const withinDepth = maxDepth === undefined || depth < maxDepth;
    if (hasKids && !collapsed.has(node.value.id ?? '') && withinDepth) {
      for (const child of children) {
        walk(child, depth + 1);
      }
    }
  }

  walk(root, 0);
  return out;
}

export interface ColumnDef {
  key: string;
  label: string;
  width?: number;
  visible?: boolean;
}

/**
 * MdTreetableLC - HTML-based hierarchical treetable for BiNode data.
 * Does NOT extend Diagram because tables need HTML DOM for proper scrolling
 * and text layout. Registers as a custom element for integration with sliceboard.
 *
 * Supports reactive value updates and editing of both leaves AND parents via
 * the bireactive sum-redistribute lens pattern.
 *
 * Now supports multiple columns with a column picker UI and whole-row editing
 * when only one column is visible.
 */
export class MdTreetableLC extends HTMLElement {
  externalRoot?: BiNode;
  maxDepth?: number;
  drillKey?: string;
  drillNodeId?: string | null;
  showBreadcrumb?: boolean;
  enableTransitions?: boolean;
  columns?: ColumnDef[];

  private root!: HTMLDivElement;
  private body!: HTMLDivElement;
  private collapsed = new Set<string>();
  private renderListeners = new Set<(allNodeIds: string[]) => void>();
  private valueEffectDisposers = new Map<string, () => void>();
  private columnVisibility = new Map<string, boolean>();

  connectedCallback() {
    this.render();
  }

  private showColumnPicker(anchorEl: HTMLElement, columns: ColumnDef[]) {
    // Remove existing picker if any
    const existingPicker = document.querySelector('[data-column-picker]');
    if (existingPicker) {
      existingPicker.remove();
      return; // Toggle off
    }

    const picker = document.createElement('div');
    picker.dataset.columnPicker = 'true';
    picker.style.cssText = 'position:absolute;background:oklch(0.18 0 0);border:1px solid oklch(0.25 0 0);border-radius:4px;padding:8px;font-size:11px;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.3);min-width:150px;';

    // Position picker below the button
    const rect = anchorEl.getBoundingClientRect();
    picker.style.left = `${rect.left}px`;
    picker.style.top = `${rect.bottom + 4}px`;

    // Column checkboxes
    for (const col of columns) {
      const isVisible = this.columnVisibility.get(col.key) !== false;
      const visibleCount = this.getVisibleColumns().length;
      const isOnlyVisible = isVisible && visibleCount === 1;

      const item = document.createElement('label');
      item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px;cursor:pointer;color:oklch(0.8 0 0);transition:background 80ms;';
      if (isOnlyVisible) {
        item.style.opacity = '0.5';
        item.style.cursor = 'not-allowed';
        item.title = 'At least one column must be visible';
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = isVisible;
      checkbox.disabled = isOnlyVisible;
      checkbox.style.cssText = 'cursor:pointer;';

      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        if (!isOnlyVisible) {
          this.toggleColumnVisibility(col.key);
        }
      });

      const label = document.createElement('span');
      label.textContent = col.label;

      item.addEventListener('mouseenter', () => {
        if (!isOnlyVisible) item.style.background = 'oklch(0.22 0 0)';
      });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });

      item.appendChild(checkbox);
      item.appendChild(label);
      picker.appendChild(item);
    }

    document.body.appendChild(picker);

    // Close picker on outside click
    const closeHandler = (e: MouseEvent) => {
      if (!picker.contains(e.target as Node) && e.target !== anchorEl) {
        picker.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  private getAvailableColumns(): ColumnDef[] {
    if (this.columns && this.columns.length > 0) {
      return this.columns;
    }

    // Auto-detect columns from rootNode measures
    const rootNode = this.externalRoot ?? portfolio();
    const measureKeys = new Set<string>();

    function collectKeys(node: BiNode) {
      if (node.value.measures) {
        for (const key of Object.keys(node.value.measures)) {
          measureKeys.add(key);
        }
      }
      for (const child of node.children as BiNode[]) {
        collectKeys(child);
      }
    }
    collectKeys(rootNode);

    // If no measures found, default to showing "total" as "Value" column
    if (measureKeys.size === 0) {
      return [{
        key: 'total',
        label: 'Value',
        width: 80,
        visible: true
      }];
    }

    return Array.from(measureKeys).map(key => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      width: 80,
      visible: true
    }));
  }

  private getVisibleColumns(): ColumnDef[] {
    const allColumns = this.getAvailableColumns();
    return allColumns.filter(col =>
      this.columnVisibility.get(col.key) !== false && (col.visible !== false)
    );
  }

  private toggleColumnVisibility(key: string) {
    const current = this.columnVisibility.get(key) !== false;
    this.columnVisibility.set(key, !current);
    this.render();
  }

  private render() {
    const rootNode = this.externalRoot ?? portfolio();
    const allColumns = this.getAvailableColumns();
    const visibleColumns = this.getVisibleColumns();
    const singleColumnMode = visibleColumns.length === 1;

    // Create root container if needed
    if (!this.root) {
      this.root = document.createElement('div');
      this.root.style.cssText = 'width:100%;height:100%;overflow-y:auto;font-size:12px;font-family:inherit;background:oklch(0.14 0 0);';
      this.appendChild(this.root);
    }

    // Rebuild header each render to update column picker state
    const existingHead = this.root.querySelector('[data-table-header]') as HTMLElement;
    if (existingHead) existingHead.remove();

    const head = document.createElement('div');
    head.dataset.tableHeader = 'true';
    head.style.cssText = 'display:flex;align-items:center;padding:4px 8px;border-bottom:1px solid oklch(0.25 0 0);position:sticky;top:0;background:oklch(0.14 0 0);z-index:1;gap:4px;';

    // Name column header
    const nameHeader = document.createElement('div');
    nameHeader.style.cssText = 'flex:1;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;';
    nameHeader.textContent = 'Name';
    head.appendChild(nameHeader);

    // Column picker button
    if (allColumns.length > 0) {
      const pickerBtn = document.createElement('button');
      pickerBtn.style.cssText = 'all:unset;cursor:pointer;padding:2px 6px;font-size:10px;color:oklch(0.5 0 0);background:oklch(0.18 0 0);border-radius:3px;transition:background 80ms;';
      pickerBtn.textContent = '⚙';
      pickerBtn.title = 'Column picker';

      pickerBtn.addEventListener('mouseenter', () => { pickerBtn.style.background = 'oklch(0.25 0 0)'; });
      pickerBtn.addEventListener('mouseleave', () => { pickerBtn.style.background = 'oklch(0.18 0 0)'; });

      pickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showColumnPicker(pickerBtn, allColumns);
      });

      head.appendChild(pickerBtn);
    }

    // Value column headers
    for (const col of visibleColumns) {
      const colHeader = document.createElement('div');
      colHeader.style.cssText = `width:${col.width ?? 80}px;text-align:right;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;`;
      colHeader.textContent = col.label;
      head.appendChild(colHeader);
    }

    this.root.insertBefore(head, this.root.firstChild);

    // Body container
    if (!this.body) {
      this.body = document.createElement('div');
      this.root.appendChild(this.body);
    }

    const visible = computeVisible(rootNode, this.collapsed, this.maxDepth);
    const allNodeIds: string[] = [];

    // Keyed update
    const existing = new Map<string, HTMLElement>();
    for (const el of Array.from(this.body.children) as HTMLElement[]) {
      const id = el.dataset.id;
      if (id) existing.set(id, el);
    }

    const fragment = document.createDocumentFragment();
    const newRows: HTMLElement[] = [];
    const transitionsOn = this.enableTransitions !== false;

    for (const { node, depth, hasKids } of visible) {
      const nodeId = node.value.id ?? '';
      allNodeIds.push(nodeId);

      let row = existing.get(nodeId);
      const isNewRow = !row;
      existing.delete(nodeId);

      if (!row) {
        row = document.createElement('div');
        row.dataset.id = nodeId;
        // Compose base transition with settle transition for opacity/transform
        const baseTransition = transitionsOn ? `${settleTransition(['opacity', 'transform'])}, background 80ms` : 'background 80ms';
        row.style.cssText = `display:flex;align-items:center;padding:3px 8px;cursor:default;transition:${baseTransition};`;
        row.addEventListener('mouseenter', () => { row!.style.background = 'oklch(0.22 0 0)'; });
        row.addEventListener('mouseleave', () => { row!.style.background = ''; });

        // Start with collapsed state for enter animation (only when transitions are actually enabled)
        const shouldAnimate = transitionsOn && !prefersReducedMotion();
        if (shouldAnimate) {
          row.style.opacity = '0';
          row.style.transform = 'translateX(-8px)';
          newRows.push(row);
        }
      }

      const indent = (depth - 1) * INDENT_WIDTH;
      const isCollapsed = this.collapsed.has(nodeId);
      const color = node.value.color;

      // Build name cell
      const nameCell = `
        <div style="flex:1;display:flex;align-items:center;gap:4px;padding-left:${indent}px;min-width:0;">
          ${hasKids
            ? `<button data-twist="${nodeId}" style="all:unset;cursor:pointer;width:14px;text-align:center;color:oklch(0.5 0 0);font-size:10px;flex-shrink:0;">${isCollapsed ? '▸' : '▾'}</button>`
            : `<span style="width:14px;flex-shrink:0;"></span>`
          }
          <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:oklch(0.88 0 0);">${node.value.label}</span>
        </div>
      `;

      // Build value cells for each visible column
      const valueCells = visibleColumns.map(col => {
        const cellCursor = 'ew-resize';
        return `<div data-value-cell="${nodeId}:${col.key}" data-editable-value="${nodeId}:${col.key}" data-measure-key="${col.key}" style="width:${col.width ?? 80}px;text-align:right;color:oklch(0.7 0 0);font-variant-numeric:tabular-nums;cursor:${cellCursor};touch-action:none;"></div>`;
      }).join('');

      row.innerHTML = nameCell + valueCells;

      // In single-column mode, make the whole row editable
      if (singleColumnMode) {
        row.style.cursor = 'ew-resize';
      }

      // Attach expand/collapse handler
      if (hasKids) {
        const btn = row.querySelector<HTMLElement>(`[data-twist="${nodeId}"]`);
        btn?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.collapsed.has(nodeId)) {
            this.collapsed.delete(nodeId);
          } else {
            this.collapsed.add(nodeId);
          }
          this.render();
        });
      }

      // Set up reactive value display + drag editing for each column
      for (const col of visibleColumns) {
        const valueCell = row.querySelector<HTMLElement>(`[data-value-cell="${nodeId}:${col.key}"]`);
        if (valueCell) {
          // Clean up old effect if it exists
          const effectKey = `${nodeId}:${col.key}`;
          const oldDispose = this.valueEffectDisposers.get(effectKey);
          oldDispose?.();

          // Create reactive effect to update value display
          // For backward compatibility: if col.key is 'total' or measures don't exist, use node.value.total
          const measureValue = (col.key === 'total' || !node.value.measures)
            ? node.value.total
            : (node.value.measures[col.key] ?? node.value.total);
          const dispose = effect(() => {
            const value = measureValue.value;
            valueCell.textContent = fmtNum(value);
          });

          this.valueEffectDisposers.set(effectKey, dispose);

          // Attach numberDrag for drag-to-edit on this value cell
          // Self-contained: no host wiring needed.
          numberDrag(valueCell, {
            get: () => measureValue.value,
            set: (v: number) => { measureValue.value = v; },
            pxPerUnit: 4,
          });
        }
      }

      fragment.appendChild(row);
    }

    // Remove stale rows immediately (no exit animation - collapse should be instant)
    for (const [id, el] of existing.entries()) {
      el.remove();
      const dispose = this.valueEffectDisposers.get(id);
      dispose?.();
      this.valueEffectDisposers.delete(id);
    }

    this.body.appendChild(fragment);

    // Trigger enter animations for new rows (only when transitions are actually enabled)
    if (newRows.length > 0 && transitionsOn && !prefersReducedMotion()) {
      // Force reflow to ensure the initial state is applied
      newRows.forEach(row => row.offsetHeight);

      // Use requestAnimationFrame to ensure the transition runs
      requestAnimationFrame(() => {
        newRows.forEach(row => {
          row.style.opacity = '1';
          row.style.transform = 'translateX(0)';
        });
      });
    }

    // Notify render listeners (for number-drag attachment)
    // Pass ALL node ids (parents and leaves) for editing
    for (const listener of this.renderListeners) {
      listener(allNodeIds);
    }
  }

  // API for React wrapper
  onRender(listener: (allNodeIds: string[]) => void): () => void {
    this.renderListeners.add(listener);
    return () => { this.renderListeners.delete(listener); };
  }

  getRoot(): HTMLElement {
    return this.root;
  }

  disconnectedCallback() {
    // Clean up all effects
    for (const dispose of this.valueEffectDisposers.values()) {
      dispose();
    }
    this.valueEffectDisposers.clear();
  }
}
