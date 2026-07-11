import {
  Anchor,
  derive,
  forEach,
  group,
  label,
  type Mount,
  cell,
  annularSector,
  circle,
  Vec,
  num,
  tween,
  easeOut,
  effect as biEffect,
  untracked,
} from "bireactive";
import { circleHandle, lineHandle } from "../lib/handles";
import { Diagram } from "../lib/diagram";
import { partition, type HierarchyRectangularNode } from "d3-hierarchy";
import { depthFill, labelInk } from "../lib/depth-color";
import { buildHierarchy } from "../lib/interaction";
import { buildParentIndex, type BiNode, portfolio, walkWithDepth } from "../lib/tree";
import { attachChartGestures, type SelectionState } from "../lib/gestures";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import { mountDrillBreadcrumb } from "../lib/drill-breadcrumb";
import { dragCancelable } from "../lib/esc-contract";
import { GESTURE_SUPPRESSION_CSS, GESTURE_ACTIVE_CLASS } from "../lib/transitions";
import { withExitDelay, enterExitFade, membershipCell } from "../lib/mark-lifecycle";
import type { ElementWithBridge } from "../lib/hud-bridge";

const W = 480;
const H = 480;
const DRILL_DURATION = 800; // ms — leave-timer / CSS settle window
const DRILL_SEC = DRILL_DURATION / 1000; // s — bireactive anim clock runs in seconds
const SORT_SEC = 0.35; // s — sort/reorder tween duration

export class MdSunburstLC extends Diagram {
  static styles = `:host { overflow: hidden; }text { pointer-events: none; }${FILL_STYLE}${GESTURE_SUPPRESSION_CSS}:host(.vf-gesture-active) circle[r="5"] { opacity: 0; } circle[r="5"] { transition: opacity 0.3s ease; }[data-focusable]:focus { outline: 2px solid #4a9eff; outline-offset: 2px; } [data-focusable]:focus:not(:focus-visible) { outline: none; }`
  externalRoot?: BiNode
  drillKey?: string

  // Reactive so the levels dropdown drives enter/exit fades instead of a remount.
  private _maxDepthCell = cell<number | undefined>(undefined)
  get maxDepth(): number | undefined { return this._maxDepthCell.value }
  set maxDepth(v: number | undefined) { this._maxDepthCell.value = v }

  private _drillIdCell = cell<string | null>(null)
  get drillNodeId(): string | null { return this._drillIdCell.value }
  set drillNodeId(id: string | null) { this._drillIdCell.value = id ?? null }

  private _sortByCell = cell<'index' | 'value'>('index')
  get sortBy(): 'index' | 'value' { return this._sortByCell.value }
  set sortBy(v: 'index' | 'value') { this._sortByCell.value = v }

  private _measureKeyCell = cell<string>('')
  get measureKey(): string { return this._measureKeyCell.value }
  set measureKey(v: string) { this._measureKeyCell.value = v }

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
    attachChartGestures(this, { root, parentOf, state, scalingMode: "proportional-neighbor" });
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

    const maxDepthCell = this._maxDepthCell;

    const Rfull = derive(() => Math.min(Wc.value, Hc.value) / 2 - 4);

    // Natural partition layout — no pre-scaling. Viewport does all fitting.
    const layout = derive(() => {
      const rfull = Rfull.value;
      const h = buildHierarchy(root, this._sortByCell.value);
      partition<BiNode>().size([2 * Math.PI, rfull])(h);
      const map = new Map<BiNode, HierarchyRectangularNode<BiNode>>();
      h.each((d) => map.set(d.data, d as HierarchyRectangularNode<BiNode>));
      return map;
    });

    // Viewport cells for angle (x) and radius (y) domains.
    const va0 = num(0);
    const va1 = num(2 * Math.PI);
    const vr0 = num(0);
    const vr1 = num(Rfull.value);

    // Focus depth (reactive).
    const focusDepth = derive(() => {
      const id = this._drillIdCell.value;
      if (!id) return 0;
      const n = nodeById.get(id);
      return n ? (nodeDepth.get(n) ?? 0) : 0;
    });

