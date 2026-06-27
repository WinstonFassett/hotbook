// ConcentricArc — editable concentric progress arcs, LC-style.
// Full-360° track per ring, rounded ends, value arc on top.
// Click ring to select · Tab/←/→ nav · ↑/↓ edit · cmd+wheel.

import { Anchor, cell, circle, derive, Diagram, effect as biEffect, group, label, mount, type Mount, pathD, vec, Vec } from "bireactive";
import { arc as d3Arc } from "d3-shape";
import { wheelController, dragController } from "../lib/interaction";
import { makeBridge, type ElementWithBridge } from "../lib/hud-bridge";
import { useHostSize, FILL_STYLE } from "../lib/host-size";

const W = 640;
const H = 640;

const RING_GAP = 8;
// Fraction of total radius reserved as empty center (for label readout / future hover info).
// 1.5 means the dead zone equals 1.5 ring-step widths.
const INNER_RESERVE = 1.5;
const MAX_RINGS = 8;

const RING_DEFS = [
  { label: "Speed",    color: "#e05c5c" },
  { label: "Power",    color: "#f0a742" },
  { label: "Stamina",  color: "#4cba6e" },
  { label: "Focus",    color: "#5b8def" },
  { label: "Agility",  color: "#c07ef0" },
  { label: "Endure",   color: "#4ecde6" },
  { label: "Reflex",   color: "#f06090" },
  { label: "Vision",   color: "#a0c840" },
];

interface Ring {
  label: string;
  color: string;
  value: number; // 0–100
}

