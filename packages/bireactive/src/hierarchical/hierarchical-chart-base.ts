// hierarchical-chart-base.ts — shared base for Hierarchical charts (icicle, sunburst).
// Owns the geometry-neutral chart machinery: reactive cells (config, tree, focus,
// hover, drill, frozenOrder, reorderTick), Gesture/DataView lifecycle, config setter
// + query-key rebuild logic, drill channel, value accessors (valueOf/writeValue/
// siblings/restore), breadcrumb, dblclick/Esc drill wiring, and the _build skeleton.
//
// The chart subclass provides two hooks:
//   • _setupRendering() — chart-specific derivers (allNodes, layout) + forEach
//     layers (tiles/arcs, edges/handles) with chart-specific makeTile/makeArc/
//     makeHandle/makeAngularHandle + drag attachment.
//   • _composeBehaviors() — chart-specific behavior composition via setup()
//     (drag/reorder behaviors + shared wheel/keyboard/transition/preview behaviors).
//
// Design: base class (not factory) because the shared lifecycle is ~300 lines of
// boilerplate that's identical across hierarchical charts. The hooks are a small
// interface, not a deep hierarchy. Per CLAUDE.md: prefer decoupling through
// interfaces; the base owns cells + lifecycle, the chart owns geometry composition.

import { cell, derive, effect, group, Vec, type Cell } from "bireactive";
import type { ChartConfig } from "./types";
import { Kernel, configKey } from "./kernel";
import { DataView } from "./data-view";
import { Gesture, setup, type Behavior } from "./gesture";
import { findNode, snapshotValues, restoreValues, type ChartNode, type Edge } from "./tree";
import { bindChart, rebuildTree } from "./chart-binding";
import { useHostSize } from "./host-size";
import type { ConservationMode } from "./behaviors/keyboard-edit";
import type { TileBodyDragOptions } from "./behaviors/tile-body-drag";
import { makeBridge, type BrSyncBridge, type ElementWithBridge } from "../lib/hud-bridge";
import { transitionOnUpdated } from "./behaviors/transition-on-updated";
import { motion } from "../lib/runtime-config";
import { previewFullRender, captureOrderFromWindow } from "./behaviors/preview-full-render";
import { wheelEdit } from "./behaviors/wheel-edit";
import { keyboardEdit } from "./behaviors/keyboard-edit";

const SVG_NS = "http://www.w3.org/2000/svg";
const FALLBACK_W = 720;
const FALLBACK_H = 360;

// Chart chrome CSS (breadcrumb, reorder cursors) — injected once per document
// plus once per host tag, so the charts are self-contained wherever they're
// mounted (demos, hotbook, apitable) instead of relying on page CSS.
const CHROME_CSS = `
.drill-breadcrumb {
  display: flex; align-items: center; gap: 2px;
  padding: 4px 8px; font-size: 11px; pointer-events: auto;
}
.drill-segment { display: inline-flex; align-items: center; }
.drill-crumb {
  background: none; border: none; color: var(--muted, #999);
  cursor: pointer; font: inherit; padding: 2px 6px; border-radius: 3px;
  transition: color 100ms, background 100ms;
}
.drill-crumb:hover { color: var(--ink, #ddd); background: var(--panel, rgba(128,128,128,0.15)); }
.drill-crumb--current { color: var(--ink, #ddd); font-weight: 600; cursor: default; }
.drill-crumb--current:hover { background: none; }
.drill-sep { color: var(--border, #555); margin: 0 1px; }
[data-reordering] { filter: drop-shadow(0 6px 12px rgba(0,0,0,0.3)); }
`;

