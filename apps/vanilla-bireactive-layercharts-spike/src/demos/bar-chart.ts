// BarChart — vanilla-TS port of LayerChart's BarChart wrapper.

import { Anchor, cell, derive, Diagram, effect as biEffect, label, line, type Mount, rect, Vec, vec } from "bireactive";
import { scaleBand } from "d3-scale";
import { axis } from "../lib/axis";
import { chartContext } from "../lib/chart-context";
import { installGestureRelease } from "../lib/interaction";
import { makeBridge, type ElementWithBridge } from "../lib/hud-bridge";

const W = 720;
const H = 360;
const COLOR = "#7aaae8";

interface Bar {
  label: string;
  value: number;
}

function makeData(): Bar[] {
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return labels.map((l) => ({ label: l, value: Math.round(20 + Math.random() * 80) }));
}

export class MdBarChartLC extends Diagram {
  // Labels/axes must never intercept pointer events — they sit on top of the
  // data marks and would otherwise block the hover/wheel hit-test.
  static styles = `text { pointer-events: none; }`
  /** Live data cell. Assigning `externalData` writes into it, updating the
   *  chart in place (no remount). Set before connect for the initial scene. */
  readonly dataCell = cell<readonly Bar[]>(makeData());
  set externalData(v: { label: string; value: number }[] | undefined) {
    if (v) this.dataCell.value = v as Bar[];
  }
  get externalData(): { label: string; value: number }[] | undefined {
    return this.dataCell.value as Bar[];
  }
  protected scene(s: Mount): void {
    this.view(W, H);
    this.tabIndex = 0;
    this.style.outline = "none";

    const data = this.dataCell;

    const PAD = { top: 16, right: 24, bottom: 36, left: 48 };
    const plotX = PAD.left;
    const plotY = PAD.top;
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    // Band scale for x (not going through chartContext — scaleBand is ordinal).
    const xBand = derive(() => {
      return scaleBand<string>()
        .domain(data.value.map((d) => d.label))
        .range([plotX, plotX + plotW])
        .padding(0.25);
    });

    // Use chartContext just for the y scale.
    const ctx = chartContext<Bar>({
      width: W, height: H, data,
      x: (d) => d.label, y: (d) => d.value,
      padding: PAD,
      yNice: true, yBaseline: 0,
    });

    // Bottom axis — drawn manually using xBand (scaleBand doesn't work through chartContext).
    const ay1 = plotY + plotH;
    s(line(vec(plotX, ay1), vec(plotX + plotW, ay1), { thin: true, opacity: 0.5, stroke: "#888" }));
    for (const d of data.value as Bar[]) {
      const tx = derive(() => (xBand.value(d.label) ?? 0) + xBand.value.bandwidth() / 2);
      s(
        line(Vec.derive(() => ({ x: tx.value, y: ay1 })), Vec.derive(() => ({ x: tx.value, y: ay1 + 4 })), { thin: true, stroke: "#888", opacity: 0.6 }),
        label(Vec.derive(() => ({ x: tx.value, y: ay1 + 16 })), d.label, { size: 10, align: Anchor.Center, fill: "#888", opacity: 0.8 }),
      );
    }
    axis(s, ctx, { placement: "left" });

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
      const rows = data.value as Bar[];
      for (const d of rows) {
        const bx = xs(d.label) ?? -1;
        if (px >= bx && px < bx + step) return d;
      }
      return null;
    };

    const mutateDatum = (d: Bar, delta: number) => {
      d.value = Math.max(0, d.value + delta);
      data.value = [...data.value];
    };

    const wheelLocked = { current: null as Bar | null };
    installGestureRelease(() => { wheelLocked.current = null; hover.value = null; });

    let dragTarget: Bar | null = null;
    // Pre-gesture value so Esc reverts the drag (gen-1 parity).
    let dragStartValue = 0;
    let dragPointerId = -1;
    const cancelDrag = () => {
      if (!dragTarget) return;
      mutateDatum(dragTarget, dragStartValue - dragTarget.value);
      if (dragPointerId >= 0 && (this as any).hasPointerCapture?.(dragPointerId)) {
        (this as any).releasePointerCapture(dragPointerId);
      }
      dragTarget = null;
      dragPointerId = -1;
    };

