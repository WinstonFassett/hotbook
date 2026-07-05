// BarChart — unified bar chart with composable display options.
// orientation: vertical | horizontal  (reactive — morphs on change, WIN-144)
// colorMode:   single (one accent color) | palette (per-bar PALETTE colors)
// labelMode:   axis (category labels on axis only) | inside (inside bar) | both
// valueMode:   inside (inside bar) | outside (beyond bar end) | none
// minBandSize: minimum px for a band before touch target is clamped (0 = scale freely)

import { Anchor, cell, circle, derive, Diagram, easeInOut, effect as biEffect, label, line, type Mount, num, rect, tween, untracked, Vec } from "bireactive";
import { scaleLinear, scaleBand } from "d3-scale";
import { wheelController, dragController, dynamicWheelStep, realModifierDown } from "../lib/interaction";
import { makeBridge, type ElementWithBridge } from "../lib/hud-bridge";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import {
  GESTURE_ACTIVE_CLASS,
  GESTURE_SUPPRESSION_CSS,
  hoverTransition,
} from "../lib/transitions";

const W = 720;
const H = 360;
const SINGLE_COLOR = "#7aaae8";
const PALETTE = ['#e08888', '#d4a86c', '#ccc060', '#7ec87e', '#60c4c0', '#7aaae8', '#b090e0', '#8899b4'];
const SORT_SEC = 0.35; // s — orientation/measure swap tween duration

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

const V_PAD = { top: 16, right: 24, bottom: 36, left: 48 };
const H_PAD = { top: 16, right: 64, bottom: 16, left: 16 };
const V_BAR_STEP = 56; // px per bar in vertical overflow
const H_BAND_STEP = 44; // px per band in horizontal overflow

