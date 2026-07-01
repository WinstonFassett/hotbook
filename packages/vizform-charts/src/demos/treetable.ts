import { leavesOf } from "bireactive";
import type { BiNode } from "../lib/tree";
import { portfolio } from "../lib/portfolio";

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

function computeVisible(root: BiNode, collapsed: Set<string>): VisibleRow[] {
  const out: VisibleRow[] = [];

  function walk(node: BiNode, depth: number) {
    const children = node.children as BiNode[];
    const hasKids = children.length > 0;

    // Add node (skip root at depth 0)
    if (depth > 0) {
      out.push({ node, depth, hasKids });
    }

    // Add children if not collapsed
    if (hasKids && !collapsed.has(node.value.id ?? '')) {
      for (const child of children) {
        walk(child, depth + 1);
      }
    }
  }

  walk(root, 0);
  return out;
}

/**
 * MdTreetableLC - HTML-based hierarchical treetable for BiNode data.
 * Does NOT extend Diagram because tables need HTML DOM for proper scrolling
 * and text layout. Registers as a custom element for integration with sliceboard.
 */
export class MdTreetableLC extends HTMLElement {
  externalRoot?: BiNode;
  maxDepth?: number;
  drillKey?: string;
  drillNodeId?: string | null;
  showBreadcrumb?: boolean;

  private root!: HTMLDivElement;
  private body!: HTMLDivElement;
  private collapsed = new Set<string>();
  private renderListeners = new Set<(leafIds: string[]) => void>();

  connectedCallback() {
    this.render();
  }

  private render() {
    const rootNode = this.externalRoot ?? portfolio();

    // Create root container if needed
    if (!this.root) {
      this.root = document.createElement('div');
      this.root.style.cssText = 'width:100%;height:100%;overflow-y:auto;font-size:12px;font-family:inherit;background:oklch(0.14 0 0);';

      // Header
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;padding:4px 8px;border-bottom:1px solid oklch(0.25 0 0);position:sticky;top:0;background:oklch(0.14 0 0);z-index:1;';
      head.innerHTML = `
        <div style="flex:1;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;">Name</div>
        <div style="width:60px;text-align:right;font-size:10px;font-weight:600;letter-spacing:0.06em;color:oklch(0.5 0 0);text-transform:uppercase;">Value</div>
      `;
      this.root.appendChild(head);

      // Body
      this.body = document.createElement('div');
      this.root.appendChild(this.body);

      this.appendChild(this.root);
    }

    const visible = computeVisible(rootNode, this.collapsed);
    const leafIds: string[] = [];

    // Keyed update
    const existing = new Map<string, HTMLElement>();
    for (const el of Array.from(this.body.children) as HTMLElement[]) {
      const id = el.dataset.id;
      if (id) existing.set(id, el);
    }

    const fragment = document.createDocumentFragment();
    for (const { node, depth, hasKids } of visible) {
      const nodeId = node.value.id ?? '';
      let row = existing.get(nodeId);
      existing.delete(nodeId);

      if (!row) {
        row = document.createElement('div');
        row.dataset.id = nodeId;
        row.style.cssText = 'display:flex;align-items:center;padding:3px 8px;cursor:default;transition:background 80ms;';
        row.addEventListener('mouseenter', () => { row!.style.background = 'oklch(0.22 0 0)'; });
        row.addEventListener('mouseleave', () => { row!.style.background = ''; });
      }

      const indent = (depth - 1) * INDENT_WIDTH;
      const isCollapsed = this.collapsed.has(nodeId);
      const color = node.value.color;
      const value = node.value.total.value;

      row.innerHTML = `
        <div style="flex:1;display:flex;align-items:center;gap:4px;padding-left:${indent}px;min-width:0;">
          ${hasKids
            ? `<button data-twist="${nodeId}" style="all:unset;cursor:pointer;width:14px;text-align:center;color:oklch(0.5 0 0);font-size:10px;flex-shrink:0;">${isCollapsed ? '▸' : '▾'}</button>`
            : `<span style="width:14px;flex-shrink:0;"></span>`
          }
          <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:oklch(0.88 0 0);">${node.value.label}</span>
        </div>
        <div data-value-cell="${nodeId}" ${!hasKids ? `data-leaf-value="${nodeId}"` : ''} style="width:60px;text-align:right;color:oklch(0.7 0 0);font-variant-numeric:tabular-nums;${!hasKids ? 'cursor:ew-resize;touch-action:none;' : ''}">${fmtNum(value)}</div>
      `;

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

      if (!hasKids) leafIds.push(nodeId);
      fragment.appendChild(row);
    }

    // Remove stale rows
    for (const el of existing.values()) {
      el.remove();
    }

    this.body.appendChild(fragment);

    // Notify render listeners (for number-drag attachment)
    for (const listener of this.renderListeners) {
      listener(leafIds);
    }
  }

  // API for React wrapper
  onRender(listener: (leafIds: string[]) => void): () => void {
    this.renderListeners.add(listener);
    return () => { this.renderListeners.delete(listener); };
  }

  getRoot(): HTMLElement {
    return this.root;
  }
}

// Register custom element
if (!customElements.get('md-treetable-lc')) {
  customElements.define('md-treetable-lc', MdTreetableLC);
}
