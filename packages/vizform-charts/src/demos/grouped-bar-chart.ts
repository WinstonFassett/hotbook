// GroupedBarChart — grouped (side-by-side) and stacked bar modes.
//
// Builds on bar-chart.ts (flat Bar[]) but takes a multi-series shape:
//
//   interface GroupedBar { id?; label; series: { name; value }[] }
//
// Each top-level row is a category; each series entry is one segment.
// Mode 'grouped' lays segments side-by-side within the category band using
// d3-scale's inner scaleBand; 'stacked' draws cumulative rectangles.
// Both modes work in vertical and horizontal orientations, matching the
// orientation conventions in MdBarChartLC.
//
// Gestures: hover/select per segment, drag/wheel to edit individual segment
// values. Follows the same cartesian interaction model as MdBarChartLC.

import { Anchor, cell, circle, derive, Diagram, label, line, type Mount, rect, Vec } from "bireactive";
import { scaleBand, scaleLinear } from "d3-scale";
import { useHostSize, FILL_STYLE, type HostSize } from "../lib/host-size";
import { wheelController, dragController, dynamicWheelStep } from "../lib/interaction";
import {
  GESTURE_ACTIVE_CLASS,
  GESTURE_SUPPRESSION_CSS,
  hoverTransition,
  settleTransition,
} from "../lib/transitions";

const W = 720;
const H = 360;
const PALETTE = ['#7aaae8', '#e08888', '#7ec87e', '#d4a86c', '#b090e0', '#60c4c0', '#ccc060', '#8899b4'];

export interface GroupedBarSeriesPoint { name: string; value: number }
export interface GroupedBar { id?: string; label: string; series: GroupedBarSeriesPoint[] }

function makeData(): GroupedBar[] {
  const labels = ["Q1", "Q2", "Q3", "Q4"];
  const seriesNames = ["North", "South", "East", "West"];
  return labels.map(l => ({
    id: l,
    label: l,
    series: seriesNames.map(n => ({ name: n, value: Math.round(10 + Math.random() * 60) })),
  }));
}

function uniqueSeriesNames(rows: readonly GroupedBar[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) for (const s of r.series) if (!seen.has(s.name)) { seen.add(s.name); out.push(s.name); }
  return out;
}

function rowTotal(r: GroupedBar): number {
  let t = 0; for (const s of r.series) t += s.value; return t;
}

// Segment identity for hover/select/edit gestures.
interface SegmentRef {
  rowId: string;
  seriesName: string;
}

function segmentEq(a: SegmentRef | null, b: SegmentRef | null): boolean {
  if (!a || !b) return a === b;
  return a.rowId === b.rowId && a.seriesName === b.seriesName;
}

export class MdGroupedBarChartLC extends Diagram {
  static styles = `text { pointer-events: none; }${FILL_STYLE}${GESTURE_SUPPRESSION_CSS}`;

  readonly dataCell = cell<readonly GroupedBar[]>(makeData());

  mode: 'grouped' | 'stacked' = 'grouped';
  orientation: 'vertical' | 'horizontal' = 'vertical';

  set externalData(v: GroupedBar[] | undefined) { if (v) this.dataCell.value = v; }
  get externalData(): GroupedBar[] | undefined { return this.dataCell.value as GroupedBar[]; }

  protected scene(s: Mount): void {
    const size = useHostSize(this, { width: W, height: H });
    this.tabIndex = 0;
    this.style.outline = "none";
    if (this.orientation === 'horizontal') {
      this.#horizontal(s, size);
    } else {
      this.#vertical(s, size);
    }
  }

  #vertical(s: Mount, { w: Wc, h: Hc }: HostSize) {
    const PAD = { top: 28, right: 16, bottom: 36, left: 48 };
    const plotX = PAD.left, plotY = PAD.top;
    const rows = this.dataCell.value;
    const names = uniqueSeriesNames(rows);
    const stacked = this.mode === 'stacked';

    this.view(Wc, Hc);

    const plotW = derive(() => Wc.value - PAD.left - PAD.right);
    const plotH = derive(() => Hc.value - PAD.top - PAD.bottom);