const injectedTags = new Set<string>();
function ensureChromeCss(tag: string): void {
  if (typeof document === "undefined") return;
  if (!document.getElementById("vf-hierarchical-chrome")) {
    const style = document.createElement("style");
    style.id = "vf-hierarchical-chrome";
    style.textContent = CHROME_CSS;
    document.head.appendChild(style);
  }
  if (!injectedTags.has(tag)) {
    injectedTags.add(tag);
    const style = document.createElement("style");
    style.setAttribute("data-vf-chrome", tag);
    style.textContent = `
${tag} { display: block; width: 100%; height: 100%; }
${tag}.reorder-active rect, ${tag}.reorder-active path { cursor: grab !important; }
${tag}.reorder-active [data-reordering] rect,
${tag}.reorder-active [data-reordering] path { cursor: grabbing !important; }
${tag}.reorder-active g[data-edge] { display: none; }
${tag}.gesture-active [data-id] { cursor: grabbing !important; }
`;
    document.head.appendChild(style);
  }
}

export abstract class HierarchicalChartBase extends HTMLElement {
  // --- Shared reactive cells ---
  protected _kernelCell = cell<Kernel | null>(null);
  protected _configCell = cell<ChartConfig | null>(null);
  protected _queryKeyCell = cell<string>("");
  protected _treeRoot = cell<ChartNode | null>(null);
  protected _frozenOrder = cell<Map<string, string[]> | null>(null);
  /** Reactive map of node id → live value. Labels read from this so they
   *  update when values change (drag resize, etc.) even though forEach
   *  reuses DOM by key and RenderNode.value is a stale snapshot. */
  protected _valueMap = derive(() => {
    const root = this._treeRoot.value;
    const map = new Map<string, number>();
    if (!root) return map;
    function walk(n: ChartNode) {
      map.set(n.id, n.value.value);
      for (const c of n.children) walk(c);
    }
    walk(root);
    return map;
  });
  protected _focusCell = cell<string | null>(null);
  protected _hoverCell = cell<string | null>(null);
  protected _drillId = cell<string | null>(null);
  /** Tick cell — incremented on each reorder move to force layout
   *  re-derivation (children array mutation isn't reactive on its own). */
  protected _reorderTick = cell(0);
  /** Color mode cell — read by makeTile/makeArc for reactive fill changes. */
  protected _colorModeCell = cell<"flat" | "depth" | "mono" | undefined>(undefined);

  // --- Rendered window + layout (set by subclass _setupRendering, read by
  //     base behavior composition for frozen-order capture). Typed as
  //     Cell<any> because Cell is invariant in its type parameter; subclasses
  //     redeclare with `protected declare` + a specific type annotation. ---
  protected _window?: Cell<any>;
  protected _layout?: Cell<any>;

  // --- Shared infrastructure ---
  protected _gesture: Gesture | null = null;
  protected _dataView: DataView | null = null;
  protected _svg?: SVGSVGElement;
  protected _chromeLayer?: HTMLDivElement;
  protected _breadcrumbBar?: HTMLElement;
  protected _rootShape?: any;
  protected _defs?: SVGDefsElement;
  /** Unique instance ID for clipPath/gradient IDs (avoids collisions
   *  when multiple chart instances are on the same page). */
  protected _instanceId = `c${Math.random().toString(36).slice(2, 8)}`;
  protected _hostSize?: ReturnType<typeof useHostSize>;
  /** Reactive center point (W/2, H/2) — shared by radial charts (sunburst)
   *  and the arc-body-reorder behavior. Lazily created in _build. */
  protected _center?: ReturnType<typeof Vec.derive<{ x: number; y: number }>>;

  protected _setupDisposers: (() => void)[] = [];
  protected _buildDisposers: (() => void)[] = [];
  protected _behaviorDispose: (() => void) | null = null;
  protected _unsubChart: (() => void) | null = null;
  protected _drillUnsub: (() => void) | null = null;

  // --- Shared GestureContext value-accessor fields ---
  get config() { return this._configCell.value!; }
  get conservationMode(): ConservationMode {
    return (this._configCell.value?.conservationMode as ConservationMode) ?? "additive";
  }
  altHeld() { return this._gesture?.store.altHeld ?? false; }
  get snapshot() { return this._gesture?.store.snapshot ?? null; }
  treeRoot() { return this._treeRoot.value; }
  get pairTotal() { return this._gesture?.store.pairTotal ?? 0; }
  setPairTotal(n: number) { if (this._gesture) this._gesture.store.pairTotal = n; }

