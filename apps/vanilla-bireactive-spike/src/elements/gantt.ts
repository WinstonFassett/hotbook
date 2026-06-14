// Original (vizform-flavored). A real Gantt chart with tasks as writable
// Range cells and "finish-to-start with lag" dependency edges.
//
// Drag a task body to slide it; drag its endpoints to resize. Constraints
// propagate: pushing a task right past its successor's gap drags the
// successor (and its successors) along to preserve the "B starts ≥ A end +
// lag" invariant. Dependency edges render as arrows whose endpoints are
// anchored to source/target task tips.
//
// Keyboard: focus a task and use Left/Right to slide (±1d, shift ±7d),
// alt+wheel to scrub. Endpoint handles use the same keys to resize.

import {
  Anchor,
  Diagram,
  derive,
  drag,
  label,
  type Mount,
  Num,
  num,
  type Range,
  range,
  rect,
  vec,
  Vec,
  type Writable,
} from "bireactive";

const W = 760;
const H = 380;

// --- model ---
interface TaskDef { id: string; name: string; lo: number; hi: number; color: string; }
const TASKS: TaskDef[] = [
  { id: "design",  name: "Design",     lo: 0,  hi: 10, color: "#5b8def" },
  { id: "api",     name: "API",        lo: 12, hi: 25, color: "#7ed321" },
  { id: "ui",      name: "UI",         lo: 14, hi: 30, color: "#f5a623" },
  { id: "test",    name: "QA",         lo: 32, hi: 42, color: "#e25c5c" },
  { id: "ship",    name: "Ship",       lo: 44, hi: 48, color: "#9b59b6" },
];
// Finish-to-start dependencies with minimum lag (days).
const DEPS: Array<{ from: string; to: string; lag: number }> = [
  { from: "design", to: "api",  lag: 2 },
  { from: "design", to: "ui",   lag: 4 },
  { from: "api",    to: "test", lag: 2 },
  { from: "ui",     to: "test", lag: 2 },
  { from: "test",   to: "ship", lag: 2 },
];

interface Task {
  def: TaskDef;
  range: Writable<Range>;
}

function makeTasks(): Task[] {
  return TASKS.map(t => ({ def: t, range: range(t.lo, t.hi) }));
}

// Topologically order tasks once for the cascade-on-drag policy.
function topoOrder(): string[] {
  const indeg = new Map<string, number>();
  for (const t of TASKS) indeg.set(t.id, 0);
  for (const d of DEPS) indeg.set(d.to, (indeg.get(d.to) ?? 0) + 1);
  const queue: string[] = [];
  for (const [k, v] of indeg) if (v === 0) queue.push(k);
  const out: string[] = [];
  while (queue.length) {
    const k = queue.shift()!;
    out.push(k);
    for (const d of DEPS.filter(x => x.from === k)) {
      const n = (indeg.get(d.to) ?? 0) - 1;
      indeg.set(d.to, n);
      if (n === 0) queue.push(d.to);
    }
  }
  return out;
}
const TOPO = topoOrder();

