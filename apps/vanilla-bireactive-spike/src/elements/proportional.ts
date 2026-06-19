// Original (vizform-flavored). Three simultaneous, all-writable views of
// one source `Num[]`: vertical bars, horizontal stacked bar, pie wedges.
// Drag any boundary in any view; the others stay in sync. Total is
// conserved by construction via a sum-redistribute lens (cf. budget-tree).
//
// Keyboard: focus a bar/slice and use ArrowUp/Down (±1), Shift+Arrow (±5),
// or Alt+wheel to scrub the value. Conservation lens keeps the total fixed
// across all three views.

import {
  Anchor,
  annularSector,
  Diagram,
  derive,
  drag,
  label,
  type Mount,
  Num,
  num,
  rect,
  Vec,
  type Writable,
} from "bireactive";

const W = 760;
const H = 360;

const COLORS = ["#5b8def", "#7ed321", "#e25c5c", "#f5a623", "#9b59b6"];
const NAMES = ["Sleep", "Work", "Play", "Eat", "Other"];
const INIT = [8, 9, 3, 2, 2];
const TOTAL = INIT.reduce((a, b) => a + b, 0); // 24, hours in a day

function evenly<T>(arr: readonly T[], total: number): number[] {
  return arr.map(() => total / arr.length);
}

// Wire keyboard/wheel scrubbing on a shape element targeting a cell pair
// (this value + a neighbor that absorbs the delta to preserve sum). For
// solo nudging, pass `neighbor = undefined` and the sum is allowed to drift.
function attachNudge(
  el: SVGElement,
  cell: Writable<Num>,
  neighbor: Writable<Num> | undefined,
  step = 1,
  big = 5,
): void {
  el.setAttribute("tabindex", "0");
  el.style.outline = "none";
  const apply = (delta: number) => {
    const cur = cell.value;
    const next = Math.max(0, cur + delta);
    const realDelta = next - cur;
    cell.value = next;
    if (neighbor) {
      const n = Math.max(0, neighbor.value - realDelta);
      neighbor.value = n;
    }
  };
  el.addEventListener("keydown", (e: KeyboardEvent) => {
    const k = e.shiftKey ? big : step;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      apply(+k); e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      apply(-k); e.preventDefault();
    }
  });
  el.addEventListener("wheel", (e: WheelEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? +1 : -1;
    apply(dir * (e.shiftKey ? big : step));
  }, { passive: false });
  el.addEventListener("focus", () => {
    el.style.filter = "brightness(1.15) drop-shadow(0 0 4px rgba(91,141,239,0.7))";
  });
  el.addEventListener("blur", () => {
    el.style.filter = "";
  });
}

