// BarChart — unified bar chart with composable display options.
// orientation: vertical | horizontal  (reactive — morphs on change)
// colorMode:   single (one accent color) | palette (per-bar PALETTE colors)
// labelMode:   axis (category labels on axis only) | inside (inside bar) | both
// valueMode:   inside (inside bar) | outside (beyond bar end) | none
// minBandSize: minimum px for a band before touch target is clamped (0 = scale freely)
//
// Uses CartesianChartBase with CSS transitions for settle (sort/orientation/
// measure swap). transitionOnUpdated owns the gesture-active class and the
// settle CSS on rect attrs. Reorder uses REORDER_ACTIVE_CLASS + ghost transform.

import { Anchor, cell, circle, derive, effect as biEffect, forEach, label, line, rect, Vec } from "bireactive";
import { CartesianChartBase, type CartesianConfig, type FlatItem } from "../cartesian/cartesian-chart-base";
import { scaleLinear, scaleBand } from "d3-scale";
import { FILL_STYLE } from "../lib/host-size";
import { GESTURE_ACTIVE_CLASS, GESTURE_SUPPRESSION_CSS, REORDER_ELEVATION_CSS } from "../lib/transitions";
import { motion } from "../lib/runtime-config";
import { lightenHex } from "../lib/color-utils";
import { dragController } from "../lib/interaction";
import { attachReorderGesture } from "../lib/reorder-gesture";
import { transitionOnUpdated } from "../hierarchical/behaviors/transition-on-updated";
import { PALETTE, type ColorStrategy, getColorByStrategy } from "@hotbook/core";

const W = 720;
const H = 360;
const SINGLE_COLOR = "#7aaae8";

interface Bar extends FlatItem { id: string; label: string; value: number; }

function makeData(): Bar[] {
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return labels.map((l) => ({ id: l, label: l, value: Math.round(20 + Math.random() * 80) }));
}

const V_PAD = { top: 16, right: 24, bottom: 36, left: 48 };
const H_PAD = { top: 16, right: 64, bottom: 36, left: 16 };
const V_BAR_STEP = 56;
const H_BAND_STEP = 44;
const LABEL_PAD = 8;
const VALUE_PAD = 8;
const VALUE_GAP = 4;
const OUT_GAP = 8;

const xAnchor = (x: number) => (x <= 0.25 ? "start" : x >= 0.75 ? "end" : "middle");
const yAnchor = (y: number) => (y <= 0.25 ? "hanging" : y >= 0.75 ? "alphabetic" : "central");

// Inject chart-specific styles (no shadow DOM — light DOM + document styles).
const BAR_CSS = `
text { pointer-events: none; }
${FILL_STYLE}
${GESTURE_SUPPRESSION_CSS}
.${GESTURE_ACTIVE_CLASS} * { transition: none !important; }
${REORDER_ELEVATION_CSS}
[data-focusable]:focus { outline: 2px solid #4a9eff; outline-offset: 2px; }
[data-focusable]:focus:not(:focus-visible) { outline: none; }
`;
let barCssInjected = false;
function ensureBarCss() {
  if (typeof document === "undefined" || barCssInjected) return;
  barCssInjected = true;
  const style = document.createElement("style");
  style.id = "vf-bar-chart";
  style.textContent = BAR_CSS;
  document.head.appendChild(style);
}

export class MdBarChartLC extends CartesianChartBase {
  readonly dataCell = cell<readonly Bar[]>(makeData());

  private _orientationCell = cell<'vertical' | 'horizontal'>('vertical');
  get orientation(): 'vertical' | 'horizontal' { return this._orientationCell.value }
  set orientation(v: 'vertical' | 'horizontal') { this._orientationCell.value = v }

  private _measureKeyCell = cell<string>('');
  get measureKey(): string { return this._measureKeyCell.value }
  set measureKey(v: string) { this._measureKeyCell.value = v }
  get valueBinding(): string { return this.measureKey }
  set valueBinding(v: string) { this.measureKey = v }

  colorMode: 'single' | 'palette' = 'palette';
  colorStrategy: ColorStrategy = 'index';
  labelMode: 'axis' | 'inside' | 'both' = 'axis';
  valueMode: 'inside' | 'outside' | 'none' = 'outside';

  private _canReorderCell = cell<boolean>(false);
  get canReorder(): boolean { return this._canReorderCell.value }
  set canReorder(v: boolean) { this._canReorderCell.value = v }
  onReorder?: (orderedIds: string[]) => void
  minBandSize: number = 0;
  maxBands: number = 10;
  maxBars: number = 10;

