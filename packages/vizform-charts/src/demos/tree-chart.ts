import {
  Anchor,
  Diagram,
  derive,
  effect as biEffect,
  label,
  type Mount,
  cell,
  circle,
  line,
  Vec,
  num,
  tween,
  easeOut,
  untracked,
} from "bireactive";
import { tree, type HierarchyPointNode } from "d3-hierarchy";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode } from "../lib/tree";
import { portfolio, walkWithDepth } from "../lib/portfolio";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { FILL_STYLE } from "../lib/host-size";
import { GESTURE_ACTIVE_CLASS } from "../lib/transitions";

const W = 560;
const H = 400;
const PAD_TOP = 40;
const PAD_BOTTOM = 40;
const PAD_LEFT = 60;
const PAD_RIGHT = 60;
const SORT_SEC = 0.35; // s — sort/reorder tween duration

/** Build a d3 hierarchy that excludes children of collapsed nodes.
 *  This makes the layout treat collapsed parents as leaves so visible
 *  nodes spread into the freed-up space. */
function buildCollapsedHierarchy(
  root: BiNode,
  collapsed: Set<BiNode>,
  sortBy?: "index" | "value",
) {
  const h = buildHierarchy(root, sortBy);
  h.each((d) => {
    if (collapsed.has(d.data) && d.children) {
      d.children = undefined;
    }
  });
  return h;
}

export class MdTreeChart extends Diagram {
  static styles = `
    text { pointer-events: none; }
    ${FILL_STYLE}
    [data-focusable]:focus {
      outline: 2px solid #4a9eff;
      outline-offset: 2px;
    }
    [data-focusable]:focus:not(:focus-visible) {
      outline: none;
    }
  `
  externalRoot?: BiNode;
  maxDepth?: number;

  private _sortByCell = cell<'index' | 'value'>('index')
  get sortBy(): 'index' | 'value' { return this._sortByCell.value }
  set sortBy(v: 'index' | 'value') { this._sortByCell.value = v }

  private _orientationCell = cell<'vertical' | 'horizontal'>('vertical')
  get orientation(): 'vertical' | 'horizontal' { return this._orientationCell.value }
  set orientation(v: 'vertical' | 'horizontal') { this._orientationCell.value = v }

  // Reactive cell wrapping the collapsed-node Set. We replace the Set object
  // (new reference) on each toggle so derive() detects the change.
  private _collapsedCell = cell<Set<BiNode>>(new Set<BiNode>())

