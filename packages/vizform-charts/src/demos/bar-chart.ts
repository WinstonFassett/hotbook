// BarChart — unified bar chart with composable display options.
// orientation: vertical | horizontal
// colorMode:   single (one accent color) | palette (per-bar PALETTE colors)
// labelMode:   axis (category labels on axis only) | inside (inside bar) | both
// valueMode:   inside (inside bar) | outside (beyond bar end) | none
// minBandSize: minimum px for a band before touch target is clamped (0 = scale freely)

import { Anchor, cell, circle, derive, Diagram, easeInOut, effect as biEffect, label, line, type Mount, num, rect, tween, Vec } from "bireactive";
import { scaleLinear, scaleBand } from "d3-scale";
import { axis } from "../lib/axis";
import { chartContext } from "../lib/chart-context";
import { wheelController, dragController, dynamicWheelStep } from "../lib/interaction";
import { makeBridge, type ElementWithBridge } from "../lib/hud-bridge";
import { useHostSize, FILL_STYLE, type HostSize } from "../lib/host-size";
import {
  GESTURE_ACTIVE_CLASS,
  GESTURE_SUPPRESSION_CSS,
  hoverTransition,
  settleTransition,
} from "../lib/transitions";
import { trackGlobalGesture } from "../lib/global-gesture-state";

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

interface Bar { id?: string; label: string; value: number; }

function makeData(): Bar[] {
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return labels.map((l) => ({ id: l, label: l, value: Math.round(20 + Math.random() * 80) }));
}

export class MdBarChartLC extends Diagram {
  static styles = `
    text { pointer-events: none; }
    ${FILL_STYLE}
    ${GESTURE_SUPPRESSION_CSS}
    [data-focusable]:focus {
      outline: 2px solid #4a9eff;
      outline-offset: 2px;
    }
    [data-focusable]:focus:not(:focus-visible) {
      outline: none;
    }
  `

  readonly dataCell = cell<readonly Bar[]>(makeData());

  orientation: 'vertical' | 'horizontal' = 'vertical';
  colorMode: 'single' | 'palette' = 'single';
  labelMode: 'axis' | 'inside' | 'both' = 'axis';
  valueMode: 'inside' | 'outside' | 'none' = 'outside';
  minBandSize: number = 0;
  /** Max bands before overflow-scroll kicks in. */
  maxBands: number = 10;
  /** Max bars before overflow-scroll kicks in. */
  maxBars: number = 10;

  set externalData(v: { label: string; value: number }[] | undefined) {
    if (v) this.dataCell.value = v as Bar[];
  }
  get externalData(): { label: string; value: number }[] | undefined {
    return this.dataCell.value as Bar[];
  }

