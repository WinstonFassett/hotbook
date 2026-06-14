// PieChart — vanilla-TS port of LayerChart's PieChart wrapper.
// Interaction: click to select, ↑/↓ edit value, cmd+wheel edit, Tab/Shift+Tab nav.
// Drag not applicable (no y-pixel continuum); wheel edits selected/hovered slice.

import { Anchor, annularSector, cell, derive, Diagram, label, type Mount, Vec, vec } from "bireactive";
import { pie, type PieArcDatum } from "d3-shape";
import { installGestureRelease } from "../lib/interaction";

const W = 720;
const H = 360;
const CX = W / 2;
const CY = H / 2;
const R_OUTER = 140;
const R_INNER = 0; // set > 0 for donut

const PALETTE = ["#5b8def", "#e05c5c", "#f0a742", "#4cba6e", "#b76de0", "#44c4c4", "#e07db7", "#9acd52"];

interface Slice {
  label: string;
  value: number;
}

function makeData(): Slice[] {
  return ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"].map((l, i) => ({
    label: l,
    value: Math.round(10 + Math.random() * 90),
  }));
}

export class MdPieChartLC extends Diagram {
  externalData?: { label: string; value: number }[]
  protected scene(s: Mount): void {
    this.view(W, H);
    this.tabIndex = 0;
    this.style.outline = "none";

    const data = cell<readonly Slice[]>((this.externalData as Slice[]) ?? makeData());

    const hover = cell<Slice | null>(null);
    const selected = cell<Slice | null>(null);

    const mutateDatum = (d: Slice, delta: number) => {
      d.value = Math.max(1, d.value + delta);
      data.value = [...data.value];
    };

    const wheelLocked = { current: null as Slice | null };
    installGestureRelease(() => { wheelLocked.current = null; hover.value = null; });

    // Pie layout (reactive).
    const arcs = derive(() => {
      const layout = pie<Slice>().value((d) => d.value).sort(null);
      return layout(data.value as Slice[]);
    });

    const center = Vec.derive(() => ({ x: CX, y: CY }));

    // Draw slices.
    for (let i = 0; i < (data.value as Slice[]).length; i++) {
      const d = (data.value as Slice[])[i]!;
      const color = PALETTE[i % PALETTE.length]!;

      const arcDatum = derive(() => arcs.value[i]);
      const a0 = derive(() => arcDatum.value?.startAngle ?? 0);
      const a1 = derive(() => arcDatum.value?.endAngle ?? 0);
      const rOuter = derive(() =>
        selected.value === d ? R_OUTER + 8 : hover.value === d ? R_OUTER + 4 : R_OUTER
      );
      const opacity = derive(() => selected.value && selected.value !== d ? 0.5 : 1);

      const sector = s(annularSector(center, rOuter, R_INNER, a0, a1, {
        fill: color,
        stroke: "#0b0d12",
        strokeWidth: 1,
        opacity,
      }));
      sector.el.style.cursor = "pointer";
      sector.el.addEventListener("pointerenter", () => { if (!wheelLocked.current) hover.value = d; });
      sector.el.addEventListener("pointerleave", () => { if (!wheelLocked.current && hover.value === d) hover.value = null; });
      sector.el.addEventListener("click", () => { selected.value = selected.value === d ? null : d; });

      // Slice label at midpoint angle.
      const labelPos = Vec.derive(() => {
        const arc = arcDatum.value;
        if (!arc) return { x: -100, y: -100 };
        const mid = (arc.startAngle + arc.endAngle) / 2;
        const r = R_OUTER * 0.65;
        return { x: CX + Math.sin(mid) * r, y: CY - Math.cos(mid) * r };
      });
      const sliceLabel = derive(() => {
        const arc = arcDatum.value;
        if (!arc || (arc.endAngle - arc.startAngle) < 0.25) return "";
        const total = (data.value as Slice[]).reduce((a, b) => a + b.value, 0);
        return `${d.label}\n${((d.value / total) * 100).toFixed(0)}%`;
      });
      s(label(labelPos, sliceLabel, { size: 11, align: Anchor.Center, fill: "#fff" }));
    }

    // Gestures.
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
      if (ke.key === "Escape") { selected.value = null; ke.preventDefault(); return; }
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
      vec(W / 2, 14),
      derive(() => {
        const p = selected.value ?? hover.value;
        if (!p) return "PieChart — click · ←/→ navigate · ↑/↓ edit · cmd+wheel";
        const total = (data.value as Slice[]).reduce((a, b) => a + b.value, 0);
        return `${p.label}  ${p.value}  (${((p.value / total) * 100).toFixed(1)}%)`;
      }),
      { size: 11, align: Anchor.Center, opacity: 0.7 },
    ));
  }
}
