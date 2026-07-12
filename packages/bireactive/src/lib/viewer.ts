// Viewer — a viewport over diagram data-space
//
// The missing object from the diagram/viewer/container architecture. Owns the
// mapping from data-space to pixel box, and all presentation policy:
// pan/zoom/fit/show. This is the extraction described in step 2 of the
// viewer-architecture.md sequencing.
//
// The diagram produces geometry at a constant ruler; the viewer frames it via
// viewBox transform. No geometry recomputation on pan/zoom/fit — only transforms.

import { cell, derive, effect, type Writable } from "bireactive";
import type { Bounds } from "./sankey-layout";

export interface ViewerOptions {
  /** Enable pan via mouse drag. Default: true */
  enablePan?: boolean;
  /** Enable zoom via mouse wheel. Default: true */
  enableZoom?: boolean;
  /** Enable pinch zoom on touch devices. Default: true */
  enablePinch?: boolean;
  /** Minimum zoom level (1 = fit to bounds). Default: 0.1 */
  minZoom?: number;
  /** Maximum zoom level. Default: 10 */
  maxZoom?: number;
  /** Animation duration in ms for show() transitions. Default: 400 */
  animationDuration?: number;
}

export interface ShowOptions {
  /** Zoom to fully contain the bounds. Default: true */
  zoomToContain?: boolean;
  /** Pan to center the bounds. Default: true */
  panToContain?: boolean;
  /** Animate the transition. Default: true */
  animate?: boolean;
  /** Padding around the target bounds (in data-space units). Default: 0 */
  padding?: number;
}

/**
 * Viewer — a viewport over diagram data-space.
 *
 * Responsibilities:
 * - Fit diagram bounds into pixel box via viewBox transform
 * - Pan/zoom gestures (optional, configurable)
 * - show(bounds) — programmatic pan/zoom to bring content into view
 * - Query current data→px scale for legibility checks
 *
 * The diagram owns geometry at a constant ruler; the viewer owns presentation.
 */
export class Viewer {
  // Reactive state
  private viewBoxX: Writable<number>;
  private viewBoxY: Writable<number>;
  private viewBoxW: Writable<number>;
  private viewBoxH: Writable<number>;
  private zoom: Writable<number> = cell(1);

  // Config
  private opts: Required<ViewerOptions>;

  // SVG element and pixel box
  private svg: SVGSVGElement;
  private pixelWidth = 0;
  private pixelHeight = 0;

  // Pan gesture state
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panStartViewX = 0;
  private panStartViewY = 0;

  constructor(
    svg: SVGSVGElement,
    initialBounds: Bounds,
    pixelWidth: number,
    pixelHeight: number,
    options: ViewerOptions = {}
  ) {
    this.svg = svg;
    this.pixelWidth = pixelWidth;
    this.pixelHeight = pixelHeight;

    this.opts = {
      enablePan: options.enablePan ?? true,
      enableZoom: options.enableZoom ?? true,
      enablePinch: options.enablePinch ?? true,
      minZoom: options.minZoom ?? 0.1,
      maxZoom: options.maxZoom ?? 10,
      animationDuration: options.animationDuration ?? 400,
    };

    // Initialize viewBox to fit the initial bounds
    const fitted = this.computeFit(initialBounds, pixelWidth, pixelHeight);
    this.viewBoxX = cell(fitted.x);
    this.viewBoxY = cell(fitted.y);
    this.viewBoxW = cell(fitted.w);
    this.viewBoxH = cell(fitted.h);

    // Reactively update SVG viewBox when cells change
    effect(() => {
      const x = this.viewBoxX.value;
      const y = this.viewBoxY.value;
      const w = this.viewBoxW.value;
      const h = this.viewBoxH.value;
      this.svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
      this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    });

    // Attach gesture handlers
    this.attachGestures();
  }

  /**
   * Compute viewBox dimensions to fit bounds into pixel box.
   * Returns { x, y, w, h } for the viewBox.
   */
  private computeFit(
    bounds: Bounds,
    pxW: number,
    pxH: number,
    padding = 0
  ): { x: number; y: number; w: number; h: number } {
    // Add padding to bounds
    const bx = bounds.x - padding;
    const by = bounds.y - padding;
    const bw = bounds.w + 2 * padding;
    const bh = bounds.h + 2 * padding;

    // Compute scale to fit bounds into pixel box (preserveAspectRatio)
    const scaleX = pxW / bw;
    const scaleY = pxH / bh;
    const scale = Math.min(scaleX, scaleY);

    // ViewBox dimensions to achieve this scale
    const vw = pxW / scale;
    const vh = pxH / scale;

    // Center the bounds in the viewBox
    const vx = bx + bw / 2 - vw / 2;
    const vy = by + bh / 2 - vh / 2;

    return { x: vx, y: vy, w: vw, h: vh };
  }

  /**
   * Fit the viewer to show the given bounds.
   * This is the fit responsibility from the architecture doc.
   */
  fit(bounds: Bounds, padding = 0): void {
    const fitted = this.computeFit(bounds, this.pixelWidth, this.pixelHeight, padding);
    this.viewBoxX.value = fitted.x;
    this.viewBoxY.value = fitted.y;
    this.viewBoxW.value = fitted.w;
    this.viewBoxH.value = fitted.h;
    this.zoom.value = 1;
  }

