// RadarChart — spider / radar chart with editing.
// Mirrors LC's radial Chart + scaleBand for x (angle per category).
// Grid: polygon rings at radius ticks + spoke lines. Points on polygon are clickable/editable.

import { Anchor, cell, circle, derive, Diagram, effect as biEffect, label, type Mount, pathD, Vec } from "bireactive";
import { scaleLinear } from "d3-scale";
import { extent, ticks as d3Ticks } from "d3-array";
import { wheelController, dragController, dynamicWheelStep } from "../lib/interaction";
import { makeBridge, type ElementWithBridge } from "../lib/hud-bridge";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import { GESTURE_ACTIVE_CLASS, GESTURE_SUPPRESSION_CSS, settleTransition } from "../lib/transitions";

const W = 640;
const H = 640;

const COLOR = "#7aaae8";

interface Spoke {
  id?: string;
  name: string;
  value: number; // 0–100
}

function makeData(): Spoke[] {
  return ["Speed", "Power", "Agility", "Defense", "Stamina", "Technique"].map((name) => ({
    id: name,
    name,
    value: Math.round(30 + Math.random() * 60),
  }));
}

export class MdRadarChartLC extends Diagram {
  static styles = `text { pointer-events: none; }${FILL_STYLE}${GESTURE_SUPPRESSION_CSS}`
  readonly dataCell = cell<readonly Spoke[]>(makeData());
  tickCount = 4;
  set externalData(v: { label: string; value: number }[] | undefined) {
    if (v) this.dataCell.value = v as unknown as Spoke[];
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
    const rMax = derive(() => Math.min(Wc.value, Hc.value) / 2 - 50);

    const data = this.dataCell;
    const hover = cell<Spoke | null>(null);
    const selected = cell<Spoke | null>(null);

    const mutateDatum = (d: Spoke, delta: number) => {
      d.value = Math.max(0, d.value + delta);
      data.value = [...data.value];
    };

    const setGestureActive = (on: boolean) => this.classList.toggle(GESTURE_ACTIVE_CLASS, on);
    // Config handed to the SHARED wheel controller (app-wide singleton).
    const wheelConfig = {
      snapshot: (d: Spoke) => { setGestureActive(true); return d.value; },
      restore: (d: Spoke, v: number) => mutateDatum(d, v - d.value),
      onEnd: () => { setGestureActive(false); hover.value = null; this.dispatchEvent(new CustomEvent("gesturecommit")); },
    };

    // y: scaleLinear 0–100 → radius 0–R_MAX
    // Dynamic domain: extent of current data, niced to clean tick values.
    const domainMin = derive(() => {
      const rows = data.value as Spoke[];
      const [lo] = extent(rows, (d) => d.value);
      return Math.max(0, (lo ?? 0));
    });
    const domainMax = derive(() => {
      const rows = data.value as Spoke[];
      const [, hi] = extent(rows, (d) => d.value);
      return hi ?? 100;
    });
    const ticks = derive(() => {
      const lo = domainMin.value, hi = domainMax.value;
      // Nice ticks in range; 0 is always included as inner ring.
      return [0, ...d3Ticks(lo, hi, this.tickCount).filter(t => t > 0)];
    });
    const yScale = derive(() =>
      scaleLinear().domain([0, domainMax.value]).range([0, rMax.value])
    );

    // Angle for spoke i: evenly distributed by index so duplicate names never collapse spokes.
    const angle = (i: number): number => {
      const n = (data.value as Spoke[]).length;
      return (2 * Math.PI / n) * i - Math.PI / 2;
    };

    // Reactive grid rings — pool of MAX_RINGS slots driven by ticks.value.
    const MAX_GRID_RINGS = 8;
    for (let ri = 0; ri < MAX_GRID_RINGS; ri++) {
      const ringD = derive(() => {
        const ts = ticks.value;
        if (ri >= ts.length) return "";
        const tick = ts[ri]!;
        if (tick === 0) return "";
        const r = yScale.value(tick);
        const rows = data.value as Spoke[];
        const cxv = cx.value, cyv = cy.value;
        const pts = rows.map((_, i) => {
          const a = angle(i);
          return `${i === 0 ? "M" : "L"}${(cxv + Math.cos(a) * r).toFixed(1)},${(cyv + Math.sin(a) * r).toFixed(1)}`;
        });
        return pts.join(" ") + " Z";
      });
      s(pathD(ringD, { stroke: "#ffffff", opacity: 0.1, strokeWidth: 1 }));
      // Tick label at top spoke for each ring.
      const tickLblPos = Vec.derive(() => {
        const ts = ticks.value;
        if (ri >= ts.length || ts[ri] === 0) return { x: -1000, y: -1000 };
        const r = yScale.value(ts[ri]!);
        // Place label above the ring at the 12-o'clock position.
        return { x: cx.value, y: cy.value - r - 4 };
      });
      const tickLblText = derive(() => {
        const ts = ticks.value;
        return ri < ts.length && ts[ri] !== 0 ? String(ts[ri]) : "";
      });
      s(label(tickLblPos, tickLblText, { size: 9, align: Anchor.Center, fill: "#888" }));
    }

    // Spoke lines + labels — rendered as derived paths so they react to count changes.
    // One <path> element per spoke slot up to MAX_SPOKES; hidden when slot is out of range.
    const MAX_SPOKES = 20;
    const spokeD = derive(() => {
      const rows = data.value as Spoke[];
      const cxv = cx.value, cyv = cy.value, rMaxv = rMax.value;
      const pts: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const a = angle(i);
        const tx = (cxv + Math.cos(a) * rMaxv).toFixed(1);
        const ty = (cyv + Math.sin(a) * rMaxv).toFixed(1);
        pts.push(`M${cxv},${cyv}L${tx},${ty}`);
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
        const r = rMax.value + 22;
        return { x: cx.value + Math.cos(a) * r, y: cy.value + Math.sin(a) * r };
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
      const cxv = cx.value, cyv = cy.value;
      const pts = rows.map((d, i) => {
        const a = angle(i);
        const r = ys(d.value);
        const x = (cxv + Math.cos(a) * r).toFixed(1);
        const y = (cyv + Math.sin(a) * r).toFixed(1);
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      });
      return pts.join(" ") + " Z";
    });

    // Settle path `d` on value change. Radar polygons are rendered as M/L path
    // commands (not <polyline points>), so Chrome/Safari interpolate; Firefox
    // steps. See docs/transitions-decision.md for the polyline caveat.
    const polyFill = s(pathD(polyD, { fill: COLOR, stroke: "none", opacity: 0.18 }));
    const polyStroke = s(pathD(polyD, { fill: "none", stroke: COLOR, strokeWidth: 2, opacity: 0.85 }));
    polyFill.el.style.transition = settleTransition("d");
    polyStroke.el.style.transition = settleTransition("d");

    // Data points — one slot per MAX_SPOKES; each reads data.value[i] reactively.
    for (let i = 0; i < MAX_SPOKES; i++) {
      const dotPos = Vec.derive(() => {
        const rows = data.value as Spoke[];
        if (i >= rows.length) return { x: -1000, y: -1000 }; // hide off-screen
        const a = angle(i);
        const r = yScale.value(rows[i]!.value);
        return { x: cx.value + Math.cos(a) * r, y: cy.value + Math.sin(a) * r };
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
      const dx = px - cx.peek();
      const dy = py - cy.peek();
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
      const dist = Math.sqrt((x - cx.peek()) ** 2 + (y - cy.peek()) ** 2);
      const newVal = Math.max(0, Math.min(100, yScale.value.invert(dist)));
      mutateDatum(t, newVal - t.value);
    };
    // Config handed to the SHARED drag controller (app-wide singleton).
    const dragConfig = {
      snapshot: (d: Spoke) => { setGestureActive(true); return d.value; },
      restore: (d: Spoke, v: number) => mutateDatum(d, v - d.value),
      onMove: onDragMove,
      onEnd: () => {
        if (dragPointerId >= 0 && (this as any).hasPointerCapture?.(dragPointerId)) {
          (this as any).releasePointerCapture(dragPointerId);
        }
        dragPointerId = -1;
        (this as any).gestureActive = false;
        setGestureActive(false);
        this.dispatchEvent(new CustomEvent("gesturecommit"));
      },
    };
    this.addEventListener("pointerdown", (e) => {
      if (dragController.active) return;
      const pe = e as PointerEvent;
      const { x, y } = localPt(pe);
      const spoke = hover.value ?? findNearestSpoke(x, y);
      if (!spoke) return;
      // Check if close to the dot.
      const spIdx = (data.value as Spoke[]).indexOf(spoke);
      const a = angle(spIdx);
      const r = yScale.value(spoke.value);
      const dx = x - (cx.peek() + Math.cos(a) * r);
      const dy = y - (cy.peek() + Math.sin(a) * r);
      if (Math.sqrt(dx*dx + dy*dy) > 20) return;
      dragPointerId = pe.pointerId;
      (this as any).gestureActive = true;
      selected.value = spoke;
      (this as any).setPointerCapture(pe.pointerId);
      dragController.begin(spoke, dragConfig); // controller owns move/up/Esc from here
      pe.preventDefault();
    });

    svgEl.addEventListener("wheel", (e) => {
      const we = e as WheelEvent;
      if (!we.ctrlKey) return;
      const t = wheelController.begin(hover.value ?? selected.value, wheelConfig);
      if (!t) return;
      we.preventDefault();
      const s = dynamicWheelStep(t.value, we.shiftKey);
      mutateDatum(t, we.deltaY < 0 ? +s : -s);
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
      const step = dynamicWheelStep(cur.value, ke.shiftKey);
      if (ke.key === "ArrowUp") { mutateDatum(cur, +step); ke.preventDefault(); }
      else if (ke.key === "ArrowDown") { mutateDatum(cur, -step); ke.preventDefault(); }
    });

    s(label(
      Vec.derive(() => ({ x: Wc.value / 2, y: 20 })),
      derive(() => {
        void data.value;
        const p = selected.value ?? hover.value;
        if (!p) return "Radar — click dot · ←/→ nav · ↑/↓ edit · cmd+wheel";
        return `${p.name}  ${p.value}`;
      }),
      { size: 11, align: Anchor.Center, opacity: 0.7 },
    ));

    // Cross-tile hover/select sync bridge.
    const idOf = (d: Spoke | null) => d?.id ?? null;
    const datumAt = (id: string | null) => id == null ? null : (data.value as Spoke[]).find(d => d.id === id) ?? null;
    let applyingExternal = false;
    const bridge = makeBridge({
      setHover: (key) => { applyingExternal = true; hover.value = datumAt(key); applyingExternal = false; },
      setSelect: (key) => { applyingExternal = true; selected.value = datumAt(key); applyingExternal = false; },
    });
    (this as unknown as ElementWithBridge).brSync = bridge;
    biEffect(() => { const h = hover.value; if (applyingExternal) return; bridge.emitHover(idOf(h)); });
    biEffect(() => { const sel = selected.value; if (applyingExternal) return; bridge.emitSelect(idOf(sel)); });
  }
}
