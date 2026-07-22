// AreaChart — vanilla-TS port of LayerChart's AreaChart wrapper.
//
// Migrated from Diagram to CartesianChartBase. Uses the shared SVG surface,
// host size, and anim clock. Gestures via attachCartesianGestures.

import { Anchor, cell, circle, derive, effect as biEffect, label, line, Vec } from "bireactive";
import { CartesianChartBase, type FlatItem } from "../cartesian/cartesian-chart-base";
import { area } from "../lib/area";
import { axis } from "../lib/axis";
import { chartContext } from "../lib/chart-context";
import { attachCartesianGestures, makeBisectFinder } from "../lib/cartesian-gestures";
import { spline } from "../lib/spline";
import { FILL_STYLE } from "../lib/host-size";
import { setup } from "../hierarchical/gesture";
import { transitionOnUpdated } from "../hierarchical/behaviors/transition-on-updated";

const W = 720;
const H = 360;

interface Point extends FlatItem { date: Date; value: number; }

function makeSeries(): Point[] {
  const out: Point[] = [];
  const start = new Date(2026, 0, 1).getTime();
  const day = 86400 * 1000;
  let v = 60;
  for (let i = 0; i < 30; i++) {
    v += (Math.random() - 0.4) * 8;
    out.push({ id: String(i), label: String(i), date: new Date(start + i * day), value: Math.max(20, v) });
  }
  return out;
}

// Default geometry constants (now themeable via reactive cells)
const DEFAULT_PADDING = { top: 16, right: 24, bottom: 36, left: 56 };
const DEFAULT_AREA_FILL_OPACITY = 0.3;
const DEFAULT_LINE_STROKE_WIDTH = 2;
const DEFAULT_FOCUS_CIRCLE_RADIUS = 8;
const DEFAULT_HOVER_CIRCLE_RADIUS = 4;
const DEFAULT_HOVER_STROKE_WIDTH = 2;
const DEFAULT_SELECTED_OUTER_RADIUS = 6;
const DEFAULT_SELECTED_INNER_RADIUS = 3;
const DEFAULT_SELECTED_STROKE_WIDTH = 2;

// Helper to read CSS variable or return default
function getCSSVar(varName: string, defaultValue: string | number): string | number {
  if (typeof window === 'undefined') return defaultValue;
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value ? (typeof defaultValue === 'number' ? parseFloat(value) : value) : defaultValue;
}

const AREA_CSS = `
text { pointer-events: none; }
${FILL_STYLE}
[data-focusable]:focus { outline: 2px solid var(--color-focus, #4a9eff); outline-offset: 2px; }
[data-focusable]:focus:not(:focus-visible) { outline: none; }
`;
let areaCssInjected = false;
function ensureAreaCss() {
  if (typeof document === "undefined" || areaCssInjected) return;
  areaCssInjected = true;
  const style = document.createElement("style");
  style.id = "vf-area-chart";
  style.textContent = AREA_CSS;
  document.head.appendChild(style);
}

export class MdAreaChartLC extends CartesianChartBase {
  readonly dataCell = cell<readonly Point[]>(makeSeries());

  private _yBindingCell = cell<(d: Point) => number>((d) => d.value);

  // Theming: reactive cells for geometry
  readonly paddingTopCell = cell(DEFAULT_PADDING.top);
  readonly paddingRightCell = cell(DEFAULT_PADDING.right);
  readonly paddingBottomCell = cell(DEFAULT_PADDING.bottom);
  readonly paddingLeftCell = cell(DEFAULT_PADDING.left);
  readonly areaFillOpacityCell = cell(DEFAULT_AREA_FILL_OPACITY);
  readonly lineStrokeWidthCell = cell(DEFAULT_LINE_STROKE_WIDTH);
  readonly focusCircleRadiusCell = cell(DEFAULT_FOCUS_CIRCLE_RADIUS);
  readonly hoverCircleRadiusCell = cell(DEFAULT_HOVER_CIRCLE_RADIUS);
  readonly hoverStrokeWidthCell = cell(DEFAULT_HOVER_STROKE_WIDTH);
  readonly selectedOuterRadiusCell = cell(DEFAULT_SELECTED_OUTER_RADIUS);
  readonly selectedInnerRadiusCell = cell(DEFAULT_SELECTED_INNER_RADIUS);
  readonly selectedStrokeWidthCell = cell(DEFAULT_SELECTED_STROKE_WIDTH);