    this.addEventListener("pointerleave", () => { if (!wheelLocked.current) hover.value = null; });
    this.addEventListener("click", (e) => {
      const { x } = localPoint(e as PointerEvent);
      const pt = findAtPixel(x);
      selected.value = selected.value === pt ? null : pt;
    });
    this.addEventListener("wheel", (e) => {
      const we = e as WheelEvent;
      if (!(we.metaKey || we.ctrlKey)) return;
      if (!wheelLocked.current) wheelLocked.current = hover.value ?? selected.value;
      const t = wheelLocked.current;
      if (!t) return;
      we.preventDefault();
      mutateDatum(t, we.deltaY < 0 ? (we.shiftKey ? 5 : 1) : (we.shiftKey ? -5 : -1));
    }, { passive: false });
    this.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") {
        // cancel drag → revert; else clear selection; else fall through.
        if (dragTarget) { cancelDrag(); ke.preventDefault(); }
        else if (selected.value != null) { selected.value = null; ke.preventDefault(); }
        return;
      }
      const rows = data.value as Bar[];
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
    this.addEventListener("pointerdown", (e) => {
      const pe = e as PointerEvent;
      const { x, y } = localPoint(pe);
      const pt = findAtPixel(x);
      if (!pt) return;
      const topY = (ctx.yScale.value as any)(pt.value);
      if (Math.abs(y - topY) > 12) return;
      dragTarget = pt;
      dragStartValue = pt.value;
      dragPointerId = pe.pointerId;
      selected.value = pt;
      (this as any).setPointerCapture(pe.pointerId);
      pe.preventDefault();
    });
    this.addEventListener("pointermove", (e) => {
      const pe = e as PointerEvent;
      if (dragTarget) {
        const { y } = localPoint(pe);
        const ys = ctx.yScale.value as any;
        mutateDatum(dragTarget, ys.invert(y) - dragTarget.value);
        return;
      }
      if (wheelLocked.current) return;
      const { x } = localPoint(pe);
      hover.value = findAtPixel(x);
    });
    this.addEventListener("pointerup", () => { dragTarget = null; dragPointerId = -1; });
    this.addEventListener("pointercancel", () => { dragTarget = null; dragPointerId = -1; });

    // Column hover highlight — full-height rect that slides to the active column.
    const hlTarget = derive(() => hover.value ?? selected.value);
    const hlX = derive(() => {
      const t = hlTarget.value;
      return t ? (xBand.value(t.label) ?? 0) - (xBand.value.step() - xBand.value.bandwidth()) / 2 : -9999;
    });
    const hlW = derive(() => xBand.value.step());
    const hlRect = s(rect(hlX, plotY, hlW, plotH, {
      fill: "#ffffff",
      opacity: derive(() => hlTarget.value ? 0.06 : 0),
    }));
    hlRect.el.style.transition = "x 0.15s ease, opacity 0.1s ease";
    hlRect.el.style.pointerEvents = "none";

    // Draw bars.
    for (const d of data.value as Bar[]) {
      const barX = derive(() => xBand.value(d.label) ?? 0);
      const barW = derive(() => xBand.value.bandwidth());
      const barY = derive(() => (ctx.yScale.value as any)(d.value));
      const barH = derive(() => Math.max(0, plotY + plotH - barY.value));
      const fill = derive(() =>
        selected.value === d ? "#fff" : hover.value === d ? "#a4c0f0" : COLOR
      );
      const tile = s(rect(barX, barY, barW, barH, { fill, corner: 2 }));
      tile.el.style.cursor = "pointer";
      tile.el.addEventListener("pointerenter", () => { if (!wheelLocked.current) hover.value = d; });
      tile.el.addEventListener("pointerleave", () => { if (!wheelLocked.current && hover.value === d) hover.value = null; });
      tile.el.addEventListener("click", () => { selected.value = selected.value === d ? null : d; });
    }

    s(label(
      vec(W / 2, 12),
      derive(() => {
        const p = selected.value ?? hover.value;
        if (!p) return "BarChart — hover · click · ←/→ navigate · ↑/↓ edit · cmd+wheel · drag top";
        return `${p.label}  ${p.value}`;
      }),
      { size: 11, align: Anchor.Center, opacity: 0.7 },
    ));

    // Cross-tile hover/select sync bridge.
    const ORDER = data.value as Bar[];
    const idxOf = (d: Bar | null) => { if (d == null) return null; const i = ORDER.indexOf(d); return i < 0 ? null : String(i); };
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
