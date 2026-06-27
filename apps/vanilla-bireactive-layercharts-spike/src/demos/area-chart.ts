// AreaChart — vanilla-TS port of LayerChart's AreaChart wrapper.

import { Anchor, cell, circle, derive, Diagram, label, line, type Mount, Vec, vec } from "bireactive";
import { curveMonotoneX } from "d3-shape";
import { area } from "../lib/area";
import { axis } from "../lib/axis";
import { chartContext } from "../lib/chart-context";
import { attachCartesianGestures, makeBisectFinder } from "../lib/cartesian-gestures";
import { spline } from "../lib/spline";
import { useHostSize, FILL_STYLE } from "../lib/host-size";

const W = 720;
const H = 360;

interface Point {
  date: Date;
  value: number;
}

function makeSeries(): Point[] {
  const out: Point[] = [];
  const start = new Date(2026, 0, 1).getTime();
  const day = 86400 * 1000;
  let v = 60;
  for (let i = 0; i < 30; i++) {
    v += (Math.random() - 0.4) * 8;
    out.push({ date: new Date(start + i * day), value: Math.max(20, v) });
  }
  return out;
}

export class MdAreaChartLC extends Diagram {
  static styles = `text { pointer-events: none; }${FILL_STYLE}`
  readonly dataCell = cell<readonly Point[]>(makeSeries());
  sortBy: 'index' | 'value' = 'index';
  set externalData(v: { date: Date; value: number }[] | undefined) {
    if (v) this.dataCell.value = v as Point[];
  }
  get externalData(): { date: Date; value: number }[] | undefined {
    return this.dataCell.value as Point[];
  }
  protected scene(s: Mount): void {
    const { w: Wc, h: Hc } = useHostSize(this, { width: W, height: H });
    this.view(Wc, Hc);
    this.tabIndex = 0;
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
    s(area(ctx, { fill: "#7aaae8", fillOpacity: 0.25, curve: curveMonotoneX }));
    s(spline(ctx, { stroke: "#7aaae8", strokeWidth: 2, curve: curveMonotoneX }));

    const hover = cell<Point | null>(null);
    const selected = cell<Point | null>(null);

    const bisectFind = makeBisectFinder(data, (d) => d.date);
    const svgEl = (this as any).svg as SVGSVGElement;

    const mutateDatum = (pt: Point, delta: number) => {
      pt.value = Math.max(0, pt.value + delta);
      data.value = [...data.value];
    };

    attachCartesianGestures(this, svgEl, {
      ctx, state: { hover, selected },
      findAtPixel: (px) => bisectFind(px, ctx.xScale.value),
      yPixel: (d) => (ctx.yScale.value as any)(d.value),
      mutateDatum: (d, delta) => mutateDatum(d, delta),
      order: () => data.value as Point[],
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
        if (!p) return "AreaChart — hover · click to select · ←/→ navigate · ↑/↓ edit · cmd+wheel · drag";
        return `${p.date.toLocaleDateString()}  $${p.value.toFixed(2)}`;
      }),
      { size: 11, align: Anchor.Center, opacity: 0.7 },
    ));
  }
}
