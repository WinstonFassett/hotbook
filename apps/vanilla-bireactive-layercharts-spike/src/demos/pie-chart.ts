import { Anchor, annularSector, cell, circle, derive, Diagram, effect as biEffect, label, type Mount, Num, num, Vec, type Writable } from "bireactive";
import { pie } from "d3-shape";
import { wheelController } from "../lib/interaction";
import { makeBridge, type ElementWithBridge } from "../lib/hud-bridge";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import { dragCancelable } from "../lib/esc-contract";

const W = 640;
const H = 640;
const R_INNER = 0;

const PALETTE = ['#e08888', '#d4a86c', '#ccc060', '#7ec87e', '#60c4c0', '#7aaae8', '#b090e0', '#8899b4'];

interface Slice {
  label: string;
  // Writable Num cell — same shape as the hierarchical charts' node.value.total.
  // This is what lets the boundary knob use the canonical Vec.lens([a,b],...)
  // pattern (sources = writable cells) instead of empty-source side-effects.
  value: Writable<Num>;
}

function makeData(): Slice[] {
  return ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"].map((l) => ({
    label: l,
    value: num(Math.round(10 + Math.random() * 90)),
  }));
}

export class MdPieChartLC extends Diagram {
  static styles = `text { pointer-events: none; }${FILL_STYLE}`
  readonly dataCell = cell<readonly Slice[]>(makeData());
  sortBy: 'index' | 'value' = 'index';
  set externalData(v: { label: string; value: number }[] | undefined) {
    if (v) this.dataCell.value = v.map((d) => ({ label: d.label, value: num(d.value) }));
  }
  get externalData(): { label: string; value: number }[] | undefined {
    return this.dataCell.value.map((d) => ({ label: d.label, value: d.value.value }));
  }
  protected scene(s: Mount): void {
    const { w: Wc, h: Hc } = useHostSize(this, { width: W, height: H });
    this.view(Wc, Hc);
    this.tabIndex = 0;
    this.style.outline = "none";

    const data = this.dataCell;

    const hover = cell<Slice | null>(null);
    const selected = cell<Slice | null>(null);

    // Reactive center and radius based on host size.
    const cx = Num.derive(() => Wc.value / 2);
    const cy = Num.derive(() => Hc.value / 2);
    const rOuter = Num.derive(() => Math.min(Wc.value, Hc.value) / 2 - 20);
    const center = Vec.derive(() => ({ x: cx.value, y: cy.value }));

    const mutateDatum = (d: Slice, delta: number) => {
      d.value.value = Math.max(1, d.value.value + delta);
    };

    // Config handed to the SHARED wheel controller (app-wide singleton).
    const wheelConfig = {
      snapshot: (d: Slice) => d.value.value,
      restore: (d: Slice, v: number) => { d.value.value = Math.max(1, v); },
      onEnd: () => { hover.value = null; },
    };

    // Pie layout (reactive). Reads each slice's value CELL so the layout
    // recomputes whenever any value changes (drag, wheel, keyboard).
    const arcs = derive(() => {
      const layout = pie<Slice>().value((d) => d.value.value).sort(null);
      return layout(data.value as Slice[]);
    });

    // Draw slices.
    for (let i = 0; i < (data.value as Slice[]).length; i++) {
      const d = (data.value as Slice[])[i]!;
      const color = PALETTE[i % PALETTE.length]!;

      const arcDatum = derive(() => arcs.value[i]);
      const a0 = derive(() => arcDatum.value?.startAngle ?? 0);
      const a1 = derive(() => arcDatum.value?.endAngle ?? 0);
      const r = derive(() =>
        selected.value === d ? rOuter.value + 8 : hover.value === d ? rOuter.value + 4 : rOuter.value
      );
      const opacity = derive(() => selected.value && selected.value !== d ? 0.5 : 1);

      const sector = s(annularSector(center, r, R_INNER, a0, a1, {
        fill: color,
        stroke: "#0b0d12",
        strokeWidth: 1,
        opacity,
      }));
      sector.el.style.cursor = "pointer";
      sector.el.addEventListener("pointerenter", () => { if (!wheelController.active) hover.value = d; });
      sector.el.addEventListener("pointerleave", () => { if (!wheelController.active && hover.value === d) hover.value = null; });
      sector.el.addEventListener("click", () => { selected.value = selected.value === d ? null : d; });

      const labelPos = Vec.derive(() => {
        const arc = arcDatum.value;
        if (!arc) return { x: -100, y: -100 };
        const mid = (arc.startAngle + arc.endAngle) / 2;
        const r = rOuter.value * 0.65;
        return { x: cx.value + Math.cos(mid) * r, y: cy.value + Math.sin(mid) * r };
      });
      const sliceLabel = derive(() => {
        const arc = arcDatum.value;
        if (!arc || (arc.endAngle - arc.startAngle) < 0.25) return "";
        const total = (data.value as Slice[]).reduce((a, b) => a + b.value.value, 0);
        return `${d.label}\n${((d.value.value / total) * 100).toFixed(0)}%`;
      });
      s(label(labelPos, sliceLabel, { size: 11, align: Anchor.Center, fill: "#fff" }));
    }

    if (!this.hasAttribute("no-handles")) {
      const rows = data.value as Slice[];
      for (let i = 0; i < rows.length - 1; i++) {
        const a = rows[i]!.value;
        const b = rows[i + 1]!.value;
        // Shared angular span of the two adjacent slices. Peeked geometry —
        // these are derived layout outputs, never lens sources.
        const span0 = derive(() => arcs.value[i]?.startAngle ?? 0);
        const span1 = derive(() => arcs.value[i + 1]?.endAngle ?? 0);

        // Canonical boundary knob — IDENTICAL pattern to icicle/sunburst:
        //   sources = the two writable value cells [a, b]
        //   read    = position from (a,b) + peeked span geometry
        //   write   = returns [newA, newB]; framework flushes both atomically
        // No imperative side-effects, no reading the live `arcs` layout during
        // the drag — that coupling is what made the old pie jump.
        const knob = Vec.lens(
          [a, b] as const,
          (vals: readonly [number, number]) => {
            const [va, vb] = vals;
            const s0 = span0.peek();
            const s1 = span1.peek();
            const sum = va + vb;
            const frac = sum === 0 ? 0.5 : va / sum;
            const ang = s0 + frac * (s1 - s0);
            return { x: cx.peek() + Math.cos(ang) * rOuter.peek(), y: cy.peek() + Math.sin(ang) * rOuter.peek() };
          },
          (target, vals: readonly [number, number]) => {
            const [va, vb] = vals;
            const sum = va + vb;
            const s0 = span0.peek();
            const s1 = span1.peek();
            if (sum === 0 || s1 <= s0) return [va, vb];
            let ang = Math.atan2(target.y - cy.peek(), target.x - cx.peek());
            if (ang < 0) ang += 2 * Math.PI;
            while (ang < s0 - Math.PI) ang += 2 * Math.PI;
            while (ang > s1 + Math.PI) ang -= 2 * Math.PI;
            const frac = Math.max(0, Math.min(1, (ang - s0) / (s1 - s0)));
            const newA = frac * sum;
            return [newA, sum - newA];
          },
        );

        // Separate reactive derive drives the VISUAL position so the dot tracks
        // layout live (matches the sibling layercharts charts' knobPos).
        const knobPos = Vec.derive(() => {
          const va = a.value, vb = b.value;
          const sum = va + vb;
          const frac = sum === 0 ? 0.5 : va / sum;
          const ang = span0.value + frac * (span1.value - span0.value);
          return { x: cx.value + Math.cos(ang) * rOuter.value, y: cy.value + Math.sin(ang) * rOuter.value };
        });

        const color = PALETTE[i % PALETTE.length]!;
        const active = cell(false);
        const dot = s(circle(knobPos, 5, {
          fill: color,
          stroke: derive(() => active.value ? "#fff" : "#000"),
          strokeWidth: 1.5,
        }));
        // Cancelable divider drag: snapshots [a,b] on down, redistributes between
        // the two adjacent slices. Pie layout is .sort(null) (never reorders), so
        // there is no sort-order concern here.
        dragCancelable(dot, knob, [a, b], {
          host: this,
          onStart: () => { active.value = true; (this as any).gestureActive = true; },
          onEnd: () => { active.value = false; (this as any).gestureActive = false; },
        });
        dot.el.style.cursor = "grab";
        dot.el.addEventListener("pointerenter", () => { active.value = true; });
        dot.el.addEventListener("pointerleave", () => { if (!(this as any).gestureActive) active.value = false; });
      }
    }

    this.addEventListener("wheel", (e) => {
      const we = e as WheelEvent;
      if (!we.ctrlKey) return;
      const t = wheelController.begin(hover.value ?? selected.value, wheelConfig);
      if (!t) return;
      we.preventDefault();
      mutateDatum(t, we.deltaY < 0 ? (we.shiftKey ? 5 : 1) : (we.shiftKey ? -5 : -1));
    }, { passive: false });

    this.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") {
        // Drag-Esc is owned by the gesture (dragCancelable). Here: clear selection
        // if focused, else fall through.
        if (selected.value != null) { selected.value = null; ke.preventDefault(); }
        return;
      }
      const rows = data.value as Slice[];
      const cur = selected.value;
      const i = cur ? rows.indexOf(cur) : -1;
      if (ke.key === "Tab" || ke.key === "ArrowRight" || ke.key === "ArrowLeft") {
        const next = (ke.key === "ArrowLeft" || (ke.key === "Tab" && ke.shiftKey))
          ? rows[(i <= 0 ? rows.length : i) - 1] ?? null
          : rows[(i + 1) % rows.length] ?? null;
        selected.value = next;
        ke.preventDefault(); return;
      }
      if (!cur) return;
      const step = ke.shiftKey ? 5 : 1;
      if (ke.key === "ArrowUp") { mutateDatum(cur, +step); ke.preventDefault(); }
      else if (ke.key === "ArrowDown") { mutateDatum(cur, -step); ke.preventDefault(); }
    });

    s(label(
      Vec.derive(() => ({ x: Wc.value / 2, y: 14 })),
      derive(() => {
        const p = selected.value ?? hover.value;
        if (!p) return "PieChart — click · ←/→ navigate · ↑/↓ edit · cmd+wheel";
        const total = (data.value as Slice[]).reduce((a, b) => a + b.value.value, 0);
        return `${p.label}  ${p.value.value.toFixed(0)}  (${((p.value.value / total) * 100).toFixed(1)}%)`;
      }),
      { size: 11, align: Anchor.Center, opacity: 0.7 },
    ));

    const ORDER = data.value as Slice[];
    const idxOf = (d: Slice | null) => { if (d == null) return null; const i = ORDER.indexOf(d); return i < 0 ? null : String(i); };
    const datumAt = (key: string | null) => { if (key == null) return null; const i = Number(key); return Number.isInteger(i) && i >= 0 && i < ORDER.length ? ORDER[i]! : null; };
    let applyingExternal = false;
    const bridge = makeBridge({
      setHover: (key) => { applyingExternal = true; hover.value = datumAt(key); applyingExternal = false; },
      setSelect: (key) => { applyingExternal = true; selected.value = datumAt(key); applyingExternal = false; },
    });
    (this as unknown as ElementWithBridge).brSync = bridge;
    biEffect(() => { const h = hover.value; if (applyingExternal) return; bridge.emitHover(idxOf(h)); });
    biEffect(() => { const sel = selected.value; if (applyingExternal) return; bridge.emitSelect(idxOf(sel)); });
  }
}
