// ScatterChart — vanilla-TS port of LayerChart's ScatterChart wrapper.
//
// Migrated from Diagram to CartesianChartBase. Uses the shared SVG surface,
// host size, and anim clock. Gestures via attachCartesianGestures (custom,
// not the shared wheelEdit/keyboardEdit behaviors — scatter has no value
// editing, only hover/select/navigate).

import { cell, circle, derive, effect as biEffect, label, Vec } from "bireactive";
import { CartesianChartBase, type FlatItem } from "../cartesian/cartesian-chart-base";
import { axis } from "../lib/axis";
import { chartContext } from "../lib/chart-context";
import { attachCartesianGestures, makeBisectFinder } from "../lib/cartesian-gestures";
import { FILL_STYLE } from "../lib/host-size";
import { setup } from "../hierarchical/gesture";
import { transitionOnUpdated } from "../hierarchical/behaviors/transition-on-updated";

const W = 720;
const H = 360;
const COLOR = "#7aaae8";

interface Point extends FlatItem { x: number; y: number; }

function makeData(): Point[] {
  return Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    label: String(i),
    x: i * 2.5 + (Math.random() - 0.5) * 2,
    y: 20 + i * 1.8 + (Math.random() - 0.5) * 20,
  })).sort((a, b) => a.x - b.x);
}

const SCATTER_CSS = `
text { pointer-events: none; }
${FILL_STYLE}
[data-focusable]:focus { outline: 2px solid #4a9eff; outline-offset: 2px; }
[data-focusable]:focus:not(:focus-visible) { outline: none; }
`;
let scatterCssInjected = false;
function ensureScatterCss() {
  if (typeof document === "undefined" || scatterCssInjected) return;
  scatterCssInjected = true;
  const style = document.createElement("style");
  style.id = "vf-scatter-chart";
  style.textContent = SCATTER_CSS;
  document.head.appendChild(style);
}

export class MdScatterChartLC extends CartesianChartBase {
  readonly dataCell = cell<readonly Point[]>(makeData());

  private _xBindingCell = cell<(d: Point) => number>((d) => d.x);
  private _yBindingCell = cell<(d: Point) => number>((d) => d.y);

  get xBinding(): string { return (this as any)._xBindingName ?? '_index' }
  set xBinding(v: string) {
    const prev = (this as any)._xBindingName;
    (this as any)._xBindingName = v;
    if (prev !== v) this._xBindingCell.value = (d: Point) => d.x;
  }

  get yBinding(): string { return (this as any)._yBindingName ?? 'y' }
  set yBinding(v: string) {
    const prev = (this as any)._yBindingName;
    (this as any)._yBindingName = v;
    if (prev !== v) this._yBindingCell.value = (d: Point) => d.y;
  }

  get measureKey(): string { return this.yBinding }
  set measureKey(v: string) { this.yBinding = v }
  get xKey(): string { return this.xBinding }
  set xKey(v: string) { this.xBinding = v }

  set externalData(v: { x: number; y: number }[] | undefined) {
    if (!v) return;
    // Mutate existing items IN PLACE rather than swapping in new objects.
    // The dots and per-datum tween cells are created once (points0) and hold
    // direct references to the initial point objects; replacing the array
    // with fresh objects orphans those references so the chart never updates
    // when the x/y binding dropdown re-feeds data. Mutating in place keeps
    // the captured references valid — the accessor (d) => d.x / (d) => d.y
    // then reads the new values and the tween gate fires on binding change.
    const cur = this.dataCell.peek() as Point[];
    if (cur.length === v.length) {
      for (let i = 0; i < v.length; i++) {
        cur[i].x = v[i].x;
        cur[i].y = v[i].y;
      }
      this.dataCell.value = [...cur];
    } else {
      this.dataCell.value = v as Point[];
    }
  }
  get externalData(): { x: number; y: number }[] | undefined {
    return this.dataCell.value as Point[];
  }

