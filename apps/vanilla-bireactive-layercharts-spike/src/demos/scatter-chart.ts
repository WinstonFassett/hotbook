// ScatterChart — vanilla-TS port of LayerChart's ScatterChart wrapper.

import { Anchor, cell, circle, derive, Diagram, label, type Mount, Vec, vec } from "bireactive";
import { axis } from "../lib/axis";
import { chartContext } from "../lib/chart-context";
import { attachCartesianGestures, makeBisectFinder } from "../lib/cartesian-gestures";

const W = 720;
const H = 360;
const COLOR = "#7aaae8";

interface Point {
  x: number;
  y: number;
}

function makeData(): Point[] {
  return Array.from({ length: 40 }, (_, i) => ({
    x: i * 2.5 + (Math.random() - 0.5) * 2,
    y: 20 + i * 1.8 + (Math.random() - 0.5) * 20,
  })).sort((a, b) => a.x - b.x);
}

export class MdScatterChartLC extends Diagram {
  static styles = `text { pointer-events: none; }`
  readonly dataCell = cell<readonly Point[]>(makeData());
  set externalData(v: { x: number; y: number }[] | undefined) {
    if (v) this.dataCell.value = v as Point[];
  }
  get externalData(): { x: number; y: number }[] | undefined {
    return this.dataCell.value as Point[];
  }
  protected scene(s: Mount): void {
    this.view(W, H);
    this.tabIndex = 0;
    this.style.outline = "none";

    const data = this.dataCell;

    const ctx = chartContext<Point>({
      width: W, height: H, data,
      x: (d) => d.x, y: (d) => d.y,
      padding: { top: 16, right: 24, bottom: 36, left: 48 },
      xNice: true, yNice: true, yBaseline: 0,
    });

    axis(s, ctx, { placement: "bottom" });
    axis(s, ctx, { placement: "left" });

    const hover = cell<Point | null>(null);
    const selected = cell<Point | null>(null);

    const bisectFind = makeBisectFinder(data, (d) => d.x);
    const svgEl = (this as any).svg as SVGSVGElement;

    const mutateDatum = (pt: Point, delta: number) => {
      pt.y = Math.max(0, pt.y + delta);
      data.value = [...data.value];
    };

    attachCartesianGestures(this, svgEl, {
      ctx, state: { hover, selected },
      findAtPixel: (px) => bisectFind(px, ctx.xScale.value),
      yPixel: (d) => (ctx.yScale.value as any)(d.y),
      mutateDatum: (d, delta) => mutateDatum(d, delta),
      order: () => data.value as Point[],
    });

    // Draw dots.
    for (const d of data.value as Point[]) {
      const pos = Vec.derive(() => ({ x: ctx.xGet.value(d), y: ctx.yGet.value(d) }));
      const fill = derive(() =>
        selected.value === d ? "#fff" : hover.value === d ? "#a4c0f0" : COLOR
      );
      const dot = s(circle(pos, 5, { fill, stroke: "#0b0d12", strokeWidth: 1 }));
      dot.el.style.cursor = "pointer";
      dot.el.addEventListener("pointerenter", () => { hover.value = d; });
      dot.el.addEventListener("pointerleave", () => { if (hover.value === d) hover.value = null; });
      dot.el.addEventListener("click", () => { selected.value = selected.value === d ? null : d; });
    }

    // Selection ring.
    const selPos = Vec.derive(() => {
      const p = selected.value;
      if (!p) return { x: -10, y: -10 };
      return { x: ctx.xGet.value(p), y: ctx.yGet.value(p) };
    });
    const selOpacity = derive(() => (selected.value ? 1 : 0));
    s(
      circle(selPos, 9, { fill: "transparent", stroke: "#fff", strokeWidth: 2, opacity: selOpacity }),
    );

    s(label(
      vec(W / 2, 12),
      derive(() => {
        const p = selected.value ?? hover.value;
        if (!p) return "ScatterChart — hover · click · ←/→ navigate · ↑/↓ edit y · cmd+wheel · drag";
        return `x: ${p.x.toFixed(1)}  y: ${p.y.toFixed(1)}`;
      }),
      { size: 11, align: Anchor.Center, opacity: 0.7 },
    ));
  }
}