    // Window: children of the drilled node only (not full-tree siblings).
    // Walking the whole tree and including off-angle siblings produces slivers:
    // their remapped angles fall outside [0, 2π] causing degenerate arc paths.
    const windowTarget = derive((): readonly BiNode[] => {
      const fd = focusDepth.value;
      const id = this._drillIdCell.value;
      const maxD = maxDepthCell.value;
      const maxWindow = maxD !== undefined && maxD > 0 ? fd + maxD : totalDepth;
      const result: BiNode[] = [];
      const focusNode = id ? nodeById.get(id) : null;
      for (const { node, depth: relDepth } of walkWithDepth(focusNode ?? root)) {
        const absDepth = (focusNode ? fd : 0) + relDepth;
        if (absDepth > fd && absDepth <= maxWindow) result.push(node);
      }
      return result;
    });

    // Rendered set (WIN-155): current window + departing nodes held briefly so
    // the exit CSS fade can play — including on drill. Exiting arcs freeze
    // their layout cells below so they don't remap to degenerate geometry as
    // the viewport tweens.
    const renderedSet = withExitDelay(windowTarget, {
      key: (n) => n,
    });
    const windowMembership = membershipCell(windowTarget, (n) => n);

    let drillInited = false;
    let lastDrillId: string | null = null;
    let lastMaxDepthSeen: number | undefined = undefined;
    let drillCancel: (() => void) | null = null;
    let drillClassTimer: ReturnType<typeof setTimeout> | null = null;
    biEffect(() => {
      const id = this._drillIdCell.value;
      const rfull = Rfull.value;
      // Track maxDepth so the levels dropdown re-tweens the viewport — inner
      // rings expand to fill the space vacated by the outer rings, and vice
      // versa when levels are added back (WIN-155 relayout).
      const maxDTracked = maxDepthCell.value;
      let ta0: number, ta1: number, tr0: number, tr1: number;

      const lmap = untracked(() => layout.value);
      if (id) {
        const biNode = nodeById.get(id);
        const lnode = biNode ? lmap.get(biNode) : null;
        if (lnode) {
          const fd = nodeDepth.get(biNode!) ?? 0;
          const maxD = maxDTracked;
          const maxWindow = maxD !== undefined && maxD > 0 ? fd + maxD : totalDepth;
          // Walk only the focus subtree to find the deepest rendered ring.
          let maxR1 = lnode.y1;
          for (const { node, depth: relDepth } of walkWithDepth(biNode!)) {
            const absDepth = fd + relDepth;
            if (absDepth > fd && absDepth <= maxWindow) {
              const ln = lmap.get(node);
              if (ln && ln.y1 > maxR1) maxR1 = ln.y1;
            }
          }
          ta0 = lnode.x0; ta1 = lnode.x1; tr0 = lnode.y1; tr1 = maxR1;
        } else {
          ta0 = 0; ta1 = 2 * Math.PI; tr0 = 0; tr1 = rfull;
        }
      } else {
        // At root: map [root.y1, maxRendered.y1] → [0, Rfull].
        const rootLayout = lmap.get(root);
        tr0 = rootLayout ? rootLayout.y1 : 0;
        const maxD = maxDTracked;
        // WIN-155: when depth is capped, walk the tree to find the outer y1
        // of the deepest RENDERED ring, so the viewport tween shrinks vr1 and
        // the surviving inner rings expand radially. Without a cap we use the
        // full natural radius. Prior code initialized maxR1 = rfull and only
        // expanded via `>`, so depth caps never shrank the viewport.
        let maxR1: number;
        if (maxD !== undefined && maxD > 0) {
          const maxWindow = maxD;
          maxR1 = 0;
          for (const { node, depth } of walkWithDepth(root)) {
            if (depth > 0 && depth <= maxWindow) {
              const ln = lmap.get(node);
              if (ln && ln.y1 > maxR1) maxR1 = ln.y1;
            }
          }
          if (maxR1 === 0) maxR1 = rfull; // fallback if walk found nothing
        } else {
          maxR1 = rfull;
        }
        ta0 = 0; ta1 = 2 * Math.PI; tr1 = maxR1;
      }

      const drillChanged = id !== lastDrillId;
      const depthChanged = maxDTracked !== lastMaxDepthSeen;
      lastDrillId = id;
      lastMaxDepthSeen = maxDTracked;
      if (!drillInited) {
        va0.value = ta0; va1.value = ta1; vr0.value = tr0; vr1.value = tr1;
        drillInited = true;
        return;
      }
      if (!drillChanged) {
        // Resize or depth-only change: re-tween from current to new target.
        // WIN-155 relayout — when the levels dropdown drops or adds rings, the
        // inner rings expand or contract to fill the space via this tween.
        drillCancel?.();
        drillCancel = this.anim.start(
          tween(va0, ta0, DRILL_SEC, easeOut),
          tween(va1, ta1, DRILL_SEC, easeOut),
          tween(vr0, tr0, DRILL_SEC, easeOut),
          tween(vr1, tr1, DRILL_SEC, easeOut),
        );
        // Note: depth changes intentionally do NOT toggle GESTURE_ACTIVE_CLASS
        // — that suppresses ALL descendant transitions, which would kill the
        // per-arc enter/exit opacity fade this ticket adds.
        return;
      }
      // Cancel any in-flight drill tween before starting a new one.
      drillCancel?.();
      drillCancel = null;
      // Suppress CSS transitions on arc `d` attribute during drill (the bireactive
      // tween sets `d` every frame; CSS interpolation between consecutive frames
      // causes large-arc-flag flips → sliver/spoke artifacts).
      if (drillClassTimer) { clearTimeout(drillClassTimer); drillClassTimer = null; }
      this.classList.add('vf-gesture-active');
      drillClassTimer = setTimeout(() => {
        drillClassTimer = null;
        this.classList.remove('vf-gesture-active');
      }, DRILL_DURATION + 60);
      // Drive the viewport tween on this Diagram's anim clock — `tween()` alone
      // only builds a generator; it must be started to advance per frame.
      drillCancel = this.anim.start(
        tween(va0, ta0, DRILL_SEC, easeOut),
        tween(va1, ta1, DRILL_SEC, easeOut),
        tween(vr0, tr0, DRILL_SEC, easeOut),
        tween(vr1, tr1, DRILL_SEC, easeOut),
      );
    });