  connectedCallback() {
    super.connectedCallback();
    if (!this._configCell.value) {
      this._configCell.value = { sort: "index", conservationMode: "additive" };
    }
  }

  protected _setupRendering(): void {
    ensureScatterCss();
    const s = this._s;
    const { w: Wc, h: Hc } = this._hostSize!;
    this._setViewBox(Wc.value, Hc.value);
    this.tabIndex = -1;
    this.style.outline = "none";

    const data = this.dataCell;

    // Sync dataCell → base _dataCell.
    this._setupDisposers.push(biEffect(() => { this._dataCell.value = this.dataCell.value; }));

    const ctx = chartContext<Point>({
      width: Wc, height: Hc, data,
      x: this._xBindingCell as any,
      y: this._yBindingCell as any,
      idOf: (d) => d.id ?? String(data.peek().indexOf(d)),
      host: this,
      anim: this.anim,
      padding: { top: 16, right: 24, bottom: 36, left: 48 },
      xNice: true, yNice: true, yBaseline: 0,
    });

    axis(s, ctx, { placement: "bottom" });
    axis(s, ctx, { placement: "left" });

    const hover = cell<Point | null>(null);
    const selected = cell<Point | null>(null);

    const bisectFind = makeBisectFinder(data, (d) => d.x);
    const svgEl = this._svg!;

    const mutateDatum = (pt: Point, delta: number) => {
      pt.y = Math.max(0, pt.y + delta);
      data.value = [...data.value];
    };

    const points0 = data.peek() as Point[];
    const dotElements = new Map<Point, SVGCircleElement>();
    for (const d of points0) {
      const pos = Vec.derive(() => ({ x: ctx.xGet.value(d), y: ctx.yGet.value(d) }));
      const fill = derive(() =>
        selected.value === d ? "#fff" : hover.value === d ? "#a4c0f0" : COLOR,
      );
      const dot = s(circle(pos, 5, { fill, stroke: "#0b0d12", strokeWidth: 1 }));
      dotElements.set(d, dot.el as SVGCircleElement);
      dot.el.setAttribute('tabindex', '0');
      dot.el.setAttribute('data-focusable', 'point');
      dot.el.setAttribute('aria-label', `x: ${d.x.toFixed(1)}, y: ${d.y.toFixed(1)}`);
      dot.el.addEventListener("pointerenter", () => { hover.value = d; });
      dot.el.addEventListener("pointerleave", () => { if (hover.value === d) hover.value = null; });
      dot.el.addEventListener("click", () => { selected.value = selected.value === d ? null : d; });
      dot.el.addEventListener("focus", () => { selected.value = d; });
      dot.el.addEventListener("blur", () => { if (selected.value === d) selected.value = null; });
    }

    attachCartesianGestures(this, svgEl, {
      ctx, state: { hover, selected },
      findAtPixel: (px) => bisectFind(px, ctx.xScale.value),
      yPixel: (d) => (ctx.yScale.value as any)(d.y),
      mutateDatum: (d, delta) => mutateDatum(d, delta),
      order: () => data.value as Point[],
      focusDatum: (d) => { if (d) dotElements.get(d)?.focus(); },
    });

    const selPos = Vec.derive(() => {
      const p = selected.value;
      if (!p) return { x: -10, y: -10 };
      return { x: ctx.xGet.value(p), y: ctx.yGet.value(p) };
    });
    const selOpacity = derive(() => (selected.value ? 1 : 0));
    s(circle(selPos, 9, { fill: "transparent", stroke: "#fff", strokeWidth: 2, opacity: selOpacity }));

    s(label(Vec.derive(() => ({ x: Wc.value / 2, y: 12 })), "Scatter"));
  }

  protected _composeBehaviors(): void {
    // Scatter uses attachCartesianGestures (custom), not shared behaviors.
    // Just install transitionOnUpdated for CSS transitions on settle.
    const gesture = this._gesture!;
    this._behaviorDispose = setup(gesture)(transitionOnUpdated());
  }
}

customElements.define("v-br-scatter", MdScatterChartLC);
