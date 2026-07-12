import {
  Anchor,
  circle,
  derive,
  effect as biEffect,
  label,
  type Mount,
  num,
  pathD,
  group,
  treeNode,
  tween,
  easeOut,
  untracked,
  Vec,
  cell,
} from "bireactive";
import { Diagram } from "../lib/diagram";
import { tree, type HierarchyPointNode } from "d3-hierarchy";
import { zoom } from "d3-zoom";
import { select } from "d3-selection";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode, portfolio, walkWithDepth } from "../lib/tree";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { useHostSize } from "../lib/host-size";
import { FILL_STYLE } from "../lib/host-size";
import { GESTURE_ACTIVE_CLASS } from "../lib/transitions";

const W = 560;
const H = 400;
const SORT_SEC = 0.35; // s — sort/reorder tween duration

// Node visual constants — small circles, idiomatic dendrogram
const LEAF_R = 4.5;
const INNER_R = 5.5;
const ROOT_R = 7;
const NODE_STROKE = "#1a1d24";

const DEFAULT_MAX_DEPTH = 2; // root + children + grandchildren = 3 levels
const CHAR_WIDTH_EST = 0.58; // conservative sans-serif char-width / font-size ratio

// Font sizes per role
const LEAF_FONT = 11;
const INNER_FONT = 11;
const ROOT_FONT = 12;

// Gap between node and its label
const LABEL_GAP = 8;

function pruneNode(n: BiNode, depth: number): BiNode {
  if (depth <= 0) return treeNode(n.value, []);
  return treeNode(n.value, n.children.map((c) => pruneNode(c as BiNode, depth - 1)));
}

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