    const xBand = derive(() =>
      scaleBand<string>()
        .domain(rows.map((_, i) => String(i)))
        .range([plotX, plotX + plotW.value])
        .padding(0.2)
    );
    const xInner = derive(() =>
      scaleBand<string>()
        .domain(names)
        .range([0, xBand.value.bandwidth()])
        .padding(0.05)
    );

    const yMax = stacked
      ? Math.max(1, ...rows.map(rowTotal))
      : Math.max(1, ...rows.flatMap(r => r.series.map(p => p.value)));
    const yScale = derive(() =>
      scaleLinear().domain([0, yMax]).range([plotY + plotH.value, plotY]).nice()
    );

    // Y axis baseline.
    const ay1 = derive(() => plotY + plotH.value);
    s(line(
      Vec.derive(() => ({ x: plotX, y: ay1.value })),
      Vec.derive(() => ({ x: plotX + plotW.value, y: ay1.value })),
      { thin: true, opacity: 0.5, stroke: "#888" },
    ));

    // Y axis ticks (4 evenly-spaced).
    const TICKS = 4;
    for (let t = 0; t <= TICKS; t++) {
      const v = (yMax * t) / TICKS;
      const ty = derive(() => yScale.value(v));
      s(line(
        Vec.derive(() => ({ x: plotX - 4, y: ty.value })),
        Vec.derive(() => ({ x: plotX, y: ty.value })),
        { thin: true, opacity: 0.4, stroke: "#888" },
      ));
      s(label(Vec.derive(() => ({ x: plotX - 8, y: ty.value + 3 })),
        `${Math.round(v)}`, { size: 10, align: Anchor.Right, fill: "#888", opacity: 0.8 }));
    }

    // Category labels.
    for (let i = 0; i < rows.length; i++) {
      const key = String(i);
      const tx = derive(() => (xBand.value(key) ?? 0) + xBand.value.bandwidth() / 2);
      s(label(Vec.derive(() => ({ x: tx.value, y: ay1.value + 16 })), rows[i]!.label,
        { size: 10, align: Anchor.Center, fill: "#888", opacity: 0.85 }));
    }

    // Set up gesture state BEFORE rendering bars so they can read hover/selected.
    const { hover, selected } = this.#gesturesVertical(s, rows, names, xBand, yScale, plotX, plotY, plotW, plotH, Wc);

