// BarChart — unified bar chart with composable display options.
// orientation: vertical | horizontal
// colorMode:   single (one accent color) | palette (per-bar PALETTE colors)
// labelMode:   axis (category labels on axis only) | inside (inside bar) | both
// valueMode:   inside (inside bar) | outside (beyond bar end) | none
// minBandSize: minimum px for a band before touch target is clamped (0 = scale freely)

import { Anchor, cell, circle, derive, Diagram, effect as biEffect, label, line, type Mount, rect, Vec, vec } from "bireactive";
import { scaleLinear, scaleBand } from "d3-scale";
import { axis } from "../lib/axis";
import { chartContext } from "../lib/chart-context";
import { wheelController, dragController } from "../lib/interaction";
import { makeBridge, type ElementWithBridge } from "../lib/hud-bridge";
import { useHostSize, FILL_STYLE, type HostSize } from "../lib/host-size";

const W = 720;
const H = 360;
const SINGLE_COLOR = "#7aaae8";
const PALETTE = ['#e08888', '#d4a86c', '#ccc060', '#7ec87e', '#60c4c0', '#7aaae8', '#b090e0', '#8899b4'];

function lightenHex(hex: string, t: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const m = (c: number) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0');
  return `#${m(r)}${m(g)}${m(b)}`;
}

interface Bar { label: string; value: number; }

function makeData(): Bar[] {
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return labels.map((l) => ({ label: l, value: Math.round(20 + Math.random() * 80) }));
}

export class MdBarChartLC extends Diagram {
  static styles = `text { pointer-events: none; }${FILL_STYLE}`

  readonly dataCell = cell<readonly Bar[]>(makeData());

  orientation: 'vertical' | 'horizontal' = 'vertical';
  colorMode: 'single' | 'palette' = 'single';
  labelMode: 'axis' | 'inside' | 'both' = 'axis';
  valueMode: 'inside' | 'outside' | 'none' = 'outside';
  minBandSize: number = 0;
  sortBy: 'index' | 'value' = 'index';

  set externalData(v: { label: string; value: number }[] | undefined) {
    if (v) this.dataCell.value = v as Bar[];
  }
  get externalData(): { label: string; value: number }[] | undefined {
    return this.dataCell.value as Bar[];
  }

  protected scene(s: Mount): void {
    const size = useHostSize(this, { width: W, height: H });
    this.view(size.w, size.h);
    this.tabIndex = 0;
    this.style.outline = "none";
    const data = this.dataCell;
    if (this.orientation === 'horizontal') {
      this.#horizontal(s, data, size);
    } else {
      this.#vertical(s, data, size);
    }
  }

