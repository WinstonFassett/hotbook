// ConcentricArc — editable concentric progress arcs, LC-style.
// Full-360° track per ring, rounded ends, value arc on top.
// Click ring to select · Tab/←/→ nav · ↑/↓ edit · cmd+wheel.

import { Anchor, cell, derive, Diagram, group, label, mount, type Mount, pathD, vec, Vec } from "bireactive";
import { arc as d3Arc } from "d3-shape";
import { installGestureRelease } from "../lib/interaction";

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
  externalData?: { label: string; value: number }[]
  protected scene(s: Mount): void {
    this.view(W, H);
    this.tabIndex = 0;
    this.style.outline = "none";

    const data = cell<readonly Ring[]>((this.externalData as unknown as Ring[]) ?? makeData());
    const hover = cell<Ring | null>(null);
    const selected = cell<Ring | null>(null);

    const mutateDatum = (d: Ring, delta: number) => {
      d.value = Math.max(0, Math.min(100, d.value + delta));
      data.value = [...data.value];
    };

    const wheelLocked = { current: null as Ring | null };
    installGestureRelease(() => { wheelLocked.current = null; });

    // All arcs rendered in a group translated to center.
    const g = s(group({ translate: vec(CX, CY) }));
    const gs = mount(g);

    for (let i = 0; i < (data.value as Ring[]).length; i++) {
      const d = (data.value as Ring[])[i]!;
      const rOuter = RING_OUTER_START - i * (RING_THICKNESS + RING_GAP);
      const rInner = rOuter - RING_THICKNESS;
      const corner = RING_THICKNESS / 2;

      // Full-circle track.
      const trackEl = gs(pathD(
        derive(() => arcD(rOuter, rInner, START, START + TWO_PI, corner)),
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
        const ro = rOuter + (isActive ? 4 : 0);
        const ri = rInner - (isActive ? 2 : 0);
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

      // Ring label near end-cap — d3Arc angle 0=top, clockwise; SVG: angle 0=right, y-down.
      const lblPos = Vec.derive(() => {
        const d3Angle = START + (d.value / 100) * TWO_PI; // d3Arc angle (0=top, cw)
        const svgAngle = d3Angle - Math.PI / 2;           // convert to SVG (0=right, cw y-down)
        const rMid = (rOuter + rInner) / 2;
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
      const t = selected.value ?? hover.value ?? wheelLocked.current;
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
      // Find which ring the pointer is over by radius.
      const rows = data.value as Ring[];
      let hit: Ring | null = null;
      for (let i = 0; i < rows.length; i++) {
        const rOuter = RING_OUTER_START - i * (RING_THICKNESS + RING_GAP);
        const rInner = rOuter - RING_THICKNESS;
        if (dist >= rInner - 4 && dist <= rOuter + 4) { hit = rows[i]!; break; }
      }
      if (!selected.value) hover.value = hit;
      wheelLocked.current = hit;
    });
    this.addEventListener("pointerleave", () => {
      hover.value = null;
      // Keep wheelLocked until gesture release so wheel still works just after leaving.
    });

    this.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") { selected.value = null; ke.preventDefault(); return; }
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
  }
}