function estWidth(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH_EST;
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
    .tree-node {
      pointer-events: all;
      vector-effect: non-scaling-stroke;
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

  private _measureKeyCell = cell<string>('')
  get measureKey(): string { return this._measureKeyCell.value }
  set measureKey(v: string) { this._measureKeyCell.value = v }

  // Reactive cell wrapping the collapsed-node Set. We replace the Set object
  // (new reference) on each toggle so derive() detects the change.
  private _collapsedCell = cell<Set<BiNode>>(new Set<BiNode>())

  private _zoomSelection?: any;

  disconnectedCallback() {
    super.disconnectedCallback();
    this._zoomSelection?.on('.zoom', null);
    this.style.cursor = '';
  }

  protected scene(s: Mount): void {
    const fullRoot = this.externalRoot ?? portfolio();

    // 0 = unlimited (All); undefined = start with the default shallow view.
    const depthLimit = this.maxDepth === 0 ? undefined : (this.maxDepth ?? DEFAULT_MAX_DEPTH);
    // Limit the layout to the visible subtree so nodes aren't sized for hidden leaves.
    const root = depthLimit === undefined ? fullRoot : pruneNode(fullRoot, depthLimit);

    // Use the real tile size so the tree fills its container instead of
    // rendering on a tiny fixed canvas and getting scaled down to dots.
    const { w: Wc, h: Hc } = useHostSize(this, { width: W, height: H });
    const view = this.view(Wc, Hc);

    this.tabIndex = -1;
    this.style.outline = "none";
    this.style.touchAction = "none";

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

    const allNodes = [...walkWithDepth(root)];

    // Padding: labels extend beyond node positions, so pad enough for the
    // longest label at each end. This is what solves the "Port…" truncation
    // and the horizontal edge clipping — labels get real space to breathe.
    const leafMaxLabelLen = allNodes
      .filter((n) => n.isLeaf)
      .reduce((m, n) => Math.max(m, n.node.value.label.length), 0);
    const leafLabelW = estWidth("W".repeat(leafMaxLabelLen), LEAF_FONT);
    const rootLabelW = estWidth(root.value.label, ROOT_FONT);
    // Horizontal: root sits at left with label to its left; leaves at right
    // with labels to the right. Pad accordingly.
    const PAD_H_LEFT = Math.max(28, rootLabelW + LABEL_GAP + ROOT_R + 6);
    const PAD_H_RIGHT = Math.max(28, leafLabelW + LABEL_GAP + LEAF_R + 6);
    // Vertical: root at top with label above; leaves at bottom with labels
    // below. Extra bottom padding so leaf labels don't clip the tile edge.
    const PAD_V_TOP = Math.max(24, ROOT_FONT + LABEL_GAP + ROOT_R + 4);
    const PAD_V_BOTTOM = Math.max(28, LEAF_FONT + LABEL_GAP + LEAF_R + 8);
    // Side pad for vertical mode: half a leaf label so end leaves don't clip.
    const PAD_V_SIDE = Math.max(20, estWidth("W".repeat(Math.min(6, leafMaxLabelLen)), LEAF_FONT) / 2 + 8);
    // Top/bottom pad for horizontal mode: font baseline + inner label overhang.
    const PAD_H_TOP = Math.max(20, INNER_FONT + LABEL_GAP + 4);
    const PAD_H_BOTTOM = Math.max(16, LEAF_FONT / 2 + 4);

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
      const isHorizontal = this._orientationCell.value === 'horizontal';
      const availW = isHorizontal
        ? Math.max(1, Wc.value - PAD_H_LEFT - PAD_H_RIGHT)
        : Math.max(1, Wc.value - PAD_V_SIDE * 2);
      const availH = isHorizontal
        ? Math.max(1, Hc.value - PAD_H_TOP - PAD_H_BOTTOM)
        : Math.max(1, Hc.value - PAD_V_TOP - PAD_V_BOTTOM);
      tree<BiNode>().size(
        isHorizontal
          ? [availH, availW]
          : [availW, availH]
      )(h);
      const map = new Map<BiNode, HierarchyPointNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyPointNode<BiNode>));
      // Hidden nodes: resolve to their collapsed ancestor's position
      for (const { node } of allNodes) {
        if (!map.has(node)) {
          let anc: BiNode | undefined = parentOf(node);
          while (anc && !map.has(anc)) anc = parentOf(anc);
          if (anc) map.set(node, map.get(anc)!);
        }
      }
      return { map, isHorizontal };
    });

    // Per-node layout-position cells (tweened on sort/collapse/orientation/resize).
    const posCells = new Map<BiNode, { lx: ReturnType<typeof num>; ly: ReturnType<typeof num> }>();
    for (const { node } of allNodes) {
      const lseed = untracked(() => layout.value.map.get(node)) ?? { x: 0, y: 0 };
      const lx = num(lseed.x), ly = num(lseed.y);
      posCells.set(node, { lx, ly });
      const ltarget = derive(() => {
        const l = layout.value;
        const nd = l.map.get(node);
        const x = nd?.x ?? 0, y = nd?.y ?? 0;
        // d3 tree() puts breadth in .x and depth in .y; horizontal renders depth on screen-X.
        return l.isHorizontal ? { x: y, y: x } : { x, y };
      });
      let lcancel: (() => void) | null = null;
      let lInited = false;
      let seenSort = untracked(() => this._sortByCell.value);
      let seenOrient = untracked(() => this._orientationCell.value);
      let seenMeasureKey = untracked(() => this._measureKeyCell.value);
      let seenCollapsed = untracked(() => this._collapsedCell.value);
      biEffect(() => {
        const t = ltarget.value;
        const sort = this._sortByCell.value;
        const orient = this._orientationCell.value;
        const collapsed = this._collapsedCell.value;
        const measureKey = untracked(() => this._measureKeyCell.value);
        if (!lInited) { lInited = true; seenSort = sort; seenOrient = orient; seenMeasureKey = measureKey; seenCollapsed = collapsed; lx.value = t.x; ly.value = t.y; return; }
        const structural = sort !== seenSort || orient !== seenOrient || measureKey !== seenMeasureKey || collapsed !== seenCollapsed;
        seenSort = sort; seenOrient = orient; seenMeasureKey = measureKey; seenCollapsed = collapsed;
        if (structural && !this.classList.contains(GESTURE_ACTIVE_CLASS)) {
          lcancel?.();
          lcancel = this.anim.start(
            tween(lx, t.x, SORT_SEC, easeOut) as any,
            tween(ly, t.y, SORT_SEC, easeOut) as any,
          );
        } else {
          lcancel?.(); lcancel = null;
          lx.value = t.x; ly.value = t.y;
        }
      });
    }

    // Screen position (post-padding) for a node.
    const posOf = (n: BiNode) => {
      const c = posCells.get(n);
      const isHorizontal = layout.value.isHorizontal;
      const padX = isHorizontal ? PAD_H_LEFT : PAD_V_SIDE;
      const padY = isHorizontal ? PAD_H_TOP : PAD_V_TOP;
      const x = padX + (c?.lx.value ?? 0);
      const y = padY + (c?.ly.value ?? 0);
      return { x, y };
    };

    // Per-node tweened opacity — fades in/out when nodes collapse/expand.
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

    // All nodes + edges live in this group so pan/zoom can move them together.
    const content = s(group());

    // Draw edges first (under nodes) as smooth cubic beziers — the idiomatic
    // dendrogram link. The bezier control points sit at the midpoint along the
    // depth axis so links curve gracefully and read as parent→child branches.
    for (const { node, depth } of allNodes) {
      if (depth === 0) continue;
      if (this.maxDepth !== undefined && depth > this.maxDepth) continue;
      const parent = parentOf(node);
      if (!parent) continue;

      const d = derive(() => {
        const p = posOf(parent);
        const c = posOf(node);
        const isH = layout.value.isHorizontal;
        if (isH) {
          const mx = (p.x + c.x) / 2;
          return `M ${p.x} ${p.y} C ${mx} ${p.y}, ${mx} ${c.y}, ${c.x} ${c.y}`;
        }
        const my = (p.y + c.y) / 2;
        return `M ${p.x} ${p.y} C ${p.x} ${my}, ${c.x} ${my}, ${c.x} ${c.y}`;
      });
      const edgeOpacity = derive(() => opacityCells.get(node)?.value ?? 1);

      content.add(
        pathD(d, {
          stroke: "#4a5162",
          strokeWidth: 1.25,
          opacity: edgeOpacity,
        }),
      );
    }

    // Draw nodes as small circles, with labels placed adjacent to each node
    // based on its role and the current orientation.
    for (const { node, depth, isLeaf } of allNodes) {
      if (this.maxDepth !== undefined && depth > this.maxDepth) continue;

      const isRoot = depth === 0;
      const hasChildren = !isLeaf;
      const nodePos = Vec.derive(() => posOf(node));
      const radius = isRoot ? ROOT_R : hasChildren ? INNER_R : LEAF_R;

      const isCollapsedNode = derive(() => this._collapsedCell.value.has(node));
      const isFocused = derive(() => state.focused.value === node);
      const isHovered = derive(() => hoverCell.value === node);

      const nodeFill = derive(() =>
        hasChildren && isCollapsedNode.value ? "#2a3040" : node.value.color,
      );
      const stroke = derive(() =>
        isFocused.value ? "#fff"
        : isHovered.value ? "#c8cdd6"
        : NODE_STROKE,
      );
      const strokeWidth = derive(() =>
        isFocused.value || isHovered.value ? 2 : 1.25,
      );
      const visOp = opacityCells.get(node)!;
      const nodeOpacity = derive(() => visOp.value);

      const nodeShape = content.add(
        circle(nodePos, radius, {
          fill: nodeFill,
          opacity: nodeOpacity,
          stroke,
          strokeWidth,
        }),
      );
      nodeShape.el.classList.add('tree-node');
      nodeShape.el.style.cursor = "pointer";
      nodeShape.el.setAttribute('tabindex', '0');
      nodeShape.el.setAttribute('data-focusable', 'node');
      biEffect(() => {
        const collapsedSuffix = isCollapsedNode.value && hasChildren ? ' (collapsed)' : '';
        nodeShape.el.setAttribute('aria-label', `${node.value.label}: ${node.value.total.value.toFixed(0)}${collapsedSuffix}`);
      });
      biEffect(() => {
        const isHidden = isInsideCollapsed(node);
        nodeShape.el.style.pointerEvents = isHidden ? 'none' : '';
      });
      nodeShape.el.addEventListener("click", () => {
        if (hasChildren) toggleCollapsed(node);
        state.focused.value = node;
      });
      nodeShape.el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
      });
      nodeShape.el.addEventListener("focus", () => { state.focused.value = node; });
      nodeShape.el.addEventListener("blur", () => { if (state.focused.value === node) state.focused.value = null; });
      nodeShape.el.addEventListener("pointerenter", () => { state.hovered.current = node; hoverCell.value = node; state.emitHover?.(node); });
      nodeShape.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) { state.hovered.current = null; hoverCell.value = null; state.emitHover?.(null); } });

      // Label placement — the meat of the aesthetic fix.
      //   Vertical layout: root above its node, leaves below, inner above.
      //   Horizontal layout: root to the left, leaves to the right, inner above.
      // Labels sit `LABEL_GAP` px away from the node edge.
      //
      // `align` is a static prop on the label shape, so instead of switching
      // it reactively we render two labels per node (one per orientation) and
      // fade the inactive one out. Both share text + visibility opacity.
      const fontSize = isRoot ? ROOT_FONT : hasChildren ? INNER_FONT : LEAF_FONT;
      const ink = isRoot ? "#f2f4f8" : hasChildren ? "#e2e5ec" : "#c8cdd6";

      const labelText = derive(() => {
        if (hasChildren && isCollapsedNode.value) return `${node.value.label} ▸`;
        return node.value.label;
      });

      // Vertical-mode label
      const vAlign = isRoot ? Anchor.Bottom : isLeaf ? Anchor.Top : Anchor.Bottom;
      const vPos = Vec.derive(() => {
        const p = posOf(node);
        const dy = (isRoot ? -1 : isLeaf ? 1 : -1) * (radius + LABEL_GAP);
        return { x: p.x, y: p.y + dy };
      });
      const vOp = derive(() => (layout.value.isHorizontal ? 0 : nodeOpacity.value));

      // Horizontal-mode label
      const hAlign = isRoot ? Anchor.Right : isLeaf ? Anchor.Left : Anchor.Bottom;
      const hPos = Vec.derive(() => {
        const p = posOf(node);
        if (isRoot) return { x: p.x - radius - LABEL_GAP, y: p.y };
        if (isLeaf) return { x: p.x + radius + LABEL_GAP, y: p.y };
        return { x: p.x, y: p.y - radius - LABEL_GAP };
      });
      const hOp = derive(() => (layout.value.isHorizontal ? nodeOpacity.value : 0));

      content.add(
        label(vPos, labelText, {
          size: fontSize,
          align: vAlign,
          fill: ink,
          bold: isRoot || hasChildren,
          opacity: vOp,
        }),
      );
      content.add(
        label(hPos, labelText, {
          size: fontSize,
          align: hAlign,
          fill: ink,
          bold: isRoot || hasChildren,
          opacity: hOp,
        }),
      );
    }

    // Touch/mouse pan and pinch-to-zoom for mobile usability.
    const zoomBehavior = zoom<HTMLElement, unknown>()
      .scaleExtent([0.5, 5])
      .filter((event) => {
        if (event.type === 'wheel' && (event.ctrlKey || event.metaKey)) return false;
        const el = event.target as HTMLElement | SVGElement | null;
        return el ? !el.closest('.tree-node') : true;
      })
      .on('zoom', (event) => {
        content.translate.value = { x: event.transform.x, y: event.transform.y };
        content.scale.value = { x: event.transform.k, y: event.transform.k };
      })
      .on('start', () => { this.style.cursor = 'grabbing'; })
      .on('end', () => { this.style.cursor = 'grab'; });

    this._zoomSelection = select(this as HTMLElement).call(zoomBehavior as any);
    this._zoomSelection.on('dblclick.zoom', null);
    this.style.cursor = 'grab';

    if (!this.hasAttribute('no-source')) s(
      label(
        view.bottom.up(10),
        derive(() => {
          const f = state.focused.value;
          return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · click inner nodes to collapse/expand · drag/pinch to pan-zoom · hover + cmd/ctrl+wheel`;
        }),
        { size: 10, align: Anchor.Center, fill: "#9aa0a8" },
      ),
    );
  }
}
