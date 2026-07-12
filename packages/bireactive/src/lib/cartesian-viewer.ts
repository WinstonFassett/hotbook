// CartesianViewer — axis-aware pan/zoom for Cartesian charts
//
// Extends Viewer with D3 scale management for X/Y axes. Unlike the base Viewer
// which only transforms viewBox, CartesianViewer rescales axes on pan/zoom
// (like D3's zoom behavior with scales).
//
// This is the "real" viewer for line/scatter/area charts — the base Viewer
// is for non-Cartesian diagrams (sankey, treemap, etc).

import { cell, effect, type Writable, type Cell, range, type Range, Anim, attachRaf, easeInOut } from "bireactive";
import { scaleLinear, type ScaleLinear } from "d3-scale";
import { axisBottom, axisLeft } from "d3-axis";
import { select } from "d3-selection";
import { type ViewerOptions } from "./viewer";
import { prefersReducedMotion } from "./transitions";

export interface CartesianViewerOptions extends ViewerOptions {
  /** Show grid lines. Default: true */
  showGrid?: boolean;
  /** Grid line color. Default: '#2a2d34' */
  gridColor?: string;
  /** Axis color. Default: '#cdd5e0' */
  axisColor?: string;
  /** X axis label */
  xLabel?: string;
  /** Y axis label */
  yLabel?: string;
  /** Number of X axis ticks. Default: 10 */
  xTicks?: number;
  /** Number of Y axis ticks. Default: 10 */
  yTicks?: number;
  /** Animate programmatic transitions. Default: true (false under prefers-reduced-motion). */
  smooth?: boolean;
}

export interface CartesianDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** bireactive animation handle. The concrete type is a generator-like Tween,
 *  but the public API consumes it as Animator. */
type Animator = import("bireactive").Animator;

/**
 * CartesianViewer — pan/zoom with D3 scale management for Cartesian charts.
 *
 * Key differences from base Viewer:
 * - Owns D3 scaleLinear for X/Y (not just viewBox)
 * - Renders axes + grid as reactive layers
 * - Updates scales on pan/zoom (rescale, not transform)
 * - Axes update tick marks at different zoom levels
 *
 * This is the viewer for charts with Cartesian coordinates (line, scatter, area).
 * The base Viewer is for non-Cartesian diagrams (sankey, trees, etc).
 */
export class CartesianViewer {
  // Reactive data-space domains
  private xDomain: Writable<Range>;
  private yDomain: Writable<Range>;

  // SVG pixel dimensions for the inner plot area
  private innerWidthCell: Writable<Cell<number>>;
  private innerHeightCell: Writable<Cell<number>>;

  // D3 scales derived from domains + inner dimensions
  private xScale: Writable<Cell<ScaleLinear<number, number>>>;
  private yScale: Writable<Cell<ScaleLinear<number, number>>>;

  // Original domain (for reset)
  private originalDomain: CartesianDomain;

  // SVG elements
  private svg: SVGSVGElement;
  private gridGroup?: SVGGElement;
  private xAxisGroup?: SVGGElement;
  private yAxisGroup?: SVGGElement;
  private dataGroup?: SVGGElement;

  // Config
  private opts: Required<CartesianViewerOptions>;

  // Pixel dimensions
  private width: number;
  private height: number;

  // Unique id for the plot-area clip path
  private clipId = `cartesian-viewer-clip-${Math.random().toString(36).slice(2)}`;

  // Margins for axes
  private margin = { top: 20, right: 20, bottom: 40, left: 50 };

  // Pan/zoom state
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panStartDomain: CartesianDomain | null = null;

  // Smooth transitions
  public smooth: boolean;
  private transitionDuration: number;
  private anim: Anim;
  private stopRaf: () => void;
  private transitionCancel: (() => void) | null = null;

  private scaleUpdateEffect: () => void;
  private renderEffectDispose: () => void;