  // --- Config + kernel wiring ---
  set kernel(k: Kernel) { this._kernelCell.value = k; }
  /** Drill channel key — components with the same datasetId + drillKey
   *  share drill state via the Kernel. Default: "default". */
  drillKey = "default";
  set config(c: ChartConfig) {
    const prev = this._configCell.value;
    const prevKey = prev ? configKey(prev) : "";
    const nextKey = configKey(c);
    // Compute effective drag behavior (auto-derives from sort when not set).
    const prevDrag = prev?.dragBehavior ?? (prev?.sort === "index" ? "reorder" : "resize");
    const nextDrag = c.dragBehavior ?? (c.sort === "index" ? "reorder" : "resize");
    const dragChanged = prevDrag !== nextDrag;
    this._configCell.value = { ...c };
    this._colorModeCell.value = c.colorMode;
    if (this._gesture) this._gesture.store.config.value = { ...c };
    // Query key change OR effective dragBehavior change → rebuild (behaviors
    // are composed in _build, so a dragBehavior switch needs a rebuild).
    if (prevKey !== nextKey || dragChanged) {
      this._queryKeyCell.value = nextKey + (dragChanged ? `:drag=${nextDrag}` : "");
    } else if (this._dataView) {
      this._dataView.config = { ...c };
      this._gesture?.editor.updated();
    }
  }
  get dataView() { return this._dataView; }
  get gesture() { return this._gesture; }
  /** Bump the reorder tick — forces layout re-derivation after a
   *  children-array mutation (reorder gestures). */
  bumpReorder() { this._reorderTick.value++; }

  // --- Focus + hover ---
  setFocus(id: string | null) { this._focusCell.value = id; }
  setHover(id: string | null) { this._hoverCell.value = id; }
  get focusedId() { return this._focusCell.value; }
  get hoveredId() { return this._hoverCell.value; }
  get focusCell() { return this._focusCell; }
  get hoverCell() { return this._hoverCell; }

  // --- Drill (shared) ---
  // D3-style drill: dblclick a node to drill in; dblclick the current
  // focus to drill out to its parent. Emits to the Kernel's drill channel
  // so subscribers (side table, etc.) can sync.
  protected _bridge: BrSyncBridge | null = null;
  /** External ids last pushed via the bridge — suppresses echo emissions. */
  private _extHover: string | null | undefined = undefined;
  private _extFocus: string | null | undefined = undefined;

  drill = (id: string | null) => {
    let nextId: string | null;
    if (id === null) {
      nextId = null;
    } else if (this._drillId.value === id) {
      // Drilling to the current focus → drill out to parent.
      const root = this._treeRoot.value;
      if (root) {
        const node = findNode(root, id);
        const parentId = node?.parent?.id ?? null;
        // Drilling out to the tree root = no drill (show full tree).
        nextId = parentId === root.id ? null : parentId;
      } else {
        nextId = null;
      }
    } else {
      nextId = id;
    }
    this._drillId.value = nextId;
    // Emit to the Kernel's drill channel for cross-component sync.
    const k = this._kernelCell.value;
    const cfg = this._configCell.value;
    if (k && cfg) k.setDrill(cfg.datasetId, this.drillKey, nextId);
    // Legacy hotbook HUD bridge.
    this._bridge?.emitDrill(this.drillKey, nextId);
  };

  // --- Value accessors (shared GestureContext fields) ---
  valueOf = (id: string) => {
    const root = this._treeRoot.value;
    if (!root) return 0;
    const node = findNode(root, id);
    return node ? node.value.value : 0;
  };
  writeValue = (id: string, value: number) => {
    const root = this._treeRoot.value;
    if (!root) return;
    const node = findNode(root, id);
    if (node) node.value.value = value;
  };
  siblings = (id: string) => {
    const root = this._treeRoot.value;
    if (!root) return [];
    const node = findNode(root, id);
    if (!node || !node.parent) return [];
    return node.parent.children.map((c) => c.id);
  };
  restore = () => {
    const root = this._treeRoot.value;
    if (root && this._gesture?.store.snapshot) restoreValues(root, this._gesture.store.snapshot);
  };

