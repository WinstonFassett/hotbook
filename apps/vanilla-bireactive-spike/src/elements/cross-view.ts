// Original (vizform-flavored). One writable source `Num[]`; a `t ∈ [0,1]`
// cell interpolates each datum's geometry between a bands layout (t=0)
// and a radial layout (t=1). Same source, same identity per datum,
// labels track shape midpoints — testing vizform Rule 12 (visual
// cohesion through cross-view morphs) on top of bireactive.
//
// Drag any boundary in either view to write back into the source.
// Drag the slider to morph between views.

import {
  Anchor,
  Diagram,
  derive,
  drag,
  group,
  label,
  type Mount,
  Num,
  num,
  pathD,
  rect,
  Vec,
  type Writable,
} from "bireactive";

const W = 760;
const H = 380;

const COLORS = ["#5b8def", "#7ed321", "#e25c5c", "#f5a623", "#9b59b6", "#1abc9c"];
const NAMES = ["A", "B", "C", "D", "E", "F"];
const INIT = [3, 5, 2, 4, 1, 3];

function evenly<T>(arr: readonly T[], total: number): number[] {
  return arr.map(() => total / arr.length);
}

function makeSource(): { cells: Writable<Num>[]; total: Writable<Num> } {
  const cells = INIT.map(v => num(v));
  const total = Num.lens(
    cells,
    (vs: readonly number[]) => vs.reduce((a, b) => a + b, 0),
    (target, vs) => {
      const arr = vs as readonly number[];
      const cur = arr.reduce((a, b) => a + b, 0);
      if (cur === 0) return evenly(arr, target) as never;
      const scale = target / cur;
      return arr.map(v => v * scale) as never;
    },
  );
  return { cells, total };
}

// Sample N points along a path from (bandX(p), bandY) to a radial wedge
// inscribed in the band, interpolated by t. Same datum -> same path -> same
// identity element across the morph. We build the path procedurally each
// frame via a derived `d` attribute (Path opts: pathD-style).
function morphPathD(
  i: number,
  cells: readonly Writable<Num>[],
  total: Writable<Num>,
  t: Writable<Num>,
  bandRect: { x0: number; x1: number; y: number; h: number },
  pie: { cx: number; cy: number; r: number },
): Num {
  return Num.derive(() => {
    const tt = t.value;
    const tot = Math.max(total.value, 1e-9);
    const v = cells[i]!.value;
    // Band geometry (t=0)
    let bandLeft = bandRect.x0;
    for (let j = 0; j < i; j++) bandLeft += (cells[j]!.value / tot) * (bandRect.x1 - bandRect.x0);
    const bandW = (v / tot) * (bandRect.x1 - bandRect.x0);
    // Radial geometry (t=1)
    let a0 = -Math.PI / 2;
    for (let j = 0; j < i; j++) a0 += (cells[j]!.value / tot) * Math.PI * 2;
    const a1 = a0 + (v / tot) * Math.PI * 2;
    const { cx, cy, r } = pie;
    // Interpolate: sample 4 corner points along the band, lerp toward the
    // wedge's arc + spokes. We approximate the wedge with a quadrilateral
    // (apex–arc-mid–arc-mid–apex) so the bands rect maps cleanly.
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    const bandTL = { x: bandLeft, y: bandRect.y };
    const bandTR = { x: bandLeft + bandW, y: bandRect.y };
    const bandBR = { x: bandLeft + bandW, y: bandRect.y + bandRect.h };
    const bandBL = { x: bandLeft, y: bandRect.y + bandRect.h };
    const apex = { x: cx, y: cy };
    const arcMidL = { x: cx + Math.cos(a0) * r, y: cy + Math.sin(a0) * r };
    const arcMid = { x: cx + Math.cos((a0 + a1) / 2) * r, y: cy + Math.sin((a0 + a1) / 2) * r };
    const arcMidR = { x: cx + Math.cos(a1) * r, y: cy + Math.sin(a1) * r };
    // Map: TL↔apex, TR↔apex (both collapse to apex at t=1), BR↔arcMidR, BL↔arcMidL
    const p0 = { x: lerp(bandTL.x, apex.x, tt), y: lerp(bandTL.y, apex.y, tt) };
    const p1 = { x: lerp(bandTR.x, apex.x, tt), y: lerp(bandTR.y, apex.y, tt) };
    const p2 = { x: lerp(bandBR.x, arcMidR.x, tt), y: lerp(bandBR.y, arcMidR.y, tt) };
    const p3 = { x: lerp(bandBL.x, arcMidL.x, tt), y: lerp(bandBL.y, arcMidL.y, tt) };
    // Middle of the bottom edge curves toward arcMid as t grows.
    const pMid = {
      x: lerp((bandBL.x + bandBR.x) / 2, arcMid.x, tt),
      y: lerp((bandBL.y + bandBR.y) / 2, arcMid.y, tt),
    };
    return _placeholderEncode(p0, p1, p2, pMid, p3);
  }) as unknown as Num;
}