  get innerWidth(): number { return this.innerWidthCell.value; }
  get innerHeight(): number { return this.innerHeightCell.value; }

  constructor(
    svg: SVGSVGElement,
    domain: CartesianDomain,
    width: number,
    height: number,
    options: CartesianViewerOptions = {}
  ) {
    this.svg = svg;
    this.width = width;
    this.height = height;
    this.originalDomain = { ...domain };

    this.opts = {
      enablePan: options.enablePan ?? true,
      enableZoom: options.enableZoom ?? true,
      enablePinch: options.enablePinch ?? true,
      minZoom: options.minZoom ?? 0.1,
      maxZoom: options.maxZoom ?? 10,
      animationDuration: options.animationDuration ?? 400,
      showGrid: options.showGrid ?? true,
      gridColor: options.gridColor ?? '#2a2d34',
      axisColor: options.axisColor ?? '#cdd5e0',
      xLabel: options.xLabel ?? '',
      yLabel: options.yLabel ?? '',
      xTicks: options.xTicks ?? 10,
      yTicks: options.yTicks ?? 10,
      smooth: options.smooth ?? !prefersReducedMotion(),
    };

    this.smooth = this.opts.smooth;
    this.transitionDuration = this.opts.animationDuration / 1000;

    this.anim = new Anim();
    this.stopRaf = attachRaf(this.anim);

    this.innerWidthCell = cell(width - this.margin.left - this.margin.right);
    this.innerHeightCell = cell(height - this.margin.top - this.margin.bottom);

    this.xDomain = range(domain.xMin, domain.xMax);
    this.yDomain = range(domain.yMin, domain.yMax);

    this.xScale = cell(scaleLinear().domain([domain.xMin, domain.xMax]).range([0, this.innerWidth]));
    this.yScale = cell(scaleLinear().domain([domain.yMin, domain.yMax]).range([this.innerHeight, 0]));

    // Set up SVG structure
    this.setupSvg();

    // Reactively update scales when domains or pixel dimensions change
    this.scaleUpdateEffect = effect(() => {
      const xDomain = this.xDomain.value;
      const yDomain = this.yDomain.value;
      this.xScale.value = scaleLinear().domain([xDomain.lo, xDomain.hi]).range([0, this.innerWidth]);
      this.yScale.value = scaleLinear().domain([yDomain.lo, yDomain.hi]).range([this.innerHeight, 0]);
    });

    // Reactively render axes and grid when scales change
    this.renderEffectDispose = effect(() => {
      // Access scales to depend on them (reading .value might not work)
      // The real dependency comes from within renderGrid/renderAxes
      this.renderGrid();
      this.renderAxes();
    });

    // Ensure initial render by manually updating scales (which triggers effects)
    const xDomain = this.xDomain.value;
    const yDomain = this.yDomain.value;
    this.xScale.value = scaleLinear().domain([xDomain.lo, xDomain.hi]).range([0, this.innerWidth]);
    this.yScale.value = scaleLinear().domain([yDomain.lo, yDomain.hi]).range([this.innerHeight, 0]);

    // Attach gesture handlers
    this.attachGestures();
  }

