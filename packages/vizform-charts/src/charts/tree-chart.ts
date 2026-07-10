import {
  Anchor,
  derive,
  effect as biEffect,
  label,
  line,
  type Mount,
  num,
  rect,
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
const PAD_LEFT = 24;
const PAD_RIGHT = 24;
const PAD_TOP = 28;
const PAD_BOTTOM = 28;
const SORT_SEC = 0.35; // s — sort/reorder tween duration

const MAX_NODE_W = 120;
const MAX_NODE_H = 44;
const NODE_CORNER = 6;
const NODE_STROKE = "#1a1d24";
const DEFAULT_MAX_DEPTH = 2; // root + children + grandchildren = 3 levels
const LABEL_PAD_X = 4;
const CHAR_WIDTH_EST = 0.55; // conservative sans-serif char-width / font-size ratio

function fitText(text: string, maxWidth: number, fontSize: number): string {
  if (!text) return text;
  const charW = fontSize * CHAR_WIDTH_EST;
  const maxChars = Math.floor(maxWidth / charW);
  if (text.length <= maxChars) return text;
  if (maxChars <= 2) return text.slice(0, maxChars);
  return text.slice(0, maxChars - 1) + "…";
}

function pruneNode(n: BiNode, depth: number): BiNode {
  if (depth <= 0) return treeNode(n.value, []);
  return treeNode(n.value, n.children.map((c) => pruneNode(c as BiNode, depth - 1)));
}

function relLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function labelInk(color: string): string {
  return relLuminance(color) > 0.5 ? "#111" : "#eee";
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
    const leafCount = allNodes.filter(n => n.isLeaf).length;
    const maxDepth = allNodes.reduce((m, n) => Math.max(m, n.depth), 0);

    // Node geometry scales to the available space so the tree is readable
    // without being zoomed out. We keep it below the spacing so nodes don't
    // overlap, and cap it so the style stays consistent on large tiles.
    const nodeW = derive(() => {
      const isHorizontal = this._orientationCell.value === 'horizontal';
      const avail = Math.max(1, (isHorizontal ? Hc.value : Wc.value) - PAD_LEFT - PAD_RIGHT);
      const count = isHorizontal ? Math.max(1, maxDepth) : Math.max(1, leafCount - 1);
      const spacing = count > 1 ? avail / count : avail;
      return Math.min(spacing * 0.8, MAX_NODE_W);
    });

    const nodeH = derive(() => {
      const isHorizontal = this._orientationCell.value === 'horizontal';
      const avail = Math.max(1, (isHorizontal ? Wc.value : Hc.value) - PAD_TOP - PAD_BOTTOM);
      const depth = isHorizontal ? Math.max(1, leafCount - 1) : Math.max(1, maxDepth);
      const spacing = depth > 0 ? avail / depth : avail;
      return Math.min(spacing * 0.6, MAX_NODE_H);
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
      const isHorizontal = this._orientationCell.value === 'horizontal';
      const availW = Math.max(1, Wc.value - PAD_LEFT - PAD_RIGHT);
      const availH = Math.max(1, Hc.value - PAD_TOP - PAD_BOTTOM);
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
        const nd = layout.value.map.get(node);
        return { x: nd?.x ?? 0, y: nd?.y ?? 0 };
      });
      let lcancel: (() => void) | null = null;
      let lInited = false;
      // Structural triggers that SHOULD tween: sort key, orientation, measure
      // swap, and the collapsed set (its Set object is replaced on change, so
      // identity compares).
      let seenSort = untracked(() => this._sortByCell.value);
      let seenOrient = untracked(() => this._orientationCell.value);
      let seenMeasureKey = untracked(() => this._measureKeyCell.value);
      let seenCollapsed = untracked(() => this._collapsedCell.value);
      biEffect(() => {
        const t = ltarget.value; // reacts to sort + value + size + orientation + collapsed
        const sort = this._sortByCell.value;         // track structural triggers so a
        const orient = this._orientationCell.value;  // toggle re-fires this effect and
        const collapsed = this._collapsedCell.value; // is classified as a reorder below.
        const measureKey = untracked(() => this._measureKeyCell.value); // read untracked — effect fires on layout change (leaf writes), by which point measureKey is already set
        if (!lInited) { lInited = true; seenSort = sort; seenOrient = orient; seenMeasureKey = measureKey; seenCollapsed = collapsed; lx.value = t.x; ly.value = t.y; return; }
        // Two-lane split. TWEEN for a real STRUCTURAL change (sort / orientation /
        // measure swap / collapse-expand) — nodes slide to new positions. SNAP
        // for everything else: active gesture (real-time drag), and — crucially —
        // value edits / commits / resize, including REMOTE cross-tile edits that
        // carry no gesture class (R2: value changes are write-through, no settle-lag).
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

    const posOf = (n: BiNode) => {
      const c = posCells.get(n);
      const x = PAD_LEFT + (c?.lx.value ?? 0);
      const y = PAD_TOP + (c?.ly.value ?? 0);
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

    // All nodes + edges live in this group so pan/zoom can move them together.
    const content = s(group());

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

      content.add(line(from, to, { stroke: "#3a3f4a", thin: true, opacity: edgeOpacity }));
    }

    // Draw nodes as solid, rounded rectangles with centered labels.
    // Inner nodes toggle collapsed state on click/double-tap.
    for (const { node, depth, isLeaf } of allNodes) {
      if (this.maxDepth !== undefined && depth > this.maxDepth) continue;

      const nodePos = Vec.derive(() => posOf(node));
      const hasChildren = !isLeaf;

      const isCollapsedNode = derive(() => this._collapsedCell.value.has(node));
      const stroke = derive(() =>
        state.focused.value === node ? "#fff"
        : hoverCell.value === node ? "#c8cdd6"
        : isCollapsedNode.value ? "#7a8499"
        : NODE_STROKE,
      );
      const strokeWidth = derive(() =>
        state.focused.value === node || hoverCell.value === node ? 2
        : isCollapsedNode.value ? 2
        : 1.5
      );
      // Collapsed inner nodes get a dim background fill to indicate hidden content
      const nodeFill = derive(() =>
        hasChildren && isCollapsedNode.value ? "#2a3040" : node.value.color
      );
      const ink = derive(() => labelInk(nodeFill.value));
      // Blend aesthetic opacity (leaf = 0.95, inner = 0.7) with the
      // visibility opacity (1 = visible, 0 = hidden inside collapsed subtree)
      const aestheticOp = isLeaf ? 0.95 : 0.7;
      const visOp = opacityCells.get(node)!;
      const opacity = derive(() => aestheticOp * visOp.value);

      const nodeShape = content.add(
        rect(nodePos, nodeW, nodeH, {
          fill: nodeFill,
          opacity,
          stroke,
          strokeWidth,
          corner: NODE_CORNER,
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
      // Disable pointer events on hidden nodes so they don't block clicks on visible parents
      biEffect(() => {
        const isHidden = isInsideCollapsed(node);
        nodeShape.el.style.pointerEvents = isHidden ? 'none' : '';
      });
      nodeShape.el.addEventListener("click", () => {
        // Nodes with children toggle their collapsed state on click.
        // Leaves only update focus.
        if (hasChildren) toggleCollapsed(node);
        state.focused.value = node;
      });
      nodeShape.el.addEventListener("dblclick", (e) => {
        // Double-tap/click on a node toggles via the click handler.
        // Stop propagation so the host drill handler never fires.
        e.stopPropagation();
      });
      nodeShape.el.addEventListener("focus", () => { state.focused.value = node; });
      nodeShape.el.addEventListener("blur", () => { if (state.focused.value === node) state.focused.value = null; });
      nodeShape.el.addEventListener("pointerenter", () => { state.hovered.current = node; hoverCell.value = node; state.emitHover?.(node); });
      nodeShape.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) { state.hovered.current = null; hoverCell.value = null; state.emitHover?.(null); } });

      const labelText = derive(() => {
        const fontSize = Math.max(9, nodeH.value * 0.36);
        const maxTextW = nodeW.value - LABEL_PAD_X * 2;
        if (depth === 0) return fitText(node.value.label, maxTextW, fontSize);
        if (hasChildren && isCollapsedNode.value) return fitText(`${node.value.label} ▸`, maxTextW, fontSize);
        const showValue = isLeaf && nodeW.value >= 48 && nodeH.value >= 34;
        if (isLeaf && showValue) {
          const lbl = fitText(node.value.label, maxTextW, fontSize);
          return `${lbl}\n${node.value.total.value.toFixed(0)}`;
        }
        return fitText(node.value.label, maxTextW, fontSize);
      });
      const labelSize = derive(() => Math.max(9, nodeH.value * 0.36));
      const labelOpacity = derive(() => visOp.value);

      content.add(
        label(nodePos, labelText, {
          size: labelSize,
          align: Anchor.Center,
          fill: ink,
          bold: !isLeaf,
          opacity: labelOpacity,
        }),
      );
    }

    // Touch/mouse pan and pinch-to-zoom for mobile usability.
    const zoomBehavior = zoom<HTMLElement, unknown>()
      .scaleExtent([0.5, 5])
      .filter((event) => {
        // Let Ctrl/Cmd+wheel keep editing the focused/hovered value.
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
    // Keep double-click reserved for collapse/expand, not d3-zoom's default zoom.
    this._zoomSelection.on('dblclick.zoom', null);
    this.style.cursor = 'grab';

    if (!this.hasAttribute('no-source')) s(
      label(
        view.bottom.up(10),
        derive(() => {
          const f = state.focused.value;
          return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · click/double-tap inner nodes to collapse/expand · drag/pinch to pan-zoom · hover + cmd/ctrl+wheel`;
        }),
        { size: 10, align: Anchor.Center, fill: "#9aa0a8" },
      ),
    );
  }
}