  #barColor(idx: number): string {
    return this.colorMode === 'palette' ? PALETTE[idx % PALETTE.length]! : SINGLE_COLOR;
  }
  #hoverColor(idx: number): string {
    return lightenHex(this.#barColor(idx), 0.35);
  }

  #vertical(s: Mount, data: ReturnType<typeof cell<readonly Bar[]>>, { w: Wc, h: Hc }: HostSize) {
    const PAD = { top: 16, right: 24, bottom: 36, left: 48 };
    const plotX = PAD.left, plotY = PAD.top;
    const plotW = derive(() => Wc.value - PAD.left - PAD.right);
    const plotH = derive(() => Hc.value - PAD.top - PAD.bottom);

    const rows0 = data.value as Bar[];

    // xBand keyed by index — avoids stacking when multiple rows share a label.
    const xBand = derive(() =>
      scaleBand<string>()
        .domain(rows0.map((_, i) => String(i)))
        .range([plotX, plotX + plotW.value])
        .padding(0.25)
    );
    const ctx = chartContext<Bar>({
      width: Wc, height: Hc, data,
      x: d => d.label, y: d => d.value,
      padding: PAD, yNice: true, yBaseline: 0,
    });

    // Left axis always shown.
    axis(s, ctx, { placement: "left" });

    // Bottom axis — category labels (always shown in vertical).
    const ay1 = derive(() => plotY + plotH.value);
    s(line(
      Vec.derive(() => ({ x: plotX, y: ay1.value })),
      Vec.derive(() => ({ x: plotX + plotW.value, y: ay1.value })),
      { thin: true, opacity: 0.5, stroke: "#888" }
    ));
    for (let i = 0; i < rows0.length; i++) {
      const d = rows0[i]!;
      const key = String(i);
      const tx = derive(() => (xBand.value(key) ?? 0) + xBand.value.bandwidth() / 2);
      s(
        line(Vec.derive(() => ({ x: tx.value, y: ay1.value })), Vec.derive(() => ({ x: tx.value, y: ay1.value + 4 })), { thin: true, stroke: "#888", opacity: 0.6 }),
        label(Vec.derive(() => ({ x: tx.value, y: ay1.value + 16 })), d.label, { size: 10, align: Anchor.Center, fill: "#888", opacity: 0.8 }),
      );
    }

    const hover = cell<Bar | null>(null);
    const selected = cell<Bar | null>(null);
    const svgEl = (this as any).svg as SVGSVGElement;

    const localPoint = (e: PointerEvent) => {
      const r = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox?.baseVal;
      const sx = vb && vb.width ? vb.width / r.width : 1;
      const sy = vb && vb.height ? vb.height / r.height : 1;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    };
    const findAtPixel = (px: number): Bar | null => {
      const xs = xBand.value;
      const step = xs.step();
      for (let i = 0; i < rows0.length; i++) {
        const bx = xs(String(i)) ?? -1;
        if (px >= bx && px < bx + step) return rows0[i]!;
      }
      return null;
    };
    const mutateDatum = (d: Bar, delta: number) => {
      d.value = Math.max(0, d.value + delta);
      data.value = [...data.value];
    };

    const wheelConfig = {
      snapshot: (d: Bar) => d.value,
      restore: (d: Bar, v: number) => mutateDatum(d, v - d.value),
      onEnd: () => { hover.value = null; },
    };
    let dragPointerId = -1;
    const dragConfig = {
      snapshot: (d: Bar) => d.value,
      restore: (d: Bar, v: number) => mutateDatum(d, v - d.value),
      onMove: (pe: PointerEvent) => {
        const t = dragController.target as Bar | null;
        if (!t) return;
        mutateDatum(t, (ctx.yScale.value as any).invert(localPoint(pe).y) - t.value);
      },
      onEnd: () => {
        if (dragPointerId >= 0 && (this as any).hasPointerCapture?.(dragPointerId)) (this as any).releasePointerCapture(dragPointerId);
        dragPointerId = -1;
        (this as any).gestureActive = false;
      },
    };

    this.addEventListener("pointerleave", () => { if (!wheelController.active) hover.value = null; });
    this.addEventListener("click", e => {
      const pt = findAtPixel(localPoint(e as PointerEvent).x);
      selected.value = selected.value === pt ? null : pt;
    });
    this.addEventListener("wheel", e => {
      const we = e as WheelEvent;
      if (!we.ctrlKey || this.sortBy === 'value') return;
      const t = wheelController.begin(hover.value ?? selected.value, wheelConfig);
      if (!t) return;
      we.preventDefault();
      mutateDatum(t, we.deltaY < 0 ? (we.shiftKey ? 5 : 1) : (we.shiftKey ? -5 : -1));
    }, { passive: false });
    this.addEventListener("keydown", e => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") { if (selected.value != null) { selected.value = null; ke.preventDefault(); } return; }
      const rows = data.value as Bar[];
      const cur = selected.value;
      const i = cur ? rows.indexOf(cur) : -1;
      if (ke.key === "Tab" || ke.key === "ArrowRight" || ke.key === "ArrowLeft") {
        const next = (ke.key === "ArrowLeft" || (ke.key === "Tab" && ke.shiftKey))
          ? rows[(i <= 0 ? rows.length : i) - 1] ?? null : rows[(i + 1) % rows.length] ?? null;
        selected.value = next; ke.preventDefault(); return;
      }
      if (!cur || this.sortBy === 'value') return;
      const step = ke.shiftKey ? 5 : 1;
      if (ke.key === "ArrowUp") { mutateDatum(cur, +step); ke.preventDefault(); }
      else if (ke.key === "ArrowDown") { mutateDatum(cur, -step); ke.preventDefault(); }
    });
    this.addEventListener("pointerdown", e => {
      if (dragController.active || this.sortBy === 'value') return;
      const pe = e as PointerEvent;
      const { x, y } = localPoint(pe);
      const pt = findAtPixel(x);
      if (!pt) return;
      const topY = (ctx.yScale.value as any)(pt.value);
      if (Math.abs(y - topY) > 12) return;
      dragPointerId = pe.pointerId;
      selected.value = pt;
      (this as any).gestureActive = true;
      (this as any).setPointerCapture(pe.pointerId);
      dragController.begin(pt, dragConfig);
      pe.preventDefault();
    });
    this.addEventListener("pointermove", e => {
      if (dragController.active || wheelController.active) return;
      hover.value = findAtPixel(localPoint(e as PointerEvent).x);
    });

    // Column hover highlight.
    const hlTarget = derive(() => hover.value ?? selected.value);
    const hlX = derive(() => {
      const t = hlTarget.value; if (!t) return -9999;
      const i = rows0.indexOf(t);
      return i < 0 ? -9999 : (xBand.value(String(i)) ?? 0) - (xBand.value.step() - xBand.value.bandwidth()) / 2;
    });
    const hlRect = s(rect(hlX, plotY, derive(() => xBand.value.step()), derive(() => plotH.value), {
      fill: "#ffffff", opacity: derive(() => hlTarget.value ? 0.06 : 0),
    }));
    hlRect.el.style.transition = "x 0.15s ease, opacity 0.1s ease";
    hlRect.el.style.pointerEvents = "none";

    // Bars.
    for (let idx = 0; idx < rows0.length; idx++) {
      const d = rows0[idx]!;
      const key = String(idx);
      const base = this.#barColor(idx);
      const hoverColor = this.#hoverColor(idx);

      const barX = derive(() => xBand.value(key) ?? 0);
      const barW = derive(() => xBand.value.bandwidth());
      const barY = derive(() => (ctx.yScale.value as any)(d.value));
      const barH = derive(() => Math.max(0, plotY + plotH.value - barY.value));
      const fill = derive(() => selected.value === d ? "#fff" : hover.value === d ? hoverColor : base);

      const tile = s(rect(barX, barY, barW, barH, { fill, corner: 2 }));
      tile.el.style.cursor = "pointer";
      tile.el.addEventListener("pointerenter", () => { if (!wheelController.active) hover.value = d; });
      tile.el.addEventListener("pointerleave", () => { if (!wheelController.active && hover.value === d) hover.value = null; });
      tile.el.addEventListener("click", () => { selected.value = selected.value === d ? null : d; });

      const barCX = derive(() => barX.value + barW.value / 2);

      // Inside label (labelMode: inside | both).
      if (this.labelMode === 'inside' || this.labelMode === 'both') {
        const insideOpacity = derive(() => barH.value >= (this.minBandSize || 48) ? 1 : 0);
        const labelFill = derive(() => selected.value === d ? base : "#fff");
        s(label(Vec.derive(() => ({ x: barCX.value, y: barY.value + 14 })), d.label,
          { size: 10, align: Anchor.Center, fill: labelFill, opacity: insideOpacity }));
      }

      // Value label.
      if (this.valueMode !== 'none') {
        if (this.valueMode === 'inside') {
          const insideOpacity = derive(() => barH.value >= (this.minBandSize || 48) ? 1 : 0);
          const labelFill = derive(() => selected.value === d ? base : "#fff");
          s(label(Vec.derive(() => ({ x: barCX.value, y: barY.value + (this.labelMode !== 'axis' ? 28 : 14) })),
            derive(() => `${Math.round(d.value)}`),
            { size: 10, align: Anchor.Center, fill: labelFill, opacity: insideOpacity }));
        } else {
          s(label(Vec.derive(() => ({ x: barCX.value, y: barY.value - 6 })),
            derive(() => `${Math.round(d.value)}`),
            { size: 10, align: Anchor.Center, fill: "#888", opacity: derive(() => barH.value > 0 ? 1 : 0) }));
        }
      }

      // Drag handle at bar top.
      const handlePos = Vec.derive(() => ({ x: barCX.value, y: barY.value }));
      const handleOpacity = derive(() => this.sortBy !== 'value' && (hover.value === d || selected.value === d) ? 1 : 0);
      const handle = s(circle(handlePos, derive(() => selected.value === d ? 6 : 5), {
        fill: derive(() => selected.value === d ? "#fff" : hoverColor),
        stroke: "#0b0d12", strokeWidth: 1.5, opacity: handleOpacity,
      }));
      handle.el.style.cursor = "ns-resize";
      handle.el.style.transition = "opacity 0.1s";
      handle.el.addEventListener("pointerenter", () => { if (!wheelController.active) hover.value = d; });
      handle.el.addEventListener("pointerleave", () => { if (!wheelController.active && hover.value === d) hover.value = null; });
    }

    s(label(Vec.derive(() => ({ x: Wc.value / 2, y: 12 })), derive(() => {
      const p = selected.value ?? hover.value;
      if (!p) return "BarChart — hover · click · ←/→ navigate · ↑/↓ edit · ctrl+wheel · drag top";
      return `${p.label}  ${p.value}`;
    }), { size: 11, align: Anchor.Center, opacity: 0.7 }));

    this.#bridge(data, hover, selected);
  }

  #horizontal(s: Mount, data: ReturnType<typeof cell<readonly Bar[]>>, { w: Wc, h: Hc }: HostSize) {
    const PAD = { top: 16, right: 64, bottom: 16, left: 16 };
    const plotX = PAD.left, plotY = PAD.top;
    const plotW = derive(() => Wc.value - PAD.left - PAD.right);
    const plotH = derive(() => Hc.value - PAD.top - PAD.bottom);

    const rows0 = data.value as Bar[];

    // yBand keyed by index — avoids stacking when multiple rows share a label.
    const yBand = derive(() =>
      scaleBand<string>()
        .domain(rows0.map((_, i) => String(i)))
        .range([plotY, plotY + plotH.value])
        .padding(0.15)
    );
    const xLinear = derive(() => {
      const max = Math.max(1, ...(data.value as Bar[]).map(d => d.value));
      return scaleLinear().domain([0, max]).range([plotX, plotX + plotW.value]).nice();
    });

    const hover = cell<Bar | null>(null);
    const selected = cell<Bar | null>(null);
    const svgEl = (this as any).svg as SVGSVGElement;

    const localPoint = (e: PointerEvent) => {
      const r = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox?.baseVal;
      const sx = vb && vb.width ? vb.width / r.width : 1;
      const sy = vb && vb.height ? vb.height / r.height : 1;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    };
    const findAtPixelY = (py: number): Bar | null => {
      const ys = yBand.value;
      const step = ys.step();
      for (let i = 0; i < rows0.length; i++) {
        const by = ys(String(i)) ?? -1;
        if (py >= by && py < by + step) return rows0[i]!;
      }
      return null;
    };
    const mutateDatum = (d: Bar, delta: number) => {
      d.value = Math.max(0, d.value + delta);
      data.value = [...data.value];
    };

    const wheelConfig = {
      snapshot: (d: Bar) => d.value,
      restore: (d: Bar, v: number) => mutateDatum(d, v - d.value),
      onEnd: () => { hover.value = null; },
    };
    let dragPointerId = -1;
    const dragConfig = {
      snapshot: (d: Bar) => d.value,
      restore: (d: Bar, v: number) => mutateDatum(d, v - d.value),
      onMove: (pe: PointerEvent) => {
        const t = dragController.target as Bar | null;
        if (!t) return;
        mutateDatum(t, (xLinear.value as any).invert(localPoint(pe).x) - t.value);
      },
      onEnd: () => {
        if (dragPointerId >= 0 && (this as any).hasPointerCapture?.(dragPointerId)) (this as any).releasePointerCapture(dragPointerId);
        dragPointerId = -1;
        (this as any).gestureActive = false;
      },
    };

    this.addEventListener("pointerleave", () => { if (!wheelController.active) hover.value = null; });
    this.addEventListener("click", e => {
      const pt = findAtPixelY(localPoint(e as PointerEvent).y);
      selected.value = selected.value === pt ? null : pt;
    });
    this.addEventListener("wheel", e => {
      const we = e as WheelEvent;
      if (!we.ctrlKey || this.sortBy === 'value') return;
      const t = wheelController.begin(hover.value ?? selected.value, wheelConfig);
      if (!t) return;
      we.preventDefault();
      mutateDatum(t, we.deltaY < 0 ? (we.shiftKey ? 5 : 1) : (we.shiftKey ? -5 : -1));
    }, { passive: false });
    this.addEventListener("keydown", e => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") { if (selected.value != null) { selected.value = null; ke.preventDefault(); } return; }
      const rows = data.value as Bar[];
      const cur = selected.value;
      const i = cur ? rows.indexOf(cur) : -1;
      if (ke.key === "Tab" || ke.key === "ArrowDown" || ke.key === "ArrowUp") {
        const next = (ke.key === "ArrowUp" || (ke.key === "Tab" && ke.shiftKey))
          ? rows[(i <= 0 ? rows.length : i) - 1] ?? null : rows[(i + 1) % rows.length] ?? null;
        selected.value = next; ke.preventDefault(); return;
      }
      if (!cur || this.sortBy === 'value') return;
      const step = ke.shiftKey ? 5 : 1;
      if (ke.key === "ArrowRight") { mutateDatum(cur, +step); ke.preventDefault(); }
      else if (ke.key === "ArrowLeft") { mutateDatum(cur, -step); ke.preventDefault(); }
    });
    this.addEventListener("pointerdown", e => {
      if (dragController.active || this.sortBy === 'value') return;
      const pe = e as PointerEvent;
      const { x, y } = localPoint(pe);
      const pt = findAtPixelY(y);
      if (!pt) return;
      const rightX = (xLinear.value as any)(pt.value);
      if (Math.abs(x - rightX) > 12) return;
      dragPointerId = pe.pointerId;
      selected.value = pt;
      (this as any).gestureActive = true;
      (this as any).setPointerCapture(pe.pointerId);
      dragController.begin(pt, dragConfig);
      pe.preventDefault();
    });
    this.addEventListener("pointermove", e => {
      if (dragController.active || wheelController.active) return;
      hover.value = findAtPixelY(localPoint(e as PointerEvent).y);
    });

    // Row hover highlight.
    const hlTarget = derive(() => hover.value ?? selected.value);
    const hlY = derive(() => {
      const t = hlTarget.value; if (!t) return -9999;
      const i = rows0.indexOf(t);
      return i < 0 ? -9999 : (yBand.value(String(i)) ?? 0) - (yBand.value.step() - yBand.value.bandwidth()) / 2;
    });
    const hlRect = s(rect(plotX, hlY, derive(() => plotW.value), derive(() => yBand.value.step()), {
      fill: "#ffffff", opacity: derive(() => hlTarget.value ? 0.06 : 0),
    }));
    hlRect.el.style.transition = "y 0.15s ease, opacity 0.1s ease";
    hlRect.el.style.pointerEvents = "none";

    // Axis labels on left (labelMode: axis | both).
    if (this.labelMode === 'axis' || this.labelMode === 'both') {
      for (let i = 0; i < rows0.length; i++) {
        const d = rows0[i]!;
        const barCY = derive(() => (yBand.value(String(i)) ?? 0) + yBand.value.bandwidth() / 2);
        s(label(Vec.derive(() => ({ x: plotX - 6, y: barCY.value })), d.label,
          { size: 11, align: Anchor.Right, fill: "#888", opacity: 0.8 }));
      }
    }

    // Bars.
    for (let idx = 0; idx < rows0.length; idx++) {
      const d = rows0[idx]!;
      const key = String(idx);
      const base = this.#barColor(idx);
      const hoverColor = this.#hoverColor(idx);

      const barY = derive(() => yBand.value(key) ?? 0);
      const barH = derive(() => yBand.value.bandwidth());
      const barW = derive(() => Math.max(0, (xLinear.value as any)(d.value) - plotX));
      const fill = derive(() => selected.value === d ? "#fff" : hover.value === d ? hoverColor : base);
      const labelFill = derive(() => selected.value === d ? base : "#fff");

      const tile = s(rect(plotX, barY, barW, barH, { fill, corner: 3 }));
      tile.el.style.cursor = "pointer";
      tile.el.addEventListener("pointerenter", () => { if (!wheelController.active) hover.value = d; });
      tile.el.addEventListener("pointerleave", () => { if (!wheelController.active && hover.value === d) hover.value = null; });
      tile.el.addEventListener("click", () => { selected.value = selected.value === d ? null : d; });

      const barCY = derive(() => barY.value + barH.value / 2);
      const minBand = this.minBandSize || 60;

      // Inside label (labelMode: inside | both).
      if (this.labelMode === 'inside' || this.labelMode === 'both') {
        const insideOpacity = derive(() => barW.value >= minBand ? 1 : 0);
        s(label(Vec.derive(() => ({ x: plotX + 8, y: barCY.value })), d.label,
          { size: 11, align: Anchor.Left, fill: labelFill, opacity: insideOpacity }));
      }

      // Value label.
      if (this.valueMode !== 'none') {
        if (this.valueMode === 'inside') {
          const insideOpacity = derive(() => barW.value >= minBand ? 1 : 0);
          s(label(Vec.derive(() => ({ x: plotX + barW.value - 8, y: barCY.value })),
            derive(() => `${Math.round(d.value)}`),
            { size: 11, align: Anchor.Right, fill: labelFill, opacity: insideOpacity }));
          // Fallback value outside when bar too short.
          const outsideOpacity = derive(() => barW.value < minBand ? 1 : 0);
          s(label(Vec.derive(() => ({ x: plotX + barW.value + 6, y: barCY.value })),
            derive(() => `${Math.round(d.value)}`),
            { size: 11, align: Anchor.Left, fill: "#aaa", opacity: outsideOpacity }));
        } else {
          s(label(Vec.derive(() => ({ x: plotX + barW.value + 6, y: barCY.value })),
            derive(() => `${Math.round(d.value)}`),
            { size: 11, align: Anchor.Left, fill: "#888", opacity: derive(() => barW.value > 0 ? 1 : 0) }));
        }
      }

      // Drag handle at bar right end.
      const handlePos = Vec.derive(() => ({ x: plotX + barW.value, y: barCY.value }));
      const handleOpacity = derive(() => this.sortBy !== 'value' && (hover.value === d || selected.value === d) ? 1 : 0);
      const handle = s(circle(handlePos, derive(() => selected.value === d ? 6 : 5), {
        fill: derive(() => selected.value === d ? "#fff" : hoverColor),
        stroke: "#0b0d12", strokeWidth: 1.5, opacity: handleOpacity,
      }));
      handle.el.style.cursor = "ew-resize";
      handle.el.style.transition = "opacity 0.1s";
      handle.el.addEventListener("pointerenter", () => { if (!wheelController.active) hover.value = d; });
      handle.el.addEventListener("pointerleave", () => { if (!wheelController.active && hover.value === d) hover.value = null; });
    }

    s(label(Vec.derive(() => ({ x: Wc.value / 2, y: 8 })), derive(() => {
      const p = selected.value ?? hover.value;
      if (!p) return "Bands — hover · click · ↑/↓ navigate · ←/→ edit · ctrl+wheel · drag end";
      return `${p.label}  ${p.value}`;
    }), { size: 11, align: Anchor.Center, opacity: 0.7 }));

    this.#bridge(data, hover, selected);
  }

  #bridge(data: ReturnType<typeof cell<readonly Bar[]>>, hover: ReturnType<typeof cell<Bar | null>>, selected: ReturnType<typeof cell<Bar | null>>) {
    const ORDER = data.value as Bar[];
    const idxOf = (d: Bar | null) => { if (d == null) return null; const i = ORDER.indexOf(d); return i < 0 ? null : String(i); };
    const datumAt = (key: string | null) => { if (key == null) return null; const i = Number(key); return Number.isInteger(i) && i >= 0 && i < ORDER.length ? ORDER[i]! : null; };
    let applying = false;
    const bridge = makeBridge({
      setHover: key => { applying = true; hover.value = datumAt(key); applying = false; },
      setSelect: key => { applying = true; selected.value = datumAt(key); applying = false; },
    });
    (this as unknown as ElementWithBridge).brSync = bridge;
    biEffect(() => { if (!applying) bridge.emitHover(idxOf(hover.value)); });
    biEffect(() => { if (!applying) bridge.emitSelect(idxOf(selected.value)); });
  }
}