    const remapAngle = (rawA: number) => {
      const spanA = va1.value - va0.value;
      return spanA === 0 ? 0 : (rawA - va0.value) / spanA * 2 * Math.PI;
    };
    const remapRadius = (rawR: number) => {
      const spanR = vr1.value - vr0.value;
      return spanR === 0 ? 0 : (rawR - vr0.value) / spanR * Rfull.value;
    };

    const center = Vec.derive(() => ({ x: Wc.value / 2, y: Hc.value / 2 }));

    // Windowed arc rendering.
    const arcLayer = s(group());
    forEach(arcLayer, renderedSet, (node) => {
      const depth = nodeDepth.get(node) ?? 1;

      // Per-arc raw layout-position cells. Tweened on sort change so arcs sweep
      // to their new angular positions; snapped on value/resize changes so drag
      // editing stays real-time. a0/a1/rIn/rOut below derive from these tweened
      // cells + the viewport remap, so drill (viewport tween) and sort (layout
      // tween) compose without conflict.
      const lseed = untracked(() => layout.value.get(node)) ?? { x0: 0, x1: 0, y0: 0, y1: 0 };
      const la0 = num(lseed.x0), la1 = num(lseed.x1), lr0 = num(lseed.y0), lr1 = num(lseed.y1);
      const ltarget = derive(() => {
        const ln = layout.value.get(node);
        return ln ? { x0: ln.x0, x1: ln.x1, y0: ln.y0, y1: ln.y1 } : { x0: 0, x1: 0, y0: 0, y1: 0 };
      });
      let lcancel: (() => void) | null = null;
      let lInited = false;
      let seenSortBy = untracked(() => this._sortByCell.value);
      let seenMeasureKey = untracked(() => this._measureKeyCell.value);
      biEffect(() => {
        const t = ltarget.value; // track layout (reacts to sort + value + size)
        const sortBy = this._sortByCell.value; // track sort key so a toggle re-fires this effect
        const measureKey = untracked(() => this._measureKeyCell.value); // read untracked — effect fires on layout change (leaf writes), by which point measureKey is already set
        // WIN-155: freeze layout for arcs that have left the window so their
        // exit fade plays at the last visible position instead of remapping
        // through the drill viewport tween.
        if (lInited && !untracked(() => windowMembership.value.has(node))) return;
        if (!lInited) { lInited = true; seenSortBy = sortBy; seenMeasureKey = measureKey; la0.value = t.x0; la1.value = t.x1; lr0.value = t.y0; lr1.value = t.y1; return; }
        // Two-lane split. TWEEN for a real reorder (sort key toggled) or measure
        // swap — arcs sweep to new angular slots. SNAP for everything else: active
        // gesture (real-time drag), and — crucially — value edits / commits /
        // resize, including REMOTE cross-tile edits that carry no gesture class
        // (R2: value changes are write-through, no 250-350ms settle-lag).
        const reordered = sortBy !== seenSortBy;
        const measureSwapped = measureKey !== seenMeasureKey;
        seenSortBy = sortBy;
        seenMeasureKey = measureKey;
        if ((reordered || measureSwapped) && !this.classList.contains(GESTURE_ACTIVE_CLASS)) {
          lcancel?.();
          lcancel = this.anim.start(
            tween(la0, t.x0, SORT_SEC, easeOut),
            tween(la1, t.x1, SORT_SEC, easeOut),
            tween(lr0, t.y0, SORT_SEC, easeOut),
            tween(lr1, t.y1, SORT_SEC, easeOut),
          );
        } else {
          lcancel?.(); lcancel = null;
          la0.value = t.x0; la1.value = t.x1; lr0.value = t.y0; lr1.value = t.y1;
        }
      });

      // WIN-155: while an arc is exiting, freeze its remapped geometry to the
      // last visible snapshot so the fade-out plays in place instead of
      // sliding through the drill viewport tween.
      let frozenGeom: { a0: number; a1: number; rIn: number; rOut: number } | null = null;
      const a0Raw = derive(() => remapAngle(la0.value));
      const a1Raw = derive(() => remapAngle(la1.value));
      const rInRaw = derive(() => Math.max(0, remapRadius(lr0.value)));
      const rOutRaw = derive(() => Math.max(0, remapRadius(lr1.value)));
      const a0 = derive(() => {
        if (windowMembership.value.has(node)) { frozenGeom = null; return a0Raw.value; }
        if (!frozenGeom) frozenGeom = { a0: a0Raw.peek(), a1: a1Raw.peek(), rIn: rInRaw.peek(), rOut: rOutRaw.peek() };
        return frozenGeom.a0;
      });
      const a1 = derive(() => (frozenGeom ? frozenGeom.a1 : a1Raw.value));
      const rIn = derive(() => (frozenGeom ? frozenGeom.rIn : rInRaw.value));
      const rOut = derive(() => (frozenGeom ? frozenGeom.rOut : rOutRaw.value));
      const stroke = derive(() =>
        state.focused.value === node ? "#fff"
        : hoverCell.value === node ? "#c8cdd6"
        : "#0b0d12"
      );
      const strokeWidth = derive(() => (state.focused.value === node || hoverCell.value === node ? 2 : 1));

      const arc = annularSector(center, rOut, rIn, a0, a1, {
        fill: depthFill(node.value.color, depth).toString(),
        stroke,
        strokeWidth,
      });
      arc.el.dataset.id = node.value.id ?? "";
      arc.el.style.cursor = "pointer";
      arc.el.setAttribute('tabindex', '0');
      arc.el.setAttribute('data-focusable', 'arc');

      // WIN-155 enter/exit fade — arc fades in on mount, fades out when the
      // node leaves the drill window (held in renderedSet by withExitDelay).
      const arcPresent = derive(() => windowMembership.value.has(node));
      enterExitFade(arc.el, { present: arcPresent });
      biEffect(() => {
        arc.el.setAttribute('aria-label', `${node.value.label}: ${node.value.total.value.toFixed(0)}`);
      });
      arc.el.addEventListener("click", () => { state.focused.value = node; });
      arc.el.addEventListener("focus", () => { state.focused.value = node; });
      arc.el.addEventListener("blur", () => { if (state.focused.value === node) state.focused.value = null; });
      arc.el.addEventListener("pointerenter", () => { state.hovered.current = node; hoverCell.value = node; state.emitHover?.(node); });
      arc.el.addEventListener("pointerleave", () => { if (state.hovered.current === node) { state.hovered.current = null; hoverCell.value = null; state.emitHover?.(null); } });

      // Label rendering — only show for arcs large enough to fit text
      const isLeaf = !node.children || node.children.length === 0;
      const arcAngleSpan = derive(() => Math.abs(a1.value - a0.value));
      const arcRadialThickness = derive(() => rOut.value - rIn.value);
      const showLabel = derive(() => {
        // Only show label if arc is large enough: at least 0.15 radians (~8.6°) and 20px thick
        return arcAngleSpan.value >= 0.15 && arcRadialThickness.value >= 20;
      });

      const labelPos = Vec.derive(() => {
        const midAngle = (a0.value + a1.value) / 2;
        const midRadius = (rIn.value + rOut.value) / 2;
        const c = center.value;
        return { x: c.x + midRadius * Math.cos(midAngle), y: c.y + midRadius * Math.sin(midAngle) };
      });

      const labelText = derive(() => {
        if (!showLabel.value) return '';
        return isLeaf
          ? `${node.value.label}\n${node.value.total.value.toFixed(0)}`
          : node.value.label;
      });

      const nodeFill = depthFill(node.value.color, depth);
      const lbl = label(labelPos, labelText, {
        size: isLeaf ? 11 : 10,
        align: Anchor.Center,
        fill: labelInk(nodeFill),
        bold: !isLeaf,
      });

      // group(opts, ...children): first arg is OPTS — passing the arc there
      // silently swallowed it (labels-only sunburst). Return both shapes.
      return [arc, lbl];
    }, { key: (n) => n.value.id });

