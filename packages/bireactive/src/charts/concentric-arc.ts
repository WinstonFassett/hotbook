// ConcentricArc — editable concentric progress arcs, LC-style.
// Full-360° track per ring, rounded ends, value arc on top.
// Click ring to select · Tab/←/→ nav · ↑/↓ edit · cmd+wheel.

import { Anchor, cell, circle, derive, easeInOut, easeOut, effect as biEffect, group, label, mount, num, pathD, tween, untracked, Vec } from "bireactive";
import { RadialChartBase, type FlatItem } from "../radial/radial-chart-base";
import { arc as d3Arc } from "d3-shape";
import { wheelController, dragController, realModifierDown } from "../lib/interaction";
import { GESTURE_ACTIVE_CLASS } from "../lib/transitions";
import { motion } from "../lib/runtime-config";
import { setup } from "../hierarchical/gesture";
import { transitionOnUpdated } from "../hierarchical/behaviors/transition-on-updated";

const W = 640;
const H = 640;

const RING_GAP = 8;
// Fraction of total radius reserved as empty center (for label readout / future hover info).
// 1.5 means the dead zone equals 1.5 ring-step widths.
const INNER_RESERVE = 1.5;
const DEFAULT_MAX_RINGS = 8;

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

interface Ring extends FlatItem {
  id?: string;
  label: string;
  color: string;
  value: number; // 0–100
}