// Encode 5 points as an SVG path "d" — but `d` is a string, not Num. We
// only need this trick for the path() helper. So instead build a derived
// string by calling .toString-style. Actually pathD accepts a Val<string>;
// we'll build it inline below rather than via this helper. Kept here for
// reference; the cell-based version is unused.
function _placeholderEncode(_p0: Vec, _p1: Vec, _p2: Vec, _pMid: Vec, _p3: Vec): number {
  return 0;
}
// (Vec used only as a structural type above.)
type Pt = { x: number; y: number };

export class MdCrossView extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    const { cells, total } = makeSource();
    const t = num(0); // 0 = bands, 1 = radial

    // Layout regions
    const bandRect = { x0: 80, x1: 680, y: 90, h: 70 };
    const pie = { cx: 380, cy: 250, r: 80 };

    s(
      label(
        view.top.down(20),
        "one source · t-interpolated geometry — drag the slider to morph between bands (t=0) and radial (t=1)",
      ),
      label(
        view.bottom.up(14),
        derive(
          () => `t = ${t.value.toFixed(2)} · total ${total.value.toFixed(1)} (writable in either view)`,
        ),
        { size: 10 },
      ),
    );

    // Slider
    const sxL = 80;
    const sxR = 680;
    const sy = 350;
    s(
      rect(sxL, sy - 1, sxR - sxL, 2, { fill: "#444" }),
      label(Vec.derive(() => ({ x: sxL - 8, y: sy })), "bands", { size: 10, align: Anchor.Right, fill: "#9aa0a8" }),
      label(Vec.derive(() => ({ x: sxR + 8, y: sy })), "radial", { size: 10, align: Anchor.Left, fill: "#9aa0a8" }),
    );
    const knob = Vec.lens(
      [t] as const,
      ([tv]) => ({ x: sxL + (tv as number) * (sxR - sxL), y: sy }),
      target => {
        const tv = Math.max(0, Math.min(1, (target.x - sxL) / (sxR - sxL)));
        return [tv] as never;
      },
    );
    const knobShape = s(
      rect(
        Num.derive(() => knob.value.x - 8),
        sy - 10,
        16,
        20,
        { fill: "black", stroke: "white", thin: true, corner: 4, opacity: 0.9 },
      ),
    );
    drag(knobShape, knob);
    knobShape.el.style.cursor = "ew-resize";

    // Compute morphed quad per datum: 4 corners + midpoint that interpolate
    // between band-rect corners and wedge points.
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    const cornersOf = (i: number) => {
      // Returns Cells for the 4 corners + midpoint of datum i's morphed quad.
      const p0 = Vec.derive(() => quadOf(i, cells, total, t.value, bandRect, pie).p0);
      const p1 = Vec.derive(() => quadOf(i, cells, total, t.value, bandRect, pie).p1);
      const p2 = Vec.derive(() => quadOf(i, cells, total, t.value, bandRect, pie).p2);
      const p3 = Vec.derive(() => quadOf(i, cells, total, t.value, bandRect, pie).p3);
      const pMid = Vec.derive(() => quadOf(i, cells, total, t.value, bandRect, pie).pMid);
      return { p0, p1, p2, p3, pMid };
    };

    // Render each datum's morphed shape via path with a derived `d` string.
    for (let i = 0; i < cells.length; i++) {
      const { p0, p1, p2, p3, pMid } = cornersOf(i);
      const d = derive(() => {
        const a = p0.value, b = p1.value, c = p2.value, m = pMid.value, dd = p3.value;
        // Quadrilateral with a quadratic curve along the bottom toward pMid
        // — gives the arc curvature at t=1.
        return `M ${a.x} ${a.y} L ${b.x} ${b.y} L ${c.x} ${c.y} Q ${m.x} ${m.y} ${dd.x} ${dd.y} Z`;
      });
      s(
        pathD(d, {
          fill: COLORS[i % COLORS.length]!,
          opacity: 0.9,
          stroke: "#0b0d12",
          thin: true,
        }),
      );
      // Label at centroid of the 5 points, tracks the shape continuously.
      const centroidPt = Vec.derive(() => {
        const a = p0.value, b = p1.value, c = p2.value, m = pMid.value, dd = p3.value;
        return { x: (a.x + b.x + c.x + m.x + dd.x) / 5, y: (a.y + b.y + c.y + m.y + dd.y) / 5 };
      });
      s(
        label(
          centroidPt,
          derive(() => `${NAMES[i]!} ${cells[i]!.value.toFixed(1)}`),
          { size: 10, align: Anchor.Center, fill: "#fff" },
        ),
      );
    }

    // Bands-mode interior boundaries (write back even when t > 0, because
    // the bands layout is the canonical source-of-truth coordinate).
    const leftX = (i: number): Num =>
      Num.derive(() => {
        let acc = bandRect.x0;
        for (let j = 0; j < i; j++) acc += (cells[j]!.value / Math.max(total.value, 1e-9)) * (bandRect.x1 - bandRect.x0);
        return acc;
      });
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1]!;
      const b = cells[i]!;
      const knob2 = Vec.lens(
        [a, b, leftX(i - 1)] as const,
        ([va, vb, lI1]: readonly [number, number, number]) => {
          const sumAB = va + vb;
          const sbW = bandRect.x1 - bandRect.x0;
          return { x: lI1 + (va / sumAB) * (sumAB / total.peek()) * sbW, y: bandRect.y - 12 };
        },
        (target, [va, vb, lI1]) => {
          const sumAB = (va as number) + (vb as number);
          if (sumAB === 0) return [0, 0, undefined] as never;
          const sbW = bandRect.x1 - bandRect.x0;
          const widthAB = (sumAB / total.peek()) * sbW;
          const newAWPx = Math.max(0, Math.min(widthAB, target.x - (lI1 as number)));
          const newAValue = (newAWPx / widthAB) * sumAB;
          return [newAValue, sumAB - newAValue, undefined] as never;
        },
      );
      // Pill is only visible when we're closer to bands than to radial.
      const opacity = derive(() => Math.max(0, 1 - t.value * 1.5));
      const PW = 6;
      const PH = 14;
      const pillX = Num.derive(() => knob2.value.x - PW / 2);
      const pill = s(
        rect(pillX, bandRect.y - 18, PW, PH, {
          fill: "black",
          stroke: "white",
          thin: true,
          corner: PW / 2,
          opacity,
        }),
      );
      drag(pill, knob2);
      pill.el.style.cursor = "ew-resize";
    }
  }
}

