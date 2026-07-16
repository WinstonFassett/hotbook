// icicle-chart.ts — the icicle chart as a first-class consumer.
//
// Subscribes to a DataView, creates an Editor, renders a D3 partition,
// and attaches render/transition effects to Editor events.
//
// Uses bireactive cell/derive/effect for fine-grained reactivity.
// No Diagram, no BiNode, no attachChartGestures, no tile-binder.

import { cell, derive, effect } from "bireactive";
import { partition, hierarchy } from "d3-hierarchy";
import type { ChartConfig, DataNode, DraftEvent, LayoutRect, RenderNode } from "./types";
import { Kernel, findNode, findParent } from "./kernel";
import { DataView, type DataViewEvent } from "./data-view";

const W = 720;
const H = 480;
const DRILL_MS = 600;
const SETTLE_MS = 300;

/** Compute partition layout for the window. Returns map of node id -> rect. */
function computeLayout(
  win: RenderNode[],
  config: ChartConfig,
  width: number,
  height: number,
): Map<string, LayoutRect> {
  if (win.length === 0) return new Map();

  // Build a d3 hierarchy from the window nodes.
  // The window is a flat list; reconstruct the tree.
  const byId = new Map(win.map((n) => [n.id, n]));
  const roots = win.filter((n) => !n.parentId || !byId.has(n.parentId));
  if (roots.length === 0) return new Map();

  // d3 hierarchy needs a single root. If multiple roots, wrap them.
  let rootData: any;
  if (roots.length === 1) {
    rootData = toD3Node(roots[0]!, byId);
  } else {
    rootData = { id: "__virtual__", value: 0, children: roots.map((r) => toD3Node(r, byId)) };
  }

  // d3.hierarchy.sum sets node.value = accessor(node) + sum(children.value).
  // Our RenderNodes already carry recomputed sums on parents (Kernel does the
  // same roll-up), so summing d.value on every node would double-count parents
  // and shrink grandchildren to ~50%. Only leaves carry the raw value, so only
  // leaves should contribute; d3 re-rolls the parents to match.
  const h = hierarchy<any>(rootData)
    .sum((d) => (d.children && d.children.length > 0 ? 0 : (d.value ?? 0)))
    .sort((a, b) => (config.sort === "value" ? (b.value ?? 0) - (a.value ?? 0) : 0));

  const isHoriz = config.orientation === "horizontal";
  const size: [number, number] = isHoriz ? [height, width] : [width, height];
  partition<any>().size(size)(h);

  const map = new Map<string, LayoutRect>();
  h.each((d: any) => {
    if (d.data.id === "__virtual__") return;
    const raw = d as any;
    if (isHoriz) {
      // partition x = sibling axis, y = depth axis
      // horizontal: depth along canvas x, siblings along canvas y
      map.set(d.data.id, {
        x: raw.y0,
        y: raw.x0,
        width: raw.y1 - raw.y0,
        height: raw.x1 - raw.x0,
      });
    } else {
      map.set(d.data.id, {
        x: raw.x0,
        y: raw.y0,
        width: raw.x1 - raw.x0,
        height: raw.y1 - raw.y0,
      });
    }
  });
  return map;
}

function toD3Node(node: RenderNode, byId: Map<string, RenderNode>): any {
  const children = node.children.map((c) => {
    const found = byId.get(c.id);
    return found ? toD3Node(found, byId) : toD3Node(c, byId);
  });
  return {
    id: node.id,
    value: node.value,
    label: node.label,
    color: node.color,
    children,
  };
}

export class IcicleChart extends HTMLElement {
  private _kernel: Kernel | null = null;
  private _config: ChartConfig | null = null;
  private _dataView: DataView | null = null;
  private _svg: SVGSVGElement | null = null;
  private _tileLayer: SVGGElement | null = null;
  private _handleLayer: SVGGElement | null = null;
  private _unsub: (() => void) | null = null;
  private _focused: string | null = null;
  private _drillId: string | null = null;

  // Layout state
  private _layout = cell<Map<string, LayoutRect>>(new Map());
  private _window = cell<RenderNode[]>([]);