function makeSlices(): { cells: Writable<Num>[]; total: Writable<Num> } {
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

export class MdProportional extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    const { cells, total } = makeSlices();

    s(
      label(
        view.top.down(20),
        "one source · three live views — drag any boundary in any view; all stay in sync",
      ),
      label(
        view.bottom.up(14),
        derive(() => `total: ${total.value.toFixed(1)} (conserved by sum-redistribute lens)`),
        { size: 10 },
      ),
    );

    // --- View 1: vertical bars (left third) ---
    const vbX0 = 40;
    const vbY0 = 60;
    const vbY1 = 300;
    const vbW = 200;
    const vbH = vbY1 - vbY0;
    const barW = vbW / cells.length - 6;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i]!;
      const x = vbX0 + i * (barW + 6);
      const h = derive(() => (v.value / Math.max(total.value, 1e-9)) * vbH);
      const y = derive(() => vbY1 - h.value);
      const barShape = s(
        rect(x, y, barW, h, {
          fill: COLORS[i]!,
          corner: 3,
          opacity: 0.9,
        }),
      );
      // Conservation neighbor for keyboard nudge: the next bar absorbs
      // the delta (so total stays put).
      const neighbor = cells[(i + 1) % cells.length]!;
      attachNudge(barShape.el, v, neighbor);
      barShape.el.style.cursor = "ns-resize";
      s(
        label(Vec.derive(() => ({ x: x + barW / 2, y: vbY1 + 14 })), NAMES[i]!, {
          size: 10,
          align: Anchor.Center,
          fill: "#aaa",
        }),
        label(
          Vec.derive(() => ({ x: x + barW / 2, y: y.value - 6 })),
          derive(() => v.value.toFixed(1)),
          { size: 10, align: Anchor.Center, fill: "#fff", opacity: derive(() => (h.value > 14 ? 1 : 0)) },
        ),
      );
      // Top edge as a writable knob: drag y -> sets v (preserving total via
      // a write-then-renormalize through the sum lens).
      const topKnob = Vec.lens(
        [v, total] as const,
        ([vv, tt]) => ({ x: x + barW / 2, y: vbY1 - (vv / Math.max(tt, 1e-9)) * vbH }),
        (target, [, tt]) => {
          const proposed = ((vbY1 - target.y) / vbH) * tt;
          return [Math.max(0, proposed), undefined] as never;
        },
      );
      const handleH = 6;
      const handleY = derive(() => topKnob.value.y - handleH / 2);
      const handleR = s(
        rect(x, handleY, barW, handleH, { fill: "black", stroke: "white", thin: true, corner: 3, opacity: 0.85 }),
      );
      drag(handleR, topKnob);
      handleR.el.style.cursor = "ns-resize";
    }
    s(label(Vec.derive(() => ({ x: vbX0 + vbW / 2, y: vbY0 - 8 })), "vertical bars · ↑↓ to nudge, alt+wheel to scrub", { size: 11, bold: true, align: Anchor.Center }));

    // --- View 2: horizontal stacked bar (center third) ---
    const sbX0 = 280;
    const sbX1 = 480;
    const sbY = 150;
    const sbH = 36;
    const sbW = sbX1 - sbX0;
    const leftX = (i: number): Num =>
      Num.derive(() => {
        let acc = sbX0;
        for (let j = 0; j < i; j++) acc += (cells[j]!.value / Math.max(total.value, 1e-9)) * sbW;
        return acc;
      });
    for (let i = 0; i < cells.length; i++) {
      const lx = leftX(i);
      const wd = derive(() => (cells[i]!.value / Math.max(total.value, 1e-9)) * sbW);
      const seg = s(
        rect(lx, sbY, wd, sbH, { fill: COLORS[i]!, opacity: 0.9, stroke: "#0b0d12", thin: true }),
      );
      s(
        label(
          Vec.derive(() => ({ x: lx.value + wd.value / 2, y: sbY + sbH / 2 })),
          derive(() => `${NAMES[i]!} ${cells[i]!.value.toFixed(1)}`),
          { size: 10, align: Anchor.Center, fill: "#fff", opacity: derive(() => (wd.value > 40 ? 1 : 0)) },
        ),
      );
      const neighbor = cells[(i + 1) % cells.length]!;
      attachNudge(seg.el, cells[i]!, neighbor);
      seg.el.style.cursor = "ew-resize";
    }
    // Boundary pills — copied directly from budget-tree's interior knob pattern.
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1]!;
      const b = cells[i]!;
      const knob = Vec.lens(
        [a, b, leftX(i - 1)] as const,
        ([va, vb, lI1]: readonly [number, number, number]) => {
          const sumAB = va + vb;
          return { x: lI1 + (va / sumAB) * (sumAB / total.peek()) * sbW, y: sbY + sbH / 2 };
        },
        (target, [va, vb, lI1]) => {
          const sumAB = (va as number) + (vb as number);
          if (sumAB === 0) return [0, 0, undefined] as never;
          const widthAB = (sumAB / total.peek()) * sbW;
          const newAWPx = Math.max(0, Math.min(widthAB, target.x - (lI1 as number)));
          const newAValue = (newAWPx / widthAB) * sumAB;
          return [newAValue, sumAB - newAValue, undefined] as never;
        },
      );
      const PW = 6;
      const PH = Math.round(sbH * 0.7);
      const PY = sbY + (sbH - PH) / 2;
      const pillX = Num.derive(() => knob.value.x - PW / 2);
      const pill = s(
        rect(pillX, PY, PW, PH, { fill: "black", stroke: "white", thin: true, corner: PW / 2, opacity: 0.9 }),
      );
      drag(pill, knob);
      pill.el.style.cursor = "ew-resize";
      attachNudge(pill.el, a, b);
    }
    s(label(Vec.derive(() => ({ x: sbX0 + sbW / 2, y: sbY - 16 })), "stacked bar", { size: 11, bold: true, align: Anchor.Center }));

    // --- View 3: pie wedges (right third) ---
    const pcx = 640;
    const pcy = 180;
    const pr = 80;
    const ang = (i: number): Num =>
      Num.derive(() => {
        let acc = -Math.PI / 2;
        for (let j = 0; j < i; j++) acc += (cells[j]!.value / Math.max(total.value, 1e-9)) * 2 * Math.PI;
        return acc;
      });
    for (let i = 0; i < cells.length; i++) {
      const a0 = ang(i);
      const a1 = derive(() => a0.value + (cells[i]!.value / Math.max(total.value, 1e-9)) * 2 * Math.PI);
      const wedge = s(
        annularSector(Vec.derive(() => ({ x: pcx, y: pcy })), pr, 0, a0, a1, {
          fill: COLORS[i]!,
          opacity: 0.9,
          stroke: "#0b0d12",
          thin: true,
        }),
      );
      const wedgeNeighbor = cells[(i + 1) % cells.length]!;
      attachNudge(wedge.el, cells[i]!, wedgeNeighbor);
      wedge.el.style.cursor = "pointer";
      // Mid-arc label position.
      const labelPos = Vec.derive(() => {
        const m = (a0.value + a1.value) / 2;
        const r = pr * 0.65;
        return { x: pcx + Math.cos(m) * r, y: pcy + Math.sin(m) * r };
      });
      s(
        label(
          labelPos,
          derive(() => `${NAMES[i]!}\n${cells[i]!.value.toFixed(1)}`),
          {
            size: 10,
            align: Anchor.Center,
            fill: "#fff",
            opacity: derive(() => ((cells[i]!.value / Math.max(total.value, 1e-9)) > 0.05 ? 1 : 0)),
          },
        ),
      );
    }
    s(label(Vec.derive(() => ({ x: pcx, y: pcy - pr - 16 })), "pie · drag the dots to reapportion", { size: 11, bold: true, align: Anchor.Center }));

    // Polar boundary handles. Each handle sits on the arc at the angle
    // between wedge i-1 and wedge i. Dragging it sweeps that boundary
    // angle; the lens converts the new boundary angle into "what should
    // valA/valB be such that the angle lands here, sum preserved."
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1]!;
      const b = cells[i]!;
      const startAng = ang(i - 1); // angle where wedge a starts
      const handle = Vec.lens(
        [a, b, startAng, total] as const,
        ([va, vb, a0, tot]: readonly [number, number, number, number]) => {
          const aFrac = va / Math.max(tot, 1e-9);
          const ang = a0 + aFrac * Math.PI * 2;
          return { x: pcx + Math.cos(ang) * pr, y: pcy + Math.sin(ang) * pr };
        },
        (target, [va, vb, a0]) => {
          const sumAB = (va as number) + (vb as number);
          if (sumAB === 0) return [0, 0, undefined, undefined] as never;
          // Pointer angle (relative to pie center)
          let ang = Math.atan2(target.y - pcy, target.x - pcx);
          // Unwrap toward a0+sweepAB to land in the correct lap.
          const sweepAB = (sumAB / Math.max(total.peek(), 1e-9)) * Math.PI * 2;
          const a0n = a0 as number;
          const a1n = a0n + sweepAB;
          // Move ang into the [a0n, a1n] arc by adding/subtracting 2π.
          while (ang < a0n - 1e-6) ang += Math.PI * 2;
          while (ang > a1n + 1e-6) ang -= Math.PI * 2;
          const aFrac = Math.max(0, Math.min(1, (ang - a0n) / sweepAB));
          const newA = aFrac * sumAB;
          return [newA, sumAB - newA, undefined, undefined] as never;
        },
      );
      const handleShape = s(
        // Small filled circle as the handle — implemented as a tiny rect
        // for hit area, styled as a circle via corner radius.
        rect(
          Num.derive(() => handle.value.x - 7),
          Num.derive(() => handle.value.y - 7),
          14,
          14,
          { fill: "black", stroke: "white", thin: true, corner: 7, opacity: 0.95 },
        ),
      );
      drag(handleShape, handle);
      handleShape.el.style.cursor = "grab";
      attachNudge(handleShape.el, a, b);
    }
  }
}
