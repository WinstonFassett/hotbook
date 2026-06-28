// Segmented gauge — same 270° sweep as the single-arc gauge, but partitioned
// into N segments. Each segment is a Num cell; the segments sum to a fixed
// total. Boundary knobs use the canonical Vec.lens([cellA, cellB]) pattern
// (same as pie / icicle / sunburst) so neighbor pairs redistribute their
// shared span, with Esc-revert via dragCancelable.

import {
  Anchor, cell, circle, derive, Diagram, effect as biEffect,
  group, label, mount, type Mount, Num, num, pathD, Vec, type Writable,
} from "bireactive";
import { arc as d3Arc } from "d3-shape";
import { wheelController } from "../lib/interaction";
import { dragCancelable } from "../lib/esc-contract";
import { makeBridge, type ElementWithBridge } from "../lib/hud-bridge";
import { useHostSize, FILL_STYLE } from "../lib/host-size";

const W = 320;
const H = 240;

const SWEEP_START = -Math.PI * 3 / 4;
const SWEEP_END = Math.PI * 3 / 4;
const SWEEP_SPAN = SWEEP_END - SWEEP_START;

const PALETTE = ['#e08888', '#d4a86c', '#ccc060', '#7ec87e', '#60c4c0', '#7aaae8', '#b090e0', '#8899b4'];

function arcD(rOuter: number, rInner: number, startAngle: number, endAngle: number, cornerRadius: number): string {
  return d3Arc()
    .innerRadius(rInner)
    .outerRadius(rOuter)
    .startAngle(startAngle)
    .endAngle(endAngle)
    .cornerRadius(cornerRadius)(null as any) ?? "";
}

function d3ToSvg(d3Angle: number): number { return d3Angle - Math.PI / 2; }

interface Segment {
  id: string;
  label: string;
  value: Writable<Num>;
}

function makeData(): Segment[] {
  const labels = ["Idle", "Build", "Test", "Deploy", "Review"];
  // Random values, then we let them sum to whatever; total stays fixed across
  // gestures because boundary knobs conserve neighbor pairs.
  return labels.map((l) => ({ id: l, label: l, value: num(Math.round(15 + Math.random() * 30)) }));
}

export class MdGaugeSegmentedLC extends Diagram {
  static styles = `text { pointer-events: none; }${FILL_STYLE}`;

  readonly dataCell = cell<readonly Segment[]>(makeData());

  set externalData(v: { id?: string; label: string; value: number }[] | undefined) {
    if (!v) return;
    this.dataCell.value = v.map((d) => ({
      id: d.id ?? d.label,
      label: d.label,
      value: num(Math.max(0, d.value)),
    }));
  }
  get externalData(): { id: string; label: string; value: number }[] {
    return (this.dataCell.value as Segment[]).map((d) => ({ id: d.id, label: d.label, value: d.value.value }));
  }

