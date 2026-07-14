// Gauge — single 270° arc with a draggable endpoint and a center number
// readout that scrubs via the number-drag primitive (lib/number-drag).
//
// Endpoint drag uses dragCancelable (Esc-revert via the shared drag controller,
// same as pie/icicle/sunburst boundary handles). Wheel edit uses the shared
// wheel controller. Number-drag on the center display routes through the same
// drag controller so only one gesture is ever live.

import {
  Anchor, cell, circle, derive, effect as biEffect,
  group, label, mount, type Mount, Num, num, pathD, rect, Vec, type Writable,
} from "bireactive";
import { Diagram } from "../lib/diagram";
import { DataViewController } from "../lib/data-view-controller";
import { arc as d3Arc } from "d3-shape";
import { wheelController, realModifierDown } from "../lib/interaction";
import { dragCancelable } from "../lib/esc-contract";
import { numberDrag } from "../lib/number-drag";
import { makeBridge, type ElementWithBridge } from "../lib/hud-bridge";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import { PALETTE } from "@hotbook/core";

const W = 320;
const H = 240;

// Sweep: 270° centered on 12 o'clock. d3Arc angle 0 = top, clockwise.
// Start at lower-left (-3π/4), end at lower-right (+3π/4), span = 3π/2.
const SWEEP_START = -Math.PI * 3 / 4;
const SWEEP_END = Math.PI * 3 / 4;
const SWEEP_SPAN = SWEEP_END - SWEEP_START;

// Rounded annular arc d-string centered at 0,0 (group applies translate).
function arcD(rOuter: number, rInner: number, startAngle: number, endAngle: number, cornerRadius: number): string {
  return d3Arc()
    .innerRadius(rInner)
    .outerRadius(rOuter)
    .startAngle(startAngle)
    .endAngle(endAngle)
    .cornerRadius(cornerRadius)(null as any) ?? "";
}

// d3 angle (0 = top, cw) → SVG vector (0 = right, cw, y-down).
function d3ToSvg(d3Angle: number): number { return d3Angle - Math.PI / 2; }

export class MdGaugeLC extends Diagram {
  static styles = `text { pointer-events: none; }${FILL_STYLE}`;

  /** 0–100 value cell. */
  readonly valueCell: Writable<Num> = num(50);
  minValue = 0;
  maxValue = 100;
  /** Single-color gauge accent. Defaults to PALETTE[3] (green). */
  color = PALETTE[3]!;
  /** Optional label for the metric (e.g. "Battery"). */
  metricLabel = "";

  set externalData(v: { value: number; min?: number; max?: number; color?: string; label?: string } | undefined) {
    if (!v) return;
    if (typeof v.min === "number") this.minValue = v.min;
    if (typeof v.max === "number") this.maxValue = v.max;
    if (typeof v.color === "string") this.color = v.color;
    if (typeof v.label === "string") this.metricLabel = v.label;
    this.valueCell.value = Math.max(this.minValue, Math.min(this.maxValue, v.value));
  }
  get externalData(): { value: number; min: number; max: number; color: string; label: string } {
    return { value: this.valueCell.value, min: this.minValue, max: this.maxValue, color: this.color, label: this.metricLabel };
  }

  dataView!: DataViewController;

  connectedCallback(): void {
    this.dataView = new DataViewController();
    super.connectedCallback();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.dataView?.dispose();
  }