  protected scene(s: Mount): void {
    const root = this.externalRoot ?? portfolio();

    // Scale canvas to data size — calculate for both orientations and use max
    // so the canvas can accommodate switching between vertical and horizontal
    const allNodes = [...walkWithDepth(root)];
    const leafCount = allNodes.filter(n => n.isLeaf).length;
    const maxDepth = allNodes.reduce((m, n) => Math.max(m, n.depth), 0);
    // Vertical: width for siblings, height for depth
    const vertW = Math.max(W, leafCount * 20 + PAD_LEFT + PAD_RIGHT);
    const vertH = Math.max(H, maxDepth * 80 + PAD_TOP + PAD_BOTTOM);
    // Horizontal: width for depth, height for siblings
    const horizW = Math.max(W, maxDepth * 80 + PAD_LEFT + PAD_RIGHT);
    const horizH = Math.max(H, leafCount * 20 + PAD_TOP + PAD_BOTTOM);
    // Use max to accommodate both orientations without clipping
    const cW = Math.max(vertW, horizW);
    const cH = Math.max(vertH, horizH);

    const view = this.view(cW, cH);
    this.tabIndex = -1;
    this.style.outline = "none";

    const parentIdx = buildParentIndex(root);
    const parentOf = (n: BiNode) => parentIdx.get(n);

    const state: SelectionState = {
      focused: cell<BiNode | null>(null),
      hovered: { current: null },
      wheelLocked: { current: null },
    };
    attachChartGestures(this, { root, parentOf, state });
    const hoverCell = cell<BiNode | null>(null);
    state.hoverCell = hoverCell;

    // Derived cell for orientation (must be separate derived cell for reactive tracking)
    const isHoriz = derive(() => this._orientationCell.value === 'horizontal');

    // Tweened swap amount for smooth orientation transitions (0 = vertical, 1 = horizontal)
    const swapAmount = num(isHoriz.value ? 1 : 0);
    let swapCancel: (() => void) | null = null;
    let swapInited = false;
    biEffect(() => {
      const target = isHoriz.value ? 1 : 0;
      if (!swapInited) { swapInited = true; swapAmount.value = target; return; }
      swapCancel?.();
      swapCancel = this.anim.start(tween(swapAmount, target, SORT_SEC, easeOut));
    });

    // Helper: true if a node is inside a collapsed subtree (i.e., one of its
    // ancestors is in the collapsed set). The node itself may be collapsed but
    // is still considered visible.
    const isInsideCollapsed = (n: BiNode): boolean => {
      const collapsed = this._collapsedCell.value;
      let cur: BiNode | undefined = parentOf(n);
      while (cur) {
        if (collapsed.has(cur)) return true;
        cur = parentOf(cur);
      }
      return false;
    };

    // tree() layout: assigns .x and .y per VISIBLE node (collapsed subtrees are
    // pruned from the d3 hierarchy so they don't contribute to positioning).
    // For hidden nodes we use their nearest visible ancestor's position so they
    // slide into the parent on collapse and back out on expand.
    const layout = derive(() => {
      const collapsed = this._collapsedCell.value;
      const h = buildCollapsedHierarchy(root, collapsed, this._sortByCell.value);
      const isHorizontal = isHoriz.value;
      tree<BiNode>().size(
        isHorizontal
          ? [cH - PAD_TOP - PAD_BOTTOM, cW - PAD_LEFT - PAD_RIGHT]
          : [cW - PAD_LEFT - PAD_RIGHT, cH - PAD_TOP - PAD_BOTTOM]
      )(h);
      const map = new Map<BiNode, HierarchyPointNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyPointNode<BiNode>));
      // Hidden nodes: resolve to their collapsed ancestor's position
      for (const { node } of allNodes) {
        if (!map.has(node)) {
          // Walk up to find the collapsed ancestor that is in the layout map
          let anc: BiNode | undefined = parentOf(node);
          while (anc && !map.has(anc)) anc = parentOf(anc);
          if (anc) map.set(node, map.get(anc)!);
        }
      }
      return { map, isHorizontal };
    });

    // Per-node layout-position cells (tweened on sort/collapse). Pre-built so
    // both edges and nodes can read from the same tweened positions.
    const posCells = new Map<BiNode, { lx: ReturnType<typeof num>; ly: ReturnType<typeof num> }>();
    for (const { node } of allNodes) {
      const lseed = untracked(() => layout.value.map.get(node)) ?? { x: 0, y: 0 };
      const lx = num(lseed.x), ly = num(lseed.y);
      posCells.set(node, { lx, ly });
      const ltarget = derive(() => {
        const nd = layout.value.map.get(node);
        return { x: nd?.x ?? 0, y: nd?.y ?? 0 };
      });
      let lcancel: (() => void) | null = null;
      let lInited = false;
      biEffect(() => {
        const t = ltarget.value; // reacts to sort + value + size + orientation + collapsed
        if (!lInited) { lInited = true; lx.value = t.x; ly.value = t.y; return; }
        if (this.classList.contains(GESTURE_ACTIVE_CLASS)) {
          lcancel?.(); lcancel = null;
          lx.value = t.x; ly.value = t.y;
        } else {
          lcancel?.();
          lcancel = this.anim.start(
            tween(lx, t.x, SORT_SEC, easeOut),
            tween(ly, t.y, SORT_SEC, easeOut),
          );
        }
      });
    }

    const posOf = (n: BiNode) => {
      const c = posCells.get(n);
      const lxVal = c?.lx.value ?? 0;
      const lyVal = c?.ly.value ?? 0;
      const swap = swapAmount.value; // 0 = vertical, 1 = horizontal
      // Interpolate between vertical and horizontal coordinate systems
      // Vertical: x uses lx, y uses ly
      // Horizontal: x uses ly, y uses lx
      // Lerp: vertical + (horizontal - vertical) * swap
      const x = PAD_LEFT + (lxVal + (lyVal - lxVal) * swap);
      const y = PAD_TOP + (lyVal + (lxVal - lyVal) * swap);
      return { x, y };
    };

    // Per-node tweened opacity cell — fades in/out when nodes collapse/expand.
    const opacityCells = new Map<BiNode, ReturnType<typeof num>>();
    for (const { node } of allNodes) {
      const initHidden = untracked(() => isInsideCollapsed(node));
      const op = num(initHidden ? 0 : 1);
      opacityCells.set(node, op);
      const opTarget = derive(() => isInsideCollapsed(node) ? 0 : 1);
      let opCancel: (() => void) | null = null;
      let opInited = false;
      biEffect(() => {
        const target = opTarget.value;
        if (!opInited) { opInited = true; op.value = target; return; }
        opCancel?.();
        opCancel = this.anim.start(tween(op, target, SORT_SEC, easeOut));
      });
    }

    // Toggle collapsed state for an inner node
    const toggleCollapsed = (node: BiNode) => {
      const prev = this._collapsedCell.value;
      const next = new Set(prev);
      if (next.has(node)) next.delete(node);
      else next.add(node);
      this._collapsedCell.value = next;
    };

    // Draw edges first (under nodes). Each edge fades with its child node's
    // opacity so edges into collapsed subtrees vanish smoothly.
    for (const { node, depth } of allNodes) {
      if (depth === 0) continue;
      if (this.maxDepth !== undefined && depth > this.maxDepth) continue;
      const parent = parentOf(node);
      if (!parent) continue;

      const from = Vec.derive(() => posOf(parent));
      const to = Vec.derive(() => posOf(node));
      const edgeOpacity = derive(() => opacityCells.get(node)?.value ?? 1);

      s(line(from, to, { stroke: "#3a3f4a", thin: true, opacity: edgeOpacity }));
    }

    // Draw nodes (circles + labels)
    for (const { node, depth, isLeaf } of allNodes) {
      if (this.maxDepth !== undefined && depth > this.maxDepth) continue;
      const cx = Vec.derive(() => posOf(node));
      const hasChildren = !isLeaf;

      // Collapsed inner nodes get a larger radius to hint they contain children
      const r = isLeaf ? 6 : 5;

      const isCollapsedNode = derive(() => this._collapsedCell.value.has(node));
      const stroke = derive(() =>
        state.focused.value === node ? "#fff"
        : hoverCell.value === node ? "#c8cdd6"
        : isCollapsedNode.value ? "#7a8499"
        : "#0b0d12",
      );
      // Collapsed inner nodes get a thicker stroke as a visual indicator
      const strokeWidth = derive(() =>
        state.focused.value === node || hoverCell.value === node ? 2
        : isCollapsedNode.value ? 2
        : 1
      );
      // Collapsed inner nodes show a dim background fill (hollow-like) to
      // indicate there is hidden content inside
      const fill = derive(() =>
        hasChildren && isCollapsedNode.value ? "#2a3040" : node.value.color
      );
      // Blend aesthetic opacity (leaf = 0.95, inner = 0.7) with the
      // visibility opacity (1 = visible, 0 = hidden inside collapsed subtree)
      const aestheticOp = isLeaf ? 0.95 : 0.7;
      const visOp = opacityCells.get(node)!;
      const opacity = derive(() => aestheticOp * visOp.value);

      const circ = s(
        circle(cx, r, {
          fill,
          opacity,
          stroke,
          strokeWidth,
        }),
      );
      circ.el.style.cursor = "pointer";
      circ.el.setAttribute('tabindex', '0');
      circ.el.setAttribute('data-focusable', 'node');
      biEffect(() => {
        const collapsedSuffix = isCollapsedNode.value && hasChildren ? ' (collapsed)' : '';
        circ.el.setAttribute('aria-label', `${node.value.label}: ${node.value.total.value.toFixed(0)}${collapsedSuffix}`);
      });
      circ.el.addEventListener("click", () => {
        // Inner non-root nodes toggle their collapsed state on click.
        // Leaves and root only update focus.
        if (hasChildren && depth > 0) toggleCollapsed(node);
        state.focused.value = node;
      });
      circ.el.addEventListener("focus", () => { state.focused.value = node; });
      circ.el.addEventListener("blur", () => { if (state.focused.value === node) state.focused.value = null; });
      circ.el.addEventListener("pointerenter", () => { state.hovered.current = node; hoverCell.value = node; state.emitHover?.(node); });
      circ.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) { state.hovered.current = null; hoverCell.value = null; state.emitHover?.(null); } });

      // Label: leaves get value appended; inner nodes show collapse indicator
      const text = derive(() => {
        if (depth === 0) return node.value.label;
        if (hasChildren && isCollapsedNode.value) return `${node.value.label} ▸`;
        return isLeaf
          ? `${node.value.label}\n${node.value.total.value.toFixed(0)}`
          : node.value.label;
      });

      // Alternate label placement: leaves below, inner nodes above
      const labelPos = Vec.derive(() => {
        const p = posOf(node);
        return isLeaf
          ? { x: p.x, y: p.y + 16 }
          : { x: p.x, y: p.y - 12 };
      });
      const labelOpacity = derive(() => visOp.value);

      s(
        label(labelPos, text, {
          size: isLeaf ? 10 : 9,
          align: Anchor.Center,
          fill: "#c8cdd6",
          bold: !isLeaf,
          opacity: labelOpacity,
        }),
      );
    }

    if (!this.hasAttribute('no-source')) s(
      label(
        view.bottom.up(10),
        derive(() => {
          const f = state.focused.value;
          return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · click inner nodes to collapse/expand · hover + cmd/ctrl+wheel`;
        }),
        { size: 10, align: Anchor.Center, fill: "#9aa0a8" },
      ),
    );
  }
}
