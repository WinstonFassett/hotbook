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
  Vec,
  effect as biEffect,
} from "bireactive";
import { depthFill, labelInk } from "../lib/depth-color";
import { buildParentIndex, type BiNode } from "../lib/tree";
import { portfolio, walkWithDepth } from "../lib/portfolio";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { useHostSize, FILL_STYLE } from "../lib/host-size";

const W = 720;
const H = 480;
const ROW_HEIGHT = 28; // Compatible with gantt
const INDENT_WIDTH = 20;
const NAME_COL_WIDTH = 300;
const VALUE_COL_WIDTH = 120;

export class MdTreetableLC extends Diagram {
  static styles = `
    :host {
      overflow-y: auto;
      overflow-x: hidden;
    }
    text { pointer-events: none; user-select: none; }
    ${FILL_STYLE}
    [data-focusable]:focus {
      outline: 2px solid #4a9eff;
      outline-offset: 2px;
    }
    [data-focusable]:focus:not(:focus-visible) {
      outline: none;
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

    // Header row
    const headerY = 20;
    s(
      rect(10, headerY, NAME_COL_WIDTH, ROW_HEIGHT, {
        fill: "#1a1f2a",
        stroke: "#444",
        strokeWidth: 1,
      }),
      label(
        Vec.of(20, headerY + ROW_HEIGHT / 2),
        "Name",
        { size: 11, bold: true, align: Anchor.Left, fill: "#e0e0e0" }
      ),
      rect(10 + NAME_COL_WIDTH, headerY, VALUE_COL_WIDTH, ROW_HEIGHT, {
        fill: "#1a1f2a",
        stroke: "#444",
        strokeWidth: 1,
      }),
      label(
        Vec.of(10 + NAME_COL_WIDTH + VALUE_COL_WIDTH / 2, headerY + ROW_HEIGHT / 2),
        "Value",
        { size: 11, bold: true, align: Anchor.Center, fill: "#e0e0e0" }
      )
    );

    // Table rows
    const rowsLayer = s(group());
    const startY = headerY + ROW_HEIGHT + 2;

    forEach(rowsLayer, visibleRows, (rowData) => {
      const { node, depth, index } = rowData;
      const y = startY + index * ROW_HEIGHT;
      const indent = (depth - 1) * INDENT_WIDTH;
      const hasChildren = (node.children as BiNode[]).length > 0;
      const nodeId = node.value.id ?? "";
      const isCollapsed = this._collapsedNodes.has(nodeId);

      const nd = depth;
      const nodeFill = depthFill(node.value.color, nd);

      // Row background
      const rowBg = rect(10, y, NAME_COL_WIDTH + VALUE_COL_WIDTH, ROW_HEIGHT, {
        fill: index % 2 === 0 ? "#0b0d12" : "#13151a",
        stroke: "#444",
        strokeWidth: 0.5,
      });
      rowBg.el.dataset.id = nodeId;
      rowBg.el.style.cursor = "pointer";
      rowBg.el.setAttribute('tabindex', '0');
      rowBg.el.setAttribute('data-focusable', 'row');

      const stroke = derive(() =>
        state.focused.value === node ? "#4a9eff"
        : hoverCell.value === node ? "#c8cdd6"
        : "transparent"
      );
      const strokeWidth = derive(() => (state.focused.value === node || hoverCell.value === node ? 2 : 0));

      biEffect(() => {
        rowBg.el.setAttribute('stroke', stroke.value);
        rowBg.el.setAttribute('stroke-width', strokeWidth.value.toString());
      });

      rowBg.el.addEventListener("click", () => { state.focused.value = node; });
      rowBg.el.addEventListener("focus", () => { state.focused.value = node; });
      rowBg.el.addEventListener("blur", () => { if (state.focused.value === node) state.focused.value = null; });
      rowBg.el.addEventListener("pointerenter", () => { state.hovered.current = node; hoverCell.value = node; });
      rowBg.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) { state.hovered.current = null; hoverCell.value = null; } });

      const elements: any[] = [rowBg];

      // Expand/collapse icon using text
      if (hasChildren) {
        const iconX = 15 + indent;
        const iconText = isCollapsed ? "▶" : "▼";
        const iconLbl = label(
          Vec.of(iconX, y + ROW_HEIGHT / 2),
          iconText,
          { size: 10, align: Anchor.Left, fill: "#9aa0a8" }
        );
        iconLbl.el.style.cursor = "pointer";
        iconLbl.el.style.pointerEvents = "auto";
        iconLbl.el.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleCollapse(node);
        });
        elements.push(iconLbl);
      }

      // Name label with indent
      const nameX = 20 + indent + (hasChildren ? 15 : 0);
      const nameLbl = label(
        Vec.of(nameX, y + ROW_HEIGHT / 2),
        node.value.label,
        { size: 10, align: Anchor.Left, fill: labelInk(nodeFill) }
      );
      elements.push(nameLbl);

      // Value label
      const valueLbl = label(
        Vec.of(10 + NAME_COL_WIDTH + VALUE_COL_WIDTH / 2, y + ROW_HEIGHT / 2),
        derive(() => node.value.total.value.toFixed(0)),
        { size: 10, align: Anchor.Center, fill: "#9aa0a8" }
      );
      elements.push(valueLbl);

      // Vertical separator
      const separator = rect(10 + NAME_COL_WIDTH, y, 1, ROW_HEIGHT, {
        fill: "#444",
        thin: true,
      });
      elements.push(separator);

      return elements;
    }, { key: (row) => row.node.value.id ?? "" });

    // Footer info
    if (!this.hasAttribute('no-source')) {
      s(label(view.bottom.up(10), derive(() => {
        const f = state.focused.value;
        const visibleCount = visibleRows.value.length;
        return `${visibleCount} visible rows · focused: ${f?.value.label ?? "(none)"} · click ▶/▼ to expand/collapse`;
      }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));
    }
  }
}