  protected scene(s: Mount): void {
    const { w: Wc, h: Hc } = useHostSize(this, { width: W, height: H });
    this.view(Wc, Hc);
    this.tabIndex = 0;
    this.style.outline = "none";

    const data = this.dataCell;
    const rows = data.value as Segment[];

    const cx = Num.derive(() => Wc.value / 2);
    const cy = Num.derive(() => Hc.value * 0.58);
    const rOuter = Num.derive(() => Math.max(40, Math.min(Wc.value, Hc.value) * 0.45));
    const thickness = Num.derive(() => Math.max(10, rOuter.value * 0.2));
    const rInner = Num.derive(() => rOuter.value - thickness.value);
    const rMid = Num.derive(() => (rOuter.value + rInner.value) / 2);

    const hovered = cell<Segment | null>(null);
    const selected = cell<Segment | null>(null);

    // Total — reactive sum of all segment values. Drives normalization so
    // boundary edits (which conserve neighbor pairs) keep the gauge full.
    const total = derive(() => (data.value as Segment[]).reduce((a, b) => a + b.value.value, 0));

    // Reactive cumulative fractions in [0,1] for segment ENDS, in order.
    // ends[i] = fraction-of-total after segment i. Length === rows.length.
    const ends = derive(() => {
      const rs = data.value as Segment[];
      const t = total.value || 1;
      const out: number[] = [];
      let acc = 0;
      for (const r of rs) { acc += r.value.value; out.push(acc / t); }
      return out;
    });

    // All arcs render inside a centered group.
    const g = s(group({ translate: Vec.derive(() => ({ x: cx.value, y: cy.value })) }));
    const gs = mount(g);

    for (let i = 0; i < rows.length; i++) {
      const d = rows[i]!;
      const color = PALETTE[i % PALETTE.length]!;

      const startFrac = derive(() => (i === 0 ? 0 : ends.value[i - 1] ?? 0));
      const endFrac = derive(() => ends.value[i] ?? 0);
      const startAngle = derive(() => SWEEP_START + startFrac.value * SWEEP_SPAN);
      const endAngle = derive(() => SWEEP_START + endFrac.value * SWEEP_SPAN);

      const isActive = derive(() => hovered.value === d || selected.value === d);
      const ro = derive(() => rOuter.value + (isActive.value ? 3 : 0));
      const ri = derive(() => rInner.value - (isActive.value ? 1 : 0));

      const seg = gs(pathD(
        derive(() => {
          if (ri.value < 1 || ro.value <= ri.value) return "";
          if (Math.abs(endAngle.value - startAngle.value) < 0.001) return "";
          // No corner radius on segments so neighbors join cleanly along the
          // boundary; the outer ends curve via the track padding instead.
          return arcD(ro.value, ri.value, startAngle.value, endAngle.value, 0);
        }),
        {
          fill: color,
          opacity: derive(() => selected.value && selected.value !== d ? 0.55 : 1),
        },
      ));
      seg.el.style.cursor = "pointer";
      seg.el.style.transition = "d 0.08s";
      seg.el.addEventListener("pointerenter", () => { if (!wheelController.active) hovered.value = d; });
      seg.el.addEventListener("pointerleave", () => { if (!wheelController.active && hovered.value === d) hovered.value = null; });
      seg.el.addEventListener("click", () => { selected.value = selected.value === d ? null : d; this.focus(); });

      // Per-segment mid-arc label.
      const midPos = Vec.derive(() => {
        const mid = (startAngle.value + endAngle.value) / 2;
        const sa = d3ToSvg(mid);
        return { x: cx.value + Math.cos(sa) * rMid.value, y: cy.value + Math.sin(sa) * rMid.value };
      });
      s(label(midPos, derive(() => {
        const span = (endAngle.value - startAngle.value);
        return span < 0.18 ? "" : d.label;
      }), { size: 10, align: Anchor.Center, fill: "#0b0d12" }));
    }

    // Boundary knobs between adjacent segments. Canonical Vec.lens pattern —
    // sources = [a, b], read returns the boundary position, write redistributes
    // the conserved span (va + vb) by the pointer's angular fraction.
    if (!this.hasAttribute("no-handles")) {
      for (let i = 0; i < rows.length - 1; i++) {
        const a = rows[i]!.value;
        const b = rows[i + 1]!.value;

        // Span endpoints of the (a, b) pair, in fractions of total — these
        // are layout outputs, peeked (never lens sources).
        const sFrac = derive(() => (i === 0 ? 0 : ends.value[i - 1] ?? 0));
        const eFrac = derive(() => ends.value[i + 1] ?? 0);

        const knob = Vec.lens(
          [a, b] as const,
          (vals: readonly [number, number]) => {
            const [va, vb] = vals;
            const s0 = SWEEP_START + sFrac.peek() * SWEEP_SPAN;
            const s1 = SWEEP_START + eFrac.peek() * SWEEP_SPAN;
            const sum = va + vb;
            const frac = sum === 0 ? 0.5 : va / sum;
            const ang = s0 + frac * (s1 - s0);
            const sa = d3ToSvg(ang);
            return {
              x: cx.peek() + Math.cos(sa) * rMid.peek(),
              y: cy.peek() + Math.sin(sa) * rMid.peek(),
            };
          },
          (target, vals: readonly [number, number]) => {
            const [va, vb] = vals;
            const sum = va + vb;
            const s0 = SWEEP_START + sFrac.peek() * SWEEP_SPAN;
            const s1 = SWEEP_START + eFrac.peek() * SWEEP_SPAN;
            if (sum === 0 || s1 <= s0) return [va, vb];
            const dx = target.x - cx.peek();
            const dy = target.y - cy.peek();
            let ang = Math.atan2(dy, dx) + Math.PI / 2;
            if (ang > Math.PI) ang -= 2 * Math.PI;
            ang = Math.max(s0, Math.min(s1, ang));
            const frac = (ang - s0) / (s1 - s0);
            const newA = frac * sum;
            return [newA, sum - newA];
          },
        );

        const knobPos = Vec.derive(() => {
          const va = a.value, vb = b.value;
          const s0 = SWEEP_START + sFrac.value * SWEEP_SPAN;
          const s1 = SWEEP_START + eFrac.value * SWEEP_SPAN;
          const sum = va + vb;
          const frac = sum === 0 ? 0.5 : va / sum;
          const ang = s0 + frac * (s1 - s0);
          const sa = d3ToSvg(ang);
          return { x: cx.value + Math.cos(sa) * rMid.value, y: cy.value + Math.sin(sa) * rMid.value };
        });

        const active = cell(false);
        const dotR = derive(() => Math.max(5, thickness.value * 0.32));
        const dot = s(circle(knobPos, dotR, {
          fill: "#fff",
          stroke: derive(() => active.value ? "#fff" : "#0b0d12"),
          strokeWidth: 1.5,
        }));
        dot.el.style.cursor = "grab";
        dragCancelable(dot, knob, [a, b], {
          host: this,
          onStart: () => { active.value = true; (this as any).gestureActive = true; },
          onEnd: () => { active.value = false; (this as any).gestureActive = false; this.dispatchEvent(new CustomEvent("gesturecommit")); },
        });
        dot.el.addEventListener("pointerenter", () => { active.value = true; });
        dot.el.addEventListener("pointerleave", () => { if (!(this as any).gestureActive) active.value = false; });
      }
    }

    // Center readout — selected/hovered segment label + value (% of total).
    s(label(
      Vec.derive(() => ({ x: cx.value, y: cy.value - rOuter.value * 0.2 })),
      derive(() => (selected.value ?? hovered.value)?.label ?? ""),
      { size: 11, align: Anchor.Center, opacity: 0.6 },
    ));
    s(label(
      Vec.derive(() => ({ x: cx.value, y: cy.value + rOuter.value * 0.1 })),
      derive(() => {
        const p = selected.value ?? hovered.value;
        if (!p) return "";
        const t = total.value || 1;
        return `${Math.round((p.value.value / t) * 100)}%`;
      }),
      { size: 28, align: Anchor.Center, fill: derive(() => {
        const p = selected.value ?? hovered.value;
        if (!p) return "#fff";
        const i = (data.value as Segment[]).indexOf(p);
        return PALETTE[i % PALETTE.length]!;
      }) },
    ));

    // Wheel edit — adjusts the hovered/selected segment. Drag conserves total;
    // wheel edits change the total, intentionally (segments are independent
    // Num cells; the boundary lens only conserves the (a,b) pair).
    const mutateDatum = (d: Segment, delta: number) => {
      d.value.value = Math.max(0, d.value.value + delta);
    };
    const wheelConfig = {
      snapshot: (d: Segment) => d.value.value,
      restore: (d: Segment, v: number) => { d.value.value = Math.max(0, v); },
      onEnd: () => { this.dispatchEvent(new CustomEvent("gesturecommit")); },
    };
    this.addEventListener("wheel", (e) => {
      const we = e as WheelEvent;
      if (!we.ctrlKey && !we.metaKey) return;
      const target = selected.value ?? hovered.value;
      const t = wheelController.begin(target, wheelConfig);
      if (!t) return;
      we.preventDefault();
      mutateDatum(t, we.deltaY < 0 ? (we.shiftKey ? 5 : 1) : (we.shiftKey ? -5 : -1));
    }, { passive: false });

    this.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      const rs = data.value as Segment[];
      if (ke.key === "Escape") {
        if (selected.value != null) { selected.value = null; ke.preventDefault(); }
        return;
      }
      const cur = selected.value;
      const i = cur ? rs.indexOf(cur) : -1;
      if (ke.key === "Tab" || ke.key === "ArrowRight" || ke.key === "ArrowLeft") {
        const next = (ke.key === "ArrowLeft" || (ke.key === "Tab" && ke.shiftKey))
          ? rs[(i <= 0 ? rs.length : i) - 1] ?? null
          : rs[(i + 1) % rs.length] ?? null;
        selected.value = next; ke.preventDefault(); return;
      }
      const target = cur ?? hovered.value;
      if (!target) return;
      const step = ke.shiftKey ? 5 : 1;
      if (ke.key === "ArrowUp") { mutateDatum(target, +step); ke.preventDefault(); }
      else if (ke.key === "ArrowDown") { mutateDatum(target, -step); ke.preventDefault(); }
    });

    // Cross-tile bridge — keyed on segment id.
    const idOf = (d: Segment | null) => d?.id ?? null;
    const datumAt = (id: string | null) => id == null ? null : (data.value as Segment[]).find(d => d.id === id) ?? null;
    let applyingExternal = false;
    const bridge = makeBridge({
      setHover: (key) => { applyingExternal = true; hovered.value = datumAt(key); applyingExternal = false; },
      setSelect: (key) => { applyingExternal = true; selected.value = datumAt(key); applyingExternal = false; },
    });
    (this as unknown as ElementWithBridge).brSync = bridge;
    biEffect(() => { const h = hovered.value; if (applyingExternal) return; bridge.emitHover(idOf(h)); });
    biEffect(() => { const sel = selected.value; if (applyingExternal) return; bridge.emitSelect(idOf(sel)); });
  }
}