// text-anchor / dominant-baseline strings for each Anchor value.
const xAnchor = (x: number) => (x <= 0.25 ? "start" : x >= 0.75 ? "end" : "middle");
const yAnchor = (y: number) => (y <= 0.25 ? "hanging" : y >= 0.75 ? "alphabetic" : "central");

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

  private _orientationCell = cell<'vertical' | 'horizontal'>('vertical')
  get orientation(): 'vertical' | 'horizontal' { return this._orientationCell.value }
  set orientation(v: 'vertical' | 'horizontal') { this._orientationCell.value = v }

  private _measureKeyCell = cell<string>('')
  get measureKey(): string { return this._measureKeyCell.value }
  set measureKey(v: string) { this._measureKeyCell.value = v }
  // Axis-binding model (WIN-144): valueBinding replaces measureKey.
  // Backward compat: measureKey setter maps to valueBinding.
  get valueBinding(): string { return this.measureKey }
  set valueBinding(v: string) { this.measureKey = v }

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

  #barColor(idx: number): string {
    return this.colorMode === 'palette' ? PALETTE[idx % PALETTE.length]! : SINGLE_COLOR;
  }
  #hoverColor(idx: number): string {
    return lightenHex(this.#barColor(idx), 0.35);
  }

  protected scene(s: Mount): void {
    const size = useHostSize(this, { width: W, height: H });
    const { w: Wc, h: Hc } = size;
    this.tabIndex = -1; // Container not directly focusable, items are
    this.style.outline = "none";
    const data = this.dataCell;
    const rows0 = data.peek() as Bar[];

    // ─── Orientation ──────────────────────────────────────────────────────
    const isVert = derive(() => this._orientationCell.value === 'vertical');

    // ─── Padding + plot area (derived from orientation) ───────────────────
    const PAD = derive(() => isVert.value ? V_PAD : H_PAD);
    const plotX = derive(() => PAD.value.left);
    const plotY = derive(() => PAD.value.top);
    const plotW = derive(() => Wc.value - PAD.value.left - PAD.value.right);
    const plotH = derive(() => Hc.value - PAD.value.top - PAD.value.bottom);
    const plotBottom = derive(() => plotY.value + plotH.value);
    const plotRight = derive(() => plotX.value + plotW.value);

    // ─── Overflow mode (direction depends on orientation) ─────────────────
    const overflowMode = derive(() => {
      const n = rows0.length;
      return isVert.value ? (this.maxBars > 0 && n > this.maxBars) : (this.maxBands > 0 && n > this.maxBands);
    });
    const STEP = derive(() => isVert.value ? V_BAR_STEP : H_BAND_STEP);
    const neededBand = derive(() => PAD.value.left + PAD.value.right + rows0.length * STEP.value); // vertical: width
    const neededOrtho = derive(() => PAD.value.top + PAD.value.bottom + rows0.length * STEP.value); // horizontal: height

    const viewW = derive(() => overflowMode.value && isVert.value ? neededBand.value : Wc.value);
    const viewH = derive(() => overflowMode.value && !isVert.value ? neededOrtho.value : Hc.value);
    this.view(viewW, viewH);
    const svgEl = (this as any).svg as SVGSVGElement;
    biEffect(() => {
      const om = overflowMode.value, iv = isVert.value;
      if (om) {
        svgEl.style.width = iv ? viewW.value + 'px' : '100%';
        svgEl.style.height = iv ? '100%' : viewH.value + 'px';
        this.style.overflowX = iv ? 'auto' : 'hidden';
        this.style.overflowY = iv ? 'hidden' : 'auto';
      } else {
        svgEl.style.width = '';
        svgEl.style.height = '';
        this.style.overflowX = '';
        this.style.overflowY = '';
      }
    });

    // Effective plot dimensions account for overflow (fixed band-axis size).
    const effPlotW = derive(() => overflowMode.value && isVert.value ? neededBand.value - PAD.value.left - PAD.value.right : plotW.value);
    const effPlotH = derive(() => overflowMode.value && !isVert.value ? neededOrtho.value - PAD.value.top - PAD.value.bottom : plotH.value);

    // ─── Scales (band + value; axis roles swap with orientation) ──────────
    // Band scale: on x for vertical, on y for horizontal.
    const bandScale = derive(() => {
      const isV = isVert.value;
      const range = isV
        ? [plotX.value, plotX.value + effPlotW.value]
        : [plotY.value, plotY.value + effPlotH.value];
      return scaleBand<string>()
        .domain(rows0.map((_, i) => String(i)))
        .range(range)
        .padding(isV ? 0.25 : 0.15);
    });
    // Value scale: on y for vertical (reversed), on x for horizontal.
    const valueScale = derive(() => {
      const max = Math.max(1, ...(data.value as Bar[]).map(d => d.value));
      const isV = isVert.value;
      const range = isV
        ? [plotY.value + effPlotH.value, plotY.value] // y reversed (SVG origin top-left)
        : [plotX.value, plotX.value + effPlotW.value];
      return scaleLinear().domain([0, max]).range(range).nice();
    });

    // ─── Value axis (ticks + labels, reactive to orientation) ─────────────
    // Rendered as a pool of tick slots; positions derive from valueScale + isVert.
    const valueTicks = derive(() => {
      const sc = valueScale.value as any;
      const arr: any[] = typeof sc.ticks === "function" ? sc.ticks(5) : (sc.domain?.() ?? []);
      const fmt = typeof sc.tickFormat === "function" ? sc.tickFormat(5) : (v: any) => String(v);
      return arr.map((v) => ({ v, pos: sc(v), text: fmt(v) }));
    });
    const AXIS_POOL = 12;
    for (let ti = 0; ti < AXIS_POOL; ti++) {
      const visible = derive(() => valueTicks.value[ti] ? 1 : 0);
      const tickOpacity = derive(() => 0.6 * visible.value);
      const labelOpacity = derive(() => 0.8 * visible.value);
      const text = derive(() => valueTicks.value[ti]?.text ?? "");
      const pos = derive(() => valueTicks.value[ti]?.pos ?? 0);
      // Tick line + label — position swaps between left axis (vertical) and bottom axis (horizontal).
      s(line(
        Vec.derive(() => {
          if (isVert.value) return { x: plotX.value, y: pos.value };
          return { x: pos.value, y: plotBottom.value };
        }),
        Vec.derive(() => {
          if (isVert.value) return { x: plotX.value - 4, y: pos.value };
          return { x: pos.value, y: plotBottom.value + 4 };
        }),
        { thin: true, stroke: "#888", opacity: tickOpacity },
      ));
      {
        const tlbl = s(label(
          Vec.derive(() => {
            if (isVert.value) return { x: plotX.value - 8, y: pos.value };
            return { x: pos.value, y: plotBottom.value + 16 };
          }),
          text,
          { size: 10, fill: "#888", opacity: labelOpacity },
        ));
        biEffect(() => {
          const a = isVert.value ? Anchor.Right : Anchor.Center;
          tlbl.el.setAttribute('text-anchor', xAnchor(a.x));
          tlbl.el.setAttribute('dominant-baseline', yAnchor(a.y));
        });
      }
    }
    // Value axis baseline.
    s(line(
      Vec.derive(() => isVert.value ? { x: plotX.value, y: plotY.value } : { x: plotX.value, y: plotBottom.value }),
      Vec.derive(() => isVert.value ? { x: plotX.value, y: plotBottom.value } : { x: plotRight.value, y: plotBottom.value }),
      { thin: true, opacity: 0.5, stroke: "#888" },
    ));

    // ─── Hover / selection state ──────────────────────────────────────────
    const hover = cell<Bar | null>(null);
    const selected = cell<Bar | null>(null);

    const localPoint = (e: PointerEvent) => {
      const r = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox?.baseVal;
      const sx = vb && vb.width ? vb.width / r.width : 1;
      const sy = vb && vb.height ? vb.height / r.height : 1;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    };

    // Find bar at pixel — checks band axis (x for vertical, y for horizontal).
    const findAtPixel = (px: number, py: number): Bar | null => {
      const bs = bandScale.value;
      const step = bs.step();
      const rows = data.value as Bar[];
      const p = isVert.value ? px : py;
      for (let i = 0; i < rows.length; i++) {
        const bp = bs(String(i)) ?? -1;
        if (p >= bp && p < bp + step) return rows[i]!;
      }
      return null;
    };

    const mutateDatum = (d: Bar, delta: number) => {
      d.value = Math.max(0, d.value + delta);
      data.value = [...data.value];
    };

    const setGestureActive = (on: boolean) => { this.classList.toggle(GESTURE_ACTIVE_CLASS, on); (this as any).gestureActive = on; };

    // ─── Gesture configs (shared controllers) ─────────────────────────────
    const wheelConfig = {
      snapshot: (d: Bar) => { setGestureActive(true); return d.value; },
      restore: (d: Bar, v: number) => mutateDatum(d, v - d.value),
      onEnd: (canceled: boolean) => { setGestureActive(false); hover.value = null; this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled } })); },
    };
    let dragPointerId = -1;
    const dragConfig = {
      snapshot: (d: Bar) => { setGestureActive(true); return d.value; },
      restore: (d: Bar, v: number) => mutateDatum(d, v - d.value),
      onMove: (pe: PointerEvent) => {
        const t = dragController.target as Bar | null;
        if (!t) return;
        const { x, y } = localPoint(pe);
        const v = isVert.value
          ? (valueScale.value as any).invert(y) - t.value
          : (valueScale.value as any).invert(x) - t.value;
        mutateDatum(t, v);
      },
      onEnd: (canceled: boolean) => {
        if (dragPointerId >= 0 && (this as any).hasPointerCapture?.(dragPointerId)) (this as any).releasePointerCapture(dragPointerId);
        dragPointerId = -1;
        setGestureActive(false);
        this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled } }));
      },
    };

    // ─── Event listeners ──────────────────────────────────────────────────
    this.addEventListener("pointerleave", () => { if (!wheelController.active) hover.value = null; });
    this.addEventListener("click", e => {
      const { x, y } = localPoint(e as PointerEvent);
      const pt = findAtPixel(x, y);
      selected.value = selected.value === pt ? null : pt;
    });
    this.addEventListener("wheel", e => {
      const we = e as WheelEvent;
      if (!we.ctrlKey) return;
      we.preventDefault();
      we.stopPropagation();
      const t = wheelController.begin(hover.value ?? selected.value, wheelConfig, { pinch: !realModifierDown() });
      if (!t) return;
      const st = dynamicWheelStep(t.value, we.shiftKey);
      mutateDatum(t, we.deltaY < 0 ? +st : -st);
    }, { passive: false });
    this.addEventListener("keydown", e => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") { if (selected.value != null) { selected.value = null; ke.preventDefault(); } return; }
      const rows = data.value as Bar[];
      const cur = selected.value;
      const i = cur ? rows.indexOf(cur) : -1;
      // Navigation axis = band axis (Left/Right for vertical, Up/Down for horizontal).
      const navKeys = isVert.value ? ["ArrowRight", "ArrowLeft"] : ["ArrowDown", "ArrowUp"];
      if (navKeys.includes(ke.key)) {
        const nextIdx = ke.key === "ArrowLeft" || ke.key === "ArrowUp"
          ? (i <= 0 ? rows.length : i) - 1
          : (i + 1) % rows.length;
        selected.value = rows[nextIdx] ?? null;
        focusDatum(selected.value);
        ke.preventDefault(); return;
      }
      if (!cur) return;
      const step = ke.shiftKey ? 5 : 1;
      const valKeys = isVert.value ? ["ArrowUp", "ArrowDown"] : ["ArrowRight", "ArrowLeft"];
      if (ke.key === valKeys[0]) { mutateDatum(cur, +step); ke.preventDefault(); }
      else if (ke.key === valKeys[1]) { mutateDatum(cur, -step); ke.preventDefault(); }
    });
    this.addEventListener("pointerdown", e => {
      if (dragController.active) return;
      const pe = e as PointerEvent;
      const { x, y } = localPoint(pe);
      const pt = findAtPixel(x, y);
      if (!pt) return;
      // Hit-test: near the bar's value-end (top for vertical, right for horizontal).
      const valPos = (valueScale.value as any)(pt.value);
      const dist = isVert.value ? Math.abs(y - valPos) : Math.abs(x - valPos);
      if (dist > 12) return;
      dragPointerId = pe.pointerId;
      selected.value = pt;
      setGestureActive(true);
      (this as any).setPointerCapture(pe.pointerId);
      dragController.begin(pt, dragConfig);
      pe.preventDefault();
    });
    this.addEventListener("pointermove", e => {
      if (dragController.active || wheelController.active) return;
      const { x, y } = localPoint(e as PointerEvent);
      hover.value = findAtPixel(x, y);
    });

    // ─── Highlight rect (column/row hover background) ─────────────────────
    const hlTarget = derive(() => hover.value ?? selected.value);
    const hlPos = Vec.derive(() => {
      const t = hlTarget.value; if (!t) return { x: -9999, y: -9999 };
      const i = (data.value as Bar[]).indexOf(t);
      if (i < 0) return { x: -9999, y: -9999 };
      const bs = bandScale.value;
      const bp = bs(String(i)) ?? 0;
      const pad = (bs.step() - bs.bandwidth()) / 2;
      if (isVert.value) return { x: bp - pad, y: plotY.value };
      return { x: plotX.value, y: bp - pad };
    });
    const hlW = derive(() => {
      if (!isVert.value) return plotW.value;
      const t = hlTarget.value; if (!t) return 0;
      const i = (data.value as Bar[]).indexOf(t);
      return i < 0 ? 0 : bandScale.value.step();
    });
    const hlH = derive(() => {
      if (isVert.value) return effPlotH.value;
      const t = hlTarget.value; if (!t) return 0;
      const i = (data.value as Bar[]).indexOf(t);
      return i < 0 ? 0 : bandScale.value.step();
    });
    const hlRect = s(rect(hlPos, hlW, hlH, {
      fill: "#ffffff", opacity: derive(() => hlTarget.value ? 0.06 : 0),
    }));
    hlRect.el.style.transition = "x 0.15s ease, y 0.15s ease, opacity 0.1s ease";
    hlRect.el.style.pointerEvents = "none";

    // ─── Category labels (axis / both mode) — identity-keyed, tweened ─────
    const tileElements: Map<string, SVGGElement> = new Map();
    const focusDatum = (d: Bar | null) => {
      if (!d?.id) return;
      tileElements.get(d.id)?.focus();
    };

    // Category axis baseline (bottom for vertical, left for horizontal).
    s(line(
      Vec.derive(() => isVert.value ? { x: plotX.value, y: plotBottom.value } : { x: plotX.value, y: plotY.value }),
      Vec.derive(() => isVert.value ? { x: plotRight.value, y: plotBottom.value } : { x: plotX.value, y: plotBottom.value }),
      { thin: true, opacity: 0.5, stroke: "#888" },
    ));

    // ─── Bars — identity-keyed, tweened x/y/w/h with gate ─────────────────
    // orderHash detects sort (reorder) — id sequence changes when sliceboard
    // hands data in a new display order. Tween on sort/orientation/measure;
    // snap on value edits (same datum, different value).
    const orderHash = derive(() => (data.value as Bar[]).map(d => d.id ?? d.label).join(','));
    for (let oi = 0; oi < rows0.length; oi++) {
      const datumId = rows0[oi]!.id ?? rows0[oi]!.label;
      const cur = derive(() => {
        const arr = data.value as Bar[];
        return arr.findIndex(d => (d.id ?? d.label) === datumId);
      });
      const di = (): Bar | null => (data.value as Bar[])[cur.value] ?? null;
      const base = this.#barColor(oi);
      const hoverColor = this.#hoverColor(oi);

      // Bar geometry targets — all four swap roles with orientation.
      const barXTarget = derive(() => {
        const idx = cur.value;
        if (idx < 0) return -9999;
        return isVert.value ? (bandScale.value(String(idx)) ?? 0) : plotX.value;
      });
      const barYTarget = derive(() => {
        const idx = cur.value;
        if (idx < 0) return -9999;
        const d = di();
        if (!d) return isVert.value ? plotBottom.value : -9999;
        return isVert.value ? (valueScale.value as any)(d.value) : (bandScale.value(String(idx)) ?? 0);
      });
      const barWTarget = derive(() => {
        const d = di();
        if (!d) return 0;
        return isVert.value ? bandScale.value.bandwidth() : Math.max(0, (valueScale.value as any)(d.value) - plotX.value);
      });
      const barHTarget = derive(() => {
        const d = di();
        if (!d) return 0;
        return isVert.value ? Math.max(0, plotBottom.value - (valueScale.value as any)(d.value)) : bandScale.value.bandwidth();
      });

      // Tweened cells — gate: tween on orientation/measure/sort, snap on value edit.
      // Position (x, w) and value (y, h) have SEPARATE tween cancellations.
      // During a cross-tile drag (scatter editing a shared value), the dragged
      // bar's value changes every frame but sort order only changes sometimes.
      // A single combined tween would snap ALL properties on non-structural
      // frames, killing the position tween mid-animation (jump). Splitting
      // lets the position tween survive value-only snaps.
      const barX = num(barXTarget.value);
      const barY = num(barYTarget.value);
      const barW = num(barWTarget.value);
      const barH = num(barHTarget.value);
      let posCancel: (() => void) | null = null;
      let valCancel: (() => void) | null = null;
      let inited = false;
      let seenOrient = untracked(() => this._orientationCell.value);
      let seenMeasureKey = untracked(() => this._measureKeyCell.value);
      let seenOrder = untracked(() => orderHash.value);
      biEffect(() => {
        const xt = barXTarget.value, yt = barYTarget.value, wt = barWTarget.value, ht = barHTarget.value;
        const orient = this._orientationCell.value;
        const measureKey = untracked(() => this._measureKeyCell.value);
        const order = orderHash.value;
        if (!inited) {
          inited = true; seenOrient = orient; seenMeasureKey = measureKey; seenOrder = order;
          barX.value = xt; barY.value = yt; barW.value = wt; barH.value = ht;
          return;
        }
        const structural = orient !== seenOrient || measureKey !== seenMeasureKey || order !== seenOrder;
        seenOrient = orient; seenMeasureKey = measureKey; seenOrder = order;
        if (structural && !this.classList.contains(GESTURE_ACTIVE_CLASS)) {
          posCancel?.();
          valCancel?.();
          posCancel = this.anim.start(
            tween(barX, xt, SORT_SEC, easeInOut) as any,
            tween(barW, wt, SORT_SEC, easeInOut) as any,
          );
          valCancel = this.anim.start(
            tween(barY, yt, SORT_SEC, easeInOut) as any,
            tween(barH, ht, SORT_SEC, easeInOut) as any,
          );
        } else if (this.classList.contains(GESTURE_ACTIVE_CLASS)) {
          // This bar is being directly gestured — snap everything.
          posCancel?.(); posCancel = null;
          valCancel?.(); valCancel = null;
          barX.value = xt; barY.value = yt; barW.value = wt; barH.value = ht;
        } else {
          // Value edit (not structural, not gesturing): snap value props,
          // let position tween continue. Without this split, the snap would
          // cancel the position tween mid-animation, causing the dragged
          // bar to jump while other bars (whose gates only fire on sort
          // changes) tween smoothly.
          valCancel?.(); valCancel = null;
          barY.value = yt; barH.value = ht;
          if (!posCancel) { barX.value = xt; barW.value = wt; }
        }
      });

      const fill = derive(() => { const d = di(); return selected.value === d ? "#fff" : hover.value === d ? hoverColor : base; });
      const labelFill = derive(() => { const d = di(); return selected.value === d ? base : "#fff"; });

      const tile = s(rect(barX, barY, barW, barH, { fill, corner: 2 }));
      tileElements.set(datumId, tile.el);
      biEffect(() => { tile.el.style.cursor = isVert.value ? "ns-resize" : "ew-resize"; });
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

      // Bar center — used by labels and handle.
      const barCX = derive(() => barX.value + barW.value / 2);
      const barCY = derive(() => barY.value + barH.value / 2);
      const minBand = this.minBandSize || 60;

      // ─── Category label (axis / both mode) — tweened position ───────────
      if (this.labelMode === 'axis' || this.labelMode === 'both') {
        const catPos = Vec.derive(() => {
          if (isVert.value) return { x: barCX.value, y: plotBottom.value + 16 };
          return { x: plotX.value - 6, y: barCY.value };
        });
        const catLbl = s(label(catPos, derive(() => di()?.label ?? ""),
          { size: 10, fill: "#888", opacity: 0.8 }));
        biEffect(() => {
          const a = isVert.value ? Anchor.Center : Anchor.Right;
          catLbl.el.setAttribute('text-anchor', xAnchor(a.x));
          catLbl.el.setAttribute('dominant-baseline', yAnchor(a.y));
        });
      }

      // ─── Inside label (inside / both mode) ──────────────────────────────
      if (this.labelMode === 'inside' || this.labelMode === 'both') {
        const insideOpacity = derive(() => (isVert.value ? barH.value : barW.value) >= minBand ? 1 : 0);
        const insidePos = Vec.derive(() => {
          if (isVert.value) return { x: barCX.value, y: barY.value + 14 };
          return { x: plotX.value + 8, y: barCY.value };
        });
        const inLbl = s(label(insidePos, derive(() => di()?.label ?? ""),
          { size: 10, fill: labelFill, opacity: insideOpacity }));
        biEffect(() => {
          const a = isVert.value ? Anchor.Center : Anchor.Left;
          inLbl.el.setAttribute('text-anchor', xAnchor(a.x));
          inLbl.el.setAttribute('dominant-baseline', yAnchor(a.y));
        });
      }

      // ─── Value label ────────────────────────────────────────────────────
      if (this.valueMode !== 'none') {
        if (this.valueMode === 'inside') {
          const insideOpacity = derive(() => (isVert.value ? barH.value : barW.value) >= minBand ? 1 : 0);
          const valPos = Vec.derive(() => {
            if (isVert.value) return { x: barCX.value, y: barY.value + 14 };
            return { x: plotX.value + barW.value - 8, y: barCY.value };
          });
          const vLbl = s(label(valPos, derive(() => { const d = di(); return d ? `${Math.round(d.value)}` : ""; }),
            { size: 11, fill: labelFill, opacity: insideOpacity }));
          biEffect(() => {
            const a = isVert.value ? Anchor.Center : Anchor.Right;
            vLbl.el.setAttribute('text-anchor', xAnchor(a.x));
            vLbl.el.setAttribute('dominant-baseline', yAnchor(a.y));
          });
          // Fallback outside when bar too short.
          const outsideOpacity = derive(() => (isVert.value ? barH.value : barW.value) < minBand ? 1 : 0);
          const outPos = Vec.derive(() => {
            if (isVert.value) return { x: barCX.value, y: barY.value - 6 };
            return { x: plotX.value + barW.value + 6, y: barCY.value };
          });
          const oLbl = s(label(outPos, derive(() => { const d = di(); return d ? `${Math.round(d.value)}` : ""; }),
            { size: 11, fill: "#aaa", opacity: outsideOpacity }));
          biEffect(() => {
            const a = isVert.value ? Anchor.Center : Anchor.Left;
            oLbl.el.setAttribute('text-anchor', xAnchor(a.x));
            oLbl.el.setAttribute('dominant-baseline', yAnchor(a.y));
          });
        } else {
          // Outside mode — label beyond bar end.
          const outPos = Vec.derive(() => {
            if (isVert.value) return { x: barCX.value, y: barY.value - 6 };
            return { x: plotX.value + barW.value + 6, y: barCY.value };
          });
          const oLbl = s(label(outPos, derive(() => { const d = di(); return d ? `${Math.round(d.value)}` : ""; }),
            { size: 11, fill: "#888", opacity: derive(() => (isVert.value ? barH.value : barW.value) > 0 ? 1 : 0) }));
          biEffect(() => {
            const a = isVert.value ? Anchor.Center : Anchor.Left;
            oLbl.el.setAttribute('text-anchor', xAnchor(a.x));
            oLbl.el.setAttribute('dominant-baseline', yAnchor(a.y));
          });
        }
      }

      // ─── Drag handle at bar's value-end ─────────────────────────────────
      const handlePos = Vec.derive(() => {
        if (isVert.value) return { x: barCX.value, y: barY.value };
        return { x: plotX.value + barW.value, y: barCY.value };
      });
      const handleOpacity = derive(() => { const d = di(); return (hover.value === d || selected.value === d) ? 1 : 0; });
      const handle = s(circle(handlePos, derive(() => { const d = di(); return selected.value === d ? 6 : 5; }), {
        fill: derive(() => { const d = di(); return selected.value === d ? "#fff" : hoverColor; }),
        stroke: "#0b0d12", strokeWidth: 1.5, opacity: handleOpacity,
      }));
      handle.el.style.transition = hoverTransition("opacity");
      biEffect(() => { handle.el.style.cursor = isVert.value ? "ns-resize" : "ew-resize"; });
      handle.el.addEventListener("pointerenter", () => { const d = di(); if (!wheelController.active && d) hover.value = d; });
      handle.el.addEventListener("pointerleave", () => { const d = di(); if (!wheelController.active && d && hover.value === d) hover.value = null; });
    }

    // ─── Status label ─────────────────────────────────────────────────────
    s(label(Vec.derive(() => ({ x: Wc.value / 2, y: 8 })), derive(() => {
      const p = selected.value ?? hover.value;
      if (!p) return "Bar — hover · click · navigate · edit · ctrl+wheel · drag end";
      return `${p.label}  ${p.value}`;
    }), { size: 11, align: Anchor.Center, opacity: 0.7 }));

    // ─── Cross-tile sync bridge ───────────────────────────────────────────
    this.#bridge(data, hover, selected);
  }

  #bridge(data: ReturnType<typeof cell<readonly Bar[]>>, hover: ReturnType<typeof cell<Bar | null>>, selected: ReturnType<typeof cell<Bar | null>>) {
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