  protected scene(s: Mount): void {
    const size = useHostSize(this, { width: W, height: H });
    this.tabIndex = -1; // Container not directly focusable, items are
    this.style.outline = "none";
    const data = this.dataCell;
    // Register for global gesture-active class sync (suppresses settle transitions
    // on ALL charts when ANY chart has an active gesture).
    s(trackGlobalGesture(this));
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

    const rows0 = data.peek() as Bar[];

    // Overflow mode: fixed bar width per bar, chart scrolls horizontally.
    const BAR_STEP = 56; // px per bar (step including gap) in overflow mode
    const overflowMode = this.maxBars > 0 && rows0.length > this.maxBars;
    const neededW = overflowMode ? PAD.left + PAD.right + rows0.length * BAR_STEP : null;
    const viewW = neededW != null ? cell(neededW) : Wc;
    const viewH = Hc;
    this.view(viewW, viewH);
    const svgElV = (this as any).svg as SVGSVGElement;
    if (overflowMode) {
      svgElV.style.width = neededW + 'px';
      svgElV.style.height = '100%';
      this.style.overflowX = 'auto';
      this.style.overflowY = 'hidden';
    } else {
      svgElV.style.width = '';
      svgElV.style.height = '';
      this.style.overflowX = '';
      this.style.overflowY = '';
    }

    const plotW = overflowMode ? cell(neededW! - PAD.left - PAD.right) : derive(() => Wc.value - PAD.left - PAD.right);
    const plotH = derive(() => Hc.value - PAD.top - PAD.bottom);

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
    // Identity-keyed axis labels: each label tracks a specific datum and slides with it.
    for (let oi = 0; oi < rows0.length; oi++) {
      const datumId = rows0[oi]!.id ?? rows0[oi]!.label;
      const cur = derive(() => {
        const arr = data.value as Bar[];
        return arr.findIndex(d => (d.id ?? d.label) === datumId);
      });
      const di = (): Bar | null => (data.value as Bar[])[cur.value] ?? null;
      const txTarget = derive(() => {
        const idx = cur.value;
        if (idx < 0) return -9999;
        return (xBand.value(String(idx)) ?? 0) + xBand.value.bandwidth() / 2;
      });
      const tx = num(txTarget.value);
      let txCancel: (() => void) | null = null;
      biEffect(() => {
        const target = txTarget.value;
        txCancel?.();
        txCancel = this.anim.start(tween(tx, target, 0.25, easeInOut) as any);
      });
      s(line(Vec.derive(() => ({ x: tx.value, y: ay1.value })), Vec.derive(() => ({ x: tx.value, y: ay1.value + 4 })), { thin: true, stroke: "#888", opacity: 0.6 }));
      s(label(Vec.derive(() => ({ x: tx.value, y: ay1.value + 16 })), derive(() => di()?.label ?? ""), { size: 10, align: Anchor.Center, fill: "#888", opacity: 0.8 }));
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
      // Read data.value LIVE — slot i draws data.value[i], so hit-testing must
      // resolve against the same live array, not the stale scene-time `rows0`
      // snapshot (else hover/handle land on the wrong bar after a re-sort).
      const rows = data.value as Bar[];
      for (let i = 0; i < rows.length; i++) {
        const bx = xs(String(i)) ?? -1;
        if (px >= bx && px < bx + step) return rows[i]!;
      }
      return null;
    };
    const mutateDatum = (d: Bar, delta: number) => {
      d.value = Math.max(0, d.value + delta);
      data.value = [...data.value];
    };

    const setGestureActive = (on: boolean) => this.classList.toggle(GESTURE_ACTIVE_CLASS, on);
    const wheelConfig = {
      snapshot: (d: Bar) => { setGestureActive(true); return d.value; },
      restore: (d: Bar, v: number) => mutateDatum(d, v - d.value),
      onEnd: () => { setGestureActive(false); hover.value = null; this.dispatchEvent(new CustomEvent("gesturecommit")); },
    };
    let dragPointerId = -1;
    const dragConfig = {
      snapshot: (d: Bar) => { setGestureActive(true); return d.value; },
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
        setGestureActive(false);
        this.dispatchEvent(new CustomEvent("gesturecommit"));
      },
    };