// Shared geometry routine — derives the 5 control points for datum i.
function quadOf(
  i: number,
  cells: readonly Writable<Num>[],
  total: Writable<Num>,
  tt: number,
  bandRect: { x0: number; x1: number; y: number; h: number },
  pie: { cx: number; cy: number; r: number },
): { p0: Pt; p1: Pt; p2: Pt; p3: Pt; pMid: Pt } {
  const tot = Math.max(total.value, 1e-9);
  const v = cells[i]!.value;
  let bandLeft = bandRect.x0;
  for (let j = 0; j < i; j++) bandLeft += (cells[j]!.value / tot) * (bandRect.x1 - bandRect.x0);
  const bandW = (v / tot) * (bandRect.x1 - bandRect.x0);
  let a0 = -Math.PI / 2;
  for (let j = 0; j < i; j++) a0 += (cells[j]!.value / tot) * Math.PI * 2;
  const a1 = a0 + (v / tot) * Math.PI * 2;
  const { cx, cy, r } = pie;
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const bandTL = { x: bandLeft, y: bandRect.y };
  const bandTR = { x: bandLeft + bandW, y: bandRect.y };
  const bandBR = { x: bandLeft + bandW, y: bandRect.y + bandRect.h };
  const bandBL = { x: bandLeft, y: bandRect.y + bandRect.h };
  const apex = { x: cx, y: cy };
  const arcMidL = { x: cx + Math.cos(a0) * r, y: cy + Math.sin(a0) * r };
  const arcMid = { x: cx + Math.cos((a0 + a1) / 2) * r, y: cy + Math.sin((a0 + a1) / 2) * r };
  const arcMidR = { x: cx + Math.cos(a1) * r, y: cy + Math.sin(a1) * r };
  return {
    p0: { x: lerp(bandTL.x, apex.x, tt), y: lerp(bandTL.y, apex.y, tt) },
    p1: { x: lerp(bandTR.x, apex.x, tt), y: lerp(bandTR.y, apex.y, tt) },
    p2: { x: lerp(bandBR.x, arcMidR.x, tt), y: lerp(bandBR.y, arcMidR.y, tt) },
    p3: { x: lerp(bandBL.x, arcMidL.x, tt), y: lerp(bandBL.y, arcMidL.y, tt) },
    pMid: {
      x: lerp((bandBL.x + bandBR.x) / 2, arcMid.x, tt),
      y: lerp((bandBL.y + bandBR.y) / 2, arcMid.y, tt),
    },
  };
}