  // Theming: reactive cells for colors
  readonly accentColorCell = cell("#7aaae8");
  readonly focusColorCell = cell("#4a9eff");
  readonly hoverLineColorCell = cell("#888");
  readonly whiteColorCell = cell("#fff");

  get yBinding(): string { return (this as any)._yBindingName ?? 'value' }
  set yBinding(v: string) {
    const prev = (this as any)._yBindingName;
    (this as any)._yBindingName = v;
    if (prev !== v) this._yBindingCell.value = (d: Point) => d.value;
  }

  get measureKey(): string { return this.yBinding }
  set measureKey(v: string) { this.yBinding = v }

  set externalData(v: { date: Date; value: number }[] | undefined) {
    if (v) this.dataCell.value = v as Point[];
  }
  get externalData(): { date: Date; value: number }[] | undefined {
    return this.dataCell.value as Point[];
  }

  connectedCallback() {
    super.connectedCallback();
    if (!this._configCell.value) {
      this._configCell.value = { sort: "index", conservationMode: "additive" };
    }
  }

  protected _setupRendering(): void {
    ensureAreaCss();
    const s = this._s;
    const { w: Wc, h: Hc } = this._hostSize!;
    this._setViewBox(Wc.value, Hc.value);
    this.tabIndex = -1;
    this.style.outline = "none";

    // ─── Sync CSS variables to reactive cells ────────────────────────────────
    this._setupDisposers.push(biEffect(() => {
      const accentColor = getCSSVar('--color-accent', "#7aaae8");
      const focusColor = getCSSVar('--color-focus', "#4a9eff");
      this.accentColorCell.value = accentColor as string;
      this.focusColorCell.value = focusColor as string;
    }));

    const data = this.dataCell;
    this._setupDisposers.push(biEffect(() => { this._dataCell.value = this.dataCell.value; }));

    const ctx = chartContext<Point>({
      width: Wc, height: Hc, data,
      x: (d) => d.date,
      y: this._yBindingCell as any,
      idOf: (d) => d.id ?? String(d.date.getTime()),
      host: this,
      anim: this.anim,
      padding: {
        top: this.paddingTopCell.value,
        right: this.paddingRightCell.value,
        bottom: this.paddingBottomCell.value,
        left: this.paddingLeftCell.value
      },
      yNice: true, yBaseline: 0,
    });

    axis(s, ctx, { placement: "bottom" });
    axis(s, ctx, { placement: "left" });
    s(area(ctx, { fill: this.accentColorCell.value, fillOpacity: this.areaFillOpacityCell.value, stroke: "none" }));
    s(spline(ctx, { stroke: this.accentColorCell.value, strokeWidth: this.lineStrokeWidthCell.value }));

    const hover = cell<Point | null>(null);
    const selected = cell<Point | null>(null);

    const bisectFind = makeBisectFinder(data, (d) => d.date);
    const svgEl = this._svg!;

    const mutateDatum = (pt: Point, delta: number) => {
      pt.value = Math.max(0, pt.value + delta);
      data.value = [...data.value];
    };

    const points0 = data.peek() as Point[];
    const pointElements = new Map<Point, SVGCircleElement>();
    for (const pt of points0) {
      const pos = Vec.derive(() => ({ x: ctx.xGet.value(pt), y: ctx.yGet.value(pt) }));
      const focusCircle = s(circle(pos, this.focusCircleRadiusCell.value, { fill: "transparent", stroke: "none" }));
      pointElements.set(pt, focusCircle.el as SVGCircleElement);
      focusCircle.el.setAttribute('tabindex', '0');
      focusCircle.el.setAttribute('data-focusable', 'point');
      focusCircle.el.setAttribute('aria-label', `${pt.date.toLocaleDateString()}: ${Math.round(pt.value)}`);
      focusCircle.el.style.cursor = "pointer";
      focusCircle.el.addEventListener("focus", () => { selected.value = pt; });
      focusCircle.el.addEventListener("blur", () => { if (selected.value === pt) selected.value = null; });
      focusCircle.el.addEventListener("pointerenter", () => { hover.value = pt; });
      focusCircle.el.addEventListener("pointerleave", () => { if (hover.value === pt) hover.value = null; });
      focusCircle.el.addEventListener("click", () => { selected.value = selected.value === pt ? null : pt; });
    }

    attachCartesianGestures(this, svgEl, {
      ctx, state: { hover, selected },
      findAtPixel: (px) => bisectFind(px, ctx.xScale.value),
      yPixel: (d) => (ctx.yScale.value as any)(d.value),
      mutateDatum: (d, delta) => mutateDatum(d, delta),
      order: () => data.value as Point[],
      focusDatum: (d) => { if (d) pointElements.get(d)?.focus(); },
    });

    const hoverX = Vec.derive(() => {
      const p = hover.value; if (!p) return { x: -10, y: -10 };
      return { x: ctx.xGet.value(p), y: ctx.plotY };
    });
    const hoverBottom = Vec.derive(() => {
      const p = hover.value; if (!p) return { x: -10, y: -10 };
      return { x: ctx.xGet.value(p), y: ctx.plotY + ctx.plotHeight };
    });
    const hoverPoint = Vec.derive(() => {
      const p = hover.value; if (!p) return { x: -10, y: -10 };
      return { x: ctx.xGet.value(p), y: ctx.yGet.value(p) };
    });
    const hoverOpacity = derive(() => (hover.value ? 1 : 0));

    const hoverCircle = s(circle(hoverPoint, this.hoverCircleRadiusCell.value, { fill: this.accentColorCell.value, stroke: this.whiteColorCell.value, strokeWidth: this.hoverStrokeWidthCell.value, opacity: hoverOpacity }));
    hoverCircle.el.style.pointerEvents = "none";
    s(line(hoverX, hoverBottom, { thin: true, dashed: true, opacity: hoverOpacity, stroke: this.hoverLineColorCell.value }));

    const selPoint = Vec.derive(() => {
      const p = selected.value; if (!p) return { x: -10, y: -10 };
      return { x: ctx.xGet.value(p), y: ctx.yGet.value(p) };
    });
    const selOpacity = derive(() => (selected.value ? 1 : 0));

    const selCircleOuter = s(circle(selPoint, this.selectedOuterRadiusCell.value, { fill: "transparent", stroke: this.whiteColorCell.value, strokeWidth: this.selectedStrokeWidthCell.value, opacity: selOpacity }));
    const selCircleInner = s(circle(selPoint, this.selectedInnerRadiusCell.value, { fill: this.whiteColorCell.value, stroke: "transparent", opacity: selOpacity }));
    selCircleOuter.el.style.pointerEvents = "none";
    selCircleInner.el.style.pointerEvents = "none";

    s(label(
      Vec.derive(() => ({ x: Wc.value / 2, y: 12 })),
      "AreaChart — hover · click to select · ←/→ navigate · ↑/↓ edit · cmd+wheel · drag marker",
      { size: 11, align: Anchor.Center, opacity: 0.7 },
    ));
  }

  protected _composeBehaviors(): void {
    const gesture = this._gesture!;
    this._behaviorDispose = setup(gesture)(transitionOnUpdated());
  }
}

customElements.define("v-br-area", MdAreaChartLC);