    this.addEventListener("pointerleave", () => { if (!wheelController.active) hover.value = null; });
    this.addEventListener("click", e => {
      const pt = findAtPixel(localPoint(e as PointerEvent).x);
      selected.value = selected.value === pt ? null : pt;
    });
    this.addEventListener("wheel", e => {
      const we = e as WheelEvent;
      if (!we.ctrlKey) return;
      // Own the wheel for editing in overflow mode (host is overflow:auto): stop it
      // from scrolling the bars instead of editing the hovered value.
      we.preventDefault();
      we.stopPropagation();
      const t = wheelController.begin(hover.value ?? selected.value, wheelConfig);
      if (!t) return;
      const s = dynamicWheelStep(t.value, we.shiftKey);
      mutateDatum(t, we.deltaY < 0 ? +s : -s);
    }, { passive: false });
    this.addEventListener("keydown", e => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") { if (selected.value != null) { selected.value = null; ke.preventDefault(); } return; }
      const rows = data.value as Bar[];
      const cur = selected.value;
      const i = cur ? rows.indexOf(cur) : -1;
      if (ke.key === "ArrowRight" || ke.key === "ArrowLeft") {
        const nextIdx = ke.key === "ArrowLeft"
          ? (i <= 0 ? rows.length : i) - 1
          : (i + 1) % rows.length;
        selected.value = rows[nextIdx] ?? null;
        focusDatum(selected.value);
        ke.preventDefault(); return;
      }
      if (!cur) return;
      const step = dynamicWheelStep(cur.value, ke.shiftKey);
      if (ke.key === "ArrowUp") { mutateDatum(cur, +step); ke.preventDefault(); }
      else if (ke.key === "ArrowDown") { mutateDatum(cur, -step); ke.preventDefault(); }
    });
    this.addEventListener("pointerdown", e => {
      if (dragController.active) return;
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
      const i = (data.value as Bar[]).indexOf(t);
      return i < 0 ? -9999 : (xBand.value(String(i)) ?? 0) - (xBand.value.step() - xBand.value.bandwidth()) / 2;
    });
    const hlRect = s(rect(hlX, plotY, derive(() => xBand.value.step()), derive(() => plotH.value), {
      fill: "#ffffff", opacity: derive(() => hlTarget.value ? 0.06 : 0),
    }));
    hlRect.el.style.transition = "x 0.15s ease, opacity 0.1s ease";
    hlRect.el.style.pointerEvents = "none";

    // Bars — identity-keyed: each bar element tracks a specific datum by id.
    const tileElements: Map<string, SVGGElement> = new Map(); // Track elements by datum id
    // ID-based focus helper (matches selection/gesture pattern)
    const focusDatum = (d: Bar | null) => {
      if (!d?.id) return;
      tileElements.get(d.id)?.focus();
    };
    for (let oi = 0; oi < rows0.length; oi++) {
      const datumId = rows0[oi]!.id ?? rows0[oi]!.label;
      const cur = derive(() => {
        const arr = data.value as Bar[];
        return arr.findIndex(d => (d.id ?? d.label) === datumId);
      });
      const di = (): Bar | null => (data.value as Bar[])[cur.value] ?? null;
      const base = this.#barColor(oi);
      const hoverColor = this.#hoverColor(oi);

      const barXTarget = derive(() => {
        const idx = cur.value;
        if (idx < 0) return -9999;
        return xBand.value(String(idx)) ?? 0;
      });
      // Bireactive-driven tween for x — CSS transitions on the SVG `x`
      // attribute proved unreliable under bireactive's reactive flush (the
      // browser committed the target as the starting frame on the first
      // change of the run). Tween drives the cell per-frame, so bireactive
      // writes each intermediate x to the rect via setAttribute.
      const barX = num(barXTarget.value);
      let barXCancel: (() => void) | null = null;
      biEffect(() => {
        const target = barXTarget.value;
        barXCancel?.();
        barXCancel = this.anim.start(tween(barX, target, 0.25, easeInOut) as any);
      });
      const barW = derive(() => xBand.value.bandwidth());
      const barY = derive(() => { const d = di(); return d ? (ctx.yScale.value as any)(d.value) : plotY + plotH.value; });
      const barH = derive(() => Math.max(0, plotY + plotH.value - barY.value));
      const fill = derive(() => { const d = di(); return selected.value === d ? "#fff" : hover.value === d ? hoverColor : base; });

      const tile = s(rect(barX, barY, barW, barH, { fill, corner: 2 }));
      tileElements.set(datumId, tile.el); // Store for focus management
      tile.el.style.cursor = "ns-resize";
      // Make each bar individually focusable
      tile.el.setAttribute('tabindex', '0');
      tile.el.setAttribute('data-focusable', 'bar');
      biEffect(() => {
        const d = di();
        if (d) tile.el.setAttribute('aria-label', `${d.label}: ${Math.round(d.value)}`);
      });
      tile.el.addEventListener("pointerenter", () => { const d = di(); if (!wheelController.active && d) hover.value = d; });
      tile.el.addEventListener("pointerleave", () => { const d = di(); if (!wheelController.active && d && hover.value === d) hover.value = null; });
      tile.el.addEventListener("click", () => { const d = di(); if (!d) return; selected.value = selected.value === d ? null : d; });
      tile.el.addEventListener("focus", () => { const d = di(); if (d) selected.value = d; });
      tile.el.addEventListener("blur", () => { const d = di(); if (d && selected.value === d) selected.value = null; });

      const barCX = derive(() => barX.value + barW.value / 2);

      // Settle transitions on the intrinsic (rect/text/circle). Reorder (x/cx)
      // is driven by a bireactive tween on `barX`, not CSS — downstream label
      // and handle positions derive from barX and follow per frame.
      const settleTargets: Array<{ el: SVGElement; props: readonly string[] }> = [];
      if (tile.intrinsic) settleTargets.push({ el: tile.intrinsic as SVGElement, props: ["y", "height", "fill"] });

      // Inside label (labelMode: inside | both).
      let insideLabel: ReturnType<typeof label> | null = null;
      if (this.labelMode === 'inside' || this.labelMode === 'both') {
        const insideOpacity = derive(() => barH.value >= (this.minBandSize || 48) ? 1 : 0);
        const labelFill = derive(() => { const d = di(); return selected.value === d ? base : "#fff"; });
        insideLabel = s(label(Vec.derive(() => ({ x: barCX.value, y: barY.value + 14 })), derive(() => di()?.label ?? ""),
          { size: 10, align: Anchor.Center, fill: labelFill, opacity: insideOpacity }));
        if (insideLabel.intrinsic) settleTargets.push({ el: insideLabel.intrinsic as SVGElement, props: ["y", "fill"] });
      }

      // Value label.
      let valueLabel: ReturnType<typeof label> | null = null;
      if (this.valueMode !== 'none') {
        if (this.valueMode === 'inside') {
          const insideOpacity = derive(() => barH.value >= (this.minBandSize || 48) ? 1 : 0);
          const labelFill = derive(() => { const d = di(); return selected.value === d ? base : "#fff"; });
          valueLabel = s(label(Vec.derive(() => ({ x: barCX.value, y: barY.value + (this.labelMode !== 'axis' ? 28 : 14) })),
            derive(() => { const d = di(); return d ? `${Math.round(d.value)}` : ""; }),
            { size: 10, align: Anchor.Center, fill: labelFill, opacity: insideOpacity }));
        } else {
          valueLabel = s(label(Vec.derive(() => ({ x: barCX.value, y: barY.value - 6 })),
            derive(() => { const d = di(); return d ? `${Math.round(d.value)}` : ""; }),
            { size: 10, align: Anchor.Center, fill: "#888", opacity: derive(() => barH.value >= 8 ? 1 : 0) }));
        }
        if (valueLabel.intrinsic) settleTargets.push({ el: valueLabel.intrinsic as SVGElement, props: ["y", "fill"] });
      }

      // Drag handle at bar top.
      const handlePos = Vec.derive(() => ({ x: barCX.value, y: barY.value }));
      const handleOpacity = derive(() => { const d = di(); return (hover.value === d || selected.value === d) ? 1 : 0; });
      const handle = s(circle(handlePos, derive(() => { const d = di(); return selected.value === d ? 6 : 5; }), {
        fill: derive(() => { const d = di(); return selected.value === d ? "#fff" : hoverColor; }),
        stroke: "#0b0d12", strokeWidth: 1.5, opacity: handleOpacity,
      }));
      handle.el.style.cursor = "ns-resize";
      handle.el.style.transition = hoverTransition("opacity");
      handle.el.addEventListener("pointerenter", () => { const d = di(); if (!wheelController.active && d) hover.value = d; });
      handle.el.addEventListener("pointerleave", () => { const d = di(); if (!wheelController.active && d && hover.value === d) hover.value = null; });
      if (handle.intrinsic) settleTargets.push({ el: handle.intrinsic as SVGElement, props: ["cy", "fill"] });

      // Static settle transition on the intrinsic element (SVG attributes only
      // transition when the style is on the element that owns them, not the
      // wrapping <g>). x/cx are driven by bireactive tween, not CSS.
      for (const t of settleTargets) {
        t.el.style.transition = settleTransition(t.props);
      }
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

    const rows0 = data.peek() as Bar[];

    // Overflow mode: fixed band height per row, chart scrolls vertically.
    const BAND_STEP = 44; // px per band (step including gap) in overflow mode
    const overflowMode = this.maxBands > 0 && rows0.length > this.maxBands;
    const neededH = overflowMode ? PAD.top + PAD.bottom + rows0.length * BAND_STEP : null;
    const viewW = Wc;
    const viewH = neededH != null ? cell(neededH) : Hc;
    this.view(viewW, viewH);
    const svgEl = (this as any).svg as SVGSVGElement;
    if (overflowMode) {
      svgEl.style.width = '100%';
      svgEl.style.height = neededH + 'px';
      this.style.overflowY = 'auto';
      this.style.overflowX = 'hidden';
    } else {
      svgEl.style.width = '';
      svgEl.style.height = '';
      this.style.overflowY = '';
      this.style.overflowX = '';
    }

    const plotW = derive(() => Wc.value - PAD.left - PAD.right);
    const plotH = overflowMode ? cell(neededH! - PAD.top - PAD.bottom) : derive(() => Hc.value - PAD.top - PAD.bottom);

    // yBand keyed by index — avoids stacking when multiple rows share a label.
    const yBand = overflowMode
      ? cell(scaleBand<string>()
          .domain(rows0.map((_, i) => String(i)))
          .range([plotY, plotY + (neededH! - PAD.top - PAD.bottom)])
          .padding(0.15))
      : derive(() =>
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
      const rows = data.value as Bar[];
      for (let i = 0; i < rows.length; i++) {
        const by = ys(String(i)) ?? -1;
        if (py >= by && py < by + step) return rows[i]!;
      }
      return null;
    };
    const mutateDatum = (d: Bar, delta: number) => {
      d.value = Math.max(0, d.value + delta);
      data.value = [...data.value];
    };

    const setGestureActive = (on: boolean) => this.classList.toggle(GESTURE_ACTIVE_CLASS, on);
    const wheelConfig = {
      snapshot: (d: Bar) => { setGestureActive(true); return d.value; },
      restore: (d: Bar, v: number) => mutateDatum(d, v - d.value),
      onEnd: () => { setGestureActive(false); hover.value = null; this.dispatchEvent(new CustomEvent("gesturecommit")); },
    };
    let dragPointerId = -1;
    const dragConfig = {
      snapshot: (d: Bar) => { setGestureActive(true); return d.value; },
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
        setGestureActive(false);
        this.dispatchEvent(new CustomEvent("gesturecommit"));
      },
    };

    this.addEventListener("pointerleave", () => { if (!wheelController.active) hover.value = null; });
    this.addEventListener("click", e => {
      const pt = findAtPixelY(localPoint(e as PointerEvent).y);
      selected.value = selected.value === pt ? null : pt;
    });
    this.addEventListener("wheel", e => {
      const we = e as WheelEvent;
      if (!we.ctrlKey) return;
      // Own the wheel for editing in overflow mode (host is overflow:auto): stop it
      // from scrolling the bars instead of editing the hovered value.
      we.preventDefault();
      we.stopPropagation();
      const t = wheelController.begin(hover.value ?? selected.value, wheelConfig);
      if (!t) return;
      const s = dynamicWheelStep(t.value, we.shiftKey);
      mutateDatum(t, we.deltaY < 0 ? +s : -s);
    }, { passive: false });
    this.addEventListener("keydown", e => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") { if (selected.value != null) { selected.value = null; ke.preventDefault(); } return; }
      const rows = data.value as Bar[];
      const cur = selected.value;
      const i = cur ? rows.indexOf(cur) : -1;
      if (ke.key === "ArrowDown" || ke.key === "ArrowUp") {
        const nextIdx = ke.key === "ArrowUp"
          ? (i <= 0 ? rows.length : i) - 1
          : (i + 1) % rows.length;
        selected.value = rows[nextIdx] ?? null;
        focusDatumH(selected.value);
        ke.preventDefault(); return;
      }
      if (!cur) return;
      const step = ke.shiftKey ? 5 : 1;
      if (ke.key === "ArrowRight") { mutateDatum(cur, +step); ke.preventDefault(); }
      else if (ke.key === "ArrowLeft") { mutateDatum(cur, -step); ke.preventDefault(); }
    });
    this.addEventListener("pointerdown", e => {
      if (dragController.active) return;
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
      const i = (data.value as Bar[]).indexOf(t);
      return i < 0 ? -9999 : (yBand.value(String(i)) ?? 0) - (yBand.value.step() - yBand.value.bandwidth()) / 2;
    });
    const hlRect = s(rect(plotX, hlY, derive(() => plotW.value), derive(() => yBand.value.step()), {
      fill: "#ffffff", opacity: derive(() => hlTarget.value ? 0.06 : 0),
    }));
    hlRect.el.style.transition = "y 0.15s ease, opacity 0.1s ease";
    hlRect.el.style.pointerEvents = "none";

    // Axis labels on left — identity-keyed: each label tracks a specific datum and slides with it.
    if (this.labelMode === 'axis' || this.labelMode === 'both') {
      for (let oi = 0; oi < rows0.length; oi++) {
        const datumId = rows0[oi]!.id ?? rows0[oi]!.label;
        const cur = derive(() => {
          const arr = data.value as Bar[];
          return arr.findIndex(d => (d.id ?? d.label) === datumId);
        });
        const di = (): Bar | null => (data.value as Bar[])[cur.value] ?? null;
        const barCYTarget = derive(() => {
          const idx = cur.value;
          if (idx < 0) return -9999;
          return (yBand.value(String(idx)) ?? 0) + yBand.value.bandwidth() / 2;
        });
        const barCY = num(barCYTarget.value);
        let barCYCancel: (() => void) | null = null;
        biEffect(() => {
          const target = barCYTarget.value;
          barCYCancel?.();
          barCYCancel = this.anim.start(tween(barCY, target, 0.25, easeInOut) as any);
        });
        s(label(Vec.derive(() => ({ x: plotX - 6, y: barCY.value })), derive(() => di()?.label ?? ""),
          { size: 11, align: Anchor.Right, fill: "#888", opacity: 0.8 }));
      }
    }

    // Bars — identity-keyed: each bar element tracks a specific datum by id.
    const tileElementsH: Map<string, SVGGElement> = new Map(); // Track elements by datum id
    // ID-based focus helper (matches selection/gesture pattern)
    const focusDatumH = (d: Bar | null) => {
      if (!d?.id) return;
      tileElementsH.get(d.id)?.focus();
    };
    for (let oi = 0; oi < rows0.length; oi++) {
      const datumId = rows0[oi]!.id ?? rows0[oi]!.label;
      const cur = derive(() => {
        const arr = data.value as Bar[];
        return arr.findIndex(d => (d.id ?? d.label) === datumId);
      });
      const di = (): Bar | null => (data.value as Bar[])[cur.value] ?? null;
      const base = this.#barColor(oi);
      const hoverColor = this.#hoverColor(oi);

      const barYTarget = derive(() => {
        const idx = cur.value;
        if (idx < 0) return -9999;
        return yBand.value(String(idx)) ?? 0;
      });
      const barY = num(barYTarget.value);
      let barYCancel: (() => void) | null = null;
      biEffect(() => {
        const target = barYTarget.value;
        barYCancel?.();
        barYCancel = this.anim.start(tween(barY, target, 0.25, easeInOut) as any);
      });
      const barH = derive(() => yBand.value.bandwidth());
      const barW = derive(() => { const d = di(); return d ? Math.max(0, (xLinear.value as any)(d.value) - plotX) : 0; });
      const fill = derive(() => { const d = di(); return selected.value === d ? "#fff" : hover.value === d ? hoverColor : base; });
      const labelFill = derive(() => { const d = di(); return selected.value === d ? base : "#fff"; });

      const tile = s(rect(plotX, barY, barW, barH, { fill, corner: 3 }));
      tileElementsH.set(datumId, tile.el); // Store for focus management
      tile.el.style.cursor = "ew-resize";
      // Make each bar individually focusable
      tile.el.setAttribute('tabindex', '0');
      tile.el.setAttribute('data-focusable', 'bar');
      biEffect(() => {
        const d = di();
        if (d) tile.el.setAttribute('aria-label', `${d.label}: ${Math.round(d.value)}`);
      });
      tile.el.addEventListener("pointerenter", () => { const d = di(); if (!wheelController.active && d) hover.value = d; });
      tile.el.addEventListener("pointerleave", () => { const d = di(); if (!wheelController.active && d && hover.value === d) hover.value = null; });
      tile.el.addEventListener("click", () => { const d = di(); if (!d) return; selected.value = selected.value === d ? null : d; });
      tile.el.addEventListener("focus", () => { const d = di(); if (d) selected.value = d; });
      tile.el.addEventListener("blur", () => { const d = di(); if (d && selected.value === d) selected.value = null; });

      const barCY = derive(() => barY.value + barH.value / 2);
      const minBand = this.minBandSize || 60;

      // Settle transitions on the intrinsic. Reorder (y/cy) is driven by the
      // bireactive tween on barY; label/handle positions follow via derive.
      const settleTargets: Array<{ el: SVGElement; props: readonly string[] }> = [];
      if (tile.intrinsic) settleTargets.push({ el: tile.intrinsic as SVGElement, props: ["width", "fill"] });

      // Inside label (labelMode: inside | both).
      let insideLabel: ReturnType<typeof label> | null = null;
      if (this.labelMode === 'inside' || this.labelMode === 'both') {
        const insideOpacity = derive(() => barW.value >= minBand ? 1 : 0);
        insideLabel = s(label(Vec.derive(() => ({ x: plotX + 8, y: barCY.value })), derive(() => di()?.label ?? ""),
          { size: 11, align: Anchor.Left, fill: labelFill, opacity: insideOpacity }));
        if (insideLabel.intrinsic) settleTargets.push({ el: insideLabel.intrinsic as SVGElement, props: ["fill"] });
      }

      // Value label.
      let valueLabel: ReturnType<typeof label> | null = null;
      let valueLabelOutside: ReturnType<typeof label> | null = null;
      if (this.valueMode !== 'none') {
        if (this.valueMode === 'inside') {
          const insideOpacity = derive(() => barW.value >= minBand ? 1 : 0);
          valueLabel = s(label(Vec.derive(() => ({ x: plotX + barW.value - 8, y: barCY.value })),
            derive(() => { const d = di(); return d ? `${Math.round(d.value)}` : ""; }),
            { size: 11, align: Anchor.Right, fill: labelFill, opacity: insideOpacity }));
          if (valueLabel.intrinsic) settleTargets.push({ el: valueLabel.intrinsic as SVGElement, props: ["x", "fill"] });
          // Fallback value outside when bar too short.
          const outsideOpacity = derive(() => barW.value < minBand ? 1 : 0);
          valueLabelOutside = s(label(Vec.derive(() => ({ x: plotX + barW.value + 6, y: barCY.value })),
            derive(() => { const d = di(); return d ? `${Math.round(d.value)}` : ""; }),
            { size: 11, align: Anchor.Left, fill: "#aaa", opacity: outsideOpacity }));
          if (valueLabelOutside.intrinsic) settleTargets.push({ el: valueLabelOutside.intrinsic as SVGElement, props: ["x", "fill"] });
        } else {
          valueLabel = s(label(Vec.derive(() => ({ x: plotX + barW.value + 6, y: barCY.value })),
            derive(() => { const d = di(); return d ? `${Math.round(d.value)}` : ""; }),
            { size: 11, align: Anchor.Left, fill: "#888", opacity: derive(() => barW.value > 0 ? 1 : 0) }));
          if (valueLabel.intrinsic) settleTargets.push({ el: valueLabel.intrinsic as SVGElement, props: ["x", "fill"] });
        }
      }

      // Drag handle at bar right end.
      const handlePos = Vec.derive(() => ({ x: plotX + barW.value, y: barCY.value }));
      const handleOpacity = derive(() => { const d = di(); return (hover.value === d || selected.value === d) ? 1 : 0; });
      const handle = s(circle(handlePos, derive(() => { const d = di(); return selected.value === d ? 6 : 5; }), {
        fill: derive(() => { const d = di(); return selected.value === d ? "#fff" : hoverColor; }),
        stroke: "#0b0d12", strokeWidth: 1.5, opacity: handleOpacity,
      }));
      handle.el.style.cursor = "ew-resize";
      handle.el.style.transition = hoverTransition("opacity");
      handle.el.addEventListener("pointerenter", () => { const d = di(); if (!wheelController.active && d) hover.value = d; });
      handle.el.addEventListener("pointerleave", () => { const d = di(); if (!wheelController.active && d && hover.value === d) hover.value = null; });
      if (handle.intrinsic) settleTargets.push({ el: handle.intrinsic as SVGElement, props: ["cx", "fill"] });

      for (const t of settleTargets) {
        t.el.style.transition = settleTransition(t.props);
      }
    }

    s(label(Vec.derive(() => ({ x: Wc.value / 2, y: 8 })), derive(() => {
      const p = selected.value ?? hover.value;
      if (!p) return "Bands — hover · click · ↑/↓ navigate · ←/→ edit · ctrl+wheel · drag end";
      return `${p.label}  ${p.value}`;
    }), { size: 11, align: Anchor.Center, opacity: 0.7 }));

    this.#bridge(data, hover, selected);
  }

  #bridge(data: ReturnType<typeof cell<readonly Bar[]>>, hover: ReturnType<typeof cell<Bar | null>>, selected: ReturnType<typeof cell<Bar | null>>) {
    // Key on the datum's stable id; look up live (data.value reorders on sort).
    const idOf = (d: Bar | null) => d?.id ?? null;
    const datumAt = (id: string | null) => id == null ? null : (data.value as Bar[]).find(d => d.id === id) ?? null;
    let applying = false;
    const bridge = makeBridge({
      setHover: key => { applying = true; hover.value = datumAt(key); applying = false; },
      setSelect: key => { applying = true; selected.value = datumAt(key); applying = false; },
    });
    (this as unknown as ElementWithBridge).brSync = bridge;
    biEffect(() => { if (!applying) bridge.emitHover(idOf(hover.value)); });
    biEffect(() => { if (!applying) bridge.emitSelect(idOf(selected.value)); });
  }
}
