// cartesian-chart-base.ts — shared base for Cartesian charts (bar, gantt,
// line, area, scatter). Mirrors HierarchicalChartBase's structure (reactive
// config, Gesture/Editor, SVG surface, host size, behavior composition) but
// with flat data instead of tree/Kernel/DataView. No drill, no breadcrumb.
//
// The chart subclass provides two hooks:
//   • _setupRendering() — chart-specific derivers (scales, layout) + forEach
//     layers (marks, axes, handles) with chart-specific shape makers + drag
//     attachment.
//   • _composeBehaviors() — chart-specific behavior composition via setup()
//     (drag/reorder behaviors + shared wheel/keyboard/transition behaviors).
//
// Design: parallel to HierarchicalChartBase (not a common ancestor) because
// the data models are fundamentally different (flat array vs tree). The
// shared behaviors (wheelEdit, keyboardEdit, transitionOnUpdated) work with
// both because they use injected accessors (valueOf/writeValue/siblings),
// not tree-specific lookups.

import { Anim, cell, derive, effect, group, mount, Vec, type Cell, type Mount, type Writable } from "bireactive";
import { Gesture, setup, type Behavior } from "../hierarchical/gesture";
import { useHostSize } from "../lib/host-size";
import { makeBridge, type BrSyncBridge, type ElementWithBridge } from "../lib/hud-bridge";
import { transitionOnUpdated } from "../hierarchical/behaviors/transition-on-updated";
import { motion } from "../lib/runtime-config";
import { previewFullRender, captureOrderFromWindow } from "../hierarchical/behaviors/preview-full-render";
import { wheelEdit } from "../hierarchical/behaviors/wheel-edit";
import { keyboardEdit } from "../hierarchical/behaviors/keyboard-edit";
import type { ConservationMode } from "../hierarchical/behaviors/keyboard-edit";
import { attachRaf } from "../lib/raf";

const SVG_NS = "http://www.w3.org/2000/svg";
const FALLBACK_W = 720;
const FALLBACK_H = 360;

/** Flat data item — the cartesian analog of hierarchical's ChartNode.
 *  Each item has an id, label, and numeric value. Charts may extend this
 *  with extra fields (e.g. gantt's start/end, scatter's x/y). */
export interface FlatItem {
  id: string;
  label: string;
  value: number;
  [key: string]: unknown;
}

/** Cartesian chart config. Simpler than hierarchical's ChartConfig — no
 *  datasetId/depth (data is direct, not Kernel-keyed). */
export interface CartesianConfig {
  sort: "index" | "value";
  orientation?: "vertical" | "horizontal";
  canReorder?: boolean;
  dragBehavior?: "none" | "resize" | "reorder";
  conservationMode?: ConservationMode;
  colorMode?: "single" | "palette";
  labelMode?: "axis" | "inside" | "both";
  valueMode?: "inside" | "outside" | "none";
}

// Chart chrome CSS — injected once per document + once per host tag.
const CHROME_CSS = `
[data-reordering] { filter: drop-shadow(0 6px 12px rgba(0,0,0,0.3)); }
`;

