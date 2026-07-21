// Segmented gauge — same single-value model as the gauge (one Num cell over a
// 270° sweep), but rendered as N discrete arc segments that "light up" as the
// value crosses each segment boundary (battery / capacity-meter idiom; see
// layerchart's "Segmented Arc" example). NOT N independent values — there is
// one number here, presented in discrete chunks.

import {
  Anchor, cell, circle, derive, effect as biEffect,
  group, label, mount, Num, num, pathD, rect, Vec, type Writable,
} from "bireactive";
import { RadialChartBase } from "../radial/radial-chart-base";
import { arc as d3Arc } from "d3-shape";
import { wheelController, realModifierDown } from "../lib/interaction";
import { dragCancelable } from "../lib/esc-contract";
import { numberDrag } from "../lib/number-drag";
import { PALETTE } from "@hotbook/core";
import { setup } from "../hierarchical/gesture";
import { transitionOnUpdated } from "../hierarchical/behaviors/transition-on-updated";

const W = 320;
const H = 240;

const SWEEP_START = -Math.PI * 3 / 4;
const SWEEP_END = Math.PI * 3 / 4;
const SWEEP_SPAN = SWEEP_END - SWEEP_START;

function arcD(rOuter: number, rInner: number, startAngle: number, endAngle: number, cornerRadius: number, padAngle: number): string {
  return d3Arc()
    .innerRadius(rInner)
    .outerRadius(rOuter)
    .startAngle(startAngle)
    .endAngle(endAngle)
    .cornerRadius(cornerRadius)
    .padAngle(padAngle)(null as any) ?? "";
}

function d3ToSvg(d3Angle: number): number { return d3Angle - Math.PI / 2; }

const GAUGE_SEG_CSS = `text { pointer-events: none; }`;
let gaugeSegCssInjected = false;
function ensureGaugeSegCss() {
  if (typeof document === "undefined" || gaugeSegCssInjected) return;
  gaugeSegCssInjected = true;
  const style = document.createElement("style");
  style.id = "vf-gauge-segmented-chart";
  style.textContent = GAUGE_SEG_CSS;
  document.head.appendChild(style);
}

export class MdGaugeSegmentedLC extends RadialChartBase {

  /** Single value, 0–100 by default. Identical model to MdGaugeLC. */
  readonly valueCell: Writable<Num> = num(50);
  minValue = 0;
  maxValue = 100;
  segments = 24;
  color = PALETTE[3]!;
  metricLabel = "";

  set externalData(v: { value: number; min?: number; max?: number; color?: string; label?: string; segments?: number } | undefined) {
    if (!v) return;
    if (typeof v.min === "number") this.minValue = v.min;
    if (typeof v.max === "number") this.maxValue = v.max;
    if (typeof v.color === "string") this.color = v.color;
    if (typeof v.label === "string") this.metricLabel = v.label;
    if (typeof v.segments === "number") this.segments = Math.max(2, Math.round(v.segments));
    this.valueCell.value = Math.max(this.minValue, Math.min(this.maxValue, v.value));
  }
  get externalData(): { value: number; min: number; max: number; color: string; label: string; segments: number } {
    return { value: this.valueCell.value, min: this.minValue, max: this.maxValue, color: this.color, label: this.metricLabel, segments: this.segments };
  }

  connectedCallback() {
    super.connectedCallback();
    if (!this._configCell.value) {
      this._configCell.value = { sort: "index", conservationMode: "additive" };
    }
  }

