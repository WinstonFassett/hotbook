import {
  Anchor,
  Diagram,
  derive,
  forEach,
  group,
  label,
  type Mount,
  cell,
  rect,
  vec,
  effect as biEffect,
} from "bireactive";
import { depthFill, labelInk } from "../lib/depth-color";
import { buildParentIndex, type BiNode } from "../lib/tree";
import { portfolio, walkWithDepth } from "../lib/portfolio";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { useHostSize, FILL_STYLE } from "../lib/host-size";

const W = 720;
const H = 480;
const ROW_HEIGHT = 24; // Reduced from 28 to match existing implementation
const INDENT_WIDTH = 14; // Reduced from 20 to match existing
const NAME_COL_WIDTH = 300;
const VALUE_COL_WIDTH = 60;
const HEADER_HEIGHT = 24;

export class MdTreetableLC extends Diagram {
  static styles = `
    :host {
      overflow-y: auto;
      overflow-x: hidden;
      font-size: 12px;
      font-family: inherit;
      background: oklch(0.14 0 0);
    }
    text {
      pointer-events: none;
      user-select: none;
    }
    ${FILL_STYLE}
    [data-focusable]:focus {
      outline: 2px solid oklch(0.45 0.15 240);
      outline-offset: 2px;
    }
    [data-focusable]:focus:not(:focus-visible) {
      outline: none;
    }
    .expand-btn {
      cursor: pointer;
      user-select: none;
    }
  `
  externalRoot?: BiNode
  maxDepth?: number
  drillKey?: string

  // Track collapsed state per node ID
  private _collapsedNodes = new Set<string>()