  // Viewport (drill tween)
  private _vx0 = cell(0);
  private _vy0 = cell(0);
  private _vx1 = cell(W);
  private _vy1 = cell(H);

  static get observedAttributes(): string[] {
    return ["config"];
  }

  set kernel(k: Kernel) {
    this._kernel = k;
    this._connect();
  }

  set config(c: ChartConfig) {
    this._config = c;
    this._connect();
    // Re-render tiles to attach/detach reorder handlers based on canReorder
    this._renderTiles();
  }

  private _connect(): void {
    if (!this._kernel || !this._config) return;
    this._dataView?.dispose();
    this._dataView = new DataView(this._kernel, this._config);

    this._unsub = this._dataView.subscribe((event) => this._onEvent(event));

    // Initial render
    this._render();
  }

  connectedCallback(): void {
    this._buildSvg();
    if (this._dataView) this._render();
  }

  disconnectedCallback(): void {
    this._unsub?.();
    this._dataView?.dispose();
    this._unsub = null;
    this._dataView = null;
  }

  private _buildSvg(): void {
    if (this._svg) return;
    this._svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this._svg.setAttribute("width", "100%");
    this._svg.setAttribute("height", "100%");
    this._svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    this._svg.style.display = "block";
    this._tileLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this._handleLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this._svg.appendChild(this._tileLayer);
    this._svg.appendChild(this._handleLayer);
    this.appendChild(this._svg);
    // Focusable so keyboard events land on the chart host.
    this.tabIndex = 0;
    this.style.outline = "none";

    // Edit surfaces are owned by the chart, not main.ts. Wheel on the SVG so
    // e.target is the SVGRect being scrolled over; keyboard on the host
    // (which receives focus on tile click).
    this._svg.addEventListener("wheel", this._onWheel, { passive: false });
    this.addEventListener("keydown", this._onKeyDown);
    this.addEventListener("keyup", this._onKeyUp);
  }

  private _onEvent(event: DataViewEvent): void {
    if (event.type === "updated" && event.window) {
      this._window.value = event.window;
      this._layout.value = computeLayout(event.window, this._config!, W, H);
      this._renderTiles();
    } else if (event.type === "draft" && event.draft) {
      // Render the draft preview — patch the edited node in place
      this._renderDraft(event.draft, event.isActive);
    } else if (event.type === "commit") {
      // The commit effect (in the chart that initiated the edit) writes to
      // the Kernel, which triggers an updated event. We just need to stop
      // showing the draft overlay and restore edge handles.
      this._clearDraftOverlay();
      this._renderEdgeHandles(this._window.value, this._layout.value, this._config?.orientation === "horizontal");
    } else if (event.type === "cancel") {
      // Revert to committed layout
      this._clearDraftOverlay();
      this._renderEdgeHandles(this._window.value, this._layout.value, this._config?.orientation === "horizontal");
    }
  }

  private _render(): void {
    if (!this._dataView) return;
    const win = this._dataView.getWindow();
    this._window.value = win;
    this._layout.value = computeLayout(win, this._config!, W, H);
    this._renderTiles();
  }

