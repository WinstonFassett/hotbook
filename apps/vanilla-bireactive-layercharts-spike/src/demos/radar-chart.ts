// RadarChart — spider / radar chart with editing.
// Mirrors LC's radial Chart + scaleBand for x (angle per category).
// Grid: polygon rings at radius ticks + spoke lines. Points on polygon are clickable/editable.

import { Anchor, cell, circle, derive, Diagram, effect as biEffect, label, type Mount, pathD, Vec, vec } from "bireactive";
import { scaleBand, scaleLinear } from "d3-scale";
import { wheelController, dragController } from "../lib/interaction";
import { makeBridge, type ElementWithBridge } from "../lib/hud-bridge";

const W = 640;
const H = 640;
const CX = W / 2;
const CY = H / 2;

const TICKS = [0, 25, 50, 75, 100];
const R_MAX = 220;
const COLOR = "#7aaae8";

interface Spoke {
  name: string;
  value: number; // 0–100
}

function makeData(): Spoke[] {
  return ["Speed", "Power", "Agility", "Defense", "Stamina", "Technique"].map((name) => ({
    name,
    value: Math.round(30 + Math.random() * 60),
  }));
}

export class MdRadarChartLC extends Diagram {
  static styles = `text { pointer-events: none; }`
  readonly dataCell = cell<readonly Spoke[]>(makeData());
  sortBy: 'index' | 'value' = 'index';
  set externalData(v: { label: string; value: number }[] | undefined) {
    if (v) this.dataCell.value = v as unknown as Spoke[];
  }
  get externalData(): { label: string; value: number }[] | undefined {
    return this.dataCell.value as unknown as { label: string; value: number }[];
  }
  protected scene(s: Mount): void {
    this.view(W, H);
    this.tabIndex = 0;
    this.style.outline = "none";

    const data = this.dataCell;
    const hover = cell<Spoke | null>(null);
    const selected = cell<Spoke | null>(null);

    const mutateDatum = (d: Spoke, delta: number) => {
      d.value = Math.max(0, Math.min(100, d.value + delta));
      data.value = [...data.value];
    };

    // Config handed to the SHARED wheel controller (app-wide singleton).
    const wheelConfig = {
      snapshot: (d: Spoke) => d.value,
      restore: (d: Spoke, v: number) => mutateDatum(d, v - d.value),
      onEnd: () => { hover.value = null; },
    };

    // x: scaleBand over category names → angle at band center
    // y: scaleLinear 0–100 → radius 0–R_MAX
    const xScale = derive(() => {
      const rows = data.value as Spoke[];
      return scaleBand<string>()
        .domain(rows.map((d) => d.name))
        .range([0, 2 * Math.PI])
        .padding(0);
    });
    const yScale = derive(() =>
      scaleLinear().domain([0, 100]).range([0, R_MAX])
    );

    // Angle for spoke i (band center)
    const angle = (i: number): number => {
      const rows = data.value as Spoke[];
      const xs = xScale.value;
      return (xs(rows[i]!.name) ?? 0) + xs.bandwidth() / 2 - Math.PI / 2;
    };

    // Polygon at a given radius tick — static grid rings.
    for (const tick of TICKS) {
      const r = (tick / 100) * R_MAX;
      const ringD = derive(() => {
        const rows = data.value as Spoke[];
        const n = rows.length;
        const pts = rows.map((_, i) => {
          const a = angle(i);
          return `${i === 0 ? "M" : "L"}${(CX + Math.cos(a) * r).toFixed(1)},${(CY + Math.sin(a) * r).toFixed(1)}`;
        });
        return pts.join(" ") + " Z";
      });
      if (tick === 0) continue;
      s(pathD(ringD, { stroke: "#ffffff", opacity: 0.1, strokeWidth: 1 }));
    }

    // Spoke lines + labels — rendered as derived paths so they react to count changes.
    // One <path> element per spoke slot up to MAX_SPOKES; hidden when slot is out of range.
    const MAX_SPOKES = 20;
    const spokeD = derive(() => {
      const rows = data.value as Spoke[];
      const pts: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const a = angle(i);
        const tx = (CX + Math.cos(a) * R_MAX).toFixed(1);
        const ty = (CY + Math.sin(a) * R_MAX).toFixed(1);
        pts.push(`M${CX},${CY}L${tx},${ty}`);
      }
      return pts.join(" ");
    });
    s(pathD(spokeD, { fill: "none", stroke: "#ffffff", opacity: 0.12, strokeWidth: 1 }));