  set externalData(v: { label: string; value: number }[] | undefined) {
    if (v) {
      const bars = v.map((d, i) => ({ id: (d as any).id ?? d.label, label: d.label, value: d.value }));
      this.dataCell.value = bars;
      this.items = bars;
    }
  }
  get externalData(): { label: string; value: number }[] | undefined {
    return this.dataCell.value as Bar[];
  }

  // Override base class value accessors to use the bar chart's own dataCell
  // (the base class _dataCell is synced from dataCell but writeValue needs to
  // write back to dataCell so the rendering re-derives).
  override valueOf = (id: string): number => {
    const item = this.dataCell.value.find((d) => d.id === id);
    return item ? item.value : 0;
  };
  override writeValue = (id: string, value: number): void => {
    const items = this.dataCell.value as Bar[];
    const item = items.find((d) => d.id === id);
    if (item) {
      item.value = value;
      this.dataCell.value = [...items];
    }
  };
  override siblings = (id: string): string[] => {
    return this.dataCell.value.filter((d) => d.id !== id).map((d) => d.id);
  };
  override restore = (): void => {
    if (this._gesture?.store.snapshot) {
      const items = this.dataCell.value as Bar[];
      for (const item of items) {
        const snap = this._gesture!.store.snapshot.get(item.id);
        if (snap !== undefined) item.value = snap;
      }
      this.dataCell.value = [...items];
    }
  };

  // Keep base class _dataCell in sync with dataCell (so base class methods
  // like restore() work correctly).
  private _dataSyncDispose: (() => void) | null = null;

  /** Current value scale (set in _setupRendering, read by the wheel behavior
   *  in _composeBehaviors). Maps pixel position → value space so ctrl+wheel
   *  uses the same mechanics as dragging the handle. */
  protected _valueScale?: any;