function makeData(): Ring[] {
  return RING_DEFS.slice(0, DEFAULT_MAX_RINGS).map((r) => ({ ...r, id: r.label, value: Math.round(20 + Math.random() * 70) }));
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

const CONCENTRIC_CSS = `
text { pointer-events: none; }
[data-focusable]:focus { outline: 2px solid #4a9eff; outline-offset: 2px; }
[data-focusable]:focus:not(:focus-visible) { outline: none; }
`;
let concentricCssInjected = false;
function ensureConcentricCss() {
  if (typeof document === "undefined" || concentricCssInjected) return;
  concentricCssInjected = true;
  const style = document.createElement("style");
  style.id = "vf-concentric-arc";
  style.textContent = CONCENTRIC_CSS;
  document.head.appendChild(style);
}

export class MdConcentricArcLC extends RadialChartBase {
  readonly dataCell = cell<readonly Ring[]>(makeData());

  private _maxRingsCell = cell<number>(DEFAULT_MAX_RINGS)
  get maxRings(): number { return this._maxRingsCell.value }
  set maxRings(v: number) { this._maxRingsCell.value = v }

  private _measureKeyCell = cell<string>('')
  get measureKey(): string { return this._measureKeyCell.value }
  set measureKey(v: string) { this._measureKeyCell.value = v }
  // Axis-binding model (WIN-144): valueBinding replaces measureKey.
  get valueBinding(): string { return this.measureKey }
  set valueBinding(v: string) { this.measureKey = v }

  set externalData(v: { label: string; value: number }[] | undefined) {
    if (v) this.dataCell.value = (v as unknown as Ring[]).slice(0, this._maxRingsCell.peek());
  }
  get externalData(): { label: string; value: number }[] | undefined {
    return this.dataCell.value as unknown as { label: string; value: number }[];
  }
  connectedCallback() {
    super.connectedCallback();
    if (!this._configCell.value) {
      this._configCell.value = { sort: "index", conservationMode: "additive" };
    }
  }

  protected _setupRendering(): void {
    ensureConcentricCss();
    const s = this._s;
    const { w: Wc, h: Hc } = this._hostSize!;
    this._setViewBox(Wc.value, Hc.value);
    this.tabIndex = -1; // Container not directly focusable, items are
    this.style.outline = "none";
    // Rule 14: touch is a first-class gesture surface. Claim the touch gesture
    // from the browser so drag-edit on ring handles doesn't lose to page scroll.
    this.style.touchAction = "none";

    // Sync dataCell → base _dataCell.
    this._setupDisposers.push(biEffect(() => { this._dataCell.value = this.dataCell.value; }));

    const cx = derive(() => Wc.value / 2);
    const cy = derive(() => Hc.value / 2);

    const data = this.dataCell;
    const maxRingsCell = this._maxRingsCell;
    // Reactive count drives thickness so it re-derives if data or maxRings changes after mount.
    const nCell = derive(() => Math.min((data.value as Ring[]).length, maxRingsCell.value));

    // Outermost ring outer radius — fills the container with padding for end-cap labels.
    const rOuterStart = derive(() => Math.min(Wc.value, Hc.value) / 2 - 30);
    // Total slots = n rings + INNER_RESERVE dead zone at center.
    // (n + INNER_RESERVE) * (thickness + gap) - gap = rOuterStart
    // → thickness = (rOuterStart + gap) / (n + INNER_RESERVE) - gap
    const ringThickness = derive(() =>
      Math.max(6, (rOuterStart.value + RING_GAP) / (nCell.value + INNER_RESERVE) - RING_GAP)
    );
    const ringStep = derive(() => ringThickness.value + RING_GAP);
    const hover = cell<Ring | null>(null);
    const selected = cell<Ring | null>(null);

    const setValue = (d: Ring, v: number) => {
      d.value = Math.max(MIN_VALUE, Math.min(100, v));
      data.value = [...data.value];
    };
    const mutateDatum = (d: Ring, delta: number) => setValue(d, d.value + delta);

    const setGestureActive = (on: boolean) => { this.classList.toggle(GESTURE_ACTIVE_CLASS, on); (this as any).gestureActive = on; };

    // Config handed to the SHARED wheel controller (app-wide singleton).
    const wheelConfig = {
      snapshot: (d: Ring) => { setGestureActive(true); return d.value; },
      restore: (d: Ring, v: number) => mutateDatum(d, v - d.value),
      onEnd: (canceled: boolean) => { setGestureActive(false); this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled } })); },
    };
    // Last ring the pointer was over — kept past pointerleave so a wheel edit can
    // still target it for a moment after the cursor exits the ring band.
    let lastRing: Ring | null = null;

    const svgEl = this._svg!;
    svgEl.style.touchAction = "none";
    // Pointer → diagram-local coords (CX/CY origin at center, SVG-space angles).
    const localPt = (e: PointerEvent) => {
      const r = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox?.baseVal;
      const sx = vb && vb.width ? vb.width / r.width : 1;
      const sy = vb && vb.height ? vb.height / r.height : 1;
      return { x: (e.clientX - r.left) * sx - cx.peek(), y: (e.clientY - r.top) * sy - cy.peek() };
    };
    const findRingAtLocal = (lx: number, ly: number): Ring | null => {
      const dist = Math.sqrt(lx * lx + ly * ly);
      const rows = data.value as Ring[];
      for (let rank = 0; rank < rows.length; rank++) {
        const ro = rOuterStart.peek() - rank * ringStep.peek();
        const ri = ro - ringThickness.peek();
        if (dist >= ri - 4 && dist <= ro + 4) return rows[rank]!;
      }
      return null;
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
    let activeHandle: SVGElement | null = null;
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
        setGestureActive(false);
        if (activeHandle) activeHandle.style.cursor = "grab";
        activeHandle = null;
        this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled: false } }));
      },
    };

    // All arcs rendered in a group translated to center.
    const g = s(group({ translate: Vec.derive(() => ({ x: cx.value, y: cy.value })) }));
    const gs = mount(g);

    // Identity-keyed rings: each ring owns a specific datum (by id), tracked
    // from the mount-time snapshot. When the array is reordered, each ring
    // tweens its outer radius to its new rank instead of the slot's contents
    // swapping in place.
    const rows0 = data.value as Ring[];
    const ringElementsById = new Map<string, SVGElement>();
    const focusDatum = (d: Ring | null) => {
      if (!d?.id) return;
      ringElementsById.get(d.id)?.focus();
    };
    for (let oi = 0; oi < rows0.length; oi++) {
      const datumId = rows0[oi]!.id ?? rows0[oi]!.label;
      const cur = derive(() => {
        const arr = data.value as Ring[];
        return arr.findIndex(item => (item.id ?? item.label) === datumId);
      });
      const di = (): Ring | null => (data.value as Ring[])[cur.value] ?? null;
      // Radius derived from the datum's CURRENT rank in data.value. Hotbook
      // hands data in display order; rank = index. Tween to the new rank so
      // reorder animates rather than snapping to new positions.
      const rOuterTarget = derive(() => rOuterStart.value - Math.max(0, cur.value) * ringStep.value);
      const rOuter = num(rOuterTarget.value);
      let rOuterCancel: (() => void) | null = null;
      biEffect(() => {
        const target = rOuterTarget.value;
        rOuterCancel?.();
        rOuterCancel = this.anim.start(tween(rOuter, target, 0.25, easeInOut) as any);
      });
      const rInner = derive(() => rOuter.value - ringThickness.value);
      const corner = derive(() => Math.min(ringThickness.value / 2, 14));

      // Hidden when this datum is missing or beyond the current cap.
      const visible = derive(() => cur.value >= 0 && cur.value < nCell.value && di() != null);
      const slotColor = derive(() => di()?.color ?? '#888');

      const trackEl = gs(pathD(
        derive(() => visible.value && rInner.value >= 1 ? arcD(rOuter.value, rInner.value, START, START + TWO_PI, corner.value) : ""),
        { fill: slotColor, opacity: derive(() => { const d = di(); return hover.value === d || selected.value === d ? 0.25 : 0.18; }) }
      ));
      trackEl.el.style.touchAction = "none";
      ringElementsById.set(datumId, trackEl.el);
      // Make each ring individually focusable
      trackEl.el.setAttribute('tabindex', '0');
      trackEl.el.setAttribute('data-focusable', 'ring');
      biEffect(() => {
        const d = di();
        if (d) trackEl.el.setAttribute('aria-label', `${d.label}: ${Math.round(d.value)}`);
      });
      trackEl.el.addEventListener("pointerenter", () => { const d = di(); if (d && !wheelController.active && !dragController.active) hover.value = d; });
      trackEl.el.addEventListener("pointerleave", () => { const d = di(); if (d && !wheelController.active && !dragController.active && hover.value === d) hover.value = null; });
      trackEl.el.addEventListener("click", () => { const d = di(); if (!d) return; selected.value = selected.value === d ? null : d; this.focus(); });
      trackEl.el.addEventListener("focus", () => { const d = di(); if (d) selected.value = d; });
      trackEl.el.addEventListener("blur", () => { const d = di(); if (d && selected.value === d) selected.value = null; });

      // Per-ring value fraction tween — TWEEN on measure swap (animate arcs
      // to new values), SNAP on value edits / gestures (write-through, no lag).
      // Same two-lane gate pattern as hier charts (WIN-143).
      const fracTarget = derive(() => {
        void data.value;
        const d = di();
        return d ? d.value / 100 : 0;
      });
      const frac = num(fracTarget.value);
      let fracCancel: (() => void) | null = null;
      let fracInited = false;
      let seenMeasureKey = untracked(() => this._measureKeyCell.value);
      biEffect(() => {
        const target = fracTarget.value;
        const measureKey = untracked(() => this._measureKeyCell.value);
        if (!fracInited) { fracInited = true; seenMeasureKey = measureKey; frac.value = target; return; }
        const measureSwapped = measureKey !== seenMeasureKey;
        seenMeasureKey = measureKey;
        if (measureSwapped && !this.classList.contains(GESTURE_ACTIVE_CLASS)) {
          fracCancel?.();
          fracCancel = this.anim.start(tween(frac, target, motion.motionMs.value / 1000, easeOut));
        } else {
          fracCancel?.(); fracCancel = null;
          frac.value = target;
        }
      });

      // Value arc.
      const valueD = derive(() => {
        if (!visible.value) return "";
        const d = di();
        if (!d) return "";
        const endAngle = START + frac.value * TWO_PI;
        if (Math.abs(endAngle - START) < 0.001) return "";
        const isActive = hover.value === d || selected.value === d;
        const ro = rOuter.value + (isActive ? 4 : 0);
        const ri = rInner.value - (isActive ? 2 : 0);
        return arcD(ro, ri, START, endAngle, corner.value);
      });
      const valueStroke = derive(() => { const d = di(); return selected.value === d ? "#fff" : hover.value === d ? (d?.color ?? "none") : "none"; });
      const valueStrokeW = derive(() => { const d = di(); return selected.value === d ? 1.5 : hover.value === d ? 3 : 0; });
      const valueEl = gs(pathD(valueD, { fill: slotColor, stroke: valueStroke, strokeWidth: valueStrokeW }));
      valueEl.el.style.touchAction = "none";
      valueEl.el.addEventListener("pointerenter", () => { const d = di(); if (d && !wheelController.active && !dragController.active) hover.value = d; });
      valueEl.el.addEventListener("pointerleave", () => { const d = di(); if (d && !wheelController.active && !dragController.active && hover.value === d) hover.value = null; });
      valueEl.el.addEventListener("click", () => { const d = di(); if (!d) return; selected.value = selected.value === d ? null : d; this.focus(); });

      // End-cap drag handle.
      const handlePos = Vec.derive(() => {
        if (!visible.value) return { x: -1000, y: -1000 };
        const d3Angle = START + frac.value * TWO_PI;
        const svgAngle = d3Angle - Math.PI / 2;
        const rMid = (rOuter.value + rInner.value) / 2;
        return { x: cx.value + Math.cos(svgAngle) * rMid, y: cy.value + Math.sin(svgAngle) * rMid };
      });
      const handleR = derive(() => { const d = di(); return selected.value === d ? 7 : 6; });
      const handleFill = derive(() => { const d = di(); return selected.value === d ? "#fff" : (d?.color ?? '#888'); });
      const handleOpacity = derive(() => { const d = di(); return (hover.value === d || selected.value === d) ? 1 : 0; });
      const handleEl = s(circle(handlePos, handleR, {
        fill: handleFill,
        stroke: "#0b0d12",
        strokeWidth: 1.5,
        opacity: handleOpacity,
      }));
      handleEl.el.style.cursor = "grab";
      handleEl.el.style.touchAction = "none";
      handleEl.el.style.transition = "opacity 0.12s";
      handleEl.el.addEventListener("pointerenter", () => { const d = di(); if (!dragController.active && d) hover.value = d; });
      handleEl.el.addEventListener("pointerleave", () => { const d = di(); if (!dragController.active && d && hover.value === d) hover.value = null; });
      // Drag the handle around the ring to set its value; the shared controller
      // owns move/up/Esc and reverts on Esc.
      handleEl.el.addEventListener("pointerdown", (e) => {
        if (dragController.active) return;
        const d = di();
        if (!d) return;
        const pe = e as PointerEvent;
        dragPointerId = pe.pointerId;
        setGestureActive(true);
        selected.value = d;
        activeHandle = handleEl.el;
        handleEl.el.style.cursor = "grabbing";
        try { (this as any).setPointerCapture(pe.pointerId); } catch { /* ok */ }
        dragController.begin(d, dragConfig);
        pe.preventDefault();
        pe.stopPropagation();
      });

      // Ring label near end-cap — d3Arc angle 0=top, clockwise; SVG: angle 0=right, y-down.
      // Sit the label just outside the ring's outer edge (rOuter + 8) so labels stay
      // clean at all ring counts. Tracks frac (tweened) so it slides with the arc.
      const slotDef = RING_DEFS[oi % RING_DEFS.length]!;
      const lblPos = Vec.derive(() => {
        const d = di();
        if (!d) return { x: -1000, y: -1000 };
        const d3Angle = START + frac.value * TWO_PI; // d3Arc angle (0=top, cw)
        const svgAngle = d3Angle - Math.PI / 2;      // convert to SVG (0=right, cw y-down)
        return { x: cx.value + Math.cos(svgAngle) * (rOuter.value + 8), y: cy.value + Math.sin(svgAngle) * (rOuter.value + 8) };
      });
      s(label(lblPos, derive(() => di()?.label ?? ""), { size: 10, fill: derive(() => di()?.color ?? slotDef.color), opacity: 0.85 }));
    }

    // Center readout.
    s(label(Vec.derive(() => ({ x: cx.value, y: cy.value - 10 })), derive(() => (selected.value ?? hover.value)?.label ?? ""), {
      size: 13, align: Anchor.Center, opacity: 0.5,
    }));
    s(label(Vec.derive(() => ({ x: cx.value, y: cy.value + 14 })), derive(() => {
      void data.value;
      const p = selected.value ?? hover.value;
      return p ? `${Math.round(p.value)}` : "";
    }), { size: 28, align: Anchor.Center, fill: derive(() => (selected.value ?? hover.value)?.color ?? "#fff") }));

    svgEl.addEventListener("wheel", (e) => {
      const we = e as WheelEvent;
      if (!we.ctrlKey) return;
      const t = wheelController.begin(selected.value ?? hover.value ?? lastRing, wheelConfig, { pinch: !realModifierDown() });
      if (!t) return;
      we.preventDefault();
      mutateDatum(t, we.deltaY < 0 ? (we.shiftKey ? 5 : 1) : (we.shiftKey ? -5 : -1));
    }, { passive: false });
    this.addEventListener("pointermove", (e) => {
      if (dragController.active || wheelController.active) return;
      const pe = e as PointerEvent;
      const { x, y } = localPt(pe);
      const hit = findRingAtLocal(x, y);
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
      if (ke.key === "ArrowRight" || ke.key === "ArrowLeft") {
        const nextIdx = ke.key === "ArrowLeft"
          ? (i <= 0 ? rows.length : i) - 1
          : (i + 1) % rows.length;
        selected.value = rows[nextIdx] ?? null;
        focusDatum(selected.value);
        ke.preventDefault(); return;
      }
      const target = cur ?? hover.value;
      if (!target) return;
      const step = ke.shiftKey ? 5 : 1;
      if (ke.key === "ArrowUp") { mutateDatum(target, +step); ke.preventDefault(); }
      else if (ke.key === "ArrowDown") { mutateDatum(target, -step); ke.preventDefault(); }
    });

    s(label(
      Vec.derive(() => ({ x: Wc.value / 2, y: 20 })),
      "ConcentricArc — hover · click ring · drag handle · Tab/←/→ nav · ↑/↓ edit · cmd+wheel",
      { size: 11, align: Anchor.Center, opacity: 0.7 },
    ));

    // Bridge: sync local hover/selected ↔ base class cells.
    this._setupDisposers.push(
      biEffect(() => { this._hoverCell.value = hover.value?.id ?? null; }),
      biEffect(() => { this._focusCell.value = selected.value?.id ?? null; }),
      biEffect(() => { const id = this._extHover; if (id) hover.value = (data.value as Ring[]).find(d => d.id === id) ?? null; }),
      biEffect(() => { const id = this._extFocus; if (id) selected.value = (data.value as Ring[]).find(d => d.id === id) ?? null; }),
    );
  }

  protected _composeBehaviors(): void {
    const gesture = this._gesture!;
    this._behaviorDispose = setup(gesture)(transitionOnUpdated());
  }
}