    // Labels — one text element per slot, repositioned + renamed reactively.
    for (let i = 0; i < MAX_SPOKES; i++) {
      const lblPos = Vec.derive(() => {
        const rows = data.value as Spoke[];
        if (i >= rows.length) return { x: -1000, y: -1000 }; // hide off-screen
        const a = angle(i);
        const r = R_MAX + 22;
        return { x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r };
      });
      const lblText = derive(() => {
        const rows = data.value as Spoke[];
        return i < rows.length ? rows[i]!.name : "";
      });
      s(label(lblPos, lblText, { size: 11, align: Anchor.Center, fill: "#aaa" }));
    }

    // Filled polygon (value area).
    const polyD = derive(() => {
      const rows = data.value as Spoke[];
      const ys = yScale.value;
      const pts = rows.map((d, i) => {
        const a = angle(i);
        const r = ys(d.value);
        const x = (CX + Math.cos(a) * r).toFixed(1);
        const y = (CY + Math.sin(a) * r).toFixed(1);
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      });
      return pts.join(" ") + " Z";
    });

    s(pathD(polyD, { fill: COLOR, stroke: "none", opacity: 0.18 }));
    s(pathD(polyD, { fill: "none", stroke: COLOR, strokeWidth: 2, opacity: 0.85 }));

    // Data points — one slot per MAX_SPOKES; each reads data.value[i] reactively.
    for (let i = 0; i < MAX_SPOKES; i++) {
      const dotPos = Vec.derive(() => {
        const rows = data.value as Spoke[];
        if (i >= rows.length) return { x: -1000, y: -1000 }; // hide off-screen
        const a = angle(i);
        const r = yScale.value(rows[i]!.value);
        return { x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r };
      });
      const dotR = derive(() => {
        const rows = data.value as Spoke[];
        const d = rows[i];
        if (!d) return 0;
        return selected.value === d ? 8 : hover.value === d ? 7 : 5;
      });
      const dotStroke = derive(() => {
        const rows = data.value as Spoke[];
        const d = rows[i];
        if (!d) return "#0b0d12";
        return selected.value === d ? "#fff" : hover.value === d ? "#fff" : "#0b0d12";
      });
      const dotStrokeW = derive(() => {
        const rows = data.value as Spoke[];
        const d = rows[i];
        return d && selected.value === d ? 2.5 : 1.5;
      });
      const dot = s(circle(dotPos, dotR, { fill: COLOR, stroke: dotStroke, strokeWidth: dotStrokeW }));
      dot.el.style.cursor = "ns-resize";
      dot.el.addEventListener("pointerenter", () => {
        const d = (data.value as Spoke[])[i];
        if (d && !wheelController.active) hover.value = d;
      });
      dot.el.addEventListener("pointerleave", () => {
        const d = (data.value as Spoke[])[i];
        if (d && !wheelController.active && hover.value === d) hover.value = null;
      });
      dot.el.addEventListener("click", () => {
        const d = (data.value as Spoke[])[i];
        if (!d) return;
        selected.value = selected.value === d ? null : d;
      });
    }

