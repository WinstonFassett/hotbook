// LineChart — vanilla-TS port of LayerChart's LineChart wrapper.
//
// Migrated from Diagram to CartesianChartBase. Uses the shared SVG surface,
// host size, and anim clock. Gestures via attachCartesianGestures.

import { Anchor, cell, circle, derive, effect as biEffect, label, line, Vec } from "bireactive";
import { CartesianChartBase, type FlatItem } from "../cartesian/cartesian-chart-base";
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
  let v = 100;
  for (let i = 0; i < 30; i++) {
    v += (Math.random() - 0.45) * 6;
    out.push({ id: String(i), label: String(i), date: new Date(start + i * day), value: Math.max(50, v) });
  }
  return out;
}

const LINE_CSS = `
text { pointer-events: none; }
${FILL_STYLE}
[data-focusable]:focus { outline: 2px solid #4a9eff; outline-offset: 2px; }
[data-focusable]:focus:not(:focus-visible) { outline: none; }
`;
let lineCssInjected = false;
function ensureLineCss() {
  if (typeof document === "undefined" || lineCssInjected) return;
  lineCssInjected = true;
  const style = document.createElement("style");
  style.id = "vf-line-chart";
  style.textContent = LINE_CSS;
  document.head.appendChild(style);
}

export class MdLineChartLC extends CartesianChartBase {
  readonly dataCell = cell<readonly Point[]>(makeSeries());

  private _yBindingCell = cell<(d: Point) => number>((d) => d.value);

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
    ensureLineCss();
    const s = this._s;
    const { w: Wc, h: Hc } = this._hostSize!;
    this._setViewBox(Wc.value, Hc.value);
    this.tabIndex = -1;
    this.style.outline = "none";

    const data = this.dataCell;
    this._setupDisposers.push(biEffect(() => { this._dataCell.value = this.dataCell.value; }));

    const ctx = chartContext<Point>({
      width: Wc, height: Hc, data,
      x: (d) => d.date,
      y: this._yBindingCell as any,
      idOf: (d) => d.id ?? String(d.date.getTime()),
      host: this,
      anim: this.anim,
      padding: { top: 16, right: 24, bottom: 36, left: 56 },
      yNice: true, yBaseline: 0,
    });

    axis(s, ctx, { placement: "bottom" });
    axis(s, ctx, { placement: "left" });
    s(spline(ctx, { stroke: "#7aaae8", strokeWidth: 2 }));

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
      const focusCircle = s(circle(pos, 8, { fill: "transparent", stroke: "none" }));
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

    const hoverCircle = s(circle(hoverPoint, 4, { fill: "#7aaae8", stroke: "#fff", strokeWidth: 2, opacity: hoverOpacity }));
    hoverCircle.el.style.pointerEvents = "none";
    s(line(hoverX, hoverBottom, { thin: true, dashed: true, opacity: hoverOpacity, stroke: "#888" }));

    const selPoint = Vec.derive(() => {
      const p = selected.value; if (!p) return { x: -10, y: -10 };
      return { x: ctx.xGet.value(p), y: ctx.yGet.value(p) };
    });
    const selOpacity = derive(() => (selected.value ? 1 : 0));

    const selCircleOuter = s(circle(selPoint, 6, { fill: "transparent", stroke: "#fff", strokeWidth: 2, opacity: selOpacity }));
    const selCircleInner = s(circle(selPoint, 3, { fill: "#fff", stroke: "transparent", opacity: selOpacity }));
    selCircleOuter.el.style.pointerEvents = "none";
    selCircleInner.el.style.pointerEvents = "none";

    s(label(
      Vec.derive(() => ({ x: Wc.value / 2, y: 12 })),
      "LineChart — hover · click to select · ←/→ navigate · ↑/↓ edit · cmd+wheel · drag marker",
      { size: 11, align: Anchor.Center, opacity: 0.7 },
    ));
  }

  protected _composeBehaviors(): void {
    const gesture = this._gesture!;
    this._behaviorDispose = setup(gesture)(transitionOnUpdated());
  }
}

customElements.define("v-br-line", MdLineChartLC);