  /**
   * Programmatically pan/zoom to show the given bounds.
   * The data-space analogue of element.scrollIntoView().
   */
  show(bounds: Bounds, options: ShowOptions = {}): void {
    const opts = {
      zoomToContain: options.zoomToContain ?? true,
      panToContain: options.panToContain ?? true,
      animate: options.animate ?? true,
      padding: options.padding ?? 0,
    };

    if (opts.zoomToContain) {
      // Fit to the target bounds
      const fitted = this.computeFit(bounds, this.pixelWidth, this.pixelHeight, opts.padding);

      if (opts.animate) {
        // TODO: Implement smooth animation using the settle rhythm (Rule 10)
        // For now, snap instantly
        this.viewBoxX.value = fitted.x;
        this.viewBoxY.value = fitted.y;
        this.viewBoxW.value = fitted.w;
        this.viewBoxH.value = fitted.h;
      } else {
        this.viewBoxX.value = fitted.x;
        this.viewBoxY.value = fitted.y;
        this.viewBoxW.value = fitted.w;
        this.viewBoxH.value = fitted.h;
      }
    } else if (opts.panToContain) {
      // Pan to center the bounds without zooming
      const centerX = bounds.x + bounds.w / 2;
      const centerY = bounds.y + bounds.h / 2;

      const newX = centerX - this.viewBoxW.value / 2;
      const newY = centerY - this.viewBoxH.value / 2;

      if (opts.animate) {
        // TODO: Implement smooth animation
        this.viewBoxX.value = newX;
        this.viewBoxY.value = newY;
      } else {
        this.viewBoxX.value = newX;
        this.viewBoxY.value = newY;
      }
    }
  }

  /**
   * Get the current data→px scale factor.
   * Useful for legibility queries: "is this label ≥ N px right now?"
   */
  getScale(): number {
    return this.pixelWidth / this.viewBoxW.value;
  }

  /**
   * Pan the view by the given data-space delta.
   */
  pan(dx: number, dy: number): void {
    this.viewBoxX.value += dx;
    this.viewBoxY.value += dy;
  }

  /**
   * Zoom by the given factor around a data-space point.
   */
  zoomBy(factor: number, centerX?: number, centerY?: number): void {
    const newZoom = Math.max(
      this.opts.minZoom,
      Math.min(this.opts.maxZoom, this.zoom.value * factor)
    );
    const actualFactor = newZoom / this.zoom.value;

    if (actualFactor === 1) return; // At zoom limit

    const cx = centerX ?? this.viewBoxX.value + this.viewBoxW.value / 2;
    const cy = centerY ?? this.viewBoxY.value + this.viewBoxH.value / 2;

    // Zoom around the center point
    const newW = this.viewBoxW.value / actualFactor;
    const newH = this.viewBoxH.value / actualFactor;
    const newX = cx - (cx - this.viewBoxX.value) / actualFactor;
    const newY = cy - (cy - this.viewBoxY.value) / actualFactor;

    this.viewBoxX.value = newX;
    this.viewBoxY.value = newY;
    this.viewBoxW.value = newW;
    this.viewBoxH.value = newH;
    this.zoom.value = newZoom;
  }

  /**
   * Attach pan/zoom gesture handlers to the SVG.
   */
  private attachGestures(): void {
    if (this.opts.enablePan) {
      this.svg.addEventListener("pointerdown", this.onPointerDown);
      this.svg.addEventListener("pointermove", this.onPointerMove);
      this.svg.addEventListener("pointerup", this.onPointerUp);
      this.svg.addEventListener("pointercancel", this.onPointerCancel);
    }

    if (this.opts.enableZoom) {
      this.svg.addEventListener("wheel", this.onWheel, { passive: false });
    }

    // TODO: Implement pinch zoom for touch devices
    // This requires tracking multi-touch gestures
  }

  private onPointerDown = (e: PointerEvent): void => {
    // Only pan with left mouse button or touch
    if (e.button !== 0) return;

    // Don't interfere with other interactive elements
    const target = e.target as Element;
    if (target.hasAttribute("data-focusable") || target.closest("[data-interactive]")) {
      return;
    }

    this.isPanning = true;
    this.panStartX = e.clientX;
    this.panStartY = e.clientY;
    this.panStartViewX = this.viewBoxX.value;
    this.panStartViewY = this.viewBoxY.value;

    this.svg.style.cursor = "grabbing";
    this.svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isPanning) return;

    const dx = e.clientX - this.panStartX;
    const dy = e.clientY - this.panStartY;

    // Convert pixel delta to data-space delta
    const scale = this.pixelWidth / this.viewBoxW.value;
    const dataDx = -dx / scale;
    const dataDy = -dy / scale;

    this.viewBoxX.value = this.panStartViewX + dataDx;
    this.viewBoxY.value = this.panStartViewY + dataDy;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.isPanning) {
      this.isPanning = false;
      this.svg.style.cursor = "";
      this.svg.releasePointerCapture(e.pointerId);
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.onPointerUp(e);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();

    // Get pointer position in SVG coords
    const rect = this.svg.getBoundingClientRect();
    const svgX = this.viewBoxX.value + (e.clientX - rect.left) / rect.width * this.viewBoxW.value;
    const svgY = this.viewBoxY.value + (e.clientY - rect.top) / rect.height * this.viewBoxH.value;

    // Zoom factor: scroll down = zoom out, scroll up = zoom in
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.1 : 1 / 1.1;

    this.zoomBy(factor, svgX, svgY);
  };

  /**
   * Update pixel dimensions when container resizes.
   */
  setPixelSize(width: number, height: number): void {
    this.pixelWidth = width;
    this.pixelHeight = height;
  }

  /**
   * Clean up event listeners.
   */
  dispose(): void {
    this.svg.removeEventListener("pointerdown", this.onPointerDown);
    this.svg.removeEventListener("pointermove", this.onPointerMove);
    this.svg.removeEventListener("pointerup", this.onPointerUp);
    this.svg.removeEventListener("pointercancel", this.onPointerCancel);
    this.svg.removeEventListener("wheel", this.onWheel);
  }
}