  #barColor(idx: number, datum?: Bar): string {
    if (this.colorMode === 'single') return SINGLE_COLOR;
    const max = Math.max(1, ...this.dataCell.value.map(d => d.value));
    return getColorByStrategy(this.colorStrategy, {
      index: idx, value: datum?.value, identity: datum?.id ?? datum?.label,
      singleColor: SINGLE_COLOR, palette: PALETTE, valueScale: (v) => v / max,
    });
  }
  #hoverColor(idx: number, datum?: Bar): string {
    return lightenHex(this.#barColor(idx, datum), 0.35);
  }

  connectedCallback() {
    super.connectedCallback();
    // Set a default config so the base class _build() effect fires and
    // composes behaviors. The bar chart uses direct properties (orientation,
    // colorMode, etc.) for rendering, but the Gesture/Editor lifecycle needs
    // a config to start.
    if (!this._configCell.value) {
      this._configCell.value = {
        sort: "index",
        orientation: this._orientationCell.value,
        canReorder: this._canReorderCell.value,
        conservationMode: "additive",
      };
    }
  }

  protected _setupRendering(): void {
    ensureBarCss();
    const s = this._s;
    const { w: Wc, h: Hc } = this._hostSize!;

    // Sync dataCell → base _dataCell (so valueOf/writeValue work).
    this._dataSyncDispose?.();
    this._dataSyncDispose = biEffect(() => { this._dataCell.value = this.dataCell.value; });
    this._setupDisposers.push(() => this._dataSyncDispose?.());

    const data = this.dataCell;
    const isVert = derive(() => this._orientationCell.value === 'vertical');

    // ─── Padding + plot area ──────────────────────────────────────────────
    const leftRoom = cell(H_PAD.left);
    const labelWidths: any[] = [];
    const PAD = derive(() => isVert.value ? V_PAD : { ...H_PAD, left: leftRoom.value });
    const plotX = derive(() => PAD.value.left);
    const plotY = derive(() => PAD.value.top);
    const plotW = derive(() => Wc.value - PAD.value.left - PAD.value.right);
    const plotH = derive(() => Hc.value - PAD.value.top - PAD.value.bottom);
    const plotBottom = derive(() => plotY.value + plotH.value);
    const plotRight = derive(() => plotX.value + plotW.value);

    // ─── Overflow mode ────────────────────────────────────────────────────
    const overflowMode = derive(() => {
      const n = data.value.length;
      return isVert.value ? (this.maxBars > 0 && n > this.maxBars) : (this.maxBands > 0 && n > this.maxBands);
    });
    const STEP = derive(() => {
      const isV = isVert.value;
      const maxItems = isV ? this.maxBars : this.maxBands;
      const pad = PAD.value;
      const avail = isV
        ? Math.max(1, Wc.value - pad.left - pad.right)
        : Math.max(1, Hc.value - pad.top - pad.bottom);
      return maxItems > 0 ? avail / maxItems : (isV ? V_BAR_STEP : H_BAND_STEP);
    });
    const neededBand = derive(() => PAD.value.left + PAD.value.right + data.value.length * STEP.value);
    const neededOrtho = derive(() => PAD.value.top + PAD.value.bottom + data.value.length * STEP.value);

    const viewW = derive(() => overflowMode.value && isVert.value ? neededBand.value : Wc.value);
    const viewH = derive(() => overflowMode.value && !isVert.value ? neededOrtho.value : Hc.value);
    const svgEl = this._svg!;

    // Gesture-suppression class toggle (light-DOM: vf-gesture-active on host).
    const setGestureActive = (on: boolean) => this.classList.toggle(GESTURE_ACTIVE_CLASS, on);
    // Convert a pointer event's client coords into the SVG viewBox coordinate space.
    const localPoint = (e: PointerEvent): { x: number; y: number } => {
      const r = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox?.baseVal;
      const sx = vb && vb.width ? vb.width / r.width : 1;
      const sy = vb && vb.height ? vb.height / r.height : 1;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    };
    biEffect(() => {
      this._setViewBox(viewW.value, viewH.value);
      const om = overflowMode.value, iv = isVert.value;
      const pan = om ? (iv ? 'pan-x' : 'pan-y') : 'none';
      this.style.touchAction = pan;
      svgEl.style.touchAction = pan;
      svgEl.style.flex = om ? '0 0 auto' : '1 1 0';
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

    const effPlotW = derive(() => overflowMode.value && isVert.value ? neededBand.value - PAD.value.left - PAD.value.right : plotW.value);
    const effPlotH = derive(() => overflowMode.value && !isVert.value ? neededOrtho.value - PAD.value.top - PAD.value.bottom : plotH.value);

    // ─── Scales ───────────────────────────────────────────────────────────
    const bandScale = derive(() => {
      const isV = isVert.value;
      const range = isV ? [plotX.value, plotX.value + effPlotW.value] : [plotY.value, plotY.value + effPlotH.value];
      return scaleBand<string>().domain(data.value.map((_, i) => String(i))).range(range).padding(isV ? 0.25 : 0.15);
    });
    const valueScale = derive(() => {
      const max = Math.max(1, ...data.value.map(d => d.value));
      const isV = isVert.value;
      const range = isV ? [plotY.value + effPlotH.value, plotY.value] : [plotX.value, plotX.value + effPlotW.value];
      return scaleLinear().domain([0, max]).range(range).nice();
    });
    this._valueScale = valueScale;

    // ─── Value axis ticks ─────────────────────────────────────────────────
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
      s(line(
        Vec.derive(() => isVert.value ? { x: plotX.value, y: pos.value } : { x: pos.value, y: plotBottom.value }),
        Vec.derive(() => isVert.value ? { x: plotX.value - 4, y: pos.value } : { x: pos.value, y: plotBottom.value + 4 }),
        { thin: true, stroke: "#888", opacity: tickOpacity },
      ));
      const tlbl = s(label(
        Vec.derive(() => isVert.value ? { x: plotX.value - 8, y: pos.value } : { x: pos.value, y: plotBottom.value + 16 }),
        text, { size: 10, fill: "#888", opacity: labelOpacity },
      ));
      biEffect(() => {
        const a = isVert.value ? Anchor.Right : Anchor.Center;
        tlbl.el.setAttribute('text-anchor', xAnchor(a.x));
        tlbl.el.setAttribute('dominant-baseline', yAnchor(a.y));
      });
    }
    // Value axis baseline.
    s(line(
      Vec.derive(() => isVert.value ? { x: plotX.value, y: plotY.value } : { x: plotX.value, y: plotBottom.value }),
      Vec.derive(() => isVert.value ? { x: plotX.value, y: plotBottom.value } : { x: plotRight.value, y: plotBottom.value }),
      { thin: true, opacity: 0.5, stroke: "#888" },
    ));
    // Category axis baseline.
    s(line(
      Vec.derive(() => isVert.value ? { x: plotX.value, y: plotBottom.value } : { x: plotX.value, y: plotY.value }),
      Vec.derive(() => isVert.value ? { x: plotRight.value, y: plotBottom.value } : { x: plotX.value, y: plotBottom.value }),
      { thin: true, opacity: 0.5, stroke: "#888" },
    ));

    // ─── Highlight rect (hover/focus background) ───────────────────────────
    const hlTarget = derive(() => this._hoverCell.value ?? this._focusCell.value);
    const hlX = derive(() => {
      const t = hlTarget.value; if (!t) return -9999;
      const i = data.value.findIndex(d => d.id === t);
      if (i < 0) return -9999;
      const bs = bandScale.value; const bp = bs(String(i)) ?? 0;
      const pad = (bs.step() - bs.bandwidth()) / 2;
      return isVert.value ? bp - pad : plotX.value;
    });
    const hlY = derive(() => {
      const t = hlTarget.value; if (!t) return -9999;
      const i = data.value.findIndex(d => d.id === t);
      if (i < 0) return -9999;
      const bs = bandScale.value; const bp = bs(String(i)) ?? 0;
      const pad = (bs.step() - bs.bandwidth()) / 2;
      return isVert.value ? plotY.value : bp - pad;
    });
    const hlW = derive(() => {
      if (!isVert.value) return plotW.value;
      const t = hlTarget.value; if (!t) return 0;
      const i = data.value.findIndex(d => d.id === t);
      return i < 0 ? 0 : bandScale.value.step();
    });
    const hlH = derive(() => {
      if (isVert.value) return plotH.value;
      const t = hlTarget.value; if (!t) return 0;
      const i = data.value.findIndex(d => d.id === t);
      return i < 0 ? 0 : bandScale.value.step();
    });
    const hlRect = s(rect(hlX, hlY, hlW, hlH, {
      fill: "#ffffff", opacity: derive(() => hlTarget.value ? 0.06 : 0),
    }));
    hlRect.el.style.transition = `x ${motion.hoverMs.value}ms ease, y ${motion.hoverMs.value}ms ease, opacity ${motion.hoverMs.value}ms ease`;
    hlRect.el.style.pointerEvents = "none";

    // ─── Bars — identity-keyed via forEach, CSS transitions for settle ──────
    // CSS transitions on rect attrs animate the settle; gesture-active class
    // suppresses transitions during value edits.

    // Provisional order for reorder: when set, bars read their index from
    // this array instead of data.value. Siblings' derive cells re-evaluate
    // → setAttribute fires once → CSS transitions animate them to new slots.
    // Cleared on commit (data.value is the new truth) or cancel (reverts).
    const provisionalOrder = cell<string[] | null>(null);

    // Per-bar handles hoisted for the reorder gesture (ghost transform
    // needs to reach into any bar to apply the pointer offset).
    interface BarCells {
      tileEl: SVGRectElement;
      di: () => Bar | null;
    }
    const barCells = new Map<string, BarCells>();
    const tileElements = new Map<string, SVGGElement>();

    const barsResult = forEach(this._rootShape, data, (datum, idx) => {
      const cur = derive(() => {
        const po = provisionalOrder.value;
        if (po) return po.findIndex(id => id === datum.id);
        return data.value.findIndex(d => d.id === datum.id);
      });
      // Look up the datum by ID, NOT by cur index. cur is a POSITION index
      // (into provisionalOrder during reorder, into data.value otherwise) —
      // using it for data lookup would swap bar identities during reorder.
      const datumCell = derive(() => {
        const arr = data.value;
        for (let i = 0; i < arr.length; i++) if (arr[i].id === datum.id) return arr[i];
        return null;
      });
      const di = (): Bar | null => datumCell.value;

      const baseColor = (): string => { const d = di(); return d ? this.#barColor(cur.value, d) : SINGLE_COLOR; };
      const hoverBaseColor = (): string => { const d = di(); return d ? this.#hoverColor(cur.value, d) : lightenHex(SINGLE_COLOR, 0.35); };

      // Bar geometry — direct derive cells. CSS transitions (via
      // transitionOnUpdated) handle the settle animation: setAttribute fires
      // once, the browser animates. During gestures, gesture-active class
      // suppresses transitions so values snap.
      const barX = derive(() => {
        const i = cur.value; if (i < 0) return -9999;
        return isVert.value ? (bandScale.value(String(i)) ?? 0) : plotX.value;
      });
      const barY = derive(() => {
        const i = cur.value; if (i < 0) return -9999;
        const d = di(); if (!d) return isVert.value ? plotBottom.value : -9999;
        return isVert.value ? (valueScale.value as any)(d.value) : (bandScale.value(String(i)) ?? 0);
      });
      const barW = derive(() => {
        const d = di(); if (!d) return 0;
        return isVert.value ? Math.max(0, bandScale.value.bandwidth()) : Math.max(0, (valueScale.value as any)(d.value) - plotX.value);
      });
      const barH = derive(() => {
        const d = di(); if (!d) return 0;
        return isVert.value ? Math.max(0, plotBottom.value - (valueScale.value as any)(d.value)) : Math.max(0, bandScale.value.bandwidth());
      });

      const fill = derive(() => {
        const d = di(); const id = d?.id;
        if (id && this._focusCell.value === id) return "#fff";
        if (id && this._hoverCell.value === id) return hoverBaseColor();
        return baseColor();
      });
      const labelFill = derive(() => {
        const d = di(); const id = d?.id;
        if (id && this._focusCell.value === id) return baseColor();
        return "#fff";
      });

      const tile = s(rect(barX, barY, barW, barH, { fill, corner: 2 }));
      tile.el.style.touchAction = "none";
      // CSS transitions on rect attrs (x/y/width/height) handle settle
      // animation via transitionOnUpdated. During gestures the gesture-active
      // class suppresses transitions so values snap.
      tileElements.set(datum.id, tile.el as unknown as SVGGElement);
      barCells.set(datum.id, { tileEl: tile.el as SVGRectElement, di });
      biEffect(() => {
        tile.el.style.cursor = this._canReorderCell.value
          ? 'grab' : (isVert.value ? "ns-resize" : "ew-resize");
      });
      tile.el.setAttribute('tabindex', '0');
      tile.el.setAttribute('data-focusable', 'bar');
      tile.el.setAttribute('data-id', datum.id);
      biEffect(() => {
        const d = di();
        if (d) tile.el.setAttribute('aria-label', `${d.label}: ${Math.round(d.value)}`);
      });
      tile.el.addEventListener("pointerenter", () => { const d = di(); if (d) this.setHover(d.id); });
      tile.el.addEventListener("pointerleave", () => { const d = di(); if (d && this._hoverCell.value === d.id) this.setHover(null); });
      tile.el.addEventListener("click", () => {
        const d = di(); if (!d) return;
        this.setFocus(this._focusCell.value === d.id ? null : d.id);
      });
      tile.el.addEventListener("focus", () => { const d = di(); if (d) this.setFocus(d.id); });
      tile.el.addEventListener("blur", () => { const d = di(); if (d && this._focusCell.value === d.id) this.setFocus(null); });

      // Bar center — used by labels and handle.
      const barCX = derive(() => barX.value + barW.value / 2);
      const barCY = derive(() => barY.value + barH.value / 2);
      const minBand = this.minBandSize || 60;

      const labelWidth = cell(0);
      const valueWidth = cell(0);
      labelWidths.push(labelWidth);
      let labelPopped: any = null;
      let valuePopped: any = null;
      let inLbl: any = null;
      let vLbl: any = null;
      let catLbl: any = null;

      // ─── Category label ────────────────────────────────────────────────
      if (this.labelMode === 'axis' || this.labelMode === 'both') {
        const catPos = Vec.derive(() => isVert.value
          ? { x: barCX.value, y: plotBottom.value + 16 }
          : { x: plotX.value - 6, y: barCY.value });
        catLbl = tile.add(label(catPos, derive(() => di()?.label ?? ""), { size: 10, fill: "#888", opacity: 0.8 }));
        biEffect(() => {
          const a = isVert.value ? Anchor.Center : Anchor.Right;
          catLbl.intrinsic!.setAttribute('text-anchor', xAnchor(a.x));
          catLbl.intrinsic!.setAttribute('dominant-baseline', yAnchor(a.y));
        });
      }

      // ─── Inside label ──────────────────────────────────────────────────
      if (this.labelMode === 'inside' || this.labelMode === 'both') {
        labelPopped = derive(() => {
          if (isVert.value) return barH.value < minBand;
          if (this.valueMode !== 'inside') return labelWidth.value + LABEL_PAD > barW.value;
          const unitWidth = labelWidth.value + VALUE_GAP + valueWidth.value;
          return unitWidth + VALUE_PAD + LABEL_PAD > barW.value;
        });
        const inFill = derive(() => labelPopped.value ? "#888" : labelFill.value);
        const inOpacity = derive(() => isVert.value ? (labelPopped.value ? 0 : 1) : 1);
        const inPos = Vec.derive(() => {
          if (isVert.value) return { x: barCX.value, y: barY.value + 14 };
          if (labelPopped.value) return { x: barX.value + barW.value + OUT_GAP, y: barCY.value };
          return { x: barX.value + LABEL_PAD, y: barCY.value };
        });
        inLbl = tile.add(label(inPos, derive(() => di()?.label ?? ""), { size: 10, fill: inFill, opacity: inOpacity }));
      }

      // ─── Value label ───────────────────────────────────────────────────
      if (this.valueMode !== 'none') {
        valuePopped = this.valueMode === 'outside'
          ? derive(() => true)
          : derive(() => {
            if (isVert.value) return barH.value < minBand;
            if (labelPopped) return labelPopped.value;
            return valueWidth.value + VALUE_PAD > barW.value;
          });
        const vFill = derive(() => valuePopped.value
          ? (this.valueMode === 'outside' ? "#888" : "#aaa")
          : labelFill.value);
        const vPos = Vec.derive(() => {
          if (isVert.value) {
            const labelVisible = labelPopped && !labelPopped.value;
            return { x: barCX.value, y: valuePopped.value ? barY.value - OUT_GAP : (barY.value + (labelVisible ? 28 : 14)) };
          }
          if (valuePopped.value) {
            if (labelPopped && labelPopped.value) {
              return { x: barX.value + barW.value + OUT_GAP + labelWidth.value + VALUE_GAP, y: barCY.value };
            }
            return { x: barX.value + barW.value + OUT_GAP, y: barCY.value };
          }
          return { x: barX.value + barW.value - VALUE_PAD, y: barCY.value };
        });
        vLbl = tile.add(label(vPos, derive(() => { const d = di(); return d ? `${Math.round(d.value)}` : ""; }), { size: 11, fill: vFill, opacity: 1 }));
      }

      // ─── Measure text widths + alignment ───────────────────────────────
      if (inLbl || vLbl || catLbl) {
        biEffect(() => {
          di();
          if (inLbl) labelWidth.value = (inLbl.intrinsic as SVGTextElement).getComputedTextLength();
          else if (catLbl) labelWidth.value = (catLbl.intrinsic as SVGTextElement).getComputedTextLength();
          if (vLbl) valueWidth.value = (vLbl.intrinsic as SVGTextElement).getComputedTextLength();
        });
        biEffect(() => {
          if (inLbl && labelPopped) {
            const a = isVert.value ? Anchor.Center : Anchor.Left;
            inLbl.intrinsic.setAttribute('text-anchor', xAnchor(a.x));
            inLbl.intrinsic.setAttribute('dominant-baseline', yAnchor(a.y));
          }
          if (vLbl && valuePopped) {
            const a = isVert.value ? Anchor.Center : (valuePopped.value ? Anchor.Left : Anchor.Right);
            vLbl.intrinsic.setAttribute('text-anchor', xAnchor(a.x));
            vLbl.intrinsic.setAttribute('dominant-baseline', yAnchor(a.y));
          }
        });
      }

      // ─── Drag handle at bar's value-end ────────────────────────────────
      const handlePos = Vec.derive(() => isVert.value
        ? { x: barCX.value, y: barY.value }
        : { x: plotX.value + barW.value, y: barCY.value });
      const handleOpacity = derive(() => {
        const d = di(); const id = d?.id;
        return (id && this._hoverCell.value === id) || (id && this._focusCell.value === id) ? 1 : 0;
      });
      const handle = tile.add(circle(handlePos, derive(() => {
        const d = di(); const id = d?.id;
        return id && this._focusCell.value === id ? 6 : 5;
      }), {
        fill: derive(() => { const d = di(); const id = d?.id; return id && this._focusCell.value === id ? "#fff" : hoverBaseColor(); }),
        stroke: "#0b0d12", strokeWidth: 1.5, opacity: handleOpacity,
      }));
      handle.el.style.transition = `opacity ${motion.hoverMs.value}ms ease`;
      handle.el.style.touchAction = "none";
      biEffect(() => { handle.el.style.cursor = isVert.value ? "ns-resize" : "ew-resize"; });
      handle.el.addEventListener("pointerenter", () => { const d = di(); if (d) this.setHover(d.id); });
      handle.el.addEventListener("pointerleave", () => { const d = di(); if (d && this._hoverCell.value === d.id) this.setHover(null); });

      // ─── Drag handle → value resize (both orientations) ────────────────
      // Uses the shared dragController (one live drag at a time). The value
      // delta is computed in the gesture-START scale so mid-drag domain
      // re-derivation can't cause spikes. GESTURE_ACTIVE_CLASS suppresses
      // CSS settle transitions on siblings while the drag is live.
      let handleStartPx = 0;
      let handleStartScale: any = null;
      let handlePointerId = -1;
      const onHandleMove = (pe: PointerEvent, snap: { origValue: number; startPx: number; startScale: any }) => {
        const d = di(); if (!d) return;
        const px = isVert.value ? localPoint(pe).y : localPoint(pe).x;
        const valueDelta = snap.startScale.invert(px) - snap.startScale.invert(snap.startPx);
        this.writeValue(d.id, Math.max(0, snap.origValue + valueDelta));
      };
      const handleDragConfig = {
        snapshot: (_d: Bar) => ({
          origValue: di()?.value ?? 0,
          startPx: handleStartPx,
          startScale: handleStartScale,
        }),
        restore: (_d: Bar, snap: { origValue: number }) => { const d = di(); if (d) this.writeValue(d.id, snap.origValue); },
        onMove: onHandleMove,
        onEnd: (canceled: boolean) => {
          if (handlePointerId >= 0 && (this as any).hasPointerCapture?.(handlePointerId)) {
            (this as any).releasePointerCapture(handlePointerId);
          }
          handlePointerId = -1;
          handleStartPx = 0;
          handleStartScale = null;
          this.style.cursor = "";
          setGestureActive(false);
          this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled } }));
        },
      };
      handle.el.addEventListener("pointerdown", (e: PointerEvent) => {
        if (dragController.active) return;
        const d = di(); if (!d) return;
        handlePointerId = e.pointerId;
        const lp = localPoint(e);
        handleStartPx = isVert.value ? lp.y : lp.x;
        handleStartScale = valueScale.value;
        this.style.cursor = isVert.value ? "ns-resize" : "ew-resize";
        setGestureActive(true);
        try { handle.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        dragController.begin(d, handleDragConfig);
        e.preventDefault();
        e.stopPropagation();
      });

      // ─── Drag bar body → reorder (when canReorder) ────────────────────
      // attachReorderGesture owns the activation threshold (below = click),
      // elevation + DOM raise of the dragged tile, and the REORDER_ACTIVE_CLASS
      // toggle. Siblings slide via CSS transitions (provisionalOrder cell →
      // derive re-evaluates → setAttribute → CSS animates). Ghost follows
      // pointer via CSS transform. Commit sets data.value; cancel clears
      // provisionalOrder → siblings slide back via CSS.
      let startBandCoord = 0;
      let startPointerBand = Number.NaN;
      let ghostEl: SVGGraphicsElement | null = null;
      let prevGhostTransition = "";

      const eventBand = (e: PointerEvent): number => {
        const { x, y } = localPoint(e);
        return isVert.peek() ? x : y;
      };

      const reorderDetach = attachReorderGesture({
        hitEl: tile.el as unknown as SVGElement,
        dragEl: tile.el as unknown as SVGElement,
        itemId: datum.id,
        host: this,
        filter: () => this._canReorderCell.value,
        getInitialOrder: () => (data.peek() as Bar[]).map((d) => d.id),
        computeTargetIndex: (e: PointerEvent, order: readonly string[]) => {
          const bs = bandScale.peek();
          const p = eventBand(e);
          // Ghost's band-axis center = its initial center + pointer delta.
          const ghostCenter = startBandCoord + bs.bandwidth() / 2 + (p - startPointerBand);
          // Find the slot whose center is nearest to the ghost center.
          const N = order.length;
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let i = 0; i < N; i++) {
            const slotCenter = (bs(String(i)) ?? 0) + bs.bandwidth() / 2;
            const dist = Math.abs(slotCenter - ghostCenter);
            if (dist < bestDist) { bestDist = dist; bestIdx = i; }
          }
          return bestIdx;
        },
        onActivate: () => {
          const bs = bandScale.peek();
          const initialIdx = (data.peek() as Bar[]).findIndex(d => d.id === datum.id);
          startBandCoord = bs(String(initialIdx)) ?? 0;
          startPointerBand = Number.NaN;
          // Set provisional order so siblings' positions can update via derive.
          provisionalOrder.value = (data.peek() as Bar[]).map(d => d.id);
          // Elevate the ghost: disable its transitions, mark it, raise in DOM.
          ghostEl = tile.el as unknown as SVGGraphicsElement;
          prevGhostTransition = ghostEl.style.transition;
          ghostEl.style.transition = "none";
        },
        onPreview: (order: readonly string[], e: PointerEvent) => {
          if (Number.isNaN(startPointerBand)) startPointerBand = eventBand(e);

          // Update provisional order → siblings' cur changes → barX/barY
          // re-derive → setAttribute fires → CSS transitions animate.
          provisionalOrder.value = order.slice();

          // Ghost: follow pointer via CSS transform (transitions suppressed
          // by [data-reordering] + REORDER_ACTIVE_CLASS CSS rule).
          const p = eventBand(e);
          const isV = isVert.peek();
          const bs = bandScale.peek();
          // Ghost's target slot from the provisional order.
          const ghostIdx = order.indexOf(datum.id);
          const slotCoord = bs(String(ghostIdx)) ?? 0;
          const offset = (startBandCoord + (p - startPointerBand)) - slotCoord;
          if (ghostEl) {
            const dx = isV ? offset : 0;
            const dy = isV ? 0 : offset;
            ghostEl.style.transform = `translate(${dx}px, ${dy}px)`;
          }
        },
        onEnd: (finalOrder: readonly string[], canceled: boolean) => {
          // Restore ghost.
          if (ghostEl) {
            ghostEl.style.transform = "";
            ghostEl.style.transition = prevGhostTransition;
            ghostEl = null;
          }

          const initial = (data.peek() as Bar[]).map(d => d.id);
          const changed = !canceled && finalOrder.some((id, i) => id !== initial[i]);
          if (changed) {
            // Commit: set data.value, then clear provisionalOrder. The
            // derive cells read from data.value (now reordered) → same
            // positions as the provisional order → no jump. CSS transitions
            // animate any residual offset (ghost snapping to slot).
            const items = data.peek() as Bar[];
            const byId = new Map(items.map((d) => [d.id, d]));
            const reordered = finalOrder.map((id) => byId.get(id)).filter(Boolean) as Bar[];
            data.value = reordered;
            provisionalOrder.value = null;
            this.bumpReorder();
            this.onReorder?.(finalOrder.slice());
            this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled: false, reorder: true } }));
            return;
          }
          // Cancel / no-op: clear provisionalOrder → siblings' cur reverts
          // to data.value index → setAttribute fires → CSS transitions
          // animate them back to original slots.
          provisionalOrder.value = null;
          this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled } }));
        },
      });
      this._setupDisposers.push(reorderDetach);

      return tile;
    }, { key: (item: Bar) => item.id });

    this._setupDisposers.push(() => barsResult.dispose());

    // ─── Left-room padding for popped labels ───────────────────────────────
    if (labelWidths.length && this.labelMode !== 'inside') {
      biEffect(() => {
        const maxLabelWidth = Math.max(...labelWidths.map(w => w.value));
        leftRoom.value = Math.max(H_PAD.left, maxLabelWidth + OUT_GAP);
      });
    }

    // ─── Status label ─────────────────────────────────────────────────────
    s(label(Vec.derive(() => ({ x: Wc.value / 2, y: 8 })), "Bar — hover · click · navigate · edit · ctrl+wheel · drag end", { size: 11, align: Anchor.Center, opacity: 0.7 }));

    // ─── Keyboard navigation (band axis = orientation-dependent) ──────────
    // Value editing is handled by the keyboardEdit behavior (composed in
    // _composeBehaviors). This handler only does navigation between bars.
    this.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (this._focusCell.value) { this.setFocus(null); e.preventDefault(); } return; }
      const rows = data.value as Bar[];
      const curId = this._focusCell.value;
      const i = curId ? rows.findIndex(d => d.id === curId) : -1;
      const navKeys = isVert.value ? ["ArrowRight", "ArrowLeft"] : ["ArrowDown", "ArrowUp"];
      if (navKeys.includes(e.key)) {
        const nextIdx = e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (i <= 0 ? rows.length : i) - 1 : (i + 1) % rows.length;
        this.setFocus(rows[nextIdx]?.id ?? null);
        tileElements.get(rows[nextIdx]?.id ?? "")?.focus();
        e.preventDefault();
      }
    });
  }

  protected _composeBehaviors(): void {
    // Value-resize drag (handle) and drag-to-reorder (bar body) are wired in
    // _setupRendering via the shared dragController + attachReorderGesture —
    // they are not Editor "behaviors" because they need per-orientation hit
    // logic and the handle is a dedicated element. Here we compose the shared
    // wheel/keyboard/transition behaviors; the drag gestures share the same
    // dragController singleton so only one drag is live at a time.
    const dragBehaviors: any[] = [];
    // Map ctrl+wheel deltaY pixels → value-space delta via the chart's
    // valueScale (same mechanics as dragging the handle). Vertical bars: value
    // axis is Y (inverted range — higher value = lower y), so +deltaY (wheel
    // down) moves down in pixels → value decreases. Horizontal bars: value
    // axis is X (normal range), so +deltaY must move left in pixels → value
    // decreases, matching "drag the handle down/left = smaller value".
    // A mouse wheel notch fires deltaY≈120, but a real drag moves only a few
    // px per frame — so we dampen by WHEEL_PX_DIVISOR to make one notch feel
    // like a ~10px drag (predictable, not explosive).
    const WHEEL_PX_DIVISOR = 12;
    const pixelToValueDelta = (deltaY: number, currentValue: number): number => {
      const scale = this._valueScale?.value;
      if (!scale) return -Math.abs(currentValue * 0.1) * Math.sign(deltaY);
      const isV = this._orientationCell.value === 'vertical';
      const px = deltaY / WHEEL_PX_DIVISOR;
      const curPx = scale(currentValue);
      const newPx = isV ? curPx + px : curPx - px;
      return scale.invert(newPx) - currentValue;
    };
    this._behaviorDispose = this._composeStandardBehaviors(
      dragBehaviors,
      this._transitionOpts(),
      undefined,
      pixelToValueDelta,
    );
  }

  protected _transitionOpts(): Parameters<typeof transitionOnUpdated>[0] {
    // CSS transitions on rect attrs (x/y/width/height) handle all settle
    // animation: sort, orientation morph, measure swap, value commit.
    // transitionOnUpdated owns the gesture-active class (suppresses transitions
    // during value edits) and the reorder-active class (suppresses only the
    // ghost, lets siblings slide via CSS).
    return {
      durationMs: () => motion.motionMs.value,
      elements: "rect",
    };
  }
}
