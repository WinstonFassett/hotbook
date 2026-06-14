// LineChart — vanilla-TS port of LayerChart's LineChart wrapper.
// v2: hover crosshair, click-to-select, edit slice (wheel / arrow keys / drag).

import { Anchor, cell, circle, derive, Diagram, label, line, type Mount, Vec, vec } from "bireactive";
import { bisector } from "d3-array";
import { axis } from "../lib/axis";
import { chartContext } from "../lib/chart-context";
import { spline } from "../lib/spline";
import { installGestureRelease } from "../lib/interaction";

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
  let v = 100;
  for (let i = 0; i < 30; i++) {
    v += (Math.random() - 0.45) * 6;
    out.push({ date: new Date(start + i * day), value: Math.max(50, v) });
  }
  return out;
}

export class MdLineChartLC extends Diagram {
  protected scene(s: Mount): void {
    this.view(W, H);
    this.tabIndex = 0;
    this.style.outline = "none";

    const series = makeSeries();
    const data = cell<readonly Point[]>(series);

    const ctx = chartContext<Point>({
      width: W,
      height: H,
      data,
      x: (d) => d.date,
      y: (d) => d.value,
      padding: { top: 16, right: 24, bottom: 36, left: 56 },
      yNice: true,
      yBaseline: 0,
    });

    axis(s, ctx, { placement: "bottom" });
    axis(s, ctx, { placement: "left" });
    s(spline(ctx, { stroke: "#5b8def", strokeWidth: 2 }));

    // Hover + selection state.
    const hover = cell<Point | null>(null);
    const selected = cell<Point | null>(null);

    const xBisect = bisector<Point, Date>((d) => d.date).center;

    const svgEl = (this as any).svg as SVGSVGElement;
    const localPoint = (e: PointerEvent): { x: number; y: number } => {
      const rect = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox?.baseVal;
      const sx = vb && vb.width ? vb.width / rect.width : 1;
      const sy = vb && vb.height ? vb.height / rect.height : 1;
      return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
    };

    const findAtPixel = (px: number): Point | null => {
      const rows = data.value;
      if (rows.length === 0) return null;
      const xs: any = ctx.xScale.value;
      const dateAtPx = xs.invert?.(px);
      if (!dateAtPx) return null;
      const i = xBisect(rows as Point[], dateAtPx as Date);
      return rows[Math.max(0, Math.min(rows.length - 1, i))] ?? null;
    };

    // Wheel lock: which point is being scrolled (held until modifier released).
    const wheelLocked = { current: null as Point | null };
    installGestureRelease(() => { wheelLocked.current = null; });

    const mutateDatum = (pt: Point, delta: number) => {
      pt.value = Math.max(0, pt.value + delta);
      // Nudge the cell so derived scales / spline re-derive.
      data.value = [...data.value];
    };

    this.addEventListener("pointerleave", () => {
      hover.value = null;
    });
    this.addEventListener("click", (e) => {
      const { x } = localPoint(e as PointerEvent);
      if (x < ctx.plotX || x > ctx.plotX + ctx.plotWidth) return;
      const pt = findAtPixel(x);
      selected.value = selected.value === pt ? null : pt;
    });

    // cmd/ctrl+wheel → edit hovered or selected datum.
    this.addEventListener("wheel", (e) => {
      const we = e as WheelEvent;
      if (!(we.metaKey || we.ctrlKey)) return;
      if (!wheelLocked.current) wheelLocked.current = hover.value ?? selected.value;
      const target = wheelLocked.current;
      if (!target) return;
      we.preventDefault();
      const step = we.shiftKey ? 5 : 1;
      mutateDatum(target, we.deltaY < 0 ? +step : -step);
    }, { passive: false });

    this.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        selected.value = null;
        e.preventDefault();
        return;
      }
      const rows = data.value as Point[];
      if (rows.length === 0) return;
      const cur = selected.value;
      const i = cur ? rows.indexOf(cur) : -1;
      if (e.key === "Tab") {
        selected.value = e.shiftKey
          ? rows[(i <= 0 ? rows.length : i) - 1] ?? null
          : rows[(i + 1) % rows.length] ?? null;
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowRight") {
        selected.value = rows[(i + 1) % rows.length] ?? null;
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowLeft") {
        selected.value = rows[(i <= 0 ? rows.length : i) - 1] ?? null;
        e.preventDefault();
        return;
      }
      // ArrowUp/Down edit the selected datum's value.
      if (!cur) return;
      const step = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowUp") {
        mutateDatum(cur, +step);
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        mutateDatum(cur, -step);
        e.preventDefault();
      }
    });

    // Drag the selected marker vertically to edit its value.
    let dragTarget: Point | null = null;
    this.addEventListener("pointerdown", (e) => {
      const pe = e as PointerEvent;
      const { x, y } = localPoint(pe);
      if (x < ctx.plotX || x > ctx.plotX + ctx.plotWidth) return;
      const pt = findAtPixel(x);
      if (!pt) return;
      const ys = ctx.yScale.value as any;
      const py = ys(pt.value);
      if (Math.abs(y - py) > 12) return; // only drag if near the spline
      dragTarget = pt;
      selected.value = pt;
      (this as any).setPointerCapture(pe.pointerId);
      pe.preventDefault();
    });
    this.addEventListener("pointermove", (e) => {
      const pe = e as PointerEvent;
      if (dragTarget) {
        const { y } = localPoint(pe);
        const ys = ctx.yScale.value as any;
        const newVal = ys.invert(y);
        mutateDatum(dragTarget, newVal - dragTarget.value);
        return;
      }
      const { x } = localPoint(pe);
      if (x < ctx.plotX || x > ctx.plotX + ctx.plotWidth) {
        hover.value = null;
        return;
      }
      hover.value = findAtPixel(x);
    });
    this.addEventListener("pointerup", () => { dragTarget = null; });
    this.addEventListener("pointercancel", () => { dragTarget = null; });

    // Hover crosshair (vertical rule + circle).
    const hoverX = Vec.derive(() => {
      const p = hover.value;
      if (!p) return { x: -10, y: -10 };
      const gx = ctx.xGet.value;
      return { x: gx(p), y: ctx.plotY };
    });
    const hoverBottom = Vec.derive(() => {
      const p = hover.value;
      if (!p) return { x: -10, y: -10 };
      const gx = ctx.xGet.value;
      return { x: gx(p), y: ctx.plotY + ctx.plotHeight };
    });
    const hoverPoint = Vec.derive(() => {
      const p = hover.value;
      if (!p) return { x: -10, y: -10 };
      return { x: ctx.xGet.value(p), y: ctx.yGet.value(p) };
    });
    const hoverOpacity = derive(() => (hover.value ? 1 : 0));

    s(
      line(hoverX, hoverBottom, {
        thin: true,
        dashed: true,
        opacity: hoverOpacity,
        stroke: "#888",
      }),
      circle(hoverPoint, 4, {
        fill: "#5b8def",
        stroke: "#fff",
        strokeWidth: 2,
        opacity: hoverOpacity,
      }),
    );

    // Selection marker (filled ring).
    const selPoint = Vec.derive(() => {
      const p = selected.value;
      if (!p) return { x: -10, y: -10 };
      return { x: ctx.xGet.value(p), y: ctx.yGet.value(p) };
    });
    const selOpacity = derive(() => (selected.value ? 1 : 0));

    s(
      circle(selPoint, 6, {
        fill: "transparent",
        stroke: "#fff",
        strokeWidth: 2,
        opacity: selOpacity,
      }),
      circle(selPoint, 3, {
        fill: "#fff",
        stroke: "transparent",
        opacity: selOpacity,
      }),
    );

    s(
      label(
        vec(W / 2, 12),
        derive(() => {
          const p = selected.value ?? hover.value;
          if (!p) return "LineChart — hover · click to select · ←/→ navigate · ↑/↓ edit · cmd+wheel · drag marker";
          return `${p.date.toLocaleDateString()}  $${p.value.toFixed(2)}`;
        }),
        { size: 11, align: Anchor.Center, opacity: 0.7 },
      ),
    );
  }
}