export class MdGantt extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    const tasks = makeTasks();
    const byId = new Map(tasks.map(t => [t.def.id, t]));

    // Total day range from data, with a little headroom.
    const T0 = 0;
    const T1 = 60;
    const xL = 70;
    const xR = W - 30;
    const xOf = (d: number) => xL + (d / (T1 - T0)) * (xR - xL);
    const dOf = (x: number) => ((x - xL) / (xR - xL)) * (T1 - T0);

    // --- day grid + axis ---
    for (let d = T0; d <= T1; d += 5) {
      const x = xOf(d);
      s(
        rect(x, 60, 1, H - 110, { fill: d % 10 === 0 ? "#333" : "#1a1f2a", thin: true }),
        label(vec(x, 50), `d${d}`, { size: 9, fill: "#666", align: Anchor.Center }),
      );
    }

    // --- header / footer ---
    s(
      label(view.top.down(20), "Gantt · drag a bar to slide, endpoints to resize · dependencies cascade downstream", { size: 11, bold: true, align: Anchor.Center }),
      label(view.bottom.up(14), "finish-to-start + lag invariant: succ.lo ≥ pred.hi + lag · enforced in the drag callback (cascade through topo order)", { size: 10 }),
    );

    // --- task rows ---
    const rowH = 28;
    const rowGap = 10;
    const rowY0 = 80;
    const yOfTask = (i: number) => rowY0 + i * (rowH + rowGap) + rowH / 2;

    // Constraint propagation: after any task's range changes, walk topo
    // order and push each successor forward enough to satisfy its
    // dependencies. Width is preserved (sliding, not stretching) unless
    // the user is editing an endpoint.
    const propagate = () => {
      for (const id of TOPO) {
        const t = byId.get(id)!;
        const incoming = DEPS.filter(d => d.to === id);
        if (!incoming.length) continue;
        let minStart = -Infinity;
        for (const d of incoming) {
          const pred = byId.get(d.from)!;
          minStart = Math.max(minStart, pred.range.value.hi + d.lag);
        }
        const cur = t.range.value;
        if (cur.lo < minStart) {
          const dur = cur.hi - cur.lo;
          t.range.value = { lo: minStart, hi: minStart + dur };
        }
      }
    };

    tasks.forEach((t, i) => {
      const y = yOfTask(i);

      // Row label
      s(
        label(vec(xL - 10, y), t.def.name, {
          size: 11,
          bold: true,
          align: Anchor.Right,
        }),
      );

      // Task body
      const bx = derive(() => xOf(t.range.value.lo));
      const bw = derive(() => xOf(t.range.value.hi) - xOf(t.range.value.lo));
      const body = s(
        rect(bx, y - rowH / 2 + 4, bw, rowH - 8, {
          fill: t.def.color,
          corner: 4,
          opacity: 0.9,
        }),
      );
      // Drag the body = translate (preserve duration), then propagate.
      const bodyLens = Vec.lens(
        [t.range] as const,
        ([r]: readonly [Range]) => ({
          x: (xOf(r.lo) + xOf(r.hi)) / 2,
          y,
        }),
        (target, [r]) => {
          const dur = (r as Range).hi - (r as Range).lo;
          const midDays = dOf(target.x);
          const newLo = Math.max(0, midDays - dur / 2);
          return [{ lo: newLo, hi: newLo + dur }] as never;
        },
      );
      drag(body, bodyLens);
      body.el.style.cursor = "grab";
      // Cascade downstream on any change.
      body.el.addEventListener("pointerup", () => propagate());

      // Keyboard: arrow keys shift by 1 day, shift+arrow by 7.
      body.el.setAttribute("tabindex", "0");
      body.el.style.outline = "none";
      body.el.addEventListener("keydown", (ev: Event) => {
        const e = ev as KeyboardEvent;
        const step = e.shiftKey ? 7 : 1;
        // Up/Down resize (grow/shrink duration); Left/Right slide.
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const delta = (e.key === "ArrowUp" ? +1 : -1) * step;
          const r = t.range.value;
          const newHi = Math.max(r.lo + 1, r.hi + delta);
          t.range.value = { lo: r.lo, hi: newHi };
          propagate();
          return;
        }
        let delta = 0;
        if (e.key === "ArrowRight") delta = +step;
        else if (e.key === "ArrowLeft") delta = -step;
        else return;
        e.preventDefault();
        const r = t.range.value;
        const dur = r.hi - r.lo;
        const newLo = Math.max(0, r.lo + delta);
        t.range.value = { lo: newLo, hi: newLo + dur };
        propagate();
      });
      body.el.addEventListener("wheel", (ev: Event) => {
        const e = ev as WheelEvent;
        if (!e.altKey) return;
        e.preventDefault();
        const step = e.shiftKey ? 7 : 1;
        const delta = e.deltaY < 0 ? +step : -step;
        const r = t.range.value;
        const dur = r.hi - r.lo;
        const newLo = Math.max(0, r.lo + delta);
        t.range.value = { lo: newLo, hi: newLo + dur };
        propagate();
      }, { passive: false });

      // Day-count label
      s(
        label(
          Vec.derive(() => ({
            x: (xOf(t.range.value.lo) + xOf(t.range.value.hi)) / 2,
            y,
          })),
          derive(() => {
            const r = t.range.value;
            return `${Math.round(r.hi - r.lo)}d`;
          }),
          { size: 10, fill: "#fff", align: Anchor.Center },
        ),
      );

      // Endpoint handles (resize)
      const loHandle = Vec.lens(
        [t.range] as const,
        ([r]: readonly [Range]) => ({ x: xOf((r as Range).lo), y }),
        (target, [r]) => {
          const newLo = Math.max(0, Math.min((r as Range).hi - 1, dOf(target.x)));
          return [{ lo: newLo, hi: (r as Range).hi }] as never;
        },
      );
      const hiHandle = Vec.lens(
        [t.range] as const,
        ([r]: readonly [Range]) => ({ x: xOf((r as Range).hi), y }),
        (target, [r]) => {
          const newHi = Math.max((r as Range).lo + 1, dOf(target.x));
          return [{ lo: (r as Range).lo, hi: newHi }] as never;
        },
      );
      const loH = s(
        rect(
          Num.derive(() => loHandle.value.x - 4),
          y - rowH / 2 + 4,
          8,
          rowH - 8,
          { fill: "#0b0d12", stroke: "white", thin: true, corner: 2 },
        ),
      );
      const hiH = s(
        rect(
          Num.derive(() => hiHandle.value.x - 4),
          y - rowH / 2 + 4,
          8,
          rowH - 8,
          { fill: "#0b0d12", stroke: "white", thin: true, corner: 2 },
        ),
      );
      drag(loH, loHandle);
      drag(hiH, hiHandle);
      loH.el.style.cursor = "ew-resize";
      hiH.el.style.cursor = "ew-resize";
      loH.el.addEventListener("pointerup", () => propagate());
      hiH.el.addEventListener("pointerup", () => propagate());
    });

    // --- dependency edges (arrows) ---
    // Drawn after bodies so they overlay; simple right-angle elbow.
    for (const d of DEPS) {
      const from = byId.get(d.from)!;
      const to = byId.get(d.to)!;
      const fromIdx = tasks.findIndex(x => x.def.id === d.from);
      const toIdx = tasks.findIndex(x => x.def.id === d.to);
      const fy = yOfTask(fromIdx);
      const ty = yOfTask(toIdx);
      const fxEnd = derive(() => xOf(from.range.value.hi));
      const txStart = derive(() => xOf(to.range.value.lo));
      // Elbow: horizontal segment from fxEnd to midX, vertical to ty, horizontal to txStart.
      const elbowX = Num.derive(() => Math.max(fxEnd.value + 8, txStart.value - 8));
      s(
        rect(fxEnd, fy - 0.5, derive(() => elbowX.value - fxEnd.value), 1, { fill: "#7aa", opacity: 0.6 }),
        rect(elbowX, derive(() => Math.min(fy, ty)), 1, derive(() => Math.abs(ty - fy)), { fill: "#7aa", opacity: 0.6 }),
        rect(elbowX, ty - 0.5, derive(() => txStart.value - elbowX.value), 1, { fill: "#7aa", opacity: 0.6 }),
        // arrowhead (small triangle approximated as a tiny rect)
        rect(derive(() => txStart.value - 6), ty - 3, 6, 6, { fill: "#7aa", corner: 1, opacity: 0.85 }),
      );
    }

    // Run initial propagation to canonicalize the starting positions.
    propagate();
  }
}