    // Drag: pointermove on host, find nearest spoke by angle, map radius → value.
    const svgEl = (this as any).svg as SVGSVGElement;
    const localPt = (e: PointerEvent) => {
      const r = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox?.baseVal;
      const sx = vb && vb.width ? vb.width / r.width : 1;
      const sy = vb && vb.height ? vb.height / r.height : 1;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    };
    const findNearestSpoke = (px: number, py: number): Spoke | null => {
      const rows = data.value as Spoke[];
      const dx = px - CX;
      const dy = py - CY;
      const ptAngle = Math.atan2(dy, dx); // -π to π
      let best: Spoke | null = null;
      let bestDiff = Infinity;
      for (let i = 0; i < rows.length; i++) {
        const a = angle(i);
        let diff = Math.abs(((ptAngle - a) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
        if (diff < bestDiff) { bestDiff = diff; best = rows[i]!; }
      }
      return bestDiff < Math.PI / rows.length ? best : null;
    };
    // Move handler the SHARED drag controller invokes while a drag is live.
    let dragPointerId = -1;
    const onDragMove = (pe: PointerEvent) => {
      const t = dragController.target as Spoke | null;
      if (!t) return;
      const { x, y } = localPt(pe);
      const dist = Math.sqrt((x - CX) ** 2 + (y - CY) ** 2);
      const newVal = Math.max(0, Math.min(100, yScale.value.invert(dist)));
      mutateDatum(t, newVal - t.value);
    };
    // Config handed to the SHARED drag controller (app-wide singleton).
    const dragConfig = {
      snapshot: (d: Spoke) => d.value,
      restore: (d: Spoke, v: number) => mutateDatum(d, v - d.value),
      onMove: onDragMove,
      onEnd: () => {
        if (dragPointerId >= 0 && (this as any).hasPointerCapture?.(dragPointerId)) {
          (this as any).releasePointerCapture(dragPointerId);
        }
        dragPointerId = -1;
      },
    };
    this.addEventListener("pointerdown", (e) => {
      if (dragController.active || this.sortBy === 'value') return;
      const pe = e as PointerEvent;
      const { x, y } = localPt(pe);
      const spoke = hover.value ?? findNearestSpoke(x, y);
      if (!spoke) return;
      // Check if close to the dot.
      const spIdx = (data.value as Spoke[]).indexOf(spoke);
      const a = angle(spIdx);
      const r = yScale.value(spoke.value);
      const dx = x - (CX + Math.cos(a) * r);
      const dy = y - (CY + Math.sin(a) * r);
      if (Math.sqrt(dx*dx + dy*dy) > 20) return;
      dragPointerId = pe.pointerId;
      selected.value = spoke;
      (this as any).setPointerCapture(pe.pointerId);
      dragController.begin(spoke, dragConfig); // controller owns move/up/Esc from here
      pe.preventDefault();
    });

    svgEl.addEventListener("wheel", (e) => {
      const we = e as WheelEvent;
      if (!we.ctrlKey || this.sortBy === 'value') return;
      const t = wheelController.begin(hover.value ?? selected.value, wheelConfig);
      if (!t) return;
      we.preventDefault();
      mutateDatum(t, we.deltaY < 0 ? (we.shiftKey ? 5 : 1) : (we.shiftKey ? -5 : -1));
    }, { passive: false });

    this.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") {
        // Drag-Esc owned by the drag gesture. Here: clear selection if focused.
        if (selected.value != null) { selected.value = null; ke.preventDefault(); }
        return;
      }
      const rows = data.value as Spoke[];
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
      vec(W / 2, 20),
      derive(() => {
        void data.value;
        const p = selected.value ?? hover.value;
        if (!p) return "Radar — click dot · ←/→ nav · ↑/↓ edit · cmd+wheel";
        return `${p.name}  ${p.value}`;
      }),
      { size: 11, align: Anchor.Center, opacity: 0.7 },
    ));

    // Cross-tile hover/select sync bridge.
    const ORDER = data.value as Spoke[];
    const idxOf = (d: Spoke | null) => { if (d == null) return null; const i = ORDER.indexOf(d); return i < 0 ? null : String(i); };
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