function makeData(): Ring[] {
  return RING_DEFS.slice(0, MAX_RINGS).map((r) => ({ ...r, value: Math.round(20 + Math.random() * 70) }));
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
// Floor on a ring's value so the arc never collapses to a useless near-zero
// sliver. Applies to wheel, keyboard, AND drag edits.
const MIN_VALUE = 3;

export class MdConcentricArcLC extends Diagram {
  static styles = `text { pointer-events: none; }${FILL_STYLE}`
  readonly dataCell = cell<readonly Ring[]>(makeData());
  sortBy: 'index' | 'value' = 'index';
  set externalData(v: { label: string; value: number }[] | undefined) {
    if (v) this.dataCell.value = v as unknown as Ring[];
  }
  get externalData(): { label: string; value: number }[] | undefined {
    return this.dataCell.value as unknown as { label: string; value: number }[];
  }
  protected scene(s: Mount): void {
    const { w: Wc, h: Hc } = useHostSize(this, { width: W, height: H });
    this.view(Wc, Hc);
    this.tabIndex = 0;
    this.style.outline = "none";

    const cx = derive(() => Wc.value / 2);
    const cy = derive(() => Hc.value / 2);

    const data = this.dataCell;
    const n = Math.min((data.value as Ring[]).length, MAX_RINGS);

    // Outermost ring outer radius — fills the container with padding for end-cap labels.
    const rOuterStart = derive(() => Math.min(Wc.value, Hc.value) / 2 - 30);
    // Total slots = n rings + INNER_RESERVE dead zone at center.
    // (n + INNER_RESERVE) * (thickness + gap) - gap = rOuterStart
    // → thickness = (rOuterStart + gap) / (n + INNER_RESERVE) - gap
    const ringThickness = derive(() =>
      Math.max(6, (rOuterStart.value + RING_GAP) / (n + INNER_RESERVE) - RING_GAP)
    );
    const ringStep = derive(() => ringThickness.value + RING_GAP);
    const hover = cell<Ring | null>(null);
    const selected = cell<Ring | null>(null);

    const setValue = (d: Ring, v: number) => {
      d.value = Math.max(MIN_VALUE, Math.min(100, v));
      data.value = [...data.value];
    };
    const mutateDatum = (d: Ring, delta: number) => setValue(d, d.value + delta);

    // Config handed to the SHARED wheel controller (app-wide singleton).
    const wheelConfig = {
      snapshot: (d: Ring) => d.value,
      restore: (d: Ring, v: number) => mutateDatum(d, v - d.value),
    };
    // Last ring the pointer was over — kept past pointerleave so a wheel edit can
    // still target it for a moment after the cursor exits the ring band.
    let lastRing: Ring | null = null;

    const svgEl = (this as any).svg as SVGSVGElement;
    // Pointer → diagram-local coords (CX/CY origin at center, SVG-space angles).
    const localPt = (e: PointerEvent) => {
      const r = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox?.baseVal;
      const sx = vb && vb.width ? vb.width / r.width : 1;
      const sy = vb && vb.height ? vb.height / r.height : 1;
      return { x: (e.clientX - r.left) * sx - cx.peek(), y: (e.clientY - r.top) * sy - cy.peek() };
    };
    // Pointer angle → ring value (0–100). d3Arc angle 0 = top, clockwise; SVG
    // atan2 is 0 = right, so add π/2. Unwrap into [0, 2π).
    const angleToValue = (lx: number, ly: number): number => {
      let d3Angle = Math.atan2(ly, lx) + Math.PI / 2;
      if (d3Angle < 0) d3Angle += TWO_PI;
      return (d3Angle / TWO_PI) * 100;
    };

    // Drag a ring's end-cap handle angularly to set its value; Esc reverts.
    // Config handed to the SHARED drag controller (one pointer, one live drag).
    let dragPointerId = -1;
    const onDragMove = (pe: PointerEvent) => {
      const t = dragController.target as Ring | null;
      if (!t) return;
      const { x, y } = localPt(pe);
      setValue(t, angleToValue(x, y));
    };
    const dragConfig = {
      snapshot: (d: Ring) => d.value,
      restore: (d: Ring, v: number) => setValue(d, v),
      onMove: onDragMove,
      onEnd: () => {
        if (dragPointerId >= 0 && (this as any).hasPointerCapture?.(dragPointerId)) {
          (this as any).releasePointerCapture(dragPointerId);
        }
        dragPointerId = -1;
      },
    };

    // All arcs rendered in a group translated to center.
    const g = s(group({ translate: Vec.derive(() => ({ x: cx.value, y: cy.value })) }));
    const gs = mount(g);

    // Rings are ordered by current sort rank. Capped at n (≤ MAX_RINGS).
    for (let i = 0; i < n; i++) {
      const d = (data.value as Ring[])[i]!;
      // Derive radius from the ring's current rank in data.value (sort-stable).
      const rankOf = () => (data.value as Ring[]).indexOf(d);
      const rOuter = derive(() => rOuterStart.value - rankOf() * ringStep.value);
      const rInner = derive(() => rOuter.value - ringThickness.value);
      const corner = derive(() => Math.min(ringThickness.value / 2, 14));

      // Full-circle track.
      const trackEl = gs(pathD(
        derive(() => rInner.value >= 1 ? arcD(rOuter.value, rInner.value, START, START + TWO_PI, corner.value) : ""),
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
        return arcD(ro, ri, START, endAngle, corner.value);
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
        return { x: cx.value + Math.cos(svgAngle) * rMid, y: cy.value + Math.sin(svgAngle) * rMid };
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
      handleEl.el.style.cursor = "grab";
      handleEl.el.style.transition = "opacity 0.12s";
      handleEl.el.addEventListener("pointerenter", () => { if (!dragController.active) hover.value = d; });
      handleEl.el.addEventListener("pointerleave", () => { if (!dragController.active && hover.value === d) hover.value = null; });
      // Drag the handle around the ring to set its value; the shared controller
      // owns move/up/Esc and reverts on Esc.
      handleEl.el.addEventListener("pointerdown", (e) => {
        if (dragController.active || this.sortBy === 'value') return;
        const pe = e as PointerEvent;
        dragPointerId = pe.pointerId;
        selected.value = d;
        try { (this as any).setPointerCapture(pe.pointerId); } catch { /* ok */ }
        dragController.begin(d, dragConfig);
        pe.preventDefault();
        pe.stopPropagation();
      });

      // Ring label near end-cap — d3Arc angle 0=top, clockwise; SVG: angle 0=right, y-down.
      const lblPos = Vec.derive(() => {
        void data.value; // subscribe to re-position when value or rank changes
        const d3Angle = START + (d.value / 100) * TWO_PI; // d3Arc angle (0=top, cw)
        const svgAngle = d3Angle - Math.PI / 2;           // convert to SVG (0=right, cw y-down)
        const rMid = (rOuter.value + rInner.value) / 2;
        return { x: cx.value + Math.cos(svgAngle) * (rMid + 22), y: cy.value + Math.sin(svgAngle) * (rMid + 22) };
      });
      s(label(lblPos, d.label, { size: 10, fill: d.color, opacity: 0.85 }));
    }

    // Center readout.
    s(label(Vec.derive(() => ({ x: cx.value, y: cy.value - 10 })), derive(() => (selected.value ?? hover.value)?.label ?? ""), {
      size: 13, align: Anchor.Center, opacity: 0.5,
    }));
    s(label(Vec.derive(() => ({ x: cx.value, y: cy.value + 14 })), derive(() => {
      void data.value;
      const p = selected.value ?? hover.value;
      return p ? `${p.value}` : "";
    }), { size: 28, align: Anchor.Center, fill: derive(() => (selected.value ?? hover.value)?.color ?? "#fff") }));

    svgEl.addEventListener("wheel", (e) => {
      const we = e as WheelEvent;
      if (!we.ctrlKey || this.sortBy === 'value') return;
      const t = wheelController.begin(selected.value ?? hover.value ?? lastRing, wheelConfig);
      if (!t) return;
      we.preventDefault();
      mutateDatum(t, we.deltaY < 0 ? (we.shiftKey ? 5 : 1) : (we.shiftKey ? -5 : -1));
    }, { passive: false });
    this.addEventListener("pointermove", (e) => {
      if (dragController.active || wheelController.active) return;
      const pe = e as PointerEvent;
      const r = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox?.baseVal;
      const sx = vb && vb.width ? vb.width / r.width : 1;
      const sy = vb && vb.height ? vb.height / r.height : 1;
      const lx = (pe.clientX - r.left) * sx - cx.peek();
      const ly = (pe.clientY - r.top) * sy - cy.peek();
      const dist = Math.sqrt(lx * lx + ly * ly);
      // Find which ring the pointer is over by radius. Rank = position in data.value (sorted order).
      const rows = data.value as Ring[];
      let hit: Ring | null = null;
      for (let rank = 0; rank < rows.length; rank++) {
        const ro = rOuterStart.peek() - rank * ringStep.peek();
        const ri = ro - ringThickness.peek();
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

    s(label(Vec.derive(() => ({ x: Wc.value / 2, y: 20 })), derive(() => {
      void data.value;
      const p = selected.value ?? hover.value;
      if (!p) return "ConcentricArc — hover · click ring · drag handle · Tab/←/→ nav · ↑/↓ edit · cmd+wheel";
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