  protected scene(s: Mount): void {
    const { w: Wc, h: Hc } = useHostSize(this, { width: W, height: H });
    const view = this.view(Wc, Hc);
    this.tabIndex = -1;
    this.style.outline = "none";

    const root = this.externalRoot ?? portfolio();
    const parentIdx = buildParentIndex(root);
    const parentOf = (n: BiNode) => parentIdx.get(n);

    const state: SelectionState = {
      focused: cell<BiNode | null>(null),
      hovered: { current: null },
      wheelLocked: { current: null },
    };
    const hoverCell = cell<BiNode | null>(null);
    state.hoverCell = hoverCell;

    // Pre-build static maps (tree structure is immutable).
    const nodeById = new Map<string, BiNode>();
    const nodeDepth = new Map<BiNode, number>();
    let totalDepth = 0;
    for (const { node, depth } of walkWithDepth(root)) {
      if (node.value.id) nodeById.set(node.value.id, node);
      nodeDepth.set(node, depth);
      if (depth > totalDepth) totalDepth = depth;
    }

    // Trigger for re-render when collapse state changes
    const collapsedStateVersion = cell(0);

    // Compute visible rows based on collapsed state
    const visibleRows = derive((): Array<{ node: BiNode; depth: number; index: number }> => {
      // Read collapsedStateVersion to track changes
      void collapsedStateVersion.value;

      const result: Array<{ node: BiNode; depth: number; index: number }> = [];
      let index = 0;

      const walk = (node: BiNode, depth: number): void => {
        // Add current node (skip root at depth 0)
        if (depth > 0) {
          result.push({ node, depth, index: index++ });
        }

        // Add children if not collapsed
        const nodeId = node.value.id ?? "";
        const isCollapsed = this._collapsedNodes.has(nodeId);

        if (!isCollapsed) {
          const children = node.children as BiNode[];
          for (const child of children) {
            walk(child, depth + 1);
          }
        }
      };

      walk(root, 0);
      return result;
    });

    // Toggle collapse state
    const toggleCollapse = (node: BiNode) => {
      const nodeId = node.value.id ?? "";
      if (this._collapsedNodes.has(nodeId)) {
        this._collapsedNodes.delete(nodeId);
      } else {
        this._collapsedNodes.add(nodeId);
      }
      collapsedStateVersion.value++;
    };

    // Header row - sticky at top
    const headerY = 4;
    const headerBg = rect(0, 0, Wc, HEADER_HEIGHT, {
      fill: "oklch(0.14 0 0)",
      stroke: "oklch(0.25 0 0)",
      strokeWidth: 1,
    });
    headerBg.el.style.position = "sticky";
    headerBg.el.style.top = "0";
    headerBg.el.style.zIndex = "1";

    s(
      headerBg,
      label(
        vec(16, headerY + HEADER_HEIGHT / 2),
        "Name",
        { size: 10, bold: true, align: Anchor.Left, fill: "oklch(0.5 0 0)" }
      ),
      label(
        vec(Wc.value - VALUE_COL_WIDTH / 2, headerY + HEADER_HEIGHT / 2),
        "Value",
        { size: 10, bold: true, align: Anchor.Center, fill: "oklch(0.5 0 0)" }
      )
    );

    // Table rows
    const rowsLayer = s(group());
    const startY = HEADER_HEIGHT + 4;

    forEach(rowsLayer, visibleRows, (rowData) => {
      const { node, depth, index } = rowData;
      const y = startY + index * ROW_HEIGHT;
      const indent = (depth - 1) * INDENT_WIDTH;
      const hasChildren = (node.children as BiNode[]).length > 0;
      const nodeId = node.value.id ?? "";
      const isCollapsed = this._collapsedNodes.has(nodeId);

      const nd = depth;
      const color = node.value.color;

      // Row background with hover
      const rowBg = rect(0, y, Wc, ROW_HEIGHT, {
        fill: "transparent",
        stroke: "transparent",
        strokeWidth: 0,
      });
      rowBg.el.dataset.id = nodeId;
      rowBg.el.style.cursor = "default";
      rowBg.el.style.transition = "background 80ms";

      biEffect(() => {
        const isHovered = hoverCell.value === node;
        const isFocused = state.focused.value === node;
        if (isHovered) {
          rowBg.el.setAttribute('fill', 'oklch(0.22 0 0)');
        } else if (isFocused) {
          rowBg.el.setAttribute('fill', 'oklch(0.20 0 0)');
        } else {
          rowBg.el.setAttribute('fill', 'transparent');
        }
      });

      rowBg.el.addEventListener("click", () => { state.focused.value = node; });
      rowBg.el.addEventListener("pointerenter", () => { state.hovered.current = node; hoverCell.value = node; });
      rowBg.el.addEventListener("pointerleave", () => {
        if (state.hovered.current === node) {
          state.hovered.current = null;
          hoverCell.value = null;
        }
      });

      const elements: any[] = [rowBg];

      // Base X position for content
      const baseX = 8 + indent;

      // Expand/collapse button
      if (hasChildren) {
        const btnX = baseX;
        const btnText = isCollapsed ? "▸" : "▾";
        const btn = label(
          vec(btnX, y + ROW_HEIGHT / 2),
          btnText,
          { size: 10, align: Anchor.Left, fill: "oklch(0.5 0 0)" }
        );
        btn.el.style.cursor = "pointer";
        btn.el.style.pointerEvents = "auto";
        btn.el.style.userSelect = "none";
        btn.el.dataset.twist = nodeId;
        btn.el.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleCollapse(node);
        });
        elements.push(btn);
      }

      // Color dot
      const dotX = baseX + (hasChildren ? 18 : 14);
      const dot = rect(dotX - 4, y + ROW_HEIGHT / 2 - 4, 8, 8, {
        fill: color,
        corner: 4,
      });
      elements.push(dot);

      // Name label
      const nameX = dotX + 8;
      const nameLbl = label(
        vec(nameX, y + ROW_HEIGHT / 2),
        node.value.label,
        { size: 12, align: Anchor.Left, fill: "oklch(0.88 0 0)" }
      );
      elements.push(nameLbl);

      // Value label
      const valueX = Wc.value - VALUE_COL_WIDTH / 2;
      const valueLbl = label(
        vec(valueX, y + ROW_HEIGHT / 2),
        derive(() => {
          const val = node.value.total.value;
          if (val === 0) return "";
          if (val < 10) return val.toFixed(1);
          return Math.round(val).toString();
        }),
        {
          size: 12,
          align: Anchor.Center,
          fill: "oklch(0.7 0 0)"
        }
      );
      // Add cursor for leaf nodes to indicate draggable
      if (!hasChildren) {
        valueLbl.el.style.cursor = "ew-resize";
        valueLbl.el.dataset.leafValue = nodeId;
      }
      elements.push(valueLbl);

      return elements;
    }, { key: (row) => row.node.value.id ?? "" });

    // Footer info
    if (!this.hasAttribute('no-source')) {
      s(label(view.bottom.up(10), derive(() => {
        const f = state.focused.value;
        const visibleCount = visibleRows.value.length;
        return `${visibleCount} visible rows · focused: ${f?.value.label ?? "(none)"} · click ▸/▾ to expand/collapse`;
      }), { size: 10, align: Anchor.Center, fill: "oklch(0.5 0 0)" }));
    }
  }
}
