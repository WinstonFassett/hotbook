import { Anchor, annularSector, cell, circle, derive, easeOut, effect as biEffect, label, type Mount, Num, num, tween, untracked, Vec, type Writable } from "bireactive";
import { circleHandle } from "../lib/handles";
import { Diagram } from "../lib/diagram";
import { pie } from "d3-shape";
import { wheelController, dynamicWheelStep, realModifierDown } from "../lib/interaction";
import { makeBridge, type ElementWithBridge } from "../lib/hud-bridge";
import { useHostSize, FILL_STYLE } from "../lib/host-size";
import { dragCancelable } from "../lib/esc-contract";
import { GESTURE_ACTIVE_CLASS } from "../lib/transitions";
import { attachReorderGesture } from "../lib/reorder-gesture";

const W = 640;
const H = 640;
const R_INNER = 0;
const SORT_SEC = 0.35; // s — measure-swap tween duration

const PALETTE = ['#e08888', '#d4a86c', '#ccc060', '#7ec87e', '#60c4c0', '#7aaae8', '#b090e0', '#8899b4'];

interface Slice {
  id?: string;
  label: string;
  // Writable Num cell — same shape as the hierarchical charts' node.value.total.
  // This is what lets the boundary knob use the canonical Vec.lens([a,b],...)
  // pattern (sources = writable cells) instead of empty-source side-effects.
  value: Writable<Num>;
}

function makeData(): Slice[] {
  return ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"].map((l) => ({
    id: l,
    label: l,
    value: num(Math.round(10 + Math.random() * 90)),
  }));
}

export class MdPieChartLC extends Diagram {
  static styles = `
    text { pointer-events: none; }
    ${FILL_STYLE}
    [data-focusable]:focus {
      outline: 2px solid #4a9eff;
      outline-offset: 2px;
    }
    [data-focusable]:focus:not(:focus-visible) {
      outline: none;
    }
  `
  readonly dataCell = cell<readonly Slice[]>(makeData());

  private _measureKeyCell = cell<string>('')
  get measureKey(): string { return this._measureKeyCell.value }
  set measureKey(v: string) { this._measureKeyCell.value = v }
  // Axis-binding model (WIN-144): valueBinding replaces measureKey.
  get valueBinding(): string { return this.measureKey }
  set valueBinding(v: string) { this.measureKey = v }

  // Drag-to-reorder (WIN-262). Caller opts in when sort is by natural order;
  // chart doesn't sniff sort. Commit fires onReorder(orderedIds) — order
  // persistence is the caller's problem (re-feed data, mutate BiNode, splice
  // array — chart doesn't care).
  private _canReorderCell = cell<boolean>(false)
  get canReorder(): boolean { return this._canReorderCell.value }
  set canReorder(v: boolean) { this._canReorderCell.value = v }
  onReorder?: (orderedIds: string[]) => void

