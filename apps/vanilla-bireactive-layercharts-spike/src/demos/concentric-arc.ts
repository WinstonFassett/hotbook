// ConcentricArc — editable concentric progress arcs, LC-style.
// Full-360° track per ring, rounded ends, value arc on top.
// Click ring to select · Tab/←/→ nav · ↑/↓ edit · cmd+wheel.

import { Anchor, cell, circle, derive, Diagram, effect as biEffect, group, label, mount, type Mount, pathD, vec, Vec } from "bireactive";
import { arc as d3Arc } from "d3-shape";
import { makeWheelGesture } from "../lib/interaction";
import { makeBridge, type ElementWithBridge } from "../lib/hud-bridge";

const W = 640;
const H = 640;
const CX = W / 2;
const CY = H / 2;

const RING_THICKNESS = 28;
const RING_GAP = 10;
const RING_OUTER_START = 210;
const RING_DEFS = [
  { label: "Speed",   color: "#e05c5c" },
  { label: "Power",   color: "#f0a742" },
  { label: "Stamina", color: "#4cba6e" },
  { label: "Focus",   color: "#5b8def" },
];

interface Ring {
  label: string;
  color: string;
  value: number; // 0–100
}

function makeData(): Ring[] {
  return RING_DEFS.map((r) => ({ ...r, value: Math.round(20 + Math.random() * 70) }));
}

// Build rounded arc path-d centered at 0,0 (caller applies group translate).
function arcD(rOuter: number, rInner: number, startAngle: number, endAngle: number, cornerRadius: number): string {
  return d3Arc()
    .innerRadius(rInner)
    .outerRadius(rOuter)
    .startAngle(startAngle)
    .endAngle(endAngle)
    .cornerRadius(cornerRadius)(null as any) ?? "";
}

const TWO_PI = 2 * Math.PI;
const START = 0; // d3Arc: 0 = top (12 o'clock), clockwise