    // Windowed handle rendering.
    if (!this.hasAttribute("no-handles")) {
      type HandleItem = { aNode: BiNode; bNode: BiNode };
      const handleWindow = derive((): readonly HandleItem[] => {
        const fd = focusDepth.value;
        const maxD = maxDepthCell.value;
        const maxWindow = maxD !== undefined && maxD > 0 ? fd + maxD : totalDepth;

        // Group nodes by depth level
        const byDepth = new Map<number, BiNode[]>();
        for (const n of renderedSet.value) {
          const d = nodeDepth.get(n) ?? 0;
          if (d <= fd || d > maxWindow) continue;
          if (!byDepth.has(d)) byDepth.set(d, []);
          byDepth.get(d)!.push(n);
        }

        // For each depth level, sort nodes by angle and create handles
        const items: HandleItem[] = [];
        const lmap = layout.value;

        for (const nodes of byDepth.values()) {
          // Sort by angular position
          nodes.sort((a, b) => {
            const aLayout = lmap.get(a);
            const bLayout = lmap.get(b);
            if (!aLayout || !bLayout) return 0;
            return aLayout.x0 - bLayout.x0;
          });

          // Create handles between all adjacent pairs at this depth
          for (let i = 1; i < nodes.length; i++) {
            items.push({ aNode: nodes[i - 1]!, bNode: nodes[i]! });
          }
        }

        return items;
      });

      const handleLayer = s(group());
      forEach(handleLayer, handleWindow, ({ aNode, bNode }) => {
        const a = aNode.value.total;
        const b = bNode.value.total;

        const angStart = derive(() => layout.value.get(aNode)?.x0 ?? 0);
        const angEnd = derive(() => layout.value.get(bNode)?.x1 ?? 0);
        const rInRaw = derive(() => layout.value.get(aNode)?.y0 ?? 0);
        const rOutRaw = derive(() => layout.value.get(aNode)?.y1 ?? 0);
        const midRDisplay = derive(() => (remapRadius(rInRaw.value) + remapRadius(rOutRaw.value)) / 2);

        const boundaryAngDisplay = derive(() => {
          const va = a.value, vb = b.value;
          const sum = va + vb;
          const frac = sum === 0 ? 0.5 : va / sum;
          const rawAng = angStart.value + frac * (angEnd.value - angStart.value);
          return remapAngle(rawAng);
        });
        const knobPos = Vec.derive(() => {
          const ang = boundaryAngDisplay.value;
          const r = midRDisplay.value;
          const c = center.value;
          return { x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) };
        });

        const knob = Vec.lens(
          [a, b] as const,
          (vals: readonly [number, number]) => {
            const [va, vb] = vals;
            const sum = va + vb;
            const frac = sum === 0 ? 0.5 : va / sum;
            const rawAng = angStart.peek() + frac * (angEnd.peek() - angStart.peek());
            const dispAng = remapAngle(rawAng);
            const r = midRDisplay.peek();
            const c = center.peek();
            return { x: c.x + r * Math.cos(dispAng), y: c.y + r * Math.sin(dispAng) };
          },
          (target, vals) => {
            const [va, vb] = vals;
            const sum = va + vb;
            const rawA0 = angStart.peek();
            const rawA1 = angEnd.peek();
            if (sum === 0 || rawA1 <= rawA0) return [va, vb];
            const c = center.peek();
            let dispAng = Math.atan2(target.y - c.y, target.x - c.x);
            if (dispAng < 0) dispAng += 2 * Math.PI;
            const spanA = va1.value - va0.value;
            const rawAng = spanA === 0 ? dispAng : va0.value + (dispAng / (2 * Math.PI)) * spanA;
            let ang = rawAng;
            while (ang < rawA0 - Math.PI) ang += 2 * Math.PI;
            while (ang > rawA1 + Math.PI) ang -= 2 * Math.PI;
            let frac = (ang - rawA0) / (rawA1 - rawA0);
            frac = Math.max(0, Math.min(1, frac));
            const newA = frac * sum;
            return [newA, sum - newA];
          },
        );

        const active = cell(false);
        // For radial dividers, calculate handle orientation perpendicular to the radial angle
        const orient = derive(() => {
          const ang = boundaryAngDisplay.value;
          // Normalize to [0, 2π)
          const normAng = ang < 0 ? ang + 2 * Math.PI : ang;
          // If angle is closer to 0/2π (horizontal) or π (horizontal), handle is vertical ("vert")
          // If angle is closer to π/2 or 3π/2 (vertical), handle is horizontal ("horiz")
          const angleToNearestVertical = Math.min(
            Math.abs(normAng - Math.PI / 2),
            Math.abs(normAng - 3 * Math.PI / 2)
          );
          const angleToNearestHorizontal = Math.min(
            Math.abs(normAng),
            Math.abs(normAng - Math.PI),
            Math.abs(normAng - 2 * Math.PI)
          );
          return angleToNearestVertical < angleToNearestHorizontal ? "horiz" : "vert";
        });
        const handle = lineHandle(knobPos, orient, {
          kind: "divider",
          active,
        });
        const dispose = dragCancelable(handle, knob, [a, b], {
          host: this,
          onStart: () => { active.value = true; handle.el.style.cursor = "grabbing"; },
          onEnd: () => { active.value = false; handle.el.style.cursor = "grab"; },
        });
        handle.track(dispose);
        handle.el.style.cursor = "grab";
        handle.el.addEventListener("pointerenter", () => { active.value = true; });
        handle.el.addEventListener("pointerleave", () => { active.value = false; });

        return handle;
      }, { key: ({ bNode }) => bNode.value.id });
    }

    // Center hub rendered LAST so it sits above arcLayer and receives pointer events.
    // When drilled, the hub becomes the center and retains the drilled node's color.
    const hubVisible = derive(() => this._drillIdCell.value !== null);
    const hubFill = derive(() => {
      const id = this._drillIdCell.value;
      if (!id) return "#1a1d22";
      const n = nodeById.get(id);
      return n ? n.value.color : "#1a1d22";
    });
    const hub = s(circle(center, derive(() => hubVisible.value ? 18 : 0), {
      fill: hubFill,
      stroke: "#444",
      strokeWidth: 1,
    }));
    hub.el.style.cursor = "pointer";
    hub.el.addEventListener("dblclick", (e: MouseEvent) => {
      e.stopPropagation();
      if (!this._drillIdCell.value) return;
      const biNode = nodeById.get(this._drillIdCell.value);
      const parent = biNode ? parentOf(biNode) : null;
      const targetId = (parent && (nodeDepth.get(parent) ?? 0) > 0)
        ? (parent.value.id ?? null)
        : null;
      // Drill directly — don't wait for a round-trip.
      this.drillNodeId = targetId;
      const drillKey = (this as any).drillKey ?? "default";
      const br = (this as ElementWithBridge).brSync;
      br?.emitDrill?.(drillKey, targetId);
    });

    if (!this.hasAttribute('no-source')) s(label(view.bottom.up(10), derive(() => {
      const f = state.focused.value;
      return `total: ${root.value.total.value.toFixed(0)} · focused: ${f?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab`;
    }), { size: 10, align: Anchor.Center, fill: "#9aa0a8" }));

    if (this.showBreadcrumb !== false && this.chromeLayer) {
      mountDrillBreadcrumb({
        drillIdCell: this._drillIdCell,
        root,
        chromeLayer: this.chromeLayer,
        onDrill: (id) => {
          this.drillNodeId = id;
          const drillKey = (this as any).drillKey ?? "default";
          (this as ElementWithBridge).brSync?.emitDrill?.(drillKey, id);
        },
      });
    }
  }
}
