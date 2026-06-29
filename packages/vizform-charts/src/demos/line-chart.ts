// LineChart — vanilla-TS port of LayerChart's LineChart wrapper.

import { Anchor, cell, circle, derive, Diagram, label, line, type Mount, Vec, vec } from "bireactive";
import { axis } from "../lib/axis";
import { chartContext } from "../lib/chart-context";
import { attachCartesianGestures, makeBisectFinder } from "../lib/cartesian-gestures";
import { spline } from "../lib/spline";
import { useHostSize, FILL_STYLE } from "../lib/host-size";

const W = 720;
const H = 360;

interface Point {
  id?: string;
  date: Date;
  value: number;
}

function makeSeries(): Point[] {
  const out: Point[] = [];
  const start = new Date(2026, 0, 1).getTime();
  const day = 86400 * 1000;
  let v = 100;
  for (let i = 0; i < 30; i++) {
    v += (Math.random() - 0.45) * 6;
    out.push({ id: String(i), date: new Date(start + i * day), value: Math.max(50, v) });
  }
  return out;
}

export class MdLineChartLC extends Diagram {
  static styles = `
    text { pointer-events: none; }
    ${FILL_STYLE}
    [data-focusable]:focus {
      outline: 2px solid #4a9eff;
      outline-offset: 2px;
    }
    [data-focusable]:focus:not(:focus-visible) {
      outline: none;
    }
  `
  readonly dataCell = cell<readonly Point[]>(makeSeries());
  set externalData(v: { date: Date; value: number }[] | undefined) {
    if (v) this.dataCell.value = v as Point[];
  }
  get externalData(): { date: Date; value: number }[] | undefined {
    return this.dataCell.value as Point[];
  }
  protected scene(s: Mount): void {
    const { w: Wc, h: Hc } = useHostSize(this, { width: W, height: H });
    this.view(Wc, Hc);
    this.tabIndex = -1; // Container not directly focusable, items are
    this.style.outline = "none";

    const data = this.dataCell;

    const ctx = chartContext<Point>({
      width: Wc, height: Hc, data,
      x: (d) => d.date, y: (d) => d.value,
      padding: { top: 16, right: 24, bottom: 36, left: 56 },
      yNice: true, yBaseline: 0,
    });

    axis(s, ctx, { placement: "bottom" });
    axis(s, ctx, { placement: "left" });
    s(spline(ctx, { stroke: "#7aaae8", strokeWidth: 2 }));

    const hover = cell<Point | null>(null);
    const selected = cell<Point | null>(null);

    const bisectFind = makeBisectFinder(data, (d) => d.date);
    const svgEl = (this as any).svg as SVGSVGElement;

    const mutateDatum = (pt: Point, delta: number) => {
      pt.value = Math.max(0, pt.value + delta);
      data.value = [...data.value];
    };

    // Create focusable invisible circles for each point
    const pointElements: SVGCircleElement[] = [];
    for (let i = 0; i < (data.value as Point[]).length; i++) {
      const pt = (data.value as Point[])[i]!;
      const pos = Vec.derive(() => ({ x: ctx.xGet.value(pt), y: ctx.yGet.value(pt) }));
      const focusCircle = s(circle(pos, 8, { fill: "transparent", stroke: "none" }));
      pointElements[i] = focusCircle.el as SVGCircleElement;
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
      elements: pointElements,
    });

    // Hover crosshair.
    const hoverX = Vec.derive(() => {
      const p = hover.value;
      if (!p) return { x: -10, y: -10 };
      return { x: ctx.xGet.value(p), y: ctx.plotY };
    });
    const hoverBottom = Vec.derive(() => {
      const p = hover.value;
      if (!p) return { x: -10, y: -10 };
      return { x: ctx.xGet.value(p), y: ctx.plotY + ctx.plotHeight };
    });
    const hoverPoint = Vec.derive(() => {
      const p = hover.value;
      if (!p) return { x: -10, y: -10 };
      return { x: ctx.xGet.value(p), y: ctx.yGet.value(p) };
    });
    const hoverOpacity = derive(() => (hover.value ? 1 : 0));

    s(
      line(hoverX, hoverBottom, { thin: true, dashed: true, opacity: hoverOpacity, stroke: "#888" }),
      circle(hoverPoint, 4, { fill: "#7aaae8", stroke: "#fff", strokeWidth: 2, opacity: hoverOpacity }),
    );

    // Selection marker.
    const selPoint = Vec.derive(() => {
      const p = selected.value;
      if (!p) return { x: -10, y: -10 };
      return { x: ctx.xGet.value(p), y: ctx.yGet.value(p) };
    });
    const selOpacity = derive(() => (selected.value ? 1 : 0));

    s(
      circle(selPoint, 6, { fill: "transparent", stroke: "#fff", strokeWidth: 2, opacity: selOpacity }),
      circle(selPoint, 3, { fill: "#fff", stroke: "transparent", opacity: selOpacity }),
    );

    s(label(
      Vec.derive(() => ({ x: Wc.value / 2, y: 12 })),
      derive(() => {
        const p = selected.value ?? hover.value;
        if (!p) return "LineChart — hover · click to select · ←/→ navigate · ↑/↓ edit · cmd+wheel · drag marker";
        return `${p.date.toLocaleDateString()}  $${p.value.toFixed(2)}`;
      }),
      { size: 11, align: Anchor.Center, opacity: 0.7 },
    ));
  }
}