  protected scene(s: Mount): void {
    const { w: Wc, h: Hc } = useHostSize(this, { width: W, height: H });
    this.view(Wc, Hc);
    this.tabIndex = 0;
    this.style.outline = "none";

    const value = this.valueCell;
    const minV = this.minValue;
    const maxV = this.maxValue;
    const range = Math.max(1, maxV - minV);
    const color = this.color;

    const cx = Num.derive(() => Wc.value / 2);
    // Bias the center slightly down so the 270° arc sits inside the box.
    const cy = Num.derive(() => Hc.value * 0.58);
    const rOuter = Num.derive(() => Math.max(40, Math.min(Wc.value, Hc.value) * 0.45));
    const thickness = Num.derive(() => Math.max(10, rOuter.value * 0.18));
    const rInner = Num.derive(() => rOuter.value - thickness.value);
    const corner = Num.derive(() => thickness.value / 2);
    const rMid = Num.derive(() => (rOuter.value + rInner.value) / 2);

    const frac = derive(() => Math.max(0, Math.min(1, (value.value - minV) / range)));
    const valueEnd = derive(() => SWEEP_START + frac.value * SWEEP_SPAN);

    const hovered = cell(false);
    const focused = cell(false);
    const active = cell(false);

    // All arcs render inside a centered group (matches concentric-arc pattern).
    const g = s(group({ translate: Vec.derive(() => ({ x: cx.value, y: cy.value })) }));
    const gs = mount(g);

    // Track arc (full sweep).
    gs(pathD(
      derive(() => {
        const ro = rOuter.value, ri = rInner.value;
        if (ri < 1 || ro <= ri) return "";
        return arcD(ro, ri, SWEEP_START, SWEEP_END, corner.value);
      }),
      { fill: color, opacity: 0.18 },
    ));

    // Value arc.
    const valueEl = gs(pathD(
      derive(() => {
        const ro = rOuter.value, ri = rInner.value;
        if (ri < 1 || ro <= ri) return "";
        const end = valueEnd.value;
        if (Math.abs(end - SWEEP_START) < 0.001) return "";
        return arcD(ro, ri, SWEEP_START, end, corner.value);
      }),
      {
        fill: color,
        opacity: derive(() => (hovered.value || focused.value || active.value) ? 1 : 0.92),
      },
    ));
    valueEl.el.style.cursor = "pointer";
    valueEl.el.addEventListener("pointerenter", () => { hovered.value = true; });
    valueEl.el.addEventListener("pointerleave", () => { hovered.value = false; });
    valueEl.el.addEventListener("click", () => { this.focus(); });

    // Endpoint drag handle (in world coords, not inside the centered group).
    // Vec.lens reads handle position from the value cell, and writes a new
    // value when the user drags. dragCancelable owns the gesture lifecycle.
    const handleTarget = Vec.lens(
      [value] as const,
      (vals: readonly [number]) => {
        const [v] = vals;
        const f = Math.max(0, Math.min(1, (v - minV) / range));
        const d3a = SWEEP_START + f * SWEEP_SPAN;
        const sa = d3ToSvg(d3a);
        return { x: cx.peek() + Math.cos(sa) * rMid.peek(), y: cy.peek() + Math.sin(sa) * rMid.peek() };
      },
      (target /* pointer in world coords */) => {
        // Angle of the pointer from the center, in d3-arc space (0 = top, cw).
        const dx = target.x - cx.peek();
        const dy = target.y - cy.peek();
        let d3a = Math.atan2(dy, dx) + Math.PI / 2;
        // Wrap into a continuous range that brackets SWEEP_START..SWEEP_END.
        if (d3a > Math.PI) d3a -= 2 * Math.PI;
        // Clamp to the sweep so the handle never jumps to the opposite side.
        d3a = Math.max(SWEEP_START, Math.min(SWEEP_END, d3a));
        const f = (d3a - SWEEP_START) / SWEEP_SPAN;
        const v = minV + f * range;
        return [Math.max(minV, Math.min(maxV, v))];
      },
    );

    const handlePos = Vec.derive(() => {
      const f = Math.max(0, Math.min(1, (value.value - minV) / range));
      const d3a = SWEEP_START + f * SWEEP_SPAN;
      const sa = d3ToSvg(d3a);
      return { x: cx.value + Math.cos(sa) * rMid.value, y: cy.value + Math.sin(sa) * rMid.value };
    });

    const handleR = derive(() => Math.max(6, thickness.value * 0.55));
    const handle = s(circle(handlePos, handleR, {
      fill: "#fff",
      stroke: color,
      strokeWidth: 2,
      opacity: derive(() => (hovered.value || focused.value || active.value) ? 1 : 0.85),
    }));
    handle.el.style.cursor = "grab";
    dragCancelable(handle, handleTarget, [value], {
      dataView: this.dataView,
      intent: 'edit' as const,
      origin: this,
      onStart: () => { active.value = true; },
      onEnd: () => { active.value = false; this.dataView.settle(); },
    });
    handle.el.addEventListener("pointerenter", () => { hovered.value = true; });
    handle.el.addEventListener("pointerleave", () => { if (!active.value) hovered.value = false; });

    // Center readout — metric label above, big value below. The value text is
    // rendered as a label (pointer-events: none), with a transparent hitbox
    // rect on top that accepts the number-drag gesture.
    s(label(
      Vec.derive(() => ({ x: cx.value, y: cy.value - rOuter.value * 0.18 })),
      derive(() => this.metricLabel),
      { size: 11, align: Anchor.Center, opacity: 0.6 },
    ));
    s(label(
      Vec.derive(() => ({ x: cx.value, y: cy.value + rOuter.value * 0.1 })),
      derive(() => {
        const v = value.value;
        return Number.isInteger(v) ? `${v}` : v.toFixed(1);
      }),
      { size: 30, align: Anchor.Center, fill: color },
    ));

    // Small ↔ affordance hint so the number-drag scrub is discoverable.
    s(label(
      Vec.derive(() => ({ x: cx.value, y: cy.value + rOuter.value * 0.32 })),
      "↔ drag",
      { size: 9, align: Anchor.Center, opacity: 0.35 },
    ));

    // Scrubber hitbox over the center readout — centered-Point overload.
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
      pxPerUnit: Math.max(1, 200 / range), // ~200px = full range
      dataView: this.dataView,
      intent: 'edit',
      origin: this,
      onStart: () => { active.value = true; },
      onEnd: () => { active.value = false; },
    });

    // Min/max endpoint labels.
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

    // Wheel edit on the whole diagram (cmd+wheel, like sibling charts).
    const wheelConfig = {
      snapshot: () => value.value,
      restore: (_t: unknown, snap: number) => { value.value = Math.max(minV, Math.min(maxV, snap)); },
      dataView: this.dataView,
      intent: 'edit' as const,
      origin: this,
      onEnd: () => { this.dataView.settle(); },
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

    // Keyboard nav: ↑/↓ adjust value.
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

    // Cross-tile bridge — single-value chart, key is a fixed "value" string.
    let applyingExternal = false;
    const bridge = makeBridge({
      setHover: (_key) => { /* no-op for single-value */ },
      setSelect: (key) => { applyingExternal = true; focused.value = key === "value"; applyingExternal = false; },
    });
    (this as unknown as ElementWithBridge).brSync = bridge;
    biEffect(() => { const f = focused.value; if (applyingExternal) return; bridge.emitSelect(f ? "value" : null); });
  }
}