  /**
   * Set up SVG group structure
   */
  private setupSvg(): void {
    // Clear existing content
    this.svg.innerHTML = '';

    // Set viewBox
    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const innerWidth = this.innerWidth;
    const innerHeight = this.innerHeight;

    // Clip path for the plot area so grid/data never draw over the axes/labels
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clipPath.setAttribute('id', this.clipId);
    const clipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    clipRect.setAttribute('x', '0');
    clipRect.setAttribute('y', '0');
    clipRect.setAttribute('width', String(innerWidth));
    clipRect.setAttribute('height', String(innerHeight));
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
    this.svg.appendChild(defs);

    // Create main group with margins
    const mainGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    mainGroup.setAttribute('transform', `translate(${this.margin.left},${this.margin.top})`);
    this.svg.appendChild(mainGroup);

    // Grid layer (behind data)
    if (this.opts.showGrid) {
      this.gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.gridGroup.setAttribute('class', 'grid');
      this.gridGroup.setAttribute('clip-path', `url(#${this.clipId})`);
      mainGroup.appendChild(this.gridGroup);
    }

    // Data layer (charts render here)
    this.dataGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.dataGroup.setAttribute('class', 'data');
    this.dataGroup.setAttribute('clip-path', `url(#${this.clipId})`);
    mainGroup.appendChild(this.dataGroup);

    // X axis (positioned at bottom of inner chart area)
    this.xAxisGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.xAxisGroup.setAttribute('class', 'x-axis');
    this.xAxisGroup.setAttribute('transform', `translate(0,${innerHeight})`);
    mainGroup.appendChild(this.xAxisGroup);

    // Y axis
    this.yAxisGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.yAxisGroup.setAttribute('class', 'y-axis');
    mainGroup.appendChild(this.yAxisGroup);

    // Axis labels (positioned relative to inner chart area)
    if (this.opts.xLabel) {
      const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      xLabel.setAttribute('class', 'x-label');
      xLabel.setAttribute('text-anchor', 'middle');
      xLabel.setAttribute('x', String(innerWidth / 2));
      xLabel.setAttribute('y', String(innerHeight + this.margin.bottom - 5));
      xLabel.setAttribute('fill', this.opts.axisColor);
      xLabel.setAttribute('font-size', '12');
      xLabel.textContent = this.opts.xLabel;
      mainGroup.appendChild(xLabel);
    }

    if (this.opts.yLabel) {
      const yLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      yLabel.setAttribute('class', 'y-label');
      yLabel.setAttribute('text-anchor', 'middle');
      yLabel.setAttribute('transform', 'rotate(-90)');
      yLabel.setAttribute('x', String(-innerHeight / 2));
      yLabel.setAttribute('y', String(-this.margin.left + 15));
      yLabel.setAttribute('fill', this.opts.axisColor);
      yLabel.setAttribute('font-size', '12');
      yLabel.textContent = this.opts.yLabel;
      mainGroup.appendChild(yLabel);
    }

    // Trigger initial render via microtask
    Promise.resolve().then(() => {
      this.renderGrid();
      this.renderAxes();
    });
  }

  /**
   * Render grid lines
   */
  private renderGrid(): void {
    if (!this.gridGroup || !this.opts.showGrid) return;

    const xScale = this.xScale.value;
    const yScale = this.yScale.value;
    const innerWidth = this.innerWidth;
    const innerHeight = this.innerHeight;

    // Clear existing grid
    this.gridGroup.innerHTML = '';

    // X grid lines
    const xTicks = xScale.ticks(this.opts.xTicks);
    for (const tick of xTicks) {
      const x = xScale(tick);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(x));
      line.setAttribute('y1', '0');
      line.setAttribute('x2', String(x));
      line.setAttribute('y2', String(innerHeight));
      line.setAttribute('stroke', this.opts.gridColor);
      line.setAttribute('stroke-width', '1');
      line.setAttribute('opacity', '0.5');
      this.gridGroup.appendChild(line);
    }