  set externalData(v: { id?: string; label: string; value: number }[] | undefined) {
    if (v) this.dataCell.value = v.map((d) => ({ id: d.id, label: d.label, value: num(d.value) }));
  }
  get externalData(): { id?: string; label: string; value: number }[] | undefined {
    return this.dataCell.value.map((d) => ({ id: d.id, label: d.label, value: d.value.value }));
  }
  protected scene(s: Mount): void {
    const { w: Wc, h: Hc } = useHostSize(this, { width: W, height: H });
    this.view(Wc, Hc);
    this.tabIndex = -1; // Container not directly focusable, items are
    this.style.outline = "none";

    const data = this.dataCell;

    const hover = cell<Slice | null>(null);
    const selected = cell<Slice | null>(null);

    // Reactive center and radius based on host size.
    const cx = Num.derive(() => Wc.value / 2);
    const cy = Num.derive(() => Hc.value / 2);
    const rOuter = Num.derive(() => Math.min(Wc.value, Hc.value) / 2 - 20);
    const center = Vec.derive(() => ({ x: cx.value, y: cy.value }));

    const mutateDatum = (d: Slice, delta: number) => {
      d.value.value = Math.max(1, d.value.value + delta);
    };

    const setGestureActive = (on: boolean) => { this.classList.toggle(GESTURE_ACTIVE_CLASS, on); (this as any).gestureActive = on; };

    // Config handed to the SHARED wheel controller (app-wide singleton).
    const wheelConfig = {
      snapshot: (d: Slice) => { setGestureActive(true); return d.value.value; },
      restore: (d: Slice, v: number) => { d.value.value = Math.max(1, v); },
      onEnd: (canceled: boolean) => { setGestureActive(false); hover.value = null; this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled } })); },
    };

    // Per-slice tweened value cells — TWEEN on measure swap (animate arcs to
    // new values), SNAP on value edits / gestures (write-through, no lag).
    // Same two-lane gate pattern as hier charts (WIN-143).
    const slices0 = data.peek() as Slice[];
    const tweenedValues = new Map<string, Writable<Num>>();
    for (const d of slices0) {
      const sid = d.id ?? d.label;
      const vTarget = derive(() => { void data.value; return d.value.value; });
      const tv = num(vTarget.value);
      tweenedValues.set(sid, tv);
      let tvCancel: (() => void) | null = null;
      let tvInited = false;
      let seenMeasureKey = untracked(() => this._measureKeyCell.value);
      biEffect(() => {
        const target = vTarget.value;
        const measureKey = untracked(() => this._measureKeyCell.value);
        if (!tvInited) { tvInited = true; seenMeasureKey = measureKey; tv.value = target; return; }
        const measureSwapped = measureKey !== seenMeasureKey;
        seenMeasureKey = measureKey;
        if (measureSwapped && !this.classList.contains(GESTURE_ACTIVE_CLASS)) {
          tvCancel?.();
          tvCancel = this.anim.start(tween(tv, target, SORT_SEC, easeOut));
        } else {
          tvCancel?.(); tvCancel = null;
          tv.value = target;
        }
      });
    }
    // Tweened data for the pie layout — replaces raw values with tweened values.
    // Boundary knobs still write to raw value cells; tween cells snap to follow.
    const tweenedData = derive(() => {
      void data.value; // track data changes (reorder, add/remove)
      return (data.peek() as Slice[]).map(d => {
        const sid = d.id ?? d.label;
        const tv = tweenedValues.get(sid);
        return tv ? { ...d, value: tv } : d;
      });
    });

    // Pie layout (reactive). Reads each slice's tweened value CELL so the
    // layout recomputes whenever any value changes (drag, wheel, keyboard,
    // measure swap) — and tweens on measure swap, snaps on value edits.
    const arcs = derive(() => {
      const layout = pie<Slice>().value((d) => d.value.value).sort(null);
      return layout(tweenedData.value as Slice[]);
    });

    // Draw slices.
    const sliceElements = new Map<Slice, SVGElement>(); // Track elements by datum identity
    // Per-slice angle cells, keyed by stable id. Hoisted so the reorder gesture
    // (Layer 4 of the reorder pattern — imperative preview) can rewrite any
    // slice's angles during another slice's drag.
    const sliceAnglesById = new Map<string, { a0: Writable<Num>, a1: Writable<Num> }>();
    const slicesById = new Map<string, Slice>();
    const sliceElById = new Map<string, SVGElement>();
    const focusDatum = (d: Slice | null) => {
      if (d) sliceElements.get(d)?.focus();
    };
    // Order hash — detects sort (reorder) vs value edit. When the id sequence
    // changes, it's a sort; the arc angles need to tween (slices rotate).
    const orderHash = derive(() => (data.value as Slice[]).map(d => d.id ?? d.label).join(','));
    for (let i = 0; i < slices0.length; i++) {
      const d = slices0[i]!;
      const sid = d.id ?? d.label;
      const color = PALETTE[i % PALETTE.length]!;

      const arcDatum = derive(() => arcs.value[i]);
      const a0Target = derive(() => arcDatum.value?.startAngle ?? 0);
      const a1Target = derive(() => arcDatum.value?.endAngle ?? 0);

      // Tweened arc angles — TWEEN on sort (order change) or measure swap,
      // SNAP on value edits / gestures. Sort rotates slices to new positions;
      // measure swap changes slice sizes. Both are structural.
      const a0 = num(a0Target.value);
      const a1 = num(a1Target.value);
      let aCancel: (() => void) | null = null;
      let aInited = false;
      let seenMeasureKey = untracked(() => this._measureKeyCell.value);
      let seenOrder = untracked(() => orderHash.value);
      biEffect(() => {
        const t0 = a0Target.value, t1 = a1Target.value;
        const measureKey = untracked(() => this._measureKeyCell.value);
        const order = orderHash.value;
        if (!aInited) { aInited = true; seenMeasureKey = measureKey; seenOrder = order; a0.value = t0; a1.value = t1; return; }
        const structural = measureKey !== seenMeasureKey || order !== seenOrder;
        seenMeasureKey = measureKey; seenOrder = order;
        if (structural && !this.classList.contains(GESTURE_ACTIVE_CLASS)) {
          aCancel?.();
          aCancel = this.anim.start(
            tween(a0, t0, SORT_SEC, easeOut) as any,
            tween(a1, t1, SORT_SEC, easeOut) as any,
          );
        } else {
          aCancel?.(); aCancel = null;
          a0.value = t0; a1.value = t1;
        }
      });

      const r = derive(() =>
        selected.value === d ? rOuter.value + 8 : hover.value === d ? rOuter.value + 4 : rOuter.value
      );
      const opacity = derive(() => selected.value && selected.value !== d ? 0.5 : 1);

      const sector = s(annularSector(center, r, R_INNER, a0, a1, {
        fill: color,
        stroke: "#0b0d12",
        strokeWidth: 1,
        opacity,
      }));
      sliceElements.set(d, sector.el); // Store for focus management
      sliceAnglesById.set(sid, { a0, a1 });
      slicesById.set(sid, d);
      sliceElById.set(sid, sector.el);
      // Make each slice individually focusable
      sector.el.setAttribute('tabindex', '0');
      sector.el.setAttribute('data-focusable', 'slice');
      sector.el.setAttribute('aria-label', `${d.label}: ${Math.round(d.value.value)}`);
      sector.el.addEventListener("pointerenter", () => { if (!wheelController.active) hover.value = d; });
      sector.el.addEventListener("pointerleave", () => { if (!wheelController.active && hover.value === d) hover.value = null; });
      sector.el.addEventListener("click", () => { selected.value = selected.value === d ? null : d; });
      sector.el.addEventListener("focus", () => { selected.value = d; });
      sector.el.addEventListener("blur", () => { if (selected.value === d) selected.value = null; });

      const labelPos = Vec.derive(() => {
        const mid = (a0.value + a1.value) / 2;
        const r = rOuter.value * 0.65;
        return { x: cx.value + Math.cos(mid) * r, y: cy.value + Math.sin(mid) * r };
      });
      const sliceLabel = derive(() => {
        const arc = arcDatum.value;
        if (!arc || (arc.endAngle - arc.startAngle) < 0.25) return "";
        const total = (data.value as Slice[]).reduce((a, b) => a + b.value.value, 0);
        return `${d.label}\n${((d.value.value / total) * 100).toFixed(0)}%`;
      });
      s(label(labelPos, sliceLabel, { size: 11, align: Anchor.Center, fill: "#fff" }));
    }

    // ─── Drag-to-reorder (WIN-262) ────────────────────────────────────────
    // Attach a per-slice reorder gesture when the caller opts in via
    // canReorder. During drag, ghost angles are written imperatively to the
    // hoisted a0/a1 cells; data is never mutated until commit. Reactive
    // layout freezes via GESTURE_ACTIVE_CLASS (respected by the tween effect
    // at line ~181). On commit, onReorder(orderedIds) fires; the caller
    // persists the order however it likes (chart is agnostic — Rule 8).
    const shortestDelta = (from: number, to: number): number => {
      let d = to - from;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return d;
    };
    const norm2pi = (a: number): number => {
      let x = a;
      while (x < 0) x += 2 * Math.PI;
      while (x >= 2 * Math.PI) x -= 2 * Math.PI;
      return x;
    };
    const pointerAngle = (e: PointerEvent, target: SVGElement): number => {
      // Convert pointer client coords → SVG world coords via the target's
      // ownerSVGElement CTM. Works under any host scaling / viewBox.
      const svg = target.ownerSVGElement;
      let px = e.clientX, py = e.clientY;
      if (svg) {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        const ctm = svg.getScreenCTM();
        if (ctm) { const p = pt.matrixTransform(ctm.inverse()); px = p.x; py = p.y; }
      }
      return Math.atan2(py - cy.peek(), px - cx.peek());
    };
    const reorderDetachers: Array<() => void> = [];
    const detachAllReorder = () => { while (reorderDetachers.length) reorderDetachers.pop()!(); };
    biEffect(() => {
      const enabled = this._canReorderCell.value;
      detachAllReorder();
      // Reset cursor when disabled.
      for (const el of sliceElById.values()) el.style.cursor = enabled ? 'grab' : '';
      if (!enabled) return;

      for (const [sid, el] of sliceElById.entries()) {
        let startMouseAngle = Number.NaN; // captured on first onPreview
        let startMidAngle = 0;
        let dragSpan = 0;
        const initialMidById = new Map<string, number>();

        const detach = attachReorderGesture({
          hitEl: el,
          itemId: sid,
          host: this,
          getInitialOrder: () => (data.peek() as Slice[]).map(x => x.id ?? x.label),
          computeTargetIndex: (e, initialOrder) => {
            if (Number.isNaN(startMouseAngle)) return initialOrder.indexOf(sid);
            const cur = pointerAngle(e, el);
            const delta = shortestDelta(startMouseAngle, cur);
            const ghostMid = norm2pi(startMidAngle + delta);
            const scored = initialOrder.map(id => ({
              id,
              mid: id === sid ? ghostMid : norm2pi(initialMidById.get(id) ?? 0),
            }));
            scored.sort((a, b) => a.mid - b.mid);
            return scored.findIndex(s => s.id === sid);
          },
          onActivate: () => {
            // Snapshot initial angles from the current layout.
            const cur = arcs.peek();
            initialMidById.clear();
            (data.peek() as Slice[]).forEach((x, i) => {
              const a = cur[i];
              if (a) initialMidById.set(x.id ?? x.label, (a.startAngle + a.endAngle) / 2);
            });
            const meIdx = (data.peek() as Slice[]).findIndex(x => (x.id ?? x.label) === sid);
            const meArc = cur[meIdx];
            startMidAngle = meArc ? (meArc.startAngle + meArc.endAngle) / 2 : 0;
            dragSpan = meArc ? (meArc.endAngle - meArc.startAngle) : 0;
            startMouseAngle = Number.NaN; // captured on first pointermove
            el.style.cursor = 'grabbing';
            // Raise dragged slice above siblings (SVG paint order = last child).
            el.parentElement?.appendChild(el);
          },
          onPreview: (order, e) => {
            if (Number.isNaN(startMouseAngle)) startMouseAngle = pointerAngle(e, el);
            const currentData = data.peek() as Slice[];
            const bySlice = new Map(currentData.map(x => [x.id ?? x.label, x]));
            const orderedSlices = order.map(id => bySlice.get(id)!).filter(Boolean);
            const layout = pie<Slice>().value(sl => sl.value.value).sort(null)(orderedSlices);
            // Siblings snap to their new slots (Rule 3 real-time feedback).
            for (const seg of layout) {
              const segId = seg.data.id ?? seg.data.label;
              if (segId === sid) continue;
              const cells = sliceAnglesById.get(segId);
              if (!cells) continue;
              cells.a0.value = seg.startAngle;
              cells.a1.value = seg.endAngle;
            }
            // Dragged slice: ghost centered on pointer-derived mid, keep span.
            const meCells = sliceAnglesById.get(sid);
            if (meCells) {
              const cur = pointerAngle(e, el);
              const delta = shortestDelta(startMouseAngle, cur);
              const ghostMid = startMidAngle + delta;
              meCells.a0.value = ghostMid - dragSpan / 2;
              meCells.a1.value = ghostMid + dragSpan / 2;
            }
          },
          onEnd: (finalOrder, canceled) => {
            el.style.cursor = 'grab';
            const initial = (data.peek() as Slice[]).map(x => x.id ?? x.label);
            const changed = !canceled && finalOrder.some((id, i) => id !== initial[i]);
            if (changed) {
              // Commit. Reactive layout will recompute from the new data order;
              // the tween effect (line ~181) runs its structural branch and
              // tweens from the current (imperative) positions — settle from
              // where slices visually are (Rule 4).
              this.onReorder?.(finalOrder.slice());
              this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled: false, reorder: true } }));
              return;
            }
            // Cancel or no-op: tween each slice's a0/a1 back to its target.
            // Data was never mutated, so arcs.peek() is still the initial layout.
            const arcSnap = arcs.peek();
            (data.peek() as Slice[]).forEach((x, i) => {
              const cells = sliceAnglesById.get(x.id ?? x.label);
              const arc = arcSnap[i];
              if (!cells || !arc) return;
              this.anim.start(
                tween(cells.a0, arc.startAngle, SORT_SEC, easeOut) as any,
                tween(cells.a1, arc.endAngle, SORT_SEC, easeOut) as any,
              );
            });
            this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled } }));
          },
        });
        reorderDetachers.push(detach);
      }
    });

    if (!this.hasAttribute("no-handles")) {
      const rows = data.peek() as Slice[];
      for (let i = 0; i < rows.length - 1; i++) {
        const a = rows[i]!.value;
        const b = rows[i + 1]!.value;
        // Shared angular span of the two adjacent slices. Peeked geometry —
        // these are derived layout outputs, never lens sources.
        const span0 = derive(() => arcs.value[i]?.startAngle ?? 0);
        const span1 = derive(() => arcs.value[i + 1]?.endAngle ?? 0);

        // Canonical boundary knob — IDENTICAL pattern to icicle/sunburst:
        //   sources = the two writable value cells [a, b]
        //   read    = position from (a,b) + peeked span geometry
        //   write   = returns [newA, newB]; framework flushes both atomically
        // No imperative side-effects, no reading the live `arcs` layout during
        // the drag — that coupling is what made the old pie jump.
        const knob = Vec.lens(
          [a, b] as const,
          (vals: readonly [number, number]) => {
            const [va, vb] = vals;
            const s0 = span0.peek();
            const s1 = span1.peek();
            const sum = va + vb;
            const frac = sum === 0 ? 0.5 : va / sum;
            const ang = s0 + frac * (s1 - s0);
            return { x: cx.peek() + Math.cos(ang) * rOuter.peek(), y: cy.peek() + Math.sin(ang) * rOuter.peek() };
          },
          (target, vals: readonly [number, number]) => {
            const [va, vb] = vals;
            const sum = va + vb;
            const s0 = span0.peek();
            const s1 = span1.peek();
            if (sum === 0 || s1 <= s0) return [va, vb];
            let ang = Math.atan2(target.y - cy.peek(), target.x - cx.peek());
            if (ang < 0) ang += 2 * Math.PI;
            while (ang < s0 - Math.PI) ang += 2 * Math.PI;
            while (ang > s1 + Math.PI) ang -= 2 * Math.PI;
            const frac = Math.max(0, Math.min(1, (ang - s0) / (s1 - s0)));
            const newA = frac * sum;
            return [newA, sum - newA];
          },
        );

        // Separate reactive derive drives the VISUAL position so the dot tracks
        // layout live (matches the sibling layercharts charts' knobPos).
        const knobPos = Vec.derive(() => {
          const va = a.value, vb = b.value;
          const sum = va + vb;
          const frac = sum === 0 ? 0.5 : va / sum;
          const ang = span0.value + frac * (span1.value - span0.value);
          return { x: cx.value + Math.cos(ang) * rOuter.value, y: cy.value + Math.sin(ang) * rOuter.value };
        });

        const active = cell(false);
        const handle = s(circleHandle(knobPos, {
          kind: "divider",
          active,
        }));
        // Cancelable divider drag: snapshots [a,b] on down, redistributes between
        // the two adjacent slices. Pie layout is .sort(null) (never reorders), so
        // there is no sort-order concern here.
        dragCancelable(handle, knob, [a, b], {
          host: this,
          onStart: () => { active.value = true; setGestureActive(true); handle.el.style.cursor = "grabbing"; },
          onEnd: (canceled: boolean) => { active.value = false; setGestureActive(false); handle.el.style.cursor = "grab"; this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled } })); },
        });
        handle.el.style.cursor = "grab";
        handle.el.addEventListener("pointerenter", () => { active.value = true; });
        handle.el.addEventListener("pointerleave", () => { if (!(this as any).gestureActive) active.value = false; });
      }
    }

    this.addEventListener("wheel", (e) => {
      const we = e as WheelEvent;
      if (!we.ctrlKey) return;
      const t = wheelController.begin(hover.value ?? selected.value, wheelConfig, { pinch: !realModifierDown() });
      if (!t) return;
      we.preventDefault();
      const s = dynamicWheelStep(t.value.value, we.shiftKey);
      mutateDatum(t, we.deltaY < 0 ? +s : -s);
    }, { passive: false });

    this.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") {
        // Drag-Esc is owned by the gesture (dragCancelable). Here: clear selection
        // if focused, else fall through.
        if (selected.value != null) { selected.value = null; ke.preventDefault(); }
        return;
      }
      const rows = data.value as Slice[];
      const cur = selected.value;
      const i = cur ? rows.indexOf(cur) : -1;
      if (ke.key === "ArrowRight" || ke.key === "ArrowLeft") {
        const nextIdx = ke.key === "ArrowLeft"
          ? (i <= 0 ? rows.length : i) - 1
          : (i + 1) % rows.length;
        selected.value = rows[nextIdx] ?? null;
        focusDatum(selected.value);
        ke.preventDefault(); return;
      }
      if (!cur) return;
      const step = dynamicWheelStep(cur.value.value, ke.shiftKey);
      if (ke.key === "ArrowUp") { mutateDatum(cur, +step); ke.preventDefault(); }
      else if (ke.key === "ArrowDown") { mutateDatum(cur, -step); ke.preventDefault(); }
    });

    s(label(
      Vec.derive(() => ({ x: Wc.value / 2, y: 20 })),
      "PieChart — click · ←/→ navigate · ↑/↓ edit · cmd+wheel",
      { size: 11, align: Anchor.Center, opacity: 0.7 },
    ));

    const idOf = (d: Slice | null) => d?.id ?? null;
    const datumAt = (id: string | null) => id == null ? null : (data.value as Slice[]).find(d => d.id === id) ?? null;
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