const injectedTags = new Set<string>();
function ensureChromeCss(tag: string): void {
  if (typeof document === "undefined") return;
  if (!document.getElementById("vf-cartesian-chrome")) {
    const style = document.createElement("style");
    style.id = "vf-cartesian-chrome";
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
${tag}.gesture-active [data-id] { cursor: grabbing !important; }
`;
    document.head.appendChild(style);
  }
}

export abstract class CartesianChartBase extends HTMLElement {
  // --- Shared reactive cells ---
  protected _configCell = cell<CartesianConfig | null>(null);
  protected _dataCell = cell<readonly FlatItem[]>([]);
  protected _frozenOrder = cell<Map<string, string[]> | null>(null);
  /** Reactive map of item id → live value. Labels read from this so they
   *  update when values change (drag resize, etc.) even though forEach
   *  reuses DOM by key and the item's value field is a stale snapshot. */
  protected _valueMap = derive(() => {
    const items = this._dataCell.value;
    const map = new Map<string, number>();
    for (const item of items) map.set(item.id, item.value);
    return map;
  });
  protected _focusCell = cell<string | null>(null);
  protected _hoverCell = cell<string | null>(null);
  /** Tick cell — incremented on each reorder move to force layout
   *  re-derivation (array mutation isn't reactive on its own). */
  protected _reorderTick = cell(0);

  // --- Rendered window (set by subclass _setupRendering, read by base
  //     behavior composition for frozen-order capture). ---
  protected _window?: Cell<any>;
  protected _layout?: Cell<any>;

  // --- Shared infrastructure ---
  /** Animation controller (for charts that use anim.clock tween via
   *  chartContext). Bar/Gantt use CSS transitions instead. */
  public anim = new Anim();
  private _detachRaf: (() => void) | null = null;
  protected _gesture: Gesture | null = null;
  protected _svg?: SVGSVGElement;
  /** Backward-compat getter — shared libs (sankeyScene) access `host.svg`. */
  get svg() { return this._svg; }
  protected _rootShape?: any;
  /** Callable mount handle for adding shapes — `s(rect(...))` adds to root. */
  protected _s!: Mount;
  /** Exposed for subclasses that use the `s(rect(...))` mounting pattern. */
  protected get s() { return this._s; }
  protected _defs?: SVGDefsElement;
  /** Unique instance ID for clipPath/gradient IDs (avoids collisions
   *  when multiple chart instances are on the same page). */
  protected _instanceId = `c${Math.random().toString(36).slice(2, 8)}`;
  protected _hostSize?: ReturnType<typeof useHostSize>;

  protected _setupDisposers: (() => void)[] = [];
  protected _buildDisposers: (() => void)[] = [];
  protected _behaviorDispose: (() => void) | null = null;
  protected _unsubChart: (() => void) | null = null;

  // --- Shared GestureContext value-accessor fields ---
  get config() { return this._configCell.value!; }
  get conservationMode(): ConservationMode {
    return this._configCell.value?.conservationMode ?? "additive";
  }
  altHeld() { return this._gesture?.store.altHeld ?? false; }
  get snapshot() { return this._gesture?.store.snapshot ?? null; }
  get data() { return this._dataCell.value; }
  get pairTotal() { return this._gesture?.store.pairTotal ?? 0; }
  setPairTotal(n: number) { if (this._gesture) this._gesture.store.pairTotal = n; }

  // --- Config wiring ---
  set config(c: CartesianConfig) {
    const prev = this._configCell.value;
    this._configCell.value = { ...c };
    // Config change → updated event (re-derives layout, no rebuild).
    this._gesture?.editor.updated();
    void prev; // suppress unused
  }

  /** Set the flat data array. Triggers re-derivation via the data cell. */
  set items(items: readonly FlatItem[]) {
    this._dataCell.value = items;
  }
  get items() { return this._dataCell.value; }

  /** Bump the reorder tick — forces layout re-derivation after an
   *  array mutation (reorder gestures). */
  bumpReorder() { this._reorderTick.value++; }

  // --- Focus + hover ---
  setFocus(id: string | null) { this._focusCell.value = id; }
  setHover(id: string | null) { this._hoverCell.value = id; }
  get focusedId() { return this._focusCell.value; }
  get hoveredId() { return this._hoverCell.value; }
  get focusCell() { return this._focusCell; }
  get hoverCell() { return this._hoverCell; }

  // --- Legacy HUD bridge (brSync): external hover/select in, own
  //     hover/focus changes out. ---
  protected _bridge: BrSyncBridge | null = null;
  private _extHover: string | null | undefined = undefined;
  private _extFocus: string | null | undefined = undefined;

  // --- Value accessors (shared GestureContext fields) ---
  // Flat-data versions: look up by id in the data array, not findNode.
  valueOf = (id: string) => {
    const items = this._dataCell.value;
    const item = items.find((d) => d.id === id);
    return item ? item.value : 0;
  };
  writeValue = (id: string, value: number) => {
    const items = this._dataCell.value;
    const item = items.find((d) => d.id === id);
    if (item) {
      (item as any).value = value;
      // Trigger re-derivation by creating a new array reference.
      this._dataCell.value = [...items];
    }
  };
  siblings = (id: string) => {
    const items = this._dataCell.value;
    // All items are siblings in a flat chart.
    return items.filter((d) => d.id !== id).map((d) => d.id);
  };
  restore = () => {
    if (this._gesture?.store.snapshot) {
      const items = this._dataCell.value;
      for (const item of items) {
        const snap = this._gesture.store.snapshot.get(item.id);
        if (snap !== undefined) (item as any).value = snap;
      }
      this._dataCell.value = [...items];
    }
  };

  /** Set the SVG viewBox. Called by subclasses that need overflow scrolling
   *  (e.g. bar chart with many bars). When not called, the SVG auto-sizes
   *  to the host element. */
  protected _setViewBox(w: number, h: number): void {
    if (!this._svg) return;
    this._svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this._svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }

  // --- Lifecycle ---
  protected _surfaceReady = false;

  protected _createSurface(): void {
    this._svg = document.createElementNS(SVG_NS, "svg");
    this._svg.style.display = "block";
    this._svg.style.flex = "1 1 0";
    this._svg.style.width = "100%";
    this._svg.style.overflow = "hidden";
    this.appendChild(this._svg);

    this._rootShape = group();
    this._svg.appendChild(this._rootShape.el);
    this._s = mount(this._rootShape);

    const defs = document.createElementNS(SVG_NS, "defs");
    this._svg.appendChild(defs);
    this._defs = defs;

    this._hostSize = useHostSize(this, { width: FALLBACK_W, height: FALLBACK_H });
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

    this._createSurface();

    // Start the animation clock (for charts using anim.clock tween).
    this._detachRaf?.();
    this._detachRaf = attachRaf(this.anim);

    // Chart-specific rendering (derivers + forEach layers).
    this._setupRendering();

    // Legacy hotbook HUD bridge (brSync): external hover/select in,
    // own hover/focus changes out.
    const bridge = makeBridge({
      setHover: (id) => { this._extHover = id; this.setHover(id); },
      setSelect: (id) => { this._extFocus = id; this.setFocus(id); },
      setDrill: () => { /* no drill on cartesian */ },
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

    // Build the gesture + behaviors once config is set.
    this._setupDisposers.push(
      effect(() => {
        const c = this._configCell.value;
        if (c) this._build(c);
      }),
    );
  }

  disconnectedCallback() {
    this._unsubChart?.();
    this._behaviorDispose?.();
    this._buildDisposers.forEach((d) => d());
    this._setupDisposers.forEach((d) => d());
    this._detachRaf?.();
    this._detachRaf = null;
    this._rootShape?.dispose();
    this._gesture?.dispose();
    this._buildDisposers = [];
    this._setupDisposers = [];
  }

  // --- _build skeleton (shared) ---
  protected _build(config: CartesianConfig) {
    this._buildDisposers.forEach((d) => d());
    this._buildDisposers = [];
    this._unsubChart?.();
    this._behaviorDispose?.();
    this._gesture?.dispose();

    this._gesture = new Gesture(undefined, config as any);
    this._gesture.store.host = this;
    this._gesture.store.focus = this._focusCell;
    this._gesture.store.hover = this._hoverCell;
    // Flat charts don't have a tree — store the data cell instead.
    (this._gesture.store as any).tree = this._dataCell as any;
    this._gesture.store.takeSnapshot = () => {
      if (this._gesture && !this._gesture.store.snapshot) {
        const items = this._dataCell.value;
        const snap = new Map<string, number>();
        for (const item of items) snap.set(item.id, item.value);
        this._gesture.store.snapshot = snap;
      }
    };

    // Legacy contract: gestureActive flag + gesturecommit event.
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

    // Chart-specific behavior composition.
    this._composeBehaviors();
  }

  // --- Hooks for the chart subclass ---
  protected abstract _setupRendering(): void;
  protected abstract _composeBehaviors(): void;

  // --- Shared behavior composition: transitionOnUpdated + [extraPre] +
  //     previewFullRender + wheelEdit + keyboardEdit + chart-specific drag
  //     behaviors. Charts call this from _composeBehaviors(). ---
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
        valueOf: (_g: Gesture) => this.valueOf,
        writeValue: this.writeValue,
        frozenOrder: () => this._frozenOrder.value,
        conservationMode: (g: Gesture) => this.conservationMode,
        siblings: (_g: Gesture) => this.siblings,
      }),
      keyboardEdit({
        target: (g: Gesture) => g.store.focus.value,
        valueOf: (_g: Gesture) => this.valueOf,
        writeValue: this.writeValue,
        conservationMode: (g: Gesture) => this.conservationMode,
        siblings: (_g: Gesture) => this.siblings,
        frozenOrder: () => this._frozenOrder.value,
      }),
      ...dragBehaviors,
    );
  }

  // --- Shared drag-behavior selection ---
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

  /** Common writeReorder callback for reorder behaviors. */
  protected _writeReorder(_parentId: string, orderedIds: string[]): void {
    // Flat charts: reorder the data array directly.
    const items = this._dataCell.value;
    const map = new Map(items.map((d) => [d.id, d]));
    const reordered = orderedIds.map((id) => map.get(id)!).filter(Boolean);
    this._dataCell.value = reordered;
    this.bumpReorder();
  }

  /** Transition options for _composeStandardBehaviors. Charts override to
   *  customize which attributes/elements get CSS transitions. */
  protected _transitionOpts(): Parameters<typeof transitionOnUpdated>[0] | undefined {
    return undefined;
  }
}