    // Bars with hover/select feedback and drag handles.
    // CRITICAL: Read segments LIVE from dataCell to survive value changes.
    const NUM_ROWS = rows.length;
    for (let rowIdx = 0; rowIdx < NUM_ROWS; rowIdx++) {
      const rowId = rows[rowIdx]!.id ?? rows[rowIdx]!.label;
      const bandX = derive(() => xBand.value(String(rowIdx)) ?? 0);

      if (stacked) {
        // Stacked: render each series as a layer in the stack.
        const NUM_SERIES = rows[rowIdx]!.series.length;
        for (let seriesIdx = 0; seriesIdx < NUM_SERIES; seriesIdx++) {
          const seriesName = rows[rowIdx]!.series[seriesIdx]!.name;
          const seriesListIdx = names.indexOf(seriesName);
          const baseFill = PALETTE[seriesListIdx % PALETTE.length]!;
          const hoverFill = this.#lighten(baseFill, 0.25);

          // Read segment value LIVE.
          const segRef: SegmentRef = { rowId, seriesName };
          const getRow = () => (this.dataCell.value as GroupedBar[])[rowIdx];
          const getSeg = () => getRow()?.series[seriesIdx];

          // Compute stack position (accumulate all segments below this one).
          const segStart = derive(() => {
            const r = getRow();
            if (!r) return 0;
            let acc = 0;
            for (let i = 0; i < seriesIdx; i++) acc += r.series[i]?.value ?? 0;
            return acc;
          });
          const segEnd = derive(() => segStart.value + (getSeg()?.value ?? 0));

          const y0 = derive(() => yScale.value(segEnd.value));
          const y1 = derive(() => yScale.value(segStart.value));
          const h = derive(() => Math.max(0, y1.value - y0.value));
          const fill = derive(() => {
            const sel = selected.value;
            const hov = hover.value;
            if (sel && segmentEq(sel, segRef)) return "#fff";
            if (hov && segmentEq(hov, segRef)) return hoverFill;
            return baseFill;
          });

          const segRect = s(rect(bandX, y0, derive(() => xBand.value.bandwidth()), h, { fill, corner: 1 }));
          segRect.el.style.cursor = "pointer";
          segRect.el.style.transition = settleTransition(["y", "height", "fill"]);

          // Drag handle at segment top.
          const handleX = derive(() => bandX.value + xBand.value.bandwidth() / 2);
          const handleOpacity = derive(() => {
            const sel = selected.value;
            const hov = hover.value;
            return (sel && segmentEq(sel, segRef)) || (hov && segmentEq(hov, segRef)) ? 1 : 0;
          });
          const handleRadius = derive(() => selected.value && segmentEq(selected.value, segRef) ? 6 : 5);
          const handleFill = derive(() => selected.value && segmentEq(selected.value, segRef) ? "#fff" : hoverFill);
          const handle = s(circle(Vec.derive(() => ({ x: handleX.value, y: y0.value })), handleRadius, {
            fill: handleFill,
            stroke: "#0b0d12", strokeWidth: 1.5, opacity: handleOpacity,
          }));
          handle.el.style.cursor = "ns-resize";
          handle.el.style.transition = hoverTransition("opacity");
        }
      } else {
        // Grouped: render each series as a separate bar.
        const NUM_SERIES = rows[rowIdx]!.series.length;
        for (let seriesIdx = 0; seriesIdx < NUM_SERIES; seriesIdx++) {
          const seriesName = rows[rowIdx]!.series[seriesIdx]!.name;
          const seriesListIdx = names.indexOf(seriesName);
          const baseFill = PALETTE[seriesListIdx % PALETTE.length]!;
          const hoverFill = this.#lighten(baseFill, 0.25);

          // Read segment value LIVE.
          const segRef: SegmentRef = { rowId, seriesName };
          const getRow = () => (this.dataCell.value as GroupedBar[])[rowIdx];
          const getSeg = () => getRow()?.series[seriesIdx];

          const segX = derive(() => bandX.value + (xInner.value(seriesName) ?? 0));
          const segW = derive(() => xInner.value.bandwidth());
          const segY = derive(() => yScale.value(getSeg()?.value ?? 0));
          const segH = derive(() => Math.max(0, (plotY + plotH.value) - segY.value));
          const fill = derive(() => {
            const sel = selected.value;
            const hov = hover.value;
            if (sel && segmentEq(sel, segRef)) return "#fff";
            if (hov && segmentEq(hov, segRef)) return hoverFill;
            return baseFill;
          });

          const segRect = s(rect(segX, segY, segW, segH, { fill, corner: 1 }));
          segRect.el.style.cursor = "pointer";
          segRect.el.style.transition = settleTransition(["y", "height", "fill"]);

          // Drag handle at segment top.
          const handleX = derive(() => segX.value + segW.value / 2);
          const handleOpacity = derive(() => {
            const sel = selected.value;
            const hov = hover.value;
            return (sel && segmentEq(sel, segRef)) || (hov && segmentEq(hov, segRef)) ? 1 : 0;
          });
          const handleRadius = derive(() => selected.value && segmentEq(selected.value, segRef) ? 6 : 5);
          const handleFill = derive(() => selected.value && segmentEq(selected.value, segRef) ? "#fff" : hoverFill);
          const handle = s(circle(Vec.derive(() => ({ x: handleX.value, y: segY.value })), handleRadius, {
            fill: handleFill,
            stroke: "#0b0d12", strokeWidth: 1.5, opacity: handleOpacity,
          }));
          handle.el.style.cursor = "ns-resize";
          handle.el.style.transition = hoverTransition("opacity");
        }
      }
    }

