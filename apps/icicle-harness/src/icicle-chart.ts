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

  const h = hierarchy<any>(rootData)
    .sum((d) => d.value ?? 0)
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
      // showing the draft overlay.
      this._clearDraftOverlay();
    } else if (event.type === "cancel") {
      // Revert to committed layout
      this._clearDraftOverlay();
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
  }

  private _updateFocus(): void {
    // Re-render tiles to update stroke
    this._renderTiles();
  }

  private _draftOverlay: SVGRectElement | null = null;

  private _renderDraft(draft: DraftEvent, isActive: boolean): void {
    if (draft.intent === "edit") {
      // Patch the edited node's span in place
      const layout = this._layout.value;
      const rect = layout.get(draft.nodeId);
      if (!rect) return;

      // For a simple preview: scale the node's span proportional to the
      // new value vs the old value. Siblings frozen.
      const node = this._window.value.find((n) => n.id === draft.nodeId);
      if (!node) return;

      const ratio = node.value > 0 ? draft.value / node.value : 1;
      if (this._draftOverlay) {
        this._draftOverlay.remove();
      }
      this._draftOverlay = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      this._draftOverlay.setAttribute("data-draft", "true");
      this._draftOverlay.setAttribute("x", String(rect.x));
      this._draftOverlay.setAttribute("y", String(rect.y));
      const newW = this._config?.orientation === "horizontal" ? rect.width : rect.width * ratio;
      const newH = this._config?.orientation === "horizontal" ? rect.height * ratio : rect.height;
      this._draftOverlay.setAttribute("width", String(newW));
      this._draftOverlay.setAttribute("height", String(newH));
      this._draftOverlay.setAttribute("fill", node.color);
      this._draftOverlay.setAttribute("rx", "2");
      this._draftOverlay.setAttribute("stroke", isActive ? "#4a9eff" : "#888");
      this._draftOverlay.setAttribute("stroke-width", "2");
      this._draftOverlay.setAttribute("fill-opacity", "0.8");
      this._handleLayer?.appendChild(this._draftOverlay);
    }
  }

  private _clearDraftOverlay(): void {
    if (this._draftOverlay) {
      this._draftOverlay.remove();
      this._draftOverlay = null;
    }
  }

  // ─── Gesture surfaces ───────────────────────────────────────────────────

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
    if (e.altKey) {
      const parent = findParent(ds.root, this._focused);
      if (parent) {
        const siblings = parent.children.filter((c) => c.id !== this._focused);
        const neighbor = siblings[0];
        if (neighbor) {
          const take = delta > 0 ? Math.min(delta, neighbor.value) : Math.max(delta, -node.value);
          newValue = Math.max(0, node.value + take);
          // Write neighbor too on commit — for now, just preview the target
        }
      }
    }

    if (this._dataView.editor.state === "Idle") {
      this._dataView.draft({ nodeId: this._focused, value: newValue, source: "keyboard", intent: "edit" });
    } else {
      this._dataView.updateDraft({ nodeId: this._focused, value: newValue, source: "keyboard", intent: "edit" });
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
      this._kernel!.writeValue(this._config!.datasetId, draft.nodeId, draft.value);
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
