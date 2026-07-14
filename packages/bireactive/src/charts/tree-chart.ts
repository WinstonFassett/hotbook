import {
  Anchor,
  derive,
  effect as biEffect,
  label,
  type Mount,
  num,
  pathD,
  rect,
  group,
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
import { DataViewController } from "../lib/data-view-controller";

const W = 560;
const H = 400;
const SORT_SEC = 0.35;

// Rounded-rect node style: rectangle encloses the label (big hit target).
const NODE_H = 24;
const NODE_H_ROOT = 28;
const NODE_CORNER = 6;
const NODE_STROKE = "#1a1d24";
const NODE_PAD_X = 10;
const NODE_MIN_W = 40;
const NODE_MIN_W_ROOT = 64;
const CHAR_WIDTH_EST = 0.58;

const LEAF_FONT = 11;
const INNER_FONT = 11;
const ROOT_FONT = 12;

/** Build a d3 hierarchy that excludes children of collapsed nodes.
 *  Collapsed parents lay out as leaves so visible nodes spread into the
 *  freed-up space. The FULL underlying BiNode tree is preserved — the
 *  collapse machinery is what hides deeper levels, so the user can always
 *  expand into them. */
function buildCollapsedHierarchy(
  root: BiNode,
  isCollapsedForLayout: (n: BiNode) => boolean,
  sortBy?: "index" | "value",
) {
  const h = buildHierarchy(root, sortBy);
  h.each((d) => {
    if (isCollapsedForLayout(d.data) && d.children) {
      d.children = undefined;
    }
  });
  return h;
}

function estTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH_EST;
}