    // Y grid lines
    const yTicks = yScale.ticks(this.opts.yTicks);
    for (const tick of yTicks) {
      const y = yScale(tick);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('y1', String(y));
      line.setAttribute('x2', String(innerWidth));
      line.setAttribute('y2', String(y));
      line.setAttribute('stroke', this.opts.gridColor);
      line.setAttribute('stroke-width', '1');
      line.setAttribute('opacity', '0.5');
      this.gridGroup.appendChild(line);
    }
  }

  /**
   * Render axes using D3
   */
  private renderAxes(): void {
    if (!this.xAxisGroup || !this.yAxisGroup) return;

    const xScale = this.xScale.value;
    const yScale = this.yScale.value;

    // X axis
    const xAxis = axisBottom(xScale).ticks(this.opts.xTicks);
    select(this.xAxisGroup)
      .call(xAxis as any)
      .selectAll('text, line, path')
      .attr('stroke', this.opts.axisColor)
      .attr('fill', this.opts.axisColor);

    // Y axis
    const yAxis = axisLeft(yScale).ticks(this.opts.yTicks);
    select(this.yAxisGroup)
      .call(yAxis as any)
      .selectAll('text, line, path')
      .attr('stroke', this.opts.axisColor)
      .attr('fill', this.opts.axisColor);
  }

  /**
   * Get the data group for chart rendering
   */
  getDataGroup(): SVGGElement | undefined {
    return this.dataGroup;
  }

  /**
   * Get current X scale
   */
  getXScale(): ScaleLinear<number, number> {
    return this.xScale.value;
  }

  /**
   * Get current Y scale
   */
  getYScale(): ScaleLinear<number, number> {
    return this.yScale.value;
  }

  /**
   * Reset to original domain
   */
  reset(smooth?: boolean): void {
    this.animateTo(this.originalDomain, smooth);
  }

  /**
   * Set the visible data-space domain.
   */
  setViewBox(domain: CartesianDomain, smooth?: boolean): void {
    this.animateTo(domain, smooth);
  }

  /**
   * Zoom by factor around a point in data coordinates
   */
  zoomBy(factor: number, centerX?: number, centerY?: number, smooth?: boolean): void {
    const xDomain = this.xDomain.value;
    const yDomain = this.yDomain.value;

    const xMin = xDomain.lo;
    const xMax = xDomain.hi;
    const yMin = yDomain.lo;
    const yMax = yDomain.hi;

    const cx = centerX ?? (xMin + xMax) / 2;
    const cy = centerY ?? (yMin + yMax) / 2;

    // Clamp zoom to the configured min/max relative to the original domain.
    const originalWidth = this.originalDomain.xMax - this.originalDomain.xMin;
    const currentWidth = xMax - xMin;
    const currentZoom = currentWidth === 0 ? 1 : originalWidth / currentWidth;
    const newZoom = Math.max(this.opts.minZoom, Math.min(this.opts.maxZoom, currentZoom * factor));
    const actualFactor = currentZoom === 0 ? factor : newZoom / currentZoom;

    if (actualFactor === 1) return;

    const newXMin = cx - (cx - xMin) / actualFactor;
    const newXMax = cx + (xMax - cx) / actualFactor;
    const newYMin = cy - (cy - yMin) / actualFactor;
    const newYMax = cy + (yMax - cy) / actualFactor;

    this.animateTo({ xMin: newXMin, xMax: newXMax, yMin: newYMin, yMax: newYMax }, smooth);
  }

  /**
   * Pan by data-space delta
   */
  pan(dx: number, dy: number, smooth?: boolean): void {
    const xDomain = this.xDomain.value;
    const yDomain = this.yDomain.value;

    this.animateTo({
      xMin: xDomain.lo + dx,
      xMax: xDomain.hi + dx,
      yMin: yDomain.lo + dy,
      yMax: yDomain.hi + dy,
    }, smooth);
  }

  /**
   * Attach pan/zoom gesture handlers
   */
  private attachGestures(): void {
    if (this.opts.enablePan) {
      this.svg.addEventListener('pointerdown', this.onPointerDown);
      this.svg.addEventListener('pointermove', this.onPointerMove);
      this.svg.addEventListener('pointerup', this.onPointerUp);
      this.svg.addEventListener('pointercancel', this.onPointerCancel);
    }

    if (this.opts.enableZoom) {
      this.svg.addEventListener('wheel', this.onWheel, { passive: false });
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;

    // Cancel any running programmatic transition so a gesture starts from the
    // current visual position (Rule 11: transitions are interruptible).
    this.transitionCancel?.();
    this.transitionCancel = null;

    this.isPanning = true;
    this.panStartX = e.clientX;
    this.panStartY = e.clientY;

    const xDomain = this.xDomain.value;
    const yDomain = this.yDomain.value;

    this.panStartDomain = { xMin: xDomain.lo, xMax: xDomain.hi, yMin: yDomain.lo, yMax: yDomain.hi };

    this.svg.style.cursor = 'grabbing';
    this.svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isPanning || !this.panStartDomain) return;

    const dx = e.clientX - this.panStartX;
    const dy = e.clientY - this.panStartY;

    // Convert pixel delta to data delta
    const dataWidth = this.panStartDomain.xMax - this.panStartDomain.xMin;
    const dataHeight = this.panStartDomain.yMax - this.panStartDomain.yMin;
    const innerWidth = this.innerWidth;
    const innerHeight = this.innerHeight;

    const dataDx = -(dx / innerWidth) * dataWidth;
    const dataDy = (dy / innerHeight) * dataHeight; // Inverted for SVG

    const newXMin = this.panStartDomain.xMin + dataDx;
    const newXMax = this.panStartDomain.xMax + dataDx;
    const newYMin = this.panStartDomain.yMin + dataDy;
    const newYMax = this.panStartDomain.yMax + dataDy;

    this.xDomain.value = { lo: newXMin, hi: newXMax };
    this.yDomain.value = { lo: newYMin, hi: newYMax };
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.isPanning) {
      this.isPanning = false;
      this.panStartDomain = null;
      this.svg.style.cursor = '';
      this.svg.releasePointerCapture(e.pointerId);
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.onPointerUp(e);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();

    // Get pointer position in data coordinates
    const rect = this.svg.getBoundingClientRect();
    const svgX = e.clientX - rect.left - this.margin.left;
    const svgY = e.clientY - rect.top - this.margin.top;

    const xScale = this.xScale.value;
    const yScale = this.yScale.value;

    const dataX = xScale.invert(svgX);
    const dataY = yScale.invert(svgY);

    // Zoom factor
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.1 : 1 / 1.1;

    // Wheel zoom is direct manipulation — stay immediate.
    this.zoomBy(factor, dataX, dataY, false);
  };

  /**
   * Update pixel dimensions
   */
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;

    this.innerWidthCell.value = width - this.margin.left - this.margin.right;
    this.innerHeightCell.value = height - this.margin.top - this.margin.bottom;

    this.setupSvg();
  }

  /**
   * Clean up
   */
  dispose(): void {
    this.transitionCancel?.();
    this.anim.stop();
    this.stopRaf();
    this.scaleUpdateEffect();
    this.renderEffectDispose();

    this.svg.removeEventListener('pointerdown', this.onPointerDown);
    this.svg.removeEventListener('pointermove', this.onPointerMove);
    this.svg.removeEventListener('pointerup', this.onPointerUp);
    this.svg.removeEventListener('pointercancel', this.onPointerCancel);
    this.svg.removeEventListener('wheel', this.onWheel);
  }

  /**
   * Move the domain to the target, optionally animating.
   */
  private animateTo(target: CartesianDomain, smooth?: boolean): void {
    const shouldSmooth = smooth ?? this.smooth;
    const dur = this.transitionDuration;

    // Cancel/replace any in-progress transition.
    this.transitionCancel?.();
    this.transitionCancel = null;

    if (!shouldSmooth || dur <= 0) {
      this.xDomain.value = { lo: target.xMin, hi: target.xMax };
      this.yDomain.value = { lo: target.yMin, hi: target.yMax };
      return;
    }

    this.transitionCancel = this.anim.start(
      this.xDomain.to({ lo: target.xMin, hi: target.xMax }, dur, easeInOut) as unknown as Animator,
      this.yDomain.to({ lo: target.yMin, hi: target.yMax }, dur, easeInOut) as unknown as Animator
    );
  }
}