  // --- Lifecycle ---

  /** Whether the surface has been created (guards re-entrant connects). */
  protected _surfaceReady = false;

  /** Create the rendering surface. Default: an SVG canvas (charts). HTML
   *  surfaces (treetable) override this and leave _svg unset. */
  protected _createSurface(): void {
    this._svg = document.createElementNS(SVG_NS, "svg");
    this._svg.style.display = "block";
    this._svg.style.flex = "1 1 0";
    this._svg.style.width = "100%";
    this._svg.style.overflow = "hidden";
    this.appendChild(this._svg);

    this._rootShape = group();
    this._svg.appendChild(this._rootShape.el);

    const defs = document.createElementNS(SVG_NS, "defs");
    this._svg.appendChild(defs);
    this._defs = defs;

    this._hostSize = useHostSize(this, { width: FALLBACK_W, height: FALLBACK_H }, this._svg);
    const { w: Wc, h: Hc } = this._hostSize;
    this._center = Vec.derive(() => ({ x: Wc.value / 2, y: Hc.value / 2 }));
  }

  connectedCallback() {
    if (this._surfaceReady) return;
    this._surfaceReady = true;
    ensureChromeCss(this.tagName.toLowerCase());
    this.style.display = "flex";
    this.style.flexDirection = "column";
    this.style.width = "100%";
    this.style.height = "100%";
    this.style.outline = "none";
    this.style.userSelect = "none";
    this.tabIndex = -1;

    // Chrome layer: HTML bar above the SVG for breadcrumb etc.
    this._chromeLayer = document.createElement("div");
    this._chromeLayer.style.flex = "0 0 auto";
    this._chromeLayer.style.pointerEvents = "none";
    this.appendChild(this._chromeLayer);

    this._createSurface();

    // Chart-specific rendering (derivers + forEach layers).
    this._setupRendering();

    // D3-style drill via host-level dblclick.
    const onDblClick = () => {
      const id = this._hoverCell.value ?? this._focusCell.value;
      if (!id) return;
      const root = this._treeRoot.value;
      if (root) {
        const node = findNode(root, id);
        if (node && node.children.length === 0) return;
      }
      this.drill(id);
      this.focus({ preventScroll: true });
    };
    this.addEventListener("dblclick", onDblClick);
    this._setupDisposers.push(() => this.removeEventListener("dblclick", onDblClick));

    // Escape → drill out one level (only when idle).
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (this._gesture?.state === "Drafting") return;
      const drillId = this._drillId.value;
      if (!drillId) return;
      e.preventDefault();
      this.drill(drillId);
    };
    this.addEventListener("keydown", onKeydown);
    this._setupDisposers.push(() => this.removeEventListener("keydown", onKeydown));

    // Breadcrumb (shared).
    this._setupBreadcrumb();

    // Reserve breadcrumb bar space when enabled — the chrome layer gets a
    // min-height so the chart area doesn't jump when the breadcrumb bar
    // appears/disappears on drill. The bar itself stays mounted (empty, opacity
    // 0) when at root level; only the crumb segments fade in/out.
    const bcReserveDispose = effect(() => {
      const showBc = this._configCell.value?.showBreadcrumb === true;
      // Breadcrumb bar height: padding 4px*2 + font-size 11px + button padding
      // 2px*2 ≈ 24px. Reserve a touch more for the border.
      this._chromeLayer!.style.minHeight = showBc ? "26px" : "";
    });
    this._setupDisposers.push(bcReserveDispose);