  private _renderTiles(): void {
    if (!this._tileLayer) return;
    const win = this._window.value;
    const layout = this._layout.value;
    const isHoriz = this._config?.orientation === "horizontal";

    // Keyed update: keep existing tiles, add new, remove gone
    const existing = new Map<string, SVGRectElement>();
    for (const el of Array.from(this._tileLayer.children) as SVGRectElement[]) {
      const id = el.getAttribute("data-id");
      if (id) existing.set(id, el);
    }

    const seen = new Set<string>();
    for (const node of win) {
      seen.add(node.id);
      const rect = layout.get(node.id);
      if (!rect) continue;

      let tile = existing.get(node.id);
      if (!tile) {
        tile = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        tile.setAttribute("data-id", node.id);
        tile.setAttribute("rx", "2");
        tile.style.transition = `all ${SETTLE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        tile.style.cursor = "pointer";
        this._tileLayer.appendChild(tile);
        // Enter animation
        tile.style.opacity = "0";
        requestAnimationFrame(() => {
          if (tile) tile.style.opacity = "1";
        });
        // Click to focus + drill. Focus the host so keyboard edits land here.
        tile.addEventListener("click", () => {
          this._focused = node.id;
          this.focus();
          this._updateFocus();
        });

        // Drag-to-reorder when canReorder is enabled and sort === 'index'
        this._attachReorderDrag(tile, node);
        tile.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          if (node.isLeaf) return;
          if (this._drillId === node.id) {
            // Drill out
            const parent = findNode(this._kernel!.getDataset(this._config!.datasetId)!.root, node.id);
            const pp = parent ? findParent(this._kernel!.getDataset(this._config!.datasetId)!.root, parent.id) : null;
            this._drillId = pp?.id ?? null;
          } else {
            this._drillId = node.id;
          }
          this._dataView!.setDrill(this._drillId);
        });
      }

      // Update position
      tile.setAttribute("x", String(rect.x));
      tile.setAttribute("y", String(rect.y));
      tile.setAttribute("width", String(rect.width));
      tile.setAttribute("height", String(rect.height));
      tile.setAttribute("fill", node.color);
      tile.setAttribute("stroke", this._focused === node.id ? "#fff" : "#0b0d12");
      tile.setAttribute("stroke-width", this._focused === node.id ? "2" : "1");
    }

    // Remove gone tiles (exit animation)
    for (const [id, el] of existing) {
      if (!seen.has(id)) {
        el.style.opacity = "0";
        setTimeout(() => el.remove(), SETTLE_MS);
      }
    }

    this._renderEdgeHandles(win, layout, isHoriz);
  }

  /** Render draggable edge handles on shared boundaries between adjacent
   *  siblings within a parent. Drag reapportions the two siblings (sum
   *  preserved). Lives in _handleLayer so it isn't swept by the tile diff. */
  private _renderEdgeHandles(
    win: RenderNode[],
    layout: Map<string, LayoutRect>,
    isHoriz: boolean,
  ): void {
    if (!this._handleLayer) return;
    // Clear existing edge handles and their visible lines (keep draft overlays).
    for (const el of Array.from(this._handleLayer.children) as SVGRectElement[]) {
      if (el.getAttribute("data-edge") || el.getAttribute("data-edge-line")) el.remove();
    }

    // Disable edge handles while a draft is active (prevents starting a new
    // reapportion mid-gesture).
    const drafting = this._dataView?.editor.state === "Drafting";

    // Group children by parent.
    const byParent = new Map<string, RenderNode[]>();
    for (const n of win) {
      if (n.parentId === null) continue;
      const arr = byParent.get(n.parentId);
      if (arr) arr.push(n);
      else byParent.set(n.parentId, [n]);
    }

    for (const [, siblings] of byParent) {
      // Sort siblings by their position along the sibling axis (matches layout order).
      const sorted = siblings.slice().sort((a, b) => {
        const ra = layout.get(a.id), rb = layout.get(b.id);
        if (!ra || !rb) return 0;
        return isHoriz ? ra.y - rb.y : ra.x - rb.x;
      });
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i]!, b = sorted[i + 1]!;
        const ra = layout.get(a.id), rb = layout.get(b.id);
        if (!ra || !rb) continue;

        const edgeKey = `${a.id}|${b.id}`;

        // Edge sits on the shared boundary, spanning the parent's depth-axis extent.
        let ex: number, ey: number, ew: number, eh: number;
        if (isHoriz) {
          // siblings stacked along y; boundary is horizontal line at ra.y + ra.h
          ex = Math.min(ra.x, rb.x);
          ey = ra.y + ra.height; // == rb.y
          ew = Math.max(ra.x + ra.width, rb.x + rb.width) - ex;
          eh = 0;
        } else {
          // siblings along x; boundary is vertical line at ra.x + ra.w
          ex = ra.x + ra.width; // == rb.x
          ey = Math.min(ra.y, rb.y);
          ew = 0;
          eh = Math.max(ra.y + ra.height, rb.y + rb.height) - ey;
        }

        // Hit area (wider than the visible line for grabbability).
        const HIT = 8;
        const handle = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        handle.setAttribute("data-edge", edgeKey);
        handle.setAttribute("data-edge-a", a.id);
        handle.setAttribute("data-edge-b", b.id);
        handle.setAttribute("x", String(ex - (isHoriz ? 0 : HIT / 2)));
        handle.setAttribute("y", String(ey - (isHoriz ? HIT / 2 : 0)));
        handle.setAttribute("width", String(isHoriz ? ew : HIT));
        handle.setAttribute("height", String(isHoriz ? HIT : eh));
        handle.setAttribute("fill", "transparent");
        handle.style.cursor = drafting ? "default" : (isHoriz ? "ns-resize" : "ew-resize");
        handle.style.touchAction = "none";
        if (drafting) handle.style.pointerEvents = "none";

        // Visible line (thin, appears on hover).
        const line = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        line.setAttribute("data-edge-line", edgeKey);
        line.setAttribute("x", String(ex - (isHoriz ? 0 : 1)));
        line.setAttribute("y", String(ey - (isHoriz ? 1 : 0)));
        line.setAttribute("width", String(isHoriz ? ew : 2));
        line.setAttribute("height", String(isHoriz ? 2 : eh));
        line.setAttribute("fill", "#4a9eff");
        line.setAttribute("fill-opacity", "0");
        line.style.transition = "fill-opacity 120ms";
        handle.addEventListener("pointerenter", () => (line.setAttribute("fill-opacity", "0.7")));
        handle.addEventListener("pointerleave", () => (line.setAttribute("fill-opacity", "0")));

        this._handleLayer.appendChild(line);
        this._handleLayer.appendChild(handle);

        this._attachEdgeDrag(handle, a, b, layout, isHoriz);
      }
    }
  }

  /** Wire a reapportion drag on an edge handle between siblings a and b. */
  private _attachEdgeDrag(
    handle: SVGRectElement,
    a: RenderNode,
    b: RenderNode,
    layout: Map<string, LayoutRect>,
    isHoriz: boolean,
  ): void {
    const parent = this._window.value.find((n) => n.id === a.parentId);
    if (!parent) return;

    let startPtr = 0;       // pointer pos along sibling axis at gesture start
    let startAVal = 0;
    let startBVal = 0;
    let pairSum = 0;
    let pxPerValue = 0;     // px per unit value along sibling axis
    let dragging = false;
    // Sibling-axis extents of the pair (frozen at gesture start — the parent
    // bounds don't move, only the boundary between a and b).
    let pairStart = 0;
    let pairSpan = 0;

    const onDown = (e: PointerEvent) => {
      if (!this._dataView) return;
      e.preventDefault();
      e.stopPropagation();
      const ra = layout.get(a.id)!, rb = layout.get(b.id)!;
      startAVal = a.value;
      startBVal = b.value;
      pairSum = startAVal + startBVal;
      // The pair occupies a contiguous span along the sibling axis equal to
      // (a's span + b's span). pxPerValue = that span / pairSum.
      pairSpan = isHoriz ? (ra.height + rb.height) : (ra.width + rb.width);
      pairStart = isHoriz ? ra.y : ra.x;
      pxPerValue = pairSum > 0 ? pairSpan / pairSum : 0;
      startPtr = isHoriz ? e.clientY : e.clientX;
      dragging = true;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging || !this._dataView) return;
      const ptr = isHoriz ? e.clientY : e.clientX;
      const dpx = ptr - startPtr;
      // Delta value from the drag. Dragging toward b (increasing axis) grows a.
      const dVal = pxPerValue > 0 ? dpx / pxPerValue : 0;
      let newA = Math.max(0, Math.min(pairSum, startAVal + dVal));
      let newB = pairSum - newA;
      const ev: DraftEvent = {
        nodeId: a.id,
        value: newA,
        secondaryNodeId: b.id,
        secondaryValue: newB,
        source: "divider-handle",
        intent: "edit",
      };
      if (this._dataView.editor.state === "Idle") {
        this._dataView.draft(ev);
      } else {
        this._dataView.updateDraft(ev);
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (!this._dataView) return;
      if (this._dataView.editor.state !== "Drafting") return; // cancelled via Esc
      const draft = this._dataView.editor.currentDraft;
      if (draft && draft.intent === "edit" && draft.secondaryNodeId) {
        this._kernel!.writeValues(this._config!.datasetId, [
          { nodeId: draft.nodeId, value: draft.value },
          { nodeId: draft.secondaryNodeId, value: draft.secondaryValue! },
        ]);
      }
      this._dataView.commit();
    };

    handle.addEventListener("pointerdown", onDown);
  }

  private _updateFocus(): void {
    // Re-render tiles to update stroke
    this._renderTiles();
  }

  private _draftOverlays: SVGRectElement[] = [];

  private _renderDraft(draft: DraftEvent, isActive: boolean): void {
    if (draft.intent === "edit") {
      this._clearDraftOverlay();
      const layout = this._layout.value;
      const isHoriz = this._config?.orientation === "horizontal";

      // Primary node overlay: scale its span by value ratio.
      this._addDraftOverlay(draft.nodeId, draft.value, layout, isHoriz, isActive);

      // Two-sibling reapportion: the secondary node absorbs the complement.
      if (draft.secondaryNodeId !== undefined && draft.secondaryValue !== undefined) {
        this._addDraftOverlay(draft.secondaryNodeId, draft.secondaryValue, layout, isHoriz, isActive);
      }
    } else if (draft.intent === "reorder" && draft.reorderOrder && draft.parentId) {
      // Reorder: render provisional layout with new sibling order
      this._renderReorderDraft(draft, isActive);
    }
  }

  private _renderReorderDraft(draft: DraftEvent, isActive: boolean): void {
    if (!draft.reorderOrder || !draft.parentId) return;

    const win = this._window.value;
    const layout = this._layout.value;
    const isHoriz = this._config?.orientation === "horizontal";

    // Find the parent and its children
    const parent = win.find(n => n.id === draft.parentId);
    if (!parent) return;

    const siblings = parent.children.filter(c => draft.reorderOrder!.includes(c.id));
    const reordered = draft.reorderOrder.map(id => siblings.find(s => s.id === id)).filter(Boolean) as RenderNode[];

    // Compute provisional layout for reordered siblings
    // For now, just highlight the reordered nodes (full layout recomputation is complex)
    // In a full implementation, we'd recompute the partition with the new order
    this._clearDraftOverlay();

    for (const node of reordered) {
      const rect = layout.get(node.id);
      if (!rect) continue;

      const overlay = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      overlay.setAttribute("data-draft", "true");
      overlay.setAttribute("data-draft-id", node.id);
      overlay.setAttribute("x", String(rect.x));
      overlay.setAttribute("y", String(rect.y));
      overlay.setAttribute("width", String(rect.width));
      overlay.setAttribute("height", String(rect.height));
      overlay.setAttribute("fill", node.color);
      overlay.setAttribute("rx", "2");
      overlay.setAttribute("stroke", isActive ? "#4a9eff" : "#888");
      overlay.setAttribute("stroke-width", "2");
      overlay.setAttribute("fill-opacity", "0.5");
      this._handleLayer?.appendChild(overlay);
      this._draftOverlays.push(overlay);
    }
  }

  private _addDraftOverlay(
    nodeId: string,
    newValue: number,
    layout: Map<string, LayoutRect>,
    isHoriz: boolean,
    isActive: boolean,
  ): void {
    const rect = layout.get(nodeId);
    if (!rect) return;
    const node = this._window.value.find((n) => n.id === nodeId);
    if (!node) return;

    const ratio = node.value > 0 ? newValue / node.value : 1;
    const overlay = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    overlay.setAttribute("data-draft", "true");
    overlay.setAttribute("data-draft-id", nodeId);
    overlay.setAttribute("x", String(rect.x));
    overlay.setAttribute("y", String(rect.y));
    const newW = isHoriz ? rect.width : rect.width * ratio;
    const newH = isHoriz ? rect.height * ratio : rect.height;
    overlay.setAttribute("width", String(newW));
    overlay.setAttribute("height", String(newH));
    overlay.setAttribute("fill", node.color);
    overlay.setAttribute("rx", "2");
    overlay.setAttribute("stroke", isActive ? "#4a9eff" : "#888");
    overlay.setAttribute("stroke-width", "2");
    overlay.setAttribute("fill-opacity", "0.8");
    this._handleLayer?.appendChild(overlay);
    this._draftOverlays.push(overlay);
  }

  private _clearDraftOverlay(): void {
    for (const o of this._draftOverlays) o.remove();
    this._draftOverlays = [];
  }

  // ─── Gesture surfaces ───────────────────────────────────────────────────

  /** Drag-to-reorder: when canReorder + sort === 'index', drag tile to reorder among siblings. */
  private _attachReorderDrag(tile: SVGRectElement, node: RenderNode): void {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let originalOrder: string[] = [];
    let parentId: string | null = null;

    const onDown = (e: PointerEvent) => {
      if (!this._dataView || !this._config) return;
      if (!this._config.canReorder || this._config.sort !== 'index') return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      // Find parent and original sibling order
      const ds = this._kernel?.getDataset(this._config.datasetId);
      if (!ds) return;
      const parent = findParent(ds.root, node.id);
      if (!parent) return;
      parentId = parent.id;
      originalOrder = parent.children.map(c => c.id);

      // Start reorder draft
      if (this._dataView.editor.state === "Idle") {
        this._dataView.draft({
          nodeId: node.id,
          value: 0, // value doesn't matter for reorder
          source: "reorder",
          intent: "reorder",
          parentId,
          reorderOrder: originalOrder,
        });
      }

      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (!isDragging || !this._dataView || !parentId) return;

      const isHoriz = this._config?.orientation === "horizontal";
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const delta = isHoriz ? dy : dx; // sibling axis

      // Compute provisional order based on pointer position
      const ds = this._kernel?.getDataset(this._config.datasetId);
      if (!ds) return;
      const parent = findParent(ds.root, parentId);
      if (!parent) return;

      const layout = this._layout.value;
      const nodeRect = layout.get(node.id);
      if (!nodeRect) return;

      // Find where the dragged node should be inserted based on pointer position
      const siblings = parent.children.filter(c => c.id !== node.id);
      const siblingRects = siblings.map(s => ({ id: s.id, rect: layout.get(s.id) })).filter(s => s.rect);

      let newIndex = 0;
      if (isHoriz) {
        // Vertical sibling axis: compare y positions
        const pointerY = nodeRect.y + delta;
        newIndex = siblingRects.filter(s => s.rect!.y < pointerY).length;
      } else {
        // Horizontal sibling axis: compare x positions
        const pointerX = nodeRect.x + delta;
        newIndex = siblingRects.filter(s => s.rect!.x < pointerX).length;
      }

      // Build provisional order
      const provisionalOrder = [...originalOrder];
      const currentIndex = provisionalOrder.indexOf(node.id);
      provisionalOrder.splice(currentIndex, 1);
      provisionalOrder.splice(newIndex, 0, node.id);

      // Update draft with new order
      this._dataView.updateDraft({
        nodeId: node.id,
        value: 0,
        source: "reorder",
        intent: "reorder",
        parentId,
        reorderOrder: provisionalOrder,
      });
    };

    const onUp = () => {
      if (!isDragging || !this._dataView) return;
      isDragging = false;

      console.log('[reorder] commit');
      // Commit reorder
      const draft = this._dataView.editor.currentDraft;
      console.log('[reorder] draft:', draft);
      if (draft && draft.intent === "reorder" && draft.parentId && draft.reorderOrder) {
        console.log('[reorder] calling writeReorder with', draft.parentId, draft.reorderOrder);
        this._kernel!.writeReorder(this._config!.datasetId, draft.parentId, draft.reorderOrder);
      }
      this._dataView.commit();
    };

    tile.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  /** Wheel edit: cmd/ctrl+wheel over a tile = additive value change. */
  private _onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey || !this._dataView) return;
    e.preventDefault();

    const target = e.target as SVGRectElement;
    const nodeId = target.getAttribute("data-id");
    if (!nodeId) return;

    const ds = this._kernel?.getDataset(this._config!.datasetId);
    if (!ds) return;
    const node = findNode(ds.root, nodeId);
    if (!node) return;

    const step = Math.max(1, Math.round(Math.abs(node.value) * 0.1));
    const newValue = Math.max(0, node.value + (e.deltaY < 0 ? step : -step));

    // Start or update draft
    if (this._dataView.editor.state === "Idle") {
      this._dataView.draft({ nodeId, value: newValue, source: "wheel", intent: "edit" });
    } else {
      this._dataView.updateDraft({ nodeId, value: newValue, source: "wheel", intent: "edit" });
    }
  };

  /** Keyboard edit: arrows on focused tile = additive. Alt = proportional-neighbor. */
  private _onKeyDown = (e: KeyboardEvent): void => {
    if (!this._dataView || !this._focused) return;
    if (e.key === "Escape") {
      this._dataView.cancel();
      e.preventDefault();
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowDown" && e.key !== "ArrowLeft") return;

    const ds = this._kernel?.getDataset(this._config!.datasetId);
    if (!ds) return;
    const node = findNode(ds.root, this._focused);
    if (!node) return;

    const step = Math.max(1, Math.round(Math.abs(node.value) * 0.1));
    const delta = (e.key === "ArrowUp" || e.key === "ArrowRight") ? step : -step;

    // Alt = proportional-neighbor (neighbor absorbs delta, parent total preserved)
    let newValue = Math.max(0, node.value + delta);
    let secondaryNodeId: string | undefined;
    let secondaryValue: number | undefined;

    if (e.altKey) {
      const parent = findParent(ds.root, this._focused);
      if (parent) {
        const siblings = parent.children.filter((c) => c.id !== this._focused);
        const neighbor = siblings[0];
        if (neighbor) {
          const take = delta > 0 ? Math.min(delta, neighbor.value) : Math.max(delta, -node.value);
          newValue = Math.max(0, node.value + take);
          secondaryNodeId = neighbor.id;
          secondaryValue = Math.max(0, neighbor.value - take);
        }
      }
    }

    if (this._dataView.editor.state === "Idle") {
      this._dataView.draft({
        nodeId: this._focused,
        value: newValue,
        source: "keyboard",
        intent: "edit",
        secondaryNodeId,
        secondaryValue,
      });
    } else {
      this._dataView.updateDraft({
        nodeId: this._focused,
        value: newValue,
        source: "keyboard",
        intent: "edit",
        secondaryNodeId,
        secondaryValue,
      });
    }
    e.preventDefault();
  };

  private _onKeyUp = (e: KeyboardEvent): void => {
    if (!this._dataView) return;
    if (this._dataView.editor.state !== "Drafting") return;
    // Only commit when the arrow key that drove the draft is released.
    // Releasing Esc already cancelled in _onKeyDown (state is Idle by now);
    // releasing any other unrelated key must not prematurely commit.
    if (
      e.key !== "ArrowUp" && e.key !== "ArrowRight" &&
      e.key !== "ArrowDown" && e.key !== "ArrowLeft"
    ) return;
    const draft = this._dataView.editor.currentDraft;
    if (draft && draft.intent === "edit") {
      if (draft.secondaryNodeId !== undefined && draft.secondaryValue !== undefined) {
        this._kernel!.writeValues(this._config!.datasetId, [
          { nodeId: draft.nodeId, value: draft.value },
          { nodeId: draft.secondaryNodeId, value: draft.secondaryValue },
        ]);
      } else {
        this._kernel!.writeValue(this._config!.datasetId, draft.nodeId, draft.value);
      }
    }
    this._dataView.commit();
  };

  attributeChangedCallback(name: string, _old: string, value: string): void {
    if (name === "config") {
      try {
        this._config = JSON.parse(value);
        this._connect();
      } catch { /* ignore */ }
    }
  }
}

customElements.define("v-icicle", IcicleChart);
