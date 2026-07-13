// BarChart — unified bar chart with composable display options.
// orientation: vertical | horizontal  (reactive — morphs on change, WIN-144)
// colorMode:   single (one accent color) | palette (per-bar PALETTE colors)
// labelMode:   axis (category labels on axis only) | inside (inside bar) | both
// valueMode:   inside (inside bar) | outside (beyond bar end) | none
// minBandSize: minimum px for a band before touch target is clamped (0 = scale freely)

import { Anchor, cell, circle, derive, easeInOut, easeOut, effect as biEffect, label, line, type Mount, Num, num, rect, tween, untracked, Vec, type Writable } from "bireactive";
import { Diagram } from "../lib/diagram";
import { scaleLinear, scaleBand } from "d3-scale";
import { wheelController, dragController, dynamicWheelStep, realModifierDown } from "../lib/interaction";
import { makeBridge, type ElementWithBridge } from "../lib/hud-bridge";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import {
  GESTURE_SUPPRESSION_CSS,
  REORDER_ELEVATION_CSS,
  hoverTransition,
} from "../lib/transitions";
import { lightenHex } from "../lib/color-utils";
import { attachReorderGesture } from "../lib/reorder-gesture";
import { PALETTE, type ColorStrategy, getColorByStrategy } from "@hotbook/core";
import { applyMultiWithTweenGate, SORT_SEC } from "../lib/tween-gate";

const W = 720;
const H = 360;
const SINGLE_COLOR = "#7aaae8";

interface Bar { id?: string; label: string; value: number; }

function makeData(): Bar[] {
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return labels.map((l) => ({ id: l, label: l, value: Math.round(20 + Math.random() * 80) }));
}

const V_PAD = { top: 16, right: 24, bottom: 36, left: 48 };
const H_PAD = { top: 16, right: 64, bottom: 36, left: 16 };
const V_BAR_STEP = 56; // px per bar in vertical overflow
const H_BAND_STEP = 44; // px per band in horizontal overflow
const LABEL_PAD = 8; // padding from left edge for labels inside horizontal bars
const VALUE_PAD = 8; // padding from right edge for values inside horizontal bars
const VALUE_GAP = 4; // gap between label and value when rendered inline
const OUT_GAP = 8;   // gap when label/value is popped outside the bar

// text-anchor / dominant-baseline strings for each Anchor value.
const xAnchor = (x: number) => (x <= 0.25 ? "start" : x >= 0.75 ? "end" : "middle");
const yAnchor = (y: number) => (y <= 0.25 ? "hanging" : y >= 0.75 ? "alphabetic" : "central");