    // Legacy hotbook HUD bridge (brSync): external hover/select/drill in,
    // own hover/focus changes out. External pushes are recorded so the
    // outgoing effects don't echo them back to the store.
    const bridge = makeBridge({
      setHover: (id) => { this._extHover = id; this.setHover(id); },
      setSelect: (id) => { this._extFocus = id; this.setFocus(id); },
      setDrill: (id) => { this.drill(id); },
    });
    this._bridge = bridge;
    (this as ElementWithBridge).brSync = bridge;
    this._setupDisposers.push(
      effect(() => {
        const id = this._hoverCell.value;
        if (id !== this._extHover) { this._extHover = undefined; bridge.emitHover(id); }
      }),
      effect(() => {
        const id = this._focusCell.value;
        if (id !== this._extFocus) { this._extFocus = undefined; bridge.emitSelect(id); }
      }),
      () => { (this as ElementWithBridge).brSync = undefined; this._bridge = null; },
    );

    // Data layer — rebuilds only when the query key changes.
    this._setupDisposers.push(
      effect(() => {
        const k = this._kernelCell.value;
        const _key = this._queryKeyCell.value;
        const c = this._configCell.value;
        if (k && c && _key) this._build(k, c);
      }),
    );
  }

  disconnectedCallback() {
    this._unsubChart?.();
    this._drillUnsub?.();
    this._behaviorDispose?.();
    this._buildDisposers.forEach((d) => d());
    this._setupDisposers.forEach((d) => d());
    this._rootShape?.dispose();
    this._gesture?.dispose();
    this._dataView?.dispose();
    (this as any)._roDispose?.();
    this._buildDisposers = [];
    this._setupDisposers = [];
  }

  // --- _build skeleton (shared) ---
  protected _build(kernel: Kernel, config: ChartConfig) {
    this._buildDisposers.forEach((d) => d());
    this._buildDisposers = [];
    this._unsubChart?.();
    this._drillUnsub?.();
    this._behaviorDispose?.();
    this._gesture?.dispose();
    this._dataView?.dispose();

    this._gesture = new Gesture(undefined, config);
    this._gesture.store.host = this;
    this._gesture.store.focus = this._focusCell;
    this._gesture.store.hover = this._hoverCell;
    this._gesture.store.tree = this._treeRoot;
    this._gesture.store.takeSnapshot = () => {
      const root = this._treeRoot.value;
      if (root && !this._gesture!.store.snapshot) {
        this._gesture!.store.snapshot = snapshotValues(root);
      }
    };

    this._dataView = new DataView(kernel, config, this._gesture.editor);
    this._unsubChart = bindChart({
      treeRoot: this._treeRoot,
      gesture: this._gesture,
      dataView: this._dataView,
      rebuild: () => {
        rebuildTree(this._dataView!, this._treeRoot);
      },
      frozenOrder: this._frozenOrder,
    });

    rebuildTree(this._dataView, this._treeRoot);

    // Legacy contract: `gestureActive` flag + `gesturecommit` event, used by
    // demos (WIN-269 sort reconciliation) and tile-binder to reconcile
    // frozen display order after a gesture ends.
    this._buildDisposers.push(
      this._gesture.editor.subscribe((t) => {
        if (t.type === "draft") {
          (this as any).gestureActive = true;
        } else if (t.type === "commit" || t.type === "cancel") {
          (this as any).gestureActive = false;
          this.dispatchEvent(new CustomEvent("gesturecommit", {
            detail: {
              canceled: t.type === "cancel",
              reorder: t.draft?.intent === "reorder",
            },
          }));
        }
      }),
    );

    // Subscribe to the Kernel's drill channel for cross-view sync.
    // When another component drills on the same dataset+drillKey, update
    // this chart's drillId. The viewport/layout derivers react automatically.
    this._drillUnsub = kernel.subscribeDrill((datasetId, drillKey, nodeId) => {
      if (datasetId !== config.datasetId || drillKey !== this.drillKey) return;
      if (this._drillId.value !== nodeId) {
        this._drillId.value = nodeId;
      }
    });

    // Chart-specific behavior composition.
    this._composeBehaviors();
  }

  // --- Breadcrumb (shared) ---
  private _setupBreadcrumb() {
    // Breadcrumb appear/disappear = mark enter/exit. Uses motion.enterMs.
    const fadeOutEl = (el: HTMLElement) => {
      const exitMs = motion.exitMs.value;
      el.style.opacity = "0";
      el.addEventListener("transitionend", function onEnd(e: TransitionEvent) {
        if (e.propertyName !== "opacity") return;
        el.removeEventListener("transitionend", onEnd);
        el.remove();
      });
      setTimeout(() => el.remove(), exitMs + 60);
    };

    const buildSegment = (node: ChartNode, isLast: boolean): HTMLElement => {
      const seg = document.createElement("span");
      seg.className = "drill-segment";
      seg.dataset.crumbId = node.id;
      seg.style.transition = `opacity ${motion.enterMs.value}ms ease`;
      seg.style.opacity = "0";

      const sep = document.createElement("span");
      sep.className = "drill-sep";
      sep.textContent = "›";
      seg.appendChild(sep);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = isLast ? "drill-crumb drill-crumb--current" : "drill-crumb";
      btn.textContent = node.label;
      if (!isLast) {
        btn.addEventListener("click", () => this.drill(node.id));
      }
      seg.appendChild(btn);
      return seg;
    };

    const buildRootSegment = (node: ChartNode): HTMLElement => {
      const seg = document.createElement("span");
      seg.className = "drill-segment";
      seg.dataset.crumbId = node.id;
      seg.style.transition = `opacity ${motion.enterMs.value}ms ease`;
      seg.style.opacity = "0";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "drill-crumb";
      btn.textContent = node.label;
      btn.addEventListener("click", () => this.drill(null));
      seg.appendChild(btn);
      return seg;
    };

    const crumbEls = new Map<string, HTMLElement>();

    const breadcrumbDispose = effect(() => {
      const drillId = this._drillId.value;
      const root = this._treeRoot.value;
      const showBc = this._configCell.value?.showBreadcrumb === true;

      let path: ChartNode[] = [];
      if (showBc && drillId && root) {
        let cur: ChartNode | null = findNode(root, drillId);
        while (cur) {
          path.unshift(cur);
          cur = cur.parent;
        }
        if (path.length <= 1) path = [];
      }

      const newPathIds = new Set(path.map((n) => n.id));

      for (const [id, el] of crumbEls) {
        if (!newPathIds.has(id)) {
          fadeOutEl(el);
          crumbEls.delete(id);
        }
      }

      if (path.length === 0) {
        // Keep the bar mounted but empty (opacity 0) so the chart area doesn't
        // jump when drilling in. The bar's space is reserved via min-height on
        // the chrome layer (set when showBreadcrumb is enabled). Only fade out
        // the crumb segments, not the bar itself.
        if (this._breadcrumbBar) {
          this._breadcrumbBar.style.opacity = "0";
        }
        return;
      }

      if (!this._breadcrumbBar) {
        const bar = document.createElement("div");
        bar.className = "drill-breadcrumb";
        bar.style.transition = `opacity ${motion.enterMs.value}ms ease`;
        bar.style.opacity = "0";
        this._chromeLayer!.appendChild(bar);
        void bar.offsetHeight;
        bar.style.opacity = "1";
        this._breadcrumbBar = bar;
      } else {
        // Bar exists but was faded out when at root — fade it back in.
        this._breadcrumbBar.style.opacity = "1";
      }

      for (let i = 0; i < path.length; i++) {
        const node = path[i];
        const isLast = i === path.length - 1;
        let seg = crumbEls.get(node.id);
        if (!seg) {
          seg = i === 0 ? buildRootSegment(node) : buildSegment(node, isLast);
          crumbEls.set(node.id, seg);
          let insertBefore: Node | null = null;
          for (let j = i + 1; j < path.length; j++) {
            const after = crumbEls.get(path[j].id);
            if (after) { insertBefore = after; break; }
          }
          this._breadcrumbBar!.insertBefore(seg, insertBefore);
          void seg.offsetHeight;
          seg.style.opacity = "1";
        } else {
          const btn = seg.querySelector("button");
          if (btn) {
            btn.className = isLast ? "drill-crumb drill-crumb--current" : "drill-crumb";
            const clone = btn.cloneNode(true) as HTMLButtonElement;
            if (!isLast) {
              clone.addEventListener("click", () => this.drill(node.id));
            }
            btn.replaceWith(clone);
          }
        }
      }
    });
    this._setupDisposers.push(breadcrumbDispose);
  }

  // --- Hooks for the chart subclass ---

  /** Derive the visible-node window, tracking the common dependencies
   *  (root, frozenOrder, config, drillId, reorderTick). The chart passes
   *  its geometry-specific build function. */
  protected _deriveWindow<T>(build: (root: ChartNode, config: ChartConfig, frozen: Map<string, string[]> | undefined, drill: string | null) => T, empty: T): Cell<T> {
    return derive(() => {
      const root = this._treeRoot.value;
      const frozen = this._frozenOrder.value;
      const config = this._configCell.value;
      const drill = this._drillId.value;
      this._reorderTick.value;
      if (!root || !config) return empty;
      return build(root, config, frozen ?? undefined, drill);
    });
  }

  /** Derive the layout, tracking the common dependencies + host size.
   *  The chart passes its geometry-specific compute function. */
  protected _deriveLayout<T>(compute: (root: ChartNode, config: ChartConfig, frozen: Map<string, string[]> | undefined, w: number, h: number, drill: string | null) => T, empty: T): Cell<T> {
    const { w: Wc, h: Hc } = this._hostSize!;
    return derive(() => {
      const root = this._treeRoot.value;
      const frozen = this._frozenOrder.value;
      const config = this._configCell.value;
      const drill = this._drillId.value;
      this._reorderTick.value;
      if (!root || !config) return empty;
      return compute(root, config, frozen ?? undefined, Wc.value, Hc.value, drill);
    });
  }

  /** Chart-specific rendering: create derivers (allNodes, layout) and forEach
   *  layers (tiles/arcs, edges/handles) with chart-specific shape makers +
   *  drag attachment. Called once from connectedCallback. Push disposers
   *  into _setupDisposers. */
  protected abstract _setupRendering(): void;

  /** Chart-specific behavior composition via setup(). Called from _build on
   *  every query-key change. The chart composes its drag/reorder behaviors
   *  + shared wheel/keyboard/transition/preview behaviors onto the gesture.
   *  Store the dispose fn in _behaviorDispose. */
  protected abstract _composeBehaviors(): void;

  /** Shared behavior composition: transitionOnUpdated + [extraPre] +
   *  previewFullRender + wheelEdit + keyboardEdit + chart-specific drag
   *  behaviors. Charts call this from _composeBehaviors() to avoid
   *  duplicating the standard wiring. Returns the dispose fn. */
  protected _composeStandardBehaviors(
    dragBehaviors: Behavior[],
    transitionOpts?: Parameters<typeof transitionOnUpdated>[0],
    extraPre?: Behavior[],
  ): () => void {
    const gesture = this._gesture!;
    return setup(gesture)(
      transitionOnUpdated(transitionOpts),
      ...(extraPre ?? []),
      previewFullRender({
        deferSort: () => this.config.sort !== "index",
        frozenOrder: this._frozenOrder,
        captureOrder: () => captureOrderFromWindow(this._window?.value ?? null),
      }),
      wheelEdit({
        target: (g: Gesture) => g.store.hover.value ?? g.store.focus.value,
        valueOf: (g: Gesture) => this.valueOf,
        writeValue: this.writeValue,
        frozenOrder: () => this._frozenOrder.value,
        conservationMode: (g: Gesture) => this.conservationMode,
        siblings: (g: Gesture) => this.siblings,
      }),
      keyboardEdit({
        target: (g: Gesture) => g.store.focus.value,
        valueOf: (g: Gesture) => this.valueOf,
        writeValue: this.writeValue,
        conservationMode: (g: Gesture) => this.conservationMode,
        siblings: (g: Gesture) => this.siblings,
        frozenOrder: () => this._frozenOrder.value,
      }),
      ...dragBehaviors,
    );
  }

  /** Shared drag-behavior selection: returns the drag behavior array based
   *  on config.dragBehavior / config.sort. Charts pass their chart-specific
   *  resize and reorder behavior factories. */
  protected _selectDragBehaviors(
    resizeBehavior: Behavior,
    reorderBehavior: Behavior,
  ): Behavior[] {
    const config = this._configCell.value!;
    const dragBehavior = config.dragBehavior
      ?? (config.sort === "index" ? "reorder" : "resize");
    if (dragBehavior === "resize") return [resizeBehavior];
    if (dragBehavior === "reorder") return [reorderBehavior];
    return [];
  }

  /** Common tileBodyDrag options shared by all hierarchical charts. Charts
   *  spread this into their tileBodyDrag() call and add chart-specific
   *  overrides (mode, axis) as needed. */
  protected _tileBodyDragDefaults(): TileBodyDragOptions {
    return {
      target: (g: Gesture) => g.store.hover.value ?? g.store.focus.value,
      valueOf: (_g: Gesture) => this.valueOf,
      writeValue: this.writeValue,
      siblings: (_g: Gesture) => this.siblings,
      frozenOrder: () => this._frozenOrder.value,
      windowGetter: () => this._window?.value ?? null,
      frozenOrderCell: this._frozenOrder,
      deferSort: () => this.config.sort !== "index",
      focusTile: (id) => this.setFocus(id),
    };
  }

  /** Common writeReorder callback for reorder behaviors (tile or arc). */
  protected _writeReorder(parentId: string, orderedIds: string[]): void {
    const k = this._kernelCell.value;
    const cfg = this._configCell.value;
    if (k && cfg) k.writeReorder(cfg.datasetId, parentId, orderedIds);
  }

  /** Transition options for _composeStandardBehaviors. Charts override to
   *  customize which attributes/elements get CSS settle transitions. Default:
   *  x/y/width/height on rect, text (icicle/treemap). */
  protected _transitionOpts(): Parameters<typeof transitionOnUpdated>[0] | undefined {
    // Default: no override. The behavior uses TRANSITION_DURATION.settle
    // (baseMs * 2.5) for CSS transitions on x/y/width/height. This covers
    // value-change settle and resize. Drill transitions are handled
    // separately (inline transform transitions on label groups, JS tweens
    // for sunburst) which DO use drillMs.
    return undefined;
  }

  /** Shared startGesture setup: captures snapshot, finds left/right nodes,
   *  sets pair total, captures frozen order, and opens the draft. Returns
   *  the common context {root, g, left, right} for chart-specific use.
   *  Charts call this first, then do their geometry-specific capture. */
  protected _startGestureCommon(edge: Edge): {
    root: ChartNode;
    g: Gesture;
    left: ChartNode;
    right: ChartNode;
  } {
    const root = this._treeRoot.value!;
    const g = this._gesture!;
    g.store.activeEdge = edge;
    g.store.snapshot = snapshotValues(root);

    const left = findNode(root, edge.leftId)!;
    const right = findNode(root, edge.rightId)!;
    this.setPairTotal(left.value.value + right.value.value);

    if (this.config.sort !== "index" && !g.store.frozenOrder) {
      const order = captureOrderFromWindow(this._window?.value ?? null);
      this._frozenOrder.value = order;
      g.store.frozenOrder = order;
    }

    this._dataView!.draft({
      nodeId: edge.leftId,
      value: left.value.value,
      secondaryNodeId: edge.rightId,
      secondaryValue: right.value.value,
      source: "divider-handle",
      intent: "edit",
      frozenOrder: g.store.frozenOrder ?? undefined,
    });

    return { root, g, left, right };
  }

  /** Shared endGesture teardown: clears pair total, active edge, commits
   *  the draft. Charts call this at the end of their endGesture. */
  protected _endGestureCommon(): void {
    const g = this._gesture!;
    if (g.state !== "Drafting") return;
    this.setPairTotal(0);
    g.store.activeEdge = null;
    this._dataView!.commit();
  }
}