  protected _setupRendering(): void {
    ensureGaugeSegCss();
    const s = this._s;
    const { w: Wc, h: Hc } = this._hostSize!;
    this._setViewBox(Wc.value, Hc.value);
    this.tabIndex = 0;
    this.style.outline = "none";

    const value = this.valueCell;
    const minV = this.minValue;
    const maxV = this.maxValue;
    const range = Math.max(1, maxV - minV);
    const color = this.color;
    const N = this.segments;

    const cx = Num.derive(() => Wc.value / 2);
    const cy = Num.derive(() => Hc.value * 0.58);
    const rOuter = Num.derive(() => Math.max(40, Math.min(Wc.value, Hc.value) * 0.45));
    const thickness = Num.derive(() => Math.max(10, rOuter.value * 0.22));
    const rInner = Num.derive(() => rOuter.value - thickness.value);
    const rMid = Num.derive(() => (rOuter.value + rInner.value) / 2);

    const frac = derive(() => Math.max(0, Math.min(1, (value.value - minV) / range)));

    const hovered = cell(false);
    const focused = cell(false);
    const active = cell(false);

    const g = s(group({ translate: Vec.derive(() => ({ x: cx.value, y: cy.value }) ) }));
    const gs = mount(g);

    // Build N segments along the sweep. Each segment's color is "lit" when the
    // value's fractional fill covers any part of it, and the lit color fades
    // through the PALETTE accent (saturation/alpha) for a meter look.
    const padAngle = 0.02;
    for (let i = 0; i < N; i++) {
      const segStartFrac = i / N;
      const segEndFrac = (i + 1) / N;
      const segStart = SWEEP_START + segStartFrac * SWEEP_SPAN;
      const segEnd = SWEEP_START + segEndFrac * SWEEP_SPAN;

      // Lit if the value crosses the segment's midpoint (matches layerchart's
      // (i/N) * 100 < value pattern).
      const lit = derive(() => frac.value > (i + 0.5) / N);
      // Subtle gradient across lit segments so it reads as a graduated meter.
      const litColor = color;

      gs(pathD(
        derive(() => {
          const ro = rOuter.value, ri = rInner.value;
          if (ri < 1 || ro <= ri) return "";
          return arcD(ro, ri, segStart, segEnd, Math.max(2, thickness.value * 0.18), padAngle);
        }),
        {
          fill: derive(() => lit.value ? litColor : color),
          opacity: derive(() => lit.value ? 1 : 0.18),
        },
      ));
    }

    // Draggable endpoint handle — same lens math as MdGaugeLC.
    const handleTarget = Vec.lens(
      [value] as const,
      (vals: readonly [number]) => {
        const [v] = vals;
        const f = Math.max(0, Math.min(1, (v - minV) / range));
        const d3a = SWEEP_START + f * SWEEP_SPAN;
        const sa = d3ToSvg(d3a);
        return { x: cx.peek() + Math.cos(sa) * rMid.peek(), y: cy.peek() + Math.sin(sa) * rMid.peek() };
      },
      (target) => {
        const dx = target.x - cx.peek();
        const dy = target.y - cy.peek();
        let d3a = Math.atan2(dy, dx) + Math.PI / 2;
        if (d3a > Math.PI) d3a -= 2 * Math.PI;
        d3a = Math.max(SWEEP_START, Math.min(SWEEP_END, d3a));
        const f = (d3a - SWEEP_START) / SWEEP_SPAN;
        return [Math.max(minV, Math.min(maxV, minV + f * range))];
      },
    );

    const handlePos = Vec.derive(() => {
      const f = Math.max(0, Math.min(1, (value.value - minV) / range));
      const d3a = SWEEP_START + f * SWEEP_SPAN;
      const sa = d3ToSvg(d3a);
      return { x: cx.value + Math.cos(sa) * rMid.value, y: cy.value + Math.sin(sa) * rMid.value };
    });
    const handleR = derive(() => Math.max(6, thickness.value * 0.5));
    const handle = s(circle(handlePos, handleR, {
      fill: "#fff",
      stroke: color,
      strokeWidth: 2,
      opacity: derive(() => (hovered.value || focused.value || active.value) ? 1 : 0.85),
    }));
    handle.el.style.cursor = "grab";
    dragCancelable(handle, handleTarget, [value], {
      host: this,
      onStart: () => { active.value = true; (this as any).gestureActive = true; },
      onEnd: () => { active.value = false; (this as any).gestureActive = false; this.dispatchEvent(new CustomEvent("gesturecommit")); },
    });
    handle.el.addEventListener("pointerenter", () => { hovered.value = true; });
    handle.el.addEventListener("pointerleave", () => { if (!active.value) hovered.value = false; });

    // Center readout — metric label above, big value below.
    s(label(
      Vec.derive(() => ({ x: cx.value, y: cy.value - rOuter.value * 0.18 })),
      derive(() => this.metricLabel),
      { size: 11, align: Anchor.Center, opacity: 0.6 },
    ));
    s(label(
      Vec.derive(() => ({ x: cx.value, y: cy.value + rOuter.value * 0.12 })),
      derive(() => {
        const v = value.value;
        return Number.isInteger(v) ? `${v}` : v.toFixed(1);
      }),
      { size: 32, align: Anchor.Center, fill: color },
    ));
    // Small ↔ affordance hint under the number, so the scrub is discoverable.
    s(label(
      Vec.derive(() => ({ x: cx.value, y: cy.value + rOuter.value * 0.34 })),
      "↔ drag",
      { size: 9, align: Anchor.Center, opacity: 0.35 },
    ));

    // Number-drag hitbox over the center.
    const hitW = Num.derive(() => rOuter.value * 1.2);
    const hitH = Num.derive(() => rOuter.value * 0.6);
    const hitCenter = Vec.derive(() => ({ x: cx.value, y: cy.value + rOuter.value * 0.05 }));
    const hit = s(rect(hitCenter, hitW, hitH, { fill: "#fff", opacity: 0 }));
    hit.el.style.cursor = "ew-resize";
    numberDrag(hit.el as unknown as SVGElement, {
      get: () => value.value,
      set: (v) => { value.value = Math.max(minV, Math.min(maxV, v)); },
      min: minV,
      max: maxV,
      pxPerUnit: Math.max(1, 200 / range),
      onStart: () => { active.value = true; (this as any).gestureActive = true; },
      onEnd: () => { active.value = false; (this as any).gestureActive = false; this.dispatchEvent(new CustomEvent("gesturecommit")); },
    });

    // Min / max endpoint labels.
    const minLabelPos = Vec.derive(() => {
      const sa = d3ToSvg(SWEEP_START);
      return { x: cx.value + Math.cos(sa) * (rOuter.value + 14), y: cy.value + Math.sin(sa) * (rOuter.value + 14) };
    });
    const maxLabelPos = Vec.derive(() => {
      const sa = d3ToSvg(SWEEP_END);
      return { x: cx.value + Math.cos(sa) * (rOuter.value + 14), y: cy.value + Math.sin(sa) * (rOuter.value + 14) };
    });
    s(label(minLabelPos, `${minV}`, { size: 10, align: Anchor.Center, opacity: 0.5 }));
    s(label(maxLabelPos, `${maxV}`, { size: 10, align: Anchor.Center, opacity: 0.5 }));

    // Wheel edit on the whole diagram (cmd/ctrl + wheel).
    const wheelConfig = {
      snapshot: () => { (this as any).gestureActive = true; return value.value; },
      restore: (_t: unknown, snap: number) => { value.value = Math.max(minV, Math.min(maxV, snap)); },
      onEnd: () => { (this as any).gestureActive = false; this.dispatchEvent(new CustomEvent("gesturecommit")); },
    };
    this.addEventListener("wheel", (e) => {
      const we = e as WheelEvent;
      if (!we.ctrlKey && !we.metaKey) return;
      const t = wheelController.begin(this, wheelConfig, { pinch: !realModifierDown() });
      if (!t) return;
      we.preventDefault();
      const step = (we.shiftKey ? 5 : 1) * (we.altKey ? 0.1 : 1);
      const delta = (we.deltaY < 0 ? step : -step) * (range / 100);
      value.value = Math.max(minV, Math.min(maxV, value.value + delta));
    }, { passive: false });

    // Keyboard nav.
    this.addEventListener("focus", () => { focused.value = true; });
    this.addEventListener("blur", () => { focused.value = false; });
    this.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      const step = (ke.shiftKey ? 5 : 1) * (range / 100);
      if (ke.key === "ArrowUp" || ke.key === "ArrowRight") {
        value.value = Math.max(minV, Math.min(maxV, value.value + step)); ke.preventDefault();
      } else if (ke.key === "ArrowDown" || ke.key === "ArrowLeft") {
        value.value = Math.max(minV, Math.min(maxV, value.value - step)); ke.preventDefault();
      }
    });

    // Bridge: single-value chart. Sync focused ↔ base class _focusCell.
    this._setupDisposers.push(
      biEffect(() => { this._focusCell.value = focused.value ? "value" : null; }),
      biEffect(() => { const id = this._extFocus; focused.value = id === "value"; }),
    );
  }

  protected _composeBehaviors(): void {
    const gesture = this._gesture!;
    this._behaviorDispose = setup(gesture)(transitionOnUpdated());
  }
}