function relLuminance(hex: string): number {
  if (!hex.startsWith("#") || hex.length < 7) return 0;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toL = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toL(r) + 0.7152 * toL(g) + 0.0722 * toL(b);
}
function labelInk(color: string): string {
  return relLuminance(color) > 0.5 ? "#111" : "#f0f2f6";
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
      cursor: pointer;
    }
  `

  externalRoot?: BiNode;

  private _sortByCell = cell<'index' | 'value'>('index')
  get sortBy(): 'index' | 'value' { return this._sortByCell.value }
  set sortBy(v: 'index' | 'value') { this._sortByCell.value = v }

  private _orientationCell = cell<'vertical' | 'horizontal'>('vertical')
  get orientation(): 'vertical' | 'horizontal' { return this._orientationCell.value }
  set orientation(v: 'vertical' | 'horizontal') { this._orientationCell.value = v }

  private _measureKeyCell = cell<string>('')
  get measureKey(): string { return this._measureKeyCell.value }
  set measureKey(v: string) { this._measureKeyCell.value = v }

  // Reactive maxDepth — the tile-binder writes `el.maxDepth = ...` and
  // expects the chart to re-render. Sunburst/treemap/pack/icicle all use
  // this pattern; this cell brings the tree in line.
  //   undefined → show every level (matches sunburst/treemap; hotbook's
  //               depth picker maps "All" → 0 → undefined at the tile-source layer)
  //   0         → show every level
  //   N > 0     → show levels 0..N; deeper levels start collapsed but user
  //               can expand them by clicking the depth-N node.
  private _maxDepthCell = cell<number | undefined>(undefined)
  get maxDepth(): number | undefined { return this._maxDepthCell.value }
  set maxDepth(v: number | undefined) { this._maxDepthCell.value = v }

  // Explicit user collapse/expand sets:
  //   collapsed → user explicitly hid children (overrides any auto-expand)
  //   expanded  → user explicitly revealed children past maxDepth
  // Effective collapse = collapsed.has(n) || (depth(n) >= effectiveDepth && !expanded.has(n))
  private _collapsedCell = cell<Set<BiNode>>(new Set<BiNode>())
  private _expandedCell = cell<Set<BiNode>>(new Set<BiNode>())

  dataView!: DataViewController;

  connectedCallback(): void {
    this.dataView = new DataViewController();
    super.connectedCallback();
  }

  private _zoomSelection?: any;

  disconnectedCallback() {
    super.disconnectedCallback();
    this._zoomSelection?.on('.zoom', null);
    this.style.cursor = '';
    this.dataView?.dispose();
  }

  protected scene(s: Mount): void {
    const root = this.externalRoot ?? portfolio();

    // Use real tile size so the tree fills its container.
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
    attachChartGestures(this, { root, parentOf, state, dataView: this.dataView });
    const hoverCell = cell<BiNode | null>(null);
    state.hoverCell = hoverCell;

    // Full traversal — no pruning. Every node exists in the render list;
    // visibility is driven by the collapse machinery so any level is reachable.
    const allNodes = [...walkWithDepth(root)];

    // Fixed node sizes derived from actual label lengths — enclosing rects
    // (Winston's preferred style, bigger hit targets).
    const nodeSizeOf = (n: BiNode, depth: number, isLeaf: boolean) => {
      const fontSize = depth === 0 ? ROOT_FONT : isLeaf ? LEAF_FONT : INNER_FONT;
      // Reserve room for the collapse marker on inner nodes so it doesn't
      // suddenly widen the rect when the user toggles collapse.
      const suffix = isLeaf ? "" : "  ▸";
      const textW = estTextWidth(n.value.label + suffix, fontSize);
      const minW = depth === 0 ? NODE_MIN_W_ROOT : NODE_MIN_W;
      const w = Math.max(minW, textW + NODE_PAD_X * 2);
      const h = depth === 0 ? NODE_H_ROOT : NODE_H;
      return { w, h, fontSize };
    };
    const nodeSize = new Map<BiNode, { w: number; h: number; fontSize: number }>();
    for (const { node, depth, isLeaf } of allNodes) {
      nodeSize.set(node, nodeSizeOf(node, depth, isLeaf));
    }

    // Layout separation: idiomatic dendrograms give siblings less space than
    // cousins. Also scale by node-size to keep rects from overlapping.
    const maxNodeW = Math.max(...Array.from(nodeSize.values()).map((v) => v.w));
    const maxNodeH = Math.max(...Array.from(nodeSize.values()).map((v) => v.h));

    // Padding: half a node-dim + a breathing gap so rects don't clip the edges.
    const PAD_V_TOP = maxNodeH / 2 + 6;
    const PAD_V_BOTTOM = maxNodeH / 2 + 10;
    const PAD_V_SIDE = maxNodeW / 2 + 6;
    const PAD_H_LEFT = maxNodeW / 2 + 6;
    const PAD_H_RIGHT = maxNodeW / 2 + 6;
    const PAD_H_TOP = maxNodeH / 2 + 6;
    const PAD_H_BOTTOM = maxNodeH / 2 + 10;

    // Effective depth limit — 0 or undefined means "All" (show every level).
    const effectiveMaxDepth = () => {
      const v = this._maxDepthCell.value;
      if (v === undefined || v === 0) return Infinity;
      return v;
    };
    const depthOf = new Map<BiNode, number>();
    for (const { node, depth } of allNodes) depthOf.set(node, depth);

    // For layout: a node's children are hidden if it is effectively-collapsed.
    const isCollapsedForLayout = (n: BiNode): boolean => {
      if (this._collapsedCell.value.has(n)) return true;
      const d = depthOf.get(n) ?? 0;
      return d >= effectiveMaxDepth() && !this._expandedCell.value.has(n);
    };

    // For rendering visibility: a node is hidden if any ancestor is collapsed.
    const isInsideCollapsed = (n: BiNode): boolean => {
      let cur: BiNode | undefined = parentOf(n);
      while (cur) {
        if (isCollapsedForLayout(cur)) return true;
        cur = parentOf(cur);
      }
      return false;
    };

    // d3.tree() layout on the reduced hierarchy.
    const layout = derive(() => {
      // Read the reactive triggers so this derive re-runs on any change.
      void this._maxDepthCell.value;
      void this._collapsedCell.value;
      void this._expandedCell.value;
      const h = buildCollapsedHierarchy(root, isCollapsedForLayout, this._sortByCell.value);
      const isHorizontal = this._orientationCell.value === 'horizontal';
      const availW = isHorizontal
        ? Math.max(1, Wc.value - PAD_H_LEFT - PAD_H_RIGHT)
        : Math.max(1, Wc.value - PAD_V_SIDE * 2);
      const availH = isHorizontal
        ? Math.max(1, Hc.value - PAD_H_TOP - PAD_H_BOTTOM)
        : Math.max(1, Hc.value - PAD_V_TOP - PAD_V_BOTTOM);

      const t = tree<BiNode>()
        .size(isHorizontal ? [availH, availW] : [availW, availH])
        // separation: 1.0 siblings, 1.4 cousins — a little breathing room
        // so rects don't overlap in narrow subtrees.
        .separation((a, b) => (a.parent === b.parent ? 1 : 1.4));
      t(h);

      const map = new Map<BiNode, HierarchyPointNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyPointNode<BiNode>));
      // Hidden nodes fall back to their nearest visible ancestor's position
      // so they slide in/out on collapse/expand.
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
        return l.isHorizontal ? { x: y, y: x } : { x, y };
      });
      let lcancel: (() => void) | null = null;
      let lInited = false;
      let seenSort = untracked(() => this._sortByCell.value);
      let seenOrient = untracked(() => this._orientationCell.value);
      let seenMeasureKey = untracked(() => this._measureKeyCell.value);
      let seenCollapsed = untracked(() => this._collapsedCell.value);
      let seenExpanded = untracked(() => this._expandedCell.value);
      let seenMaxDepth = untracked(() => this._maxDepthCell.value);
      biEffect(() => {
        const t = ltarget.value;
        const sort = this._sortByCell.value;
        const orient = this._orientationCell.value;
        const collapsed = this._collapsedCell.value;
        const expanded = this._expandedCell.value;
        const maxDepthV = this._maxDepthCell.value;
        const measureKey = untracked(() => this._measureKeyCell.value);
        if (!lInited) {
          lInited = true;
          seenSort = sort; seenOrient = orient; seenMeasureKey = measureKey;
          seenCollapsed = collapsed; seenExpanded = expanded; seenMaxDepth = maxDepthV;
          lx.value = t.x; ly.value = t.y;
          return;
        }
        const structural =
          sort !== seenSort ||
          orient !== seenOrient ||
          measureKey !== seenMeasureKey ||
          collapsed !== seenCollapsed ||
          expanded !== seenExpanded ||
          maxDepthV !== seenMaxDepth;
        seenSort = sort; seenOrient = orient; seenMeasureKey = measureKey;
        seenCollapsed = collapsed; seenExpanded = expanded; seenMaxDepth = maxDepthV;
        if (structural && this.dataView.getState().key !== 'Gesturing') {
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
      const isHorizontal = layout.value.isHorizontal;
      const padX = isHorizontal ? PAD_H_LEFT : PAD_V_SIDE;
      const padY = isHorizontal ? PAD_H_TOP : PAD_V_TOP;
      return { x: padX + (c?.lx.value ?? 0), y: padY + (c?.ly.value ?? 0) };
    };

    // Reactive visibility opacity, tweened on collapse/expand.
    const opacityCells = new Map<BiNode, ReturnType<typeof num>>();
    for (const { node } of allNodes) {
      const initHidden = untracked(() => isInsideCollapsed(node));
      const op = num(initHidden ? 0 : 1);
      opacityCells.set(node, op);
      const opTarget = derive(() => {
        void this._collapsedCell.value;
        void this._expandedCell.value;
        void this._maxDepthCell.value;
        return isInsideCollapsed(node) ? 0 : 1;
      });
      let opCancel: (() => void) | null = null;
      let opInited = false;
      biEffect(() => {
        const target = opTarget.value;
        if (!opInited) { opInited = true; op.value = target; return; }
        opCancel?.();
        opCancel = this.anim.start(tween(op, target, SORT_SEC, easeOut) as any);
      });
    }

    // Toggle: user click on an inner node
    //   - If the node has children in the underlying tree:
    //       - if currently effectively-expanded → collapse it
    //       - if currently effectively-collapsed → expand it
    //     Uses `collapsed` and `expanded` sets to override the depth default.
    const hasChildren = (n: BiNode) => n.children.length > 0;
    const toggleCollapsed = (node: BiNode) => {
      if (!hasChildren(node)) return;
      const currentlyCollapsed = isCollapsedForLayout(node);
      const c = new Set(this._collapsedCell.value);
      const e = new Set(this._expandedCell.value);
      if (currentlyCollapsed) {
        // reveal children
        c.delete(node);
        e.add(node);
      } else {
        // hide children
        e.delete(node);
        c.add(node);
      }
      this._collapsedCell.value = c;
      this._expandedCell.value = e;
    };

    // All nodes + edges live in this group so pan/zoom moves them together.
    const content = s(group());

    // Curved bezier edges under nodes. Each edge fades with its child's opacity.
    for (const { node, depth } of allNodes) {
      if (depth === 0) continue;
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

    // Rounded-rect nodes with labels inside — Winston's preferred style,
    // big hit targets.
    for (const { node, depth, isLeaf } of allNodes) {
      const isRoot = depth === 0;
      const inner = !isLeaf;
      const size = nodeSize.get(node)!;
      const nodePos = Vec.derive(() => posOf(node));

      const isCollapsedNode = derive(() => {
        void this._collapsedCell.value;
        void this._expandedCell.value;
        void this._maxDepthCell.value;
        return inner && isCollapsedForLayout(node);
      });

      const nodeFill = derive(() =>
        inner && isCollapsedNode.value ? "#2f3646" : node.value.color,
      );
      const stroke = derive(() =>
        state.focused.value === node ? "#fff"
        : hoverCell.value === node ? "#c8cdd6"
        : NODE_STROKE,
      );
      const strokeWidth = derive(() =>
        state.focused.value === node || hoverCell.value === node ? 2 : 1.25,
      );
      const ink = derive(() => labelInk(nodeFill.value));
      const visOp = opacityCells.get(node)!;
      const nodeOpacity = derive(() => visOp.value);

      const nodeShape = content.add(
        rect(nodePos, size.w, size.h, {
          fill: nodeFill,
          opacity: nodeOpacity,
          stroke,
          strokeWidth,
          corner: NODE_CORNER,
        }),
      );
      nodeShape.el.classList.add('tree-node');
      nodeShape.el.setAttribute('tabindex', '0');
      nodeShape.el.setAttribute('data-focusable', 'node');
      biEffect(() => {
        const collapsedSuffix = isCollapsedNode.value && inner ? ' (collapsed)' : '';
        nodeShape.el.setAttribute(
          'aria-label',
          `${node.value.label}: ${node.value.total.value.toFixed(0)}${collapsedSuffix}`,
        );
      });
      biEffect(() => {
        nodeShape.el.style.pointerEvents = isInsideCollapsed(node) ? 'none' : '';
      });
      nodeShape.el.addEventListener("click", () => {
        if (inner) toggleCollapsed(node);
        state.focused.value = node;
      });
      nodeShape.el.addEventListener("dblclick", (e) => { e.stopPropagation(); });
      nodeShape.el.addEventListener("focus", () => { state.focused.value = node; });
      nodeShape.el.addEventListener("blur", () => {
        if (state.focused.value === node) state.focused.value = null;
      });
      nodeShape.el.addEventListener("pointerenter", () => {
        state.hovered.current = node; hoverCell.value = node; state.emitHover?.(node);
      });
      nodeShape.el.addEventListener("pointerleave", () => {
        if (state.hovered.current === node) {
          state.hovered.current = null; hoverCell.value = null; state.emitHover?.(null);
        }
      });

      const labelText = derive(() => {
        if (inner && isCollapsedNode.value) return `${node.value.label}  ▸`;
        return node.value.label;
      });

      content.add(
        label(nodePos, labelText, {
          size: size.fontSize,
          align: Anchor.Center,
          fill: ink,
          bold: isRoot || inner,
          opacity: nodeOpacity,
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