    this.#legend(s, names, Wc, plotY);
    this.#title(s, Wc);
  }

  #horizontal(s: Mount, { w: Wc, h: Hc }: HostSize) {
    const PAD = { top: 28, right: 24, bottom: 28, left: 72 };
    const plotX = PAD.left, plotY = PAD.top;
    const rows = this.dataCell.value;
    const names = uniqueSeriesNames(rows);
    const stacked = this.mode === 'stacked';

    this.view(Wc, Hc);

    const plotW = derive(() => Wc.value - PAD.left - PAD.right);
    const plotH = derive(() => Hc.value - PAD.top - PAD.bottom);

    const yBand = derive(() =>
      scaleBand<string>()
        .domain(rows.map((_, i) => String(i)))
        .range([plotY, plotY + plotH.value])
        .padding(0.2)
    );
    const yInner = derive(() =>
      scaleBand<string>()
        .domain(names)
        .range([0, yBand.value.bandwidth()])
        .padding(0.05)
    );

    const xMax = stacked
      ? Math.max(1, ...rows.map(rowTotal))
      : Math.max(1, ...rows.flatMap(r => r.series.map(p => p.value)));
    const xScale = derive(() =>
      scaleLinear().domain([0, xMax]).range([plotX, plotX + plotW.value]).nice()
    );

    // X axis baseline (top of plot doubles as numeric axis line).
    s(line(
      Vec.derive(() => ({ x: plotX, y: plotY })),
      Vec.derive(() => ({ x: plotX + plotW.value, y: plotY })),
      { thin: true, opacity: 0.5, stroke: "#888" },
    ));
    const TICKS = 4;
    for (let t = 0; t <= TICKS; t++) {
      const v = (xMax * t) / TICKS;
      const tx = derive(() => xScale.value(v));
      s(line(
        Vec.derive(() => ({ x: tx.value, y: plotY - 4 })),
        Vec.derive(() => ({ x: tx.value, y: plotY })),
        { thin: true, opacity: 0.4, stroke: "#888" },
      ));
      s(label(Vec.derive(() => ({ x: tx.value, y: plotY - 8 })),
        `${Math.round(v)}`, { size: 10, align: Anchor.Center, fill: "#888", opacity: 0.8 }));
    }

    // Category labels on left.
    for (let i = 0; i < rows.length; i++) {
      const key = String(i);
      const cy = derive(() => (yBand.value(key) ?? 0) + yBand.value.bandwidth() / 2);
      s(label(Vec.derive(() => ({ x: plotX - 6, y: cy.value + 3 })), rows[i]!.label,
        { size: 11, align: Anchor.Right, fill: "#888", opacity: 0.85 }));
    }

    // Bars.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const bandY = derive(() => yBand.value(String(i)) ?? 0);

      if (stacked) {
        let acc = 0;
        for (let k = 0; k < row.series.length; k++) {
          const seg = row.series[k]!;
          const segStart = acc;
          const segEnd = acc + seg.value;
          acc = segEnd;
          const x0 = derive(() => xScale.value(segStart));
          const x1 = derive(() => xScale.value(segEnd));
          const w = derive(() => Math.max(0, x1.value - x0.value));
          const seriesIdx = names.indexOf(seg.name);
          const fill = PALETTE[seriesIdx % PALETTE.length]!;
          s(rect(x0, bandY, w, derive(() => yBand.value.bandwidth()), { fill, corner: 1 }));
        }
      } else {
        for (let k = 0; k < row.series.length; k++) {
          const seg = row.series[k]!;
          const segKey = seg.name;
          const segY = derive(() => bandY.value + (yInner.value(segKey) ?? 0));
          const segH = derive(() => yInner.value.bandwidth());
          const segW = derive(() => Math.max(0, xScale.value(seg.value) - plotX));
          const seriesIdx = names.indexOf(seg.name);
          const fill = PALETTE[seriesIdx % PALETTE.length]!;
          s(rect(plotX, segY, segW, segH, { fill, corner: 1 }));
        }
      }
    }

    this.#legend(s, names, Wc, 6);
    this.#title(s, Wc);
    // TODO: Add horizontal gestures (same pattern as vertical, different hit test)
  }

  #legend(s: Mount, names: string[], Wc: ReturnType<typeof cell<number>>, top: number) {
    const SWATCH = 10;
    const GAP = 6;
    const ITEM_GAP = 14;
    const widths = names.map(n => n.length * 6 + SWATCH + GAP);
    const total = widths.reduce((a, b) => a + b + ITEM_GAP, 0) - ITEM_GAP;
    let cursor = 0;
    for (let i = 0; i < names.length; i++) {
      const xOffset = cursor;
      const fill = PALETTE[i % PALETTE.length]!;
      const sx = derive(() => (Wc.value - total) / 2 + xOffset);
      s(rect(sx, derive(() => top - 1), cell(SWATCH), cell(SWATCH), { fill, corner: 1 }));
      s(label(Vec.derive(() => ({ x: sx.value + SWATCH + GAP, y: top + 8 })), names[i]!,
        { size: 10, align: Anchor.Left, fill: "#bbb" }));
      cursor += widths[i]! + ITEM_GAP;
    }
  }

  #lighten(hex: string, amount: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const m = (c: number) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0');
    return `#${m(r)}${m(g)}${m(b)}`;
  }

  #title(s: Mount, Wc: ReturnType<typeof cell<number>>) {
    const t = `${this.mode === 'stacked' ? 'Stacked' : 'Grouped'} bars — ${this.orientation}`;
    s(label(Vec.derive(() => ({ x: Wc.value / 2, y: 14 })), t,
      { size: 11, align: Anchor.Center, opacity: 0.6 }));
  }

  #gesturesVertical(
    s: Mount,
    rows: readonly GroupedBar[],
    names: string[],
    xBand: ReturnType<typeof derive<any>>,
    yScale: ReturnType<typeof derive<any>>,
    plotX: number,
    plotY: number,
    plotW: ReturnType<typeof derive<number>>,
    plotH: ReturnType<typeof derive<number>>,
    Wc: ReturnType<typeof cell<number>>,
  ) {
    const hover = cell<SegmentRef | null>(null);
    const selected = cell<SegmentRef | null>(null);
    const svgEl = (this as any).svg as SVGSVGElement;
    const stacked = this.mode === 'stacked';

    const localPoint = (e: PointerEvent) => {
      const r = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox?.baseVal;
      const sx = vb && vb.width ? vb.width / r.width : 1;
      const sy = vb && vb.height ? vb.height / r.height : 1;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    };

    // Hit test: find which segment contains (px, py).
    const findSegmentAt = (px: number, py: number): SegmentRef | null => {
      const data = this.dataCell.value as GroupedBar[];
      const xs = xBand.value;
      const ys = yScale.value;
      const step = xs.step();

      for (let i = 0; i < data.length; i++) {
        const row = data[i]!;
        const bx = xs(String(i)) ?? -1;
        if (px < bx || px >= bx + step) continue;

        if (stacked) {
          let acc = 0;
          for (const seg of row.series) {
            const segStart = acc;
            const segEnd = acc + seg.value;
            acc = segEnd;
            const y0 = ys(segEnd);
            const y1 = ys(segStart);
            if (py >= y0 && py <= y1) {
              return { rowId: row.id ?? row.label, seriesName: seg.name };
            }
          }
        } else {
          // grouped: check each bar within the band
          const innerBand = scaleBand<string>()
            .domain(names)
            .range([0, xs.bandwidth()])
            .padding(0.05);
          for (const seg of row.series) {
            const segX = bx + (innerBand(seg.name) ?? 0);
            const segW = innerBand.bandwidth();
            if (px < segX || px >= segX + segW) continue;
            const segY = ys(seg.value);
            const segH = (plotY + plotH.value) - segY;
            if (py >= segY && py <= segY + segH) {
              return { rowId: row.id ?? row.label, seriesName: seg.name };
            }
          }
        }
      }
      return null;
    };

    // Mutate a segment value.
    const mutateSegment = (ref: SegmentRef, delta: number) => {
      const data = [...this.dataCell.value] as GroupedBar[];
      const row = data.find(r => (r.id ?? r.label) === ref.rowId);
      if (!row) return;
      const seg = row.series.find(s => s.name === ref.seriesName);
      if (!seg) return;
      seg.value = Math.max(0, seg.value + delta);
      this.dataCell.value = data;
    };

    const setGestureActive = (on: boolean) => this.classList.toggle(GESTURE_ACTIVE_CLASS, on);

    const wheelConfig = {
      snapshot: (ref: SegmentRef) => {
        setGestureActive(true);
        const row = (this.dataCell.value as GroupedBar[]).find(r => (r.id ?? r.label) === ref.rowId);
        const seg = row?.series.find(s => s.name === ref.seriesName);
        return seg?.value ?? 0;
      },
      restore: (ref: SegmentRef, v: number) => {
        const row = (this.dataCell.value as GroupedBar[]).find(r => (r.id ?? r.label) === ref.rowId);
        const seg = row?.series.find(s => s.name === ref.seriesName);
        if (seg) mutateSegment(ref, v - seg.value);
      },
      onEnd: () => {
        setGestureActive(false);
        hover.value = null;
        this.dispatchEvent(new CustomEvent("gesturecommit"));
      },
    };

    let dragPointerId = -1;
    let dragStartY = 0;
    const dragConfig = {
      snapshot: (ref: SegmentRef) => {
        setGestureActive(true);
        const row = (this.dataCell.value as GroupedBar[]).find(r => (r.id ?? r.label) === ref.rowId);
        const seg = row?.series.find(s => s.name === ref.seriesName);
        return { origValue: seg?.value ?? 0, startY: dragStartY };
      },
      restore: (ref: SegmentRef, snap: { origValue: number }) => {
        mutateSegment(ref, snap.origValue - (wheelConfig.snapshot(ref) as number));
      },
      onMove: (pe: PointerEvent) => {
        const t = dragController.target as SegmentRef | null;
        if (!t) return;
        const { y } = localPoint(pe);
        const valueDelta = yScale.value.invert(y) - yScale.value.invert(dragStartY);
        const currentValue = wheelConfig.snapshot(t) as number;
        mutateSegment(t, currentValue + valueDelta - currentValue);
      },
      onEnd: () => {
        if (dragPointerId >= 0 && (this as any).hasPointerCapture?.(dragPointerId)) {
          (this as any).releasePointerCapture(dragPointerId);
        }
        dragPointerId = -1;
        setGestureActive(false);
        this.dispatchEvent(new CustomEvent("gesturecommit"));
      },
    };

    this.addEventListener("pointerleave", () => {
      if (!wheelController.active) hover.value = null;
    });

    this.addEventListener("click", e => {
      const { x, y } = localPoint(e as PointerEvent);
      const seg = findSegmentAt(x, y);
      selected.value = segmentEq(selected.value, seg) ? null : seg;
    });

    this.addEventListener("wheel", e => {
      const we = e as WheelEvent;
      if (!we.ctrlKey) return;
      we.preventDefault();
      we.stopPropagation();
      const t = wheelController.begin(hover.value ?? selected.value, wheelConfig);
      if (!t) return;
      const currentValue = wheelConfig.snapshot(t) as number;
      const step = dynamicWheelStep(currentValue, we.shiftKey);
      mutateSegment(t, we.deltaY < 0 ? +step : -step);
    }, { passive: false });

    this.addEventListener("keydown", e => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") {
        if (selected.value != null) {
          selected.value = null;
          ke.preventDefault();
        }
        return;
      }
      // TODO: Tab navigation across segments (flatten all segments into order)
      if (!selected.value) return;
      const currentValue = wheelConfig.snapshot(selected.value) as number;
      const step = dynamicWheelStep(currentValue, ke.shiftKey);
      if (ke.key === "ArrowUp") {
        mutateSegment(selected.value, +step);
        ke.preventDefault();
      } else if (ke.key === "ArrowDown") {
        mutateSegment(selected.value, -step);
        ke.preventDefault();
      }
    });

    this.addEventListener("pointerdown", e => {
      if (dragController.active) return;
      const pe = e as PointerEvent;
      const { x, y } = localPoint(pe);
      const seg = findSegmentAt(x, y);
      if (!seg) return;
      dragPointerId = pe.pointerId;
      dragStartY = y;
      selected.value = seg;
      (this as any).setPointerCapture(pe.pointerId);
      dragController.begin(seg, dragConfig);
      pe.preventDefault();
    });

    this.addEventListener("pointermove", e => {
      if (dragController.active || wheelController.active) return;
      const { x, y } = localPoint(e as PointerEvent);
      hover.value = findSegmentAt(x, y);
    });

    return { hover, selected };
  }
}
