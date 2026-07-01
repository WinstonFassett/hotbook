// ScatterChart — vanilla-TS port of LayerChart's ScatterChart wrapper.

import { Anchor, cell, circle, derive, Diagram, easeInOut, effect as biEffect, label, type Mount, num, tween, Vec, vec } from "bireactive";
import { axis } from "../lib/axis";
import { chartContext } from "../lib/chart-context";
import { attachCartesianGestures, makeBisectFinder } from "../lib/cartesian-gestures";
import { useHostSize, FILL_STYLE } from "../lib/host-size";

const W = 720;
const H = 360;
const COLOR = "#7aaae8";

interface Point {
  id?: string;
  x: number;
  y: number;
}

function makeData(): Point[] {
  return Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    x: i * 2.5 + (Math.random() - 0.5) * 2,
    y: 20 + i * 1.8 + (Math.random() - 0.5) * 20,
  })).sort((a, b) => a.x - b.x);
}

export class MdScatterChartLC extends Diagram {
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
  readonly dataCell = cell<readonly Point[]>(makeData());
  set externalData(v: { x: number; y: number }[] | undefined) {
    if (v) this.dataCell.value = v as Point[];
  }
  get externalData(): { x: number; y: number }[] | undefined {
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
      x: (d) => d.x, y: (d) => d.y,
      padding: { top: 16, right: 24, bottom: 36, left: 48 },
      xNice: true, yNice: true, yBaseline: 0,
    });

    axis(s, ctx, { placement: "bottom" });
    axis(s, ctx, { placement: "left" });

    // Per-point x-pixel tween cells — on sort, reindex updates d.x, tween slides.
    const xPxCells = new Map<Point, ReturnType<typeof num>>();
    for (const pt of data.value as Point[]) {
      const xTarget = derive(() => ctx.xGet.value(pt));
      const xPx = num(xTarget.value);
      xPxCells.set(pt, xPx);
      let xCancel: (() => void) | null = null;
      let xInited = false;
      biEffect(() => {
        const target = xTarget.value;
        if (!xInited) { xInited = true; xPx.value = target; return; }
        if ((this as any).gestureActive) {
          xCancel?.(); xCancel = null;
          xPx.value = target;
        } else {
          xCancel?.();
          xCancel = this.anim.start(tween(xPx, target, 0.25, easeInOut) as any);
        }
      });
    }

    const hover = cell<Point | null>(null);
    const selected = cell<Point | null>(null);

    const bisectFind = makeBisectFinder(data, (d) => d.x);
    const svgEl = (this as any).svg as SVGSVGElement;

    const mutateDatum = (pt: Point, delta: number) => {
      pt.y = Math.max(0, pt.y + delta);
      data.value = [...data.value];
    };

    // Draw dots with focusable support — positions from tweened x.
    const dotElements = new Map<Point, SVGCircleElement>();
    for (const d of data.value as Point[]) {
      const pos = Vec.derive(() => ({ x: xPxCells.get(d)?.value ?? 0, y: ctx.yGet.value(d) }));
      const fill = derive(() =>
        selected.value === d ? "#fff" : hover.value === d ? "#a4c0f0" : COLOR
      );
      const dot = s(circle(pos, 5, { fill, stroke: "#0b0d12", strokeWidth: 1 }));
      dotElements.set(d, dot.el as SVGCircleElement);
      // Make each dot individually focusable
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

    // Selection ring — uses tweened x.
    const selPos = Vec.derive(() => {
      const p = selected.value;
      if (!p) return { x: -10, y: -10 };
      return { x: xPxCells.get(p)?.value ?? -10, y: ctx.yGet.value(p) };
    });
    const selOpacity = derive(() => (selected.value ? 1 : 0));
    s(
      circle(selPos, 9, { fill: "transparent", stroke: "#fff", strokeWidth: 2, opacity: selOpacity }),
    );

    s(label(
      Vec.derive(() => ({ x: Wc.value / 2, y: 12 })),
      derive(() => {
        const p = selected.value ?? hover.value;
        if (!p) return "ScatterChart — hover · click · ←/→ navigate · ↑/↓ edit y · cmd+wheel · drag";
        return `x: ${p.x.toFixed(1)}  y: ${p.y.toFixed(1)}`;
      }),
      { size: 11, align: Anchor.Center, opacity: 0.7 },
    ));
  }
}