export class MdBarChartLC extends Diagram {
  static styles = `
    text { pointer-events: none; }
    ${FILL_STYLE}
    ${GESTURE_SUPPRESSION_CSS}
    ${REORDER_ELEVATION_CSS}
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

  colorMode: 'single' | 'palette' = 'palette';
  colorStrategy: ColorStrategy = 'index'; // 'index' | 'value' | 'identity' | 'single'
  labelMode: 'axis' | 'inside' | 'both' = 'axis';
  valueMode: 'inside' | 'outside' | 'none' = 'outside';

  // Drag-to-reorder (WIN-262). Caller opts in via canReorder (typically when
  // sort is by natural order). Commit fires onReorder(orderedIds); chart is
  // agnostic to where order is persisted.
  private _canReorderCell = cell<boolean>(false)
  get canReorder(): boolean { return this._canReorderCell.value }
  set canReorder(v: boolean) { this._canReorderCell.value = v }
  onReorder?: (orderedIds: string[]) => void
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

  #barColor(idx: number, datum?: Bar): string {
    if (this.colorMode === 'single') return SINGLE_COLOR;

    const max = Math.max(1, ...(this.dataCell.value as Bar[]).map(d => d.value));
    return getColorByStrategy(this.colorStrategy, {
      index: idx,
      value: datum?.value,
      identity: datum?.id ?? datum?.label,
      singleColor: SINGLE_COLOR,
      palette: PALETTE,
      valueScale: (v) => v / max
    });
  }
  #hoverColor(idx: number, datum?: Bar): string {
    return lightenHex(this.#barColor(idx, datum), 0.35);
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
    // Left room grows for horizontal charts with labels so popped-out labels
    // stay visible outside the left edge of the bar.
    const leftRoom = cell(H_PAD.left);
    const labelWidths: any[] = [];
    const PAD = derive(() => isVert.value ? V_PAD : { ...H_PAD, left: leftRoom.value });
    const plotX = derive(() => PAD.value.left);
    const plotY = derive(() => PAD.value.top);
    const plotW = derive(() => Wc.value - PAD.value.left - PAD.value.right);
    const plotH = derive(() => Hc.value - PAD.value.top - PAD.value.bottom);
    const plotBottom = derive(() => plotY.value + plotH.value);
    const plotRight = derive(() => plotX.value + plotW.value);

    // ─── Overflow mode (direction depends on orientation) ─────────────────
    const overflowMode = derive(() => {
      const n = (data.value as Bar[]).length;
      return isVert.value ? (this.maxBars > 0 && n > this.maxBars) : (this.maxBands > 0 && n > this.maxBands);
    });
    const STEP = derive(() => isVert.value ? V_BAR_STEP : H_BAND_STEP);
    const neededBand = derive(() => PAD.value.left + PAD.value.right + (data.value as Bar[]).length * STEP.value); // vertical: width
    const neededOrtho = derive(() => PAD.value.top + PAD.value.bottom + (data.value as Bar[]).length * STEP.value); // horizontal: height

    const viewW = derive(() => overflowMode.value && isVert.value ? neededBand.value : Wc.value);
    const viewH = derive(() => overflowMode.value && !isVert.value ? neededOrtho.value : Hc.value);
    this.view(viewW, viewH);
    const svgEl = (this as any).svg as SVGSVGElement;
    biEffect(() => {
      const om = overflowMode.value, iv = isVert.value;
      // Rule 14: touch is a first-class gesture surface. In overflow mode, allow
      // panning along the scroll axis so users can still reach hidden bars; otherwise
      // block page scroll so drag-edit doesn't lose to page scroll on mobile.
      // The touchstart handler still prevents default when a bar is touched, so
      // dragging a bar never scrolls.
      const pan = om ? (iv ? 'pan-x' : 'pan-y') : 'none';
      this.style.touchAction = pan;
      svgEl.style.touchAction = pan;
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
        .domain((data.value as Bar[]).map((_, i) => String(i)))
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
      // Touch-friendly hit tolerance: 24px for touch/pen, 12px for mouse
      const hitTolerance = pe.pointerType === "mouse" ? 12 : 24;
      const valPos = (valueScale.value as any)(pt.value);
      const dist = isVert.value ? Math.abs(y - valPos) : Math.abs(x - valPos);
      if (dist > hitTolerance) return;
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
    // MUST pass x,y as separate Num values — rect(Vec, w, h) is CENTER-based!
    const hlTarget = derive(() => hover.value ?? selected.value);
    const hlX = derive(() => {
      const t = hlTarget.value; if (!t) return -9999;
      const targetId = t.id ?? t.label;
      const i = (data.value as Bar[]).findIndex(d => (d.id ?? d.label) === targetId);
      if (i < 0) return -9999;
      const bs = bandScale.value;
      const bp = bs(String(i)) ?? 0;
      const pad = (bs.step() - bs.bandwidth()) / 2;
      if (isVert.value) return bp - pad;
      return plotX.value;
    });
    const hlY = derive(() => {
      const t = hlTarget.value; if (!t) return -9999;
      const targetId = t.id ?? t.label;
      const i = (data.value as Bar[]).findIndex(d => (d.id ?? d.label) === targetId);
      if (i < 0) return -9999;
      const bs = bandScale.value;
      const bp = bs(String(i)) ?? 0;
      const pad = (bs.step() - bs.bandwidth()) / 2;
      if (isVert.value) return plotY.value;
      return bp - pad;
    });
    const hlW = derive(() => {
      if (!isVert.value) return plotW.value;
      const t = hlTarget.value; if (!t) return 0;
      const targetId = t.id ?? t.label;
      const i = (data.value as Bar[]).findIndex(d => (d.id ?? d.label) === targetId);
      return i < 0 ? 0 : bandScale.value.step();
    });
    const hlH = derive(() => {
      if (isVert.value) return plotH.value;
      const t = hlTarget.value; if (!t) return 0;
      const targetId = t.id ?? t.label;
      const i = (data.value as Bar[]).findIndex(d => (d.id ?? d.label) === targetId);
      return i < 0 ? 0 : bandScale.value.step();
    });
    const hlRect = s(rect(hlX, hlY, hlW, hlH, {
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
    // orderHash detects sort (reorder) — id sequence changes when hotbook
    // hands data in a new display order. Tween on sort/orientation/measure;
    // snap on value edits (same datum, different value).
    const orderHash = derive(() => (data.value as Bar[]).map(d => d.id ?? d.label).join(','));

    // Per-bar cell handles hoisted for the reorder gesture (Layer 4 imperative
    // preview needs to reach into any bar to rewrite its band-axis coord).
    interface BarCells {
      barX: Writable<Num>;
      barY: Writable<Num>;
      barW: Writable<Num>;
      barH: Writable<Num>;
      tileEl: SVGRectElement;
      di: () => Bar | null;
    }
    const barCells = new Map<string, BarCells>();

    for (let oi = 0; oi < rows0.length; oi++) {
      const datumId = rows0[oi]!.id ?? rows0[oi]!.label;
      const cur = derive(() => {
        const arr = data.value as Bar[];
        return arr.findIndex(d => (d.id ?? d.label) === datumId);
      });
      const di = (): Bar | null => (data.value as Bar[])[cur.value] ?? null;

      // Color derivation — must be plain strings, not nested cells
      const baseColor = (): string => {
        const d = di();
        return d ? this.#barColor(cur.value, d) : SINGLE_COLOR;
      };
      const hoverBaseColor = (): string => {
        const d = di();
        return d ? this.#hoverColor(cur.value, d) : lightenHex(SINGLE_COLOR, 0.35);
      };

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

      // Tweened cells. Two roles, gated independently: POSITION (band
      // placement — moves on sort) and VALUE (measure length — moves on
      // measure swap/edit). Which literal cell pair plays which role trades
      // places with orientation: vertical → position=(x,w), value=(y,h);
      // horizontal → the reverse. Earlier revisions hardcoded (y,h)=value,
      // (x,w)=position, which only tweened correctly in vertical mode — sort
      // in horizontal and reorder-in-vertical both silently snapped.
      const barX = num(barXTarget.value);
      const barY = num(barYTarget.value);
      const barW = num(barWTarget.value);
      const barH = num(barHTarget.value);
      let animCancel: (() => void) | null = null;
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
        const orientChanged = orient !== seenOrient;
        const orderChanged = order !== seenOrder;
        const measureChanged = measureKey !== seenMeasureKey;
        seenOrient = orient; seenMeasureKey = measureKey; seenOrder = order;
        const vertical = orient === 'vertical';
        const [posA, posB, posAt, posBt] = vertical ? [barX, barW, xt, wt] as const : [barY, barH, yt, ht] as const;
        const [valA, valB, valAt, valBt] = vertical ? [barY, barH, yt, ht] as const : [barX, barW, xt, wt] as const;
        const structuralPos = orientChanged || orderChanged;
        const structuralVal = orientChanged || measureChanged;
        animCancel?.();
        const posCancel = applyMultiWithTweenGate({
          updates: [{ cell: posA, target: posAt }, { cell: posB, target: posBt }],
          structural: structuralPos,
          host: this,
          anim: this.anim,
          easing: easeInOut,
        });
        const valCancel = applyMultiWithTweenGate({
          updates: [{ cell: valA, target: valAt }, { cell: valB, target: valBt }],
          structural: structuralVal,
          host: this,
          anim: this.anim,
          easing: easeInOut,
        });
        animCancel = posCancel && valCancel ? () => { posCancel(); valCancel(); } : (posCancel || valCancel);
      });

      const fill = derive(() => { const d = di(); return selected.value === d ? "#fff" : hover.value === d ? hoverBaseColor() : baseColor(); });
      const labelFill = derive(() => { const d = di(); return selected.value === d ? baseColor() : "#fff"; });

      const tile = s(rect(barX, barY, barW, barH, { fill, corner: 2 }));
      tile.el.style.touchAction = "none";
      tileElements.set(datumId, tile.el);
      barCells.set(datumId, { barX, barY, barW, barH, tileEl: tile.el as SVGRectElement, di });
      biEffect(() => {
        // Reorder gets cursor priority (Rule 8 affordance) when enabled.
        tile.el.style.cursor = this._canReorderCell.value
          ? 'grab'
          : (isVert.value ? "ns-resize" : "ew-resize");
      });
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

      // Text-width cells updated by measuring the actual rendered text.
      const labelWidth = cell(0);
      const valueWidth = cell(0);
      labelWidths.push(labelWidth);
      let labelPopped: any = null;
      let valuePopped: any = null;
      let inLbl: any = null;
      let vLbl: any = null;
      let catLbl: any = null;

      // ─── Category label (axis / both mode) — tweened position ───────────
      if (this.labelMode === 'axis' || this.labelMode === 'both') {
        const catPos = Vec.derive(() => {
          if (isVert.value) return { x: barCX.value, y: plotBottom.value + 16 };
          return { x: plotX.value - 6, y: barCY.value };
        });
        catLbl = s(label(catPos, derive(() => di()?.label ?? ""),
          { size: 10, fill: "#888", opacity: 0.8 }));
        biEffect(() => {
          const a = isVert.value ? Anchor.Center : Anchor.Right;
          catLbl.intrinsic!.setAttribute('text-anchor', xAnchor(a.x));
          catLbl.intrinsic!.setAttribute('dominant-baseline', yAnchor(a.y));
        });
      }

      // ─── Inside label (inside / both mode) ──────────────────────────────
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
          // Place the item label at the left end of the bar with LABEL_PAD.
          return { x: barX.value + LABEL_PAD, y: barCY.value };
        });
        inLbl = s(label(inPos, derive(() => di()?.label ?? ""),
          { size: 10, fill: inFill, opacity: inOpacity }));
      }

      // ─── Value label ────────────────────────────────────────────────────
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
            return {
              x: barCX.value,
              y: valuePopped.value ? barY.value - OUT_GAP : (barY.value + (labelVisible ? 28 : 14)),
            };
          }
          if (valuePopped.value) {
            if (labelPopped && labelPopped.value) {
              return {
                x: barX.value + barW.value + OUT_GAP + labelWidth.value + VALUE_GAP,
                y: barCY.value,
              };
            }
            return { x: barX.value + barW.value + OUT_GAP, y: barCY.value };
          }
          return { x: barX.value + barW.value - VALUE_PAD, y: barCY.value };
        });
        vLbl = s(label(vPos, derive(() => { const d = di(); return d ? `${Math.round(d.value)}` : ""; }),
          { size: 11, fill: vFill, opacity: 1 }));
      }

      // ─── Measure real text widths and update text-anchor / alignment ─────
      if (inLbl || vLbl || catLbl) {
        biEffect(() => {
          di(); // track label/value changes
          if (inLbl) labelWidth.value = (inLbl.intrinsic as SVGTextElement).getComputedTextLength();
          else if (catLbl) labelWidth.value = (catLbl.intrinsic as SVGTextElement).getComputedTextLength();
          if (vLbl) valueWidth.value = (vLbl.intrinsic as SVGTextElement).getComputedTextLength();
        });
        biEffect(() => {
          if (inLbl && labelPopped) {
            // Horizontal inside/popped labels always start at the left edge
            // of the bar or just to the right of the bar end, so left-align.
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

      // ─── Drag handle at bar's value-end ─────────────────────────────────
      const handlePos = Vec.derive(() => {
        if (isVert.value) return { x: barCX.value, y: barY.value };
        return { x: plotX.value + barW.value, y: barCY.value };
      });
      const handleOpacity = derive(() => { const d = di(); return (hover.value === d || selected.value === d) ? 1 : 0; });
      const handle = s(circle(handlePos, derive(() => { const d = di(); return selected.value === d ? 6 : 5; }), {
        fill: derive(() => { const d = di(); return selected.value === d ? "#fff" : hoverBaseColor(); }),
        stroke: "#0b0d12", strokeWidth: 1.5, opacity: handleOpacity,
      }));
      handle.el.style.transition = hoverTransition("opacity");
      handle.el.style.touchAction = "none";
      biEffect(() => { handle.el.style.cursor = isVert.value ? "ns-resize" : "ew-resize"; });
      handle.el.addEventListener("pointerenter", () => { const d = di(); if (!wheelController.active && d) hover.value = d; });
      handle.el.addEventListener("pointerleave", () => { const d = di(); if (!wheelController.active && d && hover.value === d) hover.value = null; });
    }

    // ─── Left-room padding for popped labels ───────────────────────────────
    // Increase the horizontal left padding so labels that pop out remain
    // visible instead of being clipped by the left edge of the chart.
    // For inline inside labels the whole label/value unit pops to the right,
    // so no extra left padding is needed.
    // When the label is rendered inside, the label/value unit pops out to the
    // right, so no extra left padding is needed.
    if (labelWidths.length && this.labelMode !== 'inside') {
      biEffect(() => {
        const maxLabelWidth = Math.max(...labelWidths.map(w => w.value));
        leftRoom.value = Math.max(H_PAD.left, maxLabelWidth + OUT_GAP);
      });
    }

    // ─── Drag-to-reorder (WIN-262) ────────────────────────────────────────
    // Bar-body drag moves along the band axis; siblings tween to their new
    // slots; commit fires onReorder. Value-drag on the bar end still wins in
    // its narrow hit tolerance (filter yields to the resize gesture there).
    const REORDER_SEC = 0.25;
    const reorderDetachers: Array<() => void> = [];
    const detachAllReorder = () => { while (reorderDetachers.length) reorderDetachers.pop()!(); };
    biEffect(() => {
      const enabled = this._canReorderCell.value;
      detachAllReorder();
      if (!enabled) return;

      for (const [datumId, cells] of barCells.entries()) {
        let startBandCoord = 0;
        let startPointerBand = Number.NaN;
        let startValueCoord = 0; // frozen value-axis position; ghost doesn't move on this axis
        const siblingTweenCancels = new Map<string, () => void>();
        const lastAppliedIdx = new Map<string, number>();

        const eventLocal = (e: PointerEvent) => localPoint(e);
        const eventBand = (e: PointerEvent): number => {
          const { x, y } = eventLocal(e);
          return isVert.peek() ? x : y;
        };

        const detach = attachReorderGesture({
          hitEl: cells.tileEl,
          dragEl: cells.tileEl,
          itemId: datumId,
          host: this,
          // Yield to the value-drag when pointer is within the resize hit zone
          // at the value-end of the bar (keeps drag-end resize working).
          filter: (e) => {
            const d = cells.di();
            if (!d) return true;
            const { x, y } = eventLocal(e);
            const valPos = (valueScale.peek() as any)(d.value);
            const dist = isVert.peek() ? Math.abs(y - valPos) : Math.abs(x - valPos);
            const tol = e.pointerType === 'mouse' ? 12 : 24;
            return dist > tol;
          },
          getInitialOrder: () => (data.peek() as Bar[]).map(x => x.id ?? x.label),
          computeTargetIndex: (e, order) => {
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
            const isV = isVert.peek();
            const initialIdx = (data.peek() as Bar[]).findIndex(d => (d.id ?? d.label) === datumId);
            startBandCoord = bs(String(initialIdx)) ?? 0;
            // Freeze value-axis position at gesture start (Rule 2 — value dim
            // shouldn't shift under the user just because the band axis is
            // being manipulated).
            startValueCoord = isV ? cells.barY.peek() : cells.barX.peek();
            startPointerBand = Number.NaN;
            siblingTweenCancels.forEach(fn => fn());
            siblingTweenCancels.clear();
            lastAppliedIdx.clear();
            (data.peek() as Bar[]).forEach((d, i) => lastAppliedIdx.set(d.id ?? d.label, i));
          },
          onPreview: (order, e) => {
            const bs = bandScale.peek();
            const isV = isVert.peek();
            if (Number.isNaN(startPointerBand)) startPointerBand = eventBand(e);

            // Siblings: tween to new band positions when their provisional
            // index changes. Each sibling's tween is per-cell so we can
            // interrupt cleanly if their target flips again mid-flight.
            for (let i = 0; i < order.length; i++) {
              const id = order[i]!;
              if (id === datumId) continue;
              const sc = barCells.get(id);
              if (!sc) continue;
              if (lastAppliedIdx.get(id) === i) continue;
              lastAppliedIdx.set(id, i);
              siblingTweenCancels.get(id)?.();
              const target = bs(String(i)) ?? 0;
              const bandCell = isV ? sc.barX : sc.barY;
              const cancel = this.anim.start(tween(bandCell, target, REORDER_SEC, easeOut) as any);
              if (cancel) siblingTweenCancels.set(id, cancel);
            }

            // Dragged bar: follow pointer directly. Value-axis coord frozen.
            const p = eventBand(e);
            const newCoord = startBandCoord + (p - startPointerBand);
            if (isV) {
              cells.barX.value = newCoord;
              cells.barY.value = startValueCoord;
            } else {
              cells.barY.value = newCoord;
              cells.barX.value = startValueCoord;
            }
          },
          onEnd: (finalOrder, canceled) => {
            siblingTweenCancels.forEach(fn => fn());
            siblingTweenCancels.clear();

            const initial = (data.peek() as Bar[]).map(x => x.id ?? x.label);
            const changed = !canceled && finalOrder.some((id, i) => id !== initial[i]);
            if (changed) {
              // Commit. Reactive tween effect (line ~470) will fire the
              // structural branch — sort tweens from current visual position
              // (Rule 4 settle from where they are).
              this.onReorder?.(finalOrder.slice());
              this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled: false, reorder: true } }));
              return;
            }
            // Cancel / no-op: tween each bar back to its initial slot.
            const bs = bandScale.peek();
            const isV = isVert.peek();
            (data.peek() as Bar[]).forEach((d, i) => {
              const id = d.id ?? d.label;
              const sc = barCells.get(id);
              if (!sc) return;
              const target = bs(String(i)) ?? 0;
              const bandCell = isV ? sc.barX : sc.barY;
              this.anim.start(tween(bandCell, target, REORDER_SEC, easeOut) as any);
              // Return dragged bar's value-axis to its live target too.
              if (id === datumId) {
                const valTarget = isV ? (valueScale.peek() as any)(d.value) : (valueScale.peek() as any)(d.value);
                const valCell = isV ? sc.barY : sc.barX;
                // For value-axis: for vertical bars barY is the TOP; for
                // horizontal barX is the LEFT. Both re-tween via the reactive
                // effect once we release — but since data didn't change, that
                // effect won't fire. So we snap value-axis explicitly.
                valCell.value = isV ? valTarget : plotX.peek();
              }
            });
            this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled } }));
          },
        });
        reorderDetachers.push(detach);
      }
    });

    // ─── Status label ─────────────────────────────────────────────────────
    s(label(Vec.derive(() => ({ x: Wc.value / 2, y: 8 })), "Bar — hover · click · navigate · edit · ctrl+wheel · drag end", { size: 11, align: Anchor.Center, opacity: 0.7 }));

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