export class MdConcentricArcLC extends Diagram {
  static styles = `text { pointer-events: none; }`
  readonly dataCell = cell<readonly Ring[]>(makeData());
  set externalData(v: { label: string; value: number }[] | undefined) {
    if (v) this.dataCell.value = v as unknown as Ring[];
  }
  get externalData(): { label: string; value: number }[] | undefined {
    return this.dataCell.value as unknown as { label: string; value: number }[];
  }
  protected scene(s: Mount): void {
    this.view(W, H);
    this.tabIndex = 0;
    this.style.outline = "none";

    const data = this.dataCell;
    const hover = cell<Ring | null>(null);
    const selected = cell<Ring | null>(null);

    const mutateDatum = (d: Ring, delta: number) => {
      d.value = Math.max(0, Math.min(100, d.value + delta));
      data.value = [...data.value];
    };

    const wheel = makeWheelGesture<Ring>({
      snapshot: (d) => d.value,
      restore: (d, v) => mutateDatum(d, v - d.value),
    });
    // Last ring the pointer was over — kept past pointerleave so a wheel edit can
    // still target it for a moment after the cursor exits the ring band.
    let lastRing: Ring | null = null;

    // All arcs rendered in a group translated to center.
    const g = s(group({ translate: vec(CX, CY) }));
    const gs = mount(g);

    // Rings are ordered by current sort rank. We mount MAX_RINGS slots and derive
    // radius from the ring's current position in data.value so sort-by-value reorders visually.
    const MAX_RINGS = (data.value as Ring[]).length;
    for (let i = 0; i < MAX_RINGS; i++) {
      const d = (data.value as Ring[])[i]!;
      // Derive radius from the ring's current rank in data.value (sort-stable).
      const rankOf = () => (data.value as Ring[]).indexOf(d);
      const rOuter = derive(() => RING_OUTER_START - rankOf() * (RING_THICKNESS + RING_GAP));
      const rInner = derive(() => rOuter.value - RING_THICKNESS);
      const corner = RING_THICKNESS / 2;

      // Full-circle track.
      const trackEl = gs(pathD(
        derive(() => arcD(rOuter.value, rInner.value, START, START + TWO_PI, corner)),
        { fill: d.color, opacity: derive(() => hover.value === d || selected.value === d ? 0.25 : 0.18) }
      ));
      trackEl.el.style.cursor = "pointer";
      trackEl.el.addEventListener("pointerenter", () => { hover.value = d; });
      trackEl.el.addEventListener("pointerleave", () => { if (hover.value === d) hover.value = null; });
      trackEl.el.addEventListener("click", () => { selected.value = selected.value === d ? null : d; this.focus(); });

      // Value arc — scale out slightly on hover/select instead of dimming others.
      const valueD = derive(() => {
        void data.value; // subscribe so mutateDatum's data.value = [...] triggers redraw
        const frac = d.value / 100;
        const endAngle = START + frac * TWO_PI;
        if (Math.abs(endAngle - START) < 0.001) return "";
        const isActive = hover.value === d || selected.value === d;
        const ro = rOuter.value + (isActive ? 4 : 0);
        const ri = rInner.value - (isActive ? 2 : 0);
        return arcD(ro, ri, START, endAngle, corner);
      });
      const valueStroke = derive(() =>
        selected.value === d ? "#fff" : hover.value === d ? d.color : "none"
      );
      const valueStrokeW = derive(() =>
        selected.value === d ? 1.5 : hover.value === d ? 3 : 0
      );
      const valueEl = gs(pathD(valueD, { fill: d.color, stroke: valueStroke, strokeWidth: valueStrokeW }));
      valueEl.el.style.cursor = "pointer";
      valueEl.el.style.transition = "d 0.1s";
      valueEl.el.addEventListener("pointerenter", () => { hover.value = d; });
      valueEl.el.addEventListener("pointerleave", () => { if (hover.value === d) hover.value = null; });
      valueEl.el.addEventListener("click", () => { selected.value = selected.value === d ? null : d; this.focus(); });

      // End-cap drag handle — circle at the arc tip, visible on hover/select.
      const handlePos = Vec.derive(() => {
        void data.value;
        const d3Angle = START + (d.value / 100) * TWO_PI;
        const svgAngle = d3Angle - Math.PI / 2;
        const rMid = (rOuter.value + rInner.value) / 2;
        return { x: CX + Math.cos(svgAngle) * rMid, y: CY + Math.sin(svgAngle) * rMid };
      });
      const handleR = derive(() => selected.value === d ? 7 : 6);
      const handleFill = derive(() => selected.value === d ? "#fff" : d.color);
      const handleOpacity = derive(() => (hover.value === d || selected.value === d) ? 1 : 0);
      const handleEl = s(circle(handlePos, handleR, {
        fill: handleFill,
        stroke: "#0b0d12",
        strokeWidth: 1.5,
        opacity: handleOpacity,
      }));
      handleEl.el.style.cursor = "pointer";
      handleEl.el.style.transition = "opacity 0.12s";
      handleEl.el.addEventListener("pointerenter", () => { hover.value = d; });
      handleEl.el.addEventListener("pointerleave", () => { if (hover.value === d) hover.value = null; });
      handleEl.el.addEventListener("click", () => { selected.value = selected.value === d ? null : d; this.focus(); });

      // Ring label near end-cap — d3Arc angle 0=top, clockwise; SVG: angle 0=right, y-down.
      const lblPos = Vec.derive(() => {
        void data.value; // subscribe to re-position when value or rank changes
        const d3Angle = START + (d.value / 100) * TWO_PI; // d3Arc angle (0=top, cw)
        const svgAngle = d3Angle - Math.PI / 2;           // convert to SVG (0=right, cw y-down)
        const rMid = (rOuter.value + rInner.value) / 2;
        return { x: CX + Math.cos(svgAngle) * (rMid + 22), y: CY + Math.sin(svgAngle) * (rMid + 22) };
      });
      s(label(lblPos, d.label, { size: 10, fill: d.color, opacity: 0.85 }));
    }

    // Center readout.
    s(label(vec(CX, CY - 10), derive(() => (selected.value ?? hover.value)?.label ?? ""), {
      size: 13, align: Anchor.Center, opacity: 0.5,
    }));
    s(label(vec(CX, CY + 14), derive(() => {
      void data.value;
      const p = selected.value ?? hover.value;
      return p ? `${p.value}` : "";
    }), { size: 28, align: Anchor.Center, fill: derive(() => (selected.value ?? hover.value)?.color ?? "#fff") }));

    const svgEl = (this as any).svg as SVGSVGElement;

    svgEl.addEventListener("wheel", (e) => {
      const we = e as WheelEvent;
      if (!we.ctrlKey) return;
      wheel.begin(selected.value ?? hover.value ?? lastRing);
      const t = wheel.target;
      if (!t) return;
      we.preventDefault();
      mutateDatum(t, we.deltaY < 0 ? (we.shiftKey ? 5 : 1) : (we.shiftKey ? -5 : -1));
    }, { passive: false });
    this.addEventListener("pointermove", (e) => {
      const pe = e as PointerEvent;
      const r = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox?.baseVal;
      const sx = vb && vb.width ? vb.width / r.width : 1;
      const sy = vb && vb.height ? vb.height / r.height : 1;
      const lx = (pe.clientX - r.left) * sx - CX;
      const ly = (pe.clientY - r.top) * sy - CY;
      const dist = Math.sqrt(lx * lx + ly * ly);
      // Find which ring the pointer is over by radius. Rank = position in data.value (sorted order).
      const rows = data.value as Ring[];
      let hit: Ring | null = null;
      for (let rank = 0; rank < rows.length; rank++) {
        const ro = RING_OUTER_START - rank * (RING_THICKNESS + RING_GAP);
        const ri = ro - RING_THICKNESS;
        if (dist >= ri - 4 && dist <= ro + 4) { hit = rows[rank]!; break; }
      }
      if (!selected.value) hover.value = hit;
      lastRing = hit;
    });
    this.addEventListener("pointerleave", () => {
      hover.value = null;
      // Keep lastRing until gesture release so wheel still works just after leaving.
    });

    this.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") {
        // No drag here: clear selection, else fall through (don't preventDefault).
        if (selected.value != null) { selected.value = null; ke.preventDefault(); }
        return;
      }
      const rows = data.value as Ring[];
      const cur = selected.value;
      const i = cur ? rows.indexOf(cur) : -1;
      if (ke.key === "Tab" || ke.key === "ArrowRight" || ke.key === "ArrowLeft") {
        const next = (ke.key === "ArrowLeft" || (ke.key === "Tab" && ke.shiftKey))
          ? rows[(i <= 0 ? rows.length : i) - 1] ?? null
          : rows[(i + 1) % rows.length] ?? null;
        selected.value = next;
        ke.preventDefault(); return;
      }
      const target = cur ?? hover.value;
      if (!target) return;
      const step = ke.shiftKey ? 5 : 1;
      if (ke.key === "ArrowUp") { mutateDatum(target, +step); ke.preventDefault(); }
      else if (ke.key === "ArrowDown") { mutateDatum(target, -step); ke.preventDefault(); }
    });

    s(label(vec(W / 2, 20), derive(() => {
      void data.value;
      const p = selected.value ?? hover.value;
      if (!p) return "ConcentricArc — hover · click ring · Tab/←/→ nav · ↑/↓ edit · wheel";
      return `${p.label}  ${p.value}%`;
    }), { size: 11, align: Anchor.Center, opacity: 0.7 }));

    // Cross-tile hover/select sync bridge.
    const ORDER = data.value as Ring[];
    const idxOf = (d: Ring | null) => { if (d == null) return null; const i = ORDER.indexOf(d); return i < 0 ? null : String(i); };
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
